import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runPlanningRecommendationWorker, RECOMMENDATION_WORKER_TIMEOUT_MS } from "@/lib/planning/recommendation-worker";
import { analyzePlanningRecommendations, type PlanningRecommendationAnalysis } from "@/lib/planning/recommendation-analysis";
import { generatePlanningRecommendations, RECOMMENDATION_SEARCH_BUDGET_MS } from "@/lib/planning/recommendation-engine";
import { planningRecommendationInput } from "@/lib/planning/recommendation-basis";
import { projectWorkspaceFixture } from "./helpers/project-workspace-fixture";
import * as parking from "@/lib/planning/parking-layout";
import * as spatial from "@/lib/planning/scenario-spatial-validation";
import * as envelope from "@/lib/finance/buildable-area";

class FakeWorker {
  static instances: FakeWorker[] = [];
  static failPost = false;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn(() => { if (FakeWorker.failPost) throw new Error("clone failed"); });
  terminate = vi.fn();
  constructor(readonly url: URL) { FakeWorker.instances.push(this); }
}
const input = () => {
  const data = projectWorkspaceFixture("bounded").projectData;
  data.scenarios = [];
  Object.assign(data.parcel, {
    maxFAR: 250, maxBCR: 50, heightLimit: 18, acquiredPrice: 20000,
    boundary: [[127.0255, 37.6503], [127.0260, 37.6503], [127.0260, 37.6507], [127.0255, 37.6507]],
  });
  return planningRecommendationInput(data, "bounded");
};
beforeEach(() => { vi.useFakeTimers(); FakeWorker.instances = []; FakeWorker.failPost = false; vi.stubGlobal("Worker", FakeWorker); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("recommendation worker lifecycle", () => {
  it("starts an isolated worker, returns the response and terminates it", async () => {
    const request = input();
    const pending = runPlanningRecommendationWorker(request, new AbortController().signal);
    const worker = FakeWorker.instances[0];
    expect(worker.url.pathname).toContain("recommendation.worker.ts");
    expect(worker.postMessage).toHaveBeenCalledWith(request);
    const result = { searchStatus: "complete" } as PlanningRecommendationAnalysis;
    worker.onmessage!({ data: { ok: true, result } } as MessageEvent);
    expect(await pending).toBe(result);
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("terminates an over-budget worker without returning a partial winner", async () => {
    const pending = runPlanningRecommendationWorker(input(), new AbortController().signal);
    const assertion = expect(pending).rejects.toThrow("제한 시간");
    await vi.advanceTimersByTimeAsync(RECOMMENDATION_WORKER_TIMEOUT_MS);
    await assertion;
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
  });

  it("aborts in flight and ignores a late response", async () => {
    const controller = new AbortController();
    const pending = runPlanningRecommendationWorker(input(), controller.signal);
    const worker = FakeWorker.instances[0];
    const late = worker.onmessage!;
    const assertion = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    late({ data: { ok: true, result: {} } } as MessageEvent);
    await assertion;
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.onmessage).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not start for an already aborted request", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(runPlanningRecommendationWorker(input(), controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(FakeWorker.instances).toHaveLength(0);
  });

  it.each(["unavailable", "constructor", "post", "error", "decode", "response"])("fails closed for %s failures", async kind => {
    if (kind === "unavailable") vi.stubGlobal("Worker", undefined);
    if (kind === "constructor") vi.stubGlobal("Worker", class { constructor() { throw new Error("unavailable"); } });
    if (kind === "post") FakeWorker.failPost = true;
    const pending = runPlanningRecommendationWorker(input(), new AbortController().signal);
    const assertion = expect(pending).rejects.toBeInstanceOf(Error);
    const worker = FakeWorker.instances[0];
    if (kind === "error") worker.onerror!();
    if (kind === "decode") worker.onmessageerror!();
    if (kind === "response") worker.onmessage!({ data: { ok: false, error: "calculation failure" } } as MessageEvent);
    await assertion;
    if (worker) expect(worker.terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("shared search deadline", () => {
  it.each(["parking", "spatial", "envelope"])("does not rank a partial search when only an inner %s calculation expires", kind => {
    vi.spyOn(performance, "now").mockReturnValue(0);
    if (kind === "parking") {
      const original = parking.calculateParkingLayout;
      let calls = 0;
      vi.spyOn(parking, "calculateParkingLayout").mockImplementation(input => {
        const result = original(input);
        return ++calls === 3 ? { ...result, generationStatus: "budget-exhausted", supportedStrategy: false } : result;
      });
    } else if (kind === "spatial") {
      const original = spatial.calculatePlanningSpatialValidation;
      let calls = 0;
      vi.spyOn(spatial, "calculatePlanningSpatialValidation").mockImplementation((...args) => {
        const result = original(...args);
        if (++calls === 2 && result) result.model.floors[0].generationStatus = "budget-exhausted";
        return result;
      });
    } else {
      const original = envelope.calcBuildableArea;
      let calls = 0;
      vi.spyOn(envelope, "calcBuildableArea").mockImplementation((...args) => {
        const result = original(...args);
        return ++calls === 2 ? { ...result, geometryStatus: "unavailable", stepped3D: [], buildable2DPolygons: undefined } : result;
      });
    }
    const raw = generatePlanningRecommendations(input());
    expect(raw.evaluatedCandidates).toBeGreaterThan(0);
    expect(raw.searchStatus).toBe("incomplete");
    const result = analyzePlanningRecommendations(raw, 250);
    expect(result.architecturalFeasibility).toBeNull();
    expect(result.profitOptimal).toBeNull();
    expect(result.legalCeilingReference).toBeNull();
    expect(result.combinedPrimary).toBeNull();
  });

  it("marks expired traversal incomplete and does not rank candidates", () => {
    const clock = vi.spyOn(performance, "now").mockReturnValue(RECOMMENDATION_SEARCH_BUDGET_MS + 1);
    clock.mockReturnValueOnce(0);
    const result = generatePlanningRecommendations(input());
    expect(result.searchStatus).toBe("incomplete");
    expect(result.evaluatedCandidates).toBe(0);
    expect(result.architecturalFeasibility).toBeNull();
    expect(result.profitOptimal).toBeNull();
    expect(result.legalCeilingReference).toBeNull();
    expect(result.warnings.join(" ")).toContain("전체 후보 탐색");
  });

  it("does not reconstruct a legal ceiling or primary recommendation from an incomplete result", () => {
    const raw = generatePlanningRecommendations(input());
    expect(raw.legalCeilingReference).not.toBeNull();
    const result = analyzePlanningRecommendations({ ...raw, searchStatus: "incomplete" }, 250);
    expect(result.architecturalFeasibility).toBeNull();
    expect(result.profitOptimal).toBeNull();
    expect(result.legalCeilingReference).toBeNull();
    expect(result.combinedPrimary).toBeNull();
    expect(result.legalGeometryCandidateCount).toBe(0);
  });
});

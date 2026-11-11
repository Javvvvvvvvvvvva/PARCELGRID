import React, { type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CadastralRoadContextPanel } from "@/components/planning/CadastralRoadContextPanel";
import { PlanningSiteContextPanel } from "@/components/planning/PlanningSiteContextPanel";
import * as cadastral from "@/lib/geo/cadastral-context";
import { buildPlanningGeometry } from "@/lib/planning/planning-geometry";
import { createBlankPlanningScenario, createFloorProgram, createFloorZone } from "@/lib/planning/scenario-utils";
import { projectWorkspaceFixture } from "./helpers/project-workspace-fixture";

const harness = vi.hoisted(() => ({
  state: {} as Record<string, unknown>, hooks: [] as unknown[], cursor: 0,
  children: null as unknown, download: vi.fn(),
}));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, useState: (initial: unknown) => {
    const index = harness.cursor++;
    if (index >= harness.hooks.length) return actual.useState(initial);
    return [harness.hooks[index], (value: unknown) => { harness.hooks[index] = value; }];
  } };
});
vi.mock("@/lib/stores/project-store", () => ({
  useProjectStore: (selector: (state: Record<string, unknown>) => unknown) => selector(harness.state),
}));
vi.mock("@/lib/auth/client-session", () => ({ sessionFetch: vi.fn(), sessionLocalStorage: { setItem: vi.fn() } }));
vi.mock("@/lib/planning/cadastral-linework-export", () => ({ downloadCadastralLineworkPackage: harness.download }));
vi.mock("@react-three/fiber", () => ({ Canvas: () => null, useThree: vi.fn() }));
vi.mock("@react-three/drei", () => ({ Line: () => null, OrbitControls: () => null, Text: () => null }));
vi.mock("@/components/ui/primitives", () => ({ Panel: ({ children }: { children: ReactNode }) => {
  harness.children = children;
  return React.createElement("div", null, children);
} }));

const projectId = "context-panel";
function boundary(x: number, z: number, width: number, depth: number): [number, number][] {
  return [[x, z], [x + width, z], [x + width, z + depth], [x, z + depth]].map(([east, south]) => [
    127 + east / (111_000 * Math.cos(37 * Math.PI / 180)), 37 - south / 111_000,
  ]);
}
let snapshot: cadastral.CadastralContextSnapshot;
let road: cadastral.CadastralParcelFeature;
beforeEach(() => {
  vi.stubGlobal("React", React);
  harness.download.mockReset();
  harness.hooks = [];
  harness.cursor = 0;
  harness.children = null;
  const data = projectWorkspaceFixture(projectId).projectData;
  data.scenarios = [];
  Object.assign(data.parcel, {
    lat: 37, lng: 127, boundary: boundary(-10, -10, 20, 20), lotArea: 400,
    zoning: "일반상업지역", roads: [], setback: { road: 0, side: 0, rear: 0 },
  });
  const scenario = createBlankPlanningScenario({ projectId, name: "Panel regression" });
  scenario.floorPrograms = [createFloorProgram(1, [createFloorZone("residential", 100, 1)])];
  const planning = buildPlanningGeometry({
    projectId, scenario, boundary: data.parcel.boundary!, lotAreaSqm: 400,
    zoning: data.parcel.zoning, roads: [], setback: data.parcel.setback,
  }).snapshot;
  road = {
    pnu: "cadastral-road", jibun: "Cadastral frontage", jimok: "도로", jimokCode: "14",
    lotAreaSqm: 180, boundary: boundary(10, -15, 6, 30), distanceM: 10,
    boundarySource: "continuous-cadastral",
  };
  snapshot = cadastral.buildCadastralContext({ planning, targetPnu: projectId, parcels: [road] });
  vi.spyOn(cadastral, "buildCadastralContext").mockImplementation(() => snapshot);
  harness.state = { data, planningScenarios: [scenario], selectedPlanningScenarioId: scenario.id };
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function render(panel: typeof PlanningSiteContextPanel | typeof CadastralRoadContextPanel) {
  harness.cursor = 0;
  return renderToStaticMarkup(React.createElement(panel, { projectId }));
}
function planningState(source = "cadastral-road-parcel", summaries: Array<{ presentSn: string; label: string; roadNo: string }> = []) {
  harness.hooks = [[road], { activeRoadBoundarySource: source }, summaries, "ready", null, [],
    true, true, true, true, false, null];
}
function cadastralState() {
  harness.hooks = [[road], "ready", null, [], null, false];
}
type DownloadButton = ReactElement<{ disabled: boolean; onClick: () => Promise<void> }>;
function findButton(node: unknown): DownloadButton | undefined {
  if (Array.isArray(node)) return node.map(findButton).find(Boolean);
  if (!React.isValidElement(node)) return undefined;
  if (node.type === "button") return node as DownloadButton;
  return findButton((node.props as { children?: ReactNode }).children);
}
function downloadButton() {
  const button = findButton(harness.children);
  expect(button).toBeDefined();
  return button!;
}
function selectUpis(pnu = "UPIS-123-1") {
  snapshot.frontages[0].roadParcelPnu = pnu;
  snapshot.frontages[0].status = "planned-road-reference";
}

describe("context road evidence display", () => {
  it.each(["loading", "error", "ready"])("does not claim no intrusion without a clearance result while %s", (loadState) => {
    planningState("centerline-reference-only");
    harness.hooks[0] = [];
    harness.hooks[3] = loadState;
    snapshot.frontages = [];
    snapshot.roadClearances = [];
    const html = render(PlanningSiteContextPanel);
    expect(html).toContain("미확인");
    expect(html).toContain("도로 경계·매스 간격을 확인하지 못했습니다.");
    expect(html).not.toContain("도형상 침범 없음");
    expect(html).not.toContain(">연속지적 도로<");
    expect(html).toContain("확보한 도로 경계 없음");
  });

  it("keeps a failed topology calculation unconfirmed", () => {
    planningState();
    snapshot.roadClearances = [];
    snapshot.validation = { usable: false, status: "fail", issues: [{
      code: "cadastral-topology-calculation-failed", severity: "fail", message: "Incomplete topology",
    }] };
    const html = render(PlanningSiteContextPanel);
    expect(html).toContain("도로 경계·매스 간격을 확인하지 못했습니다.");
    expect(html).not.toContain("도형상 침범 없음");
  });

  it("distinguishes measured zero clearance from missing evidence", () => {
    planningState();
    Object.assign(snapshot.roadClearances[0], { minimumClearanceM: 0, intrudes: false, status: "pass" });
    const html = render(PlanningSiteContextPanel);
    expect(html).toContain("0.00m");
    expect(html).toContain("도형상 침범 없음");
    expect(html).not.toContain("도로 경계·매스 간격을 확인하지 못했습니다.");
  });

  it("preserves a known intrusion warning", () => {
    planningState();
    Object.assign(snapshot.roadClearances[0], { intrusionAreaSqm: 12, intrudes: true, status: "fail" });
    const html = render(PlanningSiteContextPanel);
    expect(html).toContain("12.00㎡ 저촉");
    expect(html).toContain("배치 수정 및 건축선 확인 필요");
    expect(html).not.toContain("도형상 침범 없음");
  });

  it("does not attach UPIS metadata to the selected cadastral source", () => {
    planningState("cadastral-road-parcel", [{ presentSn: "123", label: "OTHER_UPIS", roadNo: "999" }]);
    snapshot.frontages[0].roadParcelPnu = "UPIS-123-1";
    const html = render(PlanningSiteContextPanel);
    expect(html).toContain("Cadastral frontage");
    expect(html).not.toContain("OTHER_UPIS");
    expect(html).not.toContain("999호");
  });

  it("matches the whole UPIS feature ID rather than a serial substring", () => {
    planningState("upis-road-boundary", [
      { presentSn: "12", label: "WRONG_PREFIX", roadNo: "999" },
      { presentSn: "123", label: "EXACT_ROAD", roadNo: "321" },
    ]);
    selectUpis();
    const html = render(PlanningSiteContextPanel);
    expect(html).toContain("EXACT_ROAD");
    expect(html).toContain("321호");
    expect(html).not.toContain("WRONG_PREFIX");
    expect(html).not.toContain("999호");
  });

  it.each(["UPIS-456-1", "UPIS-123-10", "missing-frontage", "cadastral-frontage"])("does not fall back to an unrelated UPIS summary for %s", (identity) => {
    planningState("upis-road-boundary", [{ presentSn: "123", label: "UNRELATED_ROAD", roadNo: "999" }]);
    selectUpis(identity);
    if (identity === "missing-frontage") snapshot.frontages = [];
    if (identity === "cadastral-frontage") {
      snapshot.frontages[0].roadParcelPnu = "UPIS-123-1";
      snapshot.frontages[0].status = "verified-cadastral-width";
    }
    const html = render(PlanningSiteContextPanel);
    expect(html).not.toContain("UNRELATED_ROAD");
    expect(html).not.toContain("999호");
  });
});

describe("cadastral download validation and feedback", () => {
  it.each([
    { usable: false, status: "review" as const, issues: [] },
    { usable: true, status: "fail" as const, issues: [] },
    { usable: true, status: "review" as const, issues: [{
      code: "cadastral-road-mass-intrusion", severity: "fail" as const, message: "Known intrusion",
    }] },
  ])("blocks invalid snapshots even after a nonempty successful response %#", async (validation) => {
    cadastralState();
    snapshot.validation = validation;
    const html = render(CadastralRoadContextPanel);
    expect(downloadButton().props.disabled).toBe(true);
    expect(html).toContain("지적·도로 경계 검증 후 다운로드 가능");
    expect(html).not.toContain("지적·도로 선형 패키지 생성 가능");
    await downloadButton().props.onClick();
    expect(harness.download).not.toHaveBeenCalled();
  });

  it.each(["loading", "error", "idle"])("does not export retained source rows while %s", async (loadState) => {
    cadastralState();
    harness.hooks[1] = loadState;
    render(CadastralRoadContextPanel);
    expect(downloadButton().props.disabled).toBe(true);
    await downloadButton().props.onClick();
    expect(harness.download).not.toHaveBeenCalled();
  });

  it.each(["throw", "reject", "non-error"])("shows failure feedback and permits retry after an exporter %s", async (failure) => {
    cadastralState();
    const message = failure === "non-error" ? "지적도 패키지 다운로드에 실패했습니다." : "Export validation failed";
    harness.download.mockImplementation(() => {
      if (failure === "throw") throw new Error(message);
      return Promise.reject(failure === "non-error" ? null : new Error(message));
    });
    render(CadastralRoadContextPanel);
    expect(downloadButton().props.disabled).toBe(false);
    await expect(downloadButton().props.onClick()).resolves.toBeUndefined();
    const html = render(CadastralRoadContextPanel);
    expect(html).toContain(message);
    expect(html).toContain("var(--neg-soft)");
    expect(html).not.toContain("다운로드를 시작했습니다.");
    expect(downloadButton().props.disabled).toBe(false);
  });

  it("disables a pending export and shows success only after it resolves", async () => {
    cadastralState();
    harness.hooks[4] = { tone: "fail", text: "Previous failure" };
    let resolve!: (value: { filename: string }) => void;
    harness.download.mockReturnValue(new Promise((done) => { resolve = done; }));
    render(CadastralRoadContextPanel);
    const pending = downloadButton().props.onClick();
    const waiting = render(CadastralRoadContextPanel);
    expect(downloadButton().props.disabled).toBe(true);
    expect(waiting).toContain("지적·도로 선형 패키지 생성 중");
    expect(waiting).not.toContain("Previous failure");
    expect(waiting).not.toContain("다운로드를 시작했습니다.");
    await downloadButton().props.onClick();
    expect(harness.download).toHaveBeenCalledTimes(1);
    resolve({ filename: "validated-context.zip" });
    await pending;
    const html = render(CadastralRoadContextPanel);
    expect(downloadButton().props.disabled).toBe(false);
    expect(html).toContain("validated-context.zip 다운로드를 시작했습니다.");
    expect(html).toContain("var(--pos-soft)");
  });
});

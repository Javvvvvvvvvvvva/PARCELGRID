import { describe, expect, it, vi } from "vitest";
import { analysisReferenceFixture } from "./helpers/analysis-reference-fixture";
import { applyInteriorAutomation, generateInteriorAutomation, interiorAutomationInputKey, INTERIOR_AUTOMATION_BUDGET_MS, type InteriorAutomationInput } from "@/lib/planning/interior-automation";
import { assessEgressCore } from "@/lib/planning/egress-core";
import { parkingEgressObstacles } from "@/lib/planning/parking-egress-obstacles";
import * as egress from "@/lib/planning/egress-core";

function fixture(blank = true): InteriorAutomationInput {
  const { scenario, geometry, parking } = analysisReferenceFixture();
  if (blank) {
    scenario.floorPrograms.forEach(floor => { delete floor.interiorLayout; });
    delete scenario.egressPlan!.exit;
  }
  return { scenario, geometry, parking, options: { bedrooms: 1, replaceExisting: false } };
}
function program(input: InteriorAutomationInput) {
  return { ...input.scenario, floorPrograms: input.scenario.floorPrograms.map(floor => ({ ...floor, interiorLayout: null })), egressPlan: null };
}
describe("bounded whole-plan interior automation", () => {
  it("generates rooms and linked cores without changing programs, prices, counts or approvals", () => {
    const input = fixture(), before = structuredClone(input), progress = vi.fn();
    const result = generateInteriorAutomation(input, progress);
    expect(result.status, result.issues.join("\n")).toBe("ready");
    expect(result.approvalStatus).toBe("unverified");
    expect(result.changed).toBe(true);
    expect(result.attempts).toBeLessThanOrEqual(6);
    expect(result.connectedFloors).toBe(3);
    expect(result.rows.map(row => row.roomsReady)).toEqual([0, 1, 1]);
    expect(input).toEqual(before);
    expect(progress).toHaveBeenCalled();
    const patch = applyInteriorAutomation(input, result);
    expect(Object.keys(patch).sort()).toEqual(["egressPlan", "floorPrograms"]);
    const next = { ...input, scenario: { ...input.scenario, ...patch } };
    expect(program(next)).toEqual(program(input));
    expect(assessEgressCore({ scenario: next.scenario, floors: input.geometry!.building.floors,
      parcelPolygons: input.geometry!.parcel.polygons, parcelShape: input.geometry!.parcel.polygon,
      groundObstacles: parkingEgressObstacles(input.parking) }).status).toBe("preliminary-chain");
  });

  it("preserves existing room edits and exit while filling a missing room draft", () => {
    const input = fixture(false), original = structuredClone(input.scenario);
    input.scenario.floorPrograms[2].interiorLayout!.roomLayouts = [];
    const result = generateInteriorAutomation(input);
    expect(result.status, result.issues.join("\n")).toBe("ready");
    const patch = applyInteriorAutomation(input, result);
    expect(patch.floorPrograms?.[1]).toEqual(original.floorPrograms[1]);
    expect(patch.egressPlan).toEqual(original.egressPlan);
    expect(patch.floorPrograms?.[2].interiorLayout?.roomLayouts).toHaveLength(1);
  });

  it("does not replace an existing conflicting draft without the explicit replacement option", () => {
    const input = fixture(false);
    input.scenario.floorPrograms[1].interiorLayout!.spaces[0].center.x += 100;
    const before = structuredClone(input);
    const result = generateInteriorAutomation(input);
    expect(result.status).toBe("no-candidate");
    expect(result.candidate).toBeNull();
    expect(input).toEqual(before);
    input.options.replaceExisting = true;
    const replaced = generateInteriorAutomation(input);
    expect(replaced.status, replaced.issues.join("\n")).toBe("ready");
    expect(() => applyInteriorAutomation(input, replaced)).not.toThrow();
  });

  it("reports unchanged fully connected plans without an applicable patch", () => {
    const input = fixture(false), result = generateInteriorAutomation(input);
    expect(result.status).toBe("ready"); expect(result.changed).toBe(false);
    expect(() => applyInteriorAutomation(input, result)).toThrow();
  });

  it.each(["parking", "geometry", "version", "locked", "missing-ground", "scale", "options"])("blocks incomplete or unsupported %s input", kind => {
    const input = fixture();
    if (kind === "parking") input.parking = null;
    if (kind === "geometry") input.geometry = null;
    if (kind === "version") input.geometry!.scenarioVersion++;
    if (kind === "locked") input.scenario.geometrySource = { mode: "engine-generated", exactGeometryAvailable: true, locked: true };
    if (kind === "missing-ground") input.scenario.floorPrograms[0].level = 0;
    if (kind === "scale") input.scenario.floorPrograms = Array.from({ length: 33 }, () => input.scenario.floorPrograms[0]);
    if (kind === "options") input.options.bedrooms = NaN;
    const result = generateInteriorAutomation(input);
    expect(result.status).toBe("blocked"); expect(result.candidate).toBeNull();
  });

  it.each(["room", "program", "parking", "parcel", "options"])("rejects application after %s changes", kind => {
    const input = fixture(), result = generateInteriorAutomation(input);
    expect(result.status).toBe("ready");
    if (kind === "room") input.scenario.floorPrograms[0].interiorLayout = result.candidate!.layouts[0].layout;
    if (kind === "program") input.scenario.floorPrograms[1].zones[0].areaSqm++;
    if (kind === "parking") input.scenario.parking.providedCars++;
    if (kind === "parcel") input.geometry!.parcel.polygon[0].x++;
    if (kind === "options") input.options.bedrooms = 2;
    expect(() => applyInteriorAutomation(input, result)).toThrow(/변경/);
  });

  it.each(["door", "exit", "duplicate", "foreign", "program"])("rechecks an altered candidate: %s", kind => {
    const input = fixture(), result = generateInteriorAutomation(input);
    expect(result.status).toBe("ready");
    const candidate = result.candidate!;
    if (kind === "door") candidate.layouts[1].layout.roomLayouts![0].doors = [];
    if (kind === "exit") delete candidate.egressPlan.exit;
    if (kind === "duplicate") candidate.layouts[1].floorId = candidate.layouts[0].floorId;
    if (kind === "foreign") candidate.layouts[0].floorId = "foreign";
    if (kind === "program") candidate.layouts[1].layout.programBasis = "forged";
    expect(() => applyInteriorAutomation(input, result)).toThrow();
  });

  it("returns no applicable partial output when its time budget expires", () => {
    const input = fixture();
    const clock = vi.spyOn(performance, "now").mockReturnValue(INTERIOR_AUTOMATION_BUDGET_MS + 1).mockReturnValueOnce(0);
    try {
      const result = generateInteriorAutomation(input);
      expect(result.status).toBe("incomplete"); expect(result.candidate).toBeNull(); expect(result.changed).toBe(false);
    } finally { clock.mockRestore(); }
  });

  it("propagates an inner egress budget failure as incomplete rather than no candidate", () => {
    const input = fixture();
    const original = egress.assessEgressCore;
    const mock = vi.spyOn(egress, "assessEgressCore").mockImplementation(request => ({ ...original(request), status: "missing",
      issues: [{ code: "egress-geometry-budget", status: "unknown", message: "Synthetic inner deadline" }] }));
    try {
      const result = generateInteriorAutomation(input);
      expect(result.status).toBe("incomplete"); expect(result.candidate).toBeNull(); expect(result.changed).toBe(false);
    } finally { mock.mockRestore(); }
  });

  it("binds actual obstacles and reports their conflicts instead of silently dropping parking", () => {
    const input = fixture();
    input.parking!.layout.stalls[0].corners = input.geometry!.building.floors[0].shape;
    const result = generateInteriorAutomation(input);
    expect(result.status).toBe("no-candidate");
    expect(result.issues.join(" ")).toMatch(/겹칩니다/);
    expect(result.sourceKey).toBe(interiorAutomationInputKey(input));
  });
});

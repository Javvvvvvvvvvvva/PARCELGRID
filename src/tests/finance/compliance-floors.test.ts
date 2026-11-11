import { describe, expect, it } from "vitest";
import { checkCompliance } from "@/lib/finance/compliance";
import { defaultProgram } from "@/lib/finance/scenario";
import { createRegulatoryReferenceSet, type RegulatoryEvidenceStatus } from "@/lib/regulatory/constraints";
import type { Parcel } from "@/lib/finance/types";

const parcel: Parcel = {
  id: "synthetic-floor-scope", address: "서울특별시 합성 검증 부지", addressRoad: "", lotArea: 576,
  zoning: "일반상업지역", zoneCode: "synthetic", maxFAR: 200, maxBCR: 60, heightLimit: 30,
  setback: { road: 0, side: 0, rear: 0 }, landPrice: 100000, estMarketPrice: 100000,
  acquired: "2026-01-01", acquiredPrice: 50000,
};
const program = { ...defaultProgram("multi-family", 120, 20), floorsAbove: 6 };
const floorCheck = (site = parcel, plan = program) => checkCompliance({ parcel: site, program: plan }).find(check => check.code === "GFA-03")!;

describe("independent floor-limit screening", () => {
  it("does not turn FAR / maximum BCR into a floor limit or a violation", () => {
    const check = floorCheck();
    expect(check.level).toBe("low");
    expect(check.evidenceStatus).toBe("preliminary");
    expect(check.headroom).toBeUndefined();
    expect(check.finding).not.toContain("약 3층");
    expect(check.label).toContain("미확인");
  });

  it("does not penalize a taller narrower plan solely because the parcel allows more coverage", () => {
    const narrow = floorCheck(parcel, { ...program, floorsAbove: 6, bcr: 20 });
    const wide = floorCheck(parcel, { ...program, floorsAbove: 3, bcr: 40 });
    const higherCoverageLimit = floorCheck({ ...parcel, maxBCR: 90 });
    expect([narrow.level, wide.level, higherCoverageLimit.level]).toEqual(["low", "low", "low"]);
  });

  it.each(["reference-only", "user-entered", "source-backed", "expert-approved"] as RegulatoryEvidenceStatus[])("compares an explicit %s floor limit without claiming statutory approval", status => {
    const constraints = createRegulatoryReferenceSet({ floors: 4 });
    constraints.floors.status = status;
    const site = { ...parcel, regulatoryConstraints: constraints };
    expect(floorCheck(site)).toMatchObject({ level: "high", evidenceStatus: "preliminary", headroom: { actual: 6, limit: 4, unit: "층" } });
    expect(floorCheck(site, { ...program, floorsAbove: 4 })).toMatchObject({ level: "ok", evidenceStatus: "preliminary" });
    expect(floorCheck(site).finding).toContain("허가");
  });

  it.each([null, 0, -1, 4.5, Infinity, NaN])("does not use an invalid or absent limit %s", value => {
    const constraints = createRegulatoryReferenceSet({ floors: 4 });
    constraints.floors.value = value;
    expect(floorCheck({ ...parcel, regulatoryConstraints: constraints })).toMatchObject({ level: "low", evidenceStatus: "preliminary" });
    expect(floorCheck({ ...parcel, regulatoryConstraints: constraints }).headroom).toBeUndefined();
  });

  it("does not revive a number whose evidence was marked unknown", () => {
    const constraints = createRegulatoryReferenceSet({ floors: 4 }); constraints.floors.status = "unknown";
    expect(floorCheck({ ...parcel, regulatoryConstraints: constraints }).headroom).toBeUndefined();
  });

  it.each([0, -1, 1.5, Infinity, NaN])("rejects invalid above-ground floor count %s", floorsAbove => {
    expect(floorCheck(parcel, { ...program, floorsAbove }).level).toBe("high");
  });

  it("keeps a real FAR input breach in its own check", () => {
    const checks = checkCompliance({ parcel, program: { ...program, far: 250 } });
    expect(checks.find(check => check.code === "GFA-01")?.level).toBe("high");
    expect(checks.find(check => check.code === "GFA-03")?.level).toBe("low");
  });
});

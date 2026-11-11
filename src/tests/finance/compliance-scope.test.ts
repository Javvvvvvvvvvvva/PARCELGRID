import { describe, expect, it } from "vitest";
import { checkCompliance } from "@/lib/finance/compliance";
import { defaultProgram } from "@/lib/finance/scenario";
import type { Parcel } from "@/lib/finance/types";

const parcel: Parcel = {
  id: "synthetic-scope", address: "서울특별시 합성 검증 부지", addressRoad: "", lotArea: 576,
  zoning: "일반상업지역", zoneCode: "synthetic", maxFAR: 200, maxBCR: 60, heightLimit: 30,
  setback: { road: 0, side: 0, rear: 0 }, landPrice: 100000, estMarketPrice: 100000,
  acquired: "2026-01-01", acquiredPrice: 50000,
};
const program = defaultProgram("multi-family", 120, 40);

describe("unsupported regulatory scope is not a clearance", () => {
  it.each([100, 29999, 30000, 30001, 100000])("does not decide environmental assessment from %s sqm alone", gfa => {
    const check = checkCompliance({ parcel: { ...parcel, lotArea: gfa / 1.2 }, program }).find(c => c.code === "ENV-03")!;
    expect(check).toMatchObject({ level: "low", evidenceStatus: "preliminary" });
    expect(check.label).toContain("미확인");
    expect(check.finding).toContain("사업 종류");
    expect(check.finding).toContain("조례");
    expect(check.finding).not.toMatch(/미해당|평가 필요/);
    expect(check.headroom).toBeUndefined();
  });

  it.each([undefined, NaN, Infinity, -1, 0, 80, 100, 500, 501, 10000])("keeps heritage scope unresolved with distance %s", distance => {
    const check = checkCompliance({ parcel, program, context: { nearCulturalHeritageM: distance } }).find(c => c.code === "CUL-01")!;
    expect(check).toBeDefined();
    expect(check.evidenceStatus).toBe("preliminary");
    expect(check.level).not.toBe("ok");
    expect(check.label).toContain("미확인");
    expect(check.finding).not.toMatch(/필수|협의 필요|NaN|Infinity/);
    expect(check.reference).not.toContain("문화재보호법");
    if (distance !== undefined && Number.isFinite(distance) && distance >= 0) {
      expect(check.finding).toContain(`${distance}m`);
    } else expect(check.finding).toContain("거리 미확인");
  });

  it("never mutates project amounts or area contracts during screening", () => {
    const input = { parcel: structuredClone(parcel), program: structuredClone(program) };
    const before = structuredClone(input);
    checkCompliance(input);
    expect(input).toEqual(before);
  });
});

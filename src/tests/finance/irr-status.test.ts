import { describe, expect, it } from "vitest";
import {
  calculateScenario,
  defaultAssumptions,
  defaultProgram,
} from "@/lib/finance/scenario";
import type { Parcel, Scenario } from "@/lib/finance/types";

const parcel: Parcel = {
  id: "irr-status",
  address: "서울 테스트구 테스트동 1",
  addressRoad: "서울 테스트로 1",
  lotArea: 120,
  zoning: "제2종일반주거지역",
  zoneCode: "UQA122",
  maxFAR: 200,
  maxBCR: 60,
  heightLimit: 20,
  setback: { road: 0, side: 0, rear: 0 },
  landPrice: 1_000_000,
  estMarketPrice: 2_000_000,
  acquired: "2026-01-01",
  acquiredPrice: 30_000,
};

describe("IRR audit status", () => {
  it("does not fabricate an IRR when there is no positive cash flow", () => {
    const assumptions = defaultAssumptions();
    assumptions.salePricePerSqM = 0;
    assumptions.rentPerSqMMonth = 0;
    const scenario: Scenario = {
      id: "NO-RETURN",
      name: "회수 없음",
      shortName: "회수 없음",
      program: defaultProgram(
        "multi-family",
        parcel.maxFAR,
        parcel.maxBCR
      ),
      assumptions,
    };

    const result = calculateScenario({ parcel, scenario });
    expect(result.irrStatus).toBe("not-calculated");
    expect(result.irr).toBe(0);
    expect(result.npv).toBeLessThan(0);
  });
});

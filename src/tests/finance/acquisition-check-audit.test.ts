import { describe, expect, it } from "vitest";
import {
  ACQUISITION_CHECK_MODEL_VERSION,
  checkAcquisition,
} from "@/lib/finance/acquisition-check";

describe("acquisition comparison audit status", () => {
  it("does not present internal thresholds as an externally validated fair-price opinion", () => {
    const result = checkAcquisition({
      parcel: {
        lotAreaSqm: 100,
        landPriceWonPerSqm: 5_000_000,
        lat: 37.5,
        lng: 127,
        jimokCategory: "buildable",
      },
      acquisitionPriceManwon: 100_000,
      acquisitionDate: "2026-07-01",
      landTransactions: [],
      scope: "dong",
      targetDong: "테스트동",
      jimokFilter: "match-parcel",
    });

    expect(result.modelVersion).toBe(ACQUISITION_CHECK_MODEL_VERSION);
    expect(result.modelStatus).toBe("experimental-unvalidated");
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.axisLandPriceRatio.label).toContain("자체");
    expect(result.verdict.label).not.toBe("적정");
    expect(result.verdict.reasoning).not.toContain("정상 범위");
  });
});

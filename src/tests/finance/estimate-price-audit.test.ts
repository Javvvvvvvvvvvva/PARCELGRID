import { describe, expect, it } from "vitest";
import {
  confidenceLabel,
  estimateMarketPrice,
  MARKET_PRICE_MODEL_VERSION,
  methodLabel,
} from "@/lib/finance/estimate-price";

describe("market price estimate audit metadata", () => {
  it("marks public-value fallback as externally unvalidated", () => {
    const result = estimateMarketPrice({
      publicLandValueManwon: 200,
      lotAreaSqm: 120,
      landTransactions: [],
      houseTransactions: [],
      jimokCategory: "buildable",
      address: "서울 도봉구 쌍문동 1-1",
    });

    expect(result.method).toBe("by-publicvalue");
    expect(result.modelVersion).toBe(MARKET_PRICE_MODEL_VERSION);
    expect(result.modelStatus).toBe("experimental-unvalidated");
    expect(result.confidence).toBe("low");
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.details.sampleSize).toBe(0);
  });

  it("uses evidence labels instead of accuracy claims", () => {
    expect(confidenceLabel("high")).toBe("표본 근거 충분");
    expect(confidenceLabel("low")).toBe("표본 근거 부족");
    expect(methodLabel("house-comps")).toContain("참고");
    expect(methodLabel("by-publicvalue")).toContain("자체 보정");
  });
});

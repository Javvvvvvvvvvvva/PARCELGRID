import { describe, expect, it } from "vitest";
import {
  estimateSalePriceFromComps,
  SALE_PRICE_MODEL_VERSION,
} from "@/lib/finance/sale-price-from-comps";

describe("sale price estimate audit metadata", () => {
  it("records its unvalidated scoring status and reference year", () => {
    const result = estimateSalePriceFromComps(
      [
        {
          type: "단독다가구",
          pricePerPyeong: 1_100,
          buildYear: 2018,
          sameDong: true,
          address: "테스트동 1",
          date: "2026-01-01",
        },
        {
          type: "단독다가구",
          pricePerPyeong: 1_300,
          buildYear: 2015,
          sameDong: true,
          address: "테스트동 2",
          date: "2026-02-01",
        },
        {
          type: "단독다가구",
          pricePerPyeong: 1_500,
          buildYear: 2010,
          sameDong: false,
          address: "인접동 3",
          date: "2026-03-01",
        },
      ],
      2026
    );

    expect(result).not.toBeNull();
    expect(result?.modelVersion).toBe(SALE_PRICE_MODEL_VERSION);
    expect(result?.modelStatus).toBe("experimental-unvalidated");
    expect(result?.asOfYear).toBe(2026);
    expect(result?.warnings.length).toBeGreaterThan(0);
    expect(result?.basis).toContain("외부 검증 전");
  });
});

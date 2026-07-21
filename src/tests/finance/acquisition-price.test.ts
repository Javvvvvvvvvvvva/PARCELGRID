import { describe, expect, it } from "vitest";
import {
  acquisitionLotPyeong,
  acquisitionPricePerPyeong,
  acquisitionPriceTotal,
  assessAcquisitionPrice,
} from "../../lib/finance/acquisition-price";

describe("acquisition price input units", () => {
  const lotAreaSqm = 398.77;

  it("converts the 도봉동 562 lot to the same pyeong basis shown in Stage 1", () => {
    expect(acquisitionLotPyeong(lotAreaSqm)).toBeCloseTo(120.62793, 5);
  });

  it("converts 1,500만원/평 to 180,942만원 total", () => {
    expect(acquisitionPriceTotal(1_500, lotAreaSqm)).toBe(180_942);
  });

  it("converts the 1,115만원/평 land median to 134,500만원 total", () => {
    expect(acquisitionPriceTotal(1_115, lotAreaSqm)).toBe(134_500);
  });

  it("does not confuse a 1,500만원 total test input with 1,500만원/평", () => {
    expect(acquisitionPricePerPyeong(1_500, lotAreaSqm)).toBeCloseTo(12.43, 2);
  });

  it("flags values outside the disclosed reference band", () => {
    expect(assessAcquisitionPrice(1_500, 206_000).status).toBe("extreme-low");
    expect(assessAcquisitionPrice(206_000, 206_000).status).toBe("within-range");
    expect(assessAcquisitionPrice(700_000, 206_000).status).toBe("extreme-high");
  });
});

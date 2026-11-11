import { describe, expect, it } from "vitest";
import { calculatedAnnualIrr, meetsIrrTarget } from "@/lib/finance/return-metrics";

describe("unrounded annual return thresholds", () => {
  it("uses raw IRR even when the displayed value rounds up to the target", () => {
    const result = { irrStatus: "calculated" as const, irr: 10, irrUnroundedPct: 9.95025875484114 };
    expect(calculatedAnnualIrr(result)).toBe(result.irrUnroundedPct);
    expect(meetsIrrTarget(result, 10)).toBe(false);
    expect(meetsIrrTarget(result, result.irrUnroundedPct)).toBe(true);
  });

  it("preserves a calculated zero", () => {
    const result = { irrStatus: "calculated" as const, irrUnroundedPct: 0 };
    expect(calculatedAnnualIrr(result)).toBe(0);
    expect(meetsIrrTarget(result, 0)).toBe(true);
  });

  it.each([undefined, NaN, Infinity, -Infinity])("rejects missing/nonfinite raw IRR %s without display fallback", (raw) => {
    const result = { irrStatus: "calculated" as const, irr: 20, irrUnroundedPct: raw };
    expect(calculatedAnnualIrr(result)).toBeNull();
    expect(meetsIrrTarget(result, 10)).toBe(false);
  });

  it.each([undefined, "not-calculated", "ambiguous"] as const)("requires calculated status, not %s", (irrStatus) => {
    expect(calculatedAnnualIrr({ irrStatus, irrUnroundedPct: 20 })).toBeNull();
  });

  it.each([NaN, Infinity, -Infinity])("rejects nonfinite target %s", (target) => {
    expect(meetsIrrTarget({ irrStatus: "calculated", irrUnroundedPct: 20 }, target)).toBe(false);
  });
});

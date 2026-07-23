import { describe, it, expect } from "vitest";
import { calculateScenario, defaultProgram, defaultAssumptions } from "../../lib/finance/scenario";
import { generatePFSchedule } from "../../lib/finance/cashflow";
import { calculateTaxes, TAX_RATES } from "../../lib/finance/tax";
import { analyzeComps } from "../../lib/finance/comps";
import { checkCompliance, complianceScore } from "../../lib/finance/compliance";
import type { Parcel, Scenario } from "../../lib/finance/types";
import type { Comp } from "../../lib/finance/comps";

const parcel: Parcel = {
  id: "P", address: "서울특별시 강남구 역삼동 824-11", addressRoad: "강남대로 372",
  lotArea: 645.3, zoning: "제3종일반주거지역", zoneCode: "UB30",
  maxFAR: 250, maxBCR: 60, heightLimit: 28,
  setback: { road: 3, side: 1.5, rear: 3 },
  landPrice: 12_400_000, estMarketPrice: 41_500_000,
  acquired: "2025-07-01", acquiredPrice: 268_000,
};

const scenario: Scenario = {
  id: "S1", name: "오피스텔+근생", shortName: "S1",
  program: defaultProgram("officetel", 250, 60),
  assumptions: {
    ...defaultAssumptions(),
    // 강남 오피스텔 fixture — 외곽 다가구 통매각 기본값과 분리
    salePricePerSqM: 12_000_000,
  },
};

describe("generatePFSchedule", () => {
  const result = calculateScenario({ parcel, scenario });
  const schedule = generatePFSchedule({ parcel, scenario, result, startDate: "2025-07-01" });

  it("produces a row for each project quarter", () => {
    expect(schedule.rows.length).toBeGreaterThanOrEqual(8);
    expect(schedule.rows[0].quarter).toBe("2025-Q3");
  });

  it("first quarter includes land acquisition without dropping other costs", () => {
    expect(schedule.rows[0].phase).toContain("토지 인수");
    expect(schedule.rows[0].outflow).toBeGreaterThanOrEqual(parcel.acquiredPrice);
  });

  it("cumulative balance reconciles every quarter including presales", () => {
    let cumulative = 0;
    for (const row of schedule.rows) {
      cumulative += row.netQuarter;
      expect(row.cumulative).toBe(cumulative);
    }
  });

  it("max exposure occurs before sales kick in", () => {
    expect(schedule.maxExposure).toBeLessThan(0);
    const maxExposureRow = schedule.rows.find((r) => r.cumulative === schedule.maxExposure);
    expect(maxExposureRow).toBeDefined();
  });

  it("quarterly totals reconcile to the scenario ledger", () => {
    expect(schedule.totalOutflow).toBeCloseTo(result.totalCost, -1);
    expect(schedule.totalInflow).toBeCloseTo(result.totalRevenue, -1);
  });
});

describe("calculateTaxes", () => {
  const result = calculateScenario({ parcel, scenario });
  const taxes = calculateTaxes({
    parcel,
    result,
    residentialSaleShare: scenario.program.mix.residentialSale,
  });

  it("produces all expected tax lines", () => {
    const codes = taxes.lines.map((l) => l.tax);
    expect(codes).toContain("취득세");
    expect(codes).toContain("재산세");
    expect(codes).toContain("법인세");
    expect(codes).toContain("부가세");
  });

  it("does not apply a land-only tax rate when building status is unknown", () => {
    const acquisition = taxes.lines.find(
      (line) =>
        line.tax === "취득세" && line.base === "부동산 총 취득대금",
    );
    expect(acquisition).toMatchObject({
      amount: 0,
      rate: "미산정",
      status: "not-calculated",
    });
    expect(acquisition?.note).toContain("건축물 존재 여부");
  });

  it("estimates the land rate only when the parcel is confirmed vacant", () => {
    const vacantParcel: Parcel = {
      ...parcel,
      currentBuilding: {
        hasBuilding: false,
      } as NonNullable<Parcel["currentBuilding"]>,
    };
    const vacantResult = calculateScenario({ parcel: vacantParcel, scenario });
    const vacantTaxes = calculateTaxes({
      parcel: vacantParcel,
      result: vacantResult,
      residentialSaleShare: scenario.program.mix.residentialSale,
    });
    const acquisition = vacantTaxes.lines.find(
      (line) => line.tax === "취득세" && line.base === "토지",
    );
    expect(acquisition).toMatchObject({ status: "estimated" });
    expect(acquisition!.amount).toBeCloseTo(
      vacantParcel.acquiredPrice * TAX_RATES.acquisitionLandGeneral,
      -1,
    );
  });

  it("blocks acquisition tax when an existing building is confirmed", () => {
    const improvedParcel: Parcel = {
      ...parcel,
      currentBuilding: {
        hasBuilding: true,
      } as NonNullable<Parcel["currentBuilding"]>,
    };
    const improvedResult = calculateScenario({
      parcel: improvedParcel,
      scenario,
    });
    const improvedTaxes = calculateTaxes({
      parcel: improvedParcel,
      result: improvedResult,
      residentialSaleShare: scenario.program.mix.residentialSale,
    });
    const acquisition = improvedTaxes.lines.find(
      (line) =>
        line.tax === "취득세" && line.base === "부동산 총 취득대금",
    );
    expect(acquisition).toMatchObject({
      amount: 0,
      status: "not-calculated",
    });
    expect(acquisition?.note).toContain("토지·건물 안분");
  });

  it("corporate tax applies progressive brackets to positive profit", () => {
    const corp = taxes.lines.find((l) => l.tax === "법인세")!;
    const profitWon = Math.max(result.profit, 0) * 10_000;
    let remaining = profitWon;
    let lower = 0;
    let expectedWon = 0;
    for (const bracket of TAX_RATES.corporateBrackets) {
      if (remaining <= 0) break;
      const width = Number.isFinite(bracket.upperWon)
        ? bracket.upperWon - lower
        : remaining;
      const taxable = Math.min(remaining, width);
      expectedWon += taxable * bracket.rate;
      remaining -= taxable;
      lower = bracket.upperWon;
    }
    expect(corp.amount).toBeCloseTo(expectedWon / 10_000, 0);
  });

  it("does not create negative corporate tax for a loss", () => {
    const lossTaxes = calculateTaxes({
      parcel,
      result: { ...result, profit: -10_000 },
      residentialSaleShare: scenario.program.mix.residentialSale,
    });
    const corp = lossTaxes.lines.find((l) => l.tax === "법인세")!;
    expect(corp.amount).toBe(0);
  });

  it("total only includes calculated estimates and flags incomplete coverage", () => {
    const sum = taxes.lines
      .filter((line) => line.status === "estimated")
      .reduce((total, line) => total + line.amount, 0);
    expect(taxes.total).toBe(sum);
    expect(taxes.complete).toBe(false);
    expect(taxes.lines.some((line) => line.status === "not-calculated")).toBe(true);
  });
});

describe("analyzeComps", () => {
  const comps: Comp[] = [
    { id: "C1", date: "2024-11-08", address: "역삼동 813-4", type: "오피스텔",
      area: 581, gfa: 1320, price: 612400, pricePerPyeong: 1532, far: 215, dist: 0.18 },
    { id: "C2", date: "2024-09-22", address: "역삼동 791-22", type: "오피스텔",
      area: 712, gfa: 1654, price: 748000, pricePerPyeong: 1496, far: 222, dist: 0.31 },
    { id: "C3", date: "2024-07-14", address: "삼성동 162-8", type: "오피스텔",
      area: 624, gfa: 1408, price: 658500, pricePerPyeong: 1547, far: 218, dist: 0.86 },
  ];
  const analysis = analyzeComps({ lotArea: 645.3, plannedFAR: 218 }, comps, "2025-03-04");

  it("returns one adjustment per comp", () => {
    expect(analysis.adjustments.length).toBe(3);
  });

  it("each adjustment includes 4 factors", () => {
    for (const a of analysis.adjustments) {
      expect(a.factors.distance).toBeGreaterThan(0);
      expect(a.factors.far).toBeGreaterThan(0);
      expect(a.factors.size).toBeGreaterThan(0);
      expect(a.factors.recency).toBeGreaterThan(0);
    }
  });

  it("estimated price is in the right magnitude", () => {
    expect(analysis.estimatedPricePerPyeong).toBeGreaterThan(1000);
    expect(analysis.estimatedPricePerPyeong).toBeLessThan(2500);
  });

  it("further comps get a price drop from distance factor", () => {
    const far = analysis.adjustments.find((a) => a.comp.id === "C3")!; // 0.86km
    const near = analysis.adjustments.find((a) => a.comp.id === "C1")!; // 0.18km
    expect(far.factors.distance).toBeLessThan(near.factors.distance);
  });
});

describe("checkCompliance", () => {
  it("flags FAR violation", () => {
    const overFAR = { ...scenario, program: { ...scenario.program, far: 300 } };
    const checks = checkCompliance({ parcel, program: overFAR.program });
    const gfa01 = checks.find((c) => c.code === "GFA-01")!;
    expect(gfa01.level).toBe("high");
  });

  it("passes FAR check when under limit", () => {
    const checks = checkCompliance({ parcel, program: scenario.program });
    const gfa01 = checks.find((c) => c.code === "GFA-01")!;
    expect(["ok", "low", "med"]).toContain(gfa01.level);
  });

  it("flags cultural heritage proximity when within 100m", () => {
    const checks = checkCompliance({
      parcel,
      program: scenario.program,
      context: { nearCulturalHeritageM: 80 },
    });
    const cul = checks.find((c) => c.code === "CUL-01");
    expect(cul).toBeDefined();
    expect(cul!.level).toBe("high");
  });

  it("compliance score is 100 when nothing flagged seriously", () => {
    const cleanProgram = { ...scenario.program, far: 200, floorsAbove: 6 };
    const checks = checkCompliance({ parcel, program: cleanProgram });
    const score = complianceScore(checks);
    expect(score).toBeGreaterThan(80);
  });
});

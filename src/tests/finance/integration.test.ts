import { describe, it, expect } from "vitest";
import { calculateScenario, defaultProgram, defaultAssumptions } from "../../lib/finance/scenario";
import { generatePFSchedule } from "../../lib/finance/cashflow";
import { calculateTaxes } from "../../lib/finance/tax";
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
  assumptions: defaultAssumptions(),
};

describe("generatePFSchedule", () => {
  const result = calculateScenario({ parcel, scenario });
  const schedule = generatePFSchedule({ parcel, scenario, result, startDate: "2025-07-01" });

  it("produces a row for each project quarter", () => {
    expect(schedule.rows.length).toBeGreaterThanOrEqual(8);
    expect(schedule.rows[0].quarter).toBe("2025-Q3");
  });

  it("first quarter shows the land acquisition", () => {
    expect(schedule.rows[0].phase).toBe("토지비");
    expect(schedule.rows[0].outflow).toBe(parcel.acquiredPrice);
  });

  it("cumulative balance progresses monotonically through outflow phase", () => {
    let prev = 0;
    for (const row of schedule.rows.slice(0, 4)) {
      expect(row.cumulative).toBeLessThanOrEqual(prev + 1);
      prev = row.cumulative;
    }
  });

  it("max exposure occurs before sales kick in", () => {
    expect(schedule.maxExposure).toBeLessThan(0);
    const maxExposureRow = schedule.rows.find((r) => r.cumulative === schedule.maxExposure);
    expect(maxExposureRow).toBeDefined();
  });

  it("total outflow exceeds 토지 + 공사 minimums", () => {
    expect(schedule.totalOutflow).toBeGreaterThan(parcel.acquiredPrice);
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

  it("acquisition tax on land is 4.6% of acquisition price", () => {
    const acqLand = taxes.lines.find((l) => l.tax === "취득세" && l.base === "토지");
    expect(acqLand).toBeDefined();
    expect(acqLand!.amount).toBeCloseTo(parcel.acquiredPrice * 0.046, -1);
  });

  it("corporate tax scales with profit", () => {
    const corp = taxes.lines.find((l) => l.tax === "법인세")!;
    expect(corp.amount).toBeCloseTo(result.profit * 0.20, -1);
  });

  it("total is the sum of lines", () => {
    const sum = taxes.lines.reduce((s, l) => s + l.amount, 0);
    expect(taxes.total).toBe(sum);
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

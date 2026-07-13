import type {
  FloorProgram,
  FloorUseType,
  PlanningScenario,
  PlanningScenarioCalculation,
} from "@/lib/planning/types";

export type ScenarioDiffCategory =
  | "program"
  | "massing"
  | "parking"
  | "economics"
  | "risk";

export type ScenarioDiffUnit =
  | "count"
  | "sqm"
  | "pct"
  | "pct-point"
  | "manwon"
  | "meters"
  | "degrees"
  | "text";

export type ScenarioDiffImpact = "positive" | "negative" | "neutral" | "review";

export interface ScenarioDiffItem {
  code: string;
  category: ScenarioDiffCategory;
  label: string;
  beforeValue: number | string;
  afterValue: number | string;
  deltaValue?: number;
  unit: ScenarioDiffUnit;
  impact: ScenarioDiffImpact;
  detail?: string;
}

export interface ScenarioDiffResult {
  baseScenarioId: string;
  targetScenarioId: string;
  items: ScenarioDiffItem[];
  summary: {
    residentialUnitDelta: number;
    commercialUnitDelta: number;
    farPctPointDelta: number;
    parkingShortfallDelta: number;
    totalCostDeltaManwon: number;
    profitDeltaManwon: number;
    failCheckDelta: number;
  };
}

const USE_LABEL: Record<FloorUseType, string> = {
  residential: "주거",
  retail: "상가",
  office: "업무",
  parking: "주차",
  piloti: "필로티",
  common: "공용",
  mechanical: "기계실",
  storage: "창고",
  other: "기타",
};

const CATEGORY_ORDER: Record<ScenarioDiffCategory, number> = {
  program: 0,
  massing: 1,
  parking: 2,
  economics: 3,
  risk: 4,
};

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function numericImpact(
  delta: number,
  positiveWhenIncrease: boolean | null
): ScenarioDiffImpact {
  if (Math.abs(delta) < 1e-9 || positiveWhenIncrease == null) return "neutral";
  const positive = positiveWhenIncrease ? delta > 0 : delta < 0;
  return positive ? "positive" : "negative";
}

function addNumericDiff(
  items: ScenarioDiffItem[],
  input: {
    code: string;
    category: ScenarioDiffCategory;
    label: string;
    before: number;
    after: number;
    unit: Exclude<ScenarioDiffUnit, "text">;
    tolerance?: number;
    digits?: number;
    positiveWhenIncrease?: boolean | null;
    detail?: string;
  }
): void {
  const tolerance = input.tolerance ?? 0.0001;
  const delta = input.after - input.before;
  if (Math.abs(delta) <= tolerance) return;
  const digits = input.digits ?? 1;
  items.push({
    code: input.code,
    category: input.category,
    label: input.label,
    beforeValue: round(input.before, digits),
    afterValue: round(input.after, digits),
    deltaValue: round(delta, digits),
    unit: input.unit,
    impact: numericImpact(delta, input.positiveWhenIncrease ?? null),
    detail: input.detail,
  });
}

function addTextDiff(
  items: ScenarioDiffItem[],
  input: {
    code: string;
    category: ScenarioDiffCategory;
    label: string;
    before: string;
    after: string;
    impact?: ScenarioDiffImpact;
    detail?: string;
  }
): void {
  if (input.before === input.after) return;
  items.push({
    code: input.code,
    category: input.category,
    label: input.label,
    beforeValue: input.before,
    afterValue: input.after,
    unit: "text",
    impact: input.impact ?? "neutral",
    detail: input.detail,
  });
}

function floorLabel(level: number): string {
  return level < 0 ? `B${Math.abs(level)}` : `${level}층`;
}

function floorProgramSummary(floor: FloorProgram): string {
  const zones = floor.zones
    .filter((zone) => zone.areaSqm > 0 || zone.unitCount > 0)
    .map((zone) => {
      const count = zone.unitCount > 0
        ? ` · ${zone.unitCount}${zone.useType === "residential" ? "세대" : "실"}`
        : "";
      return `${USE_LABEL[zone.useType]} ${round(zone.areaSqm, 1)}㎡${count}`;
    });
  return zones.length > 0 ? zones.join(" + ") : "프로그램 없음";
}

function floorMap(scenario: PlanningScenario): Map<number, FloorProgram> {
  return new Map(scenario.floorPrograms.map((floor) => [floor.level, floor]));
}

function countChecks(
  calculation: PlanningScenarioCalculation,
  statuses: Array<"fail" | "review" | "unknown">
): number {
  return calculation.checks.filter((check) => statuses.includes(check.status as "fail" | "review" | "unknown")).length;
}

export function diffPlanningScenarios(
  baseScenario: PlanningScenario,
  targetScenario: PlanningScenario,
  baseCalculation: PlanningScenarioCalculation,
  targetCalculation: PlanningScenarioCalculation
): ScenarioDiffResult {
  const items: ScenarioDiffItem[] = [];
  const baseMetrics = baseCalculation.metrics;
  const targetMetrics = targetCalculation.metrics;
  const baseEconomics = baseCalculation.economicsPreview;
  const targetEconomics = targetCalculation.economicsPreview;

  addTextDiff(items, {
    code: "primary-use",
    category: "program",
    label: "대표 용도",
    before: baseScenario.primaryUse,
    after: targetScenario.primaryUse,
  });
  addNumericDiff(items, {
    code: "above-ground-floors",
    category: "program",
    label: "지상 층수",
    before: baseMetrics.aboveGroundFloors,
    after: targetMetrics.aboveGroundFloors,
    unit: "count",
    digits: 0,
  });
  addNumericDiff(items, {
    code: "underground-floors",
    category: "program",
    label: "지하 층수",
    before: baseMetrics.undergroundFloors,
    after: targetMetrics.undergroundFloors,
    unit: "count",
    digits: 0,
  });
  addNumericDiff(items, {
    code: "residential-units",
    category: "program",
    label: "주거 세대수",
    before: baseMetrics.residentialUnitCount,
    after: targetMetrics.residentialUnitCount,
    unit: "count",
    digits: 0,
  });
  addNumericDiff(items, {
    code: "commercial-units",
    category: "program",
    label: "상가·업무 호실수",
    before: baseMetrics.commercialUnitCount,
    after: targetMetrics.commercialUnitCount,
    unit: "count",
    digits: 0,
  });
  addNumericDiff(items, {
    code: "construction-area",
    category: "program",
    label: "전체 공사면적",
    before: baseMetrics.constructionAreaSqm,
    after: targetMetrics.constructionAreaSqm,
    unit: "sqm",
  });
  addNumericDiff(items, {
    code: "residential-area",
    category: "program",
    label: "주거 면적",
    before: baseMetrics.residentialAreaSqm,
    after: targetMetrics.residentialAreaSqm,
    unit: "sqm",
  });
  addNumericDiff(items, {
    code: "commercial-area",
    category: "program",
    label: "상가·업무 면적",
    before: baseMetrics.commercialAreaSqm,
    after: targetMetrics.commercialAreaSqm,
    unit: "sqm",
  });
  addNumericDiff(items, {
    code: "far",
    category: "massing",
    label: "예비 용적률",
    before: baseMetrics.preliminaryFarPct,
    after: targetMetrics.preliminaryFarPct,
    unit: "pct-point",
  });
  addNumericDiff(items, {
    code: "bcr",
    category: "massing",
    label: "예비 건폐율",
    before: baseMetrics.preliminaryBcrPct,
    after: targetMetrics.preliminaryBcrPct,
    unit: "pct-point",
  });
  addNumericDiff(items, {
    code: "height",
    category: "massing",
    label: "계획 높이",
    before: baseMetrics.totalHeightM,
    after: targetMetrics.totalHeightM,
    unit: "meters",
  });
  addNumericDiff(items, {
    code: "placement-rotation",
    category: "massing",
    label: "건물 회전각",
    before: baseScenario.placement.rotationDeg,
    after: targetScenario.placement.rotationDeg,
    unit: "degrees",
  });
  addNumericDiff(items, {
    code: "placement-north-setback",
    category: "massing",
    label: "계획안 북측 이격",
    before: baseScenario.placement.northSetbackM,
    after: targetScenario.placement.northSetbackM,
    unit: "meters",
  });

  const baseFloors = floorMap(baseScenario);
  const targetFloors = floorMap(targetScenario);
  const levels = [...new Set([...baseFloors.keys(), ...targetFloors.keys()])].sort((a, b) => b - a);
  for (const level of levels) {
    const before = baseFloors.get(level);
    const after = targetFloors.get(level);
    const label = floorLabel(level);
    if (!before && after) {
      addTextDiff(items, {
        code: `floor-${level}-added`,
        category: "program",
        label: `${label} 추가`,
        before: "없음",
        after: floorProgramSummary(after),
        impact: "review",
      });
      continue;
    }
    if (before && !after) {
      addTextDiff(items, {
        code: `floor-${level}-removed`,
        category: "program",
        label: `${label} 삭제`,
        before: floorProgramSummary(before),
        after: "없음",
        impact: "review",
      });
      continue;
    }
    if (!before || !after) continue;
    addTextDiff(items, {
      code: `floor-${level}-program`,
      category: "program",
      label: `${label} 프로그램`,
      before: floorProgramSummary(before),
      after: floorProgramSummary(after),
    });
    addNumericDiff(items, {
      code: `floor-${level}-height`,
      category: "massing",
      label: `${label} 층고`,
      before: before.floorHeightM,
      after: after.floorHeightM,
      unit: "meters",
    });
    addNumericDiff(items, {
      code: `floor-${level}-scale`,
      category: "massing",
      label: `${label} 외곽선 비율`,
      before: before.footprintScalePct,
      after: after.footprintScalePct,
      unit: "pct-point",
    });
    addNumericDiff(items, {
      code: `floor-${level}-north-setback`,
      category: "massing",
      label: `${label} 북측 후퇴`,
      before: before.northSetbackM,
      after: after.northSetbackM,
      unit: "meters",
    });
  }

  addTextDiff(items, {
    code: "parking-strategy",
    category: "parking",
    label: "주차 방식",
    before: baseScenario.parking.strategy,
    after: targetScenario.parking.strategy,
  });
  addNumericDiff(items, {
    code: "parking-required",
    category: "parking",
    label: "예상 의무주차",
    before: baseMetrics.requiredCars,
    after: targetMetrics.requiredCars,
    unit: "count",
    digits: 0,
  });
  addNumericDiff(items, {
    code: "parking-provided",
    category: "parking",
    label: "계획 주차",
    before: baseMetrics.providedCars,
    after: targetMetrics.providedCars,
    unit: "count",
    digits: 0,
    positiveWhenIncrease: true,
  });
  addNumericDiff(items, {
    code: "parking-shortfall",
    category: "parking",
    label: "주차 부족",
    before: baseMetrics.parkingShortfallCars,
    after: targetMetrics.parkingShortfallCars,
    unit: "count",
    digits: 0,
    positiveWhenIncrease: false,
  });

  addNumericDiff(items, {
    code: "expected-revenue",
    category: "economics",
    label: "예상 매출·가치",
    before: baseEconomics.expectedRevenueManwon,
    after: targetEconomics.expectedRevenueManwon,
    unit: "manwon",
    positiveWhenIncrease: true,
  });
  addNumericDiff(items, {
    code: "total-cost",
    category: "economics",
    label: "총사업비",
    before: baseEconomics.totalCostManwon,
    after: targetEconomics.totalCostManwon,
    unit: "manwon",
    positiveWhenIncrease: false,
  });
  addNumericDiff(items, {
    code: "construction-cost",
    category: "economics",
    label: "공사비",
    before: baseEconomics.constructionCostManwon,
    after: targetEconomics.constructionCostManwon,
    unit: "manwon",
    positiveWhenIncrease: false,
  });
  addNumericDiff(items, {
    code: "profit",
    category: "economics",
    label: "예상 이익",
    before: baseEconomics.profitManwon,
    after: targetEconomics.profitManwon,
    unit: "manwon",
    positiveWhenIncrease: true,
  });
  addNumericDiff(items, {
    code: "profit-margin",
    category: "economics",
    label: "예상 이익률",
    before: baseEconomics.profitMarginPct,
    after: targetEconomics.profitMarginPct,
    unit: "pct-point",
    positiveWhenIncrease: true,
  });
  addNumericDiff(items, {
    code: "annual-noi",
    category: "economics",
    label: "연간 NOI",
    before: baseEconomics.expectedAnnualNoiManwon,
    after: targetEconomics.expectedAnnualNoiManwon,
    unit: "manwon",
    positiveWhenIncrease: true,
  });

  const baseFail = countChecks(baseCalculation, ["fail"]);
  const targetFail = countChecks(targetCalculation, ["fail"]);
  const baseReview = countChecks(baseCalculation, ["review", "unknown"]);
  const targetReview = countChecks(targetCalculation, ["review", "unknown"]);
  addNumericDiff(items, {
    code: "failed-checks",
    category: "risk",
    label: "미충족 점검",
    before: baseFail,
    after: targetFail,
    unit: "count",
    digits: 0,
    positiveWhenIncrease: false,
  });
  addNumericDiff(items, {
    code: "review-checks",
    category: "risk",
    label: "추가 확인 항목",
    before: baseReview,
    after: targetReview,
    unit: "count",
    digits: 0,
    positiveWhenIncrease: false,
  });

  items.sort((a, b) => {
    const categoryDelta = CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category];
    return categoryDelta !== 0 ? categoryDelta : a.label.localeCompare(b.label, "ko");
  });

  return {
    baseScenarioId: baseScenario.id,
    targetScenarioId: targetScenario.id,
    items,
    summary: {
      residentialUnitDelta:
        targetMetrics.residentialUnitCount - baseMetrics.residentialUnitCount,
      commercialUnitDelta:
        targetMetrics.commercialUnitCount - baseMetrics.commercialUnitCount,
      farPctPointDelta: round(
        targetMetrics.preliminaryFarPct - baseMetrics.preliminaryFarPct,
        1
      ),
      parkingShortfallDelta:
        targetMetrics.parkingShortfallCars - baseMetrics.parkingShortfallCars,
      totalCostDeltaManwon: round(
        targetEconomics.totalCostManwon - baseEconomics.totalCostManwon,
        1
      ),
      profitDeltaManwon: round(
        targetEconomics.profitManwon - baseEconomics.profitManwon,
        1
      ),
      failCheckDelta: targetFail - baseFail,
    },
  };
}

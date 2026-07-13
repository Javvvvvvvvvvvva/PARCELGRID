export type PlanningScenarioOrigin =
  | "algorithm-safe"
  | "algorithm-balanced"
  | "algorithm-max"
  | "custom"
  | "legacy";

export type PlanningScenarioStatus = "draft" | "saved" | "archived";

export type FloorUseType =
  | "residential"
  | "retail"
  | "office"
  | "parking"
  | "piloti"
  | "common"
  | "mechanical"
  | "storage"
  | "other";

export interface FloorZone {
  id: string;
  useType: FloorUseType;
  label?: string;
  areaSqm: number;
  unitCount: number;
  rentableAreaSqm?: number;
  saleableAreaSqm?: number;
}

export interface FloorProgram {
  id: string;
  /** 지상 1층은 1, 지하 1층은 -1 */
  level: number;
  label: string;
  floorHeightM: number;
  /** 기준 외곽선 대비 해당 층의 전체 축소 비율 */
  footprintScalePct: number;
  /** 북측 방향 후퇴량. 실제 법규 판정은 별도 엔진에서 수행한다. */
  northSetbackM: number;
  zones: FloorZone[];
}

export type ParkingStrategy =
  | "none"
  | "surface"
  | "piloti"
  | "basement"
  | "mechanical"
  | "mixed";

export interface PlanningPlacement {
  rotationDeg: number;
  offsetXM: number;
  offsetZM: number;
  roadSetbackM: number;
  northSetbackM: number;
}

export interface PlanningParking {
  strategy: ParkingStrategy;
  providedCars: number;
  notes?: string;
}

export type PlanningCheckStatus = "pass" | "review" | "fail" | "unknown";

export interface PlanningCheck {
  code: string;
  label: string;
  status: PlanningCheckStatus;
  message: string;
  source?: string;
}

/**
 * Stage 2에서 보여주는 개략 사업성 미리보기.
 * 금융·세금·공정·민감도까지 포함한 최종 사업성은 Stage 3에서 계산한다.
 */
export interface PlanningEconomicsPreview {
  status: "not-calculated" | "estimated" | "stale";
  acquisitionCostManwon: number;
  constructionCostManwon: number;
  softCostManwon: number;
  financingCostManwon: number;
  totalCostManwon: number;
  expectedRevenueManwon: number;
  expectedAnnualNoiManwon: number;
  profitManwon: number;
  profitMarginPct: number;
  assumptionsVersion?: string;
  calculatedAt?: string;
}

export interface PlanningScenario {
  id: string;
  name: string;
  description?: string;
  origin: PlanningScenarioOrigin;
  status: PlanningScenarioStatus;
  baseScenarioId?: string;
  version: number;
  createdAt: string;
  updatedAt: string;

  /** 계획안의 대표 용도. 실제 구성은 floorPrograms[].zones[]가 기준이다. */
  primaryUse: "single-house" | "multi-family" | "retail" | "mixed" | "office";
  floorPrograms: FloorProgram[];
  placement: PlanningPlacement;
  parking: PlanningParking;
  checks: PlanningCheck[];
  economicsPreview: PlanningEconomicsPreview;
}

export interface PlanningScenarioSummary {
  aboveGroundFloors: number;
  undergroundFloors: number;
  totalProgramAreaSqm: number;
  gradeFootprintAreaSqm: number;
  residentialAreaSqm: number;
  commercialAreaSqm: number;
  parkingAreaSqm: number;
  commonAreaSqm: number;
  unitCount: number;
  providedCars: number;
}

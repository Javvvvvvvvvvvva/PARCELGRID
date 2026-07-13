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

export type PlanningRevenueModel = "sale" | "lease" | "non-revenue";

export interface FloorZone {
  id: string;
  useType: FloorUseType;
  label?: string;
  areaSqm: number;
  unitCount: number;
  /**
   * Stage 2 개략 사업성의 수익 방식.
   * 값이 없는 과거 데이터는 용도별 기본값을 사용한다.
   */
  revenueModel?: PlanningRevenueModel;
  /** 실제 매각 산정 면적. 없으면 revenueModel=sale인 구역의 전체 면적을 사용한다. */
  saleableAreaSqm?: number;
  /** 실제 임대 산정 면적. 없으면 revenueModel=lease인 구역의 전체 면적을 사용한다. */
  rentableAreaSqm?: number;
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
 * Stage 2 개략 사업성 계산에 사용하는 명시적 가정.
 * 모든 금액 단가는 원 단위이며 결과는 만원 단위로 반환한다.
 */
export interface PlanningEconomicsAssumptions {
  version: string;
  constructionCostPerSqmWon: number;
  /** 지하층 공사비 가중치. 예: 1.25 = 지상 기준의 125%. */
  basementCostMultiplier: number;
  softCostRatePct: number;
  contingencyRatePct: number;
  /** Stage 2용 개략 금융비율. 상세 PF 이자는 Stage 3에서 계산한다. */
  financingCostRatePct: number;
  residentialSalePricePerSqmWon: number;
  commercialSalePricePerSqmWon: number;
  residentialRentPerSqmMonthWon: number;
  retailRentPerSqmMonthWon: number;
  officeRentPerSqmMonthWon: number;
  vacancyRatePct: number;
  capRatePct: number;
}

/**
 * Stage 2에서 보여주는 개략 사업성 미리보기.
 * 금융·세금·공정·민감도까지 포함한 최종 사업성은 Stage 3에서 계산한다.
 */
export interface PlanningEconomicsPreview {
  status: "not-calculated" | "estimated" | "stale";
  acquisitionCostManwon: number;
  demolitionCostManwon: number;
  constructionCostManwon: number;
  softCostManwon: number;
  contingencyCostManwon: number;
  financingCostManwon: number;
  totalCostManwon: number;
  saleRevenueManwon: number;
  capitalizedLeaseValueManwon: number;
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
  saleableAreaSqm: number;
  rentableAreaSqm: number;
  residentialUnitCount: number;
  commercialUnitCount: number;
  totalUnitCount: number;
  /** 기존 화면 호환용 주거 세대수 alias. */
  unitCount: number;
  providedCars: number;
}

export interface PlanningCalculationParcel {
  lotAreaSqm: number;
  maxFARPct: number;
  maxBCRPct: number;
  heightLimitM: number;
  acquisitionCostManwon: number;
  demolitionCostManwon: number;
}

export interface PlanningParkingAssessment {
  requiredCars: number;
  providedCars: number;
  shortfallCars: number;
  estimatedCapacityFromProgram: number | null;
  estimated: boolean;
  exemptPossible: boolean;
  basis: string[];
  reference: string[];
}

export interface PlanningScenarioMetrics extends PlanningScenarioSummary {
  constructionAreaSqm: number;
  aboveGroundProgramAreaSqm: number;
  basementProgramAreaSqm: number;
  /** 지상 주차·필로티를 제외한 예비 용적률 산입면적. 최종 법적 산입면적은 별도 확인. */
  preliminaryFarAreaSqm: number;
  preliminaryBcrPct: number;
  preliminaryFarPct: number;
  totalHeightM: number;
  requiredCars: number;
  parkingShortfallCars: number;
}

export interface PlanningScenarioCalculation {
  scenarioId: string;
  metrics: PlanningScenarioMetrics;
  parking: PlanningParkingAssessment;
  checks: PlanningCheck[];
  economicsPreview: PlanningEconomicsPreview;
}

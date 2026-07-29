import type { RegulatoryConstraintSet } from "@/lib/regulatory/constraints";

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

export type ParkingOrientation =
  | "auto"
  | "parallel-front"
  | "perpendicular-front";

export interface PlanningPlacement {
  rotationDeg: number;
  offsetXM: number;
  offsetZM: number;
  roadSetbackM: number;
  northSetbackM: number;
}

export interface PlanningParking {
  strategy: ParkingStrategy;
  /** 사용자가 저장한 계획 주차대수. 실제 배치 엔진 결과와 비교한다. */
  providedCars: number;
  notes?: string;
  /** Stage 2 주차면 자동 배치 방향. */
  orientation?: ParkingOrientation;
  /** 예비 주차면 폭·길이와 통로 폭. 관할 기준에 따라 조정 가능하다. */
  stallWidthM?: number;
  stallDepthM?: number;
  aisleWidthM?: number;
  entryWidthM?: number;
  /** 필로티 내부 계단·엘리베이터·로비 등 주차 불가 코어 면적. */
  coreAreaSqm?: number;
  /** 기둥과 구조 여유로 감소하는 개략 주차 효율. */
  columnLossPct?: number;
}

export type PlanningFacadeMaterial =
  | "unselected"
  | "standard-render"
  | "brick-veneer"
  | "exposed-concrete"
  | "metal-panel";

export type PlanningMaterialEvidenceStatus =
  | "unpriced"
  | "user-input"
  | "source-backed";

export interface PlanningMaterialRateEvidence {
  status: PlanningMaterialEvidenceStatus;
  sourceName?: string;
  sourceUrl?: string;
  observedAt?: string;
  note?: string;
}

/**
 * 외장 선택과 비용 근거를 함께 보존한다.
 * 단가가 없는 재료 선택은 3D 표현에만 사용하고 사업비에는 반영하지 않는다.
 */
export interface PlanningMaterialSelection {
  primaryFacadeMaterial: PlanningFacadeMaterial;
  secondaryFacadeMaterial: PlanningFacadeMaterial;
  primaryFacadeSharePct: number;
  windowRatioPct: number;
  /** 실제 외벽 순면적을 확인한 경우에만 입력한다. */
  facadeAreaOverrideSqm?: number;
  /** 기존 총공사비에 포함된 기준 외벽 마감 단가. */
  baselineFacadeUnitCostPerSqmWon?: number;
  /** 선택한 외벽 사양의 설치 단가. */
  selectedFacadeUnitCostPerSqmWon?: number;
  rateEvidence?: PlanningMaterialRateEvidence;
}

export type PlanningCheckStatus = "pass" | "review" | "fail" | "unknown";

export interface PlanningCheck {
  code: string;
  label: string;
  status: PlanningCheckStatus;
  message: string;
  source?: string;
}

export type PlanningRecommendationObjective =
  | "architectural-feasibility"
  | "profit"
  | "legal-ceiling";

export type PlanningRecommendationProfitMode =
  | "profit-maximization"
  | "loss-minimization"
  | "break-even";

export interface PlanningRecommendationRejectionReason {
  code: string;
  label: string;
  count: number;
}

/**
 * 추천안이 어떤 후보군과 기준으로 선정됐는지 보존한다.
 * 추천점수와 수익은 결합하지 않고 별도 지표로 유지한다.
 */
export interface PlanningRecommendationMetadata {
  engineVersion: string;
  objective: PlanningRecommendationObjective;
  generatedAt: string;
  evaluatedCandidates: number;
  eligibleCandidates: number;
  architectureScore: number;
  eligible: boolean;
  reasons: string[];
  warnings: string[];
  /** 슬롯별 ID가 달라도 동일한 물리·프로그램 후보인지 확인하는 키. */
  candidateKey?: string;
  /** 동일 후보가 다른 선정 기준에서도 1위인 경우 보존한다. */
  alsoSelectedFor?: PlanningRecommendationObjective[];
  /** 수익 기준 1위가 실제 이익 최대인지, 적자 후보 중 손실 최소인지 구분한다. */
  profitSelectionMode?: PlanningRecommendationProfitMode;
  /** 전체 후보 중 실행 가능 조건을 통과하지 못한 후보 수. */
  rejectedCandidates?: number;
  /** 후보별 복수 원인이 포함될 수 있는 탈락 원인 집계. */
  rejectionReasons?: PlanningRecommendationRejectionReason[];
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
  /** 재료 증감 전 기본 공사비. 구버전 저장값에는 없을 수 있다. */
  baseConstructionCostManwon?: number;
  /** 기준 외벽 단가 대비 선택 사양 증감액. */
  materialAdjustmentCostManwon?: number;
  /** 재료비 계산에 사용한 외벽 순면적. */
  facadeAreaSqm?: number;
  /** 외벽 면적·단가의 근거 상태. */
  materialCostStatus?: PlanningMaterialEvidenceStatus | "estimated";
  materialCostSource?: string;
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
  /** 브라우저에 여러 프로젝트가 공존할 때 계획안이 섞이지 않도록 하는 프로젝트 키. */
  projectId?: string;
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
  /** 기존 저장 계획안은 값이 없을 수 있으며 미선택 계획 매스로 처리한다. */
  materials?: PlanningMaterialSelection;
  checks: PlanningCheck[];
  economicsPreview: PlanningEconomicsPreview;
  recommendation?: PlanningRecommendationMetadata;
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
  /** Legacy value. It must not create a legal pass unless provenance is decision-grade. */
  heightLimitM: number;
  regulatoryConstraints?: RegulatoryConstraintSet;
  /** Explicit planning allowance above occupied floor-to-floor heights. */
  roofAllowanceM?: number;
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
  /** Sum of above-ground floor-to-floor heights. */
  occupiedFloorHeightM: number;
  /** Parapet, roof build-up and equipment headroom planning allowance. */
  roofAllowanceM: number;
  /** occupiedFloorHeightM + roofAllowanceM. */
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

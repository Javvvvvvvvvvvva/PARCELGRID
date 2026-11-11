import type { BuildingLookupResult } from "@/lib/integrations/molit-building";
import type { Wgs84ParcelPolygon } from "@/lib/geo/parcel-topology";
import type { RegulatoryConstraintSet } from "@/lib/regulatory/constraints";
import type {
  ParkingRequirementComponent,
  ParkingRuleSnapshot,
} from "@/lib/regulatory/parking-rules";
import type { SunlightRegulationResult } from "@/lib/regulatory/sunlight-rules";
import type { ZoningUseScreeningResult } from "@/lib/regulatory/zoning-use-screening";
import type { TakeoutUnderwritingResult } from "@/lib/finance/takeout-underwriting";
import type { HoldPeriodLedgerResult } from "@/lib/finance/hold-period-ledger";
import type { QuantityCostContract } from "@/lib/planning/quantity-cost-contract";
/**
 * Core domain types for the PARCELGRID financial engine.
 *
 * All monetary values are stored as 만원 (10,000 KRW) internally to match
 * Korean real estate convention. Use Decimal for any intermediate math
 * to avoid floating-point error accumulation.
 *
 * Display layer converts to 억/만 via the formatter in `src/lib/utils/format.ts`.
 */

export type ManWon = number; // 만원, integer-ish but allow fractions during calc
export type Won = number; // 원
export type SqM = number; // m²
export type Pct = number; // percent, e.g. 18.4 means 18.4%
export type Months = number;

// ─────────────────────────── Parcel ───────────────────────────

export type AcquisitionEstimateMethod =
  | "house-comps"
  | "by-comps"
  | "by-publicvalue"
  | "hybrid";

export interface AcquisitionEstimateSnapshot {
  /** 자체 보정 모델 버전. 없으면 구버전 저장 데이터. */
  modelVersion?: string;
  /** 외부 감정평가로 검증되지 않은 참고 추정 상태. */
  modelStatus?: "experimental-unvalidated";
  warnings?: string[];
  estimatedPriceManwon: ManWon;
  estimatedPricePerPyeong: number;
  method: AcquisitionEstimateMethod;
  confidence: "high" | "medium" | "low";
  marketMedianPerPyeong?: number;
  marketMedianManwon?: ManWon;
  /** Active 구축 단독·다가구 proxy evidence, separate from the land distribution. */
  houseProxy?: {
    sampleSize: number;
    medianPricePerPyeong: number;
    estimatedPriceManwon: ManWon;
    basis: string;
  };
  transactionCount?: number;
  transactionEvidence?: import("@/lib/integrations/molit-evidence").MolitRangeEvidence[];
  details?: {
    fromPublicValue: ManWon;
    fromComps: ManWon;
    locationMultiplier: number;
    sizeMultiplier: number;
    finalMultiplier: number;
    locationTier: string;
    sampleSize: number;
    medianPricePerPyeong: number;
  };
}

export interface ParcelInputProvenance {
  mode: "vworld" | "manual";
  parcelFacts: "vworld-cadastral" | "user-entered";
  geometry: "vworld-cadastral" | "user-geojson" | "unavailable";
  zoning: "vworld-land-use" | "user-entered";
  recordedAt: string;
  note?: string;
}

export interface Parcel {
  id: string;
  address: string;
  addressRoad: string;
  lat?: number;
  lng?: number;

  // Geometry
  lotArea: SqM;
  /** Legacy simple outer ring only. Complex topology must use an empty boundary, never a partial outer ring. */
  boundary?: [number, number][];
  /** Authoritative WGS84 topology, including every component and hole. Does not establish official approval. */
  boundaryPolygons?: Wgs84ParcelPolygon[];
  /** 부지 주변 도로 중심선 — 전면 식별용 */
  roads?: { name: string | null; points: [number, number][] }[];

  // Zoning
  zoning: string; // e.g. "제3종일반주거지역"
  zoneCode: string; // e.g. "UB30"
  /**
   * Legacy numeric references used by older candidate generation.
   * The legal decision state lives in regulatoryConstraints.
   */
  maxFAR: Pct;
  maxBCR: Pct;
  /** Legacy field. 0 means no parcel-specific height has been verified. */
  heightLimit: number;
  /** Source, date and verification status for FAR/BCR/height/floor limits. */
  regulatoryConstraints?: RegulatoryConstraintSet;
  /** VWorld NED overlapping zone/district records retained for review. */
  overlays?: Array<{ code: string; name: string; conflict: string }>;
  /** 원문 자동 조회와 사용자 수동 입력을 화면·내보내기에서 구분하기 위한 출처. */
  inputProvenance?: ParcelInputProvenance;

  setback: {
    road: number; // m
    side: number; // m
    rear: number; // m
  };
  /** 기존 건물 정보 (MOLIT 건축물대장, 세대당 면적 산정용) */
  currentBuilding?: BuildingLookupResult | null;

  landPrice: Won; // 공시지가 원/m²
  estMarketPrice: Won; // 실거래 추정 원/m²
  /** 새 부지 등록 시 잠근 토지 시장가 추정 근거. 예전 프로젝트에는 없을 수 있다. */
  acquisitionEstimate?: AcquisitionEstimateSnapshot;

  acquired: string; // ISO date
  /**
   * 부동산 총 취득대금(만원).
   *
   * 토지만의 안분가액이 아니다. 기존 건축물이 있는 거래에서는 계약상
   * 토지·건물 대가를 모두 포함할 수 있다. acquiredPrice는 기존 저장
   * 데이터 호환을 위해 유지하는 legacy 필드명이며, 세금 계산에서 토지
   * 과세표준으로 직접 사용하면 안 된다.
   */
  acquiredPrice: ManWon;
  /** 철거비 (만원). 빈 땅이거나 신축 유지면 0 또는 undefined */
  demolitionCost?: ManWon;
}

// ─────────────────────────── Building program ───────────────────────────

export type BuildingType =
  | "officetel" // 오피스텔
  | "urban-housing" // 도시형생활주택
  | "retail" // 근린생활시설
  | "coliving" // 공유주거
  | "office"
  | "mixed"
  | "single-house" // 단독주택 (신축매매) — 작은 부지 30-80평
  | "multi-family"; // 다가구주택 (신축매매) — 중간 부지 50-150평

export const FINANCIAL_GEOMETRY_CONTRACT_VERSION =
  "stage2-finance-area-2026.2" as const;

export const LEGACY_FINANCIAL_GEOMETRY_CONTRACT_VERSION =
  "stage2-finance-area-2026.1" as const;

export const STAGE2_ECONOMICS_CONTRACT_VERSION =
  "stage2-economics-preview-2026.2" as const;

export type FinancialRevenuePoolKey =
  | "residentialSale"
  | "retailSale"
  | "officeSale"
  | "residentialLease"
  | "retailLease"
  | "officeLease";

export interface FinancialRevenueAreaPools {
  residentialSaleSqm: SqM;
  retailSaleSqm: SqM;
  officeSaleSqm: SqM;
  residentialLeaseSqm: SqM;
  retailLeaseSqm: SqM;
  officeLeaseSqm: SqM;
  /** 2026.1 저장 계약 호환용. 새 계약은 이 필드를 생성하지 않는다. */
  retailSqm?: SqM;
}

export type RevenuePricingSourceStatus =
  | "internal-assumption"
  | "user-input"
  | "source-backed";

export type RevenuePriceSourceField =
  | "residentialSalePricePerSqM"
  | "retailSalePricePerSqM"
  | "officeSalePricePerSqM"
  | "residentialRentPerSqMMonth"
  | "retailRentPerSqMMonth"
  | "officeRentPerSqMMonth";

export type RevenuePriceAdjustmentDimension =
  | "use"
  | "location"
  | "floor"
  | "area"
  | "newBuild";

export type RevenuePriceAdjustmentStatus =
  | "not-applied"
  | "internal-assumption"
  | "user-input"
  | "source-backed";

export interface RevenuePriceAdjustmentSnapshot {
  factor: number;
  status: RevenuePriceAdjustmentStatus;
  sourceName: string;
  sourceRef?: string;
  asOf?: string;
  note?: string;
}

export interface RevenuePoolPricingSnapshot {
  unit: "won-per-sqm" | "won-per-sqm-month";
  /** 보정 전 비교사례·감정·사용자 기준 단가. 2026.2 저장본에는 없을 수 있다. */
  baseUnitPriceWon?: Won;
  unitPriceWon: Won;
  sourceField:
    | "salePricePerSqM"
    | "rentPerSqMMonth"
    | RevenuePriceSourceField;
  sourceStatus: RevenuePricingSourceStatus;
  sourceName: string;
  sourceRef?: string;
  asOf?: string;
  /** 다섯 보정축 곱. 2026.2 호환 필드이기도 하다. */
  adjustmentFactor: number;
  /** 2026.3부터 용도·입지·층·면적·신축 보정을 각각 보존한다. */
  adjustments?: Record<
    RevenuePriceAdjustmentDimension,
    RevenuePriceAdjustmentSnapshot
  >;
}

export interface FinancialRevenuePricingSnapshot {
  modelVersion: "revenue-pricing-2026.2" | "revenue-pricing-2026.3";
  assumptionsVersion?: string;
  pools: Record<FinancialRevenuePoolKey, RevenuePoolPricingSnapshot>;
  vacancyRatePct: Pct;
  /** 유효총수입 대비 소유자 부담 운영비율. */
  operatingExpenseRatePct: Pct;
  capRatePct: Pct;
  stabilizationFactorPct: Pct;
}

export type FinancialRevenuePoolAmounts = Record<
  FinancialRevenuePoolKey,
  ManWon
>;

export interface FinancialRevenueProjectionSnapshot {
  modelVersion: "revenue-valuation-2026.2";
  areas: FinancialRevenueAreaPools;
  pricing: FinancialRevenuePricingSnapshot;
  valueByPoolManwon: FinancialRevenuePoolAmounts;
  annualPotentialRentByPoolManwon: FinancialRevenuePoolAmounts;
  annualEffectiveGrossIncomeByPoolManwon: FinancialRevenuePoolAmounts;
  annualOperatingExpenseByPoolManwon: FinancialRevenuePoolAmounts;
  annualNoiByPoolManwon: FinancialRevenuePoolAmounts;
  saleRevenueManwon: ManWon;
  capitalizedLeaseValueManwon: ManWon;
  totalRevenueManwon: ManWon;
  annualNoiManwon: ManWon;
}

export interface Stage2EconomicsSnapshot {
  modelVersion: typeof STAGE2_ECONOMICS_CONTRACT_VERSION;
  assumptionsVersion?: string;
  inputs: {
    constructionCostPerSqmWon: Won;
    basementCostMultiplier: number;
    softCostRatePct: Pct;
    contingencyRatePct: Pct;
    financingCostRatePct: Pct;
    acquisitionTaxManwon: ManWon;
    acquisitionOtherCostManwon: ManWon;
    tenantRelocationCostManwon: ManWon;
    pfUpfrontFeeRatePct: Pct;
    trustFeeManwon: ManWon;
    ltcTargetPct: Pct;
  };
  acquisitionCostManwon: ManWon;
  acquisitionTaxManwon: ManWon;
  acquisitionOtherCostManwon: ManWon;
  demolitionCostManwon: ManWon;
  tenantRelocationCostManwon: ManWon;
  hardCostManwon: ManWon;
  softCostManwon: ManWon;
  contingencyCostManwon: ManWon;
  interestEstimateManwon: ManWon;
  pfFeeManwon: ManWon;
  trustFeeManwon: ManWon;
  financingCostManwon: ManWon;
  totalCostManwon: ManWon;
  totalRevenueManwon: ManWon;
  profitManwon: ManWon;
}

/**
 * Stage 2에서 확정한 실제 면적을 Stage 3가 재생성하지 않고 소비하기 위한 계약.
 *
 * 이 값이 있으면 FAR/BCR은 설명·법규 검토용 지표로만 사용한다. 공사비와
 * 매출은 아래 실제 면적을 기준으로 계산하며, 과거 저장 데이터만 legacy
 * FAR/BCR 계산으로 되돌아간다.
 */
export interface FinancialGeometryAreaContract {
  schemaVersion:
    | typeof FINANCIAL_GEOMETRY_CONTRACT_VERSION
    | typeof LEGACY_FINANCIAL_GEOMETRY_CONTRACT_VERSION;
  source: "stage2-planning";
  sourceScenarioId: string;
  sourceScenarioVersion: number;
  constructionAreaSqm: SqM;
  aboveGroundAreaSqm: SqM;
  basementAreaSqm: SqM;
  farAreaSqm: SqM;
  gradeFootprintAreaSqm: SqM;
  parkingAreaSqm: SqM;
  commonAreaSqm: SqM;
  saleableAreaSqm: SqM;
  rentableAreaSqm: SqM;
  revenueAreas: FinancialRevenueAreaPools;
  /** Stage 2 계산 당시 풀별 단가·근거 상태와 매출. Stage 3 대사용이다. */
  revenueProjection?: FinancialRevenueProjectionSnapshot;
  /** Stage 2 개략 비용과 Stage 3 월별 원장의 항목별 차이를 설명하기 위한 잠금값. */
  stage2Economics?: Stage2EconomicsSnapshot;
  providedParkingSpaces: number;
  requiredParkingSpaces: number;
  /** Stage 2에서 사용한 주차 규칙과 입력 신뢰도를 Stage 3에 그대로 전달한다. */
  parkingRequirement?: {
    rule: ParkingRuleSnapshot;
    decisionGrade: boolean;
    estimated: boolean;
    components: ParkingRequirementComponent[];
    basis: string[];
    warnings: string[];
  };
  /** Stage 2에서 사용한 일조·채광 규칙, 예외와 입력 신뢰도. */
  sunlightAssessment?: SunlightRegulationResult;
  materialAdjustmentCostManwon: ManWon;
  /** Adopted whole-construction quote; replaces every legacy hard-cost component. */
  fullQuoteCost?: import("@/lib/planning/full-quote-cost-contract").FullQuoteCostContract;
  /** 상세 수량 대체 원가와 기본 공사비 포함액의 반올림 전 계약. */
  quantityCostAdjustment?: QuantityCostContract;
  dwellingCostAdjustment?: {
    unitCount: number;
    baselineDwellingCount: number;
    costPerAdditionalUnitWon: Won;
    costManwon: ManWon;
    evidenceStatus: "assumed" | "user-input" | "quoted";
    source?: string;
  };
  facadeCost?: import("@/lib/planning/materials").PlanningMaterialCostAdjustment;
  planningAssumptionsVersion?: string;
  geometrySource?: {
    mode: "engine-generated" | "external-model" | "reference-image";
    exactGeometryAvailable: boolean;
    locked: boolean;
    geometryHash?: string;
    verificationVersion?: string;
  };
}

export interface BuildingProgram {
  type: BuildingType;
  far: Pct; // planned 용적률
  bcr: Pct; // planned 건폐율
  floorsAbove: number;
  floorsBelow: number;
  /** Stage 2에서 확정한 실제 면적 계약. 없으면 구버전 FAR/BCR 계산을 사용한다. */
  areaContract?: FinancialGeometryAreaContract;
  units: {
    residential: number;
    retail: number;
  };
  /**
   * Allocation of GFA across use types. Must sum to 1.0.
   * Drives revenue mix when computing rent vs sale.
   */
  mix: {
    residentialSale: number; // 0..1, sold as units
    residentialLease: number; // 0..1, held for lease
    retail: number; // 0..1, leased
  };
}

// ─────────────────────────── Assumptions ───────────────────────────

/**
 * Every input the financial model can vary. Each value can be a
 * "base" (default from market data) or "override" (user-edited).
 *
 * The audit log records who changed what and when — critical for an
 * investment committee deliverable.
 */
export interface AssumptionSet {
  // Revenue
  rentPerSqMMonth: Won; // 임대료 원/m²/월
  salePricePerSqM: Won; // 분양가 원/m²
  vacancyRate: Pct; // 공실률 %
  operatingExpenseRate: Pct; // 유효총수입 대비 운영비율 %
  capRate: Pct; // Cap rate %

  // Cost
  constCostPerSqM: Won; // 지상 기준 공사비 원/m²
  /** 지하 공사비 가중치. 구버전 값이 없으면 1.25를 사용한다. */
  basementCostMultiplier: number;
  softCostRate: Pct; // 설계/인허가/감리 비율 of hard cost
  contingencyRate: Pct; // 예비비
  /** 취득세 확정 또는 전문가 검토 금액. 0이면 현재 원장에서 제외된다. */
  acquisitionTaxManwon: ManWon;
  /** 중개·법무·등기 등 취득 부대비. 취득세와 분리한다. */
  acquisitionOtherCostManwon: ManWon;
  /** 명도·임차인 정리·이전 보상 예산. */
  tenantRelocationCostManwon: ManWon;

  // Finance
  ltcTarget: Pct; // PF 비율 목표
  interestRate: Pct; // PF 금리
  /** PF 약정·취급 수수료. 계획 PF 한도 대비 비율. */
  pfUpfrontFeeRate: Pct;
  /** 신탁·자금관리 관련 고정 비용. */
  trustFeeManwon: ManWon;
  /** 확인된 자기자본 투입 한도. 0이면 한도 미확인으로 판정한다. */
  equityCommitmentManwon: ManWon;
  /** 장기대출 담보가치 대비 최대 비율. 0이면 조건 미입력. */
  takeoutLtv: Pct;
  /** 장기대출 연 금리. 0이면 조건 미입력. */
  takeoutInterestRate: Pct;
  /** 장기대출 원리금 상환기간. 0이면 조건 미입력. */
  takeoutAmortizationYears: number;
  /** 장기대출 계약 만기. 상환기간보다 짧으면 balloon이 남는다. */
  takeoutLoanTermYears: number;
  /** 최초 원리금 납부유예 기간. 이자는 원금에 가산한다. */
  takeoutPaymentDeferralMonths: Months;
  /** 납부유예 후 이자만 현금 납부하는 기간. */
  takeoutInterestOnlyMonths: Months;
  /** 0이면 고정금리, 양수면 변동금리 재설정 주기. */
  takeoutRateResetMonths: Months;
  /** 변동금리 예상 경로의 연간 절대 변화폭(%p/년). */
  takeoutAnnualRateChange: Pct;
  /** 변동금리 floor. 0이면 별도 floor 없음. */
  takeoutRateFloor: Pct;
  /** 변동금리 cap. 0이면 별도 cap 없음. */
  takeoutRateCap: Pct;
  /** 제한현금으로 적립할 원리금 상환준비금 개월 수. */
  takeoutDsraMonths: Months;
  /** 금융기관의 최소 DSCR 조건. 0이면 조건 미입력. */
  takeoutMinDscr: number;
  /** 확인된 장기대출 확약액. 0이면 확약 미확인. */
  takeoutLoanCommitmentManwon: ManWon;
  /** 장기대출 취급·약정 수수료율. */
  takeoutFeeRate: Pct;
  equityIRR: Pct; // 자본 요구수익률 (for NPV)

  // Operations
  leaseUpMonths: Months; // 임대 안정화 기간
  salesPaceMonthlyPct: Pct; // 분양 속도 (%/월)
  /** 안정화 후 장기 보유기간. 0이면 보유 대안을 계산하지 않는다. */
  holdPeriodYears: number;
  /** 보유기간 연 임대료 성장률. */
  annualRentGrowthRate: Pct;
  /** 보유기간 연 운영비 성장률. */
  annualExpenseGrowthRate: Pct;
  /** 안정화 후 전 자산 기준 초기 무상임대 기간. */
  rentFreeMonths: Months;
  /** 최초 임대 유치를 위한 임차인 공사비. */
  tenantImprovementPerSqM: Won;
  /** 안정화 연 임대료 대비 최초 임대 중개수수료율. */
  leasingCommissionRate: Pct;
  /** 제한계정에 보관하고 보유 종료 시 반환하는 보증금 개월 수. */
  securityDepositMonths: Months;
  /** 보유 자산 임대차의 가중 평균 계약기간. 0이면 조건 미입력. */
  tenantLeaseTermMonths: Months;
  /** 임대차 만기 때 기존 임차인이 갱신할 확률. */
  tenantRenewalProbability: Pct;
  /** 갱신 임대료의 당시 시장임대료 대비 조정률. */
  renewalRentAdjustmentRate: Pct;
  /** 갱신 임차인에게 제공하는 무상임대 기간. */
  renewalRentFreeMonths: Months;
  /** 미갱신 면적에 신규 임차인을 유치하기까지의 추가 공실기간. */
  replacementDowntimeMonths: Months;
  /** 신규 임차인 입주 후 제공하는 무상임대 기간. */
  replacementRentFreeMonths: Months;
  /** 미갱신 면적의 신규 임차인 공사비. */
  replacementTenantImprovementPerSqM: Won;
  /** 미갱신 면적 신규 임대의 연 임대료 대비 중개수수료율. */
  replacementLeasingCommissionRate: Pct;
  /** 연간 면적당 대수선·교체 준비금. */
  replacementReservePerSqMYear: Won;
  /** 일회성 대수선 발생 보유연차. 0이면 계획 없음. */
  majorRepairYear: number;
  /** 일회성 대수선 비용. */
  majorRepairCostManwon: ManWon;
  /** 보유 종료 시 적용할 Exit cap rate. */
  holdExitCapRate: Pct;
  /** 보유 종료 매각가 대비 중개·법무·처분비율. */
  exitSellingCostRate: Pct;

  // Timeline
  designMonths: Months;
  constructionMonths: Months;
  saleOutMonths: Months;
}

export interface AssumptionDelta {
  field: keyof AssumptionSet;
  baseValue: number;
  overrideValue: number;
  reason?: string;
  evidenceUrl?: string;
  changedBy: string;
  changedAt: string;
}

// ─────────────────────────── Scenario ───────────────────────────

export interface Scenario {
  id: string; // "S1"
  name: string; // "오피스텔 + 근생"
  shortName: string;
  tag?: string;
  program: BuildingProgram;
  assumptions: AssumptionSet;
  /** Stage 2에서 잠근 용도×처분별 단가 또는 Stage 3에서 수정한 독립 단가. */
  revenuePricing?: FinancialRevenuePricingSnapshot;
  /** Audit trail for automatically generated use and disposition candidates. */
  generation?: {
    modelVersion: "scenario-generation-2026.1" | "scenario-generation-2026.2";
    strategy: "sale-exit" | "stabilized-lease-exit";
    strategyLabel: string;
    useScreening: ZoningUseScreeningResult;
  };
}

// ─────────────────────────── Calculated results ───────────────────────────

export interface ScenarioResult {
  scenarioId: string;

  // Building outputs
  gfa: SqM; // 연면적 (raw, 공사비 기준)
  effectiveGFA: SqM; // 전용 면적 (주차+코어 제외, 매출 기준)
  efficiencyRatio: number; // 전용률 (0..1)
  parkingSpaces: number; // 주차 의무대수
  coreArea: SqM; // 코어 + 공용 면적
  buildingArea: SqM; // 건축면적

  // Revenue
  revenueSale: ManWon;
  revenueLease: ManWon; // capitalized via cap rate
  revenueRetail: ManWon; // capitalized
  /** 주거·상가·업무 × 매각·임대의 상세 매출·출구가치. */
  revenueByPool: FinancialRevenuePoolAmounts;
  /** 임대 풀별 안정화 연간 NOI. 매각 풀은 0이다. */
  annualNoiByPool: FinancialRevenuePoolAmounts;
  annualPotentialRentByPool: FinancialRevenuePoolAmounts;
  annualEffectiveGrossIncomeByPool: FinancialRevenuePoolAmounts;
  annualOperatingExpenseByPool: FinancialRevenuePoolAmounts;
  totalRevenue: ManWon;

  // Cost
  landCost: ManWon;
  acquisitionTax: ManWon;
  acquisitionOtherCost: ManWon;
  demolitionCost: ManWon;
  tenantRelocationCost: ManWon;
  hardCost: ManWon;
  softCost: ManWon;
  /** PF 이자만의 합계. */
  interestCost: ManWon;
  pfFee: ManWon;
  trustFee: ManWon;
  /** 이자 + PF 수수료 + 신탁비 합계. */
  financingCost: ManWon;
  contingency: ManWon;
  totalCost: ManWon;

  // Profitability
  profit: ManWon;
  /** Unrounded engine value for decisions; absent in older stored results. */
  profitUnroundedManwon?: ManWon;
  constructionCostSensitivity?: import("./construction-cost-sensitivity").ConstructionCostSensitivity;
  /** 기본 공사단가 -15% 월별 재계산. 단일 calculateScenario 호출에는 미포함. */
  profitAtLowCost?: ManWon;
  /** 기본 공사단가 +20% 월별 재계산. */
  profitAtHighCost?: ManWon;
  /** 변경 단가의 직접 공사비만. 간접비·예비비·금융비 제외. */
  constructionCostLow?: ManWon;
  constructionCostHigh?: ManWon;
  profitMargin: Pct;
  equity: ManWon;
  pfLoan: ManWon;
  pfCommitment: ManWon;
  ltc: Pct;
  funding: {
    status: "unverified" | "funded" | "shortfall";
    equityCommitmentManwon: ManWon | null;
    requiredEquityManwon: ManWon;
    shortfallManwon: ManWon;
    firstShortfallMonth: Months | null;
    pfCommitmentManwon: ManWon;
    maxPfBalanceManwon: ManWon;
  };
  /** 임대 안정화 자산의 장기대출 가능액과 PF 상환 부족액. */
  takeout: TakeoutUnderwritingResult;
  /** 기존 안정화 후 매각 결과와 분리된 장기 보유 대안 원장. */
  hold: HoldPeriodLedgerResult;

  // Returns
  /** 요구수익률(equityIRR)로 할인한 자기자본 현금흐름 NPV */
  npv: ManWon;
  /** Unrounded NPV from the same monthly ledger, before display formatting. */
  npvUnroundedManwon?: ManWon;
  irr: Pct;
  /** Finite annual IRR before display rounding; present only when calculated. */
  irrUnroundedPct?: Pct;
  /** IRR은 단일 부호변화와 수치해가 있을 때만 calculated. */
  irrStatus?: "calculated" | "not-calculated" | "ambiguous";
  equityMultiple: number;
  dscr: number;
  dscrStatus:
    | "takeout-amortizing"
    | "terms-missing"
    | "terms-invalid"
    | "interest-only-proxy"
    | "not-applicable";
  /** 사업기간 안에 누적 프로젝트 현금흐름이 회복되지 않으면 null. */
  paybackMonths: Months | null;
  /** Unrounded monthly ledger amounts for downstream calculations; round only for display. */
  equityCashFlowsManwon: ManWon[];

  // Risk
  maxExposure: ManWon; // most negative cumulative cash position
  breakEvenQuarter: string | null;

  // Timeline
  totalMonths: Months;

  // Viability — effectiveGFA<=0 (코어/주차가 면적을 다 잡아먹음) 이면 false
  viable: boolean;
  viabilityNote?: string;
}

export interface CashflowRow {
  quarter: string; // "2025-Q3"
  phase: string;
  outflow: ManWon;
  inflow: ManWon;
  netQuarter: ManWon;
  cumulative: ManWon;
  note: string;
}

export interface PFSchedule {
  rows: CashflowRow[];
  maxExposure: ManWon;
  breakEvenQuarter: string | null;
  totalOutflow: ManWon;
  totalInflow: ManWon;
}

// ─────────────────────────── Tax ───────────────────────────

export interface TaxLine {
  tax: string; // 취득세, 재산세, ...
  base: string; // 토지, 건물, 이익, ...
  rate: string; // "본세 2.8% 참고", "원장 입력", ...
  amount: ManWon;
  note: string;
  status?:
    | "included-in-pretax"
    | "reference-only"
    | "not-calculated";
  source?: string;
}

export interface TaxBreakdown {
  modelVersion?: string;
  lines: TaxLine[];
  /** 구버전 표시 호환용. 세전 원장에 이미 반영된 세액 합계이며 추가 차감액이 아니다. */
  total: ManWon;
  /** 세전 사업비 원장에 이미 포함된 세액. */
  includedInPretaxTotal: ManWon;
  /** 전문가 입력 없이 세후에 추가 차감할 수 있는 금액. 현재 항상 0이다. */
  incrementalAfterTaxTotal: ManWon;
  asOf?: string;
  complete?: boolean;
  warnings?: string[];
}

// ─────────────────────────── Sensitivity ───────────────────────────

export interface SensitivityCell {
  paramX: keyof AssumptionSet;
  paramY: keyof AssumptionSet;
  valueX: number;
  valueY: number;
  profit: ManWon;
  dscr: number;
  irr: Pct;
}

export interface SensitivityGrid {
  paramX: keyof AssumptionSet;
  paramY: keyof AssumptionSet;
  xValues: number[];
  yValues: number[];
  cells: SensitivityCell[][];
}

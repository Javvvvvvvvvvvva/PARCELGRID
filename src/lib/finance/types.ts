import type { BuildingLookupResult } from "@/lib/integrations/molit-building";
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
  estimatedPriceManwon: ManWon;
  estimatedPricePerPyeong: number;
  method: AcquisitionEstimateMethod;
  confidence: "high" | "medium" | "low";
  marketMedianPerPyeong?: number;
  marketMedianManwon?: ManWon;
  transactionCount?: number;
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

export interface Parcel {
  id: string;
  address: string;
  addressRoad: string;
  lat?: number;
  lng?: number;

  // Geometry
  lotArea: SqM;
  /** 필지 경계 폴리곤 [lng, lat][] (WGS84). 3D 매싱용. 옛 데이터엔 없을 수 있음 */
  boundary?: [number, number][];
  /** 부지 주변 도로 중심선 — 전면 식별용 */
  roads?: { name: string | null; points: [number, number][] }[];

  // Zoning
  zoning: string; // e.g. "제3종일반주거지역"
  zoneCode: string; // e.g. "UB30"
  maxFAR: Pct; // 용적률 상한, % of lotArea
  maxBCR: Pct; // 건폐율 상한, % of lotArea
  heightLimit: number; // m

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

export interface BuildingProgram {
  type: BuildingType;
  far: Pct; // planned 용적률
  bcr: Pct; // planned 건폐율
  floorsAbove: number;
  floorsBelow: number;
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
  capRate: Pct; // Cap rate %

  // Cost
  constCostPerSqM: Won; // 공사비 원/m²
  softCostRate: Pct; // 설계/인허가/감리 비율 of hard cost
  contingencyRate: Pct; // 예비비

  // Finance
  ltcTarget: Pct; // PF 비율 목표
  interestRate: Pct; // PF 금리
  equityIRR: Pct; // 자본 요구수익률 (for NPV)

  // Operations
  leaseUpMonths: Months; // 임대 안정화 기간
  salesPaceMonthlyPct: Pct; // 분양 속도 (%/월)

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
  totalRevenue: ManWon;

  // Cost
  landCost: ManWon;
  demolitionCost: ManWon;
  hardCost: ManWon;
  softCost: ManWon;
  financingCost: ManWon;
  contingency: ManWon;
  totalCost: ManWon;

  // Profitability
  profit: ManWon;
  /** 공사비 Low(-15%) 적용 시 손익 — 근사 (금융비 2차 효과 미반영) */
  profitAtLowCost?: ManWon;
  /** 공사비 High(+20%) 적용 시 손익 — 근사 */
  profitAtHighCost?: ManWon;
  constructionCostLow?: ManWon;
  constructionCostHigh?: ManWon;
  profitMargin: Pct;
  equity: ManWon;
  pfLoan: ManWon;
  ltc: Pct;

  // Returns
  /** 요구수익률(equityIRR)로 할인한 자기자본 현금흐름 NPV */
  npv: ManWon;
  irr: Pct;
  equityMultiple: number;
  dscr: number;
  paybackMonths: Months;

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
  rate: string; // "4.6%"
  amount: ManWon;
  note: string;
  status?: "estimated" | "not-calculated";
  source?: string;
}

export interface TaxBreakdown {
  lines: TaxLine[];
  /** 계산 가능한 항목만 합산한 부분 추정액. 완결된 세후 세액이 아니다. */
  total: ManWon;
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

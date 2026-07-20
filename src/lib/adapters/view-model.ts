/**
 * Engine output → UI view-model adapter.
 *
 * The financial engine returns a normalized ScenarioResult. The UI screens
 * (designed before the engine existed) expect a slightly different shape
 * with Korean labels, derived percentages, and pre-formatted strings.
 *
 * This adapter lives at the boundary. Two reasons it exists separately:
 *   1. Engine stays pure and locale-agnostic. We could swap to English
 *      labels by changing only this file.
 *   2. UI components stay dumb — they read flat fields, no calculation.
 *
 * Conventions:
 *   - All monetary values: 만원
 *   - All percentages: human-readable (32.7, not 0.327)
 *   - All Korean labels emitted in NFC
 */

import type {
  Parcel,
  Scenario,
  ScenarioResult,
  PFSchedule,
  TaxBreakdown,
  BuildingType,
} from "@/lib/finance/types";
import type { RiskCheck } from "@/lib/finance/compliance";

// ─────────────────────────── Korean labels ───────────────────────────

const BUILDING_TYPE_KR: Record<BuildingType, string> = {
  officetel: "오피스텔",
  "urban-housing": "도시형생활주택",
  retail: "근린생활",
  coliving: "공유주거",
  office: "업무시설",
  mixed: "복합용도",
  "single-house": "단독주택",
  "multi-family": "다가구주택",
};

const RISK_LABEL_KR = {
  ok: "표시 경고 없음",
  low: "표시 경고 없음",
  med: "주의",
  high: "협의",
} as const;

// ─────────────────────────── View models ───────────────────────────

export interface ScenarioVM {
  id: string;
  name: string;
  shortName: string;
  tag?: string;
  type: BuildingType;
  typeKr: string;

  far: number;
  bcr: number;
  gfa: number;
  floors: { above: number; below: number };
  units: { residential: number; retail: number };

  cost: number;
  // Cost breakdown
  landCost: number;
  demolitionCost: number;
  hardCost: number;
  softCost: number;
  contingency: number;
  financingCost: number;

  revenue: number;
  // Revenue breakdown
  revenueSale: number;
  revenueLease: number;
  revenueRetail: number;

  profit: number;
  /** 공사비 Low(-15%)/High(+20%) 적용 시 손익 (근사) */
  profitAtLowCost?: number;
  profitAtHighCost?: number;
  constructionCostLow?: number;
  constructionCostHigh?: number;
  profitMargin: number;
  equity: number;
  pf: number;
  ltc: number;
  dscr: number;
  npv: number;
  irr: number;
  irrStatus?: "calculated" | "not-calculated" | "ambiguous";
  equityMultiple: number;
  taxBurden: number;
  maxExposure: number;
  paybackMonths: number;
  timeline: number;
  regulatory: number;

  recommended: boolean;
  viable: boolean;
  viabilityNote?: string;
  assumptions: {
    rent: number;
    sale: number;
    vacancy: number;
    capRate: number;
    intRate: number;
  };
  /** 원본 시나리오 (가정편집 재계산용 — program + 전체 assumptions). */
  _raw: Scenario;
}

export function toScenarioVM(
  scenario: Scenario,
  result: ScenarioResult,
  taxes: TaxBreakdown,
  complianceScore: number,
  recommended = false
): ScenarioVM {
  const equityReturn = result.equity + result.profit;
  const equityMult =
    result.equity > 0 ? Number((equityReturn / result.equity).toFixed(2)) : 0;

  return {
    id: scenario.id,
    name: scenario.name,
    shortName: scenario.shortName,
    tag: scenario.tag,
    type: scenario.program.type,
    typeKr: BUILDING_TYPE_KR[scenario.program.type],

    far: scenario.program.far,
    bcr: scenario.program.bcr,
    gfa: result.gfa,
    floors: {
      above: scenario.program.floorsAbove,
      below: scenario.program.floorsBelow,
    },
    units: scenario.program.units,

    cost: result.totalCost,
    landCost: result.landCost,
    demolitionCost: result.demolitionCost,
    hardCost: result.hardCost,
    softCost: result.softCost,
    contingency: result.contingency,
    financingCost: result.financingCost,

    revenue: result.totalRevenue,
    revenueSale: result.revenueSale,
    revenueLease: result.revenueLease,
    revenueRetail: result.revenueRetail,

    profit: result.profit,
    profitAtLowCost: result.profitAtLowCost,
    profitAtHighCost: result.profitAtHighCost,
    constructionCostLow: result.constructionCostLow,
    constructionCostHigh: result.constructionCostHigh,
    profitMargin: result.profitMargin,
    equity: result.equity,
    pf: result.pfLoan,
    ltc: result.ltc,
    dscr: result.dscr,
    npv: result.npv,
    irr: result.irr,
    irrStatus: result.irrStatus,
    equityMultiple: equityMult,
    taxBurden: taxes.total,
    maxExposure: result.maxExposure,
    paybackMonths: result.paybackMonths,
    timeline: result.totalMonths,
    regulatory: complianceScore,

    recommended,
    assumptions: {
      rent: scenario.assumptions.rentPerSqMMonth,
      sale: scenario.assumptions.salePricePerSqM,
      vacancy: scenario.assumptions.vacancyRate,
      capRate: scenario.assumptions.capRate,
      intRate: scenario.assumptions.interestRate,
    },
    _raw: scenario,
    viable: result.viable,
    viabilityNote: result.viabilityNote,
  };
}

// ─────────────────────────── Cashflow row VM ───────────────────────────

export interface CashflowRowVM {
  quarter: string;
  phase: string;
  outflow: number;
  inflow: number;
  net: number;
  cumulative: number;
  note: string;
}

export function toCashflowVM(schedule: PFSchedule): CashflowRowVM[] {
  return schedule.rows.map((r) => ({
    quarter: r.quarter,
    phase: r.phase,
    outflow: r.outflow,
    inflow: r.inflow,
    net: r.netQuarter,
    cumulative: r.cumulative,
    note: r.note,
  }));
}

// ─────────────────────────── Risk row VM ───────────────────────────

export interface RiskVM {
  code: string;
  label: string;
  level: "ok" | "low" | "med" | "high";
  levelLabel: string;
  note: string;
  reference?: string;
}

export function toRiskVMs(checks: RiskCheck[]): RiskVM[] {
  return checks.map((c) => ({
    code: c.code,
    label: c.label,
    level: c.level,
    levelLabel: RISK_LABEL_KR[c.level],
    note: c.finding,
    reference: c.reference,
  }));
}


// ─────────────────────────── Comp transaction VM ───────────────────────────

/**
 * 실거래 비교 표시용. MOLIT 거래를 대시보드/실거래비교 화면에서 보기 좋게 변환.
 * 거리 정보는 MOLIT가 좌표를 안 줘서 — 본인 부지와 같은 동이면 distanceKm=0, 다른 동이면 null.
 */
export interface CompVM {
  id: string;
  date: string;            // ISO yyyy-mm-dd
  address: string;         // "역삼동 813-4" 같이
  type: string;            // 한글 한 거 ("오피스텔", "도시형생활", 등)
  lotArea: number;         // 전용/대지 면적 m²
  priceWon: number;        // 원 단위
  pricePerPyeong: number;  // 만원/평
  distanceKm: number | null; // null = MOLIT가 좌표 없음
  sameDong: boolean;       // 본인 부지와 같은 법정동인가
  lawdCd: string;          // 법정동코드 10자리 (앞5=시군구, 같은 구 판별용)
  /** 준공년도 (단독/다가구 등 — 신축 필터용) */
  buildYear?: number;
}

const TYPE_KR: Record<string, string> = {
  land: "토지",
  apartment: "아파트",
  officetel: "오피스텔",
  villa: "도시형생활",
  commercial: "상업/근생",
  office: "사무실",
};

const SQM_PER_PYEONG = 3.305785;

export function toCompVMs(
  transactions: import("@/lib/integrations/molit").MolitTransaction[],
  parcelDong: string
): CompVM[] {
  return transactions
    .filter((t) => t.priceManwon > 0 && t.exclusiveArea > 0)
    .map((t) => {
      const pyeong = t.exclusiveArea / SQM_PER_PYEONG;
      const pricePerPyeong = Math.round(t.priceManwon / pyeong);
      const sameDong = parcelDong ? t.dongName === parcelDong : false;
      return {
        id: t.externalId,
        date: t.date,
        address: `${t.dongName} ${t.jibun}`.trim(),
        type: TYPE_KR[t.type] ?? t.type,
        lotArea: t.exclusiveArea,
        priceWon: t.priceManwon * 10_000,
        pricePerPyeong,
        distanceKm: null, // MOLIT가 좌표 없음
        sameDong,
        lawdCd: t.lawdCd,
        buildYear: t.buildYear,
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date)); // 최신 순
}

// ─────────────────────────── Parcel VM ───────────────────────────

export interface ParcelVM extends Parcel {
  risks: RiskVM[]; // top-level convenience for the rail
  status: string;
  risk: string; // 종합 평가
}

export function toParcelVM(parcel: Parcel, risks: RiskVM[]): ParcelVM {
  // Severity rollup for the dashboard tile
  const hasHigh = risks.some((r) => r.level === "high");
  const hasMed = risks.some((r) => r.level === "med");
  const overall = hasHigh ? "높음" : hasMed ? "보통" : "낮음";

  return { ...parcel, risks, status: "사업기획", risk: overall };
}

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
  acquisitionTax: number;
  acquisitionOtherCost: number;
  demolitionCost: number;
  tenantRelocationCost: number;
  hardCost: number;
  softCost: number;
  contingency: number;
  interestCost: number;
  pfFee: number;
  trustFee: number;
  financingCost: number;

  revenue: number;
  // Revenue breakdown
  revenueSale: number;
  revenueLease: number;
  revenueRetail: number;
  revenueByPool: ScenarioResult["revenueByPool"];
  annualNoiByPool: ScenarioResult["annualNoiByPool"];
  annualPotentialRentByPool: ScenarioResult["annualPotentialRentByPool"];
  annualEffectiveGrossIncomeByPool: ScenarioResult["annualEffectiveGrossIncomeByPool"];
  annualOperatingExpenseByPool: ScenarioResult["annualOperatingExpenseByPool"];

  profit: number;
  profitUnroundedManwon?: ScenarioResult["profitUnroundedManwon"];
  constructionCostSensitivity?: ScenarioResult["constructionCostSensitivity"];
  /** 기본 공사단가 Low(-15%)/High(+20%) 월별 재계산 손익. */
  profitAtLowCost?: number;
  profitAtHighCost?: number;
  constructionCostLow?: number;
  constructionCostHigh?: number;
  profitMargin: number;
  equity: number;
  pf: number;
  pfCommitment: number;
  funding: ScenarioResult["funding"];
  takeout: ScenarioResult["takeout"];
  hold: ScenarioResult["hold"];
  ltc: number;
  dscr: number;
  dscrStatus: ScenarioResult["dscrStatus"];
  npv: number;
  npvUnroundedManwon?: ScenarioResult["npvUnroundedManwon"];
  irr: number;
  irrUnroundedPct?: ScenarioResult["irrUnroundedPct"];
  irrStatus?: "calculated" | "not-calculated" | "ambiguous";
  equityMultiple: number;
  /** 세전 사업비에 이미 반영된 세금. 추가 세후 차감액이 아니다. */
  taxIncludedInPretax: number;
  maxExposure: number;
  paybackMonths: number | null;
  equityCashFlowsManwon: number[];
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
    acquisitionTax: result.acquisitionTax,
    acquisitionOtherCost: result.acquisitionOtherCost,
    demolitionCost: result.demolitionCost,
    tenantRelocationCost: result.tenantRelocationCost,
    hardCost: result.hardCost,
    softCost: result.softCost,
    contingency: result.contingency,
    interestCost: result.interestCost,
    pfFee: result.pfFee,
    trustFee: result.trustFee,
    financingCost: result.financingCost,

    revenue: result.totalRevenue,
    revenueSale: result.revenueSale,
    revenueLease: result.revenueLease,
    revenueRetail: result.revenueRetail,
    revenueByPool: result.revenueByPool,
    annualNoiByPool: result.annualNoiByPool,
    annualPotentialRentByPool: result.annualPotentialRentByPool,
    annualEffectiveGrossIncomeByPool:
      result.annualEffectiveGrossIncomeByPool,
    annualOperatingExpenseByPool: result.annualOperatingExpenseByPool,

    profit: result.profit,
    profitUnroundedManwon: result.profitUnroundedManwon,
    constructionCostSensitivity: result.constructionCostSensitivity,
    profitAtLowCost: result.profitAtLowCost,
    profitAtHighCost: result.profitAtHighCost,
    constructionCostLow: result.constructionCostLow,
    constructionCostHigh: result.constructionCostHigh,
    profitMargin: result.profitMargin,
    equity: result.equity,
    pf: result.pfLoan,
    pfCommitment: result.pfCommitment,
    funding: result.funding,
    takeout: result.takeout,
    hold: result.hold,
    ltc: result.ltc,
    dscr: result.dscr,
    dscrStatus: result.dscrStatus,
    npv: result.npv,
    npvUnroundedManwon: result.npvUnroundedManwon,
    irr: result.irr,
    irrUnroundedPct: result.irrUnroundedPct,
    irrStatus: result.irrStatus,
    equityMultiple: equityMult,
    taxIncludedInPretax: taxes.includedInPretaxTotal,
    maxExposure: result.maxExposure,
    paybackMonths: result.paybackMonths,
    equityCashFlowsManwon: result.equityCashFlowsManwon,
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
  evidenceStatus?: RiskCheck["evidenceStatus"];
  note: string;
  reference?: string;
}

export function toRiskVMs(checks: RiskCheck[]): RiskVM[] {
  return checks.map((c) => ({
    code: c.code,
    label: c.label,
    level: c.level,
    levelLabel: c.evidenceStatus === "confirmed" ? RISK_LABEL_KR[c.level]
      : c.level === "high" ? "협의 · 미확정" : c.level === "med" ? "주의 · 미확정" : "미확정",
    evidenceStatus: c.evidenceStatus ?? "preliminary",
    note: c.finding,
    reference: c.reference,
  }));
}


// ─────────────────────────── Comp transaction VM ───────────────────────────

/**
 * 실거래 비교 표시용. MOLIT 거래를 대시보드/실거래비교 화면에서 보기 좋게 변환.
 * MOLIT는 좌표를 제공하지 않는다. 같은 법정동도 거리 0km로 간주하지 않는다.
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
  dongName?: string;
  jibun?: string;
  floor?: number;
  areaBasis?: import("@/lib/integrations/molit").MolitTransaction["areaBasis"];
  cancellationStatus?: import("@/lib/integrations/molit").MolitTransaction["cancellationStatus"];
  cancellationDate?: string;
  registrationDate?: string;
  dealingGbn?: string;
  buyerType?: string;
  sellerType?: string;
  houseType?: string;
}

const TYPE_KR: Record<string, string> = {
  land: "토지",
  apartment: "아파트",
  officetel: "오피스텔",
  villa: "연립다세대",
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
        dongName: t.dongName, jibun: t.jibun, floor: t.floor,
        areaBasis: t.areaBasis, cancellationStatus: t.cancellationStatus,
        cancellationDate: t.cancellationDate, registrationDate: t.registrationDate,
        dealingGbn: t.dealingGbn, buyerType: t.buyerType, sellerType: t.sellerType,
        houseType: t.houseType,
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

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
};

const RISK_LABEL_KR = {
  ok: "정상",
  low: "정상",
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
  profitMargin: number;
  equity: number;
  pf: number;
  ltc: number;
  dscr: number;
  irr: number;
  equityMultiple: number;
  taxBurden: number;
  timeline: number;
  regulatory: number;

  recommended: boolean;
  assumptions: {
    rent: number;
    sale: number;
    vacancy: number;
    capRate: number;
    intRate: number;
  };
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
    profitMargin: result.profitMargin,
    equity: result.equity,
    pf: result.pfLoan,
    ltc: result.ltc,
    dscr: result.dscr,
    irr: result.irr,
    equityMultiple: equityMult,
    taxBurden: taxes.total,
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

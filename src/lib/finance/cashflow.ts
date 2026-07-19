/**
 * Quarterly dashboard projection derived from the shared monthly project ledger.
 *
 * This file does not contain an independent phasing model. IRR, NPV, PF
 * exposure, financing cost and this table all use project-ledger.ts.
 */

import { buildProjectLedger } from "./project-ledger";
import type {
  Parcel,
  Scenario,
  ScenarioResult,
  CashflowRow,
  PFSchedule,
} from "./types";

export interface ScheduleInput {
  parcel: Parcel;
  scenario: Scenario;
  result: ScenarioResult;
  /** ISO date of project start */
  startDate: string;
}

interface QuarterAccumulator {
  quarter: string;
  phases: string[];
  outflow: number;
  inflow: number;
  note: string;
}

export function generatePFSchedule(input: ScheduleInput): PFSchedule {
  const { parcel, scenario, result, startDate } = input;
  const ledger = buildProjectLedger({
    parcel,
    scenario,
    revenueSale: result.revenueSale,
    revenueExit: result.revenueLease + result.revenueRetail,
    hardCost: result.hardCost,
    softCost: result.softCost,
    contingency: result.contingency,
  });

  const start = new Date(startDate);
  const grouped = new Map<string, QuarterAccumulator>();

  for (const month of ledger.rows) {
    const quarter = formatQuarter(addMonths(start, month.month));
    const current = grouped.get(quarter) ?? {
      quarter,
      phases: [],
      outflow: 0,
      inflow: 0,
      note: "",
    };
    const phase = phaseLabel(month.phase);
    if (!current.phases.includes(phase)) current.phases.push(phase);
    current.outflow += month.projectOutflow;
    current.inflow += month.revenueInflow;
    grouped.set(quarter, current);
  }

  const rows: CashflowRow[] = [];
  let cumulative = 0;
  let maxExposure = 0;
  let breakEvenQuarter: string | null = null;

  for (const quarter of grouped.values()) {
    const outflow = Math.round(quarter.outflow);
    const inflow = Math.round(quarter.inflow);
    const netQuarter = inflow - outflow;
    cumulative += netQuarter;
    maxExposure = Math.min(maxExposure, cumulative);
    if (breakEvenQuarter === null && rows.length > 0 && cumulative >= 0) {
      breakEvenQuarter = quarter.quarter;
    }
    rows.push({
      quarter: quarter.quarter,
      phase: quarter.phases.join(" · "),
      outflow,
      inflow,
      netQuarter,
      cumulative,
      note:
        rows.length === 0
          ? "예비 원장 · 토지비 포함"
          : quarter.note,
    });
  }

  const totalOutflow = rows.reduce((sum, row) => sum + row.outflow, 0);
  const totalInflow = rows.reduce((sum, row) => sum + row.inflow, 0);

  return {
    rows,
    maxExposure,
    breakEvenQuarter,
    totalOutflow,
    totalInflow,
  };
}

function phaseLabel(
  phase: "land" | "design" | "construction" | "exit"
): string {
  if (phase === "land") return "토지 인수";
  if (phase === "design") return "설계·인허가";
  if (phase === "construction") return "공사";
  return "준공·회수";
}

function addMonths(date: Date, months: number): Date {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

function formatQuarter(date: Date): string {
  const year = date.getUTCFullYear();
  const quarter = Math.floor(date.getUTCMonth() / 3) + 1;
  return `${year}-Q${quarter}`;
}

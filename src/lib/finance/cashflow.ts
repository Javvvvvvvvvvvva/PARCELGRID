/**
 * PF (Project Finance) cashflow schedule.
 *
 * Produces the quarter-by-quarter table shown on the dashboard and
 * the scenario detail screen. Differs from the IRR calculation in
 * scenario.ts in that it operates in *real calendar quarters* anchored
 * to the project start date — the lender needs to see actual dates.
 *
 * Computation order:
 *   1. Lay out phases: 토지비 → 인허가/설계 → 철거/터파기 → 골조 → 마감 → 준공 → 잔여분양
 *   2. Allocate each phase's outflow across the quarters it spans.
 *   3. Apply inflow waterfall: 선분양 → 중도금 → 잔금 → 잔여분양.
 *   4. Roll cumulative balance; track max exposure and break-even.
 */

import { D, ZERO, Decimal, toManWon } from "./math";
import type {
  Parcel,
  Scenario,
  ScenarioResult,
  CashflowRow,
  PFSchedule,
} from "./types";

interface PhaseSpec {
  phase: string;
  startQuarterOffset: number; // quarters from project start
  durationQuarters: number;
  outflowShare: number; // 0..1 share of (hardCost + softCost + contingency)
  note?: string;
}

/**
 * Standard Korean mid-rise development phase plan.
 * Total construction + design + sale ≈ 26 months → 9 quarters at this density.
 */
const PHASE_PLAN: PhaseSpec[] = [
  { phase: "토지비", startQuarterOffset: 0, durationQuarters: 1, outflowShare: 0, note: "토지 인수 완료" },
  { phase: "인허가/설계", startQuarterOffset: 1, durationQuarters: 1, outflowShare: 0.04, note: "건축심의 진행" },
  { phase: "철거/터파기", startQuarterOffset: 2, durationQuarters: 1, outflowShare: 0.06, note: "PF 1차 인출" },
  { phase: "골조 1", startQuarterOffset: 3, durationQuarters: 1, outflowShare: 0.11 },
  { phase: "골조 2", startQuarterOffset: 4, durationQuarters: 1, outflowShare: 0.12, note: "선분양 시작" },
  { phase: "마감 1", startQuarterOffset: 5, durationQuarters: 1, outflowShare: 0.10 },
  { phase: "마감 2", startQuarterOffset: 6, durationQuarters: 1, outflowShare: 0.08 },
  { phase: "준공/입주", startQuarterOffset: 7, durationQuarters: 1, outflowShare: 0.03, note: "PF 상환" },
  { phase: "잔여분양", startQuarterOffset: 8, durationQuarters: 1, outflowShare: 0.01 },
];

/**
 * Inflow waterfall: share of total revenue realized per quarter offset.
 * Calibrated to: 선분양 6%, 중도금 26%, 26%, 잔금 45%, 잔여 분양 분산.
 */
const INFLOW_PLAN: { offset: number; share: number }[] = [
  { offset: 4, share: 0.04 }, // 선분양 시작
  { offset: 5, share: 0.14 },
  { offset: 6, share: 0.23 },
  { offset: 7, share: 0.41 }, // 준공 시 잔금
  { offset: 8, share: 0.18 }, // 잔여분양
];

export interface ScheduleInput {
  parcel: Parcel;
  scenario: Scenario;
  result: ScenarioResult;
  /** ISO date of project start, e.g. "2025-07-01" for 2025-Q3 */
  startDate: string;
}

export function generatePFSchedule(input: ScheduleInput): PFSchedule {
  const { parcel, result, startDate } = input;

  const start = new Date(startDate);
  const totalQuarters = Math.max(
    PHASE_PLAN[PHASE_PLAN.length - 1].startQuarterOffset + 1,
    INFLOW_PLAN[INFLOW_PLAN.length - 1].offset + 1
  );

  const constructionTotal = D(result.hardCost)
    .plus(D(result.softCost))
    .plus(D(result.contingency));
  const totalRevenue = D(result.totalRevenue);

  const rows: CashflowRow[] = [];
  let cumulative = ZERO;
  let maxExposure = ZERO;
  let breakEvenQuarter: string | null = null;

  for (let q = 0; q < totalQuarters; q++) {
    const quarterDate = addQuarters(start, q);
    const quarterLabel = formatQuarter(quarterDate);

    // Find active phase for this quarter
    const phase = PHASE_PLAN.find(
      (p) =>
        q >= p.startQuarterOffset &&
        q < p.startQuarterOffset + p.durationQuarters
    );
    const phaseName = phase?.phase ?? "—";

    // Outflow: land cost in Q0, construction phases otherwise
    let outflow = ZERO;
    if (q === 0) {
      outflow = D(parcel.acquiredPrice);
    }
    if (phase) {
      outflow = outflow.plus(constructionTotal.times(phase.outflowShare));
    }

    // Inflow
    const inflowPlan = INFLOW_PLAN.find((p) => p.offset === q);
    const inflow = inflowPlan ? totalRevenue.times(inflowPlan.share) : ZERO;

    const net = inflow.minus(outflow);
    cumulative = cumulative.plus(net);

    if (cumulative.lt(maxExposure)) maxExposure = cumulative;
    if (breakEvenQuarter === null && cumulative.gte(0) && q > 0) {
      breakEvenQuarter = quarterLabel;
    }

    rows.push({
      quarter: quarterLabel,
      phase: phaseName,
      outflow: toManWon(outflow),
      inflow: toManWon(inflow),
      netQuarter: toManWon(net),
      cumulative: toManWon(cumulative),
      note: phase?.note ?? "",
    });
  }

  const totalOutflow = rows.reduce((sum, r) => sum + r.outflow, 0);
  const totalInflow = rows.reduce((sum, r) => sum + r.inflow, 0);

  return {
    rows,
    maxExposure: toManWon(maxExposure),
    breakEvenQuarter,
    totalOutflow,
    totalInflow,
  };
}

// ─────────────────────────── Quarter helpers ───────────────────────────

function addQuarters(d: Date, q: number): Date {
  const out = new Date(d);
  out.setUTCMonth(out.getUTCMonth() + q * 3);
  return out;
}

function formatQuarter(d: Date): string {
  // UTC 기준 — 서버 타임존과 무관하게 동일한 분기 라벨 보장.
  // (예: "2025-07-01"은 어떤 타임존에서도 항상 2025-Q3)
  const y = d.getUTCFullYear();
  const q = Math.floor(d.getUTCMonth() / 3) + 1;
  return `${y}-Q${q}`;
}

import {
  LEASE_USES,
  MAX_LEASE_ROWS,
  leaseRollBasis,
  leaseRollDraftSchema,
  type LeaseUse,
} from "./lease-roll-contract";
import { D, Decimal } from "./math";
import type { Scenario, ScenarioResult } from "./types";

export interface LeaseRollComparison {
  version: "lease-roll-comparison-2026.1";
  status: "ready" | "incomplete" | "conflict" | "stale";
  financialApplied: false;
  approvalStatus: "unverified";
  issues: string[];
  rows: Array<{
    month: string;
    contractRentWon: number;
    depositInflowWon: number;
    depositRefundWon: number;
    closingDepositWon: number;
    baselineRentWon: number | null;
    rentDeltaWon: number | null;
  }>;
  areas: Array<{
    use: LeaseUse;
    expectedSqm: number;
    scheduledSqm: number;
    unassignedSqm: number;
  }>;
  openingDepositWon: number | null;
  totalRentWon: number | null;
  closingDepositWon: number | null;
}

const MONTHS = 24;
const DAY_MS = 86_400_000;
const MAX_AMOUNT_WON = D(1e13);
const AREA_TOLERANCE_SQM = D("0.000001");
const USE_LABELS: Record<LeaseUse, string> = { residential: "주거", retail: "상가", office: "업무" };
// The hold engine permits at most 50 years, plus its refinance row.
const MAX_BASELINE_ROWS = 601;
const CALCULATED_HOLD_STATUSES = new Set<ScenarioResult["hold"]["status"]>([
  "modeled-unverified", "refinance-shortfall", "commitment-feasible",
]);

function unavailable(
  status: LeaseRollComparison["status"],
  issues: string[],
  areas: LeaseRollComparison["areas"] = [],
): LeaseRollComparison {
  return {
    version: "lease-roll-comparison-2026.1",
    status,
    financialApplied: false,
    approvalStatus: "unverified",
    issues,
    rows: [],
    areas,
    openingDepositWon: null,
    totalRentWon: null,
    closingDepositWon: null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function valueAtPath(value: unknown, path: PropertyKey[]): unknown {
  for (const key of path) {
    if (value === null || typeof value !== "object") return undefined;
    value = Reflect.get(value, key);
  }
  return value;
}

function utcDay(date: string): number {
  return Date.parse(`${date}T00:00:00.000Z`);
}

function boundedAmount(amount: Decimal): boolean {
  return amount.isFinite() && amount.gte(0) && amount.lte(MAX_AMOUNT_WON);
}

function baselineRents(
  baseline: ScenarioResult["hold"] | null,
  issues: string[],
): Map<number, Decimal | null> {
  const rents = new Map<number, Decimal | null>();
  if (!baseline || !CALCULATED_HOLD_STATUSES.has(baseline.status) ||
      !Array.isArray(baseline.rows) || baseline.rows.length > MAX_BASELINE_ROWS ||
      !Number.isInteger(baseline.holdMonths) || baseline.holdMonths < 1 ||
      baseline.holdMonths > 600) {
    issues.push("계산된 기준 보유 현금흐름이 없어 기준 임대료를 비교할 수 없습니다.");
    return rents;
  }

  let total = D(0);
  for (const row of baseline.rows) {
    if (!row || !Number.isInteger(row.holdMonth) || row.holdMonth < 1 ||
        row.holdMonth > MONTHS || row.holdMonth > baseline.holdMonths) continue;
    if (rents.has(row.holdMonth)) {
      const previous = rents.get(row.holdMonth);
      if (previous) total = total.minus(previous);
      rents.set(row.holdMonth, null);
      issues.push(`기준 holdMonth ${row.holdMonth}이 중복되어 해당 월의 기준 임대료를 비교할 수 없습니다.`);
      continue;
    }
    const rent = typeof row.effectiveGrossIncome === "number" &&
      Number.isFinite(row.effectiveGrossIncome)
      ? D(row.effectiveGrossIncome).times(10_000) : null;
    const available = rent !== null && boundedAmount(rent) ? rent : null;
    rents.set(row.holdMonth, available);
    if (available) total = total.plus(available);
  }
  if (!boundedAmount(total)) {
    issues.push("기준 임대료 합계가 10조 원을 초과하여 기준 임대료를 비교할 수 없습니다.");
    return new Map();
  }
  if (rents.size < MONTHS || [...rents.values()].some(value => value === null)) {
    issues.push("일부 운영 월의 기준 임대료가 없어 해당 월의 임대료 차이를 계산하지 않습니다.");
  }
  return rents;
}

export function compareLeaseRoll({ draft, projectId, scenario, baseline }: {
  draft: unknown;
  projectId: string;
  scenario: Scenario;
  baseline: ScenarioResult["hold"] | null;
}): LeaseRollComparison {
  if (draft === null || draft === undefined) {
    return unavailable("incomplete", ["호실별 임대 계약 초안이 필요합니다."]);
  }
  // Bound work before Zod traverses rows and checks pairwise unit overlaps.
  if (isRecord(draft) && Array.isArray(draft.rows) && draft.rows.length > MAX_LEASE_ROWS) {
    return unavailable("conflict", [`임대 계약은 최대 ${MAX_LEASE_ROWS}건까지 비교할 수 있습니다.`]);
  }
  const parsed = leaseRollDraftSchema.safeParse(draft);
  if (!parsed.success) {
    const missingOnly = parsed.error.issues.every(issue =>
      issue.code === "invalid_type" && valueAtPath(draft, issue.path) == null);
    return unavailable(missingOnly ? "incomplete" : "conflict", parsed.error.issues.map(issue => {
      const message = issue.code === "custom" ? issue.message :
        issue.code === "invalid_type" && valueAtPath(draft, issue.path) == null
          ? "필수 입력이 없습니다." : "입력 형식 또는 값이 올바르지 않습니다.";
      return `${issue.path.join(".") || "draft"}: ${message}`;
    }));
  }
  const roll = parsed.data;
  if (!isRecord(scenario) || typeof scenario.id !== "string" || !scenario.id.trim() ||
      !isRecord(scenario.program)) {
    return unavailable("conflict", ["비교 대상 계획안의 형식이 올바르지 않습니다."]);
  }
  if (roll.projectId !== projectId || roll.scenarioId !== scenario.id) {
    return unavailable("conflict", ["임대 계약의 프로젝트 또는 계획안이 현재 비교 대상과 다릅니다."]);
  }
  const area = scenario.program.areaContract;
  if (area === null || area === undefined) {
    return unavailable("incomplete", ["계획안과 연결된 면적 계약이 필요합니다."]);
  }
  if (!isRecord(area)) {
    return unavailable("conflict", ["계획안의 면적 계약 형식이 올바르지 않습니다."]);
  }
  if (!area.sourceScenarioId || area.sourceScenarioVersion == null) {
    return unavailable("incomplete", ["면적 계약의 원본 계획안과 버전이 필요합니다."]);
  }
  if (area.sourceScenarioId !== scenario.id) {
    return unavailable("conflict", ["면적 계약의 원본 계획안이 현재 비교 대상과 다릅니다."]);
  }
  let basis: string;
  try {
    basis = leaseRollBasis(projectId, scenario);
  } catch {
    return unavailable("conflict", ["계획안의 면적 계약 값이 올바르지 않습니다."]);
  }
  if (roll.sourceBasis !== basis) {
    return unavailable("stale", ["임대 계약의 sourceBasis가 현재 계획안의 면적 계약과 달라 재확인이 필요합니다."]);
  }

  const issues: string[] = [];
  if (!roll.calendarStart) issues.push("첫 운영 월의 시작일(calendarStart)이 필요합니다.");
  if (roll.rows.length === 0) issues.push("입력된 임대 계약이 최소 한 건 필요합니다.");
  for (const row of roll.rows) {
    for (const field of ["areaSqm", "monthlyRentWon", "depositWon", "startDate", "endDate", "sourceAsOf"] as const) {
      if (row[field] === null) issues.push(`${row.id}: ${field} 입력이 필요합니다.`);
    }
    for (const field of ["unitLabel", "sourceName", "sourceRef"] as const) {
      if (!row[field].trim()) issues.push(`${row.id}: ${field} 입력이 필요합니다.`);
    }
  }
  if (issues.length > 0) return unavailable("incomplete", issues);

  const anchor = utcDay(roll.calendarStart!);
  const year = new Date(anchor).getUTCFullYear();
  const month = new Date(anchor).getUTCMonth();
  if (Date.UTC(year, month + MONTHS, 1) > Date.UTC(2200, 0, 1)) {
    return unavailable("conflict", ["24개월 비교 기간은 2199-12-31 이내에 끝나야 합니다."]);
  }

  const scheduled = new Map<LeaseUse, Decimal>(LEASE_USES.map(use => [use, D(0)]));
  const seenUnits = new Set<string>();
  for (const row of roll.rows) {
    if (seenUnits.has(row.unitId)) continue;
    seenUnits.add(row.unitId);
    scheduled.set(row.use, scheduled.get(row.use)!.plus(row.areaSqm!));
  }
  let overflow = false;
  const areas = LEASE_USES.map(use => {
    const expected = D(area.revenueAreas[`${use}LeaseSqm`]);
    const assigned = scheduled.get(use)!;
    const unassigned = Decimal.max(0, expected.minus(assigned));
    if (assigned.minus(expected).gt(AREA_TOLERANCE_SQM)) {
      overflow = true;
      issues.push(`${USE_LABELS[use]} 계약 면적이 계획안 임대 면적을 0.000001㎡ 넘게 초과합니다.`);
    }
    if (unassigned.gt(0)) {
      issues.push(`${USE_LABELS[use]} 미배정 임대 면적은 ${unassigned.toString()}㎡입니다. 입력된 계약만 비교하며 미배정 면적의 임대료는 추정하지 않습니다.`);
    }
    return { use, expectedSqm: expected.toNumber(), scheduledSqm: assigned.toNumber(), unassignedSqm: unassigned.toNumber() };
  });
  if (overflow) return unavailable("conflict", issues, areas);

  const contracts = roll.rows.map(row => ({
    start: utcDay(row.startDate!),
    refund: utcDay(row.endDate!) + DAY_MS,
    rent: D(row.monthlyRentWon!),
    deposit: D(row.depositWon!),
  }));
  // A prior-day expiry is still an opening liability, refunded on the anchor day.
  const opening = contracts.reduce((sum, row) =>
    row.start < anchor && row.refund >= anchor ? sum.plus(row.deposit) : sum, D(0));
  const amountOverflow = () => unavailable("conflict", [
    ...issues, "임대료·보증금 잔액·누적 입금·누적 반환의 각 합계는 10조 원을 초과할 수 없습니다.",
  ], areas);
  if (!boundedAmount(opening)) return amountOverflow();

  const rents = baselineRents(baseline, issues);
  const rows: LeaseRollComparison["rows"] = [];
  let closing = opening;
  let totalRent = D(0);
  let totalInflow = D(0);
  let totalRefund = D(0);
  for (let index = 0; index < MONTHS; index++) {
    const start = Date.UTC(year, month + index, 1);
    const next = Date.UTC(year, month + index + 1, 1);
    const daysInMonth = D(next - start).div(DAY_MS);
    let rent = D(0);
    let inflow = D(0);
    let refund = D(0);
    for (const contract of contracts) {
      const occupiedMs = Math.max(0, Math.min(next, contract.refund) - Math.max(start, contract.start));
      const occupiedDays = D(occupiedMs).div(DAY_MS);
      rent = rent.plus(contract.rent.times(occupiedDays).div(daysInMonth));
      if (contract.start >= start && contract.start < next) inflow = inflow.plus(contract.deposit);
      if (contract.refund >= start && contract.refund < next) refund = refund.plus(contract.deposit);
    }
    closing = closing.plus(inflow).minus(refund);
    totalRent = totalRent.plus(rent);
    totalInflow = totalInflow.plus(inflow);
    totalRefund = totalRefund.plus(refund);
    if (![closing, totalRent, totalInflow, totalRefund].every(boundedAmount)) return amountOverflow();
    const baselineRent = rents.get(index + 1) ?? null;
    rows.push({
      month: new Date(start).toISOString().slice(0, 7),
      contractRentWon: rent.toNumber(),
      depositInflowWon: inflow.toNumber(),
      depositRefundWon: refund.toNumber(),
      closingDepositWon: closing.toNumber(),
      baselineRentWon: baselineRent?.toNumber() ?? null,
      rentDeltaWon: baselineRent === null ? null : rent.minus(baselineRent).toNumber(),
    });
  }
  if (closing.gt(0)) issues.push("기말 보증금은 계약상 반환일까지 사용이 제한된 부채로 남으며 비교 기간 말에 임의 반환하지 않습니다.");
  return {
    version: "lease-roll-comparison-2026.1",
    status: "ready",
    financialApplied: false,
    approvalStatus: "unverified",
    issues,
    rows,
    areas,
    openingDepositWon: opening.toNumber(),
    totalRentWon: totalRent.toNumber(),
    closingDepositWon: closing.toNumber(),
  };
}

import { compareLeaseRoll } from "./lease-roll-comparison";
import { leaseRollDraftSchema } from "./lease-roll-contract";
import { D, Decimal } from "./math";
import { OPERATING_COST_CATEGORIES, operatingBudgetBasis, operatingBudgetDraftSchema } from "./operating-budget-contract";
import type { Scenario, ScenarioResult } from "./types";

export interface LeaseRollNoiComparison {
  version: "lease-roll-noi-comparison-2026.1";
  status: "ready" | "incomplete" | "conflict" | "stale";
  financialApplied: false;
  approvalStatus: "unverified";
  issues: string[];
  rows: Array<{
    month: string;
    contractRentWon: number;
    operatingExpenseWon: number;
    noiWon: number;
    baselineNoiWon: number | null;
    noiDeltaWon: number | null;
  }>;
  totalRentWon: number | null;
  totalOperatingExpenseWon: number | null;
  totalNoiWon: number | null;
}

const MAX_AMOUNT_WON = D(1e13);
const CALCULATED_HOLD_STATUSES = new Set(["modeled-unverified", "refinance-shortfall", "commitment-feasible"]);

function unavailable(status: LeaseRollNoiComparison["status"], issues: string[]): LeaseRollNoiComparison {
  return {
    version: "lease-roll-noi-comparison-2026.1", status, financialApplied: false, approvalStatus: "unverified",
    issues, rows: [], totalRentWon: null, totalOperatingExpenseWon: null, totalNoiWon: null,
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

function baselineAmount(value: unknown, signed = false): Decimal | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const amount = D(value).times(10_000);
  return amount.abs().lte(MAX_AMOUNT_WON) && (signed || amount.gte(0)) ? amount : null;
}

function baselineNois(baseline: ScenarioResult["hold"] | null, issues: string[]): Map<number, Decimal | null> {
  const values = new Map<number, Decimal | null>();
  const sources = new Map<number, { income: Decimal; expense: Decimal }>();
  if (!baseline || !CALCULATED_HOLD_STATUSES.has(baseline.status) || !Array.isArray(baseline.rows) ||
      baseline.rows.length > 601 || !Number.isInteger(baseline.holdMonths) || baseline.holdMonths < 1 || baseline.holdMonths > 600) {
    issues.push("계산된 기준 보유 현금흐름이 없어 기준 NOI를 비교할 수 없습니다.");
    return values;
  }
  for (const row of baseline.rows) {
    if (!row || !Number.isInteger(row.holdMonth) || row.holdMonth < 1 || row.holdMonth > 24 || row.holdMonth > baseline.holdMonths) continue;
    if (values.has(row.holdMonth)) {
      values.set(row.holdMonth, null);
      sources.delete(row.holdMonth);
      issues.push(`기준 holdMonth ${row.holdMonth}이 중복되어 해당 월의 기준 NOI를 비교할 수 없습니다.`);
      continue;
    }
    const income = baselineAmount(row.effectiveGrossIncome);
    const expense = baselineAmount(row.operatingExpense);
    const noi = baselineAmount(row.noi, true);
    let available: Decimal | null = null;
    if (income !== null && expense !== null && noi !== null) {
      // Permit only number-serialization noise, not rounded or inconsistent source totals.
      const tolerance = Decimal.max("0.000001", Decimal.max(income, expense, noi.abs()).times(Number.EPSILON).times(4));
      if (income.minus(expense).minus(noi).abs().lte(tolerance)) {
        available = noi;
        sources.set(row.holdMonth, { income, expense });
      }
    }
    values.set(row.holdMonth, available);
  }
  let incomeTotal = D(0), expenseTotal = D(0);
  for (const source of sources.values()) {
    incomeTotal = incomeTotal.plus(source.income);
    expenseTotal = expenseTotal.plus(source.expense);
  }
  if (incomeTotal.gt(MAX_AMOUNT_WON) || expenseTotal.gt(MAX_AMOUNT_WON)) {
    issues.push("기준 임대수입 또는 운영비의 24개월 합계가 10조 원을 초과하여 기준 NOI를 비교할 수 없습니다.");
    return new Map();
  }
  if (values.size < 24 || [...values.values()].some(value => value === null)) {
    issues.push("일부 운영 월의 기준 NOI가 누락되었거나 일치하지 않아 해당 월의 차이를 계산하지 않습니다.");
  }
  return values;
}

export function compareLeaseRollNoi({ draft, budget, projectId, scenario, baseline }: {
  draft: unknown;
  budget: unknown;
  projectId: string;
  scenario: Scenario;
  baseline: ScenarioResult["hold"] | null;
}): LeaseRollNoiComparison {
  const rent = compareLeaseRoll({ draft, projectId, scenario, baseline: null });
  if (rent.status !== "ready") return unavailable(rent.status, rent.issues);
  if (budget === null || budget === undefined) return unavailable("incomplete", ["월별 소유자 부담 운영비 초안이 필요합니다."]);
  // Bound nested arrays before schema traversal; the lease comparison already bounds leases.
  if (isRecord(budget) && Array.isArray(budget.categories) && (budget.categories.length > 6 ||
      budget.categories.some(item => isRecord(item) && Array.isArray(item.amounts) && item.amounts.length > 24))) {
    return unavailable("conflict", ["운영비는 6개 항목, 항목별 최대 24개월까지 입력할 수 있습니다."]);
  }
  const parsed = operatingBudgetDraftSchema.safeParse(budget);
  if (!parsed.success) {
    const missingOnly = parsed.error.issues.every(issue => issue.code === "invalid_type" && valueAtPath(budget, issue.path) == null);
    return unavailable(missingOnly ? "incomplete" : "conflict", parsed.error.issues.map(issue => {
      const message = issue.code === "custom" ? issue.message :
        issue.code === "invalid_type" && valueAtPath(budget, issue.path) == null
          ? "필수 입력이 없습니다." : "입력 형식 또는 값이 올바르지 않습니다.";
      return `${issue.path.join(".") || "budget"}: ${message}`;
    }));
  }
  const costs = parsed.data;
  if (costs.projectId !== projectId || costs.scenarioId !== scenario.id) {
    return unavailable("conflict", ["운영비 초안의 프로젝트 또는 계획안이 현재 비교 대상과 다릅니다."]);
  }
  if (costs.sourceBasis !== operatingBudgetBasis(projectId, scenario)) {
    return unavailable("stale", ["운영비 초안의 sourceBasis가 현재 계획안의 면적 계약과 달라 재확인이 필요합니다."]);
  }
  const roll = leaseRollDraftSchema.parse(draft);
  if (!costs.calendarStart) return unavailable("incomplete", ["운영비의 첫 운영 월(calendarStart)이 필요합니다."]);
  if (costs.calendarStart !== roll.calendarStart) {
    return unavailable("conflict", ["운영비와 임대 계약의 첫 운영 월이 다릅니다."]);
  }
  const missing: string[] = [];
  if (!costs.scopeConfirmed) missing.push("공실·미배정 면적과 공용부 소유자 부담을 포함한 전체 보유 임대 포트폴리오의 운영비 범위를 확인해야 합니다.");
  if (!costs.allocationNote.trim()) missing.push("소유자 부담 운영비의 배분 근거(allocationNote)가 필요합니다.");
  const expectedMonths = new Set(rent.rows.map(row => row.month));
  for (const category of OPERATING_COST_CATEGORIES) {
    const item = costs.categories.find(item => item.category === category);
    if (!item) { missing.push(`${category}: 운영비 항목이 필요합니다.`); continue; }
    if (!item.sourceName.trim() || !item.sourceRef.trim() || item.sourceAsOf === null) {
      missing.push(`${category}: 출처 이름·참조·기준일이 필요합니다.`);
    }
    if (item.amounts.some(amount => !expectedMonths.has(amount.month))) {
      return unavailable("conflict", [`${category}: 운영비 월은 임대 계약의 24개월 비교 기간과 일치해야 합니다.`]);
    }
    if (item.amounts.length !== 24 || item.amounts.some(amount => amount.amountWon === null)) {
      missing.push(`${category}: 24개월 모두 명시적인 운영비가 필요합니다. 미입력은 0원이 아닙니다.`);
    }
  }
  if (missing.length) return unavailable("incomplete", missing);

  // The rent-only baseline is disabled above; NOI has its own explicit calendar and validation.
  const issues = rent.issues.filter(issue => issue !== "계산된 기준 보유 현금흐름이 없어 기준 임대료를 비교할 수 없습니다.");
  const baselineValues = costs.baselineCalendarStart === roll.calendarStart
    ? baselineNois(baseline, issues) : new Map<number, Decimal | null>();
  if (costs.baselineCalendarStart !== roll.calendarStart) {
    issues.push("기준 보유 현금흐름의 첫 운영 월(baselineCalendarStart)이 임대 계약과 명시적으로 일치하지 않아 기준 NOI를 비교하지 않습니다.");
  }
  const rows: LeaseRollNoiComparison["rows"] = [];
  let totalExpense = D(0);
  for (const [index, row] of rent.rows.entries()) {
    const expense = costs.categories.reduce((sum, item) => sum.plus(item.amounts.find(amount => amount.month === row.month)!.amountWon!), D(0));
    totalExpense = totalExpense.plus(expense);
    if (!totalExpense.isFinite() || totalExpense.gt(MAX_AMOUNT_WON)) {
      return unavailable("conflict", [...issues, "24개월 소유자 부담 운영비 합계는 10조 원을 초과할 수 없습니다."]);
    }
    const noi = D(row.contractRentWon).minus(expense);
    const baselineNoi = baselineValues.get(index + 1) ?? null;
    rows.push({
      month: row.month, contractRentWon: row.contractRentWon, operatingExpenseWon: expense.toNumber(), noiWon: noi.toNumber(),
      baselineNoiWon: baselineNoi?.toNumber() ?? null,
      noiDeltaWon: baselineNoi === null ? null : noi.minus(baselineNoi).toNumber(),
    });
  }
  issues.push("출처의 진위는 미검증입니다. 계약 임대료는 부가세·관리비를 제외하며, 운영비는 회수액 차감 후 비회수 세금을 포함한 소유자 부담액이라는 모델 가정입니다. 세무 자문이 아닙니다.");
  return {
    version: "lease-roll-noi-comparison-2026.1", status: "ready", financialApplied: false, approvalStatus: "unverified", issues, rows,
    totalRentWon: rent.totalRentWon, totalOperatingExpenseWon: totalExpense.toNumber(),
    totalNoiWon: D(rent.totalRentWon!).minus(totalExpense).toNumber(),
  };
}

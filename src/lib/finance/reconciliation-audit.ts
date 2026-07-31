import { revenueCollectionPolicyForScenario } from "@/lib/finance/project-ledger";
import type { Scenario, ScenarioResult } from "@/lib/finance/types";

export const FINANCIAL_RECONCILIATION_AUDIT_VERSION =
  "financial-reconciliation-audit-v1" as const;
/** ScenarioResult는 저장 경계에서 각 금액을 가장 가까운 1만원으로 반올림한다. */
export const FINANCIAL_RECONCILIATION_ROUNDING_UNIT_MANWON = 1;

export type FinancialReconciliationStatus = "pass" | "review" | "fail";

export interface FinancialReconciliationCheck {
  id:
    | "revenue-components"
    | "cost-components"
    | "profit-identity"
    | "funding-sources";
  label: string;
  status: FinancialReconciliationStatus;
  leftLabel: string;
  leftManwon: number;
  rightLabel: string;
  rightManwon: number;
  differenceManwon: number;
  toleranceManwon: number;
  message: string;
}

export interface FinancialReconciliationAudit {
  version: typeof FINANCIAL_RECONCILIATION_AUDIT_VERSION;
  status: FinancialReconciliationStatus;
  exact: boolean;
  checks: FinancialReconciliationCheck[];
  summary: {
    revenueDifferenceManwon: number;
    costDifferenceManwon: number;
    profitDifferenceManwon: number;
    fundingDifferenceManwon: number;
    usesEarlySaleReceipts: boolean;
  };
}

function difference(left: number, right: number): number {
  return left - right;
}

function roundingTolerance(roundedTermCount: number): number {
  return (
    ((Math.max(1, roundedTermCount) + 1) *
      FINANCIAL_RECONCILIATION_ROUNDING_UNIT_MANWON) /
      2 +
    1e-9
  );
}

function withinTolerance(value: number, toleranceManwon: number): boolean {
  return Number.isFinite(value) && Math.abs(value) <= toleranceManwon;
}

function exactCheck(input: {
  id: FinancialReconciliationCheck["id"];
  label: string;
  leftLabel: string;
  leftManwon: number;
  rightLabel: string;
  rightManwon: number;
  roundedTermCount: number;
}): FinancialReconciliationCheck {
  const gap = difference(input.leftManwon, input.rightManwon);
  const toleranceManwon = roundingTolerance(input.roundedTermCount);
  const status = withinTolerance(gap, toleranceManwon) ? "pass" : "fail";
  return {
    ...input,
    differenceManwon: gap,
    toleranceManwon,
    status,
    message:
      status === "pass"
        ? `대사 일치 · 반올림 오차 ${Math.abs(gap).toFixed(2)}만원 / 허용 ${toleranceManwon.toFixed(2)}만원`
        : `대사 불일치 · 오차 ${Math.abs(gap).toFixed(2)}만원이 독립 반올림 최대치 ${toleranceManwon.toFixed(2)}만원을 넘었습니다. 숫자 표시와 저장을 재검토해야 합니다.`,
  };
}

/**
 * Stage 3의 화면·저장·보고서가 사용하는 ScenarioResult 내부 조정 관계를
 * 하나의 감사 객체로 만든다. 금액 단위는 ScenarioResult와 동일한 만원이다.
 *
 * 자기자본 투입액은 누적값이고 PF는 최고잔액이므로 둘의 합은
 * 총사업비와 같은 시점의 회계 항등식이 아니다. 조기 분양대금뿐 아니라
 * 통매각의 회수월 매출도 PF 상환과 마지막 금융비를 부담할 수 있어,
 * 자금조달 관계는 REVIEW와 월별 원장으로 설명한다.
 */
export function buildFinancialReconciliationAudit(input: {
  result: ScenarioResult;
  scenario: Scenario;
}): FinancialReconciliationAudit {
  const { result, scenario } = input;
  const revenueComponents =
    result.revenueSale + result.revenueLease + result.revenueRetail;
  const costComponents =
    result.landCost +
    result.demolitionCost +
    result.hardCost +
    result.softCost +
    result.financingCost +
    result.contingency;
  const profitIdentity = result.totalCost + result.profit;
  const fundingSources = result.equity + result.pfLoan;
  const collectionPolicy = revenueCollectionPolicyForScenario(scenario);
  const usesEarlySaleReceipts =
    collectionPolicy === "presale-10-60-30" && result.revenueSale > 0;

  const revenueCheck = exactCheck({
    id: "revenue-components",
    label: "매출 구성",
    leftLabel: "매출 구성 합계",
    leftManwon: revenueComponents,
    rightLabel: "총매출",
    rightManwon: result.totalRevenue,
    roundedTermCount: 3,
  });
  const costCheck = exactCheck({
    id: "cost-components",
    label: "사업비 구성",
    leftLabel: "비용 구성 합계",
    leftManwon: costComponents,
    rightLabel: "총사업비",
    rightManwon: result.totalCost,
    roundedTermCount: 6,
  });
  const profitCheck = exactCheck({
    id: "profit-identity",
    label: "매출·사업비·손익",
    leftLabel: "총사업비 + 손익",
    leftManwon: profitIdentity,
    rightLabel: "총매출",
    rightManwon: result.totalRevenue,
    roundedTermCount: 2,
  });
  const fundingGap = difference(fundingSources, result.totalCost);
  const fundingCheck: FinancialReconciliationCheck = {
    id: "funding-sources",
    label: "자기자본·PF",
    status: "review",
    leftLabel: "누적 자기자본 + PF 최고잔액",
    leftManwon: fundingSources,
    rightLabel: "총사업비",
    rightManwon: result.totalCost,
    differenceManwon: fundingGap,
    toleranceManwon: roundingTolerance(2),
    message: usesEarlySaleReceipts
      ? "공사 중 분양대금이 PF 상환·재사용에 투입되므로 누적 자기자본 + PF 최고잔액은 총사업비 항등식이 아닙니다. 월별 통합 원장에서 조달과 상환을 확인하세요."
      : "회수월 매출이 PF 상환과 마지막 금융비를 함께 부담하므로 누적 자기자본 + PF 최고잔액은 총사업비 항등식이 아닙니다. 월별 통합 원장에서 조달과 상환을 확인하세요.",
  };

  const checks = [revenueCheck, costCheck, profitCheck, fundingCheck];
  const status: FinancialReconciliationStatus = checks.some(
    (check) => check.status === "fail"
  )
    ? "fail"
    : checks.some((check) => check.status === "review")
      ? "review"
      : "pass";

  return {
    version: FINANCIAL_RECONCILIATION_AUDIT_VERSION,
    status,
    exact: status === "pass",
    checks,
    summary: {
      revenueDifferenceManwon: revenueCheck.differenceManwon,
      costDifferenceManwon: costCheck.differenceManwon,
      profitDifferenceManwon: profitCheck.differenceManwon,
      fundingDifferenceManwon: fundingCheck.differenceManwon,
      usesEarlySaleReceipts,
    },
  };
}

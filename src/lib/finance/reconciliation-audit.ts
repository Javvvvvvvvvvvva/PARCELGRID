import { revenueCollectionPolicyForScenario } from "@/lib/finance/project-ledger";
import type { Scenario, ScenarioResult } from "@/lib/finance/types";

export const FINANCIAL_RECONCILIATION_AUDIT_VERSION =
  "financial-reconciliation-audit-v1" as const;
export const FINANCIAL_RECONCILIATION_TOLERANCE_MANWON = 0.1;

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

function withinTolerance(value: number): boolean {
  return (
    Number.isFinite(value) &&
    Math.abs(value) <= FINANCIAL_RECONCILIATION_TOLERANCE_MANWON
  );
}

function exactCheck(input: {
  id: FinancialReconciliationCheck["id"];
  label: string;
  leftLabel: string;
  leftManwon: number;
  rightLabel: string;
  rightManwon: number;
}): FinancialReconciliationCheck {
  const gap = difference(input.leftManwon, input.rightManwon);
  const status = withinTolerance(gap) ? "pass" : "fail";
  return {
    ...input,
    differenceManwon: gap,
    status,
    message:
      status === "pass"
        ? `대사 일치 · 오차 ${Math.abs(gap).toFixed(2)}만원`
        : `대사 불일치 · 오차 ${Math.abs(gap).toFixed(2)}만원. 숫자 표시와 저장을 재검토해야 합니다.`,
  };
}

/**
 * Stage 3의 화면·저장·보고서가 사용하는 ScenarioResult 내부 조정 관계를
 * 하나의 감사 객체로 만든다. 금액 단위는 ScenarioResult와 동일한 만원이다.
 *
 * 자기자본 + PF 최고잔액은 회수 전까지 매출이 들어오지 않는 통매각/임대
 * 모델에서만 총사업비와 정확히 대사된다. 공사 중 분양대금이 유입되는
 * 10/60/30 모델에서는 해당 매출이 PF를 상환·재사용하므로 회계 항등식이
 * 아니며 REVIEW로 표시한다.
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
  });
  const costCheck = exactCheck({
    id: "cost-components",
    label: "사업비 구성",
    leftLabel: "비용 구성 합계",
    leftManwon: costComponents,
    rightLabel: "총사업비",
    rightManwon: result.totalCost,
  });
  const profitCheck = exactCheck({
    id: "profit-identity",
    label: "매출·사업비·손익",
    leftLabel: "총사업비 + 손익",
    leftManwon: profitIdentity,
    rightLabel: "총매출",
    rightManwon: result.totalRevenue,
  });
  const fundingGap = difference(fundingSources, result.totalCost);
  const fundingCheck: FinancialReconciliationCheck = usesEarlySaleReceipts
    ? {
        id: "funding-sources",
        label: "자기자본·PF",
        status: "review",
        leftLabel: "자기자본 + PF 최고잔액",
        leftManwon: fundingSources,
        rightLabel: "총사업비",
        rightManwon: result.totalCost,
        differenceManwon: fundingGap,
        message:
          "공사 중 분양대금이 PF 상환에 사용되는 모델이므로 자기자본 + PF 최고잔액은 총사업비 항등식이 아닙니다. 월별 통합 원장에서 자금조달을 확인하세요.",
      }
    : exactCheck({
        id: "funding-sources",
        label: "자기자본·PF",
        leftLabel: "자기자본 + PF 최고잔액",
        leftManwon: fundingSources,
        rightLabel: "총사업비",
        rightManwon: result.totalCost,
      });

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

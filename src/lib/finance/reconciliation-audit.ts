import { revenueCollectionPolicyForScenario } from "@/lib/finance/project-ledger";
import {
  FINANCIAL_REVENUE_POOL_KEYS,
  revenuePricingForScenario,
} from "@/lib/finance/revenue-contract";
import type {
  FinancialRevenuePoolKey,
  Scenario,
  ScenarioResult,
} from "@/lib/finance/types";

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
    | "funding-sources"
    | `stage2-${FinancialRevenuePoolKey}`
    | "stage2-land-demolition"
    | "stage2-acquisition-ancillary"
    | "stage2-relocation"
    | "stage2-hard-cost"
    | "stage2-soft-cost"
    | "stage2-contingency"
    | "stage2-pf-fee"
    | "stage2-trust-fee"
    | "stage2-financing"
    | "stage2-profit";
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
    stage2RevenueDifferenceManwon: number;
    stage2CostDifferenceManwon: number;
    stage2ProfitDifferenceManwon: number;
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

function stageTransitionCheck(input: {
  id: FinancialReconciliationCheck["id"];
  label: string;
  leftManwon: number;
  rightManwon: number;
  assumptionsChanged?: boolean;
  expectedModelDifference?: boolean;
}): FinancialReconciliationCheck {
  const gap = difference(input.leftManwon, input.rightManwon);
  const toleranceManwon = roundingTolerance(2);
  const matched = withinTolerance(gap, toleranceManwon);
  const review = input.assumptionsChanged || input.expectedModelDifference;
  const status: FinancialReconciliationStatus = matched
    ? "pass"
    : review
      ? "review"
      : "fail";
  return {
    id: input.id,
    label: input.label,
    status,
    leftLabel: "Stage 2 잠금값",
    leftManwon: input.leftManwon,
    rightLabel: "Stage 3 현재값",
    rightManwon: input.rightManwon,
    differenceManwon: gap,
    toleranceManwon,
    message: matched
      ? `Stage 2/3 일치 · 차이 ${Math.abs(gap).toFixed(2)}만원`
      : status === "review"
        ? `${
            input.expectedModelDifference
              ? "Stage 2 비율 추정과 Stage 3 월별 원장의 계산 정밀도가 달라"
              : "Stage 3 가정이 Stage 2 잠금 시점과 달라"
          } ${Math.abs(gap).toFixed(2)}만원 차이가 납니다.`
        : `동일한 입력인데 Stage 2/3가 ${Math.abs(gap).toFixed(2)}만원 다릅니다. 계산 계약을 재생성해야 합니다.`,
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
    result.acquisitionTax +
    result.acquisitionOtherCost +
    result.demolitionCost +
    result.tenantRelocationCost +
    result.hardCost +
    result.softCost +
    result.financingCost +
    result.contingency;
  const profitIdentity = result.totalCost + result.profit;
  const fundingSources = result.equity + result.pfLoan;
  const collectionPolicy = revenueCollectionPolicyForScenario(
    scenario,
    result.revenueByPool,
  );
  const usesEarlySaleReceipts =
    (collectionPolicy === "presale-10-60-30" ||
      collectionPolicy === "mixed") &&
    result.revenueByPool.residentialSale > 0;

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
    roundedTermCount: 9,
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

  const stage2Projection = scenario.program.areaContract?.revenueProjection;
  const currentPricing = revenuePricingForScenario(scenario);
  const poolLabels: Record<FinancialRevenuePoolKey, string> = {
    residentialSale: "Stage 2/3 주거 매각",
    retailSale: "Stage 2/3 상가 매각",
    officeSale: "Stage 2/3 업무 매각",
    residentialLease: "Stage 2/3 주거 임대",
    retailLease: "Stage 2/3 상가 임대",
    officeLease: "Stage 2/3 업무 임대",
  };
  const globalPricingChanged = Boolean(
    stage2Projection &&
      (stage2Projection.pricing.vacancyRatePct !==
        currentPricing.vacancyRatePct ||
        stage2Projection.pricing.operatingExpenseRatePct !==
          currentPricing.operatingExpenseRatePct ||
        stage2Projection.pricing.capRatePct !== currentPricing.capRatePct ||
        stage2Projection.pricing.stabilizationFactorPct !==
          currentPricing.stabilizationFactorPct)
  );
  const stage2Checks: FinancialReconciliationCheck[] = stage2Projection
    ? FINANCIAL_REVENUE_POOL_KEYS.map((pool) => {
        const left = stage2Projection.valueByPoolManwon[pool];
        const right = result.revenueByPool[pool];
        const gap = difference(left, right);
        const toleranceManwon = roundingTolerance(2);
        const priceChanged =
          stage2Projection.pricing.pools[pool].unitPriceWon !==
          currentPricing.pools[pool].unitPriceWon;
        const matched = withinTolerance(gap, toleranceManwon);
        const status: FinancialReconciliationStatus = matched
          ? "pass"
          : priceChanged || globalPricingChanged
            ? "review"
            : "fail";
        return {
          id: `stage2-${pool}`,
          label: poolLabels[pool],
          status,
          leftLabel: "Stage 2 잠금값",
          leftManwon: left,
          rightLabel: "Stage 3 현재값",
          rightManwon: right,
          differenceManwon: gap,
          toleranceManwon,
          message: matched
            ? `면적·단가·매출 일치 · 차이 ${Math.abs(gap).toFixed(2)}만원`
            : status === "review"
              ? `Stage 3 단가·공실률·운영비율·Cap rate 중 하나가 Stage 2 잠금 시점과 달라 ${Math.abs(gap).toFixed(2)}만원 차이가 납니다.`
              : `같은 면적·단가인데 Stage 2/3 매출이 ${Math.abs(gap).toFixed(2)}만원 다릅니다. 계산을 중단하고 계약을 재생성해야 합니다.`,
        };
      })
    : [];
  const stage2Economics = scenario.program.areaContract?.stage2Economics;
  const stage2Inputs = stage2Economics?.inputs;
  const hardCostInputsChanged = Boolean(
    stage2Inputs &&
      (stage2Inputs.constructionCostPerSqmWon !==
        scenario.assumptions.constCostPerSqM ||
        stage2Inputs.basementCostMultiplier !==
          scenario.assumptions.basementCostMultiplier)
  );
  const softCostInputsChanged = Boolean(
    stage2Inputs &&
      (hardCostInputsChanged ||
        stage2Inputs.softCostRatePct !== scenario.assumptions.softCostRate)
  );
  const contingencyInputsChanged = Boolean(
    stage2Inputs &&
      (softCostInputsChanged ||
        stage2Inputs.contingencyRatePct !==
          scenario.assumptions.contingencyRate)
  );
  const acquisitionAncillaryInputsChanged = Boolean(
    stage2Inputs &&
      (stage2Inputs.acquisitionTaxManwon !==
        (scenario.assumptions.acquisitionTaxManwon ?? 0) ||
        stage2Inputs.acquisitionOtherCostManwon !==
          (scenario.assumptions.acquisitionOtherCostManwon ?? 0))
  );
  const relocationInputChanged = Boolean(
    stage2Inputs &&
      stage2Inputs.tenantRelocationCostManwon !==
        (scenario.assumptions.tenantRelocationCostManwon ?? 0)
  );
  const pfFeeInputsChanged = Boolean(
    stage2Inputs &&
      (hardCostInputsChanged ||
        softCostInputsChanged ||
        contingencyInputsChanged ||
        stage2Inputs.pfUpfrontFeeRatePct !==
          (scenario.assumptions.pfUpfrontFeeRate ?? 0) ||
        stage2Inputs.ltcTargetPct !== scenario.assumptions.ltcTarget)
  );
  const trustFeeInputChanged = Boolean(
    stage2Inputs &&
      stage2Inputs.trustFeeManwon !==
        (scenario.assumptions.trustFeeManwon ?? 0)
  );
  const stage2CostChecks: FinancialReconciliationCheck[] = stage2Economics
    ? [
        stageTransitionCheck({
          id: "stage2-land-demolition",
          label: "Stage 2/3 취득·철거비",
          leftManwon:
            stage2Economics.acquisitionCostManwon +
            stage2Economics.demolitionCostManwon,
          rightManwon: result.landCost + result.demolitionCost,
          assumptionsChanged:
            stage2Economics.acquisitionCostManwon !== result.landCost ||
            stage2Economics.demolitionCostManwon !== result.demolitionCost,
        }),
        stageTransitionCheck({
          id: "stage2-acquisition-ancillary",
          label: "Stage 2/3 취득세·기타 부대비",
          leftManwon:
            stage2Economics.acquisitionTaxManwon +
            stage2Economics.acquisitionOtherCostManwon,
          rightManwon:
            result.acquisitionTax + result.acquisitionOtherCost,
          assumptionsChanged: acquisitionAncillaryInputsChanged,
        }),
        stageTransitionCheck({
          id: "stage2-relocation",
          label: "Stage 2/3 명도·임차인 정리비",
          leftManwon: stage2Economics.tenantRelocationCostManwon,
          rightManwon: result.tenantRelocationCost,
          assumptionsChanged: relocationInputChanged,
        }),
        stageTransitionCheck({
          id: "stage2-hard-cost",
          label: "Stage 2/3 직접 공사비",
          leftManwon: stage2Economics.hardCostManwon,
          rightManwon: result.hardCost,
          assumptionsChanged: hardCostInputsChanged,
        }),
        stageTransitionCheck({
          id: "stage2-soft-cost",
          label: "Stage 2/3 간접비",
          leftManwon: stage2Economics.softCostManwon,
          rightManwon: result.softCost,
          assumptionsChanged: softCostInputsChanged,
        }),
        stageTransitionCheck({
          id: "stage2-contingency",
          label: "Stage 2/3 예비비",
          leftManwon: stage2Economics.contingencyCostManwon,
          rightManwon: result.contingency,
          assumptionsChanged: contingencyInputsChanged,
        }),
        stageTransitionCheck({
          id: "stage2-pf-fee",
          label: "Stage 2/3 PF 약정·취급 수수료",
          leftManwon: stage2Economics.pfFeeManwon,
          rightManwon: result.pfFee,
          assumptionsChanged: pfFeeInputsChanged,
        }),
        stageTransitionCheck({
          id: "stage2-trust-fee",
          label: "Stage 2/3 신탁·자금관리비",
          leftManwon: stage2Economics.trustFeeManwon,
          rightManwon: result.trustFee,
          assumptionsChanged: trustFeeInputChanged,
        }),
        stageTransitionCheck({
          id: "stage2-financing",
          label: "Stage 2/3 금융비",
          leftManwon: stage2Economics.financingCostManwon,
          rightManwon: result.financingCost,
          expectedModelDifference: true,
        }),
        stageTransitionCheck({
          id: "stage2-profit",
          label: "Stage 2/3 세전손익",
          leftManwon: stage2Economics.profitManwon,
          rightManwon: result.profit,
          assumptionsChanged:
            hardCostInputsChanged ||
            softCostInputsChanged ||
            contingencyInputsChanged ||
            globalPricingChanged,
          expectedModelDifference: true,
        }),
      ]
    : [];

  const checks = [
    revenueCheck,
    costCheck,
    profitCheck,
    ...stage2Checks,
    ...stage2CostChecks,
    fundingCheck,
  ];
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
      stage2RevenueDifferenceManwon: stage2Checks.reduce(
        (sum, check) => sum + check.differenceManwon,
        0
      ),
      stage2CostDifferenceManwon: stage2Economics
        ? stage2Economics.totalCostManwon - result.totalCost
        : 0,
      stage2ProfitDifferenceManwon: stage2Economics
        ? stage2Economics.profitManwon - result.profit
        : 0,
      usesEarlySaleReceipts,
    },
  };
}

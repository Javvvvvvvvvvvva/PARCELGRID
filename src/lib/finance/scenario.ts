/**
 * Scenario calculation engine — the heart of PARCELGRID.
 *
 * Given:
 *   - a parcel (zoning, area, acquisition cost)
 *   - a building program (type, FAR, floor count, use mix)
 *   - an assumption set (rents, sale price, costs, finance terms)
 *
 * Produces every number shown across the 6 screens:
 *   - Revenue (sale + capitalized lease)
 *   - Cost (land + hard + soft + financing + contingency)
 *   - Profit, margin, IRR, DSCR, equity multiple
 *   - PF cashflow schedule with max exposure and break-even
 *
 * Design constraints:
 *   - PURE FUNCTION: same input always produces same output.
 *     No I/O, no globals, no Date.now(). This is what makes the model
 *     auditable and testable, which is non-negotiable for IC deliverables.
 *   - Decimal math everywhere intermediate.
 *   - Returns serializable plain-number ScenarioResult at the boundary.
 *   - All assumptions explicit — no magic constants buried in code.
 */

import { D, ZERO, ONE, HUNDRED, Decimal } from "./math";
import { calculateEffectiveGFA } from "@/lib/finance/parking-core";
import { buildProjectLedger } from "@/lib/finance/project-ledger";
import {
  npv,
  irr,
  annualizeIRR,
  dscr as dscrFn,
  interestOnly,
  equityMultiple,
  toManWon,
  toPct,
} from "./math";
import type {
  Parcel,
  BuildingProgram,
  AssumptionSet,
  Scenario,
  ScenarioResult,
} from "./types";

// 만원 unit factor. 1억 = 10,000만원. 1원 → 만원 division by 10,000.
const WON_TO_MANWON = D(10_000);
const AREA_CONTRACT_TOLERANCE_SQM = 0.05;

function validateFinancialGeometryContract(
  program: BuildingProgram,
  scenarioId: string
): void {
  const contract = program.areaContract;
  if (!contract) return;

  if (contract.sourceScenarioId !== scenarioId) {
    throw new Error(
      `Stage 2/3 계획안 ID가 일치하지 않습니다: ${contract.sourceScenarioId} / ${scenarioId}`
    );
  }

  const numericAreas = [
    contract.constructionAreaSqm,
    contract.aboveGroundAreaSqm,
    contract.basementAreaSqm,
    contract.farAreaSqm,
    contract.gradeFootprintAreaSqm,
    contract.parkingAreaSqm,
    contract.commonAreaSqm,
    contract.saleableAreaSqm,
    contract.rentableAreaSqm,
    contract.revenueAreas.residentialSaleSqm,
    contract.revenueAreas.residentialLeaseSqm,
    contract.revenueAreas.retailSqm,
  ];
  if (numericAreas.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error("Stage 2/3 면적 계약에 유효하지 않은 면적이 있습니다.");
  }

  const constructedArea =
    contract.aboveGroundAreaSqm + contract.basementAreaSqm;
  if (
    Math.abs(constructedArea - contract.constructionAreaSqm) >
    AREA_CONTRACT_TOLERANCE_SQM
  ) {
    throw new Error(
      "Stage 2/3 면적 계약의 지상·지하 합계가 전체 공사면적과 일치하지 않습니다."
    );
  }

  const revenueArea =
    contract.revenueAreas.residentialSaleSqm +
    contract.revenueAreas.residentialLeaseSqm +
    contract.revenueAreas.retailSqm;
  const declaredRevenueArea =
    contract.saleableAreaSqm + contract.rentableAreaSqm;
  if (
    Math.abs(revenueArea - declaredRevenueArea) >
    AREA_CONTRACT_TOLERANCE_SQM
  ) {
    throw new Error(
      "Stage 2/3 면적 계약의 수익 면적 합계가 매각·임대 면적과 일치하지 않습니다."
    );
  }
}

export interface CalcInput {
  parcel: Parcel;
  scenario: Scenario;
}

/**
 * Compute one scenario end-to-end.
 *
 * The function is structured top-down: build → revenue → cost → cashflow → metrics.
 * Each step depends only on what came before. This linearity is intentional:
 * it makes the model debuggable and lets us expose intermediate results to
 * the UI (e.g. show "hard cost = GFA × constCost" inline).
 */
export function calculateScenario(input: CalcInput): ScenarioResult {
  const { parcel, scenario } = input;
  const { program, assumptions: a } = scenario;
  validateFinancialGeometryContract(program, scenario.id);

  // ─── 1. Building outputs ────────────────────────────────────────────
  // Stage 2 계약이 있으면 실제 면적이 절대 기준이다. FAR/BCR 재계산은
  // 계약이 없는 구버전 저장 시나리오에만 사용한다.
  const lotArea = D(parcel.lotArea);
  const legacyGfa = lotArea.times(D(program.far)).div(HUNDRED);
  const legacyBuildingArea = lotArea.times(D(program.bcr)).div(HUNDRED);
  const areaContract = program.areaContract;
  const gfa = D(areaContract?.constructionAreaSqm ?? legacyGfa.toNumber());
  const buildingArea = D(
    areaContract?.gradeFootprintAreaSqm ?? legacyBuildingArea.toNumber()
  );

  const contractedRevenueArea = areaContract
    ? areaContract.revenueAreas.residentialSaleSqm +
      areaContract.revenueAreas.residentialLeaseSqm +
      areaContract.revenueAreas.retailSqm
    : 0;
  const effective = areaContract
    ? {
        effectiveGFA: contractedRevenueArea,
        efficiencyRatio:
          gfa.gt(0) ? contractedRevenueArea / gfa.toNumber() : 0,
        parkingSpaces: areaContract.providedParkingSpaces,
        coreArea: areaContract.commonAreaSqm,
      }
    : calculateEffectiveGFA(program, gfa.toNumber());
  const usableGFA = D(effective.effectiveGFA);

  // 안전망: 분양가능면적이 0/음수면 이 규모로는 시행 불가 (조용한 0원 매출 방지)
  const viable = effective.effectiveGFA > 0;
  const viabilityNote = viable
    ? undefined
    : "주차·코어가 연면적을 초과 — 이 층수/규모로는 분양가능면적이 없습니다";

  // Allocate GFA across use types (revenue side)
  // 통매각(sale): 전체 연면적 기준 — Comparable 매각 단가가 실거래 "전체 연면적"
  //   기준으로 산정되므로 면적 기준을 일치시킴 (C 확정). 복도·계단·코어 포함 —
  //   시장에서 통매각은 연면적 기준으로 거래됨. usable을 곱하면 이중 할인(매출 과소).
  // 임대·근생: usable 기준 유지 (실사용 면적이 수익 창출 — 분양·임대 모델 개념).
  const gfaSale = areaContract
    ? D(areaContract.revenueAreas.residentialSaleSqm)
    : gfa.times(D(program.mix.residentialSale));
  const gfaLease = areaContract
    ? D(areaContract.revenueAreas.residentialLeaseSqm)
    : usableGFA.times(D(program.mix.residentialLease));
  const gfaRetail = areaContract
    ? D(areaContract.revenueAreas.retailSqm)
    : usableGFA.times(D(program.mix.retail));

  // ─── 2. Revenue ─────────────────────────────────────────────────────
  // Sale revenue: GFA_sale × sale price/m². Convert won → 만원.
  const revenueSale = gfaSale.times(D(a.salePricePerSqM)).div(WON_TO_MANWON);

  // Lease revenue: capitalized annual NOI via cap rate.
  // Annual NOI = monthly rent × 12 × (1 − vacancy) for the residential lease pool.
  // These internal revenue adjustments are explicit and shown in the UI.
  // They are not externally validated market coefficients.
  const stabilizationDiscount = D(
    INTERNAL_REVENUE_ASSUMPTIONS.stabilizationDiscount
  );
  const annualRentResidential = gfaLease
    .times(D(a.rentPerSqMMonth))
    .times(12)
    .times(ONE.minus(D(a.vacancyRate).div(HUNDRED)));
  const valueResidentialLease = annualRentResidential
    .div(D(a.capRate).div(HUNDRED))
    .div(WON_TO_MANWON)
    .times(stabilizationDiscount);

  // Retail rent premium is an explicit internal assumption pending local comps.
  const annualRentRetail = gfaRetail
    .times(
      D(a.rentPerSqMMonth).times(
        D(INTERNAL_REVENUE_ASSUMPTIONS.retailRentPremium)
      )
    )
    .times(12)
    .times(ONE.minus(D(a.vacancyRate).div(HUNDRED)));
  const valueRetail = annualRentRetail
    .div(D(a.capRate).div(HUNDRED))
    .div(WON_TO_MANWON)
    .times(stabilizationDiscount);

  const totalRevenue = revenueSale.plus(valueResidentialLease).plus(valueRetail);

  // ─── 3. Cost ────────────────────────────────────────────────────────
  const landCost = D(parcel.acquiredPrice);
  const demolitionCost = D(parcel.demolitionCost ?? 0);
  const basementCostMultiplier = Math.max(
    1,
    a.basementCostMultiplier ?? 1.25
  );
  const baseHardCost = areaContract
    ? D(areaContract.aboveGroundAreaSqm)
        .plus(
          D(areaContract.basementAreaSqm).times(
            D(basementCostMultiplier)
          )
        )
        .times(D(a.constCostPerSqM))
        .div(WON_TO_MANWON)
    : gfa.times(D(a.constCostPerSqM)).div(WON_TO_MANWON);
  const hardCostWithMaterial = baseHardCost.plus(
    D(areaContract?.materialAdjustmentCostManwon ?? 0)
  );
  const hardCost = hardCostWithMaterial.gt(0)
    ? hardCostWithMaterial
    : ZERO;
  const softCost = hardCost.times(D(a.softCostRate).div(HUNDRED));
  const contingency = hardCost.plus(softCost).times(D(a.contingencyRate).div(HUNDRED));

  // ─── 4. Capital structure + auditable monthly ledger ────────────────
  const constructionCost = hardCost.plus(softCost).plus(contingency);
  const projectCostExFin = landCost.plus(demolitionCost).plus(constructionCost);

  // A single monthly ledger now drives PF exposure, interest, IRR/NPV and
  // the quarterly dashboard. The funding waterfall remains a preliminary
  // underwriting assumption and is disclosed in the UI.
  const ledger = buildProjectLedger({
    parcel,
    scenario,
    revenueSale: revenueSale.toNumber(),
    revenueExit: valueResidentialLease.plus(valueRetail).toNumber(),
    hardCost: hardCost.toNumber(),
    softCost: softCost.toNumber(),
    contingency: contingency.toNumber(),
  });
  const financingCost = D(ledger.financingCost);
  const pfLoan = D(ledger.maxPfBalance);
  const equity = D(ledger.equityInvested);
  const totalMonths = D(ledger.rows.length - 1);
  const totalCost = projectCostExFin.plus(financingCost);

  // ─── 6. Profit ──────────────────────────────────────────────────────
  const profit = totalRevenue.minus(totalCost);
  const profitMargin = totalRevenue.gt(0)
    ? profit.div(totalRevenue).times(HUNDRED)
    : ZERO;

  // ─── 7. Equity cash flow from the shared ledger ────────────────────
  const monthlyCF: Decimal[] = ledger.equityCashFlows.map(D);

  // ─── 8. Metrics ─────────────────────────────────────────────────────
  // Standard IRR is only reported for a conventional cash-flow sign pattern.
  // Multiple sign changes can create multiple IRR roots; no synthetic fallback
  // is presented as IRR when the numerical method has no unique solution.
  const cashflowSigns = monthlyCF
    .filter((cashflow) => !cashflow.eq(0))
    .map((cashflow) => (cashflow.gt(0) ? 1 : -1));
  const signChanges = cashflowSigns.reduce(
    (count, sign, index) =>
      index > 0 && sign !== cashflowSigns[index - 1] ? count + 1 : count,
    0
  );
  const monthlyIRR =
    signChanges === 1 ? irr(monthlyCF, 0.01) : null;
  const irrStatus: NonNullable<ScenarioResult["irrStatus"]> =
    signChanges > 1
      ? "ambiguous"
      : monthlyIRR
        ? "calculated"
        : "not-calculated";
  const annualIRR = monthlyIRR
    ? annualizeIRR(monthlyIRR, 12).times(HUNDRED)
    : ZERO;
  const monthlyHurdleRate = Math.pow(1 + a.equityIRR / 100, 1 / 12) - 1;
  const equityNPV = npv(monthlyHurdleRate, monthlyCF);

  // Equity multiple = total positive flows / equity
  const totalPositive = monthlyCF
    .filter((cf) => cf.gt(0))
    .reduce((sum, cf) => sum.plus(cf), ZERO);
  const equityMult = equityMultiple(totalPositive, equity);

  // DSCR: stabilized NOI vs annual PF debt service.
  // Annual NOI = annual rent (residential + retail) net of vacancy.
  const stabilizedNOI = annualRentResidential
    .plus(annualRentRetail)
    .div(WON_TO_MANWON);
  // For sale-only projects there is no stabilized NOI, so DSCR is not
  // applicable. Return 0 as a transport value; the UI explicitly renders N/A.
  const annualDebtService = interestOnly(pfLoan, D(a.interestRate).div(HUNDRED));
  const dscrValue =
    annualDebtService.gt(0) && stabilizedNOI.gt(0)
      ? dscrFn(stabilizedNOI, annualDebtService)
      : ZERO;

  const maxExposure = D(ledger.maxProjectExposure);
  const breakEvenIdx = ledger.projectBreakEvenMonth;

  // ltc actual (after sizing)
  const ltcActual = projectCostExFin.gt(0)
    ? pfLoan.div(projectCostExFin).times(HUNDRED)
    : ZERO;

  return {
    scenarioId: scenario.id,
    viable,
    viabilityNote,
    gfa: gfa.toDecimalPlaces(2).toNumber(),
    effectiveGFA: effective.effectiveGFA,
    efficiencyRatio: effective.efficiencyRatio,
    parkingSpaces: effective.parkingSpaces,
    coreArea: effective.coreArea,
    buildingArea: buildingArea.toDecimalPlaces(2).toNumber(),

    revenueSale: toManWon(revenueSale),
    revenueLease: toManWon(valueResidentialLease),
    revenueRetail: toManWon(valueRetail),
    totalRevenue: toManWon(totalRevenue),

    landCost: toManWon(landCost),
    demolitionCost: toManWon(demolitionCost),
    hardCost: toManWon(hardCost),
    softCost: toManWon(softCost),
    financingCost: toManWon(financingCost),
    contingency: toManWon(contingency),
    totalCost: toManWon(totalCost),

    profit: toManWon(profit),
    // 공사비 범위 손익 (Low -15% / High +20% — 상방 리스크 비대칭, 금융비 2차 효과 미반영)
    profitAtLowCost: toManWon(
      profit.plus(constructionCost.times(D(1 - CONST_COST_RANGE.low)))
    ),
    profitAtHighCost: toManWon(
      profit.minus(constructionCost.times(D(CONST_COST_RANGE.high - 1)))
    ),
    constructionCostLow: toManWon(constructionCost.times(D(CONST_COST_RANGE.low))),
    constructionCostHigh: toManWon(constructionCost.times(D(CONST_COST_RANGE.high))),
    profitMargin: toPct(profitMargin),
    equity: toManWon(equity),
    pfLoan: toManWon(pfLoan),
    ltc: toPct(ltcActual),

    npv: toManWon(equityNPV),
    irr: toPct(annualIRR),
    irrStatus,
    equityMultiple: equityMult.toDecimalPlaces(2).toNumber(),
    dscr: dscrValue.toDecimalPlaces(2).toNumber(),
    paybackMonths: breakEvenIdx,

    maxExposure: toManWon(maxExposure),
    breakEvenQuarter: null, // set by PF schedule below

    totalMonths: totalMonths.toNumber(),
  };
}

/**
 * Default building program for a given building type.
 *
 * These are starting points the user edits. Sourced from common Korean
 * mid-rise mixed-use patterns; should be tuned to a parcel's specific
 * zoning constraints in production (link to the regulation engine).
 */
export function defaultProgram(
  type: BuildingProgram["type"],
  maxFAR: number,
  maxBCR: number
): BuildingProgram {
  switch (type) {
    case "officetel":
      return {
        type,
        far: Math.min(maxFAR, 220),
        bcr: Math.min(maxBCR, 58),
        floorsAbove: 9,
        floorsBelow: 2,
        units: { residential: 22, retail: 4 },
        mix: { residentialSale: 0.78, residentialLease: 0.08, retail: 0.14 },
      };
    case "urban-housing":
      return {
        type,
        far: Math.min(maxFAR, 200),
        bcr: Math.min(maxBCR, 55),
        floorsAbove: 8,
        floorsBelow: 1,
        units: { residential: 28, retail: 0 },
        mix: { residentialSale: 0.92, residentialLease: 0.08, retail: 0 },
      };
    case "retail":
      return {
        type,
        far: Math.min(maxFAR, 165),
        bcr: Math.min(maxBCR, 56),
        floorsAbove: 6,
        floorsBelow: 1,
        units: { residential: 0, retail: 12 },
        mix: { residentialSale: 0, residentialLease: 0, retail: 1 },
      };
    case "coliving":
      return {
        type,
        far: Math.min(maxFAR, 225),
        bcr: Math.min(maxBCR, 60),
        floorsAbove: 10,
        floorsBelow: 1,
        units: { residential: 46, retail: 2 },
        mix: { residentialSale: 0, residentialLease: 0.92, retail: 0.08 },
      };
    case "single-house":
      return {
        type,
        far: Math.min(maxFAR, 180), // 단독: 150-200%
        bcr: Math.min(maxBCR, 50),
        floorsAbove: 3, // 단독 2-4층
        floorsBelow: 0,
        units: { residential: 1, retail: 0 },
        mix: { residentialSale: 1.0, residentialLease: 0, retail: 0 }, // 100% 매매
      };
    case "multi-family":
      return {
        type,
        far: Math.min(maxFAR, 220), // 다가구: 200-250%
        bcr: Math.min(maxBCR, 55),
        floorsAbove: 4, // 다가구 3-5층
        floorsBelow: 1,
        units: { residential: 10, retail: 0 }, // 호수 5-15
        mix: { residentialSale: 1.0, residentialLease: 0, retail: 0 }, // 통매매
      };
    case "office":
      return {
        type,
        far: Math.min(maxFAR, 220),
        bcr: Math.min(maxBCR, 58),
        floorsAbove: 10,
        floorsBelow: 2,
        units: { residential: 0, retail: 2 },
        mix: { residentialSale: 0, residentialLease: 0.94, retail: 0.06 },
      };
    case "mixed":
    default:
      return {
        type: "mixed",
        far: Math.min(maxFAR, 210),
        bcr: Math.min(maxBCR, 58),
        floorsAbove: 9,
        floorsBelow: 2,
        units: { residential: 18, retail: 6 },
        mix: { residentialSale: 0.55, residentialLease: 0.2, retail: 0.25 },
      };
  }
}

/**
 * External validation pending. These non-editable revenue adjustments are
 * exposed in the dashboard rather than hidden as magic constants.
 */
export const INTERNAL_REVENUE_ASSUMPTIONS = {
  stabilizationDiscount: 0.85,
  retailRentPremium: 1.2,
} as const;

/**
 * Unvalidated construction-cost stress range. It is a comparison band, not a
 * statistical confidence interval. Financing second-order effects are omitted.
 */
export const CONST_COST_RANGE = { low: 0.85, high: 1.2 } as const;

/**
 * 기본 가정값 — 서울 외곽 소형 주거(다가구·다세대) 신축 기준.
 * 모든 값은 "가정값"이며 출처·성격은 ASSUMPTION_META 참조 (C 원칙: 근거 없는 숫자 금지).
 * 사용자가 overrides 화면에서 조정 가능. 정확한 견적·시세 아님.
 */
export function defaultAssumptions(): AssumptionSet {
  return {
    // 내부 초기값. 대상지 임대사례로 교체해야 한다.
    rentPerSqMMonth: 21_000,
    // 통매각 연면적 단가 내부 초기값. 대상지 실거래 사례로 교체해야 한다.
    salePricePerSqM: 4_500_000,
    vacancyRate: 4.5,
    // Cap rate: 서울 주거 수익률 수준
    capRate: 4.5,

    // 내부 초기값. 구조·마감·지하·현장조건을 반영한 시공사 견적으로 교체해야 한다.
    constCostPerSqM: 2_300_000,
    basementCostMultiplier: 1.25,
    softCostRate: 12, // 설계·감리·인허가 등 — 공사비 대비 비율 (공공 요율 참고)
    contingencyRate: 5, // 예비비 5~10% 범위의 하단

    // PF: 통상 LTC 60~70%
    ltcTarget: 70,
    interestRate: 5.8,
    equityIRR: 15,

    leaseUpMonths: 8,
    salesPaceMonthlyPct: 12,

    designMonths: 6,
    constructionMonths: 14,
    saleOutMonths: 6,
  };
}

/** 가정값의 성격 분류 (C 원칙 — 하드코딩 숨김 금지, 출처·계산식 표시) */
export interface AssumptionMeta {
  label: string;
  unit: string;
  /** 참고단가=공공 단가표 기반 / 시장값권장=실거래·시세로 대체해야 / 가정값=실무 관행 */
  kind: "참고 단가" | "시장값 권장" | "가정값";
  basis: string;
}

export const ASSUMPTION_META: Partial<Record<keyof AssumptionSet, AssumptionMeta>> = {
  basementCostMultiplier: {
    label: "지하 공사비 가중치",
    unit: "배",
    kind: "가정값",
    basis:
      "지상 기준 공사비의 1.25배 내부 초기값. 흙막이·굴토·토질·지하수 조건과 시공사 견적으로 교체해야 함.",
  },
  constCostPerSqM: {
    label: "공사비",
    unit: "원/㎡",
    kind: "가정값",
    basis:
      "2,300,000원/㎡ 내부 초기값. 공공 단가표의 특정 연도·유형 보정으로 검증되지 않았으며 시공사 견적으로 교체해야 함.",
  },
  salePricePerSqM: {
    label: "매각 단가 (통매각)",
    unit: "원/㎡",
    kind: "시장값 권장",
    basis:
      "통매각 연면적 단가 4,500,000원/㎡ 내부 초기값. 대상지·유사 건물 실거래 사례로 교체해야 하며 감정평가액이 아님.",
  },
  rentPerSqMMonth: {
    label: "임대료",
    unit: "원/㎡·월",
    kind: "시장값 권장",
    basis: "21,000원/㎡·월 내부 초기값. 대상지 임대사례로 교체 필요.",
  },
  vacancyRate: {
    label: "공실률",
    unit: "%",
    kind: "가정값",
    basis: "임대 안정화 후 통상 공실 가정.",
  },
  capRate: {
    label: "Cap rate",
    unit: "%",
    kind: "가정값",
    basis: "서울 주거 수익률 수준 가정. 매각가 산정에 사용.",
  },
  softCostRate: {
    label: "설계·감리 등",
    unit: "% of 공사비",
    kind: "참고 단가",
    basis: "설계·감리·인허가 부대비 — 공공 대가 요율 참고한 비율값.",
  },
  contingencyRate: {
    label: "예비비",
    unit: "% of 공사비",
    kind: "가정값",
    basis: "물가·설계변경 대응 5~10% 관행 범위의 하단.",
  },
  ltcTarget: {
    label: "PF 비율(LTC)",
    unit: "%",
    kind: "가정값",
    basis: "통상 60~70% 범위. 사업·신용에 따라 달라짐.",
  },
  interestRate: {
    label: "PF 금리",
    unit: "%",
    kind: "시장값 권장",
    basis: "브릿지·PF 금리는 시점·신용별 변동 — 금융기관 조건으로 조정 필요.",
  },
};

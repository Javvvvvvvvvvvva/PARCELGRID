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
 *   - Profit, margin, IRR, take-out DSCR, equity multiple
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

import { D, ZERO, HUNDRED, Decimal } from "./math";
import { facadeFingerprint, FACADE_COST_VERSION } from "@/lib/planning/facade-quantities";
import { calculateEffectiveGFA } from "@/lib/finance/parking-core";
import { buildProjectLedger } from "@/lib/finance/project-ledger";
import { quantityAdjustmentForBase, quantityCostContractSchema } from "@/lib/planning/quantity-cost-contract";
import { validateFullQuoteCostContract } from "@/lib/planning/full-quote-cost-contract";
import { MAX_CONSTRUCTION_QUOTE_AMOUNT_WON } from "@/lib/planning/construction-quote";
import {
  DEFAULT_RETAIL_RENT_PREMIUM,
  DEFAULT_STABILIZATION_FACTOR_PCT,
  DEFAULT_OPERATING_EXPENSE_RATE_PCT,
  FINANCIAL_REVENUE_POOL_KEYS,
  LEGACY_REVENUE_PRICING_MODEL_VERSION,
  REVENUE_PRICING_MODEL_VERSION,
  REVENUE_VALUATION_MODEL_VERSION,
  normalizeRevenueAreaPools,
  revenueAreaForPool,
  revenueAreaTotals,
  revenuePricingForScenario,
  valueRevenueAreaPools,
} from "@/lib/finance/revenue-contract";
import { validateAssumptionSet } from "@/lib/finance/assumption-validation";
import { underwriteTakeoutLoan } from "@/lib/finance/takeout-underwriting";
import { buildHoldPeriodLedger } from "@/lib/finance/hold-period-ledger";
import { STAGE2_ECONOMICS_CONTRACT_VERSION } from "@/lib/finance/types";
import {
  npv,
  irr,
  annualizeIRR,
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
const QUANTITY_AREA_ROUNDING_TOLERANCE_SQM = 0.0051;

export const FIXED_FULL_QUOTE_COST_REASON = "채택한 전체 공사 견적액은 고정입니다. 기본 공사단가 변경으로 견적 증감이나 공사비 한도를 산출하지 않습니다.";

/** Validate against the adopted plan and original inputs, never stress assumptions. */
export function fullQuoteCostForScenario(scenario: Pick<Scenario, "id" | "program">) {
  const area = scenario.program.areaContract;
  if (area?.fullQuoteCost === undefined) return undefined;
  const quote = validateFullQuoteCostContract(area.fullQuoteCost);
  if (area.quantityCostAdjustment !== undefined) {
    throw new Error("전체 공사 견적과 상세 수량 교체 원가를 중복 적용할 수 없습니다.");
  }
  const inputs = area.stage2Economics?.inputs;
  if (quote.scenarioId !== scenario.id || quote.scenarioId !== area.sourceScenarioId ||
      quote.scenarioVersion !== area.sourceScenarioVersion || !inputs ||
      quote.inputs.constructionCostPerSqmWon !== inputs.constructionCostPerSqmWon ||
      quote.inputs.basementCostMultiplier !== inputs.basementCostMultiplier) {
    throw new Error("Stage 2/3 전체 공사 견적의 계획안·버전·원래 공사비 입력이 잠금 계약과 다릅니다.");
  }
  return quote;
}

function roundRevenuePoolAmounts(
  amounts: ScenarioResult["revenueByPool"],
): ScenarioResult["revenueByPool"] {
  return Object.fromEntries(
    FINANCIAL_REVENUE_POOL_KEYS.map((pool) => [
      pool,
      toManWon(D(amounts[pool])),
    ]),
  ) as ScenarioResult["revenueByPool"];
}

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

  fullQuoteCostForScenario({ id: scenarioId, program });

  const facade = contract.facadeCost;
  if (facade) {
    if (facade.version !== FACADE_COST_VERSION || !Array.isArray(facade.rows) || facade.rows.length > 5 ||
        !Number.isFinite(facade.facadeAreaSqm) || facade.facadeAreaSqm < 0 ||
        facade.rows.some(row => !Number.isFinite(row.areaSqm) || row.areaSqm < 0 ||
          (row.adjustmentWon !== null && (!Number.isFinite(row.adjustmentWon) ||
            row.baselineWonPerSqm === null || row.selectedWonPerSqm === null ||
            !Number.isFinite(row.baselineWonPerSqm) || !Number.isFinite(row.selectedWonPerSqm) ||
            row.baselineWonPerSqm < 0 || row.selectedWonPerSqm < 0 ||
            new Decimal(row.areaSqm).times(new Decimal(row.selectedWonPerSqm).minus(row.baselineWonPerSqm)).minus(row.adjustmentWon).abs().gt(0.000001)))) ||
        facade.costKey !== facadeFingerprint({ version: facade.version, quantityKey: facade.quantities?.quantityKey,
          pricingMode: facade.pricingMode, rows: facade.rows })) {
      throw new Error("외벽 수량·단가 원시 계약을 검증하지 못했습니다.");
    }
    const rowArea = facade.rows.reduce((sum, row) => sum + row.areaSqm, 0);
    const rowWon = facade.rows.reduce((sum, row) => sum + (row.adjustmentWon ?? 0), 0);
    if (!Number.isFinite(facade.adjustmentManwon) ||
        Math.abs(facade.adjustmentManwon - contract.materialAdjustmentCostManwon) > 0.000001 ||
        Math.abs(rowArea - facade.facadeAreaSqm) > 0.000001 ||
        Math.abs(rowWon / 10000 - facade.adjustmentManwon) > 0.000001) {
      throw new Error("Stage 2/3 외벽 수량·재료비 합계가 일치하지 않습니다.");
    }
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
    ...FINANCIAL_REVENUE_POOL_KEYS.map((pool) => {
      const areas = normalizeRevenueAreaPools(contract.revenueAreas);
      switch (pool) {
        case "residentialSale":
          return areas.residentialSaleSqm;
        case "retailSale":
          return areas.retailSaleSqm;
        case "officeSale":
          return areas.officeSaleSqm;
        case "residentialLease":
          return areas.residentialLeaseSqm;
        case "retailLease":
          return areas.retailLeaseSqm;
        case "officeLease":
          return areas.officeLeaseSqm;
      }
    }),
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

  const revenueArea = revenueAreaTotals(contract.revenueAreas).totalSqm;
  const dwellingCost = contract.dwellingCostAdjustment;
  if (dwellingCost) {
    const expected = Math.max(0, dwellingCost.unitCount - dwellingCost.baselineDwellingCount) *
      dwellingCost.costPerAdditionalUnitWon / 10_000;
    if (!Number.isInteger(dwellingCost.unitCount) || dwellingCost.unitCount < 0 ||
        dwellingCost.unitCount !== program.units.residential ||
        !Number.isInteger(dwellingCost.baselineDwellingCount) || dwellingCost.baselineDwellingCount < 0 ||
        !Number.isFinite(dwellingCost.costPerAdditionalUnitWon) || dwellingCost.costPerAdditionalUnitWon < 0 ||
        !Number.isFinite(dwellingCost.costManwon) || Math.abs(expected - dwellingCost.costManwon) > 0.01) {
      throw new Error("Stage 2/3 세대 증설 비용이 세대수·단가와 일치하지 않습니다.");
    }
  }
  if (contract.quantityCostAdjustment !== undefined) {
    const parsed = quantityCostContractSchema.safeParse(contract.quantityCostAdjustment);
    if (!parsed.success) {
      throw new Error("Stage 2/3 상세 수량 원가 계약의 형식이 올바르지 않습니다.");
    }
    const quantity = parsed.data;
    const lockedInputs = contract.stage2Economics?.inputs;
    if (!lockedInputs ||
        quantity.inputs.constructionCostPerSqmWon !== lockedInputs.constructionCostPerSqmWon ||
        quantity.inputs.basementCostMultiplier !== lockedInputs.basementCostMultiplier) {
      throw new Error("Stage 2/3 상세 수량 원가의 원래 단가·지하 가중치가 잠금 입력과 다릅니다.");
    }
    const areaPairs = [
      [quantity.constructionAreas.aboveGroundSqm, contract.aboveGroundAreaSqm],
      [quantity.constructionAreas.basementSqm, contract.basementAreaSqm],
      [quantity.constructionAreas.aboveGroundSqm + quantity.constructionAreas.basementSqm, contract.constructionAreaSqm],
    ];
    if (areaPairs.some(([exact, rounded]) => Math.abs(exact - rounded) > QUANTITY_AREA_ROUNDING_TOLERANCE_SQM)) {
      throw new Error("Stage 2/3 상세 수량 원가의 원래 면적이 반올림된 공사면적과 다릅니다.");
    }
    if ((dwellingCost?.costManwon ?? 0) > 0 && quantity.lines.some(line =>
      line.treatment === "replace-allowance" && (line.id === "kitchenCount" || line.id === "bathroomCount"))) {
      throw new Error("Stage 2/3 주방·욕실 교체 원가와 추가 세대 가산비가 중복됩니다.");
    }
  }
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

  if (contract.schemaVersion === "stage2-finance-area-2026.2") {
    const projection = contract.revenueProjection;
    const stage2Economics = contract.stage2Economics;
    if (!projection || !stage2Economics) {
      throw new Error(
        "Stage 2/3 2026.2 계약에 수익 또는 비용 잠금 스냅샷이 없습니다."
      );
    }
    if (stage2Economics.modelVersion !== STAGE2_ECONOMICS_CONTRACT_VERSION) {
      throw new Error(
        "Stage 2/3 비용 잠금 스냅샷 버전이 현재 금융 원장과 일치하지 않습니다."
      );
    }
    if (
      projection.modelVersion !== REVENUE_VALUATION_MODEL_VERSION ||
      (projection.pricing.modelVersion !== REVENUE_PRICING_MODEL_VERSION &&
        projection.pricing.modelVersion !==
          LEGACY_REVENUE_PRICING_MODEL_VERSION)
    ) {
      throw new Error(
        "Stage 2/3 수익 잠금 스냅샷 버전이 현재 NOI 계산 계약과 일치하지 않습니다."
      );
    }
    for (const pool of FINANCIAL_REVENUE_POOL_KEYS) {
      const contractArea = revenueAreaForPool(contract.revenueAreas, pool);
      const projectedArea = revenueAreaForPool(projection.areas, pool);
      if (Math.abs(contractArea - projectedArea) > AREA_CONTRACT_TOLERANCE_SQM) {
        throw new Error(
          `Stage 2/3 ${pool} 면적과 수익 스냅샷 면적이 일치하지 않습니다.`
        );
      }
    }
    const recalculatedProjection = valueRevenueAreaPools(
      projection.areas,
      projection.pricing
    );
    for (const pool of FINANCIAL_REVENUE_POOL_KEYS) {
      const lockedValues = [
        projection.valueByPoolManwon[pool],
        projection.annualPotentialRentByPoolManwon[pool],
        projection.annualEffectiveGrossIncomeByPoolManwon[pool],
        projection.annualOperatingExpenseByPoolManwon[pool],
        projection.annualNoiByPoolManwon[pool],
      ];
      const recalculatedValues = [
        recalculatedProjection.valueByPoolManwon[pool],
        recalculatedProjection.annualPotentialRentByPoolManwon[pool],
        recalculatedProjection.annualEffectiveGrossIncomeByPoolManwon[pool],
        recalculatedProjection.annualOperatingExpenseByPoolManwon[pool],
        recalculatedProjection.annualNoiByPoolManwon[pool],
      ];
      if (
        lockedValues.some(
          (value, index) =>
            !Number.isFinite(value) ||
            Math.abs(value - recalculatedValues[index]) > 0.05,
        )
      ) {
        throw new Error(
          `Stage 2/3 ${pool} 잠금 임대수입·운영비·NOI·매출이 계산 계약과 일치하지 않습니다.`
        );
      }
    }
  }
}

export interface CalcInput {
  parcel: Parcel;
  scenario: Scenario;
}

export const FULL_QUOTE_STRESS_VERSION = "full-quote-stress-2026.1" as const;
export interface FullQuoteCostStress {
  version: typeof FULL_QUOTE_STRESS_VERSION;
  kind: "illustrative-cost-increase";
  sourceKey: string;
  scenarioId: string;
  scenarioVersion: number;
  originalQuoteTotalWon: number;
  increasePct: number;
  additionalCostWon: number;
  stressedCostWon: number;
}

/** Read-only risk overlay, never a replacement quote or a saved base calculation. */
export function calculateScenarioWithFullQuoteStress(input: CalcInput, increasePct: number): {
  basis: FullQuoteCostStress;
  result: ScenarioResult;
} {
  const quote = fullQuoteCostForScenario(input.scenario);
  if (!quote) throw new Error("전체 견적 증액 분석에는 채택된 전체 공사 견적이 필요합니다.");
  if (!Number.isFinite(increasePct) || increasePct < 0 || increasePct > 100) {
    throw new Error("견적 대비 추가 공사비는 0~100%의 유한한 숫자여야 합니다.");
  }
  const additional = D(quote.totalWon).times(D(increasePct)).div(HUNDRED);
  const stressed = D(quote.totalWon).plus(additional);
  if (stressed.gt(MAX_CONSTRUCTION_QUOTE_AMOUNT_WON)) {
    throw new Error("증액 가정 적용 공사비가 분석 금액 한도를 초과했습니다.");
  }
  return {
    basis: {
      version: FULL_QUOTE_STRESS_VERSION, kind: "illustrative-cost-increase",
      sourceKey: quote.sourceKey, scenarioId: quote.scenarioId, scenarioVersion: quote.scenarioVersion,
      originalQuoteTotalWon: quote.totalWon, increasePct,
      additionalCostWon: additional.toNumber(), stressedCostWon: stressed.toNumber(),
    },
    result: calculateScenarioLedger(input, additional),
  };
}

export function validateScenarioFinancialInputs(
  parcel: Parcel,
  scenario: Scenario,
): void {
  const errors: string[] = [];

  if (!Number.isFinite(parcel.lotArea) || parcel.lotArea <= 0) {
    errors.push("대지면적은 0보다 큰 유한한 숫자여야 합니다.");
  }
  if (!Number.isFinite(parcel.acquiredPrice) || parcel.acquiredPrice < 0) {
    errors.push("부동산 총 취득대금은 0 이상의 유한한 숫자여야 합니다.");
  }
  if (
    parcel.demolitionCost !== undefined &&
    (!Number.isFinite(parcel.demolitionCost) || parcel.demolitionCost < 0)
  ) {
    errors.push("철거비는 0 이상의 유한한 숫자여야 합니다.");
  }

  const mixEntries = Object.entries(scenario.program.mix);
  for (const [label, value] of mixEntries) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      errors.push(`용도 배분 ${label}은(는) 0 이상 1 이하여야 합니다.`);
    }
  }
  const mixTotal = mixEntries.reduce((sum, [, value]) => sum + value, 0);
  if (Math.abs(mixTotal - 1) > 0.000001) {
    errors.push("주거 매각·주거 임대·근생 용도 배분 합계는 100%여야 합니다.");
  }

  for (const invalid of validateAssumptionSet(scenario.assumptions)) {
    errors.push(...invalid.errors);
  }

  if (errors.length > 0) {
    throw new Error(`사업성 입력값을 확인하세요: ${errors.join(" ")}`);
  }
}

function hardConstructionCost(input: CalcInput, unitCostPerSqmWon: number): Decimal {
  const { parcel, scenario } = input;
  const { program, assumptions } = scenario;
  const areaContract = program.areaContract;
  if (areaContract?.fullQuoteCost !== undefined) {
    return D(areaContract.fullQuoteCost.totalWon).div(WON_TO_MANWON);
  }
  const quantityAreas = areaContract?.quantityCostAdjustment?.constructionAreas;
  const weightedArea = areaContract
    ? D(quantityAreas?.aboveGroundSqm ?? areaContract.aboveGroundAreaSqm).plus(
        D(quantityAreas?.basementSqm ?? areaContract.basementAreaSqm).times(
          Math.max(1, assumptions.basementCostMultiplier ?? 1.25),
        ),
      )
    : D(D(parcel.lotArea).times(D(program.far)).div(HUNDRED).toNumber());
  const baseHardCost = weightedArea.times(D(unitCostPerSqmWon)).div(WON_TO_MANWON);
  const quantityAdjustment = areaContract?.quantityCostAdjustment !== undefined
    ? quantityAdjustmentForBase(areaContract.quantityCostAdjustment, baseHardCost.toNumber())
    : 0;
  return baseHardCost.plus(D(areaContract?.materialAdjustmentCostManwon ?? 0))
    .plus(D(areaContract?.dwellingCostAdjustment?.costManwon ?? 0))
    .plus(D(quantityAdjustment));
}

const NEGATIVE_HARD_COST_MESSAGE = "원가 차감액이 기본 공사비를 초과합니다. 음수 공사비를 0원으로 대체하지 않습니다.";

/** Find the valid side of the cost boundary without running monthly ledgers. */
export function minimumConstructionCostRate(input: CalcInput): number {
  validateScenarioFinancialInputs(input.parcel, input.scenario);
  validateFinancialGeometryContract(input.scenario.program, input.scenario.id);
  let valid = input.scenario.assumptions.constCostPerSqM;
  if (hardConstructionCost(input, valid).lt(0)) throw new Error(NEGATIVE_HARD_COST_MESSAGE);
  if (hardConstructionCost(input, 0).gte(0)) return 0;
  let invalid = 0;
  // Keep an evaluated valid endpoint, including at fractional/quantity-credit boundaries.
  for (let index = 0; index < 64; index += 1) {
    const candidate = invalid + (valid - invalid) / 2;
    if (candidate === invalid || candidate === valid) break;
    if (hardConstructionCost(input, candidate).lt(0)) invalid = candidate;
    else valid = candidate;
  }
  return valid;
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
  return calculateScenarioLedger(input, ZERO);
}

function calculateScenarioLedger(input: CalcInput, additionalQuoteCostWon: Decimal): ScenarioResult {
  const { parcel, scenario } = input;
  const { program, assumptions: a } = scenario;
  validateScenarioFinancialInputs(parcel, scenario);
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
    ? revenueAreaTotals(areaContract.revenueAreas).totalSqm
    : 0;
  const effective = areaContract
    ? {
        effectiveGFA: contractedRevenueArea,
        efficiencyRatio:
          gfa.gt(0) ? contractedRevenueArea / gfa.toNumber() : 0,
        parkingSpaces: areaContract.providedParkingSpaces,
        coreArea: areaContract.commonAreaSqm,
      }
    : calculateEffectiveGFA(program, gfa.toNumber(), {
        context: { address: parcel.address },
      });
  const usableGFA = D(effective.effectiveGFA);

  // 안전망: 분양가능면적이 0/음수면 이 규모로는 시행 불가 (조용한 0원 매출 방지)
  const viable = effective.effectiveGFA > 0;
  const viabilityNote = viable
    ? undefined
    : "주차·코어가 연면적을 초과 — 이 층수/규모로는 분양가능면적이 없습니다";

  // ─── 2. Revenue ─────────────────────────────────────────────────────
  // Current Stage 2 contracts carry six explicit use × disposition pools.
  // Legacy programs are normalized into those pools before the same pricing
  // function is used, so office lease never receives the retail premium.
  const revenueAreas = areaContract
    ? normalizeRevenueAreaPools(areaContract.revenueAreas)
    : {
        residentialSaleSqm: gfa
          .times(D(program.mix.residentialSale))
          .toNumber(),
        retailSaleSqm: 0,
        officeSaleSqm: 0,
        residentialLeaseSqm:
          program.type === "office"
            ? 0
            : usableGFA.times(D(program.mix.residentialLease)).toNumber(),
        retailLeaseSqm: usableGFA.times(D(program.mix.retail)).toNumber(),
        officeLeaseSqm:
          program.type === "office"
            ? usableGFA.times(D(program.mix.residentialLease)).toNumber()
            : 0,
      };
  const scenarioPricing = revenuePricingForScenario(scenario);
  const revenueProjection = valueRevenueAreaPools(revenueAreas, scenarioPricing);
  const revenueSale = D(revenueProjection.saleRevenueManwon);
  const valueResidentialLease = D(
    revenueProjection.valueByPoolManwon.residentialLease
  );
  const valueRetail = D(
    revenueProjection.valueByPoolManwon.retailLease
  ).plus(D(revenueProjection.valueByPoolManwon.officeLease));
  const totalRevenue = D(revenueProjection.totalRevenueManwon);

  // ─── 3. Cost ────────────────────────────────────────────────────────
  const landCost = D(parcel.acquiredPrice);
  const demolitionCost = D(parcel.demolitionCost ?? 0);
  const hardCostWithMaterial = hardConstructionCost(input, a.constCostPerSqM)
    .plus(additionalQuoteCostWon.div(WON_TO_MANWON));
  if (hardCostWithMaterial.lt(0)) {
    throw new Error(NEGATIVE_HARD_COST_MESSAGE);
  }
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
    revenueByPool: revenueProjection.valueByPoolManwon,
    hardCost: hardCost.toNumber(),
    softCost: softCost.toNumber(),
    contingency: contingency.toNumber(),
  });
  const financingCost = D(ledger.financingCost);
  const acquisitionTax = D(ledger.additionalCosts.acquisitionTax);
  const acquisitionOtherCost = D(
    ledger.additionalCosts.acquisitionOtherCost,
  );
  const tenantRelocationCost = D(
    ledger.additionalCosts.tenantRelocationCost,
  );
  const pfLoan = D(ledger.maxPfBalance);
  const equity = D(ledger.equityInvested);
  const totalMonths = D(ledger.rows.length - 1);
  const totalCost = projectCostExFin
    .plus(acquisitionTax)
    .plus(acquisitionOtherCost)
    .plus(tenantRelocationCost)
    .plus(financingCost);

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

  const stabilizedNOI = D(revenueProjection.annualNoiManwon);
  const takeout = underwriteTakeoutLoan({
    stabilizedValueManwon: revenueProjection.capitalizedLeaseValueManwon,
    stabilizedNoiManwon: stabilizedNOI.toNumber(),
    pfBalanceToRefinanceManwon:
      ledger.pfBalanceAtRetainedLeaseRefinance,
    terms: {
      maxLtvPct: a.takeoutLtv ?? 0,
      annualInterestRatePct: a.takeoutInterestRate ?? 0,
      amortizationYears: a.takeoutAmortizationYears ?? 0,
      loanTermYears: a.takeoutLoanTermYears ?? 0,
      paymentDeferralMonths: a.takeoutPaymentDeferralMonths ?? 0,
      interestOnlyMonths: a.takeoutInterestOnlyMonths ?? 0,
      rateResetMonths: a.takeoutRateResetMonths ?? 0,
      annualRateChangePct: a.takeoutAnnualRateChange ?? 0,
      rateFloorPct: a.takeoutRateFloor ?? 0,
      rateCapPct: a.takeoutRateCap ?? 0,
      dsraMonths: a.takeoutDsraMonths ?? 0,
      minimumDscr: a.takeoutMinDscr ?? 0,
      loanCommitmentManwon: a.takeoutLoanCommitmentManwon ?? 0,
      upfrontFeeRatePct: a.takeoutFeeRate ?? 0,
    },
  });
  const annualPotentialRent = D(
    revenueProjection.annualPotentialRentByPoolManwon.residentialLease,
  )
    .plus(revenueProjection.annualPotentialRentByPoolManwon.retailLease)
    .plus(revenueProjection.annualPotentialRentByPoolManwon.officeLease);
  const annualOperatingExpense = D(
    revenueProjection.annualOperatingExpenseByPoolManwon.residentialLease,
  )
    .plus(revenueProjection.annualOperatingExpenseByPoolManwon.retailLease)
    .plus(revenueProjection.annualOperatingExpenseByPoolManwon.officeLease);
  const hold = buildHoldPeriodLedger({
    developmentEquityCashFlowsManwon: ledger.equityCashFlows,
    saleRevenueManwon: revenueProjection.saleRevenueManwon,
    capitalizedLeaseValueManwon:
      revenueProjection.capitalizedLeaseValueManwon,
    stabilizedAnnualPotentialRentManwon: annualPotentialRent.toNumber(),
    stabilizedAnnualOperatingExpenseManwon:
      annualOperatingExpense.toNumber(),
    stabilizedAnnualNoiManwon: stabilizedNOI.toNumber(),
    leaseAreaSqm: revenueAreaTotals(revenueAreas).leaseSqm,
    vacancyRatePct: a.vacancyRate,
    equityHurdleRatePct: a.equityIRR,
    takeout,
    terms: {
      holdPeriodYears: a.holdPeriodYears ?? 0,
      annualRentGrowthRatePct: a.annualRentGrowthRate ?? 0,
      annualExpenseGrowthRatePct: a.annualExpenseGrowthRate ?? 0,
      rentFreeMonths: a.rentFreeMonths ?? 0,
      tenantImprovementPerSqMWon: a.tenantImprovementPerSqM ?? 0,
      leasingCommissionRatePct: a.leasingCommissionRate ?? 0,
      securityDepositMonths: a.securityDepositMonths ?? 0,
      tenantLeaseTermMonths: a.tenantLeaseTermMonths ?? 0,
      tenantRenewalProbabilityPct: a.tenantRenewalProbability ?? 0,
      renewalRentAdjustmentRatePct: a.renewalRentAdjustmentRate ?? 0,
      renewalRentFreeMonths: a.renewalRentFreeMonths ?? 0,
      replacementDowntimeMonths: a.replacementDowntimeMonths ?? 0,
      replacementRentFreeMonths: a.replacementRentFreeMonths ?? 0,
      replacementTenantImprovementPerSqMWon:
        a.replacementTenantImprovementPerSqM ?? 0,
      replacementLeasingCommissionRatePct:
        a.replacementLeasingCommissionRate ?? 0,
      replacementReservePerSqMYearWon:
        a.replacementReservePerSqMYear ?? 0,
      majorRepairYear: a.majorRepairYear ?? 0,
      majorRepairCostManwon: a.majorRepairCostManwon ?? 0,
      exitCapRatePct: a.holdExitCapRate ?? 0,
      exitSellingCostRatePct: a.exitSellingCostRate ?? 0,
    },
  });
  const dscrValue = D(takeout.dscr ?? 0);

  const maxExposure = D(ledger.maxProjectExposure);
  const breakEvenIdx = ledger.projectBreakEvenMonth;

  // ltc actual (after sizing)
  const ltcActual = constructionCost.gt(0)
    ? pfLoan.div(constructionCost).times(HUNDRED)
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
    revenueByPool: roundRevenuePoolAmounts(
      revenueProjection.valueByPoolManwon
    ),
    annualPotentialRentByPool: roundRevenuePoolAmounts(
      revenueProjection.annualPotentialRentByPoolManwon,
    ),
    annualEffectiveGrossIncomeByPool: roundRevenuePoolAmounts(
      revenueProjection.annualEffectiveGrossIncomeByPoolManwon,
    ),
    annualOperatingExpenseByPool: roundRevenuePoolAmounts(
      revenueProjection.annualOperatingExpenseByPoolManwon,
    ),
    annualNoiByPool: roundRevenuePoolAmounts(
      revenueProjection.annualNoiByPoolManwon
    ),
    totalRevenue: toManWon(totalRevenue),

    landCost: toManWon(landCost),
    acquisitionTax: toManWon(acquisitionTax),
    acquisitionOtherCost: toManWon(acquisitionOtherCost),
    demolitionCost: toManWon(demolitionCost),
    tenantRelocationCost: toManWon(tenantRelocationCost),
    hardCost: toManWon(hardCost),
    softCost: toManWon(softCost),
    interestCost: toManWon(D(ledger.interestCost)),
    pfFee: toManWon(D(ledger.additionalCosts.pfFee)),
    trustFee: toManWon(D(ledger.additionalCosts.trustFee)),
    financingCost: toManWon(financingCost),
    contingency: toManWon(contingency),
    totalCost: toManWon(totalCost),

    profit: toManWon(profit),
    profitUnroundedManwon: profit.toNumber(),
    profitMargin: toPct(profitMargin),
    equity: toManWon(equity),
    pfLoan: toManWon(pfLoan),
    pfCommitment: toManWon(D(ledger.pfCommitment)),
    ltc: toPct(ltcActual),
    funding: {
      status: ledger.funding.status,
      equityCommitmentManwon:
        ledger.funding.equityCommitmentManwon == null
          ? null
          : toManWon(D(ledger.funding.equityCommitmentManwon)),
      requiredEquityManwon: toManWon(
        D(ledger.funding.requiredEquityManwon),
      ),
      shortfallManwon: toManWon(D(ledger.funding.shortfallManwon)),
      firstShortfallMonth: ledger.funding.firstShortfallMonth,
      pfCommitmentManwon: toManWon(
        D(ledger.funding.pfCommitmentManwon),
      ),
      maxPfBalanceManwon: toManWon(
        D(ledger.funding.maxPfBalanceManwon),
      ),
    },
    takeout,
    hold,

    npv: toManWon(equityNPV),
    npvUnroundedManwon: equityNPV.toNumber(),
    irr: toPct(annualIRR),
    irrUnroundedPct: irrStatus === "calculated" ? annualIRR.toNumber() : undefined,
    irrStatus,
    equityMultiple: equityMult.toDecimalPlaces(2).toNumber(),
    dscr: dscrValue.toDecimalPlaces(2).toNumber(),
    dscrStatus:
      takeout.dscr != null
        ? "takeout-amortizing"
        : takeout.status === "terms-missing"
          ? "terms-missing"
          : takeout.status === "terms-invalid"
            ? "terms-invalid"
          : "not-applicable",
    paybackMonths: breakEvenIdx,
    equityCashFlowsManwon: [...ledger.equityCashFlows],

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
        // 건축법 시행령 별표 1 제1호다목: 주택으로 쓰는 층수 3개 층 이하.
        floorsAbove: 3,
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
  stabilizationDiscount: DEFAULT_STABILIZATION_FACTOR_PCT / 100,
  retailRentPremium: DEFAULT_RETAIL_RENT_PREMIUM,
} as const;

/**
 * Illustrative basic unit-rate stresses, not a statistical confidence interval.
 * construction-cost-sensitivity reruns monthly ledgers; fixed quotes do not scale.
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
    operatingExpenseRate: DEFAULT_OPERATING_EXPENSE_RATE_PCT,
    // Cap rate: 서울 주거 수익률 수준
    capRate: 4.5,

    // 내부 초기값. 구조·마감·지하·현장조건을 반영한 시공사 견적으로 교체해야 한다.
    constCostPerSqM: 2_300_000,
    basementCostMultiplier: 1.25,
    softCostRate: 12, // 설계·감리·인허가 등 — 공사비 대비 비율 (공공 요율 참고)
    contingencyRate: 5, // 예비비 5~10% 범위의 하단
    // 아래 비용은 자료 없이 추정하지 않는다. 0은 미확인·미반영 상태다.
    acquisitionTaxManwon: 0,
    acquisitionOtherCostManwon: 0,
    tenantRelocationCostManwon: 0,

    // PF: 통상 LTC 60~70%
    ltcTarget: 70,
    interestRate: 5.8,
    pfUpfrontFeeRate: 0,
    trustFeeManwon: 0,
    equityCommitmentManwon: 0,
    // 장기대출 조건은 Term Sheet 없이 가정하지 않는다.
    takeoutLtv: 0,
    takeoutInterestRate: 0,
    takeoutAmortizationYears: 0,
    takeoutLoanTermYears: 0,
    takeoutPaymentDeferralMonths: 0,
    takeoutInterestOnlyMonths: 0,
    takeoutRateResetMonths: 0,
    takeoutAnnualRateChange: 0,
    takeoutRateFloor: 0,
    takeoutRateCap: 0,
    takeoutDsraMonths: 0,
    takeoutMinDscr: 0,
    takeoutLoanCommitmentManwon: 0,
    takeoutFeeRate: 0,
    equityIRR: 15,

    leaseUpMonths: 8,
    salesPaceMonthlyPct: 12,
    // 장기 보유안은 사용자가 기간을 입력하기 전까지 계산하지 않는다.
    holdPeriodYears: 0,
    annualRentGrowthRate: 0,
    annualExpenseGrowthRate: 0,
    rentFreeMonths: 0,
    tenantImprovementPerSqM: 0,
    leasingCommissionRate: 0,
    securityDepositMonths: 0,
    tenantLeaseTermMonths: 0,
    tenantRenewalProbability: 0,
    renewalRentAdjustmentRate: 0,
    renewalRentFreeMonths: 0,
    replacementDowntimeMonths: 0,
    replacementRentFreeMonths: 0,
    replacementTenantImprovementPerSqM: 0,
    replacementLeasingCommissionRate: 0,
    replacementReservePerSqMYear: 0,
    majorRepairYear: 0,
    majorRepairCostManwon: 0,
    holdExitCapRate: 0,
    exitSellingCostRate: 0,

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
  operatingExpenseRate: {
    label: "운영비율",
    unit: "% of 유효총수입",
    kind: "가정값",
    basis:
      "유효총수입의 20% 내부 초기값. 관리·수선·보험·공과금 중 소유자 부담 운영예산으로 교체해야 함.",
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
  acquisitionTaxManwon: {
    label: "취득세 반영액",
    unit: "만원",
    kind: "시장값 권장",
    basis:
      "0원은 세금 면제가 아니라 미확인·미반영 상태. 계약 구조와 과세표준을 검토한 세무 전문가 금액으로 교체해야 함.",
  },
  acquisitionOtherCostManwon: {
    label: "기타 취득 부대비",
    unit: "만원",
    kind: "시장값 권장",
    basis:
      "중개·법무·등기 등 취득 부대비 미확인 초기값 0원. 계약서와 견적으로 교체해야 함.",
  },
  tenantRelocationCostManwon: {
    label: "명도·임차인 정리비",
    unit: "만원",
    kind: "시장값 권장",
    basis:
      "점유·임대차 현황 미확인 초기값 0원. 명도계획과 임대차 원문을 확인해 입력해야 함.",
  },
  ltcTarget: {
    label: "PF 적격 공사비 조달비율",
    unit: "%",
    kind: "가정값",
    basis: "현재 원장은 토지비·철거비를 제외한 공사 관련 적격비용에만 적용합니다. 금융기관 Term Sheet의 실제 LTC 정의로 교체해야 합니다.",
  },
  interestRate: {
    label: "PF 금리",
    unit: "%",
    kind: "시장값 권장",
    basis: "브릿지·PF 금리는 시점·신용별 변동 — 금융기관 조건으로 조정 필요.",
  },
  pfUpfrontFeeRate: {
    label: "PF 약정·취급 수수료율",
    unit: "% of 계획 PF 한도",
    kind: "시장값 권장",
    basis:
      "미확인 초기값 0%. 금융기관 Term Sheet의 약정·취급 수수료율로 교체해야 함.",
  },
  trustFeeManwon: {
    label: "신탁·자금관리비",
    unit: "만원",
    kind: "시장값 권장",
    basis:
      "미확인 초기값 0원. 신탁사·자금관리 계약 견적으로 교체해야 함.",
  },
  equityCommitmentManwon: {
    label: "확인 자기자본 한도",
    unit: "만원",
    kind: "시장값 권장",
    basis:
      "0원은 자본이 없다는 뜻이 아니라 한도 미확인 상태. 투자확약서 또는 승인된 자금계획의 실제 한도를 입력해야 함.",
  },
  takeoutLtv: {
    label: "장기대출 최대 LTV",
    unit: "%",
    kind: "시장값 권장",
    basis: "0%는 조건 미입력 상태. 금융기관 Term Sheet의 담보가치 기준 한도로 교체해야 함.",
  },
  takeoutInterestRate: {
    label: "장기대출 금리",
    unit: "%",
    kind: "시장값 권장",
    basis: "0%는 조건 미입력 상태. 실제 장기대출 금리 또는 보수적 심사금리를 입력해야 함.",
  },
  takeoutAmortizationYears: {
    label: "장기대출 상환기간",
    unit: "년",
    kind: "시장값 권장",
    basis: "0년은 조건 미입력 상태. DSCR 산정에 사용하는 원리금 상환기간을 입력해야 함.",
  },
  takeoutLoanTermYears: {
    label: "장기대출 계약 만기",
    unit: "년",
    kind: "시장값 권장",
    basis:
      "상환기간보다 짧으면 만기 잔액을 balloon으로 별도 상환. 금융기관 Term Sheet의 계약 만기를 입력해야 함.",
  },
  takeoutPaymentDeferralMonths: {
    label: "원리금 납부유예",
    unit: "개월",
    kind: "시장값 권장",
    basis:
      "납부유예 중 이자는 원금에 가산. 0개월도 금융기관 조건에서 확인해야 함.",
  },
  takeoutInterestOnlyMonths: {
    label: "이자만 납부 기간",
    unit: "개월",
    kind: "시장값 권장",
    basis:
      "납부유예 뒤 이자만 납부하고 원금을 줄이지 않는 기간. 0개월도 Term Sheet에서 확인해야 함.",
  },
  takeoutRateResetMonths: {
    label: "금리 재설정 주기",
    unit: "개월",
    kind: "시장값 권장",
    basis:
      "0개월은 고정금리, 양수는 변동금리 예상 경로. 실제 기준금리·가산금리 조항과 대조해야 함.",
  },
  takeoutAnnualRateChange: {
    label: "연 금리 변화 가정",
    unit: "%p/년",
    kind: "가정값",
    basis:
      "변동금리의 결정값이 아닌 시나리오 경로. 금융기관 금리 전망 또는 승인 스트레스 가정으로 교체해야 함.",
  },
  takeoutRateFloor: {
    label: "금리 floor",
    unit: "%",
    kind: "시장값 권장",
    basis: "0%는 별도 floor 없음. Term Sheet의 최저 적용금리 조항을 입력해야 함.",
  },
  takeoutRateCap: {
    label: "금리 cap",
    unit: "%",
    kind: "시장값 권장",
    basis: "0%는 별도 cap 없음. 금리상한 약정 또는 헤지 계약 조건을 입력해야 함.",
  },
  takeoutDsraMonths: {
    label: "DSRA 적립기간",
    unit: "개월",
    kind: "시장값 권장",
    basis:
      "최대 연간 정기 원리금의 월평균 기준 제한현금. 0개월도 금융기관 약정에서 확인해야 함.",
  },
  takeoutMinDscr: {
    label: "장기대출 최소 DSCR",
    unit: "배",
    kind: "시장값 권장",
    basis: "0은 조건 미입력 상태. 금융기관의 최소 원리금상환 커버리지 조건으로 교체해야 함.",
  },
  takeoutLoanCommitmentManwon: {
    label: "장기대출 확약액",
    unit: "만원",
    kind: "시장값 권장",
    basis: "0원은 확약 미확인 상태. 금융기관 Term Sheet 또는 대출약정의 승인 한도를 입력해야 함.",
  },
  takeoutFeeRate: {
    label: "장기대출 수수료율",
    unit: "%",
    kind: "시장값 권장",
    basis: "0%는 미확인 상태. 장기대출 취급·약정 수수료를 순재융자 유입액에서 차감함.",
  },
  holdPeriodYears: {
    label: "장기 보유기간",
    unit: "년",
    kind: "가정값",
    basis:
      "0년은 보유안 미설정 상태. 승인된 운용·매각 계획의 보유기간을 입력해야 함.",
  },
  annualRentGrowthRate: {
    label: "연 임대료 성장률",
    unit: "%/년",
    kind: "시장값 권장",
    basis:
      "보유기간 월 임대수입에 복리 적용. 임대시장 전망 또는 감정평가 가정으로 교체해야 함.",
  },
  annualExpenseGrowthRate: {
    label: "연 운영비 성장률",
    unit: "%/년",
    kind: "가정값",
    basis:
      "보유기간 소유자 부담 운영비에 복리 적용. 운영예산과 계약조건으로 교체해야 함.",
  },
  rentFreeMonths: {
    label: "초기 무상임대 기간",
    unit: "개월",
    kind: "시장값 권장",
    basis:
      "안정화 후 최초 임대 유치를 위한 전 자산 환산 무상임대 기간. 임대조건표로 교체해야 함.",
  },
  tenantImprovementPerSqM: {
    label: "임차인 공사비",
    unit: "원/㎡",
    kind: "시장값 권장",
    basis:
      "안정화·재융자 월에 임대면적 전체 기준으로 일괄 반영. 임대차 제안서와 공사견적으로 교체해야 함.",
  },
  leasingCommissionRate: {
    label: "임대 중개수수료율",
    unit: "% of 안정화 연 임대료",
    kind: "시장값 권장",
    basis:
      "최초 임대 유치 비용으로 안정화 연 예정임대료에 적용. 중개·임대대행 계약으로 교체해야 함.",
  },
  securityDepositMonths: {
    label: "보증금 개월 수",
    unit: "개월",
    kind: "시장값 권장",
    basis:
      "월 예정임대료 배수로 계산해 제한현금으로만 기록하고 매각 시 반환. 임대차 조건으로 교체해야 함.",
  },
  tenantLeaseTermMonths: {
    label: "가중 평균 임대차 기간",
    unit: "개월",
    kind: "시장값 권장",
    basis:
      "0개월은 조건 미입력. 임대차 만기마다 갱신·교체 기대값을 계산하며 임대차 현황표로 교체해야 함.",
  },
  tenantRenewalProbability: {
    label: "임차인 갱신 확률",
    unit: "%",
    kind: "시장값 권장",
    basis:
      "만기 면적 중 즉시 갱신하는 기대 비율. 자산·업종별 과거 갱신 실적이나 운용계획으로 교체해야 함.",
  },
  renewalRentAdjustmentRate: {
    label: "갱신 임대료 조정률",
    unit: "% of 시장임대료",
    kind: "시장값 권장",
    basis:
      "갱신분의 당시 시장임대료 대비 할인·할증률. 실제 갱신 조항과 임대조건표로 교체해야 함.",
  },
  renewalRentFreeMonths: {
    label: "갱신 무상임대 기간",
    unit: "개월",
    kind: "시장값 권장",
    basis:
      "갱신분에 제공하는 무상임대 기간. 갱신 제안서나 승인된 임대정책으로 교체해야 함.",
  },
  replacementDowntimeMonths: {
    label: "신규 임차인 유치 공실기간",
    unit: "개월",
    kind: "시장값 권장",
    basis:
      "미갱신 면적이 신규 임차인 계약 전 비어 있는 기간. 임대시장 실적과 임대대행 계획으로 교체해야 함.",
  },
  replacementRentFreeMonths: {
    label: "신규 임차인 무상임대 기간",
    unit: "개월",
    kind: "시장값 권장",
    basis:
      "신규 임차인 입주 뒤 제공하는 무상임대 기간. 임대조건표로 교체해야 함.",
  },
  replacementTenantImprovementPerSqM: {
    label: "신규 임차인 공사비",
    unit: "원/㎡",
    kind: "시장값 권장",
    basis:
      "미갱신 기대 면적에 만기 시 반영하는 신규 임차인 공사비. 실제 공사견적과 임대차 제안서로 교체해야 함.",
  },
  replacementLeasingCommissionRate: {
    label: "신규 임대 중개수수료율",
    unit: "% of 연 임대료",
    kind: "시장값 권장",
    basis:
      "미갱신 기대 면적의 당시 연 예정임대료에 적용. 중개·임대대행 계약으로 교체해야 함.",
  },
  replacementReservePerSqMYear: {
    label: "연간 면적당 교체 준비금",
    unit: "원/㎡·년",
    kind: "가정값",
    basis:
      "NOI 이후 보유 자기자본 현금흐름에서 매월 적립. 장기수선계획 또는 기술실사 예산으로 교체해야 함.",
  },
  majorRepairYear: {
    label: "대수선 발생 연차",
    unit: "년차",
    kind: "가정값",
    basis:
      "0년은 계획 없음. 장기수선계획상 일회성 대수선 시점을 입력해야 함.",
  },
  majorRepairCostManwon: {
    label: "대수선 비용",
    unit: "만원",
    kind: "시장값 권장",
    basis:
      "지정 연차 말에 일회성 자기자본 유출로 반영. 기술실사와 전문공사 견적으로 교체해야 함.",
  },
  holdExitCapRate: {
    label: "보유 종료 Exit cap rate",
    unit: "%",
    kind: "시장값 권장",
    basis:
      "보유 종료 다음 12개월 NOI를 매각가로 환산. 감정평가 또는 승인된 Exit 가정으로 교체해야 함.",
  },
  exitSellingCostRate: {
    label: "매각 부대비율",
    unit: "% of 매각가",
    kind: "시장값 권장",
    basis:
      "보유 종료 매각가에서 중개·법무·처분 비용으로 차감. 매각 자문 견적과 세무 검토로 교체해야 함.",
  },
};

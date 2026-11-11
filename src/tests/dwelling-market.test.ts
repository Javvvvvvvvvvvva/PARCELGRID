import { describe, expect, it } from "vitest";
import type { CompVM } from "@/lib/adapters/view-model";
import { analyzeDwellingMarket, dwellingMarketBands, dwellingMarketLocation, dwellingMarketTargets, dwellingMarketWindow, koreaDate, molitRegistrationDate } from "@/lib/finance/dwelling-market";
import type { MolitRangeEvidence } from "@/lib/integrations/molit-evidence";
import { createBlankPlanningScenario, clonePlanningScenario } from "@/lib/planning/scenario-utils";
import { DEFAULT_DWELLING_PROGRAM } from "@/lib/planning/dwelling-program";
import { dwellingSaleBreakdown, validateDwellingSaleBands } from "@/lib/planning/dwelling-pricing";
import { calculatePlanningScenario, planningEconomicsAssumptionsFromLegacy } from "@/lib/planning/scenario-calculator";
import { defaultAssumptions, calculateScenario } from "@/lib/finance/scenario";
import { planningScenarioToBuildingProgram } from "@/lib/planning/scenario-to-building-program";
import { dwellingSensitivity } from "@/lib/planning/dwelling-comparison";
import type { Parcel, Scenario } from "@/lib/finance/types";
import { computeProject } from "@/lib/services/compute-project";
import { projectWorkspaceFixture } from "@/tests/helpers/project-workspace-fixture";
import { canonicalProjectWorkspaceJson, validateProjectWorkspacePayload } from "@/lib/workspace/project-workspace";

const asOf = "2026-10-19";
const projectId = "1132010500102810023";
const window = dwellingMarketWindow(asOf);
const retrievedAt = "2026-10-19T00:00:00.000Z";
function evidence(patch: Partial<MolitRangeEvidence> = {}): MolitRangeEvidence {
  return { source: "MOLIT", type: "villa", lawdCd: "11320", ...window, retrievedAt, status: "complete", completedMonths: window.months,
    failedMonths: [], transactionCount: 3, sourceRetrievals: window.months.map(month => ({ month, oldestFetchedAt: retrievedAt, newestFetchedAt: retrievedAt })), ...patch };
}
function comp(index: number, patch: Partial<CompVM> = {}): CompVM {
  return { id: `sample-${index}`, address: `쌍문동 1-${index}`, jibun: `1-${index}`, dongName: "쌍문동", lawdCd: "11320",
    type: "연립다세대", houseType: "다세대", areaBasis: "exclusive", cancellationStatus: "not-reported",
    registrationDate: "26.06.01", date: "2026-05-01", dealingGbn: "중개거래", buyerType: "개인", sellerType: "법인",
    lotArea: 29, priceWon: 232_000_000 + index * 29_000_000, pricePerPyeong: 0,
    floor: 3, buildYear: 2022, distanceKm: null, sameDong: true, ...patch };
}
const target = { exclusiveSqm: 29, saleableSqm: 29, floor: 3, exclusiveAreaKnown: true };
function report(patch: Partial<Parameters<typeof analyzeDwellingMarket>[0]> = {}) {
  return analyzeDwellingMarket({ comps: [comp(0), comp(1), comp(2)], evidence: [evidence()], targets: [target], asOf, projectId,
    lawdCd: "11320", dongName: "쌍문동", ...patch });
}
function scenario() {
  return { ...createBlankPlanningScenario(), projectId, primaryUse: "multi-family" as const, dwellingProgram: { ...DEFAULT_DWELLING_PROGRAM },
    floorPrograms: [2, 3, 4].map(level => ({ id: `floor-${level}`, label: `${level}층`, level, floorHeightM: 3,
      footprintScalePct: 100, northSetbackM: 0, zones: [{ id: `home-${level}`, useType: "residential" as const,
        areaSqm: 29, saleableAreaSqm: 29, parkingExclusiveAreaSqm: 29, parkingExclusiveAreaStatus: "user-entered" as const, unitCount: 1 }] })) };
}

describe("dwelling market observation rules", () => {
  it("uses calendar months and Korea's date without the31st rollover", () => {
    expect(dwellingMarketWindow("2026-03-31")).toMatchObject({ startYearMonth: "202504", endYearMonth: "202603" });
    expect(koreaDate(new Date("2026-10-18T15:00:00Z"))).toBe(asOf);
    expect(molitRegistrationDate("26.06.01")).toBe("2026-06-01");
    expect(molitRegistrationDate("20260601")).toBe("2026-06-01");
    expect(molitRegistrationDate("26.02.30")).toBeNull();
  });
  it("requires an explicit PNU and lot-address dong, never infers one from a road name", () => {
    expect(dwellingMarketLocation({ id: projectId, address: "서울특별시 도봉구 쌍문동 281-23" })).toEqual({ lawdCd: "11320", dongName: "쌍문동" });
    expect(dwellingMarketLocation({ id: "demo", address: "서울특별시 도봉구 도봉로 123" })).toEqual({ lawdCd: "", dongName: "" });
  });
  it("weights addresses equally, preserves source observations, and calls no output confirmed pricing", () => {
    const many = Array.from({ length: 15 }, (_, index) => comp(index + 10, { jibun: "1-0", priceWon: 232_000_000 }));
    const result = report({ comps: [comp(0), comp(1), comp(2), ...many] });
    expect(result.rows[0]).toMatchObject({ applicable: true, addressCount: 3, medianWon: 9_000_000, minWon: 8_000_000, maxWon: 10_000_000 });
    const bands = dwellingMarketBands(result);
    expect(bands[0].marketObservation?.comparables).toHaveLength(18);
    expect(bands[0].source).toContain("사용자 채택 가정");
    bands[0].marketObservation!.comparables[0].priceWon = 1;
    expect(result.rows[0].included[0].priceWon).not.toBe(1);
    expect(report({ comps: many }).rows[0].applicable).toBe(false);
  });
  it.each([
    [{ cancellationStatus: "cancelled" }, "cancelled"], [{ cancellationStatus: undefined }, "cancellationUnknown"],
    [{ areaBasis: "gross" }, "type"], [{ houseType: undefined }, "type"], [{ dongName: "도봉동" }, "location"],
    [{ jibun: "***" }, "location"], [{ date: "2026-02-30" }, "date"], [{ date: "2026-10-20" }, "date"],
    [{ date: "2025-10-31" }, "date"], [{ dealingGbn: "직거래" }, "trade"], [{ buyerType: "법인" }, "buyer"],
    [{ sellerType: "기타" }, "seller"], [{ registrationDate: undefined }, "registration"], [{ registrationDate: "26.10.20" }, "registration"],
    [{ registrationDate: "26.04.01" }, "registration"], [{ buildYear: 2027 }, "age"], [{ buildYear: 2018 }, "age"],
    [{ buildYear: undefined }, "age"], [{ floor: 1 }, "floor"], [{ lotArea: 20 }, "area"], [{ priceWon: Infinity }, "price"],
  ] as [Partial<CompVM>, string][])("excludes %o with a visible reason", (patch, reason) => {
    const result = report({ comps: [comp(0, patch)] });
    expect(result.rows[0].excluded[0].reason).toBe(reason);
    expect(dwellingMarketBands(result)).toEqual([]);
  });
  it("never extrapolates29m2 sales to20m2 or allows different area axes/floor groups", () => {
    for (const patch of [{ exclusiveSqm: 20, saleableSqm: 20 }, { saleableSqm: 35 }, { floor: 1 }, { exclusiveAreaKnown: false }]) {
      expect(dwellingMarketBands(report({ targets: [{ ...target, ...patch }] }))).toEqual([]);
    }
  });
  it.each([
    { status: "partial" as const }, { completedMonths: window.months.slice(1) }, { type: "house" },
    { lawdCd: "11305" }, { sourceRetrievals: undefined }, { startYearMonth: "202510" },
    { sourceRetrievals: window.months.map(month => ({ month, oldestFetchedAt: "2026-10-01T00:00:00Z", newestFetchedAt: retrievedAt })) },
  ])("keeps observations but disables use for incomplete/stale collection %o", patch => {
    const result = report({ evidence: [evidence(patch)] });
    expect(result.rows[0].included).toHaveLength(3);
    expect(result.problem).not.toBeNull();
    expect(dwellingMarketBands(result)).toEqual([]);
  });
  it("a matching cancellation wins regardless of duplicate row order", () => {
    const active = comp(0); const cancelled = comp(0, { cancellationStatus: "cancelled" });
    for (const rows of [[active, cancelled], [cancelled, active]]) {
      expect(report({ comps: [...rows, comp(1), comp(2)] }).rows[0].addressCount).toBe(2);
    }
  });
  it("treats conflicting cancellation metadata on an imported identity as unknown", () => {
    expect(report({ comps: [comp(0), comp(0, { cancellationStatus: "unknown" }), comp(1), comp(2)] }).rows[0].addressCount).toBe(2);
  });
});

describe("scoped observed-price contract", () => {
  it("round-trips the separate market dataset and immutable adoption evidence in a workspace", () => {
    const payload = projectWorkspaceFixture(projectId);
    payload.projectData.dwellingMarket = { comps: [comp(0), comp(1), comp(2)], evidence: [evidence()] };
    const plan = { ...scenario(), dwellingProgram: { ...DEFAULT_DWELLING_PROGRAM, salePriceBands: dwellingMarketBands(report()) } };
    payload.planningScenarios = [plan];
    expect(validateProjectWorkspacePayload(payload, projectId).valid).toBe(true);
    const restored = JSON.parse(canonicalProjectWorkspaceJson(payload));
    expect(restored.projectData.comps).toEqual([]);
    expect(restored.projectData.dwellingMarket).toEqual(payload.projectData.dwellingMarket);
    expect(restored.planningScenarios[0].dwellingProgram.salePriceBands).toEqual(plan.dwellingProgram.salePriceBands);
    restored.projectData.dwellingMarket.comps = {};
    expect(validateProjectWorkspacePayload(restored, projectId).valid).toBe(false);
  });
  it("requires explicit adoption and invalidates price reuse after target changes", () => {
    const plan = scenario();
    expect(dwellingSaleBreakdown(plan, 6_000_000)[0].unitPriceWon).toBe(6_000_000);
    const bands = dwellingMarketBands(report());
    plan.dwellingProgram = { ...plan.dwellingProgram, salePriceBands: bands };
    expect(validateDwellingSaleBands(bands)).toBeNull();
    expect(dwellingSaleBreakdown(plan, 6_000_000)[0]).toMatchObject({ bandApplied: true, unitPriceWon: 9_000_000 });
    const copy = clonePlanningScenario(plan); copy.dwellingProgram!.salePriceBands![0].marketObservation!.comparables[0].priceWon = 1;
    expect(bands[0].marketObservation!.comparables[0].priceWon).not.toBe(1);
    for (const mutate of [
      (p: typeof plan) => { p.projectId = "other"; },
      (p: typeof plan) => { p.floorPrograms[0].level = 1; },
      (p: typeof plan) => { p.floorPrograms[0].zones[0].saleableAreaSqm = 35; },
      (p: typeof plan) => { p.floorPrograms[0].zones[0].parkingExclusiveAreaSqm = 20; },
      (p: typeof plan) => { p.dwellingProgram.salePriceBands![0].unitPriceWon = 99_000_000; },
    ]) {
      const next = structuredClone(plan); mutate(next);
      expect(dwellingSaleBreakdown(next, 6_000_000)[0]).toMatchObject({ bandApplied: false, unitPriceWon: 6_000_000 });
    }
  });
  it("carries the adopted observation into Stage3 and price stress exactly once", () => {
    const plan = { ...scenario(), dwellingProgram: { ...DEFAULT_DWELLING_PROGRAM, salePriceBands: dwellingMarketBands(report()) } };
    expect(dwellingMarketTargets(plan)).toHaveLength(3);
    const parcel: Parcel = { id: projectId, address: "서울 도봉구 쌍문동 281-23", addressRoad: "", lotArea: 122,
      zoning: "제2종일반주거지역", zoneCode: "UB20", maxFAR: 250, maxBCR: 60, heightLimit: 18,
      setback: { road: 0, side: 0, rear: 0 }, landPrice: 0, estMarketPrice: 0, acquired: asOf, acquiredPrice: 50000 };
    const assumptions = defaultAssumptions();
    const input = { projectId, parcel: { address: parcel.address, zoning: parcel.zoning, lotAreaSqm: 122, maxFARPct: 250, maxBCRPct: 60,
      heightLimitM: 18, acquisitionCostManwon: 50000, demolitionCostManwon: 0 }, assumptions: planningEconomicsAssumptionsFromLegacy(assumptions) };
    const before = JSON.stringify(plan);
    const calculation = calculatePlanningScenario(plan, input);
    const financial = { id: plan.id, name: "observations", program: planningScenarioToBuildingProgram(plan, calculation), assumptions } as Scenario;
    expect(calculation.revenueProjection.saleRevenueManwon).toBe(78300);
    expect(calculateScenario({ parcel, scenario: financial }).revenueSale).toBeCloseTo(78300, 2);
    const villa = { externalId: "villa", date: "2026-05-01", buildingName: "test", lawdCd: "11320", dongName: "쌍문동",
      jibun: "1-1", exclusiveArea: 29, priceManwon: 25000, floor: 3, type: "연립다세대", areaBasis: "exclusive" as const };
    const computed = computeProject(parcel, [financial], { transactions: [villa, { ...villa, externalId: "house", type: "단독다가구", areaBasis: "gross" }],
      transactionEvidence: [evidence(), evidence({ type: "house" })], parcelDong: "쌍문동" });
    expect(computed.comps.map(comp => comp.type)).toEqual(["단독다가구"]);
    expect(computed.transactionEvidence?.map(item => item.type)).toEqual(["house"]);
    expect(computed.dwellingMarket?.comps.map(comp => comp.type)).toEqual(["연립다세대"]);
    expect(computed.dwellingMarket?.evidence[0].type).toBe("villa");
    expect(calculation.revenueProjection.pricing.pools.residentialSale.sourceStatus).toBe("user-input");
    expect(dwellingSensitivity(plan, input, -10, 15).saleRevenueManwon).toBeCloseTo(70470, 2);
    expect(JSON.stringify(plan)).toBe(before);
  });
});

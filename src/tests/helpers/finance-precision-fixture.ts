import { defaultAssumptions, defaultProgram } from "@/lib/finance/scenario";
import { emptyRevenueAreaPools } from "@/lib/finance/revenue-contract";
import type { AssumptionSet, Parcel, Scenario } from "@/lib/finance/types";

export function precisionFixture(patch: Partial<AssumptionSet> = {}, acquiredPrice = 20_000.12345) {
  const parcel: Parcel = {
    id: "PRECISION-PARCEL", address: "Synthetic fixture", addressRoad: "Synthetic fixture",
    lotArea: 300, zoning: "Synthetic fixture", zoneCode: "UQA122", maxFAR: 200, maxBCR: 60,
    heightLimit: 20, setback: { road: 1, side: 0.5, rear: 0.5 }, landPrice: 3_000_000,
    estMarketPrice: 8_000_000, acquired: "2026-01-01", acquiredPrice,
  };
  const scenario: Scenario = {
    id: "PRECISION-SCENARIO", name: "Synthetic contracted sale", shortName: "Synthetic sale",
    program: {
      ...defaultProgram("multi-family", 200, 60),
      mix: { residentialSale: 1, residentialLease: 0, retail: 0 },
      areaContract: {
        schemaVersion: "stage2-finance-area-2026.1", source: "stage2-planning",
        sourceScenarioId: "PRECISION-SCENARIO", sourceScenarioVersion: 1,
        constructionAreaSqm: 250, aboveGroundAreaSqm: 250, basementAreaSqm: 0,
        farAreaSqm: 250, gradeFootprintAreaSqm: 100, parkingAreaSqm: 0, commonAreaSqm: 50,
        saleableAreaSqm: 200, rentableAreaSqm: 0,
        revenueAreas: { ...emptyRevenueAreaPools(), residentialSaleSqm: 200 },
        providedParkingSpaces: 0, requiredParkingSpaces: 0, materialAdjustmentCostManwon: 0,
      },
    },
    assumptions: {
      ...defaultAssumptions(), equityIRR: 10, equityCommitmentManwon: 100_000_000,
      salePricePerSqM: 15_000_000, ...patch,
    },
  };
  return { parcel, scenario };
}

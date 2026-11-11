import { integratedVerificationFixture } from "./integrated-verification-fixture";
import { createConstructionQuoteDraft } from "@/lib/planning/construction-quote";
import { planningEconomicsAssumptionsFromLegacy } from "@/lib/planning/scenario-calculator";
import { takeoffPlanningQuantities } from "@/lib/planning/quantity-takeoff";

export function constructionQuoteFixture() {
  const f = integratedVerificationFixture("QUOTE-P1"), scenario = f.planningScenario!;
  const assumptions = planningEconomicsAssumptionsFromLegacy(f.data.scenarios[0]._raw.assumptions, "quote-fixture");
  const inputs = { constructionCostPerSqmWon: assumptions.constructionCostPerSqmWon, basementCostMultiplier: assumptions.basementCostMultiplier };
  const quote = createConstructionQuoteDraft(scenario, inputs, "2026-11-04"), takeoff = takeoffPlanningQuantities(scenario);
  Object.assign(quote, { reference: "SYNTHETIC-ONLY-QUOTE-1", issuer: "Synthetic contractor", projectReference: "Synthetic verification parcel",
    issuedOn: "2026-11-01", validUntil: "2026-11-30", vatBasis: "included", baseVatBasis: "included" });
  quote.lines = [{ id: "package", description: "Synthetic remaining construction package", sourceLocator: "p1 row1", pricing: "lump-sum",
    quantity: null, unit: "lot", unitRateWon: null, amountWon: 1_000_000, vatBasis: "included", quantityItemId: null, note: "Synthetic same-scope package, not real evidence" },
  ...takeoff.items.map(item => ({ id: item.id, description: item.label, sourceLocator: `p2 ${item.id}`, pricing: "unit-price" as const,
    quantity: item.quantity, unit: item.unit, unitRateWon: 100, amountWon: item.quantity! * 100, vatBasis: "included" as const,
    quantityItemId: item.id, note: "Synthetic source; no actual quantity validation" }))];
  quote.coverage.forEach(scope => { scope.status = "included"; scope.lineIds = [quote.lines.some(line => line.id === scope.id) ? scope.id : "package"];
    scope.note = "Synthetic original scope statement; each package amount counted once"; });
  quote.statedTotalWon = quote.lines.reduce((total, line) => total + line.amountWon!, 0);
  scenario.constructionQuote = quote;
  return { ...f, scenario, inputs, quote, takeoff };
}

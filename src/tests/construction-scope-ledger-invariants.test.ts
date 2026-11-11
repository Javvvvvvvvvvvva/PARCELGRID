import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  assessConstructionQuote,
  buildConstructionScopeLedger,
  constructionQuoteSchema,
  QUOTE_SCOPE_IDS,
  type ConstructionQuote,
  type ConstructionQuoteLine,
  type ConstructionScopeLedger,
} from "@/lib/planning/construction-quote";
import { constructionQuoteFixture } from "./helpers/construction-quote-fixture";

type ScopeId = typeof QUOTE_SCOPE_IDS[number];
const original = constructionQuoteFixture();

function emptyQuote(): ConstructionQuote {
  const quote = structuredClone(original.quote);
  quote.lines = [];
  quote.coverage.forEach(scope => {
    scope.status = "not-applicable";
    scope.lineIds = [];
    scope.note = "Synthetic documented scope disposition";
  });
  quote.statedTotalWon = 0;
  return quote;
}

function addRow(quote: ConstructionQuote, id: string, parts: Array<[ScopeId, number]>) {
  const line: ConstructionQuoteLine = {
    id, description: `Synthetic ${id}`, sourceLocator: `appendix row ${id}`,
    pricing: "lump-sum", quantity: null, unit: "lot", unitRateWon: null,
    amountWon: parts.reduce((sum, [, cents]) => sum + cents, 0) / 100,
    vatBasis: "included", quantityItemId: null, note: "Synthetic documented amount, including zero",
  };
  if (parts.length > 1) line.allocations = parts.map(([scopeId, cents]) => ({
    scopeId, amountWon: cents / 100, source: `appendix allocation ${id} ${scopeId}`,
  }));
  quote.lines.push(line);
  for (const [scopeId] of parts) {
    const scope = quote.coverage.find(scope => scope.id === scopeId)!;
    scope.status = "included";
    scope.lineIds.push(id);
  }
  return line;
}

function retotal(quote: ConstructionQuote) {
  quote.statedTotalWon = quote.lines.reduce((sum, line) => sum.plus(line.amountWon ?? 0), new Decimal(0)).toNumber();
}

function graphFixture(seed: number) {
  const quote = emptyQuote(), centsByScope = new Map<ScopeId, number>();
  const add = (id: string, parts: Array<[ScopeId, number]>) => {
    addRow(quote, id, parts);
    for (const [scopeId, cents] of parts) centsByScope.set(scopeId, (centsByScope.get(scopeId) ?? 0) + cents);
  };
  QUOTE_SCOPE_IDS.forEach((scopeId, index) => add(`direct-${index}`, [[scopeId, (index + 1) * 100 + seed]]));
  for (let row = 0; row < 14; row++) {
    add(`shared-${row}`, Array.from({ length: 2 + row % 3 }, (_, part): [ScopeId, number] => [
      QUOTE_SCOPE_IDS[(row * 7 + part * 5 + seed) % QUOTE_SCOPE_IDS.length],
      (seed * 31 + row * 17 + part * 7) % 151,
    ]));
  }
  const totalCents = [...centsByScope.values()].reduce((sum, cents) => sum + cents, 0);
  quote.statedTotalWon = totalCents / 100;
  return { quote, centsByScope, totalCents };
}

function permuted(quote: ConstructionQuote, seed: number): ConstructionQuote {
  const copy = structuredClone(quote);
  let state = seed >>> 0;
  const shuffle = <T,>(values: T[]) => {
    for (let index = values.length - 1; index > 0; index--) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const other = state % (index + 1);
      [values[index], values[other]] = [values[other], values[index]];
    }
  };
  shuffle(copy.lines);
  shuffle(copy.coverage);
  copy.lines.forEach(line => { if (line.allocations) shuffle(line.allocations); });
  copy.coverage.forEach(scope => shuffle(scope.lineIds));
  return copy;
}

function canonical(ledger: ConstructionScopeLedger) {
  return {
    ...ledger,
    missingAmountLineIds: [...ledger.missingAmountLineIds].sort(),
    unresolvedLineIds: [...ledger.unresolvedLineIds].sort(),
    scopes: ledger.scopes.map(scope => ({ ...scope, lineIds: [...scope.lineIds].sort() }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    issues: [...ledger.issues].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  };
}

function expectConserved(ledger: ConstructionScopeLedger) {
  expect(ledger.knownAmountWon).not.toBeNull();
  expect(ledger.allocatedAmountWon).not.toBeNull();
  expect(ledger.unallocatedAmountWon).not.toBeNull();
  expect(new Decimal(ledger.allocatedAmountWon!).plus(ledger.unallocatedAmountWon!).toNumber()).toBe(ledger.knownAmountWon);
  expect(ledger.allocatedAmountWon).toBeGreaterThanOrEqual(0);
  expect(ledger.unallocatedAmountWon).toBeGreaterThanOrEqual(0);
  expect(new Set(ledger.unresolvedLineIds).size).toBe(ledger.unresolvedLineIds.length);
  expect(new Set(ledger.missingAmountLineIds).size).toBe(ledger.missingAmountLineIds.length);
  expect(ledger.scopes.map(scope => scope.id).sort()).toEqual([...QUOTE_SCOPE_IDS].sort());
}

function modelFixture() {
  const fixture = structuredClone(original), row = fixture.quote.lines[0];
  const scopes = fixture.quote.coverage.filter(scope => scope.lineIds.includes(row.id));
  row.allocations = scopes.map((scope, index) => ({
    scopeId: scope.id,
    amountWon: index === scopes.length - 1 ? 550_000 : (index + 1) * 10_000,
    source: `Synthetic allocation appendix ${scope.id}`,
  }));
  retotal(fixture.quote);
  return fixture;
}

describe("construction scope ledger accounting invariants", () => {
  it.each([1, 7, 42, 2147])("conserves every scope across overlapping packages and permutations, seed %i", seed => {
    const { quote, centsByScope, totalCents } = graphFixture(seed);
    const baseline = canonical(buildConstructionScopeLedger(quote));
    expect(quote.lines).toHaveLength(31);
    for (const permutation of [1, 2, 3, 11, 37, 103, 997, 65537]) {
      const input = permuted(quote, permutation), before = structuredClone(input);
      const result = buildConstructionScopeLedger(input);
      expect(result).toMatchObject({ status: "reconciled", knownAmountWon: totalCents / 100,
        allocatedAmountWon: totalCents / 100, totalAmountWon: totalCents / 100, unallocatedAmountWon: 0,
        missingAmountLineIds: [], unresolvedLineIds: [], issues: [], financialApplied: false, approvalStatus: "unverified" });
      for (const scope of result.scopes) {
        expect(scope.status).toBe("allocated");
        expect(scope.amountWon).toBe(centsByScope.get(scope.id)! / 100);
        expect(scope.lineIds).toHaveLength(new Set(scope.lineIds).size);
      }
      expectConserved(result);
      expect(canonical(result)).toEqual(baseline);
      expect(input).toEqual(before);
    }
  });

  it.each(["row-amount", "allocation-amount", "allocation-source", "orphan-link"] as const)(
    "preserves failure accounting under permutations for %s", kind => {
      const { quote } = graphFixture(7), row = quote.lines.find(line => line.id === "shared-0")!;
      if (kind === "row-amount") row.amountWon = null;
      if (kind === "allocation-amount") row.allocations![0].amountWon = null;
      if (kind === "allocation-source") row.allocations![0].source = " ";
      if (kind === "orphan-link") quote.coverage[0].lineIds.push("absent-source-row");
      const baseline = buildConstructionScopeLedger(quote);
      expect(baseline.status).toBe(kind === "orphan-link" ? "conflict" : "incomplete");
      expect(baseline.totalAmountWon).toBeNull();
      expect(baseline.missingAmountLineIds).toEqual(kind === "row-amount" ? [row.id] : []);
      expect(baseline.unresolvedLineIds).toEqual(kind === "orphan-link" ? [] : [row.id]);
      if (kind !== "orphan-link") {
        expect(baseline.unallocatedAmountWon).toBe(kind === "row-amount" ? 0 : row.amountWon);
        for (const part of row.allocations!) expect(baseline.scopes.find(scope => scope.id === part.scopeId))
          .toMatchObject({ status: "missing", amountWon: null });
      }
      for (const seed of [1, 3, 7, 23, 99]) {
        const result = buildConstructionScopeLedger(permuted(quote, seed));
        expectConserved(result);
        expect(canonical(result)).toEqual(canonical(baseline));
      }
    },
  );

  it("treats omitted and empty allocations equivalently, without creating shares for a legacy package", () => {
    const { quote } = graphFixture(1), explicitEmpty = structuredClone(quote);
    explicitEmpty.lines.forEach(line => { line.allocations ??= []; });
    expect(canonical(buildConstructionScopeLedger(explicitEmpty))).toEqual(canonical(buildConstructionScopeLedger(quote)));
    const shared = quote.lines.find(line => line.id === "shared-0")!;
    delete shared.allocations;
    const omitted = buildConstructionScopeLedger(quote);
    shared.allocations = [];
    expect(canonical(buildConstructionScopeLedger(quote))).toEqual(canonical(omitted));
    expect(omitted).toMatchObject({ status: "incomplete", totalAmountWon: null,
      unallocatedAmountWon: shared.amountWon, unresolvedLineIds: [shared.id], missingAmountLineIds: [] });
    expectConserved(omitted);
  });

  it("counts a missing shared source once while distinguishing priced zero, missing, and not-applicable scopes", () => {
    const quote = emptyQuote();
    addRow(quote, "documented-zero", [["groundworks", 0]]);
    const missing = addRow(quote, "unpriced-shared", [["structure", 0], ["roof", 0]]);
    missing.amountWon = null;
    missing.allocations!.forEach(part => { part.amountWon = null; });
    const unallocatedZero = addRow(quote, "unallocated-zero", [["mechanical", 0], ["electrical", 0]]);
    delete unallocatedZero.allocations;
    const result = buildConstructionScopeLedger(quote);
    expect(result).toMatchObject({ status: "incomplete", knownAmountWon: 0, allocatedAmountWon: 0,
      unallocatedAmountWon: 0, totalAmountWon: null, missingAmountLineIds: [missing.id],
      unresolvedLineIds: [missing.id, unallocatedZero.id] });
    expect(result.scopes.filter(scope => scope.status === "allocated")).toHaveLength(1);
    expect(result.scopes.filter(scope => scope.status === "missing")).toHaveLength(4);
    expect(result.scopes.filter(scope => scope.status === "not-applicable")).toHaveLength(12);
    expect(result.scopes.find(scope => scope.id === "groundworks")?.amountWon).toBe(0);
    expect(result.scopes.filter(scope => scope.id !== "groundworks").every(scope => scope.amountWon === null)).toBe(true);
    expectConserved(result);
  });

  it.each(["absent", "explicit"] as const)("aggregates 256 disjoint source rows into one scope with %s allocations", mode => {
    const quote = emptyQuote();
    for (let index = 0; index < 256; index++) {
      const row = addRow(quote, `disjoint-${index}`, [["structure", index]]);
      if (mode === "explicit") row.allocations = [{ scopeId: "structure", amountWon: row.amountWon, source: row.sourceLocator }];
    }
    quote.statedTotalWon = (255 * 256 / 2) / 100;
    expect(constructionQuoteSchema.safeParse(quote).success).toBe(true);
    const result = buildConstructionScopeLedger(permuted(quote, 73));
    expect(result).toMatchObject({ status: "reconciled", totalAmountWon: 326.4,
      allocatedAmountWon: 326.4, unallocatedAmountWon: 0, unresolvedLineIds: [] });
    expect(result.scopes.find(scope => scope.id === "structure")).toMatchObject({ status: "allocated", amountWon: 326.4 });
    expect(result.scopes.find(scope => scope.id === "structure")?.lineIds).toHaveLength(256);
    expect(result.scopes.filter(scope => scope.status === "allocated")).toHaveLength(1);
    expect(result.scopes.filter(scope => scope.status === "not-applicable")).toHaveLength(16);
    expectConserved(result);
  });

  it.each(["partitionLengthM", "entryDoorCount"] as const)("preserves money and model quantities when %s is split across source rows", scopeId => {
    const fixture = modelFixture(), { quote } = fixture;
    const row = quote.lines.find(line => line.quantityItemId === scopeId)!;
    const before = buildConstructionScopeLedger(quote), originalQuantity = row.quantity!;
    const firstQuantity = row.unit === "count" ? Math.floor(originalQuantity / 2) : new Decimal(originalQuantity).div(2).toNumber();
    const first = { ...row, id: `${row.id}-first`, sourceLocator: `${row.sourceLocator} first`, quantity: firstQuantity };
    const second = { ...row, id: `${row.id}-second`, sourceLocator: `${row.sourceLocator} second`,
      quantity: new Decimal(originalQuantity).minus(firstQuantity).toNumber() };
    for (const part of [first, second]) part.amountWon = new Decimal(part.quantity).times(part.unitRateWon!).toNumber();
    quote.lines = quote.lines.filter(line => line.id !== row.id).concat(first, second);
    quote.coverage.find(scope => scope.id === scopeId)!.lineIds = [first.id, second.id];
    retotal(quote);
    const result = buildConstructionScopeLedger(permuted(quote, 93));
    expect(result.status).toBe("reconciled");
    expect(result.totalAmountWon).toBe(before.totalAmountWon);
    expect(result.scopes.find(scope => scope.id === scopeId)).toMatchObject({ status: "allocated", amountWon: row.amountWon });
    expect(result.scopes.find(scope => scope.id === scopeId)?.lineIds).toHaveLength(2);
    const assessment = assessConstructionQuote(fixture.scenario, fixture.inputs);
    expect(assessment.status).toBe("ready");
    expect(assessment.quantities.find(item => item.id === scopeId)).toMatchObject({ status: "checked", quoted: originalQuantity });
    expectConserved(result);
  });

  it("counts a model quantity once when its row allocates money to both model and shared construction scopes", () => {
    const fixture = modelFixture(), { quote } = fixture;
    const before = buildConstructionScopeLedger(quote);
    const row = quote.lines.find(line => line.quantityItemId === "entryDoorCount")!, amount = row.amountWon!;
    const modelAmount = new Decimal(amount).times("0.25").toNumber();
    row.allocations = [
      { scopeId: "entryDoorCount", amountWon: modelAmount, source: "Synthetic door hardware appendix" },
      { scopeId: "common", amountWon: new Decimal(amount).minus(modelAmount).toNumber(), source: "Synthetic common installation appendix" },
    ];
    quote.coverage.find(scope => scope.id === "common")!.lineIds.push(row.id);
    const result = buildConstructionScopeLedger(quote);
    expect(result.status).toBe("reconciled");
    expect(result.totalAmountWon).toBe(before.totalAmountWon);
    expect(result.scopes.find(scope => scope.id === "entryDoorCount")?.amountWon).toBe(modelAmount);
    expect(result.scopes.find(scope => scope.id === "common")?.amountWon).toBe(
      new Decimal(before.scopes.find(scope => scope.id === "common")!.amountWon!).plus(amount).minus(modelAmount).toNumber(),
    );
    const assessment = assessConstructionQuote(fixture.scenario, fixture.inputs);
    expect(assessment.status).toBe("ready");
    expect(assessment.quantities.find(item => item.id === "entryDoorCount")).toMatchObject({ status: "checked", quoted: row.quantity });
    expectConserved(result);
  });

  it("rejects fractional count rows even when aggregate quantity and allocated money reconcile", () => {
    const fixture = modelFixture(), { quote } = fixture;
    const row = quote.lines.find(line => line.quantityItemId === "entryDoorCount")!, originalQuantity = row.quantity!;
    expect(originalQuantity).toBeGreaterThan(0);
    const first = { ...row, id: "fractional-first", sourceLocator: "count appendix row 1", quantity: 0.5 };
    const second = { ...row, id: "fractional-second", sourceLocator: "count appendix row 2", quantity: originalQuantity - 0.5 };
    for (const part of [first, second]) {
      part.amountWon = new Decimal(part.quantity).times(part.unitRateWon!).toNumber();
      part.allocations = [{ scopeId: "entryDoorCount", amountWon: part.amountWon, source: part.sourceLocator }];
    }
    quote.lines = quote.lines.filter(line => line.id !== row.id).concat(first, second);
    quote.coverage.find(scope => scope.id === "entryDoorCount")!.lineIds = [first.id, second.id];
    retotal(quote);
    const result = buildConstructionScopeLedger(quote);
    expect(result.status).toBe("conflict");
    expect(result.issues.filter(issue => issue.code === "count").map(issue => issue.lineId).sort()).toEqual([first.id, second.id]);
    expect(result.unresolvedLineIds.sort()).toEqual([first.id, second.id]);
    expect(result.missingAmountLineIds).toEqual([]);
    expect(result.unallocatedAmountWon).toBe(row.amountWon);
    expect(result.scopes.find(scope => scope.id === "entryDoorCount")).toMatchObject({ status: "conflict", amountWon: null });
    expect(result.totalAmountWon).toBeNull();
    expectConserved(result);
  });

  it.each(["offsetting-amounts", "swapped-scope-sets"] as const)(
    "rejects %s even when all document and per-scope totals remain unchanged", kind => {
      const quote = emptyQuote();
      const first = addRow(quote, "first-package", [["structure", 10_000], ["roof", 10_000]]);
      const second = addRow(quote, "second-package", kind === "offsetting-amounts"
        ? [["structure", 10_000], ["roof", 10_000]]
        : [["mechanical", 10_000], ["electrical", 10_000]]);
      addRow(quote, "independent", [["common", 5_000]]);
      retotal(quote);
      expect(buildConstructionScopeLedger(quote).status).toBe("reconciled");
      const allocationTotals = () => QUOTE_SCOPE_IDS.map(scopeId => quote.lines
        .flatMap(line => line.allocations ?? []).filter(part => part.scopeId === scopeId)
        .reduce((sum, part) => sum.plus(part.amountWon!), new Decimal(0)).toNumber());
      const before = allocationTotals();
      if (kind === "offsetting-amounts") {
        first.allocations![0].amountWon = 100.01;
        second.allocations![0].amountWon = 99.99;
      } else {
        [first.allocations, second.allocations] = [second.allocations, first.allocations];
      }
      expect(allocationTotals()).toEqual(before);
      for (const seed of [1, 7, 93]) {
        const result = buildConstructionScopeLedger(permuted(quote, seed));
        expect(result).toMatchObject({ status: "conflict", knownAmountWon: 450,
          allocatedAmountWon: 50, unallocatedAmountWon: 400, totalAmountWon: null, missingAmountLineIds: [] });
        expect([...result.unresolvedLineIds].sort()).toEqual([first.id, second.id]);
        expect(result.issues.filter(issue => issue.code === (kind === "offsetting-amounts" ? "allocation.total" : "allocation.scopes"))
          .map(issue => issue.lineId).sort()).toEqual([first.id, second.id]);
        expectConserved(result);
      }
    },
  );

  it("does not let source-row order decide which duplicate amount is allocated", () => {
    const quote = emptyQuote();
    addRow(quote, "first", [["structure", 10_000]]).sourceLocator = "page 1 row 2";
    addRow(quote, "second", [["roof", 30_000]]).sourceLocator = "  PAGE   1   ROW 2  ";
    addRow(quote, "independent", [["mechanical", 5_000]]);
    retotal(quote);
    const forward = buildConstructionScopeLedger(quote), reversed = structuredClone(quote);
    reversed.lines.reverse();
    const backward = buildConstructionScopeLedger(reversed);
    expectConserved(forward);
    expectConserved(backward);
    expect(canonical(backward)).toEqual(canonical(forward));
  });

  it("quarantines every row sharing a normalized source, including earlier shared-package assignments", () => {
    const quote = emptyQuote();
    addRow(quote, "shared-first", [["structure", 10_000], ["roof", 20_000]]).sourceLocator = "page 1 row 2";
    addRow(quote, "duplicate-second", [["common", 30_000]]).sourceLocator = "  \uFF30\uFF21\uFF27\uFF25\t1  ROW 2 ";
    addRow(quote, "independent", [["mechanical", 5_000]]);
    retotal(quote);
    const result = buildConstructionScopeLedger(quote);
    expect(result).toMatchObject({ status: "conflict", knownAmountWon: 650,
      allocatedAmountWon: 50, unallocatedAmountWon: 600, totalAmountWon: null, missingAmountLineIds: [] });
    expect(result.unresolvedLineIds.sort()).toEqual(["duplicate-second", "shared-first"]);
    expect(result.scopes.filter(scope => ["structure", "roof", "common"].includes(scope.id)))
      .toEqual(expect.arrayContaining(["structure", "roof", "common"].map(id => expect.objectContaining({ id, status: "conflict", amountWon: null }))));
    expect(result.scopes.find(scope => scope.id === "mechanical")).toMatchObject({ status: "allocated", amountWon: 50 });
    expectConserved(result);
  });
});

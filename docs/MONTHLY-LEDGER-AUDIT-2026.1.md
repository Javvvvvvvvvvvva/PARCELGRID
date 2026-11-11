# Monthly Ledger Arithmetic Audit

Version: `project-ledger-arithmetic-2026.1`
Recorded: 2026-11-04
Scope: internal arithmetic only; official and expert approval remain unverified.

## Contract

`auditProjectLedger(input, ledger)` checks a completed monthly ledger using separate Number algebra and interval allocations. It imports only types and does not invoke the ledger builder, Decimal calculator, or revenue-policy helper. It does not mutate either input.

`buildProjectLedger` runs the audit before returning every ledger, including ledgers used by scenarios, cost sensitivity, and solvers. Failure throws instead of publishing the result. Valid financial formulas and amounts are unchanged; invalid negative or non-finite revenue inputs are rejected rather than accepted through normalization.

The audit returns its version, `internal-arithmetic` scope, `unverified` approval, status, checked row/equation counts, total failure count, at most 32 findings, and zero-valued cost input names. Zero is an input amount, not evidence that an expense is unnecessary or included elsewhere.

## Checked

- Complete, ordered months; finite amounts; permitted signs; matching equity-series length. Work is bounded to 1,361 rows.
- Allocation of land, acquisition, demolition, relocation, hard/soft cost, contingency, trust fee, and PF fee from the supplied source amounts.
- Six revenue pools, the existing residential 10/60/30 receipt model or bulk sale, and final commercial/lease exit receipts.
- PF commitment, eligible draws, opening and closing debt, repayment waterfall, final debt repayment, and average-balance interest.
- Required equity, opening cash plus receipts/draws/contributions versus expenses/repayments/distributions/closing cash, no early distribution, and zero final cash/debt.
- Monthly project/equity net, component totals, financing cost, debt/cash peaks, additional cost summaries, and project/equity profit reconciliation.

Amounts are raw manwon. Comparison permits Number serialization/arithmetic roundoff only: `max(1e-7, 32 * Number.EPSILON * (abs(actual) + abs(expected) + abs(scale)))`. This is not the displayed-money rounding threshold or a legal tolerance.

## Known Answer

Synthetic bulk-sale case: land 100, acquisition tax 10, acquisition other 5, demolition 20, relocation 30, hard cost 1,000, soft/contingency 0, trust fee 8, LTC 50%, annual interest 12%, upfront PF fee 2%, zero design months, one construction month, one exit month, sale 1,500. All amounts below are manwon.

| Month | Outflow | Receipts | PF draw | PF repayment | Closing PF | Interest | Equity contribution | Distribution |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 0 | 115 | 0 | 0 | 0 | 0 | 0 | 115 | 0 |
| 1 | 1,070.5 | 0 | 500 | 0 | 500 | 2.5 | 570.5 | 0 |
| 2 | 5 | 1,500 | 0 | 500 | 0 | 5 | 0 | 995 |

Total outflow is 1,190.5; financing cost 25.5; contributed equity 685.5; profit 309.5. With sale receipts reduced to 100, final additional equity is 405 and total equity is 1,090.5; debt is still fully repaid.

A separate integer/BigInt test checks the simplified bulk-sale interest identity `hardCost * ltcPct * annualRatePct * (constructionMonths + 2 * exitMonths) / 240000`, where other eligible costs and earlier receipts are zero. It covers construction up to 240 months, LTC 0/25/100%, and interest 0/6/100%. This formula is a test oracle for that case, not a general financing agreement.

## Review Integration

`integrated-verification-2026.13` adds `binding.ledger-arithmetic` and `modelVersions.ledgerArithmetic`. Baseline and cost sensitivity cases must calculate successfully and match the stored results. Missing/stale/unsupported inputs remain missing; calculation or reconciliation failures fail. A binding failure prevents approval through the existing shared gate.

The existing report panel displays the check and version. A new version produces a different review snapshot key; historical records are not erased. Approval remains unverified even when arithmetic is checked.

## Not Established

This is not independent external professional validation. It does not establish official boundaries, permission, actual market prices, tax applicability, lender agreement terms, actual quote completeness, or whether zero-valued costs are justified. Hard/soft/contingency inputs are checked for allocation, not independently derived from a complete bill of quantities. A separate full-model IRR/NPV oracle and review of other funding/break-even/retained-lease summaries remain outside this audit's scope.

The tests and synthetic browser checks do not satisfy final gates G03/G04/G06/G09 or replace actual-project and expert acceptance.

## Evidence

- `src/tests/finance/project-ledger-audit.test.ts`: 55 tests including known answers, independent integer interest, corrupted rows/totals, invalid sources, bounds, and mandatory failure enforcement.
- `src/tests/integrated-verification.test.ts`: 79 tests including new check/version and altered stored profit rejection.
- `artifacts/ledger-audit-2026-11-04/report.md`: full verification and production Worker/browser evidence.

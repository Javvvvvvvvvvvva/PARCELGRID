# Hold Period Input Validation 2026.1

Implementation: `hold-period-ledger-2026.4`. Scope is the hold-period ledger
boundary and decimal accumulation only. The 2026.3 operating, rollover,
deposit, DSRA, debt-service, and exit formulas remain in place.

## Confirmed Reproductions

Using the existing `input()` fixture in
`src/tests/finance/hold-period-ledger.test.ts`, five regression tests failed
before the fix:

| Override | Previous result | Corrected result |
| --- | --- | --- |
| `stabilizedAnnualOperatingExpenseManwon: NaN` | Zero operating expense and `commitment-feasible` | `terms-invalid`, no modeled cash flows or return metrics |
| `developmentEquityCashFlowsManwon: [-100000, NaN, 180000]` | `commitment-feasible` despite non-finite cash flow | `terms-invalid`, indexed diagnostic |
| `takeout.netTakeoutCashFlowManwon: NaN` | `commitment-feasible` despite non-finite closing cash flow | `terms-invalid` |
| `stabilizedAnnualPotentialRentManwon: Number.MAX_VALUE` | `commitment-feasible` with overflowing computed values | `terms-invalid`, calculation-range diagnostic |
| `developmentEquityCashFlowsManwon: [-0.1, -0.2, 0.3, 101000]` | Refinance cumulative balance `-5.551115123125783e-17` instead of zero | Exact zero and sustained payback at development month 2 |

The last fixture's final development cash flow becomes zero after subtracting
the retained lease value of 200000 and adding the signed takeout cash flow of
99000. The first three cash flows sum to exactly zero in decimal arithmetic.

## Input Contract

- Applicable, enabled holds require finite, nonnegative sale revenue, retained
  lease value, potential rent, operating expense, and lease area. Explicit zero
  is preserved. Vacancy must be finite and within 0 through 100 inclusive.
- Stabilized NOI must be finite but may be negative. A zero lease value or
  nonpositive stabilized NOI retains the existing `not-applicable` outcome;
  losses are not reclassified as malformed input or converted to zero.
- Applicability values are checked first. An applicable hold with an explicit
  zero-year period remains `not-configured`. Non-applicable and disabled cases
  do not require unused operating, development cash-flow, or takeout inputs.
- Development cash flows must be a nonempty, dense array of finite numbers.
  Negative and zero entries are valid; null, undefined, sparse entries, numeric
  strings, NaN, and infinities are rejected. Diagnostics identify the index.
- The equity hurdle must be finite and strictly greater than -100 percent.
  Negative rates inside that mathematical domain remain valid.
- Existing hold-term ranges and missing-term markers are retained. Missing
  hold-term objects are rejected without attempting to read their properties.
- A modeled takeout must have finite, nonnegative principal, net proceeds,
  upfront fee, DSRA balance, PF repayment amount, and refinance shortfall.
  Its closing cash flow must be finite and retains its sign. Missing closing
  cash flow is no longer replaced by nonnegative proceeds, and missing fees,
  DSRA balances, or shortfalls are no longer replaced by zero.
- The nine terms consumed by the debt scheduler must satisfy the existing
  takeout ranges, integer requirements, rate floor/cap relationship, and
  deferral/interest-only maturity constraints. Validation precedes schedule
  construction, including rejection of infinite or fractional maturities.
- Only modeled takeout statuses can produce modeled hold results. An upstream
  missing or non-applicable takeout remains unavailable (`terms-missing`);
  invalid or unknown takeout states are rejected.
- Non-finite computed schedules, cash flows, rows, rollover events, annual
  summaries, or final numeric metrics invalidate the result. No new maximum
  monetary amount or guessed replacement value is introduced.

Invalid results use the existing empty-result shape: empty rows/cash flows,
null financial metrics, and diagnostics in `invalidTerms` and `warnings`.
No input object or input array is modified.

## Precision

Totals, cumulative cash flows, and sustained-payback comparisons now accumulate
with the existing Decimal utility. This removes binary cancellation at exact
break-even. Monthly modeling formulas, growth/discount-rate conversion, display
rounding, and the imported debt schedule remain unchanged. Aggregate results
may differ where prior binary summation affected rounding or zero comparisons.

## Verification And Parent Handoff

The entries below describe the isolated implementation handoff. Parent later
integrated calculation v227 / verification 2026.16 and passed the full 3008-test
suite (one opt-in database test skipped), lint, typecheck and production build.
Current combined evidence: `artifacts/scope-ledger-2026-11-10/report.md`.

- Baseline: 11 existing hold-period tests passed.
- Before the implementation: five selected regression tests failed as above.
- After the implementation: 66 hold-period tests passed, comprising the original
  11 plus 55 validation/precision tests. Parameterized tests also iterate over
  NaN, both infinities, null, undefined, numeric strings, and relevant ranges.
- Targeted ESLint passed for the two changed TypeScript files.
- A TypeScript program rooted at those two files and their imports passed with
  the repository compiler options, `noEmit`, and incremental output disabled.
- No full verification, build, UI test, database operation, external service,
  or paid operation was run during the isolated implementation handoff.

The hold model version changes from 2026.3 to 2026.4 because invalid-input
semantics and exact decimal accumulation change. Parent owns the corresponding
global `PROJECT_CALCULATION_VERSION` and integrated-verification version updates,
plus affected snapshot/version fixtures and integrated verification. None of
those shared files were edited here. Existing saved data is not rewritten.

## Limits

This boundary checks types, numeric domains, consumed debt terms, and finite
results. It does not re-underwrite or reconcile finite takeout amounts against
one another, validate unused underwriting fields, or establish consistency of
independently supplied rent, expense, NOI, and area. Other modules' input
sanitizers remain unchanged. The 2026.3 model limitations remain, including the
absence of tenant-by-tenant lease modeling. No tax/legal or lender-approval
assertions are added.

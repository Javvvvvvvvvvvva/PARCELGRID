# Independent Finance Math Regression

Recorded: 2026-11-04. Project calculation version: `v225`.

An independent Number/BigInt test oracle found two incorrect default IRR results:

- `irr([-100, 1])` returned approximately `+10` rather than the exact periodic root `-0.99`. The fallback missed an endpoint root and accepted a narrow bracket without a converged residual.
- `irr([-4e-12, 5e-12])` returned the initial guess `0.01` instead of `0.25`. An absolute cashflow tolerance treated a tiny-scale non-root as converged.

The solver now checks endpoint roots, requires both absolute and relative discounted-cashflow residual convergence, scales the small-derivative cutoff, validates finite inputs/control arguments, maintains the current bracket sign, and returns null when its iteration budget cannot establish convergence. A small interval is not sufficient evidence of a root.

Search bounds remain unchanged: Newton rates in `(-1, 10]`, fallback bracket `[-0.99, 10]`, default 200 iterations per phase. This is not an all-roots solver. A low-level result for a nonconventional cashflow does not prove uniqueness; scenario/hold/after-tax callers retain their existing single-sign-change requirement. The new tests do not certify a complete external financial model.

Normal converged Decimal outputs, 30-digit precision, and denominator-power reuse retain focused regression coverage. Tests that previously preserved the erroneous endpoint or unconverged fallback were replaced with explicit analytic/residual/null expectations, not loosened to accept arbitrary results.

`src/tests/finance/independent-finance-oracle.test.ts` derives expected values using analytic roots, a separate Number/Horner/bisection implementation, and BigInt rational arithmetic. It covers NPV, IRR, scaling, periodic/annual conversion, negative/zero rates, multiple-root examples, invalid controls, and iteration exhaustion. No production calculator is used to construct expected answers.

Calculation v224 records remain intact but cannot be reused as current v225 results without recalculation. See `artifacts/construction-quote-2026-11-04/report.md` for suite and production Worker evidence. Official approval, real financing agreements, taxes, market assumptions, and professional financial validation remain unverified.

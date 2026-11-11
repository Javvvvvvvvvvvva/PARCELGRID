# Financial Decision Precision 2026.1

Status: v226 implementation, automated verification, production workflow/Worker and PDF verification complete, 2026-11-04. Not product acceptance.

## Contract

- Display rounding is not a target predicate. Scenario results retain optional `profitUnroundedManwon`, `npvUnroundedManwon`, and `irrUnroundedPct`. Missing precision in legacy saved results is unavailable, never replaced by the rounded display field.
- Monthly equity cash flows retain the ledger values. Rounding to integer manwon happens at display boundaries, not before after-tax computation. Existing tax evidence becomes stale when the input cash-flow fingerprint changes; it is not silently rebased.
- Acquisition search publishes an integer-manwon candidate only after re-evaluating that exact price. The published raw IRR and funding state come from that evaluation. `feasible` describes the independent current-price probe, not the sign of a difference from an approximate search result.
- `bracketed`, `search-limited`, `no-candidate`, and `invalid` are distinct. A missing candidate is null, not zero. Bounds, iterations, expansions and stop reason are retained. Unknown IRR cannot prove an infeasible upper bound. Finite search does not certify a global maximum.
- Rescue and stress gates require viable geometry, nonnegative finite raw profit/NPV, no confirmed funding shortfall and finite raw IRR meeting the target. Funding marked unverified remains unverified. Published rescue candidates are rechecked after input rounding.
- Revenue break-even uses raw profit. Stress search retains a passing current input when a remote endpoint has no calculable IRR, probes a bounded grid when necessary, and describes results as bounded candidates rather than global extrema.
- After-tax rows, tax additions/subtractions, cumulative totals and profit are summed using Decimal arithmetic before conversion for transport. Exact decimal break-even must not become a negative binary floating-point residue.

## Pareto Comparison

- Candidates with different finite-objective availability, including missing IRR, cannot dominate each other. This keeps a high-IRR candidate from disappearing merely because a different candidate has no IRR.
- Dominance requires exact no-worse comparisons on every available axis. Tolerance only determines a material strict improvement; it cannot permit a cycle of mutually dominating candidates.
- Leaders are selected relative to the actual extremum, then ties are compared to that fixed value. Focus uses exact lexicographic ordering with stable IDs. Explicit user selection is preserved, and eligible candidates precede any ineligible fallback.
- After-tax ranking uses finite raw profit/NPV, with raw IRR only when calculated. Expert-confirmed and preliminary sets remain separate. No new tax confirmation or external approval is created.

## Versions And Migration

Project calculation v226; integrated verification 2026.15; pretax Pareto 2026.5; after-tax Pareto 2026.2; after-tax ledger 2026.3; construction-cost ledger 2026.2; rescue/stress 2026.2.

Old saved workspaces, seals and audit history remain readable. Only explicit recalculation/save produces a new result. Current verification and keys include the updated calculation/decision versions. Never rewrite an old seal or call a historical v225 test v226 acceptance.

## Evidence And Limits

Historical defect reproductions are retained in `artifacts/max-acquisition-2026-11-04/`, `artifacts/cashflow-precision-2026-11-04/` and `artifacts/pareto-boundaries-2026-11-04/`. Their passing tests mean that the old defect was reproduced, not that the new code should satisfy the old faulty result.

New verification is tracked in `artifacts/finance-decision-v226-2026-11-04/`. After independent review fixed a Decimal accumulation edge and comparison coloring issues, the final combined run passed 2,873 tests plus lint, type checking and production build, with one opt-in database test skipped. Actual development UI passed ten synthetic checks across desktop/mobile viewports, including raw 14.979959326031883% failing a 15% target despite a rounded 15% display field. Actual production Worker matched SSR in69/69 runs. Separate production PostgreSQL/login/seal/logout workflows passed at both viewports; both19-page PDFs passed content checks and all38 pages were visually reviewed. Details and limits are in `artifacts/quote-production-v226-2026-11-04/report.md`.

These are synthetic engineering tests. Official boundaries, permits, actual contractor documents, tax applicability, lender commitments and independent qualified expert validation remain unverified. No automatic financial adoption, official approval, paid external call or public posting is authorized by this work.

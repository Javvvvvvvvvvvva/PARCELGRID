# Full Quote Adoption Preflight

## Implemented

- Version: `quote-adoption-review-2026.1`. This is a read-only preflight, not an adopted financial source.
- After explicit quote reconciliation, the user records the review date and six source-backed scope declarations: complete direct construction replacement, and exclusion of separately modeled demolition, soft costs, contingency, finance/trust costs, acquisition/tax/relocation costs.
- Declarations start blank and unchecked. A checkbox is the user's statement, not independent verification or professional approval.
- Require a current, nonfailed geometry snapshot, reconciled whole-quote scope ledger, supported quantity reconciliation, valid current baseline and positive full quote total.
- Require a review date equal to the runtime date in `Asia/Seoul` (explicitly labeled in the UI) and a quote still within its declared validity period. A historic successful comparison does not authorize use of an expired quote.
- Only declared VAT-included quote/baseline cash costs are supported for this preflight. VAT-excluded, exempt or unknown inputs remain unresolved. No VAT rate, tax liability or refund is invented.
- SHA-256 binding includes raw quote lines, scope allocations and sources, plan/interior/egress inputs, material/dwelling/quantity costs, cost inputs and raw geometry. Object-key order and render timestamps do not change this binding. Source edits invalidate prior declarations.
- A successful result displays the proposed whole direct-construction amount, the current amount it would replace and the difference. It never adds the full quote to existing base/material/dwelling/quantity costs.
- The editor performs current-session/current-scenario checks before evaluation. Changing a declaration clears its result; changing quote inputs clears the review and declarations.
- No financial patch, approval record, persistent consent, financial mutation or automatic saving is produced. The calculation/verification versions remain `v228` / `2026.17` because this review is not a new financial calculation model.

## Integration Repair

The Stage 2/3 quantity-cost bridge now requires current raw geometry for geometry-derived facade costs and checks the independently recomputed facade cost key. It no longer falls back to an area-based facade estimate in this combination. The real project recomputation service supplies the full parcel boundary, holes/components, setbacks, roads and sunlight inputs for this check.

## Verification

- Focused tests: 31 preflight tests; 46 quantity-cost binding tests (including the combined facade path and project service); existing comparison UI and finance bridge tests passed.
- Actual Next development UI: 1440/390 pixels crossed with valid, VAT-excluded and expired synthetic quotes. Empty declarations block; complete supported declarations produce the expected replacement amount; VAT and expiry remain unresolved; edits invalidate results and reset declarations. Zero real writes, input mutation, browser exceptions and horizontal overflow.
- Local evidence: `artifacts/quote-adoption-review-2026-11-11/browser.json`. Synthetic inputs are not actual quote or expert acceptance.
- Full `pnpm verify`: 3,256 tests passed, one opt-in PostgreSQL test skipped; lint, TypeScript and production build passed. The final added service assertion also passed in the 46-test targeted suite. Production PostgreSQL acceptance is separate.

## Still Required Before Financial Adoption

1. A distinct persistent full-quote source contract, explicit preview/confirm/remove and audit history, mutually exclusive with additive quantity replacement.
2. Independent source revalidation in the Stage 2 calculator, Stage 3 bridge, financial engine, integrated review and reports. Server-side time/binding checks must be repeated at adoption; a browser preflight result is not authoritative.
3. Recompute indirect costs, contingency, financing and monthly cash flows from the single adopted hard-cost source. Clearly identify whether fixed-quote escalation is supported in cost sensitivity, stress and rescue analyses; never imply that changing the baseline unit rate changes a fixed quote.
4. Quoted VAT/scope exceptions and actual original-document/QS/tax review. Official boundaries, permits and professional approval remain unconfirmed.

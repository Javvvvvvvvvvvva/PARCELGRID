# Full Quote Adoption Preflight

## Financial Adoption Follow-up (2026-11-11)

The read-only preflight remains distinct from the newly implemented explicit adoption action. The historical sections below describe v228. The current calculation is v229 and integrated verification is 2026.18.

- `full-quote-cost-2026.1` persists the whole quote, scope declarations, adoption date, original cost inputs, plan/version and raw-source SHA-256 key. Adoption requires a saved matching quote, a current Korean business date, an unexpired VAT-included quote and an explicit confirmation. Removal restores the original formula and preserves quote evidence.
- The adopted positive total replaces direct hard cost exactly once. Base, facade, dwelling and quantity costs remain comparison evidence; an active additive quantity finance contract cannot coexist. Indirect costs, contingency, financing and monthly ledgers recompute from this single cost source.
- Planning calculation and the financial bridge recheck raw source bindings. Invalid adoption preserves only visibly stale historic preview amounts and cannot enter finance as a valid fallback. Clone clears adoption; geometry lock blocks adoption changes. Saving a new plan version requires renewed quote validation.
- Workspace validation runs inside the local revision lock and the PostgreSQL transaction before audit/write. New/changed adoption requires today's Korean date; live promotion/recomputation checks current quote validity and rebuilt geometry. Unchanged historical drafts and explicit removal remain possible. Existing workspace revision/audit history records changes; no second approval ledger is invented.
- Financial calculation is deterministic: historic contracts validate their adoption date, not the wall clock. Live service reuse separately checks current validity. Integrated handoff rechecks the raw plan/geometry/quote and exactly one hard-cost total; a checked historic binding is not current quote validity or professional approval.
- Base-unit-rate low/high cost stress is unavailable for fixed quotes. No fake cost limit, VE saving, downside credit or balanced-rescue cost reduction is reported. Revenue sensitivity, break-even, finance/delay shocks and a disclosed fixed-quote combined case remain operational. Explicit quote escalation/change-order stress is still required separately.
- Actual Next synthetic UI: 1440/390 pixels, adopt/remove, expired and unsaved source cases passed. Browser errors and horizontal overflow were zero. Real writes were blocked; isolated browser storage was discarded. Evidence: `artifacts/full-quote-adoption-2026-11-11/browser.json`.
- Final `pnpm verify`: 3,335 tests passed; one opt-in PostgreSQL test skipped; lint, TypeScript and production build passed. The 110-test focused suite also passed. Independent code review found expired live reuse, reuse of a pre-removal calculation and missing financial snapshot-field checks; all three were fixed, regression-tested and re-reviewed. Primary-use changes also invalidate adoption.
- Actual database/production acceptance, full report/PDF path, real BOQ/QS/tax review and original-document authenticity are not proven by these tests. Official boundaries, permits and professional approvals remain unconfirmed.

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

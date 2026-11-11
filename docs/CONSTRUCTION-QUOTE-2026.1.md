# Construction Quote Evidence Reconciliation

Version: `construction-quote-2026.1` (2026-11-04).
Review integration: `integrated-verification-2026.14`.

## Purpose and Boundaries

Reconcile user-entered quote evidence with its declared scope and the supported conceptual quantities. This does not establish document authenticity, contractor competence, actual site conditions, market pricing, full bill-of-quantities completeness, tax treatment, permit compliance, or professional approval.

The quote is separate from `quantityCost`. Saving it never adopts its total or difference as project hard cost, revenue, parking, or area. Existing explicit quantity-cost adoption remains a separate workflow. Missing prices are null, not zero. A zero price requires an explanatory source note but is still unverified real-world evidence.

## Record

`PlanningScenario.constructionQuote` contains one current quote evidence record:

- Document reference, issuer, target address/work name, issued date, validity date, and explicit review date.
- Declared quote/base VAT basis. No automatic VAT conversion or tax-law determination.
- Up to 256 uniquely identified rows: description, original page/row locator, unit-price or lump-sum method, quantity, unit, rate, stated amount, VAT basis, optional supported model quantity, and note.
- Seventeen declared scope entries: ten broader construction categories plus seven supported residential detail quantities. This catalog is an intake checklist, not an exhaustive specification or a statutory list.
- Current input basis and base-rate assumptions. The SHA-256 basis includes the quantity source digest, primary use, parking, egress inputs, and cost inputs; object key order does not change the basis.

The target address/work name remains an unverified document transcription. Site/parcel authority and detailed specification matching still require original documents and external review.

## Checks

- Required source fields, real calendar dates, and issuance/expiry relative to the entered review date. There is no hidden wall-clock dependency and no claim of live quote validity after that date.
- Unique normalized original-row locators, complete row references, and no amounts attached to a scope declared excluded/unknown/not applicable.
- Unknown or excluded scopes stay incomplete. Non-unknown scopes require a source explanation. A package linked to multiple scopes is added exactly once.
- Row quantity times rate and overall stated total within one won; fractional count quantities and mixed lump-sum/unit-price data are rejected.
- Compatible VAT bases before totals or comparison values are displayed. Mixed or unknown row bases suppress aggregate/comparison amounts.
- Every row linked to a supported quantity scope participates in its reconciliation. All must carry the corresponding quantity tag, unit-price method, and matching unit. A stray untagged or lump-sum row cannot silently disappear from the count. Quantity tolerances are zero for counts and 0.01 for lengths/areas.
- A zero modeled quantity may have a documented not-applicable declaration. Positive modeled quantities cannot be declared not applicable.

Identical source-row detection and supported quantity totals do not establish that every differently worded lump-sum package is free of semantic overlap. Declared coverage is not expert verification of scope allocation.

## States and Workflow

States are absent, ready (internal input reconciliation only), missing, stale, and conflict. Every assessment retains `approvalStatus: unverified` and `financialApplied: false`.

The planning verification area's `견적 대사` tab offers explicit review, editable rows/coverage, source dates, draft JSON download, and explicit evidence save. Draft edits invalidate the displayed review. Valid incomplete drafts can be saved for follow-up; malformed, stale, locked, or externally changed drafts cannot overwrite the saved evidence.

Rebasing requires confirmation, preserves quoted prices/quantities/source text, and changes only the local draft's input basis. Saving is a separate action. Tabs preserve the current quote draft. Session invalidation clears local editor state and blocks actions/download.

Local JSON intake previews the exported quote format and requires confirmation before replacing the editor draft. It never silently rebases, saves, rounds amounts or adopts finance values. Stale imported bases remain blocked until explicit rebase; malformed or injected approval metadata is rejected. Limits are 8 MiB actual UTF-8 bytes, depth 8, 12,000 JSON values and five seconds. The byte bound covers pretty JSON at all schema string/row/link maxima, including six-byte JSON character escaping; maximum Korean and escaped-string round trips are regression tested. New file selection, draft/source changes, unmount and session invalidation cancel pending reads or discard their result. This is local structured evidence intake, not original-document authentication, external upload or automatic PDF/Excel/OCR extraction. See `artifacts/construction-quote-import-2026-11-04/report.md`.

Workspace schema validation preserves valid records and rejects malformed evidence. Duplicating a planning scenario clears quote provenance. Changed quote content changes the review snapshot key; prior history is not deleted. Existing shared review gates reject inconsistent present evidence; an absent optional quote does not newly block unrelated disciplines. Full-BOQ/external cost review remains missing even when quote input reconciliation passes.

The report includes entered document metadata, every row, declared scope, and explicit not-applied/unverified labels. JSON retains exact input values; the report formats quantities to three decimal places and monetary display to two.

## Verification

See `artifacts/construction-quote-2026-11-04/report.md`. Core quote regressions include the independently discovered untagged-row bypass, canonical JSON ordering, scope/price/VAT mismatches, stale sources, bounded persistence, and review key binding. Synthetic input prices are deliberately not market estimates.

Real disposable PostgreSQL evidence is recorded separately in `artifacts/postgres-quote-2026-11-04/db-report.md`: two tests passed on initial startup, restart and logical restore (six executions, no skips). Exact quote rows, financial payloads, revisions, two server seals and audit chains survived without quote reseeding. Tenant isolation is through organization-scoped application APIs, not database RLS. Actual browser/PDF workflow and operational failover/RPO/RTO are outside that DB run.

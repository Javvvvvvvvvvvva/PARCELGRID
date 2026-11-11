# Project Transfer Safety

The active handoff page retains `parcelgrid-project-transfer` version 2 and its
historical sorted-key FNV checksum. The checksum detects accidental changes; it
is not a signature, proof of source authenticity or professional approval.

## Payload and Compatibility

Optional `leaseRollDrafts`, `operatingBudgetDrafts`, `revenuePricingDrafts` and
`pendingOverrides` accompany the existing parcel, plans, financial snapshot,
assumptions and evidence metadata. An old v2 package keeps its original checksum
and omitted fields during validation. Defaults are inserted only into a separate
prepared workspace. Whole-project replacement means omitted collections clear
the target's corresponding saved drafts; the preview and confirmation disclose
this before application.

The original draft basis, revision, dates, explicit zero and missing values are
preserved. Stale bases remain stale. No draft is adopted into the financial
engine, rebound to current geometry or promoted to an approved state during
transfer. Legacy null project data may use the currently loaded data only when
its project owner matches. Full workspace validation precedes all mutations.

Wire input and output are bounded to 20 MiB, depth 48 and 250,000 JSON values.
The file reader uses actual streamed bytes, cancellation and a five-second read
deadline. Prepared workspace data additionally has the existing 10,000,000-byte
limit. Invalid structures, unsupported object keys, duplicate/foreign drafts,
orphan references and malformed pending assumptions are rejected.

## Lifecycle and Isolation

Imports first produce an inert preview. Explicit application requires update
capability, the original session, the active project and unchanged captured
workspace contents, rechecked after confirmation. Cancellation, navigation,
logout, a newer import or relevant project/review edits invalidate pending work.
Downloads require read capability and an active matching project.

The shared project workspace apply path preserves foreign projects' plans and
project-scoped drafts, including identical plan IDs. Legacy assumptions and
pending overrides lack project IDs: ambiguous collisions are rejected, not
guessed. Legacy pricing-key collisions with another project's draft are also
rejected. Replaced finance-only IDs are included in pending-assumption cleanup.
Explicit whole-project replacement clears only the target's per-tab lease and
budget editor recovery for replaced scenarios.

The dynamic project query's data is updated together with the imported store
data so the layout does not recompute against the previous parcel. Its existing
workspace record/revision remains the server-save baseline. Local application
is not reported as server persistence; the normal authenticated organization
revision/hash/audit synchronization and conflict flow remain authoritative.

## Evidence and Approval

Original attachment bytes and server approval records are not exported.
Imported attachment links are detached and tax reviews return to draft.
Imported expert-review objects never replace the authoritative review cache or
history. Existing server reviews remain tied to their original evidence keys.
Official boundaries, permits and professional approvals remain unconfirmed.

## Verification

Final `pnpm verify`: 3,884 tests passed, two opt-in PostgreSQL tests skipped;
lint, types and production build `00nc6H-pHgdkhbglPS473` passed. This includes
137 new transfer tests. Independent review reproduced and then rechecked fixes
for foreign finance-only assumption collisions, legacy tax-key collisions and
malformed nested price comparables. These checks validate input shape, not
professional price approval.

Separate actual PostgreSQL 18.6 and Chrome 157 testing of that frozen build
passed 27 workflow checks at each of 1440x1000 and 390x844, plus a same-plan-ID
two-project matrix at each viewport. Preview/cancel/export had no persistence
side effects; explicit application appended one workspace revision and audit
event. Query-data replacement survived layout, SPA navigation and reload.
Legacy omissions cleared only after confirmation; file approvals did not
replace server review authority. Reviewer writes returned 403 and real logout
cancelled a pending stream with subsequent requests returning 401.

All 24 workspace versions and 24 linked audit rows across six synthetic
projects survived PostgreSQL restart and dump/restore with identical content
hashes. Source/build/runtime hashes stayed unchanged. Owned app, database,
browser, ports and frozen copy were cleaned up; the user's port 3000 and
retained PostgreSQL runtime were not changed.

Evidence: `artifacts/project-transfer-production-2026-11-11/attempt-1/`.
Main inspected desktop, narrow, intermediate and native 390px screenshots;
320/390/768/1024/1440 bounds passed. Fixed mobile navigation can cover the
bottom of a long element screenshot at its sampled scroll position; real
scroll-and-apply workflows passed. This is Chrome viewport coverage, not a
physical-phone or complete accessibility audit.

This checkpoint does not certify actual customer documents, professional
approval, public deployment, CAD recipients or overall Final Goal acceptance.
Shared workspace API price-input validation is a separate follow-up: the
additional nested shape checks in this batch initially protect transfer only.

# Workspace Price Input Boundaries

The shared workspace validator now uses the same price-record and revenue
pricing schemas as project transfer. Validation checks the original object and
returns it unchanged: no defaults, normalization, stripping, status promotion
or recalculation changes its persisted hash.

Price records require finite numeric fields, string consumer fields and at most
10,000 structurally valid comparable snapshots. Project and target ownership
must match the containing workspace. Empty draft fields, empty comparables,
zero and finite historical negative values remain representable. This is safe
storage shape, not price approval readiness or proof of a comparable's truth.
Unknown price metadata remains preserved; the validation result is not used as
a replacement serialization.

Revenue pricing drafts use the existing strict version/pool/adjustment contract,
nonnegative optional prices, positive factors at most ten, ISO timestamps and
nonblank string identifiers. They must refer to a financial scenario in the
same project, be unique per scenario and number at most 256. Explicit null is
not an omitted number. Unsupported fields are rejected, not silently ignored.

Authenticated workspace PUT validation runs before persistence. Invalid input
returns 422 rather than creating a revision or audit event. Previously stored
invalid shapes fail the existing integrity check; this change does not rewrite,
delete or silently fall back to an older record. Such records require a separate
explicit repair process. This is not comprehensive validation of every field
in the larger computed project snapshot.

The price-review screen's fixed-width review column now stacks on narrow
containers. Comparable references, metric values and navigation can wrap;
inputs retain bounded widths. No price calculation or financial adoption rule
changed, and this is not the deferred whole-product design overhaul.

## Verification

The original malformed comparable and duplicate/null pricing acceptance was
reproduced before the change. Sixteen new regression tests cover boundaries,
authenticated route rejection without storage/audit writes, exact round trips
and historical invalid records with valid SHA/audit linkage failing without
repair or fallback. Independent static review found no additional P1/P2 in the
shared-schema scope. Final full verify passed 3,900 tests (two opt-in PostgreSQL
tests skipped), lint, types and build `8D4Xn3xl-Z11OpSM25XPz`.

Separate actual PostgreSQL 18.6/Chrome testing of that frozen build passed at
1440x1000 and 390x844. Each viewport passed eight malformed-price API requests
with HTTP422 and unchanged organization workspace/audit JSONB, and 28 workflow
checks including transfer regressions. Incomplete price drafts and additional
metadata survived export/import/reload. All 24 versions and 24 audit rows across
six synthetic projects survived database restart and dump/restore unchanged.

Price-review text/control/document bounds passed at 320/390/768/1024/1440 with
long synthetic references and large displayed amounts; main visually reviewed
desktop, intermediate, 320px and native 390px screenshots. Fixed navigation in
full-page screenshots is a viewport capture artifact; physical-phone and full
accessibility acceptance remain separate. No page errors or external/provider
requests occurred. Source/build/runtime hashes stayed unchanged, all owned
processes/ports/temporary roots were cleaned up, and user port 3000 was retained.
Evidence: `artifacts/workspace-price-production-2026-11-11/attempt-1/`.

## Follow-Up

A separate read-only audit identified existing price-review lifecycle defects:
review-requested updates leave an older verified financial source active,
reset can remove an independent source, and read-only users can mutate local
review state despite server authorization blocking writes. These are not fixed
by shape validation or responsive layout; the next batch must reconcile source
ownership and guard local mutation without treating it as expert approval.

The preceding transfer checkpoint remains separately documented in
`PROJECT-TRANSFER-SAFETY-2026.1.md`. Official boundaries, permits, professional
approval and customer/live-operations acceptance remain unconfirmed.

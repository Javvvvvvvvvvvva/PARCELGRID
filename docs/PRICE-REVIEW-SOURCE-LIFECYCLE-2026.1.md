# Price Review Source Lifecycle

This batch addresses review-requested transitions leaving an old verified price
source active, reset removing independent source evidence, and read-only users
being able to modify local price reviews despite server write authorization.

Generated price sources carry `price-review-source-2026.1` provenance with the
project, target and SHA-256 fingerprint of the review's known fields. This is an
ownership link, not an authentic signature, official appraisal or expert approval.
Shared workspace validation checks any present link against the matching
verified record and its generated source values. Unmarked historical inputs are
not silently rewritten.

An owned source may be replaced by a new verified review, or withdrawn when that
review returns to requested status or is reset. A different independently
registered source is preserved; applying a new verified price over it is blocked.
Attachments and additional source metadata are protected even on a valid link.
Legacy unmarked sources exactly matching a previous generated review are
ambiguous and require explicit source review before changing the linked review.
Already inconsistent or ambiguous historical data is not automatically repaired.

The client mutation boundary checks the live session, original session context,
`project.update`, active project and the rendered computation reference before
changing either store. The screen is keyed by project, locks on session loss,
and disables editing for read-only roles. Hydration and inspection remain allowed.
Messages distinguish local application from server persistence; the normal
revision/hash/audit synchronization remains authoritative. Expert review records,
official boundaries and permit status are not changed.

Paired mutations snapshot both stores. A persistence exception triggers both
rollback attempts, including when the first rollback also throws. Successful
rollback restores memory and cached values before allowing a retry. Failed
rollback locks the session and reports uncertain cache recovery; it never
deletes unrelated customer caches or claims a cross-localStorage transaction.
Source tests inject first/second-write failures and both rollback failures;
real-browser QA does not emulate a physical device's exhausted storage.

## Verification

The first candidate passed 22 new lifecycle tests and full verify with 3,922
tests, lint, types and build. Independent review then reproduced a persistence
exception between the two store writes, leaving an orphaned source. That
candidate is not the final accepted build. Paired rollback, failure injection,
final full verification and a new isolated actual PostgreSQL/Chrome lifecycle
run are in progress. Earlier price-input/transfer results are not reused as
proof of this batch. See `WORKSPACE-PRICE-INPUTS-2026.1.md` for the preceding
completed checkpoint and original audit findings.

Final acceptance for this bounded batch: 28 new lifecycle/rollback tests;
`pnpm verify` passed 3,928 tests, two opt-in PostgreSQL tests skipped, lint,
types and build `kw3Q0IXDTobfPs8s9KN4H`. Main reviewed the paired rollback and
failure-injection matrix after the independent finding was fixed. The previous
candidate's log remains separate from `/tmp/parcelgrid-price-lifecycle-verify-2.log`.

Separate actual PostgreSQL 18.6/Chrome testing passed at 1440x1000 and 390x844:
six UI lifecycle mutations per viewport, independent-source collision rejection
and preservation, eight malformed API requests, readonly controls, and 29
workflow checks including transfer compatibility and same-ID project isolation.
Synthetic API setup/restoration was explicit and preceded transfer measurement;
there was no reset inside the same-ID matrix. All 40 workspace revisions and
40 audit rows across six projects survived restart and dump/restore with identical
content hashes, including intermediate price-source states.

Price text/control bounds passed at 320/390/768/1024/1440. Main visually inspected
readonly desktop and native 390px screenshots; preceding responsive layout
visuals remain separately documented. No page errors or external/provider
requests occurred. Source/build/runtime hashes remained unchanged, and owned
processes, ports, runtime root and frozen copy were removed. Evidence:
`artifacts/price-lifecycle-production-2026-11-11/attempt-1/`.

This is synthetic software verification, not actual appraisal, physical-device
storage exhaustion, operational recovery SLA, professional or Final Goal acceptance.

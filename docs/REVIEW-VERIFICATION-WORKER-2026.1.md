# Review Verification Worker 2026.1

## Scope

The handoff and report screens prepare their integrated verification outside the
UI thread. The saved path runs the existing `buildReviewSnapshotPayload` and
`buildServerReviewSnapshotKey`; the preview path runs the existing
`buildIntegratedVerification`. Financial, geometry, room, parking and approval
models are unchanged. The server independently validates the submitted snapshot.

The resulting packet and SHA-256 key are one result. The browser does not repeat
the expensive verification or canonical hashing after receiving it. Transport
checks still reject a different project, scenario, scenario version, geometry
hash, malformed key, unexpected result kind or manufactured approval status.

## Lifecycle

- A dedicated worker has a 20-second hard timeout. A result received after the
  deadline is rejected even if the timer callback has not yet executed.
- Cancel, input replacement, route unmount and session invalidation terminate
  the worker. A late result cannot restore a report, packet or current seal key.
- Results are associated with the exact immutable input request. A new render
  hides the old result before effect cleanup. Store updates use new objects;
  in-place mutation of otherwise unchanged React inputs is not a supported API.
- A session change clears completed results as well as running work. No
  synchronous fallback is attempted when workers are unavailable or fail.
- Retry is explicit. Cancellation, failure and timeout remain incomplete, not
  a successful empty list. Current sealing/download controls receive no packet
  while incomplete. The report's print button is disabled until verification is
  ready; browser-initiated printing retains the visible incomplete warning.
- Existing historical seals and approvals remain stored. They do not become
  current merely because another verification is pending.

## Boundaries

This is responsiveness and lifecycle protection, not faster calculation,
additional legal coverage, official approval, qualified expert review or
production performance acceptance. Structured-clone and React rendering still
use some main-thread time. Full-size concurrent production workloads and
cross-browser/mobile-device performance need separate measurement.

The synthetic evidence lives in `artifacts/review-worker-2026-10-29/`. The
production workflow and printed reports are exercised by
`artifacts/report-print-2026-10-29/verify-production.mjs`. Follow the evidence
report's actual completion status rather than treating a harness as proof that
it passed.

# Full Quote PostgreSQL Regression

This gate exercises the v229 full-quote contract using an isolated, real
PostgreSQL 18.6 cluster. It does not certify production deployment, professional
approval, official boundaries, permits, or a real contractor's quote.

## Reproduction

Requirements: Node 24, installed repository dependencies, and a trusted native
PostgreSQL 18.6 binary directory. The runner currently targets the macOS local
verification environment and uses an owned directory under `/private/tmp`.

```sh
env -u DATABASE_URL node scripts/verify-postgres-full-quote.mjs \
  --bin=/absolute/postgresql/install/bin \
  --evidence=/absolute/PARCELGRID/artifacts/full-quote-postgres-new-run
```

Use a new evidence directory for each run. Existing results are not overwritten.
Never supply a customer database: the runner rejects inherited `DATABASE_URL`,
creates its own cluster, database and restricted application role, and injects
only its generated loopback connection into the test process. Environment files
are disabled. Development port 3000 and normal PostgreSQL port 5432 are excluded.

The runner applies the actual migrations, tests the initial database, restarts
the server, and repeats the tests. It then takes a logical backup, restores into
a second database, and repeats the tests again. Table content hashes, schema,
constraints, indexes, trigger definitions and permissions must match across
the restart and restore boundaries. A skipped or failed test fails the gate.

The full-quote records are created only in the initial phase. Later phases must
read the same stored workspaces and audit seals, not rebuild replacement data.
The older generic runtime test also runs in every phase and creates its own
independent membership, concurrency and immutable-history test records.

Loaded source and PostgreSQL binary hashes are checked for changes. Cleanup
must close clients, stop the owned server, verify the port/processes are gone,
and remove only the newly created cluster, dump and caches. Officially verified
PostgreSQL binaries may be retained for subsequent isolated tests.

## JSONB Editor Regression

The first production-browser verification of v229 reproduced a saved-quote
adoption failure: PostgreSQL JSONB reordered object keys, while the editor
compared the persisted quote with its schema-parsed draft using raw
`JSON.stringify`. Identical content was reported as an unsaved quote.

The editor now uses the existing workspace canonical JSON comparison. Object
key order is irrelevant; array order, monetary values, source references and
session checks remain significant. Two failing regressions reproduce the old
behavior. Three additional cases retain rejection of changed totals, source
locators and row ordering. The focused 94-test suite passed after the fix.

The subsequent real-browser run exposed a second boundary mismatch: a native
number line sum was `1028349.9340842303`, while the decimal ledger sum serialized
as `1028349.9340842302`. Preflight accepted it but adoption's document comparison
required bit-for-bit equality. The original quote is now preserved and compared
using only a relative binary roundoff bound (`4 * Number.EPSILON`). The adopted
cost must still equal the canonical ledger total exactly; this bound cannot
justify changing the adopted cost. A real document adjustment, including a
half-won difference, blocks preflight until the source is reconciled. This is
not an automatic currency-rounding or unexplained-discount policy. Thirteen
precision regressions cover this distinction and the existing maximum adopted
amount. Roundoff tolerance does not allow a canonical ledger or replacement
cost above the shared 10-trillion-won ceiling to pass preflight.

## Browser/Server Road Precision

The next production attempt reached adoption but the server rejected its source
key. The captured synthetic request reproduced a Chrome/Node difference of
`3.552713678800501e-15` meters in two road X coordinates. Both runtimes produced
the same existing geometry hash, but the quote review correctly binds the raw
snapshot as well, so its keys differed.

Generated road snapshot coordinates now use the geometry identity's existing
six-decimal meter precision. The quotation hash algorithm, monetary values,
building/parcel calculations and supplied historical snapshots are unchanged.
This is numeric serialization precision, not measured survey accuracy or a
legal geometry tolerance. A 0.01-meter road edit still changes the geometry
identity; editing raw road points while retaining a forged unchanged geometry
hash also invalidates adoption. Historical contracts replay with their original
unrounded snapshot. Rebuilding an old live snapshot can require explicit
renewed scope review; no historic review key is silently rewritten.

The preserved rejected request now produces identical full generated snapshots
and quote review keys in isolated Chrome and Node. Regression coverage includes
road precision, unchanged geometry identity, real edits and historical replay.
The focused geometry/quote/workspace suite passed all 125 tests.
An additional 15 synthetic latitude/rotation combinations produced identical
full generated snapshots and source keys in Node and Chrome. This is numerical
cross-runtime coverage, not regulatory support for those locations. Evidence:
`artifacts/full-quote-production-snapshot-2026-11-11/runtime-comparison.json`.

## Saved Business-Cost Alignment

After the road correction, actual browser adoption persisted successfully but
the dashboard restored the pre-adoption business-cost snapshot. The plan ID,
version and geometry hash had not changed, so the prior alignment check accepted
the old snapshot. The preserved request contains a full quote of
`1028349.9340842302` won alongside an incorrectly restored baseline of
`99360` manwon. These are synthetic deliberately different test amounts, not a
realistic contractor quote or a property recommendation.

Both saved-snapshot alignment and dashboard readiness now compare the complete
validated full-quote contract. Adoption/removal, amount, original quote, scope
declarations and source-key changes require recalculation and explicit saving.
Schema-order comparison remains independent of JSONB object key order. Old
snapshots are retained as history, not applied to the current plan. Seven new
regressions and the focused 68-test snapshot/dashboard/adoption suite passed.
Independent scoped code review reported no actionable findings. Two additional
tests cover historic alignment after quote expiry and rejection of identical
malformed contracts, bringing this regression file to nine tests.

`artifacts/full-quote-production-road-2026-11-11/attempt-1/` first exposed this
failure. Attempt 2 additionally waited for a new persisted revision and savedAt,
disproving an early-read-only explanation. Both failures remain preserved; the
follow-up production run is separate in
`artifacts/full-quote-production-snapshot-2026-11-11/`.

## Evidence Scope

- Official PostgreSQL source checksum/build/SQL smoke evidence:
  `artifacts/full-quote-postgres-2026-11-11/runtime-setup.json`.
- Pre-fix production attempts, including a corrected test selector and the
  actual JSONB adoption failure:
  `artifacts/full-quote-production-2026-11-11/attempt-1/` and `attempt-2/`.
- Post-fix production and DB results are separate from these preserved failures.
  Results must be inspected before claiming that either workflow passes.

The latest real DB run in `artifacts/full-quote-postgres-2026-11-11/attempt-5/`
passed two test definitions in each of three phases: 6 executions, 0 skipped.
All 11 table content hashes and schema/permission snapshots matched after
restart and logical restore. The full-quote fixture retained five workspace
versions across two organizations, two historical seals and seven audit events.
It also retained a nonzero quantity allowance as reference without adding it to
the adopted full quote; removing adoption restored that baseline allowance.
All 100 loaded source hashes were stable across phases. Cleanup confirmed closed
clients, stopped server, closed port, no owned processes/fallback storage, and
removal of the disposable databases and dump. Attempt 1 is retained separately:
its fixture incorrectly supplied geometry to an area-estimate cost comparison;
the corrected fixture follows the actual service's geometry-selection rule.
Attempt 2 predates the ceiling guard; attempt 3 includes that guard; attempt 4
also includes road snapshot normalization; attempt 5 includes saved-cost
alignment. All previous evidence is preserved.
The cross-runtime diagnosis and corrected comparison are respectively in
`artifacts/full-quote-production-final-2026-11-11/source-diagnosis.json` and
`artifacts/full-quote-production-road-2026-11-11/source-diagnosis.json`.

Final full verification: 3,364 tests passed and two opt-in PostgreSQL tests were
skipped in the ordinary suite. Both opt-in tests passed separately in all three
real DB phases above. Lint, TypeScript and the production build also passed
(`Gwrk42DatgYpmLiv1aCm7`). The exact build and source hashes are frozen for the
production-browser test; runtime/database evidence is not a substitute for
that browser/PDF result.

The frozen snapshot-alignment build subsequently passed the actual production
browser workflow at 1440px and 390px: login, import preview without writes,
explicit quote save/reload, scope review/adoption, new Stage 3 save, stale v228
blocking, explicit v229 save, server sealing, report content, adoption removal,
retained historic seal and a delayed-file/logout race. Reviewer reads returned
200; reviewer writes/sealing returned 403; logged-out reads returned 401.
Both browser cases had zero page errors or horizontal overflow, and no external
requests. The runner confirmed app/DB shutdown and disposable-root cleanup.

Each real browser PDF contained 21 pages with all eight quote rows, 17 scope
labels, expected monetary cells, source basis, calculation version, server seal
and unconfirmed-approval labels. Extraction found no outside-page characters.
Visual review of all 42 pages then found the dark comparison summary split
between pages 11 and 12. Content-check success was not treated as print-layout
acceptance: `.rpt-reco` now shares the existing print `break-inside: avoid` rule.
The follow-up print gate also requires all four summary labels and values on
the title's page. New-build evidence is kept separately in
`artifacts/full-quote-production-print-2026-11-11/`.

The print-only correction built successfully as `VTYrZLOBNVnbIhVKD3Ovm`.
The same full browser workflow passed at both widths in `attempt-3/` without
product source changes during verification. Its original aggregate status is
preserved as failed: the PDF check read mixed Korean/Latin glyph tops as
`억 3.0` instead of the visually correct `3.0억`. Read-only reinspection of the
same PDFs groups the observed 3.4pt top-metric difference with a 4pt text-line
extraction tolerance. It changes no layout, money or clipping tolerance.
`pdf-inspection-corrected.json` passes all original content checks and the new
same-page summary check for both 22-page PDFs. Visual inspection covered all
44 pages; the four summary labels and values are together on page 12, with no
observed clipping or overlap. This is scoped print regression acceptance, not
final design/user acceptance. Source/build/runtime hashes stayed unchanged and
all owned-process/database cleanup checks passed.

The print gate's first two attempts remain preserved as harness failures:
the first injected a historical record before the browser acknowledged its
previous save, and the second waited for a responsive-hidden mobile save badge
to become visible. The third checks the actual DOM acknowledgement against the
database revision, including on mobile. Original result files are not rewritten
to turn failures into passes.

Application organization filters are tested, not PostgreSQL row-level security.
Local loopback tests do not establish deployed HTTPS, multiple-instance
behavior, failover, RPO/RTO, real devices, external data quality or expert review.

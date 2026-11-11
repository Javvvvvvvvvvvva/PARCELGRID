# Lease-Roll Draft and Monthly Comparison

`lease-roll-2026.1` stores scenario-specific input drafts.
`lease-roll-comparison-2026.1` compares their contractual rent and restricted
deposit movements over 24 calendar months. Neither is a financial adoption
contract, a lease-authenticity verification or a professional approval. The
base financial calculation remains v229.

## Scope and Inputs

- Each row has a stable contract ID and unit ID, unit label, residential/retail/
  office use, revenue-pool-compatible area, monthly rent, deposit, inclusive
  start/end dates and source name/reference/as-of date.
- Monthly rent means KRW excluding VAT and service charges. It is scheduled
  contractual rent, not collected cash or NOI. Deposits are separate liabilities.
- Missing amounts and dates remain null. A zero rent or zero deposit is an
  explicit input, never a replacement for missing data. Incomplete drafts may
  be saved, but cannot produce a complete comparison.
- Contract dates are real calendar dates between 1900 and 2199. The calendar
  anchor must be a month's first day and represents the first **operating**
  month after development. It is supplied explicitly, not inferred from a
  permit, construction schedule or a lease's earliest date.
- The horizon is exactly 24 months and must end by 2199-12-31. There are at
  most 256 contract rows per draft and 256 scenario drafts per workspace.
- Row amounts and each aggregate of rent, opening/closing deposits, cumulative
  receipts and cumulative refunds cannot exceed KRW 10 trillion. Overflow is
  blocked without clipping, zero fallback or a partial passing schedule.

## Calculation and Area Checks

Rent is constant over a contract's stated period. Each month's rent is its
monthly amount multiplied by occupied calendar days divided by that month's
actual day count. Start and end days are included; UTC calendar arithmetic
avoids local daylight-saving changes. Decimal arithmetic is retained until the
numeric result boundary. The UI rounds only the displayed amount to two
decimal places; this is not a contractual billing/rounding policy.

A deposit is received on the start date and refunded on the day after the
inclusive end date. Contracts already begun contribute to the opening
restricted liability. A contract ending the day before the anchor contributes
to opening liability and refunds on the anchor date. Deposits whose refund
date is beyond the horizon remain a closing liability; the model does not
invent a sale, liquidation or early refund in month 24. Deposits never increase
rent or equity return.

Same-unit contracts must have consistent use/area and nonoverlapping inclusive
date ranges. Sequential leases count the unit's area once. Per-use area cannot
exceed its locked revenue pool by more than 0.000001 sqm (numerical tolerance,
not a legal tolerance). Underfilled area is displayed as unassigned, with no
invented rent. Unit IDs are user-supplied references, not verification that a
unit exists in an approved interior plan or legal registry.

The optional comparator is the current aggregate hold model's
`effectiveGrossIncome`, converted from manwon to won and matched by operating
`holdMonth`. Its vacancy/concession effects are not applied again to contractual
rent. Unavailable, malformed, duplicated or out-of-horizon baseline rows show
null/unavailable, not zero. A ready contract schedule can therefore have no
available aggregate comparison. Baseline and contract rent need not represent
the same occupancy or expiry assumptions; a delta is not a profit estimate.

## Binding and Persistence

The source basis hashes project/scenario identity, area-contract version,
source-plan identity/version, geometry hash and all six revenue-area pools in
a fixed field order. PostgreSQL JSONB key ordering does not alter the basis.
Changing physical/disposition inputs makes the draft stale. Price/cost-only
changes do not rebind physical units; they still invalidate the displayed
comparison because its complete scenario and baseline input key changes.

The editor keeps unsaved edits local, then explicitly saves a draft with the
next revision. The store checks the current project/computed scenario and
expected revision. Workspace persistence uses the existing authenticated,
organization-scoped version/hash/conflict flow. Local save requests are not
presented as a server acknowledgment. No operation writes planning inputs,
representative geometry, financial results, the Stage 3 snapshot or approvals.

Workspace payloads from before this optional field remain valid without hash
rewriting. Hydration replaces drafts only for the matching project. Existing
drafts remain retainable while their planning owner awaits financial
recomputation; editing/saving requires a current computed scenario. Deleting a
plan, individually or through current-project bulk regeneration, removes its
associated drafts, not another project's drafts. Explicit draft deletion is
available separately.

Import is local JSON, bounded to 8 MiB, 6 levels, 8,000 values and a 5-second
read timeout. Unknown approval/adoption metadata is rejected. Foreign
project/scenario files are rejected by the editor; stale same-owner files keep
their original basis and cannot compare until explicitly rebound and checked.
Preview/apply is tied to the current input context. Logout, navigation or
context changes abort pending reads; changed saved drafts require reload or
export of local edits. Same-document SPA navigation retains unsaved editor
inputs in a per-tab memory cache, including invalid unfinished inputs and the
original saved baseline. Returning to the editor restores these inputs without
writing them to the server. Save/reload/delete and session invalidation clear
the recovery entry. Hard refresh/closing the tab has an unsaved-input warning;
cross-document recovery of unsaved editor inputs is not supported. Readers
cannot mutate drafts or run analyses without
the corresponding capability. API permissions remain authoritative.

## Remaining Integration

This stage does not adopt contract rents into development/hold finance or saved
reports. A later explicit adoption contract must reconcile operating expenses,
renewals, concessions, delinquency/default/early termination, tenant improvement,
commissions, underwriting NOI, borrowing and exit valuation together. A partial
rent schedule must not replace those linked assumptions piecemeal. There is no
automatic renewal, replacement tenant, rent escalation or unassigned-unit rent.
Independent lease/valuation/tax review and real project evidence remain needed.

Official boundaries, permits and professional approvals remain unconfirmed.

## Verification

Full `pnpm verify` passed 3,616 tests with two opt-in DB tests skipped, plus
lint, TypeScript and the production build. This includes 180 lease regressions
and 59 project-scope/initialization regressions. Independent scoped reviews
found orphan-draft cleanup and same-ID project lookup risks; those were fixed
with regression coverage. A later review found starter creation before the
requested parcel became active; its effect now checks the parcel ID and records
initialization only after successful insertion. Retained legacy manager tests
explicitly load the active parcel before editing and verify pre-load edits do
not write. The final full log is `/tmp/parcelgrid-lease-roll-project-scope-verify-2.log`.

Frozen production build `qXtw3c_gm2NN6WmP3gjFr` passed actual PostgreSQL and Chrome
synthetic workflows at 1440 and native 390px. Each passed 15 checks covering
explicit preview/apply/save, independent daily-oracle comparison of all 24
months, UI/API/JSONB revision/hash/audit agreement, dirty and invalid SPA edit
recovery, malformed/overlap/foreign imports, stale basis and explicit reconnect,
delete/cancel/restore, reviewer read-only API denial and real logout during a
delayed import. Original financial data remained unchanged. Both had no page
errors. Responsive checks at 320/390/768/1024/1440px found no document overflow
or panel text/control boundary failures; final panel/reviewer screenshots were
inspected. The monthly table intentionally scrolls horizontally on narrow
screens. Fixed mobile navigation is present in tall section captures.

The same run restarted PostgreSQL, dumped/restored to a fresh database, and
matched complete workspace/audit content hashes including ten lease-bearing
versions. These are actual browser-saved data durability checks, not reruns of
the two opt-in unit-suite definitions. All owned processes, ports and temporary
cluster data were cleaned up; source/build hashes remained unchanged. Evidence:
`artifacts/lease-roll-project-scope-2026-11-11/attempt-1/`.

Earlier failed runs remain preserved: 320px parent-grid overflow, a diagnostic
harness array initialization error, and second-project preparation selecting
another project's same-ID plan. The latter prompted active-project-scoped
mutations, representative selection, finance filtering, Stage 3 resolution and
interior/export live lookups. Ambiguous current IDs fail closed; legacy unowned
plans belong to the active project. This bounded repair is not certification of
every global store field or every project-navigation race.

No real tenant records, external requests, approvals, paid services or publishing
were used. Synthetic evidence does not certify customer leases, actual
collections, physical devices, all browsers or production operations.

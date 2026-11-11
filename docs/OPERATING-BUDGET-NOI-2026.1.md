# Operating Budget and Scheduled NOI

`operating-budget-2026.1` is an input draft for owner-borne operating expenses.
`lease-roll-noi-comparison-2026.1` compares 24 months of scheduled contract rent
minus those expenses. It is read-only, `financialApplied: false`, and
`approvalStatus: unverified`. It does not change the v229 financial engine,
financing, underwriting, IRR, tax results, saved reports or professional reviews.

## Basis and Coverage

The budget is bound to project/scenario and the same physical revenue-area
contract as the lease roll, using a separate versioned SHA-256 tuple. JSONB key
order does not alter the basis. Changed physical inputs require explicit
reconnection and renewed cost-scope acknowledgment. Source authenticity is not
verified by a matching hash.

The six required categories are property-related operating tax, insurance,
routine maintenance, management, utilities and other operating costs. Each has
a source name, document/page reference and as-of date, plus exactly 24 unique
calendar-month amounts for a complete comparison. A valid draft may be
incomplete. Missing categories, sources, months, amounts, allocation notes or
scope acknowledgment do not become zero. Explicit source-backed zero is valid.

The user acknowledges coverage of the entire retained lease portfolio,
including vacant and unassigned space and the owner's allocated common costs.
This is not merely a budget for named occupied units. Costs are entered net of
recoveries and include nonrecoverable taxes as a stated model assumption, not
an automatic tax classification or determination. Financing, income tax,
capital expenditure, replacement reserves, tenant improvements, leasing
commissions and major repairs are outside this NOI contract. The application
cannot infer whether a free-text source actually covers the acknowledged scope.

## Calendar and Arithmetic

The budget's first month must match the lease comparison's explicit operating
start date. Both are model calendars; neither establishes a physical completion
date or permission to operate. The budget supports 24 months within 1900-2199.
Changing its anchor explicitly clears monthly amounts and the scope
acknowledgment after confirmation when amounts exist. It does not relabel
already-entered costs into another period. Source notes remain available.

Contract rent comes from the existing daily-prorated lease comparison, excludes
VAT and service charges, and is not actual collections. Decimal arithmetic
sums six expense categories per month and subtracts them once from scheduled
rent. Negative NOI remains negative. Expenses continue after lease expiry or
during vacancy according to the entered calendar; no proportional vacancy
discount is inferred. Deposits and their refunds never enter NOI. Amounts are
nonnegative and finite, with a KRW 10-trillion ceiling on each expense and the
24-month expense aggregate. Over-limit data is blocked without clipping.

The optional existing-model comparator requires a separately supplied
`baselineCalendarStart` matching the lease calendar. It matches hold months
1-24, converts manwon to won, and checks EGI minus operating expense against
reported NOI with a numerical serialization tolerance. Missing, duplicated,
inconsistent or invalid baseline rows remain unavailable. A missing/mismatched
baseline calendar does not invalidate a complete contractual budget comparison;
it only prevents claiming that the existing model's month labels align.
Validated baseline income and expense totals are each limited to KRW 10
trillion across the 24 months. Excess totals suppress baseline NOI/deltas only;
income and expense are not netted to conceal a large offsetting baseline.

## Editor and Storage

The editor exposes source fields, individual monthly costs and an explicit
24-month repeated-amount command. Replacing existing monthly amounts requires
confirmation. Imported JSON is previewed before applying, bounded to 8 MiB,
6 levels, 8,000 values and a 5-second read timeout. Foreign owners and unknown
contract fields are rejected. Imported stale bases remain stale until explicitly
reconnected and checked; no implicit adoption is performed.

Edits remain local until explicit draft save. Server persistence uses the
existing authenticated organization/project revision, payload hash and audit
flow. Old payloads may omit `operatingBudgetDrafts` without hash rewriting;
explicit null and duplicate/foreign owners are rejected. Plan removal cleans
up that project's associated budget, preserving foreign same-ID projects.
Deleting a lease draft does not delete its independent budget, and deleting a
budget does not change the lease draft or base financial result.

Same-document SPA navigation retains dirty input and invalid unfinished numbers
in a session-bound in-memory cache. Server conflicts retain the original local
baseline and require explicit reload or export. Logout clears recovery and
aborts pending imports; hard-refresh/close warns about unsaved data but does not
promise cross-document recovery. Read/write/analyze capabilities and server
authorization remain authoritative.

## Remaining Integration

A scheduled NOI comparison is not underwriting NOI, distributable equity cash
flow or investment profit. Actual collections, lease incentives/renewal/default,
expense classifications, completion timing, takeout debt and forward exit NOI
must be reconciled before a later adoption contract can affect base finance.
No terminal value is inferred from a final partial month or an expired lease.
Official boundaries, permits and professional approvals remain unconfirmed.

## Verification Status

Final `pnpm verify` passed 3,747 tests (two opt-in PostgreSQL tests excluded),
lint, TypeScript and production build `SbJNgwF-n6XH0Okoto5-P`. The 131 new tests
cover calculation, import, workspace persistence, session recovery and editor
events. Independent review identified an absent aggregate limit for the
optional baseline; the fix and five additional cases are included. Earlier
fixture failures remain in `/tmp/parcelgrid-operating-budget-verify-2.log`;
the final stable run is `/tmp/parcelgrid-operating-budget-verify-3.log`.

Actual isolated PostgreSQL 18.6 and Chrome production checks passed at desktop
1440px and native 390px, with 32 workflow checks and 19 comparison states each.
An independent daily rent and category-sum oracle matched all 24 displayed
months and frozen Node results. Save/reload/export, invalid inputs, calendars,
missing versus zero values, stale bases, SPA recovery, deletion, reviewer 403
and real logout 401 with delayed-read cancellation passed. Other financial,
lease, geometry and saved Stage 3 fields remained unchanged by budget writes.

Screenshots at 320/390/768/1024/1440px and both reviewer views were inspected.
Text/control/document bounds passed; the wide result table intentionally
scrolls horizontally. Fixed bottom navigation appearing within a tall panel
capture is a viewport capture artifact, not an extra inline navigation bar.
No page errors or provider/external requests occurred.

PostgreSQL restart and custom dump/restore preserved all workspace/audit content
hashes, including eight budget-bearing and twelve lease-bearing versions across
the two synthetic projects. Source/build/public manifests remained unchanged;
owned servers, clusters, ports and frozen build copy were cleaned up. Evidence:
`artifacts/operating-budget-production-2026-11-11/attempt-1/` and
`frozen-cleanup.json`. This is scoped synthetic evidence, not the generic DB
suite, live operations, real customer budgets or external professional sign-off.

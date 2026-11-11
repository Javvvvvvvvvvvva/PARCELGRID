# Fixed Quote Cost Risk

`full-quote-stress-2026.1` is a read-only hypothetical increase over an adopted
full construction quote. `deal-stress-2026.3` exposes the increase separately
from basic unit-rate sensitivity. The base calculation remains v229; original
quotes, their adoption contracts, saved financial results and approvals are not
modified by running this analysis.

## Calculation

- The adopted quote and its original plan/input binding must validate first.
- The percentage is a finite number from 0 through 100. The initial 10% is an
  illustrative assumption, not a forecast, market observation or confidence
  interval. Blank/invalid inputs do not become zero.
- Additional direct cost is the original adopted total multiplied by the
  selected percentage. The existing 10-trillion-won ceiling applies to the
  resulting total; over-limit results fail without clipping or a fallback.
- Decimal arithmetic adds the overlay once, before indirect costs and
  contingency. The same project ledger then recomputes financing, fees,
  funding requirements, equity cash flows, profit, IRR and NPV.
- The original contingency is not consumed or netted against the increase.
  Contingency is recalculated on the increased direct/indirect cost base. This
  is a gross budget-increase scenario, not a claim for extra cash after using a
  contingency reserve.
- The existing construction disbursement profile applies across the whole
  construction period. Actual change-order timing, contractual escalation
  clauses, compensation, approval and tax recovery are not modeled.
- The result carries the source quote key, scenario/version, original amount,
  selected percentage, additional amount and hypothetical total. It is not a
  replacement `full-quote-cost-2026.1` adoption contract.

## User Flow

The business-feasibility stress panel shows a percentage input only when a full
quote is adopted. A run compares the original base with revenue decline,
explicit quote increase, interest increase, delay and a combined downside.
The combined case adds the same selected increase to revenue -5%, PF +1pp and
construction +3 months. Other single-variable cases keep the quote fixed.

Changing any scenario program, parcel, calculation assumption or selected
percentage invalidates the displayed stress result. The original quote,
additional direct-cost assumption and hypothetical total are shown separately.
There is no save/adopt action for the risk overlay and no expert-approval change.

The construction unit-rate limit, unit-rate low/high table and construction VE
remain unavailable for fixed quotes. They must not treat the overlay as a new
quote, a negotiated discount or an independently verified allowable budget.
This read-only panel does not yet add a risk contract to the saved report or
integrated approval packet; those continue to preserve and check the base.

## Verification Status

Focused finance tests cover zero-overlay identity, 5/12.5/100% cases, independent
amount construction and monthly-ledger replay, indirect/contingency/fee/interest
propagation, no input mutation, malformed percentages, missing/simultaneous
contracts, the existing amount ceiling and configurable combined-case replay.
The focused suite passed 42 tests. Full `pnpm verify` passed 3,377 tests with
two opt-in DB tests skipped, plus lint, TypeScript and the production build.
Both skipped definitions passed independently in initial/restart/restore phases
on real PostgreSQL, six executions total, with matching content/permissions and
complete owned-server/database cleanup (`full-quote-postgres-2026-11-11/attempt-6`).
Independent scoped code review found no actionable issues; its 31-test full
quote finance file also passed. This does not replace a professional QS review.

Actual frozen production builds passed the synthetic PC/mobile quote workflow:
import, adoption, save, configurable risk analysis, old-model blocking, sealing,
report, removal and logout race. Each viewport tested 0/10/12.5/100% against the
server calculation, and rejected blank/negative/over-100 inputs. Every risk run
left the workspace revision and full payload unchanged. Evidence is under
`artifacts/full-quote-risk-2026-11-11/attempt-1/` and
`artifacts/full-quote-risk-responsive-2026-11-11/attempt-1/`.

Visual review additionally found narrow-panel clipping and a wrapped status
label not detected by the document-level overflow check. These were corrected
with responsive columns, a stacked threshold row and a nonshrinking label.
A 320px follow-up exposed the parent grid's intrinsic minimum width. The final
layout-only correction uses a zero-minimum track; its build is
`ggaZePnZJnNEIhdMWxJ03`. Its scoped actual DB/browser run tests import/adoption/save,
all risk inputs and both text-to-panel and panel-to-viewport bounds at
320/390/768/1024/1440px. Screenshots were inspected, with no remaining observed
clipping in this panel. Evidence:
`artifacts/full-quote-risk-layout-final-2026-11-11/attempt-1/`.
All source/build/runtime hashes and owned-process cleanup checks passed. The
last run intentionally does not repeat report/sealing/PDF tests after the
layout-only change; the preceding full-flow evidence remains distinct. No
external requests, actual contractor changes, approvals or customer data were
used. Physical devices, final design acceptance and production operations are
not certified by this synthetic verification.

Official boundaries, permits, source-document authenticity, real contractor
change orders and professional approvals remain unconfirmed.

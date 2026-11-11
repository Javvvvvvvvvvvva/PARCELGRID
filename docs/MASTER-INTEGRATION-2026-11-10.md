# Master Integration, 2026-11-10

## Scope

- Integrate remote `master` at `9ca74d4` into verified Final Goal work at `49ae4a1`.
- Preserve organization/session isolation, server revisions, audit records, calculation gates, full parcel topology, and preliminary/official approval separation.
- Integrate map/address selection, registry evidence, concept interior editing and exports, preliminary shadows, facade quantities and per-face costs, overview and executive brief.
- Facade branch tip `bf141d9` has the same tree as remote `master`; its rendering fix is already included. Squashed U2/U3 commits are not a second implementation to replay.
- Next 16 and Three/Fiber major updates remain separate migrations. Keep verified Next 15.5.28.

## Resolution Decisions

- Keep the organization project home, session boundary, and server Workspace synchronization. The older global IndexedDB persistence provider and list are not mounted. Their source is retained for historical recovery, not as a second authoritative store.
- Site intake uses session-scoped drafts. Explicitly unpriced site-only records can be saved to the organization Workspace without inventing financial candidates; reopening retains the price gate.
- Changed intake recomputes explicitly, retains authored plans and the original server revision for conflict detection, and invalidates the previous representative and financial drafts. Earlier server revisions retain the old evidence.
- Keep the current pretax/after-tax model. Registry zero rows do not prove physical vacancy or a verified land-only tax base.
- Keep provider deadlines, bounded bodies, concurrency controls, authorization, and multipart/hole boundaries. Protect the new selection-context endpoint with the same authorization.
- Bind concept interiors to geometry identities. Keep the existing detailed room/egress model separate; concept layouts are not statutory egress approval.
- Preserve raw facade cost precision through Stage 2/3, validate row arithmetic and cost identity, and retain full boundary/sunlight inputs. Quote comparisons require current geometry for geometry-derived facade costs.
- Calculation version: `v228`. Integrated verification: `integrated-verification-2026.17`. Earlier results require recalculation/review.

## Acceptance

- Final post-resolution `pnpm verify`: 3,224 tests passed, one opt-in PostgreSQL test skipped. Lint, TypeScript and production build passed.
- Actual Next development UI: six quote-comparison cases (1440/390 pixels, ready/unallocated/unpriced) and two unpriced-intake reopen/price-gate cases passed. No real writes, financial mutation, horizontal overflow or browser errors. Synthetic in-memory Workspace records were used; external providers were blocked.
- Local browser evidence: `artifacts/master-integration-2026-11-10/browser.json` and `intake-browser.json`. These ignored artifacts are not uploaded.
- Publication preflight: no unresolved Git conflicts; `git diff --check` passed; focused credential-pattern scan of 161 changed files found no matches. This is not comprehensive security acceptance.

Official boundaries, permits, professional approval, external-provider availability and production PostgreSQL acceptance remain unconfirmed.

## Next Work

Explicit full-quote hard-cost adoption: current source binding, reconciled scope, VAT/scope confirmation, preview/confirm/remove, one authoritative hard-cost source, stale-input rejection, and fixed-quote sensitivity behavior. Saving evidence alone remains financially inert.

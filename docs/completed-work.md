# Completed Work Log

Status: Historical (append-only ledger)
Last verified: 2026-07-14
Owner: Project documentation
Canonical for: append-only record of shipped phases/milestones (outcomes) — historical, not current implementation authority
Supersedes: (none)

## Purpose / How to use this document

- This file is an **append-only log** of completed phases and major milestones.
- Record **what was built and why it mattered** (outcomes), not a commit-by-commit changelog.
- This is **not** an active task list.
- Add future completed phases/milestones here instead of mixing history into `docs/next-tasks.md`.

## Completed phases / milestones

### PLATFORM-086H3 — Atomic Game-Stats Contract Activation + Recovery Integration — Implemented (review pending, not merged)

**Status:** Implemented — review pending — **not merged**. Branch `platform/086h3-atomic-game-stats-contract-activation` (from `main` @ `c8ebed4`), pushed with `preview` updated; no PR opened. Awaiting Codex re-review; this entry records the implementation milestone only and makes no completion claim.

**PROMPT_ID(s):** PLATFORM-086H3-ATOMIC-CONTRACT-ACTIVATION-RECOVERY-INTEGRATION-v1 (+ folded PLATFORM-086H3-CANONICAL-COVERAGE-RECOVERY-REMEDIATION-v1, PLATFORM-086H3-IDENTITY-RECOVERY-CLAIM-PUBLIC-CONTRACT-REMEDIATION-v1, and PLATFORM-086H3-STATUS-RECOVERY-PUBLIC-CLOSURE-REMEDIATION-v1).

**Goals implemented:** Third staged PR of the 086H decomposition — the atomic production activation of the 086H1 contract and 086H2 durable merge authority as ONE game-stats lifecycle: canonical schedule with CANONICAL PARTICIPANTS (`ingestion.ts`: slate expectations retain both participants' `teamIdentity.ts` resolution and FBS/FCS classification; a provider game id alone never authorizes persistence — participants must resolve and agree with the schedule orientation, with a documented identity-preserving neutral-site reversal exception; FCS-vs-FCS games are excluded even when scheduled; numeric postseason placeholders defer until participants resolve; mismatch/unresolved/excluded/unscheduled attachment states are typed and never collapsed) → durable merge authority (both writers route through it; the blind `setCachedGameStats` partition overwrite is deleted) → COMMITTED-state coverage (`partitionCoverage.ts`, the one typed model — per-game satisfied/recoverable/manual-only/blocked/absent, top-level complete/partial/blocked/manual-only/absent/not-applicable with blocked never reported as recoverable absence — consumed by cron, manual refresh, ordinary reads, recovery, diagnostics, and the cache-state probe) → one post-merge finalize path (`refreshPublication.ts`: COMMIT → durable reread → committed-row classification → coverage → publication; partial committed coverage records PARTIAL success; `unchanged`/`stale` resolve by coverage with insufficient states as failures that clear nothing; contextually unexpected empty is a stable `game-stats-empty-unexpected` failure; `indeterminate` publishes no success and no post-write coverage; a post-commit reread failure is reported as committed-but-unverifiable) → PERSISTED bounded recovery (`recoveryDisposition.ts`: deterministic backoff tiers with progress reset, terminal manual-action state, newest-ELIGIBLE candidate selection so backed-off partitions rotate to older eligible ones — one slate provider request per weekly cron run) → analytics projection (`ownerStats.ts` on `selectAnalyticsRows` exclusively; archive-integrity score comparison through the projection so `pointsProvided: false`/compatibility-defaulted points are never real scores) → truthful availability (strict `seasonType` validation; pre-fetch canonical-target validation failing before any provider access; ordinary reads cache-only with a coverage-derived `meta.availability` summary; typed corrupt/malformed/read-failure outcomes distinct from absence; v2 persistence metadata stripped with legacy rows byte-equivalent by reference).

**Key outcomes:** Durable COMMIT and the committed-state reread strictly precede any publication; empty/invalid/mismatched/uncertain provider responses can never destructively clear prior durable evidence or a meaningful failure state; provider quota stays bounded within AND across runs (fenced claims + backoff + rotation, zero provider calls from ordinary reads, invalid targets fail pre-fetch). Second remediation round (identity/recovery-claim/public-contract) folded in: identity is AUTHORITATIVE-only (the normalized-text fallback is deleted — registry-unknown participants defer with typed states, normalization collisions can never merge, and classification uses an explicit FBS/FCS allowlist where UNKNOWN never persists); recovery claims are atomic and FENCED (per-key transaction on the recovery-metadata key, never held across provider access; unique attempt tokens with lease expiry; token-conditional finalization so stale completions can never overwrite newer outcomes; overlapping cron executions provably cannot double-fetch one partition; manual refreshes participate with documented override semantics); recovery progress derives ONLY from committed-coverage/schedule fingerprints (fence-only refreshes escalate backoff); commit stamps are captured in the merge authority immediately after COMMIT and propagate through publication (a stalled finalizer cannot let an older commit overwrite newer last-success metadata); the public boundary validates the complete weekly envelope and publishes only H1-approved rows (unsupported `schemaVersion: 3` rows are WITHHELD with typed counts — never laundered into legacy-looking data); provider cache-state uses the same schedule-relative coverage as reads and diagnostics; mixed-payload parse/attachment degradation stays observable through successful commits (recorded PARTIAL); archive-integrity consumes H1-approved score evidence with route-level regressions. The activation guard now leads with module-OWNERSHIP boundaries over resolved imports (evidence mutation, recovery mutation, status publication, coverage evaluation, raw durable rows, and orchestration entries each importable only by their owners — writer routes are thin shells over one `refreshOrchestration` entry point), plus a corrected AST pass (aliased/namespace lock calls, chained scope constants, wrapper scope arguments at any position) with fixture self-tests and an explicit statement of what scanning does NOT prove (cross-file laundering/reachability — prevented by the import boundaries instead). Third remediation round (status/recovery/public closure): refresh-status success ordering is DURABLY atomic — the merge authority allocates a monotonic partition `commitRevision` inside its evidence transaction and the status ledger compares-and-writes inside one per-scope durable transaction (older revisions can never overwrite newer metadata across instances or restarts; equal revisions are idempotent; malformed legacy status yields); recovery claims are revalidated against AUTHORITATIVE rereads after acquisition (the stale-plan race is closed: a partition another writer satisfied is released token-conditionally with zero provider calls and selection rotates within the one-fetch bound); the public wire uses a strict H1 allowlist with deterministic duplicate withholding, strict calendar-valid envelope timestamps, and partition-identity checks (defective/conflicting/mismatched rows withheld with typed counts, no projection exceptions); degradation counts cover every provider-boundary bucket and ride every response surface without downgrading committed availability; guarded capabilities cannot be re-exported even by owner modules; and recovery-metadata persistence failures are surfaced on route results with a stable code while preserving the primary provider error. Full suite 1931/1931; `tsc` and `lint:all` clean.

**Deliberately out of scope:** PLATFORM-086H4 diagnostics/panel presentation redesign (queued) and the legacy-row migration (queued) — existing legacy durable rows continue to serve through compatibility reads with no migration required.

### PLATFORM-086H2 — Durable Game-Stats Merge Service (Dormant) — Complete

**Status:** Complete. Merged to `main` via PR #397 (`platform/086h2-durable-game-stats-merge-service`, merge commit `c48e1ca`, 2026-07-18). Four implementation commits plus a docs closeout; three folded Codex review-remediation rounds, each re-reviewed to a clean closure verdict; Claude `/verify` passed with byte-identical branch-vs-`main` HTTP behavior and no dormant metadata leakage; full suite 1758/1758 before closeout.
**PROMPT_ID(s):** PLATFORM-086H2-DURABLE-GAME-STATS-MERGE-SERVICE-v1 (+ folded PLATFORM-086H2-DURABLE-MERGE-REMEDIATION-v1, PLATFORM-086H2-TRANSACTION-CONTAINMENT-CONCURRENCY-REMEDIATION-v1, PLATFORM-086H2-WRITE-ATTEMPT-CLIENT-DISPOSAL-REMEDIATION-v1; conformance/closure reviews per `docs/prompt-registry.md`).

**Goals completed:** The dormant durable merge authority for the staged 086H rebuild (PR 2 of 4). `src/lib/gameStats/durableMerge.ts` merges validated v2 observation batches into weekly partitions: stable identity through `providerGameId` only; conservative category-level merge that preserves absent games, omitted categories, and prior valid evidence (replacement requires strictly parse-valid newer values; legacy normalized values that merged raw evidence cannot reconstruct are preserved as compatibility only, never as strict eligibility); points move only on explicit `pointsProvided` evidence; strict RFC 3339 per-game observation fencing canonicalized to UTC, with fence-only `refreshed` writes for newer identical observations (freshness is durable evidence — a reordered older observation can never roll state backward) and wholesale rejection of stale batches; deterministic incoming AND durable duplicate handling; exact schema-version authority (unsupported/malformed versions preserved bit-for-bit as typed conflicts). `withAppStateKeyTransaction` in `appStateStore.ts` runs lock, read, write, and commit on ONE dedicated PostgreSQL client under `pg_advisory_xact_lock` — the owner never needs a second connection, eliminating pool-starvation deadlock.

**Key outcomes:** Truthful persistence semantics end to end — typed `written`/`partially-merged`/`unchanged`/`stale`/`conflict` vs `unavailable` (typed reasons, rollback confirmed) vs `indeterminate` (commit or cleanup failure after mutation SQL was SUBMITTED; `writeAttempted`, not acknowledgement, governs uncertainty; partition identity included). Uncertain clients are destroyed and never returned to the pool as healthy; healthy disposal is recorded only after `release()` completes; confirmed results survive release failure; initiating, cleanup, and acquisition causes are all retained on typed errors. Verification includes a stateful fake-pg harness (advisory-lock ownership, staged-write commit visibility, capacity, idle-pool reuse/destroy) proving real same-key overlap with committed-state reread, capacity-3 starvation prevention, stale-writer rejection after commit, healthy-client reuse, destroyed-client non-reuse, and deterministic failure cleanup — no sleeps. **Nothing is activated**: cron/manual writers remain legacy-only, production lifecycle files are byte-identical to `main`, and the recursive dormant-boundary guard rejects every import form of the merge module. PLATFORM-086H3 activates ingestion → durable merge → coverage → recovery → analytics projection → truthful availability atomically, with the documented invariant that every game-stats writer must route through this authority (or the same transaction-scoped lock) first.

**Optional follow-up debt (non-blocking):** the service is deliberately inert until 086H3; 086H4 (diagnostics + panel wording) and the legacy-row migration remain queued.

### PLATFORM-086H1 — Game-Stats Data Contract (Dormant Foundation) — Complete

**Status:** Complete. Merged to `main` via PR #396 (`platform/086h1-game-stats-data-contract`, merge commit `0f8b562`, 2026-07-17). Four commits: the foundation plus three folded review remediations; final closure review clean; runtime A/B verification showed byte-identical production responses vs `main`.
**PROMPT_ID(s):** PLATFORM-086H1-GAME-STATS-DATA-CONTRACT-IMPLEMENTATION-v1 (+ folded PLATFORM-086H1-PROTOTYPE-SAFE-CATEGORY-LOOKUP-REMEDIATION-v1, PLATFORM-086H1-DORMANT-CONTRACT-BOUNDARY-REMEDIATION-v1, PLATFORM-086H1-COMPLETE-DORMANT-BOUNDARY-GUARD-REMEDIATION-v1; scoped by the read-only PLATFORM-086H1-LEGACY-DURABLE-DATA-INVENTORY-AUDIT-v1 production inventory and PLATFORM-086H1-DORMANT-BOUNDARY-CLOSURE-REVIEW-v1).

**Goals completed:** First staged PR of the 086H decomposition (the original single-PR recovery implementation is frozen at `platform/086h-game-stats-recovery` @ `13db9ce` as a read-only salvage reference). Shipped `src/lib/gameStats/contract.ts` as a fully tested, production-disconnected library: one authoritative category specification (26 recognized categories, six analytics-required), strict full-string parsers from untrusted values with prototype-safe category lookup (signed-yardage whitelist, `made <= attempted` efficiency fractions, trim-then-strict possession clock ≤ 90 minutes), structural points evidence, per-game-row `schemaVersion: 2` interpretation, a 14-state typed row classifier with derived predicates, pure season-aware recovery policy, typed v2 wire parsing + pure row construction, canonical analytics projection, and deterministic duplicate selection. Bounded legacy compatibility was proven against the complete 2021–2025 production durable inventory (95 partitions, 7,335 rows) for **exact** owner-analytics parity — including the four observed leading-space possession clocks that motivated the possession-trim rule.

**Key outcomes:** Nothing activates yet: adversarial review confirmed activating analytics alone would let unchanged ingestion cache rows the strict contract silently drops, so production owner aggregation, Insights, career loading, ingestion, coverage, recovery, and diagnostics remain byte-identical to `main`, and no writer stamps v2 metadata. A recursive dormant-boundary test scans every production source file for the twelve dormant symbols and every import form resolving to the contract module (with scanner self-tests and real-writer/cache-boundary parity assertions), so any future piecemeal activation fails immediately — activation happens atomically in the staged activation PR. Validation: full suite 1706/1706, `tsc`/`lint:all` clean, seeded runtime A/B against `main` byte-identical, no provider or database contact during implementation.

**Optional follow-up debt (non-blocking):** the contract is deliberately inert until the staged activation PR; `completionAttempts` (CFBD's real completions/attempts wire pair) is documented observed-but-unmodeled as a candidate future recognized category. Next in the 086H sequence: PR 2 (durable merge service) → PR 3 (atomic contract activation + recovery integration) → PR 4 (diagnostics + panel wording) → legacy-row migration.

### PLATFORM-086G2 — Odds Boundary & Usage Truthfulness — Complete

**Status:** Complete. Merged to `main` via PR #395 (`platform/086g2-odds-boundary-usage-truthfulness`, merge commit `0ee58b4`, 2026-07-16). Eight commits; eight Codex review rounds remediated pre-merge (two consolidated fixes scoped by read-only audit prompts); final Codex review clean.
**PROMPT_ID(s):** PLATFORM-086G2-ODDS-BOUNDARY-USAGE-TRUTHFULNESS-v1 (plus seven folded remediation prompts and two read-only audit prompts — see the PLATFORM-086G2 entry in `docs/prompt-registry.md` for the full list).

**Goals completed:** Closed deferred PLATFORM-086A findings #4 and #3 at the Odds boundary. A 200 provider response is validated before any durable commit: non-array payloads, structurally malformed rows (including nested bookmaker/market/outcome scalars), and invalid/truncated/empty JSON bodies fail with stable codes (`odds-invalid-payload`, `odds-schema-drift`), while quota headers persist regardless of body validity. Genuine empty payloads are classified contextually by a pure classifier with a typed per-row identity-certainty state model: prior cached events are reconciled against the current canonical slate via the existing identity/attachment matcher, positive near-horizon expectation (canonical target only, 7-day horizon) requires two canonically resolved participants, unexpected empties are truthful `odds-empty-unexpected` failures that retain prior-good data, and a valid-absence no-op replaces retained rows only when every row is provably obsolete — ambiguous or unavailable identity evidence authorizes neither failure nor destructive clearing. Per-target commit serialization prevents an in-flight empty refresh from clobbering a concurrent populated commit. The odds-usage durable read carries a distinct `available | absent | unavailable` state end to end, and file-fallback app-state reads treat only a genuinely missing file as absence (corrupt/unreadable stores propagate).

**Key outcomes:** An Odds provider regression can no longer be committed as a successful empty refresh or silently replace prior-good lines; false-failure alarms from placeholders, reschedules, and unknown provider spellings are excluded by construction; operators can distinguish "no usage snapshot yet" from "the store is unreachable". New `src/lib/odds/emptyOddsClassifier.ts`; `withOddsTargetLock` + structural row validation in `routeInternals.ts`; `readLatestKnownOddsUsageState`; ENOENT-only file-store tolerance. Validation: final combined suites green (payload-boundary 44, classifier 31, attachment/identity/usage/provider-status), `tsc`/`lint:all` clean, no provider quota spent.

**Optional follow-up debt (non-blocking):** clearing of provably obsolete rows is deliberately rare during postseason windows (placeholder slots suppress confident absence), so retained entries persist until a nonempty refresh — acceptable by design. Next in campaign order: PLATFORM-086H (game-stats recovery).

### PLATFORM-086G1 — CFBD Score & Quota Truthfulness — Complete

**Status:** Complete. Merged to `main` via PR #394 (`platform/086g1-cfbd-score-quota-truthfulness`, merge commit `987dd04`, 2026-07-14). Two commits; one Codex review round (2 P2 evidence-read findings) remediated pre-merge; final Codex review clean.
**PROMPT_ID(s):** PLATFORM-086G1-CFBD-SCORE-QUOTA-TRUTHFULNESS-v1 (+ folded PLATFORM-086G1-CODEX-P2-EVIDENCE-READ-REMEDIATION-v1).

**Goals completed:** Closed deferred PLATFORM-086A findings #6 and #7 at the CFBD boundary. Empty CFBD Scores responses are classified contextually against target-scoped, cache-only evidence — populated prior-good durable rows for the exact refresh target, or started non-disrupted canonical-schedule games (read through the canonical schedule fallback so partition-only cache layouts count, with the two evidence sources resolving independently): an unexpected empty is a truthful `cfbd-empty-unexpected` refresh failure (502) that retains prior-good data, publishes nothing, and records against the exact partition scope, while legitimate empties (future targets, no expected games, canceled/postponed-only) remain recorded no-ops. CFBD quota parsing is honest: missing/malformed `remainingCalls`/`patronLevel` resolve to unavailable (never 0-remaining false exhaustion or a guessed tier limit), trustworthy zero remaining still reports genuine exhaustion, and reconciliation authority stays in the canonical `normalizeProviderQuota` path.

**Key outcomes:** A CFBD regression that returns `[]` can no longer silently freeze scores as a "successful" no-op, and a missing provider quota field can no longer render false exhaustion on admin surfaces. New pure classifier `src/lib/scores/emptyScoresClassifier.ts`; `CfbdUsage` fields nullable end-to-end. Validation: focused suites green (scores route 39, classifier 11, quota suites), `tsc`/`lint:all` clean, no provider quota spent during verification.

**Optional follow-up debt (non-blocking):** none. Next in campaign order: PLATFORM-086G2 (Odds boundary & usage truthfulness).

### PLATFORM-086A — Provider-Refresh Observability Foundation — Complete

**Status:** Complete. Merged to `main` via PR #391 (`platform/086a-refresh-observability`, merge commit `9da8857`, 2026-07-14). 17 commits with ~10 Codex review/remediation rounds folded in pre-merge.
**PROMPT_ID(s):** PLATFORM-086A-REFRESH-OBSERVABILITY-v1 (plus the folded remediation prompts — see the PLATFORM-086A entry in `docs/prompt-registry.md` for the full sub-prompt list).

**Goals completed:** The operational foundation for PLATFORM-086 provider automation: durable per-dataset provider-refresh status (scores, schedule, odds, rankings, conferences, game stats) keyed by typed canonical target scopes with per-scope attempt ordering and cross-scope completion-token rejection; durable operator settings (global noncritical provider pause + per-dataset enable/disable); the `/admin/diagnostics` Provider Data Status panel with manual refresh for all six datasets; cache-aware missing-data diagnostics; CFBD quota normalization around the Tier 1 limit (5,000 calls/month); a reusable user-facing freshness label; durable-first provider commits; extensive empty-response/schema-drift classification; and schedule `week + all` read-time cache composition.

**Key outcomes:** CFBD became the sole normal production score provider (automatic ESPN score fallback removed); a failed refresh can never advance last-success or masquerade as another target's status; operators see truthful per-dataset operational state for the selected year. No new cron cadence shipped — automation follows in the revised PLATFORM-086B–I plan (`docs/next-tasks.md`).

**Optional follow-up debt (non-blocking):** seven review findings deliberately deferred at merge, scheduled as PLATFORM-086G1 (CFBD score & quota truthfulness), PLATFORM-086G2 (Odds boundary & usage truthfulness), PLATFORM-086H (game-stats recovery), and PLATFORM-086I (settings feedback); PLATFORM-086F diagnostics IA redesign deferred until real automation jobs exist. Scope lesson recorded in `docs/next-tasks.md`: the 77-file / ~11.9k-insertion diff is the named failure case for the campaign's PR-sizing rule.

### Markdownlint Documentation Tooling — Complete

**Status:** Complete. Merged to `main` via PR #392 (`chore/add-markdownlint`, merge commit `c8b8d12`, 2026-07-14).
**PROMPT_ID(s):** (operator-driven tooling change; no formal PROMPT_ID)

**Goals completed:** Added `markdownlint-cli2` with a repo config (`.markdownlint-cli2.jsonc`: defaults on; MD013 long lines, MD041 first-line-heading, MD060 table formatting, and MD036 bold-label headings disabled; MD024 duplicate headings allowed under different parent sections), `lint:markdown` / `lint:markdown:fix` scripts, and markdown linting appended to the `lint` and `lint:all` chains. Brought the living Markdown docs to a clean baseline (archives excluded via `#docs/archive/**`).

**Key outcomes:** `npm run lint:markdown` passes repo-wide (0 errors) and now guards documentation changes. One review remediation fixed an autofix-introduced ordered-list numbering regression in `docs/deployment-runbook.md`.

**Optional follow-up debt (non-blocking):** none.

### Draft Timer Integrity + Server-Authoritative Round Boundaries — Complete

**Status:** Complete. Three stacked PRs merged to `main`: #319 (`draft/001-timer-route-tests`), #320 (`draft/002-server-round-boundary`), #321 (`draft/003-optimistic-countdown`).
**PROMPT_IDs:** DRAFT-001-TIMER-PERSIST-INTEGRITY-v1, DRAFT-002-SERVER-ROUND-BOUNDARY-PAUSE-v1, DRAFT-003-OPTIMISTIC-COUNTDOWN-DISPLAY-ONLY-v1

**Inciting issue:** An audit of the stale `claude/audit-season-transition-pwKfH` branch (draft "pick timer precision" work, ~232 commits / 2 months behind `main`, 3-way merge conflicts). The branch's headline change stamped `timerExpiresAt` *after* the `setAppState` write and returned it unpersisted — leaving stored state with `timerState:'running'` but `timerExpiresAt:null`, which blanked the live countdown for every poller/refresher within ~1s of each pick. The audit recommended abandoning the branch and re-deriving the two salvageable ideas against current `main`. Key correction surfaced during the audit: **`main` never had the persist/response divergence** — it was a stale-branch-only regression — so the "integrity fix" collapsed to regression coverage.

**Phases shipped:**

- **DRAFT-001 — timer persistence regression suite (tests only).** Established the first draft-route test harness (the routes had zero coverage). Locks in the invariant that the pick and PUT routes persist exactly the timer state they return (`persisted timerExpiresAt == response timerExpiresAt`). Covers normal pick reset, GET/response equality (no drift), round-boundary, final-pick completion, and PUT `timerAction:'start'`. No production code change — `main` was already correct.
- **DRAFT-002 — server-authoritative round-boundary pause.** Moved round-boundary auto-pause out of the client (`maybeAutoPauseForRound` second round-trip + `autoPauseRef`, both deleted from `DraftBoardClient`) and into the pick route: when an advanced index lands on a round boundary it returns `phase:'paused'`, `timerState:'paused'`, null expiry, so the commissioner must explicitly start the next round. The PUT auto-pick path now honors the same boundary rule, fixing a pre-existing inconsistency where auto-picks did not pause but manual picks did.
- **DRAFT-003 — optimistic display-only countdown.** The pick clock now counts down the instant a team is clicked instead of stalling for the server round-trip. `DraftBoardClient` records a `localTimerStartRef` timestamp before the pick POST (only for mid-round picks that arm a fresh timer; boundary/final picks are skipped), cleared on response/error. `DraftHeaderArea` treats the optimistic window as a running clock. Countdown math extracted to a pure `computeTimerSecondsLeft` helper (`src/components/draft/draftTimer.ts`) that clamps to `pickTimerSeconds` (clock-skew guard) and floors at 0.

**Architectural notes:**

- Server remains the sole authority for draft phase, pick validity, completion, and timer expiry. The optimistic countdown is strictly display-only — it never enters the POST body or governs expiration (the server `timerExpiresAt` + expire-dispatcher are untouched).
- Round-boundary authority unified in the API layer; no duplicate client/server pause logic remains.
- Timer values are still computed *before* the store write in both routes, preserving the persisted==response invariant guarded by DRAFT-001.

**Tests:** `src/app/api/draft/[slug]/[year]/__tests__/route-timer.test.ts` (7 cases) and `src/components/draft/__tests__/draftTimer.test.ts` (11 cases). Run draft route tests via the wildcard glob `'src/app/api/draft/*/*/__tests__/*.test.ts'` (node's runner treats the `[slug]`/`[year]` dirs as glob char-classes).

**Optional follow-up debt (non-blocking):** None. The stale `claude/audit-season-transition-pwKfH` branch was deleted from the remote. The 4 pre-existing `inferredSeasonStart` tsc errors in standings test fixtures remain (tracked under `TEST-SUITE-BASELINE-CLEANUP`, unrelated to this work).

---

### HISTORY-RECORDS Phase 2 — Complete

**Status:** Complete. Multiple iteration cycles across PR #313 (`claude/history-records-phase-2`). See `docs/campaigns/history-records-phase-2.md` for the full retrospective.
**PROMPT_IDs:** P7-HISTORY-RECORDS-PHASE-2-OVERVIEW-REVISION-v1, P7-HISTORY-RECORDS-PHASE-2-OVERVIEW-REVISION-FOLLOWUP-v1, DESIGN-MD-MULTILINE-AND-DEGRADATION-v1, P7-HISTORY-RECORDS-PHASE-2-PATH-B-AND-RESPONSIVE-v1, P7-HISTORY-RECORDS-PHASE-2-VISUAL-REMEDIATION-AND-CLOSEOUT-v1, P7-HISTORY-RECORDS-PHASE-2-CLEANUP-NITS-v1, P7-HISTORY-RECORDS-PHASE-2-VISUAL-REFINEMENT-v1, P7-HISTORY-RECORDS-PHASE-2-LAYOUT-DIAGNOSTIC-v1, P7-HISTORY-RECORDS-PHASE-2-LAYOUT-REMEDIATION-v1, P7-HISTORY-RECORDS-PHASE-2-STANDINGS-TREND-COLUMN-v1, HISTORY-RECORDS-PHASE-2-CAMPAIGN-CLOSEOUT

**Inciting issue:** Phase 1 (PR #312) shipped `selectAllRecords` as the records-data backbone but did not surface it in the History UI. The pre-Phase-2 Overview rendered as a single-stat hero with no drill-down structure or sense of league history beyond "current season's champion." Phase 2 took on the full Overview redesign, the records column wiring, the subtab routing scaffold, and the design-system documentation that the new layout primitives required.

**Phases shipped:**

- **Subtab routing infrastructure** — `HistorySubNav` + `RecordBadge` components; `resolveHistoryHref` deep-link router for insights with History routing targets; Stats / Rivalries / Archive subtabs scaffolded as Phase 3 placeholder routes.
- **Overview redesign** — Five-section composition: Championships (with editorial tags "all-time wins leader" / "league's first champion" / "REIGNING" marker), 2-row dashboard (All-time standings + Recent podiums on row 2; Top rivalries + Title droughts/streaks + Records on row 3), Season-over-season movement (climbs + drops with "won title" annotations on championship destinations), Season archive. Multi-line block treatment applied across rivalry, drought, and mover rows.
- **All-time standings extension** — Grew from 5 to 9 columns (Pts, Diff, Seasons, Avg added on top of Rank/Owner/Record/Win%/Titles) plus a "Recent Finish" trend chip column showing the last 5 seasons of finishes with gold/silver/bronze podium-tier outlines and default/bottom tiers for mid/back finishes. Table is `table-auto` with content-driven cell widths; container queries drop oldest-year trend cells first as the @container narrows.
- **DESIGN.md additions** — `## Multi-line row pattern`, `## List row width discipline`, `## Responsive column degradation` sections; reconciled section-divider rule and dense-table column-header rule.
- **AGENTS.md addition** — `## Verification and reference conventions` documenting (a) scoped-suite test verification while `TEST-SUITE-BASELINE-CLEANUP` is open (full `npm test` reliably hangs) and (b) the requirement that visual-reference files (mockups, design specs) exist at the paths a prompt references before dispatch.
- **Layout iterations** — Multiple visual-review cycles resolved page-width and within-row spacing imbalances. Final state: page wraps in `mx-auto max-w-7xl` (1280px cap, restored after a brief uncapped exploration); row 2 grid is `1fr / 280px` (flex Standings + fixed Podiums); row 3 grid is `1fr / 1fr / 280px` (Rivalries + Droughts flex; Records fixed); standings table uses `table-auto` with `pl-5` numeric padding so columns read distinct.

**Selector layer:**

- New helpers in `src/lib/selectors/historyOverview.ts`: `selectChampionshipsWithContext`, `selectDroughtsWithContext`, `selectMoversWithContext`, `selectStreaksOrDroughts`, `selectStandingsWithRecentFinishes`, `selectMarqueeRecords`, `selectTitleStreaks`, `selectTitleDroughts`, `selectRecentPodiums`, `selectSeasonArchiveStrip`, `groupChampionsByOwner`, `computeChampionshipSummary`.
- `selectAllTimeHeadToHead` extended with `latestMeeting: { year, winner } | null`; flows through `selectTopRivalries` to power the "last met YEAR (winner)" line-2 annotation.
- `archiveChampion` filters NoClaim before deriving the champion — same architectural pattern as Phase 1's `5fdcd59` rank-derivation fix; without this, a NoClaim row at index 0 would shift the championship credit and break Season archive rendering.
- `AllTimeStandingRow` gained `totalPoints` (with selector accumulation) on top of the existing `totalPointDifferential`. `StandingsRow` gained `pointsFor` (propagated through `selectFinalStandings`) so the live-standings branch of `selectAllTimeStandings` can accumulate it.

**User-visible improvements:**

- History Overview tells the whole-league arc — every multi-line row pulls a second line of context (career win%, last meeting, top-3 count + best finish, span + ranks + championship annotation) so rows read as paragraphs rather than drifting names.
- Records column displays 4 marquee records (down from 5) with category eyebrow inlined into the title — 2-line block treatment matching peer columns; row 3 column heights now read as peers.
- Season archive renders champion names correctly across all archived seasons (NoClaim-at-index-0 bug fixed).
- Insight deep-links from drought / dynasty / rivalry insights land on rendered Overview anchors (`#dynasty-drought`, `#championships`, `#rivalries`) rather than Phase 3 placeholder subtabs.
- `activeOwners` falls back to archive union when the current-season CSV is empty (pre-upload, post-reset, storage-miss states); sections gating on roster don't render empty against a populated archive.

**Architectural improvements:**

- Multi-line row pattern codified in DESIGN.md as a reusable layout primitive (line 1: primary identifier + right-anchored value, body size + weight 500; line 2: secondary metadata, 12px / weight 400 / dim color; 2px inter-line margin; no internal borders or padding).
- Container queries (Tailwind v4 `@container` + `@max-[Xpx]:hidden`) used for column degradation in dense tables — pattern available for future tables under sidebar-narrow allocations.
- Visual-reference convention now codified in AGENTS.md: mockups belong in `mockups/`, design specs in `docs/`, and reference files must exist at the path a prompt names before dispatch. Reference mockups committed at `mockups/history-redesign-pathC.html` and `mockups/standings-trend.html`.

**Phase 3 follow-ups filed in `docs/next-tasks.md`:** `RECORDS-SCORING-v1` (auto-scored marquee selection), `SPARSE-DATA-LAYOUT-v1` (responsive treatment for under-populated sections), `HISTORY-DYNAMIC-TILING-v1` (alternative tiling-vs-stacked layout exploration), `INSIGHT-ROUTING-PHASE-3-RETARGET-v1` (re-point insight deep-links to the subtabs once Phase 3 ships their content).

**Test count:** 87 → 128 (cumulative growth across the campaign; reflects new selector tests, routing tests, and the `selectTitleDroughts` archive-fallback regression guard added during the Codex-review remediation).

---

### Season Launch Hardening — Complete

**Status:** Complete. Three implementation phases + three Codex remediations across PRs #302–#304. See `docs/campaigns/season-launch-hardening.md` for the full retrospective.
**PROMPT_IDs:** SEASON-LAUNCH-HARDENING-DISCOVERY, SEASON-LAUNCH-HARDENING-PHASE-1-DRAFT-AUTH-AND-POLLING, SEASON-LAUNCH-HARDENING-PHASE-1-CODEX-REMEDIATION, SEASON-LAUNCH-HARDENING-PHASE-2-STANDINGS-PRESEASON-STATE, SEASON-LAUNCH-HARDENING-PHASE-2-CODEX-REMEDIATION, SEASON-LAUNCH-HARDENING-PHASE-3-INSIGHTS-LIFECYCLE-AWARENESS, SEASON-LAUNCH-HARDENING-PHASE-3-CODEX-REMEDIATION, SEASON-LAUNCH-HARDENING-CAMPAIGN-CLOSEOUT

**Inciting issue:** Pre-launch discovery audit identified four interlinked blockers: (1) draft board RSC serialized full admin state into server HTML before client redirect — auth leakage; (2) draft polling hardcoded at 1.5s regardless of phase, generating ~690 MB/day unnecessary Neon egress; (3) standings page silently blank during preseason cold-cache because the selector had no "waiting for kickoff" code path; (4) insight generators producing nonsensical output (e.g. "Toilet bowl leader in 0 games") because they were unaware of the archived-roster context.

**Phases shipped:**

- **Phase 1 — Draft Auth + Polling** (`5968604`, `d24a2f3`): Added `canAccessDraftBoard(slug)` server-side helper; gated `/league/[slug]/draft` and `/draft/setup` RSCs; removed three inline `clerkRole === 'platform_admin'` checks from `DraftBoardClient`, `DraftSetupShell`, `DraftSummaryClient`; passed `isAdmin` as server-derived prop (satisfies Auth Invariant #6). Phase-aware polling: 1.5s (live+running), 5s (default), 30s (complete). Codex remediations: spectator `/draft/summary` access preserved; complete-phase slow-polls at 30s rather than stopping to handle re-open events.
- **Phase 2 — Standings Preseason State** (`88af434`, `43516b0`): Extended `CanonicalStandingsSource` with `preseason-awaiting-kickoff`; added `inferredSeasonStart: string | null` to `CanonicalStandings`. `resolveSeason` and `resolvePreseason` empty paths call `getScheduleProbeState(year)` — no `Date.now()` inside `unstable_cache`-wrapped selector. `StandingsPanel` renders three distinct empty states. `CFBScheduleApp.isPreseason` broadened to include awaiting-kickoff source. Codex remediation: selector returns time-invariant fact (kickoff date); consumers evaluate `Date.now()` at render time.
- **Phase 3 — Insights Lifecycle Awareness** (`385a071`, `6358c2c`): Engine-level `shouldSuppressGenerator(g, context)` cross-cutting filter (`career:rookie_benchmark` suppressed when `usingArchivedRoster`); gated by `bypassSuppression`. New `src/lib/insights/framing.ts`: `applyLastSeasonFraming` and `applyReturningOwnerFraming` helpers. 7 generator surfaces use "Last season's" prefix; 4 use "Returning owner" narrative; `rookieBenchmarkGenerator` returns early. Zero-game guards on `deriveLeagueInsights`, `deriveTightRaceInsight`, `deriveTightClusterInsight`. 22 new tests. Codex remediation: `bypassSuppression || !shouldSuppressGenerator(g, context)` — bypass honored in new filter.

**User-visible improvements:**

- Non-admin users no longer receive serialized draft admin state in server HTML before redirect
- Draft polling scales with phase — ~690 MB/day unnecessary egress eliminated when drafts are not active
- Standings page shows "Season starts [date]" preseason placeholder instead of silently blank
- Insights panel no longer displays nonsense like "Toilet bowl leader in 0 games" during preseason

**Architectural improvements:**

- `canAccessDraftBoard`: single server-side auth entry point for all draft admin access; eliminates inline `publicMetadata.role` comparisons in client components
- `shouldSuppressGenerator`: cross-cutting engine filter for (id, lifecycle, flag)-based suppressions; `bypassSuppression` gate respected so admin diagnostic runs see unfiltered output
- Cache/time separation: time-dependent classification (`Date.now()`) removed from `unstable_cache`-wrapped selectors; consumers evaluate at render time — pattern established for all future cached selectors
- Framing helpers: `applyLastSeasonFraming` + `applyReturningOwnerFraming` are deterministic, idempotent transforms safe to use in tests and across multiple render cycles

---

### Standings Ownership Model Redesign — Complete

**Status:** Complete. Six phases shipped across multiple sessions. See `docs/campaigns/standings-ownership.md` for the full retrospective.
**PROMPT_IDs:** STANDINGS-CANONICAL-SELECTOR-DISCOVERY, STANDINGS-CANONICAL-SELECTOR-CORE, STANDINGS-CANONICAL-SELECTOR-OVERVIEW, STANDINGS-OWNERSHIP-MODEL-DISCOVERY, STANDINGS-OWNERSHIP-PHASE-0-INVALIDATION, STANDINGS-OWNERSHIP-PHASE-1-OVERVIEW, STANDINGS-OWNERSHIP-PHASE-2-STANDINGS-ROUTE, STANDINGS-OWNERSHIP-PHASE-3-MEMBERS-MATCHUPS, STANDINGS-OWNERSHIP-PHASE-4-HISTORY, STANDINGS-OWNERSHIP-PHASE-5-LIFECYCLE

**Inciting issue:** NoClaim at #1 on Overview during Test League preseason — user-visible screenshot showed NoClaim occupying the top standings row. Multiple Overview surfaces (top-3, condensed table, Games Back chart) displayed inconsistent data because each independently merged client-side live data with partial server state at render time.

**Scope evolution:** Originally framed as a 4-prompt canonical selector campaign (CORE, OVERVIEW, FANOUT, SERVER-INSIGHTS). After Phase 2 went through eight rounds of Codex remediation — all addressing edge cases of merge-at-render-time logic — the campaign was replanned as a 6-phase ownership redesign (STANDINGS-OWNERSHIP-MODEL-DISCOVERY).

**Architectural shift:** From "two data sources merged at render time based on shape-readiness predicates" to "server canonical owns the settled snapshot, client owns the live overlay separately, consumers receive both as distinct props."

**Phases shipped:**

- **Phase 0** — Invalidation infrastructure. Wrapped `getCanonicalStandings` with `unstable_cache` + `React.cache`, added `invalidateStandings` helper, wired into all mutation routes (owners, aliases, postseason-overrides, draft confirm, schedule, scores, admin backfill, admin rollover). `RosterUploadPanel` calls `router.refresh()`.
- **Phase 1** — Overview takeover collapse. Removed merge-at-render-time logic from `CFBScheduleApp`'s Overview path. Introduced `liveDelta` interface (`LiveGameDelta`, `LivePendingOwnerDelta`, `LiveDelta` types) + `selectLiveDelta` selector + `useLiveDelta` hook. Server canonical owns Overview rows/history/colorOrder; client owns `liveDelta` overlay separately.
- **Phase 2** — Standings route + StandingsPanel migration. Server route loads canonical. `StandingsPanel` consumes canonical for rows, history, color order. First liveDelta UI integration: W-L pending badges next to live-game owners. NoClaim filtering pushed to source (`deriveStandings` now returns `{ rows, noClaimRow, ... }` with rows excluding NoClaim).
- **Phase 3** — Members + Matchups route migrations. `OwnerPanel`, `MatchupsWeekPanel`, `MatchupMatrixView` consume canonical. Second liveDelta UI integration: pulsing dot in LIVE pill on in-progress games in `MatchupsWeekPanel`. Admin form refresh polish: 5 admin forms (alias editor, postseason override, season rollover, backfill, roster editor) gained `router.refresh()` after success.
- **Phase 4** — History live-rebuild migration. Replaced `buildSeasonArchive(slug, activeYear)` with `getCanonicalStandings({ slug, year: activeYear })` on the History page.
- **Phase 5** — Lifecycle hardening. Parameterized `currentDate` in `deriveLifecycleState` (request handlers capture once, pass through). Added `usingArchivedRoster` flag to `InsightContext` for `fresh_offseason` fallback path. Documented `POSTSEASON_START_WEEK` constant (Option B; schedule-derived deferred).

**User-visible improvements:**

- NoClaim no longer appears at #1 during preseason on the Overview
- All Overview surfaces (top-3, condensed table, GB chart) now agree
- Live game W-L pending badges next to owner names in StandingsPanel during active games
- Pulsing LIVE pill indicator on in-progress games in the Matchups view
- Admin forms refresh standings immediately after mutations (no stale data displayed)

**Architectural improvements:**

- Single source of truth: `getCanonicalStandings` is the only path for standings data; no competing derivations in components or routes
- Proper mutation invalidation: all mutation routes call `invalidateStandings(slug, year)` with tag-based Next.js cache invalidation
- Testable lifecycle: `currentDate` parameterized at request-handler level; no implicit `new Date()` inside derivation functions
- NoClaim filtered at source: `splitOutNoClaim` in `src/lib/standings.ts` — no per-consumer filtering needed
- `liveDelta` as a stable separate seam: live game annotations are computed client-side and passed as distinct props, never merged into canonical rows

**Key architectural decisions:**

- `React.cache` wraps `unstable_cache`: per-request dedup outside, cross-request tag invalidation inside
- Tag granularity: `standings:{slug}` (slug-level) and `standings:{slug}:{year}` (year-level)
- Closure pattern required to bake `slug+year` into the `unstable_cache` key array
- Per-route compatibility shim (`canonical?.rows ?? client.rows`) retired per route as migration progressed
- Lifecycle dispatch on `leagueStatus.state + canonical.source`, not full `LifecycleState` recomputation

---

### Insights Panel Redesign + Polish — Complete

**Status:** Complete. Branch `claude/copy-variation-architecture-vk1yp`.
**PROMPT_IDs:** INSIGHTS-017-PANEL-UI, INSIGHTS-017-POLISH-DISCOVERY, INSIGHTS-017-POLISH-DISCOVERY-FOLLOWUP, INSIGHTS-017-PANEL-POLISH, INSIGHTS-017-POLISH-FOLLOWUP-DISCOVERY, INSIGHTS-017-PANEL-POLISH-FOLLOWUP, STANDINGS-SUBHEADER-DIAGNOSTIC, STANDINGS-SUBHEADER-FIX

**Key outcomes:**

- INSIGHTS-017-PANEL-UI (commit `1348605`): initial panel redesign — 5 insights (up from 3), 10px uppercase category microlabels above each title, first-row prominence via larger type, fully tappable rows with `→` affordance at 13px muted, "See all →" link to dedicated insights page, mobile full-width presentation. `AllInsightsRow` extracted as a client component to access `useIsDarkMode()` for category colors. `DESIGN.md` updated with Insights Panel + Insight Category Colors sections codifying the token pairs and the semantic-off-limits rule (amber/green/red/blue reserved for interactivity/win-loss/errors).
- INSIGHTS-017-PANEL-POLISH (commit `a82ef02`): polish pass — row 1 flattened to a uniform 14px treatment (prominence removed pending ranker maturity, to be restored when INSIGHTS-RANKER-TUNING lands); HISTORICAL and RIVALRY insights now carry deep-link arrows via a panel-layer `resolveHistoryHref()` resolver (Tier 1 routable today: `drought` → `#dynasty-drought`, `dynasty` → `#championships`, career/owner generators → `/history/owner/{owner}`, `greatest_season` → `/history/{year}`, rivalry types → `#rivalries`, `milestone_watch-wins` → owner page; Tier 2 returns `null` for `career_points_leader`, `career_turnover_margin`, and `milestone_watch-points` pending HISTORY-REWORK career surface); three section anchors added to the history page (`#championships`, `#rivalries`, `#dynasty-drought`); light-mode banner fix — all five CFBScheduleApp banner variants (offseason, draft scheduled, draft complete, draft scheduled no-status, plus pulse) converted from hardcoded dark-mode-only hex values to a paired `{light, dark}` palette object keyed off `isDark`.
- INSIGHTS-017-PANEL-POLISH-FOLLOWUP (commit `113b27d`): SEASON season_wrap insights `champion_margin` and `failed_chase` rerouted from `/standings` to `/league/{slug}/history/{year}` via a new optional `panelYear` fourth argument on `insightHref`, threaded through all three render sites (`OverviewPanel.InsightRow`, `StandingsPanel`, `AllInsightsRow`); `leagueStatus` plumbed to the standings page alongside a new `mostRecentArchivedYear?: number` prop, resolved via `listSeasonArchives(slug)` sorted descending; new offseason subheader branch on `CFBScheduleApp` renders "{year} Final Standings" only when `leagueStatus.state === 'offseason'` AND `weekViewMode === 'standings'` AND a resolved archive year is available; insight-row arrow contrast bumped from `text-gray-400` (#9ca3af, ~2.85:1 against white, below WCAG 3:1) to `text-gray-500` (#6b7280, ~4.6:1) at all three render sites; dark-mode class unchanged.
- STANDINGS-SUBHEADER-FIX (commit `3890bad`): post-ship diagnostic (STANDINGS-SUBHEADER-DIAGNOSTIC) identified that the new subheader branch never fired in the primary user flow — the WeekViewTabs "Standings" button mutates `weekViewMode` state in place without changing the route, so users hitting the standings view via the in-page tab stayed on `/league/{slug}` where `mostRecentArchivedYear` had not been plumbed. Fix: `listSeasonArchives(slug)` added to the main league page's `Promise.all`, `mostRecentArchivedYear` computed identically to the standings page, and passed to `CFBScheduleApp`. Single-file, 9-line change; no modifications to the standings page, the prop type, or the subheader branch — those were already correct.
- **`/league/{slug}/insights` page stabilization** (two commits beyond the originally-scoped work, surfaced during PR review): ALL-INSIGHTS-SCHEME-FIX (commit `2acdcf5`) replaced the `'https'` fallback on `x-forwarded-proto` with `NODE_ENV === 'development' ? 'http' : 'https'` so the server-side fetch works in local dev and self-hosted environments. ALL-INSIGHTS-OFFSEASON-FALLBACK (commit `e208104`) added a context-builder fallback to the most recent archive's `ownerRosterSnapshot` when the current-year owners CSV is empty, so the engine keeps producing insights during the offseason rollover window before preseason roster upload. Together these shipped the `/insights` page originally scoped as a separate ALL-INSIGHTS-PAGE backlog item.

**Key architectural decisions:**

- Panel-layer resolver approach (Option 1) chosen over payload mutation — `panelYear` threaded as an optional arg rather than added to the `Insight` type. Generators and derive helpers remain untouched; the reroute lives entirely at the presentation layer. Future season-year-scoped reroutes can extend the same resolver without touching selectors.
- `mostRecentArchivedYear` resolved from `listSeasonArchives()` rather than inferred from `league.year` — the league's active year can be bumped at preseason entry, so it's not a reliable signal for "most recently completed season" during the offseason window.
- Three sentinel Tier 2 types (`career_points_leader`, `career_turnover_margin`, `milestone_watch-points`) explicitly return `null` from the resolver — users see no arrow on those rows until the HISTORY-REWORK campaign ships a career stats surface. Preferred over broken arrows that land on pages that don't display the cited stat.
- Light-mode arrow lifted one step in the gray scale to match description text (`text-gray-500`) rather than two steps (`text-gray-600`) — maintains the secondary-to-title visual hierarchy while clearing WCAG 3:1 for non-text UI graphics.

**Infrastructure:** Neon Postgres upgraded from Free tier to Launch tier ($19/month) mid-campaign to resolve a 5 GB egress quota block that was intermittently failing DB reads during development. Launch tier provides 50 GB/month; active-season + draft-day traffic may still require server-side caching before August launch (tracked as APPSTATESTORE-CACHING).

---

### Insights Engine — Generator Batch 2 — Complete

**Status:** Complete.
**PROMPT_IDs:** INSIGHTS-015, INSIGHTS-015-BUG-FIXES

**Key outcomes:**

- INSIGHTS-015: 16 new generators across 3 new files:
  - `career.ts`: career_points_leader, career_turnover_margin, volatility, never_last, title_chaser, rookie_benchmark, greatest_season, trending_up, trending_down
  - `stats.ts`: ball_security, takeaway_king, yards_per_win, clock_crusher, third_down, team_identity
  - `milestones.ts`: milestone_watch, perfect_against
- Generator-level `tone: 'factual' | 'playful'` property added to all generators
- `InsightWindow` type defined for future time window parameterization
- INSIGHTS-015-BUG-FIXES: UTF-8 encoding fixed (charset header added to API response), trending direction logic fixed (strict monotonicity check replaces lenient comparison)

**Key architectural decisions:**

- `tone` property on generators enables copy-layer filtering without changing engine logic
- `InsightWindow` is reserved/typed but not yet consumed — added to types.ts to lock the interface before copy variation work begins
- Strict monotonicity for trending generators (must be strictly increasing/decreasing across all seasons, not just net direction)

---

### Insights Engine — Context Extension — Complete

**Status:** Complete.
**PROMPT_IDs:** INSIGHTS-014, INSIGHTS-014-CONTEXT-EXTENSION

**Key outcomes:**

- INSIGHTS-014: `pointsAgainst` added to `OwnerSeasonStats`; `OwnerCareerStats` type defined with: `seasons`, `totalWins`, `totalLosses`, `totalPoints`, `totalPointsAgainst`, `totalYards`, `turnovers`, `turnoverMargin`, `titles`, `titleYears`, `finishHistory`, `firstSeason`, `isRookie`
- `buildOwnerCareerStats()` assembles career records from archive data across all seasons
- Diagnostic route `GET /api/debug/insights-career-diagnostic` added (admin-gated) for live inspection of career stat assembly

**Key architectural decisions:**

- Career stats assembled at query time from per-season archive data — no pre-aggregated career totals stored
- `isRookie` derived from `firstSeason === currentSeason` so generators can branch on rookie status without duplicating the check
- `pointsAgainst` on `OwnerSeasonStats` unlocks Luck Score generator (points scored vs points allowed differential)

---

### Copy Variation Architecture — Complete

**Status:** Complete.
**PROMPT_IDs:** INSIGHTS-016, INSIGHTS-016-COPY-VARIATION, INSIGHTS-016-COPY-FIX, INSIGHTS-016-CR-FIXES

**Key outcomes:**

- INSIGHTS-016: `newsHook` (11 types: `extending_lead`, `narrowing_gap`, `milestone_crossed`, `streak_extended`, `streak_started`, `new_leader`, `returning_leader`, `never_won`, `new_record`, `challenger_emerging`, `snapshot`) and `statValue: number` added as required fields on `Insight` type
- `src/lib/insights/suppression.ts` created — per-league, per-season suppression scope (`insights-suppression:{leagueSlug}:{season}`), per-type threshold table (`abs`, `pct`, `unchanged`, `snapshot`), NEVER_SUPPRESS set (`milestone_watch`, `perfect_against`, `rookie_benchmark`); exports: `loadSuppressionRecords`, `saveSuppressionRecord`, `clearAllSuppressionRecords`, `isSuppressed`, `toSuppressionRecord`
- Engine upgraded to async — loads suppression records pre-filter, applies `isSuppressed()` gate, sorts and slices top 10, writes records post-cut; all suppression I/O non-blocking
- Per-generator hook selection and copy templates across all 8 generator files — deterministic hook-driven selection, 2–5 templates per insight type, no random rotation
- Playful copy implemented: `dominance_streak` ("living rent-free"), `drought`, `volatility`, `title_chaser`
- `?bypassSuppression=1` query param on insights API bypasses suppression gate for admin/debug use
- Season rollover cron clears suppression records per successfully rolled league (gated behind both archive + status update succeeding)
- INSIGHTS-016-COPY-FIX: `career_points_leader` `extending_lead`/`narrowing_gap` hook mismatch fixed — post-hoc override block removed; "closest it's ever been" copy now lives in the `narrowing_gap` template branch only
- INSIGHTS-016-CR-FIXES: suppression storage scoped by `leagueSlug` + `season` (was global); rollover suppression clear moved inside per-league success path; response reports `suppressionClearedFor: string[]`

**Key architectural decisions:**

- Hook computation is pure — derived from `InsightContext` data (archives, standings, career stats) only, never from prior suppression records
- Suppression key = `insightId + hook`; owner change (different owner holds the lead) treats the insight as new, never suppressed
- `statValue` is a single `number` per insight — the primary numeric measure used for threshold comparison
- Snapshot generators (`team_identity`, `greatest_season`, `clock_crusher`) get `newsHook: 'snapshot'` — suppressed after first fire per league-season

---

### Insights Panel UI Direction — Decided (not yet built)

**Status:** Design decisions complete; implementation queued.

**Key decisions:**

- 5 insights displayed (not 3)
- First insight 15px, rest 14px — typographic hierarchy without cards
- 10px uppercase category microlabel above each title
- Owner names in assigned color, regular weight
- Full row tappable; `→` navigation always visible at 13px muted
- "See all →" link to dedicated insights page
- Mobile: full-width section, no tab strip, no horizontal scroll
- `fresh_offseason` only: featured slot becomes "2025 Season Recap" card
- Owner color map passed as prop from canonical standings source

---

### Insights Engine — Opus 1M Brainstorming Session 2

**Status:** Complete. Planning artifacts recorded; implementation in progress.

**Key outcomes:**

- Data dependency audit: 17 of 18 insights ready with current pipeline (Luck Score requires points-against, now available via INSIGHTS-014)
- Lifecycle fit table: all 18 insights mapped to optimal lifecycle states for display gating
- Natural insight pairings identified: Title Chaser + Volatility, Ball Security + Takeaways, Career Points + Drought, Trending Leader (emergent from trending + standings data)
- Copy variation strategy finalized (see Copy Variation Architecture above)
- AI copy architecture decided: cache-time generation, not request-time; curated subset (pairing cards) only

---

### Insights Engine — Generators and Wiring — Complete

**Status:** Complete. Branch `claude/review-insights-engine-p3j5v` (PR #278).
**PROMPT_IDs:** INSIGHTS-010, INSIGHTS-010-CLEANUP, INSIGHTS-011, INSIGHTS-012, INSIGHTS-013, INSIGHTS-013B, INSIGHTS-CR-001

**Key outcomes:**

- INSIGHTS-010: `deriveLifecycleState()` and `buildInsightContext()` — 7-state lifecycle derived from `LeagueStatus` + `SeasonContext` + calendar; full `InsightContext` assembled from standings history, games, game stats, season archives, historical rosters, current roster, and AP rankings.
- INSIGHTS-010-CLEANUP: `aggregateOwnerSeasonStats()` canonicalized in `src/lib/gameStats/ownerStats.ts`; local mirror in `context.ts` removed.
- INSIGHTS-011: Historical generator (drought, dynasty, most-improved, consistency) and Rivalry generator (lopsided, even, dominance streak) — both self-registering via `registerGenerator()`, active-owner filtering via current roster, per-generator try/catch isolation in the engine.
- INSIGHTS-012: `GET /api/insights/[slug]` API route — loads owners CSV, schedule, scores, rankings, and season archives; builds context and runs the engine. Wired into `OverviewPanel` with merge strategy (engine insights first, existing insights fill up to 3).
- INSIGHTS-013: Dynasty tie copy (e.g. "Pruitt now ties Whited for most titles"), drought never-won ranking (drought = seasons played when the owner has never won), active-owner filtering applied across all 7 insight types (drought, dynasty, improvement, consistency, lopsided_rivalry, even_rivalry, dominance_streak).
- INSIGHTS-013B: Universal tie suppression — 4+ tied owners suppress the insight; 2–3 tied emit group copy ("X and Y have never won a title in N seasons"); 1 keeps existing copy. Applied to drought, consistency, and improvement; dynasty unchanged (already handled ties).
- INSIGHTS-CR-001: Insights API now merges league-scoped aliases (`aliases:{slug}:{year}`) with `getGlobalAliases()` directly server-side, consistent with `/api/owners` routes (previously called `/api/aliases?year={year}` which returned only the legacy year-scoped map, empty after migration). Even rivalry copy branches on `winDiff` — `winDiff === 0` uses "tied at" phrasing, `winDiff === 1` uses "X leads Y N-M across K meetings — the closest rivalry in the league".

**Key architectural decisions:**

- Generators resolve active owners from `context.currentRoster` (roster CSV), never from archive standings — former owners are filtered from every derived insight.
- Tie suppression thresholds live in `historical.ts` (`TIE_SUPPRESSION_THRESHOLD = 4`) and are uniform across drought / consistency / improvement.
- `buildInsightContext()` centralizes owner aggregation so generators never reach into CFBD or CSV parsing directly.
- API route uses direct server-side stores (`getGlobalAliases()`, `getAppState`) instead of HTTP sub-requests where possible — reduces one hop and matches existing server-to-server patterns.

---

### Season Rollover — Complete

**Status:** Complete. Branch `claude/review-insights-engine-p3j5v` (PR #278).
**PROMPT_IDs:** PLATFORM-001, INSIGHTS-012-LEAGUE-STATE-DIAGNOSTIC

**Key outcomes:**

- `SeasonRolloverPanel` added to `/admin/data/cache` — two-phase preview/execute flow. Preview shows, per league, the prospective champion, top 3 standings, archive existence, and any diff against an existing archive. Execute requires explicit `window.confirm` and a destructive red button.
- `buildSeasonArchive()` extracted for reuse across preview/execute/cron paths; `findNationalChampionshipGameDate()` prefers `playoffRound === 'national_championship'` with a fallback to the latest postseason game date.
- Automatic cron at `GET /api/cron/season-rollover` — runs daily, filters non-test leagues in `state: 'season'`, triggers when `championshipDate + 7 days` has passed, archives each league and transitions it to `state: 'offseason'` with per-league error isolation.
- TSC League successfully rolled over to offseason via the new panel.
- `vercel.json` now lists three cron jobs: season-transition (daily 00:00 UTC; internal date math gates when the transition actually fires), game-stats (Monday 11:00 UTC weekly refresh), season-rollover (daily 00:00 UTC post-championship check).

**Key architectural decisions:**

- Two-phase UI (preview → confirm) chosen over single-click to protect against accidental rollovers; existing archives get a diff summary rather than silent overwrite.
- Cron delay of 7 days after the national championship is a safety buffer for late corrections and any admin review before final archive.
- Preview response includes `champion` and `top3` so the UI does not re-compute standings in the client — the server stays authoritative.

---

### History Page Polish — Complete

**Status:** Complete. Branch `claude/review-insights-engine-p3j5v` (PR #278).
**PROMPT_IDs:** POLISH-003

**Key outcomes:**

- All-time standings sort order corrected: Total Wins → Win% → Point Differential (previously championships-first, which buried owners who had dominated without winning a title). `totalPointDifferential` added to `AllTimeStandingRow`, accumulated from archived season rows.
- Former owner visual distinction in All-Time Standings and Top Rivalries: active owners are derived server-side from the current roster CSV (`owners:{slug}:{year}`), former owners render with muted text and a "Former" badge. `activeOwners: string[]` passed as props (not `Set<string>`) to preserve server/client component serialization.

---

### Insights Engine — Opus 1M Brainstorming

**Status:** Planning complete; implementation deferred to next campaign.

**Key outcomes:**

- 18 new insight ideas ranked and categorized in the Opus 1M brainstorming session.
- Tier 1 (12 immediately buildable): Ball Security, Takeaway King, Clock Crusher, Team Identity, Third Down Specialist, Career Points Leader, Volatility Award, Never Finished Last, Title Chaser / Bridesmaid, Career Turnover Margin, Yards-Per-Win Efficiency, Trending Up/Down.
- Tier 2 (special handling needed): Luck Score (requires points-against pipeline), Career Milestone Watch, Perfect Against, Rookie Benchmark, Greatest Single Season.
- Next generator batch queued for the next Claude Code session — Stats Outliers generator covers the largest cluster of Tier 1 ideas (yards-per-win, ball security, takeaway king, team identity).

---

### Insights Engine Foundation — Complete

**Status:** Complete. PR #276 (`claude/review-insights-architecture-AAynV`).
**PROMPT_IDs:** INSIGHTS-006-ARCHITECTURE-REVIEW, INSIGHTS-007-EXISTING-AUDIT, INSIGHTS-008-DEAD-CODE-CLEANUP, INSIGHTS-009-GENERATOR-RESTRUCTURE, POLISH-001-QUALITY-BASELINE, POLISH-002-RUNBOOK-UPDATE

**Key outcomes:**

- POLISH-001: Lint/typecheck baseline fully restored — 86 files reformatted, 1 test fixed, zero ESLint and TypeScript errors
- POLISH-002: `docs/deployment-runbook.md` rewritten to reflect Clerk-based auth model (removed all `ADMIN_API_TOKEN` references)
- INSIGHTS-007: Full audit of all existing insight logic — mapped every import site, consumer, and dead-code path before touching anything
- INSIGHTS-008: Dead code removal — orphaned `computeWeeklyInsights` function and `WeeklyInsights` type deleted from `leagueInsights.ts`; active exports moved to new `src/lib/gameTags.ts`; 252 lines of dead code removed; all 5 import sites updated
- INSIGHTS-009: Generator interface established:
  - `src/lib/insights/types.ts` — `LifecycleState` (7 states), `InsightCategory` (9 categories), `InsightGenerator`, `InsightContext`, `OwnerSeasonStats`
  - `src/lib/insights/engine.ts` — `registerGenerator()`, `runInsightsEngine()` (filters by lifecycle, try/catch isolation, sorted by priority, capped at 10)
  - `src/lib/insights/generators/existing.ts` — trajectory, season_wrap, championship_race generators (self-registered at module load)
  - `Insight` type extended with optional `category`, `lifecycle`, `stat` fields
  - All 8 existing derive functions annotated with appropriate category and lifecycle
  - Naming conflict resolved: legacy `deriveLeagueInsights` (gameTags.ts, `{id, text, priority}` shape) renamed to `deriveGameMovementInsights`; canonical `deriveLeagueInsights` (selectors/insights.ts, rich shape) retains its name

**Key architectural decisions:**

- Architecture audit (INSIGHTS-006, INSIGHTS-007) confirmed: extend `selectors/insights.ts`, do not replace it — the existing derive functions are sophisticated and well-tested
- `deriveLeagueInsights` in `selectors/overview.ts` was incorrectly flagged as orphaned in the audit; discovered it feeds `shouldShowFeaturedMatchups` rendering gate via `deriveLeagueHighlights`
- Three dead view model properties identified as future cleanup candidates: `viewModel.keyMovements`, `viewModel.leaguePulse`, `viewModel.shouldShowLeaguePulse` — computed but never read by any UI component

---

### Game Stats Pipeline — Complete

**Status:** Complete. PRs #274–#275 (`claude/audit-cfbd-game-stats-06YHO`).
**PROMPT_IDs:** P7B-GAME-STATS-PIPELINE-A, P7B-GAME-STATS-AUDIT, P7B-GAME-STATS-CACHE-PANEL, P7B-GAME-STATS-BACKFILL, P7B-GAME-STATS-NORMALIZE, INSIGHTS-002-LATEST-WEEK-FIX, INSIGHTS-003-DATA-DIAGNOSTIC, INSIGHTS-004-SCHOOL-NAME-FIX

**Key outcomes:**

- CFBD `/games/teams` endpoint integrated — one call per week, returns all team stats for all games in that week
- Normalized fields: `totalYards`, `rushingYards`, `passingYards`, `turnovers`, `turnoverMargin`, `thirdDownPct`, `possessionSeconds`, plus 6 return stat fields (`interceptionReturnYards/TDs`, `kickReturnYards/TDs`, `puntReturnYards/TDs`)
- Cache: `appStateStore` scope `game-stats`, key `${year}:${week}:${seasonType}`
- Monday 11am UTC cron (`/api/cron/game-stats`) auto-fetches latest completed week
- Admin cache panel: `GameStatsCachePanel` with "Refresh Game Stats" and "Backfill Full Season" buttons
- Owner aggregation module: `aggregateOwnerGameStats()` resolves teams via `TeamIdentityResolver`, attributes per-game stats to each owner
- Bug fixed (INSIGHTS-004): CFBD response uses `team` field not `school` for school name — corrected in normalizer
- Bug fixed (INSIGHTS-002): Latest week detection uses calendar date (not week number) to avoid picking the current in-progress week
- Diagnostic route: `GET /api/debug/game-stats-diagnostic` (admin-gated) for live inspection
- 2021–2025 fully backfilled (5 seasons × ~19 weeks = 95 weeks cached)

**Key architectural decisions:**

- Stats accumulated at query time from per-game data — no pre-aggregated owner totals stored in the cache
- `TeamIdentityResolver` (existing) used for team→owner resolution — no duplicate matching logic
- API cost: ~19 additional CFBD calls per season — well within the 1,000/month free tier

---

### P7B-6 — Draft Board UI Polish: Complete

**Status:** Complete. Branch `claude/polish-draft-flow-Rv5AF`.
**PROMPT_IDs:** P7B-6, P7B-6-FIX, P7B-6-FIX-2, P7B-6-FIX-3, P7B-6-FIX-3-HOTFIX, P7B-6-FIX-4, P7B-6-FIX-5, P7B-6-FIX-5B, P7B-6-FIX-5C, P7B-6-FIX-5D

**Key outcomes:**

- Rosters column removed from commissioner and spectator draft boards (2-col grid: board + available teams)
- On-the-clock cell uses consistent solid blue (`bg-blue-600`)
- Active/on-deck cell colors: active=solid blue, on-deck=light blue tint
- Left color bar added to Available Teams cards and pick cells via `teamColorMap` from `getTeamDatabaseItems()`
- Available Teams panel narrowed to 210px
- Search/filter added to spectator board Available Teams panel
- Landing page cleanup: "Draft Setup →" link removed, NoClaim excluded from owner count, status label derived from `league.status`
- Draft status row on league hub links to draft board when live/paused
- Spectator standalone banner removed
- `md` breakpoint (instead of `lg`) used for two-column layout

**Key architectural decisions:**

- Left bar with no background chosen over tinted background for pick cells — team color is the only signal, no competing background tint
- Conference colors used as fallback when team sync has not been run
- `md` breakpoint instead of `lg` for two-column layout to accommodate smaller screens

---

### P7B-5 — Owner Confirmation Flow: Complete

**Status:** Complete. Branch `claude/add-league-status-field-jPzcQ`.
**PROMPT_IDs:** P7B-5, P7B-5-FIX, P7B-5-FIX-2, P7B-5-FIX-3, P7B-5-FIX-4, P7B-5-FIX-5, P7B-5-FIX-6

**Key outcomes:**

- Owner confirmation page at `/admin/[slug]/preseason/owners` with three-step pre-population fallback: saved preseason-owners list → archive ownerRosterSnapshot → live owner CSV (fixes test league)
- `preseasonOwnerStore.ts` — `getPreseasonOwners` / `savePreseasonOwners` with key `preseason-owners:{slug}` / `{year}`
- `OwnerConfirmationShell.tsx` client component — add/remove owners, duplicate guard, min-2 gate on Save
- `confirmPreseasonOwners` server action — saves and redirects back to preseason checklist
- Preseason checklist "Owners confirmed" now reads from `preseasonOwnerStore`, not raw owners CSV
- Draft setup page (`/league/[slug]/draft/setup`) prefers confirmed preseason-owners list for `priorOwners` population
- Reset Draft button added to TestLeagueControls — deletes all `draft:test/{year}` keys and corresponding owner CSVs
- Lifecycle year derivation (`status.year` pattern) applied to all four draft pages: commissioner board, spectator board, setup, and summary
- Clerk session bridge in `DraftBoardClient` — auth reads both `sessionStorage` token and Clerk `publicMetadata.role` with async-safe loading guards to prevent premature redirect

**Key architectural decisions:**

- Third fallback (live owner CSV at `owners:{slug}:{year-1}/csv`) solves test league structurally — test league has no `standings-archive:test` entries, so archive-based pre-population is permanently broken for it; live CSV is always available
- `teamsHref` for manual assignment points to `/admin/${slug}/preseason` (not `/assign`) since manual flow is coming soon on that page; this prevents a 404

---

### P7B-4 — Pre-Season Setup Flow: Complete

**Status:** Complete. Branch `claude/add-league-status-field-jPzcQ`.
**PROMPT_IDs:** P7B-4, P7B-4-FIX, P7B-4-FIX-2, P7B-4-FIX-3, P7B-4-FIX-4, P7B-4-FIX-5

**Key outcomes:**

- Pre-season setup page at `/admin/[slug]/preseason` with three-item checklist: Owners confirmed / Teams assigned / Season live
- Assignment method selection card (Run a Draft / Assign Manually) persisted to `league.assignmentMethod`
- Go Live button gated by checklist completion — transitions league to season and syncs `league.year`
- Draft card removed from league hub tool cards; draft accessible only through pre-season flow
- Draft setup page year derivation fixed to use lifecycle status year (`status.year`) rather than `league.year`
- Test league controls: idempotent preseason year (no double-increment), Reset to 2025 Season button
- `manualAssignmentComplete?: boolean` added to `League` type for method-aware team assignment check
- `teamsHref` on preseason page is method-aware: draft → draft setup, manual → `/assign` (P7B-6), null → self

**Key architectural decisions:**

- "League created" dropped from checklist — not meaningful for recurring season resets
- Pre-season checklist is the single model for both initial setup and recurring season transitions
- `goLive` action syncs both `status` and `league.year` atomically so downstream year derivation always resolves correctly

---

### Phase 7F — Overview Featured Games: Complete

**Status:** Complete. Branch `claude/fix-standings-ui-re94y`. PR #241.
**PROMPT_IDs:** PHASE-7F-FEATURED-GAMES, PHASE-7F-FIX-01 through PHASE-7F-FIX-06

**Key outcomes:**

- Renamed "Recent Results" → "Featured Games" with 2-column card grid layout
- CFP round badges with neutral slate/gray styling — full labels ("CFP Quarterfinal", "CFP First Round")
- Conference championship badges with conference name ("SEC Champ")
- Inline W16 CFP rankings on postseason game cards (not Final Poll)
- Dark card styling — no border, background-defined cards
- Winner score full weight, loser score muted
- Context-aware game selection: postseason surfaces playoff/bowl, in-season surfaces current week
- NoClaim owner filtering from display lines and game list
- First Round CFP classification via neutral site = false (campus games)
- 6-game display cap

**Key architectural decisions:**

- `deriveFeaturedGameBadge(game)` — badge logic driven by `playoffRound` (more specific) over `postseasonRole`
- `overviewRankingsByTeamId` memo in `CFBScheduleApp.tsx` — selects last regular-season CFP week for rankings instead of Final Poll
- `selectFeaturedGames()` in overview selectors — postseason tier sorting via `postseasonRolePriority()`
- First-round campus game fallback: `(round == null || round === 'playoff') && !game.neutral` → 'CFP First Round'

---

### Phase 7A–7E — Product Design Audit (Standings through Speed Insights): Complete

**Status:** Complete. Multiple PRs across branches.

**Key outcomes:**

- **7A Standings:** NoClaim exclusion, Win% format, DIFF colors, MOVE column hidden at season end, ranked colors, table-as-legend pattern, bidirectional hover/select, mode switcher removed, legend tables removed, chart improvements (Y-axis domain, convergence scaling, Final label, right edge padding, tabbed charts)
- **7B FBS Polls:** Built Rankings tab, postseason Final Poll week, debug pill removed, three-column layout with movement indicators
- **7C Nav redesign:** Underline tabs throughout, sub-nav band removed, inline content tabs, renamed to League Table / FBS Polls / Matchups
- **7D Mobile standings:** PF/PA hidden, card borders removed, compact column set, mobile legend + scrollable chart
- **7E Speed Insights:** Added Vercel Speed Insights to layout.tsx

**Design codification:**

- Created `DESIGN.md` at project root capturing all design principles established during Phase 7
- Added `DESIGN.md` reference to `CLAUDE.md` canonical doc pointers and architectural section

---

### P6E — Roster Editor: Complete

**Status:** Complete. Branch `claude/debug-owner-csv-log-VQqia`. PR #229.
**PROMPT_IDs:** P6E-ROSTER-EDITOR-v1, P6E-ROSTER-EDITOR-REVIEW-v1, P6E-ROSTER-EDITOR-FIX-v1, P6E-CLOSEOUT-v1

**Key decisions and architectural notes:**

- **`RosterEditorPanel` is a direct CRUD interface** — distinct from the draft tool (live event) and upload flow (bulk CSV with fuzzy matching). Handles post-draft fixes, leagues without a formal draft, mid-season transfers, and testing.
- **`savedOwners` / `draftOwners` Map split** enables per-row dirty tracking. `mapsEqual()` gates save/discard buttons. Dirty rows highlighted amber.
- **Save writes full CSV via `PUT /api/owners`** — same endpoint as the upload flow. `buildCsv()` filters teams with empty owner values; only assigned teams written to storage.
- **Bulk reassign updates `draftOwners` local state only** — commissioner must explicitly click Save Changes to persist.
- **RFC 4180 state-machine CSV parser** (`parseCsvRow()`) — handles quoted fields, comma-in-name (`"Smith, Jr"`), `""` unescaping, mixed quoted/unquoted fields. Replaces naive `indexOf(',')` split that caused quote amplification on re-save.
- **`buildCsv()` RFC 4180 escaping verified correct** — `csvField()` wraps fields containing commas/quotes/newlines and escapes `"` as `""`. Left unchanged.
- **Year sourced from `league.year`** — same source as `RosterUploadPanel` — ensures both panels target the same `owners:${slug}:${year}` scope key. `seasonYearForToday()` removed as a separate year source.
- **`NoClaim` and empty owner values both supported** — owner inputs are free-form text; no validation or exclusion logic.
- **On save success**: server response CSV re-parsed; both `savedOwners` and `draftOwners` synced from server state.

---

### P6 — Admin Polish and Commissioner UX: Complete

**Status:** Complete. Branch `claude/debug-owner-csv-log-VQqia`. PRs #230–#234.
**PROMPT_IDs:** P6-ADMIN-POLISH-v1, P6-ADMIN-POLISH-REVIEW-v1, P6-ADMIN-POLISH-FIX-v1, P6-ADMIN-POLISH-FIX-REVIEW-v1, P6-ADMIN-POLISH-CLOSEOUT-v1, P6-GEAR-ICON-FIX-v1, P6-ADMIN-FONT-FIX-v1, P6-ADMIN-SLUG-INDEX-v1, P6-LEAGUE-DATA-PAGE-v1, P6-LEAGUE-DATA-PAGE-FIX-v1, P6-ADMIN-COMMISSIONER-POLISH-v1, P6-ADMIN-COMMISSIONER-POLISH-REVIEW-v1, P6-ADMIN-COMMISSIONER-POLISH-FIX-v1, P6-ADMIN-NAV-FIX-v1, P6-FINAL-CLOSEOUT-v1

**Key decisions and architectural notes:**

- **Consistent back-nav pattern** — blue `← Label` top-left on all admin pages; label names the immediate parent (e.g. `← Admin`, `← {displayName}`).
- **Plain English copy** — developer terminology replaced throughout all diagnostic and action panels.
- **Gear icon in league view header** — right-justified, only visible to `platform_admin`, links to `/admin/[slug]`, tooltip "League settings". Rendered via `isAdmin` prop; no Clerk hooks in client component body.
- **`isAdmin` prop pattern** — `CFBScheduleApp` accepts `isAdmin?: boolean` prop; auth derived server-side via `auth()` from `@clerk/nextjs/server` in each parent page; cast pattern `sessionClaims as Record<string, unknown> & { publicMetadata?: Record<string, unknown> }` to extract role safely. No `useAuth()` in reusable components.
- **Commissioner bucket per league: four cards in 2×2 grid** — Roster, Draft, Data, Settings at `/admin/[slug]`.
- **`/admin/[slug]` landing page** — gear icon destination and direct commissioner entry point; `notFound()` on bad slug. "← Back to league" link gives clear return path after navigating from gear icon. Duplicate "← Admin" removed — layout breadcrumb handles admin navigation.
- **League Settings page at `/admin/[slug]/settings`** — `LeagueSettingsForm` (client component): editable display name and year, read-only slug field, `PATCH /api/admin/leagues/${slug}` with `requireAdminAuthHeaders()`, save/error/loading states.
- **`LeagueStatusPanel`** — server component at top of `/admin/[slug]/data`; reads `appStateStore` directly; shows roster owner count + age timestamp, schedule/scores cache status + age, draft phase with color coding (setup/settings: zinc; preview: blue; live: green; paused: amber; complete: white); returns `null` gracefully if storage unavailable.
- **Schedule cache key** — default `seasonType` in schedule route is `'all'`; default cache key is `${year}-all-all`. `LeagueStatusPanel` checks `${year}-all-all` first, falls back to `${year}-all-regular`.
- **`GlobalRefreshPanel`** on `/admin/data/cache` — platform-level schedule and both-season-type scores refresh; year input defaulting to `seasonYearForToday()` prevents wrong-season caching in offseason. All three fetch calls pass explicit `year` param.
- **Aliases kept per-league** — `LeagueDataPanel` on `/admin/[slug]/data` retains Aliases section only; Schedule/Scores removed (platform-level actions moved to `GlobalRefreshPanel`).
- **Win Totals moved to platform admin** — `/admin/[slug]/win-totals` now redirects to `/admin/data/cache`; Win Totals is a global action with no per-league scope.
- **`RESERVED_ADMIN_SLUGS`** enforced at league creation (`POST /api/admin/leagues`) — prevents slug collisions with named admin routes (`season`, `data`, `draft`, `diagnostics`, `leagues`, `cache`).
- **`/admin/data` as league selector** — single league auto-redirects to `/admin/[slug]/data`; multiple leagues shows card grid; no leagues shows link to `/admin/leagues`.
- **Legacy `CFBScheduleApp` Admin/Debug panel fully removed** from all commissioner-facing and public-facing league pages.
- **League name font** — `text-sm font-semibold text-zinc-100` in commissioner tools card; prevents oversized rendering at default `text-base`.

---

### P6D — Admin UI Restructure: Complete

**Status:** Complete. Branch `claude/debug-owner-csv-log-VQqia`. PR #228.
**PROMPT_IDs:** P6D-ADMIN-RESTRUCTURE-v1, P6D-ADMIN-RESTRUCTURE-REVIEW-v1, P6D-ADMIN-RESTRUCTURE-FIX-v1, P6D-ADMIN-RESTRUCTURE-FIX-REVIEW-v1, P6D-CLOSEOUT-v1

**Key decisions and architectural notes:**

- **`/admin` landing restructured into two sections**: Platform Admin (global tools) and Commissioner Tools (per-league). Four platform admin cards; one block per league in registry for commissioner tools.
- **Commissioner tool buckets derived from league registry at runtime** — no hardcoded slugs anywhere.
- **League-scoped routes**: `/admin/[slug]/roster`, `/admin/[slug]/win-totals`, `/admin/[slug]/data` — each validates slug and calls `notFound()` on miss.
- **`/admin/data/cache`** serves as platform admin SP+ and historical cache page.
- **`/admin/draft`** retained for `DraftSequencingPanel` overview only — SP+ and Win Totals moved to league-scoped pages.
- **`/admin/data`** restored as a league selector — single league auto-redirects to `/admin/[slug]/data`; multiple leagues shows card grid; no leagues shows link to `/admin/leagues`.
- **`RESERVED_ADMIN_SLUGS`** enforced in league creation API (`POST /api/admin/leagues`): `season`, `data`, `draft`, `diagnostics`, `leagues`, `cache` — returns 400 with clear error message.
- **No route collisions**: named `/admin/*` routes take precedence over `[slug]` dynamic segment in Next.js App Router.
- **Phase 7 prerequisite satisfied**: bucket structure exists; commissioner self-service only needs Clerk role enforcement on existing routes — no restructuring required in Phase 7.

---

### P6 — Clerk Auth Fixes and Admin Data Cleanup: Complete

**Status:** Complete. Branch `claude/debug-owner-csv-log-VQqia`. PRs #221–#227.
**PROMPT_IDs:** P6A-CLERK-REQUIREMENTS-AUDIT-v1, P6A-CLERK-ROUTE-FIX-v1, P6A-CLERK-MIDDLEWARE-FIX-v1, P6A-CLERK-MIDDLEWARE-FIX-v2, P6A-CLERK-MIDDLEWARE-FIX-v3, P6A-CLERK-MIDDLEWARE-FIX-v4, P6A-CLERK-MIDDLEWARE-DEBUG-v1, P6B-ROSTER-UPLOAD-FIX-v1, P6B-ROSTER-UPLOAD-FIX-v2, P6B-ROSTER-UPLOAD-FIX-REVIEW-v1, P6B-BACKFILL-FIX-v1, P6B-BACKFILL-FIX-REVIEW-v1, P6C-OWNER-COUNT-FIX-v1, P6C-OWNER-COUNT-FIX-v2, P6C-OWNER-COUNT-FIX-v3, P6C-OWNER-COUNT-DEBUG-v1, P6C-OWNER-COUNT-DEBUG-v2, P6C-OWNER-SCOPE-AUDIT-v1, P6C-DEBUG-CLEANUP-v1, P6-CLERK-FIXES-CLOSEOUT-v1

**Key fixes and decisions:**

- **Clerk session token requires explicit publicMetadata claim** — add via Configure → Sessions → Customize session token: `{ "publicMetadata": "{{user.public_metadata}}" }`. Must be done for both Dev and Prod instances. See `docs/archive/designs/phase-6-admin-auth-design.md` section 9.
- **JWT templates are for third-party integrations only** — they do NOT affect middleware auth. Using a JWT template to expose `public_metadata` does not fix the session token. Delete any templates created for this purpose.
- **`currentUser()` cannot be called in middleware** — use `auth()` and `sessionClaims.publicMetadata.role` only.
- **Login page requires catch-all route at `[[...sign-in]]`** — multi-step Clerk auth flows (MFA, SSO) require a catch-all slug. A static `/login/page.tsx` will break after step 1.
- **`routing="path"` and `path="/login"` props required** on the `<SignIn>` component to enable catch-all routing correctly.
- **Owner count on landing page uses `seasonYearForToday()`** — not `league.year`. Matches league view behavior; owner CSV stored under `owners:${slug}:${year}` where year is the active CFB season year.
- **Owner CSV scope is `owners:${slug}:${year}` with key `csv`** — year must match active season year. CSV uploaded without `?league=` query param goes to `owners:${year}` (wrong scope); always include `?league=${slug}`.
- **Roster upload on `/admin/data`** uses full fuzzy-match validation pipeline — POST to `/api/owners/validate` first, review confirmed/needs-confirmation/no-match sections, then PUT resolved CSV to `/api/owners`. Confirmed matches saved as global aliases.
- **`/admin/data` page organization** — `RosterUploadPanel` placed at top, before `HistoricalCachePanel`. Further cleanup deferred to future pass.

---

### Phase 6 — Admin Cleanup and Auth (P6A–P6C): Complete

**Status:** All subphases complete. Branch `claude/improve-thread-speed-v1YFg`. PR #217 open.
**PROMPT_IDs:** P6A-CLERK-AUTH-v1, P6A-CLERK-AUTH-REVIEW-v1, P6A-CLERK-AUTH-FIX-v1, P6A-CLOSEOUT-v1, P6B-ADMIN-RESTRUCTURE-v1, P6B-ADMIN-RESTRUCTURE-REVIEW-v1, P6B-ADMIN-RESTRUCTURE-FIX-v1, P6B-CLOSEOUT-v1, P6B-BACKFILL-FIX-v1, P6B-BACKFILL-FIX-REVIEW-v1, P6C-LANDING-POLISH-v1, P6C-LANDING-POLISH-REVIEW-v1, P6C-CLOSEOUT-v1, P6C-OWNER-COUNT-FIX-v1

**Key architectural decisions across Phase 6:**

- **Clerk as auth provider** — three roles defined from day one in `publicMetadata`: `platform_admin`, `commissioner`, `member`. Only `platform_admin` enforced in Phase 6. Scales to Phase 7 without rework.
- **`clerkMiddleware()` in `middleware.ts`** — never `authMiddleware()` (deprecated). `/admin/*` protected at middleware level: unauthenticated → `/login`; authenticated without `platform_admin` → `/`.
- **`<Show when="signed-in/out">` throughout** — deprecated `<SignedIn>` / `<SignedOut>` never used.
- **`requireAdminAuth()`** — checks Clerk JWT first, falls back to `ADMIN_API_TOKEN` during transition. Phased replacement: token removed in Phase 7.
- **Root route `/` dynamic** — hardcoded `/league/tsc` redirect removed. Public landing for unauthenticated visitors; admin dashboard for `platform_admin`. No hardcoded slugs anywhere.
- **Admin restructured into five sub-pages**: `/admin/draft`, `/admin/data`, `/admin/season`, `/admin/diagnostics`, `/admin/leagues`. `/admin` is navigation-only.
- **Admin/Debug panel removed from league view** — league view is fully public-facing.
- **`DraftSequencingPanel`** — rollover guard and active roster guard per league at `/admin/draft`.
- **`HistoricalCachePanel`** — fills pre-existing API-only gap for historical schedule/scores cache at `/admin/data`.
- **Backfill flow fixed** — terminal on first write (no existing archive); confirm only when `requiresConfirmation` returned (existing archive diff).
- **Historical cache year default** — uses CFB season year logic (`month >= 7` → current year is active), not raw UTC year. Prevents offseason 400 errors.
- **Owner count on dashboard** — derived from `appStateStore` CSV at runtime; fails gracefully to `null` when unavailable.
- **Redirect audit clean** — no hardcoded slugs in any route, component, or middleware.

---

### Phase 6C — Landing Page Polish: Complete

**Status:** Complete. Branch `claude/improve-thread-speed-v1YFg`.
**PROMPT_IDs:** P6C-LANDING-POLISH-v1, P6C-LANDING-POLISH-REVIEW-v1, P6C-CLOSEOUT-v1, P6C-OWNER-COUNT-FIX-v1

**Goals completed:**

- **Public landing page** — app name (`text-4xl`), tagline, URL example in `<code>` block with border/bg styling, discrete "Commissioner login" link fixed bottom right.
- **Admin dashboard league cards** — `league.displayName` (large), slug/year/owner count metadata, "View League →" (blue) and "Draft Setup →" (muted) split links per card.
- **Owner count** — fetched server-side from `getAppState('owners:${slug}:${year}', 'csv')` per league; CSV rows counted minus header. Returns `0` when CSV empty/missing; returns `null` (graceful skip) when fetch throws.
- **Footer links** — "Platform admin tools →" (`/admin`) and "Add League →" (`/admin/leagues`) side-by-side.
- **Empty state** — links to `/admin/leagues` with clear instruction copy.
- **Redirect audit** — confirmed clean; no hardcoded slugs in `middleware.ts`, `page.tsx`, `RootPageClient.tsx`, `login/page.tsx`, or `admin/page.tsx`.
- **All seven E2E auth flows verified correct** in code review.
- **Owner count uses distinct owner values** — CSV format is `team,owner` (one row per team assignment). Raw row count returns team count, not owner count. Set-based distinct owner parsing returns correct participant count.

---

### Phase 6B — Admin Page Restructure: Complete

**Status:** Complete. Branch `claude/improve-thread-speed-v1YFg`.
**PROMPT_IDs:** P6B-ADMIN-RESTRUCTURE-v1, P6B-ADMIN-RESTRUCTURE-REVIEW-v1, P6B-ADMIN-RESTRUCTURE-FIX-v1, P6B-CLOSEOUT-v1

**Goals completed:**

- **`/admin` is now navigation-only** — no tools on the landing page; five section cards link to sub-pages.
- **`/admin/draft`** — `DraftSequencingPanel` (server component) shows rollover guard and active roster guard per league with green/red/amber status indicators; `SpRatingsCachePanel` and `WinTotalsUploadPanel` also present.
- **`/admin/data`** — `HistoricalCachePanel` (new, fills pre-existing API-only gap for `cache-historical-schedule` and `cache-historical-scores`); `CFBScheduleApp surface="admin"` retained for schedule rebuild, scores/odds refresh, alias editor, and owner CSV upload.
- **`/admin/season`** — `RolloverPanel`, `BackfillPanel`, `ArchiveListPanel`.
- **`/admin/diagnostics`** — `AdminUsagePanel`, `AdminTeamDatabasePanel`, `AdminStorageStatusPanel`, `DiagnosticsScorePanel`.
- **`/admin/leagues`** — unchanged (already existed).
- **Admin/Debug button and panel removed from league view entirely** — league view is now fully public-facing. `CFBScheduleApp` no longer references `adminAlertCount` or renders the Admin/Debug toggle. Fatal error link updated to `/admin/data`.
- **Owner Roster CSV Upload retained at `/admin/data`** as clearly labeled admin fallback.
- **`requireAdminAuthHeaders()` fixed** — now returns `{}` instead of throwing when no sessionStorage token; Clerk session cookie handles auth automatically for browser requests.

**Key architectural decisions:**

- Admin sub-pages are server components where possible (DraftSequencingPanel, ArchiveListPanel, DiagnosticsPage) — no client fetch needed when data is available at render time.
- `BackfillPanel` and `DiagnosticsScorePanel` are client components using `getAdminAuthHeaders()` for fetch calls.
- `DiagnosticsScorePanel` is a thin `'use client'` wrapper around `ScoreAttachmentDebugPanel` — `onStageAlias` stub directs users to `/admin/data` for alias operations (alias staging requires full CFBScheduleApp state machine).
- `HistoricalCachePanel` fills the gap identified in review: historical cache API routes existed but had no UI.
- All admin sub-page headers include `← Admin` back link for consistent navigation.

---

### Phase 6A — Clerk Auth Setup: Complete

**Status:** Complete. PR #216 open. Branch `claude/improve-thread-speed-v1YFg`.
**PROMPT_IDs:** P6A-CLERK-AUTH-v1, P6A-CLERK-AUTH-REVIEW-v1, P6A-CLERK-AUTH-FIX-v1, P6A-CLOSEOUT-v1

**Goals completed:**

- **`@clerk/nextjs` v7.0.8** installed with `--legacy-peer-deps` (React 19.1.0 peer conflict); `.npmrc` added to project root with `legacy-peer-deps=true` for Vercel compatibility.
- **`src/middleware.ts`**: `clerkMiddleware()` from `@clerk/nextjs/server` — never `authMiddleware()` (deprecated). `/admin/*` protected: unauthenticated → redirect `/login`; authenticated without `platform_admin` → redirect `/`. All other routes pass through.
- **`src/app/layout.tsx`**: `<ClerkProvider>` wraps body content.
- **`src/app/login/page.tsx`**: Clerk `<SignIn forceRedirectUrl="/admin" />` embedded — no custom form. Dark theme matching app.
- **`src/app/page.tsx` + `src/components/RootPageClient.tsx`**: Root route replaced — hardcoded `/league/tsc` redirect removed. Server component loads leagues from registry; `RootPageClient` uses `<Show when="signed-out">` for public landing and `<Show when="signed-in">` for admin league dashboard. `force-dynamic` set. No hardcoded slugs.
- **`src/lib/server/adminAuth.ts`**: `requireAdminAuth(req)` — checks Clerk JWT first (`sessionClaims.publicMetadata.role === 'platform_admin'`), falls back to `ADMIN_API_TOKEN` with Phase 7 removal comment. `requireAdminRequest` exported as `@deprecated` alias. All 25 existing API route call sites updated to `await requireAdminRequest(req)`.

**Key architectural decisions:**

- Three roles defined in Clerk `publicMetadata` from day one: `platform_admin`, `commissioner`, `member` — only `platform_admin` enforced in Phase 6.
- `<Show when="signed-in/out">` used throughout — deprecated `<SignedIn>`/`<SignedOut>` never used.
- `requireAdminAuth` checks Clerk JWT first; ADMIN_API_TOKEN fallback is temporary — remove in Phase 7.
- Admin dashboard reads leagues from registry at runtime — never hardcoded.
- **Manual step required post-deploy:** set `publicMetadata: { "role": "platform_admin" }` in Clerk Dashboard for first user. Cannot be done in code.

---

### Phase 5 — Draft / Owner Assignment Tool (P5A–P5D): Complete

**Status:** All subphases complete. PR #214 open. Branch `claude/improve-thread-speed-v1YFg`.

Key architectural decisions across Phase 5:

- **Draft state** persisted in `appStateStore`: scope `draft:${leagueSlug}`, key `${year}`
- **Snake draft order** computed on-demand from `draftOrder` — never stored per-pick
- **Timer is server-authoritative** — `timerExpiresAt` stored as ISO timestamp in `DraftState`; clients derive remaining time from it
- **Client expire dispatch** — `DraftBoardClient` fires `timerAction: 'expire'` when countdown reaches zero; guarded by `expireDispatchedRef` per pick
- **`effectiveBehavior`** — forces auto-pick when commissioner is in paused-expired overlay state regardless of `timerExpiryBehavior` setting
- **Auto-pick metric** respects draft settings: SP+ descending or preseason rank ascending; alphabetical tiebreak when metric unavailable
- **Team resolution for picks** uses `teamIdentity.ts` resolver with merged SEED_ALIASES + stored alias maps — no raw string equality
- **`DraftPick.team`** stores `resolution.canonicalName` (canonical school name string) — consistent with `parseOwnersCsv()` + `rosterByTeam` downstream ownership pipeline
- **Drafted teams hidden** from available teams panel entirely — not dimmed
- **Confirm writes same format as CSV upload** — `owners:${slug}:${year}` scope, `csv` key; `parseOwnersCsv()` / standings / rollover pipeline transparent
- **CSV upload preserved** as admin fallback — can override a confirmed draft without requiring a full reset
- **Draft card is informational only** — no recommendations, no color coding implying good/bad teams
- **Draft → ownership map → app**: downstream systems never depend on draft state directly; the confirmed CSV is the hand-off artifact

---

### P5D — Draft Summary and Confirmation

- **Status:** Complete. PR #214 open. Branch `claude/improve-thread-speed-v1YFg`.
- **PROMPT_IDs:** P5D-DRAFT-SUMMARY-v1, P5D-DRAFT-SUMMARY-REVIEW-v1, P5D-DRAFT-SUMMARY-FIX-v1, P5D-DRAFT-SUMMARY-FIX-REVIEW-v1, P5D-DRAFT-REOPEN-v1, P5D-DRAFT-REOPEN-REVIEW-v1, P5D-CLOSEOUT-v1
- **Goals completed:**
  - **`POST /api/draft/[slug]/[year]/confirm`**: Admin-gated. Derives expected pick count from FBS team count at runtime (never hardcoded): `teamsPerOwner = floor(fbsTeamCount / ownerCount)`, `totalExpectedPicks = teamsPerOwner * ownerCount`. Validates `picks.length === totalExpectedPicks` and all owners have equal counts (422 with formula in message if not). Generates RFC 4180 CSV — fields containing comma, double quote, or newline are quoted; embedded double quotes escaped by doubling (`"` → `""`). Writes to `owners:${slug}:${year}` scope, `csv` key — same format as CSV upload route. Advances `phase` to `complete`.
  - **`DELETE /api/draft/[slug]/[year]/confirm`**: Admin-gated. Validates `phase === 'complete'`. Sets phase back to `live`. Preserves all picks and does not remove the previously confirmed owner assignment from `appStateStore` — previous CSV remains in effect until commissioner confirms again.
  - **`/league/[slug]/draft/summary` (server page)**: Server component, `force-dynamic`. Derives interesting facts server-side from historical archives — league anniversaries at 2/5/10 seasons, top 3 rivalries via `selectTopRivalries`, returning champion from most recent archive. Passes only `facts: string[]` to client — avoids shipping large `SeasonArchive[]` to browser. Loads `allTeamNames` (FBS canonical, NoClaim excluded, alphabetical) for inline team picker.
  - **`DraftSummaryClient`**: Admin-gated via `hasStoredAdminToken()` + `useEffect` redirect + synchronous early return. Owner roster cards grid in draft order. Inline team picker per pick — excludes all other drafted teams; allows re-selecting the current pick's own team. Two-step Confirm Draft flow with irreversibility warning. Two-step Reopen Draft flow with "previous rosters remain in effect" warning; on success updates local draft state to `phase: 'live'`. Confirm section hidden when `phase === 'complete'`; Reopen section shown only when `phase === 'complete'`.
  - **`InterestingFactsPanel`**: Pure presentational. Renders `null` when `facts.length === 0`. Each fact as a bordered card in a `<ul>`.
  - **Draft board link**: "Draft Summary →" shown in commissioner board subtitle when `phase === 'complete'`.
- **Key architectural decisions:**
  - **Pick count derived at runtime** — `classification === 'fbs'` filter on `teams.json`; never hardcoded. NoClaim teams fill the FBS remainder not divisible by owner count.
  - **Per-owner count check** — equal team distribution enforced before confirmation; uneven counts blocked with 422.
  - **RFC 4180 CSV** — `csvField()` helper handles all edge cases; field quoting and double-quote escaping consistent with spec.
  - **Reopen does not clear owner assignment** — previous confirmed CSV remains in `appStateStore` until re-confirm; dialogue makes this explicit.
  - **Interesting facts are server-side only** — `deriveFacts()` runs in page server component; only `string[]` passed to `DraftSummaryClient`; avoids shipping archive data to browser.
  - **Admin gate is client-side** — sessionStorage not readable server-side; same pattern as `DraftBoardClient`.

---

### P5C — Live Draft Board

- **Status:** Complete. PR #213 open. Branch `claude/improve-thread-speed-v1YFg`.
- **PROMPT_IDs:** P5C-LIVE-DRAFT-BOARD-v1, P5C-LIVE-DRAFT-BOARD-REVIEW-v1, P5C-LIVE-DRAFT-BOARD-FIX-v1, P5C-LIVE-DRAFT-BOARD-FIX-REVIEW-v1, P5C-LIVE-DRAFT-BOARD-FIX-v2, P5C-LIVE-DRAFT-BOARD-FIX-v3, P5C-LIVE-DRAFT-BOARD-FIX-REVIEW-v2, P5C-CLOSEOUT-AND-P5D-KICKOFF-v1
- **Goals completed:**
  - **Redirect TODO resolved** (v1, Task 0): All four `/draft/setup` redirect targets in `DraftSettingsPanel.tsx` and `DraftSetupShell.tsx` updated to `/draft` now that the live board route exists.
  - **`POST /api/draft/[slug]/[year]/pick`** (v1, FIX-v1, FIX-v3): Admin-gated. Validates `phase === 'live'`. Resolves team name via `createTeamIdentityResolver` with SEED_ALIASES + stored alias map. Validates not already picked. Derives pick owner from snake draft formula. Advances `currentPickIndex`. Starts next pick timer if configured. Transitions to `complete` when all picks exhausted. `autoSelected: false` on manual picks.
  - **`POST /api/draft/[slug]/[year]/unpick`** (v1): Admin-gated. Validates phase in `live|paused|complete`. Removes last pick, decrements `currentPickIndex`, resets timer, sets `phase: 'live'`.
  - **`PUT /api/draft/[slug]/[year]/pick/[n]`** (v1, FIX-v1, FIX-v3): Admin-gated. Edits pick `n` (1-indexed) via resolver. Validates no conflict at other positions. Preserves `pickNumber/round/roundPick/owner`; updates `team`, `pickedAt`, clears `autoSelected`.
  - **`POST /api/draft/[slug]/[year]/reset`** (v1, FIX-v1, FIX-v2): Admin-gated. Validates phase in `live|paused|complete|preview`. Resets to `phase: 'setup'`, clears picks/timer. JSDoc corrected to say "setup" not "preview".
  - **`timerAction` on `PUT /api/draft/[slug]/[year]`** (v1, FIX-v1, FIX-v3): `start|resume` → `timerState: running` + new `timerExpiresAt`. `pause` → null expiry. `expire` → validated server-side then dispatches `pause-and-prompt` or `auto-pick` per `timerExpiryBehavior`; also accepted when `phase=paused` + `timerState=expired` (commissioner auto-pick overlay) — always forces auto-pick via `effectiveBehavior` in that state. `timerExpiresAt` null-check and timestamp validation only applied on live-expire path; timestamp/null checks skipped for paused-expired path. Auto-pick branches on `autoPickMetric`: SP+ descending or preseason rank ascending (unranked last); both fall back to alphabetical when metric data unavailable.
  - **`/league/[slug]/draft` (commissioner page)** (v1, FIX-v1, FIX-v3): Server component, `force-dynamic`. Redirects to `/draft/setup` when draft is null/setup/settings/preview. Loads SP+, win totals, schedule, AP poll, prior-year games + scores for `selectDraftTeamInsights`. Alias maps loaded from `appStateStore` directly — global `aliases:${year}` and league-scoped `aliases:${slug}:${year}` merged with SEED_ALIASES; no browser-oriented `loadAliasMap()` call. Prior-year alias maps use `priorYear` in both scope keys. Renders `DraftBoardClient` (1s polling).
  - **`/league/[slug]/draft/board` (spectator page)** (v1): Public server component. Waiting card for pre-live phases. Same insight data. Renders `SpectatorBoardClient` (3s polling, no pick controls, available teams sliced to 30).
  - **`DraftBoardClient`** (v1, FIX-v1, FIX-v3): `'use client'`, 1s polling. Redirects non-admins to spectator view via `useEffect` + synchronous `hasStoredAdminToken()`. Filters drafted teams from available panel entirely (not dimmed). Post-reset: detects `phase === 'setup'` in `onUpdate` → navigates to `/draft/setup`. Client-side expire dispatch: when countdown reaches zero and `phase=live`+`timerState=running`, dispatches `PUT { timerAction: 'expire' }` to server; guarded by `expireDispatchedRef` (reset on `timerExpiresAt` change or network error) to prevent double-dispatch. Hooks ordering violation fixed — polling effect moved before early return.
  - **`SpectatorBoardClient`**: `'use client'`, 3s polling. No admin actions, no pick panel. Shows current pick owner and available teams (undrafted only, top 30).
  - **`DraftBoardGrid`**: Snake draft grid. Correct column alignment for odd rounds: `posInRound = isEvenRound ? colIdx : n-1-colIdx`. Highlights current pick cell in blue. Amber text for auto-selected picks.
  - **`OwnerRosterPanel`**: Highlights current owner with blue border + "← picking" label.
  - **`TimerDisplay`**: Countdown derived from server-authoritative `timerExpiresAt`. Urgent styling ≤10s. Progress bar. Paused/expired states.
  - **`PickNavigator`**: On-the-clock + on-deck owners with round/pick numbers. Previous pick section (team, owner, `(auto)` label when `autoSelected`).
  - **`DraftControls`**: Commissioner-only. Start/pause/resume timer; undo last pick; reset with two-click confirm. Pause-and-prompt overlay. Auto-pick button calls `timerAction: 'expire'` from `paused+expired` state.
- **Key architectural decisions:**
  - **Server-authoritative timer** — `timerExpiresAt` stored as ISO timestamp in `DraftState`; clients derive countdown from `timerExpiresAt - Date.now()`. Expiry validated server-side before state changes; client signals expiry via `timerAction: 'expire'`, server validates and applies.
  - **Client-side expire dispatch** — `DraftBoardClient` fires `timerAction: 'expire'` when countdown reaches zero; guarded by ref to prevent double-dispatch per pick; polling recovers state on non-200 responses.
  - **Expire from paused-expired state** — auto-pick button in pause-and-prompt overlay sends `timerAction: 'expire'` when `phase=paused` + `timerState=expired`; server accepts and always resolves to auto-pick via `effectiveBehavior`; the live-expire timestamp guards are skipped on this path.
  - **Auto-pick metric** — `autoPickMetric` in `DraftSettings`; `sp-plus` (default) sorts by SP+ descending; `preseason-rank` loads rankings cache and sorts by rank ascending (unranked last); both fall back to alphabetical when metric data unavailable.
  - **Identity resolver in all pick routes** — `createTeamIdentityResolver` with merged SEED_ALIASES + stored alias map; no direct `teamsData` scans.
  - **Server-safe alias loading** — draft page reads alias maps from `appStateStore` (global `aliases:${year}` + league-scoped `aliases:${slug}:${year}`, merged with SEED_ALIASES); `loadAliasMap()` is browser-only and removed from server components.
  - **Admin gate is client-side at the board** — sessionStorage not readable server-side; `DraftBoardClient` redirects non-admins via `useEffect`.
  - **Prior year data is optional** — `selectDraftTeamInsights` degrades gracefully when prior-year cache is cold; `lastSeasonRecord` is `null`.
  - **Reset targets `phase: 'setup'`** — consistent with PUT phase transition; triggers full draft re-configuration on reset.

---

### P5C — Live Draft Board — Initial Implementation Details

- **Goals completed:**
  - **Redirect TODO resolved** (P5C-LIVE-DRAFT-BOARD-v1, Task 0): All four redirect targets in `DraftSettingsPanel.tsx` and `DraftSetupShell.tsx` updated from `/draft/setup` to `/draft` now that the live board route exists.
  - **`POST /api/draft/[slug]/[year]/pick`** (P5C-LIVE-DRAFT-BOARD-v1, P5C-LIVE-DRAFT-BOARD-FIX-v1): Admin-gated. Validates `phase === 'live'`. Resolves team name via `createTeamIdentityResolver` with SEED_ALIASES + stored alias map (F8 fix). Validates team not already picked. Derives pick owner from snake draft formula. Creates `DraftPick` with `autoSelected: false`. Advances `currentPickIndex`. Starts next pick timer if configured. Transitions to `phase: 'complete'` when all picks exhausted.
  - **`POST /api/draft/[slug]/[year]/unpick`** (P5C-LIVE-DRAFT-BOARD-v1): Admin-gated. Validates phase in `live|paused|complete`, picks non-empty. Removes last pick, decrements `currentPickIndex`, resets timer, sets `phase: 'live'`.
  - **`PUT /api/draft/[slug]/[year]/pick/[n]`** (P5C-LIVE-DRAFT-BOARD-v1, P5C-LIVE-DRAFT-BOARD-FIX-v1): Admin-gated. Validates pick `n` (1-indexed) exists. Resolves team via identity resolver (F8 fix). Validates no conflict at other positions. Updates pick preserving `pickNumber/round/roundPick/owner`; updates `team`, `pickedAt`, sets `autoSelected: false`.
  - **`POST /api/draft/[slug]/[year]/reset`** (P5C-LIVE-DRAFT-BOARD-v1, P5C-LIVE-DRAFT-BOARD-FIX-v1): Admin-gated. Validates phase in `live|paused|complete|preview`. Resets to `phase: 'setup'` (F1 fix — was `'preview'`), clears picks/timer.
  - **`timerAction` on `PUT /api/draft/[slug]/[year]`** (P5C-LIVE-DRAFT-BOARD-v1, P5C-LIVE-DRAFT-BOARD-FIX-v1): Accepts `start|pause|resume|expire`. `start`/`resume`: sets `timerState: 'running'`, new `timerExpiresAt`. `pause`: `timerState: 'paused'`, null expiry. `expire`: validates `phase === 'live'` and `timerExpiresAt` not null and timestamp past (F9 fix); dispatches `pause-and-prompt` or `auto-pick` behavior per `timerExpiryBehavior` setting. Auto-pick selects best available team by SP+ rating (alphabetical tiebreak) and advances the draft.
  - **`/league/[slug]/draft` (commissioner page)** (P5C-LIVE-DRAFT-BOARD-v1, P5C-LIVE-DRAFT-BOARD-FIX-v1): Server component, `force-dynamic`. Redirects to `/draft/setup` when draft is null/setup/settings/preview (F3 fix — preview added). Loads SP+, win totals, schedule, AP poll, and prior year games + scores for `selectDraftTeamInsights`. Renders `DraftBoardClient`. Prior year `lastSeasonRecord` computed via `buildScheduleIndex` + `attachScoresToSchedule` (F7 fix).
  - **`/league/[slug]/draft/board` (spectator page)** (P5C-LIVE-DRAFT-BOARD-v1): Public server component. Shows waiting card when draft is null/setup/settings. Loads same team insight data. Renders `SpectatorBoardClient` (3s polling, no pick controls, available teams sliced to 30).
  - **`DraftBoardClient`** (P5C-LIVE-DRAFT-BOARD-v1, P5C-LIVE-DRAFT-BOARD-FIX-v1): `'use client'`, 1s polling. Redirects non-admins to spectator board via `useEffect` (F2 fix — was read-only banner). Filters drafted teams from available panel entirely (F4 fix — was dimming). Post-reset redirect: detects `phase === 'setup'` in `onUpdate` callback and navigates to `/draft/setup` (F5 fix).
  - **`SpectatorBoardClient`**: `'use client'`, 3s polling. No admin actions, no pick panel. Shows current pick owner and available teams (undrafted only, top 30).
  - **`DraftBoardGrid`**: Snake draft grid. Rows = rounds, cols = owner headers (always owner[0..n-1] order). Correct column alignment for odd rounds: `posInRound = isEvenRound ? colIdx : n-1-colIdx`. Highlights current pick cell in blue. Amber text for auto-selected picks.
  - **`OwnerRosterPanel`**: Shows each owner's drafted teams. Highlights current owner with blue border + "← picking" label. Snake formula used to derive `currentOwnerIdx`.
  - **`TimerDisplay`**: Derives countdown from server-authoritative `timerExpiresAt` via `useEffect` interval. Urgent styling ≤10s. Progress bar. Shows paused/expired states.
  - **`PickNavigator`**: "On the clock" + "On deck" owners with round/pick numbers. Previous pick section shows last pick team, owner, and `(auto)` label when `autoSelected` (F6 fix).
  - **`DraftControls`**: Commissioner-only. Start/pause/resume timer; undo last pick; reset with two-click confirm. Pause-and-prompt overlay shows when `phase === 'paused' && timerState === 'expired'`; "Auto-pick" button calls `timerAction: 'expire'` to trigger server-side auto-pick.
- **Key architectural decisions:**
  - **Server-authoritative timer** — `timerExpiresAt` stored as ISO timestamp in draft state; client derives countdown from `timerExpiresAt - Date.now()`. Expiry validated server-side before state changes; client cannot trigger auto-pick early.
  - **Auto-pick via `timerAction: 'expire'`** — client signals expiry; server validates timestamp and applies pick. Same code path as manual expire keeps timer logic in one place.
  - **Admin gate is client-side at board level** — server can't read sessionStorage, so `DraftBoardClient` redirects non-admins to spectator view via `useEffect` + synchronous `hasStoredAdminToken()` check.
  - **Identity resolver used in all pick routes** — `createTeamIdentityResolver` with merged SEED_ALIASES + stored alias map is the canonical team resolution path; no direct `teamsData` scans.
  - **Reset targets `phase: 'setup'`** — consistent with PUT phase transition on `targetPhase === 'setup'`; ensures full draft re-configuration on reset.
  - **Prior year data passed as optional params** — `selectDraftTeamInsights` degrades gracefully when prior year cache is cold; `lastSeasonRecord` is null rather than blocking the page.

---

### P5B — Draft Setup and Settings

- **Status:** Complete. PR #211 open.
- **PROMPT_IDs:** P5B-DRAFT-SETUP-v1, P5B-DRAFT-SETUP-REVIEW-v1, P5B-DRAFT-SETUP-FIX-v1, P5B-DRAFT-SETUP-FIX-REVIEW-v1, P5B-DRAFT-SETUP-FIX-v2, P5B-DRAFT-SETUP-FIX-v3, P5B-DRAFT-SETUP-FIX-v4, P5B-CLOSEOUT-v1
- **Goals completed:**
  - **`src/lib/draft.ts`** (P5B-DRAFT-SETUP-v1): Shared type definitions — `DraftState`, `DraftSettings`, `DraftPick`, `DraftPhase`, `defaultDraftSettings()`, `draftScope()`. All draft state persisted in appStateStore at scope=`draft:${slug}`, key=`${year}`.
  - **`GET /api/draft/[slug]/[year]`** (P5B-DRAFT-SETUP-v1, P5B-DRAFT-SETUP-FIX-v1): Public read. Returns 404 when no draft exists. Validates slug in registry and year >= 2000.
  - **`POST /api/draft/[slug]/[year]`** (P5B-DRAFT-SETUP-v1, P5B-DRAFT-SETUP-FIX-v1): Admin-gated draft creation. Accepts `owners` + optional `settings`. Validates: owners min 2, settings.style='snake', pickTimerSeconds null or positive, totalRounds positive integer, draftOrder must match owners exactly when provided. Returns 409 if draft already exists. Sets initial phase to `'preview'` when `settings.scheduledAt` is a future date; `'setup'` otherwise.
  - **`PUT /api/draft/[slug]/[year]`** (P5B-DRAFT-SETUP-v1): Admin-gated. Updates owners, settings (merge), and/or phase. Validates phase transitions server-side against allowed transition table. Resets picks/timer on transition to 'setup'.
  - **`/league/[slug]/draft/setup` page** (P5B-DRAFT-SETUP-v1): Server component. Fetches league, existing draft state, prior year owners from most recent season archive (via `parseOwnersCsv(ownerRosterSnapshot)`), reverse-championship order from archive `finalStandings`, and FBS team count from `teams.json` for auto-suggesting rounds.
  - **`DraftSetupShell`** (P5B-DRAFT-SETUP-v1, P5B-DRAFT-SETUP-FIX-v4): Client shell component. Routes to `RosterSetupPanel`, `DraftSettingsPanel`, or preview card based on current `draftState.phase`. Preview→settings transition persists via API before updating local state (not client-only flip).
  - **`RosterSetupPanel`** (P5B-DRAFT-SETUP-v1, P5B-DRAFT-SETUP-FIX-v1): Auto-populates from prior year archive owners. Initialises to empty `[]` with dashed empty-state message when no prior archive. Add/remove/reorder owners. Validates min 2 before continuing. Creates draft via POST then advances to settings via PUT.
  - **`DraftSettingsPanel`** (P5B-DRAFT-SETUP-v1, P5B-DRAFT-SETUP-FIX-v4): Draft order (random/manual/reverse-championship), timer (none/30s/60s/90s/2min), expiry behavior (pause-and-prompt / auto-pick), auto-pick metric, total rounds (auto-suggested as `ceil(FBS / owners)`), optional scheduled start. Redirects to `/draft/setup` on preview or live transition (temporary — see redirect TODO below).
  - **Draft tab added to `WeekViewTabs`** (P5B-DRAFT-SETUP-v1): Links to `/league/${slug}/draft/setup`. Matches existing History tab style.
- **Key architectural decisions:**
  - **Phase transitions validated server-side** — no skipping; allowed transitions encoded in `VALID_PHASE_TRANSITIONS` map; 422 on invalid transition.
  - **POST accepts settings at creation time** — full settings validation on POST (not just PUT); draftOrder cross-validated against owners array on creation.
  - **Preview promoted at creation** — POST sets `phase: 'preview'` when `scheduledAt` is a future date; no separate promotion step needed.
  - **Back to Settings persists via API** — preview→settings transition calls PUT before updating local state; server state always reflects the true phase.
  - **RosterSetupPanel initialises empty** — `[]` not `['']` when no prior owners; clear empty-state message removes ambiguity.
- **⚠️ Redirect TODO for P5C:** All redirects in `DraftSettingsPanel.tsx` and `DraftSetupShell.tsx` currently point to `/league/${slug}/draft/setup` because the `/league/${slug}/draft` live board route does not exist until P5C. When the live draft board route is implemented, update all four redirect targets back to `/league/${slug}/draft`.

---

### P5A — Draft Data Infrastructure

- **Status:** Complete. PR #210 merged.
- **PROMPT_IDs:** P5A-DRAFT-DATA-INFRA-v1, P5A-DRAFT-DATA-INFRA-REVIEW-v1, P5A-IDENTITY-FIX-v1, P5A-CLOSEOUT-v1
- **Goals completed:**
  - **`POST /api/admin/cache-sp-ratings`** (P5A-DRAFT-DATA-INFRA-v1): Admin-gated endpoint that fetches SP+ ratings from CFBD `/ratings/sp?year=${year}` and caches in appStateStore at scope=`sp-ratings`, key=`${year}`. Returns `{ status: 'awaiting-ratings' }` gracefully when CFBD returns no data (ratings not yet published for the season) — does not write to store, does not error. Returns `{ alreadyCached: true }` on repeat call unless `force: true`. Adds `buildCfbdSpRatingsUrl` to `src/lib/cfbd.ts`.
  - **`GET/POST /api/admin/win-totals`** (P5A-DRAFT-DATA-INFRA-v1, P5A-IDENTITY-FIX-v1): GET returns stored win totals for a year (public). POST is admin-gated; parses `Team, WinTotalLow, WinTotalHigh` CSV and resolves team names via `createTeamIdentityResolver` with SEED_ALIASES + season alias map merged — the same pattern used in `odds/route.ts`. Unresolved teams reported in `unresolvedTeams` without blocking the upload. Writes to `appStateStore` scope=`win-totals`, key=`${year}`.
  - **`src/lib/selectors/draftTeamInsights.ts`** (P5A-DRAFT-DATA-INFRA-v1, P5A-IDENTITY-FIX-v1): Pure selector — no API calls, no side effects. Exports `DraftTeamInsights` type and `selectDraftTeamInsights()`. Derives: SP+ tier as relative quartiles across all FBS teams (top 25% = Elite, next 25% = Strong, next 25% = Average, bottom 25% = Weak); SOS tier as relative percentiles of avg opponent SP+ (top 30% = Hard, middle 40% = Medium, bottom 30% = Easy); home/away/neutral split from schedule; ranked opponent count from AP poll; last season record from optional `priorYearGames` + `priorYearScoresByKey` params (same pattern as `historySelectors.ts`). Provider team names (SP+ ratings, AP poll) resolved to canonical school names via `providerToCanonical` map built from `teams[].alts[]` before keying lookup maps. NoClaim filtered from output.
  - **`src/components/draft/DraftCard.tsx`** (P5A-DRAFT-DATA-INFRA-v1): Compact team card. Absent fields omitted entirely — no placeholders, no dashes. SP+ tier shown as neutral slate badge (no good/bad colors). "Ratings pending" in muted text when `awaitingRatings`. "Drafted" overlay when `isDrafted`. Hover ring + cursor-pointer when `onSelect` provided (commissioner view). No recommendation language.
  - **`SpRatingsCachePanel` + `WinTotalsUploadPanel`** added to `/admin/` page (P5A-DRAFT-DATA-INFRA-v1): SP+ panel has year input, cache trigger button, `alreadyCached` state with force-refresh option, `awaiting-ratings` amber message. Win totals panel has year input, CSV textarea, resolved count + unresolved team list on result. Both follow existing admin panel patterns.
- **Key architectural decisions:**
  - **awaiting-ratings is not an error** — SP+ ratings are typically published in preseason; the endpoint must handle early calls gracefully without polluting the cache with empty data.
  - **Win total upload uses full identity resolver** — same SEED_ALIASES + stored alias map merge used in `odds/route.ts`; sportsbook name variants are covered by the same alias infrastructure.
  - **Selector is pure** — all external data (SP+, AP poll, win totals, schedule, prior year games) passed as params by the caller; the selector never fetches. `lastSeasonRecord` null when `priorYearGames` not passed; degrades gracefully.
  - **Provider name canonicalization via alts[]** — SP+ and AP poll provider names resolved to canonical school names using `teams[].alts[]` before building lookup maps; no new matching logic introduced.
  - **DraftCard absent = absent** — spec explicitly requires no placeholder UI for missing data fields; each conditional block simply omits the element.

---

### P4D Polish, Backfill, and Historical Data Infrastructure

- **Status:** Complete. PR #207 merged.
- **PROMPT_IDs:** P4-HISTORICAL-SCHEDULE-CACHE-v1, P4-HISTORICAL-SCORES-CACHE-v1, P4-BACKFILL-v1, P4D-HISTORY-POLISH-v1, P4D-HISTORY-LAYOUT-v1, P4D-HISTORY-BANNER-v1, P4D-NOCLAIM-FIX-v1
- **Goals completed:**
  - **`POST /api/admin/cache-historical-schedule`** (P4-HISTORICAL-SCHEDULE-CACHE-v1): Admin-gated endpoint that fetches both regular and postseason CFBD schedule for a specified past year and writes a combined `CacheEntry` to `appStateStore` at scope=`schedule`, key=`${year}-all-all` — the exact key `buildSeasonArchive` reads as its primary cache lookup. Returns `{ alreadyCached: true }` if entry already exists (skippable with `force: true`). Rejects active season year. Graceful 502 on CFBD failure.
  - **`POST /api/admin/cache-historical-scores`** (P4-HISTORICAL-SCORES-CACHE-v1): Admin-gated endpoint that fetches both regular and postseason scores for a specified past year and writes two `CacheEntry` records at scope=`scores`, keys=`${year}-all-regular` and `${year}-all-postseason` — the exact keys `buildSeasonArchive` reads. Both must exist for `alreadyCached: true` to trigger. Companion to schedule cache endpoint; together they enable full historical season backfill.
  - **`POST /api/admin/backfill`** (P4-BACKFILL-v1): Admin-gated backfill endpoint. Builds and saves a `SeasonArchive` for a specified past year via `buildSeasonArchive` without calling `updateLeague` or advancing the active season year. Two-phase confirmation for overwrites: first call returns `{ requiresConfirmation: true, diff }`; second call with `confirmed: true` performs the overwrite.
  - **2021–2024 seasons backfilled:** Real roster, schedule, and score data loaded via the cache and backfill endpoints for all prior seasons. Historical league data is now live on the history landing page.
  - **All-time standings sort fix** (P4D-HISTORY-POLISH-v1): `selectAllTimeStandings` now sorts by championships desc → win percentage desc → total wins desc. Win percentage (`winPct`) added to `AllTimeStandingRow` type; computed after all wins/losses are accumulated (including live merge), normalizing for tenure length and roster size. Handles division by zero.
  - **NoClaim removed from all history views** (P4D-HISTORY-POLISH-v1, P4D-NOCLAIM-FIX-v1): NoClaim excluded from `selectAllTimeStandings` (archive iteration and live merge), `selectDynastyAndDrought`, `selectMostImprovedSeasonOverSeason`. `selectOwnerCareer` no longer short-circuits for NoClaim — real season records are returned if they exist; NoClaim excluded from H2H opponent matrix only. `selectAllTimeHeadToHead` and `selectTopRivalries` inherit NoClaim exclusion from `selectHeadToHead` (pre-existing).
  - **Win% column in AllTimeStandingsTable** (P4D-HISTORY-POLISH-v1): `Win%` column added between Record and Titles, showing `(winPct * 100).toFixed(1)%`.
  - **60/40 asymmetric two-column layout** (P4D-HISTORY-LAYOUT-v1): History landing page uses `lg:grid-cols-5` — left column `lg:col-span-3` (AllTimeStandingsTable + SeasonListPanel), right column `lg:col-span-2` (TopRivalries + MostImproved + DynastyDrought). ChampionshipsBanner spans full width above. Single column on mobile.
  - **History tab in league nav bar** (P4D-HISTORY-POLISH-v1): `WeekViewTabs` accepts `leagueSlug?: string` and renders a History `<Link>` tab pointing to `/league/${slug}/history/`. `CFBScheduleApp` passes `leagueSlug` prop to `WeekViewTabs`.
  - **Live season standings merged into all-time totals** (P4D-HISTORY-POLISH-v1): `selectAllTimeStandings` accepts optional `liveStandings?: StandingsRow[]`. History page calls `buildSeasonArchive` for the active year (try/catch fallback) if not yet archived; live wins/losses merged into totals without crediting a championship or incrementing `seasonsPlayed`. `AllTimeStandingsTable` shows "Includes live {year} season (in progress)" indicator when live data is present. Year derived from `league.year` — not hardcoded.
  - **Season in Progress banner card** (P4D-HISTORY-BANNER-v1): `ChampionshipsBanner` accepts `currentSeasonYear?: number` and `currentLeader?: string`. Renders a neutral-styled card (gray/white border, distinct from amber champion card) showing the active year, current standings leader (first non-NoClaim owner in live standings), labeled "Current Leader". No card when props absent.
- **Key architectural decisions:**
  - **Historical cache endpoints are quota-safe** — `alreadyCached` check prevents repeat CFBD calls; `force: true` allows intentional overwrite. Active season year rejected to prevent interference with the live cache path.
  - **Backfill never advances the season year** — `updateLeague` is not imported in the backfill route; file-level comment explicitly prohibits it.
  - **Live standings via buildSeasonArchive** — reuses existing battle-tested assembly path rather than reimplementing standings derivation. try/catch ensures the history page degrades gracefully if caches are cold.
  - **NoClaim exclusion is view-level, not data-level** — archives are stored as-is; NoClaim is filtered in selectors at the point of display. `selectOwnerCareer` preserves raw data for NoClaim in case it appears as a legitimate archive entry.

---

### Historical Season Backfill Endpoint

- **Status:** Complete. Merged as part of P4D PR.
- **PROMPT_IDs:** P4-BACKFILL-v1
- **Goals completed:**
  - **`POST /api/admin/backfill`** (P4-BACKFILL-v1): New admin-gated endpoint at `src/app/api/admin/backfill/route.ts`. Accepts `{ leagueSlug, year, confirmed? }`. Validates leagueSlug (non-empty string) and year (finite integer >= 2000). Returns 404 if league not found in registry. Two-phase confirmation flow: first call without `confirmed` returns `{ requiresConfirmation: true, diff }` via `diffSeasonArchives` — no write; second call with `confirmed: true` overwrites and returns `{ success: true, replaced: true }`. If no existing archive, builds and saves immediately (`replaced: false`). Schedule cache unavailable surfaced as `500` with the descriptive error message from `buildSeasonArchive`.
- **Key architectural decisions:**
  - **No year increment** — `updateLeague` is not imported; file-level comment explicitly prohibits it. This is a backfill-only operation; the active season year is never touched.
  - **Two-phase confirmation for overwrites** — diff is computed and returned before any write; admin must send `confirmed: true` to overwrite an existing archive.
  - **Schedule cache required** — `buildSeasonArchive` throws a clear error if the schedule cache is unavailable for the requested year; the endpoint surfaces it as 500 with the message rather than silently failing.

---

### P4D — League History and Owner Career UI

- **Status:** Complete. PR #204 merged.
- **PROMPT_IDs:** P4D-KICKOFF-v1, P4D-LEAGUE-HISTORY-UI-v1, P4D-LEAGUE-HISTORY-UI-REVIEW-v1, P4D-LEAGUE-HISTORY-UI-FIX-v1, P4D-BACKFILL-REVIEW-v1, P4D-LEAGUE-HISTORY-UI-FIX-v2, P4D-BUGS-v1
- **Goals completed:**
  - **Cross-season selectors** (P4D-LEAGUE-HISTORY-UI-v1): Seven new pure selectors added to `src/lib/selectors/historySelectors.ts` — `selectAllTimeStandings`, `selectChampionshipHistory`, `selectAllTimeHeadToHead`, `selectTopRivalries`, `selectDynastyAndDrought`, `selectMostImprovedSeasonOverSeason`, `selectOwnerCareer`. No modifications to the four existing single-season selectors. All seven are pure functions — no API calls, no side effects.
  - **League History Landing** (P4D-LEAGUE-HISTORY-UI-v1): New server component at `/league/[slug]/history/`. Fetches all archived years via `listSeasonArchives`, loads all archives in parallel. Renders: championships banner, all-time standings table (with career page links), season list, most improved panel, dynasty/drought panel, top rivalries panel. Empty state: "League history isn't available yet. Check back next offseason." 404 if league not found.
  - **Owner Career Page** (P4D-LEAGUE-HISTORY-UI-v1): New server component at `/league/[slug]/history/owner/[name]/`. `params.name` used directly — no `decodeURIComponent` (Next.js App Router already decodes route params). Renders: career summary card (record, championships, avg finish, seasons), season finish history table (season, finish, record, GB), all-time H2H panel with progressive per-season disclosure. Friendly empty state if owner not found in any archive.
  - **Nine new history components** (P4D-LEAGUE-HISTORY-UI-v1): `ChampionshipsBanner`, `AllTimeStandingsTable`, `SeasonListPanel`, `MostImprovedPanel`, `DynastyDroughtPanel`, `AllTimeHeadToHeadPanel`, `CareerSummaryCard`, `SeasonFinishHistory`, `AllTimeOwnerHeadToHeadPanel`.
  - **Back link fix** (P4D-LEAGUE-HISTORY-UI-v1): Both back links in `history/[year]/page.tsx` (archive-found and archive-missing states) updated from `/league/${slug}/` to `/league/${slug}/history/`. TODO comments removed.
  - **Fix round** (P4D-LEAGUE-HISTORY-UI-FIX-v1 + FIX-v2): Missing career page links added to `AllTimeHeadToHeadPanel`, `DynastyDroughtPanel`, `MostImprovedPanel` (slug prop added to latter two); Games Back column added to `SeasonFinishHistory` (`gamesBack` added to `OwnerSeasonRecord` type and populated from `finalStandings`); empty state copy corrected to match spec; `AllTimeHeadToHeadPanel` slug destructuring bug fixed (slug was in Props but not destructured — produced `/league/undefined/...` URLs).
  - **Bug fixes** (P4D-BUGS-v1): Removed double `decodeURIComponent` on owner route param (Next.js already decodes; double-decode throws `URIError` for names containing `%`). Fixed rivalry lead/trail/tied label in expanded detail — now correctly names the leader first with record flipped when ownerB leads; shows "Series tied" when record is equal.
- **Key architectural decisions:**
  - **Seven pure cross-season selectors** — all accept `SeasonArchive[]` and return plain data; no modifications to existing single-season selectors (`selectFinalStandings`, `selectOwnerRoster`, `selectSeasonSuperlatives`, `selectHeadToHead`).
  - **Owner identity is name-based across seasons** — same name = same career entry; name change = separate entry. Known limitation (Decision 1 from design doc). No persistent owner ID introduced.
  - **Same-owner pairings excluded from all H2H and rivalry selectors** — inherited from `selectHeadToHead` which guards `awayOwner === homeOwner`.
  - **Route params already decoded** — Next.js App Router decodes route params before the page component receives them; `decodeURIComponent` must not be applied again.
  - **Rivalry lead label always names the leader first** — when ownerB is ahead, the record is flipped so the display reads "[leader] leads [winner_count]–[loser_count]" regardless of lexicographic ordering.
  - **Back links point to history landing** — `/league/${slug}/history/` is the canonical back destination from season detail pages; the temporary `/league/${slug}/` links and TODO comments are fully removed.
- **Optional follow-up (not scheduled):**
  - Owner identity system (stable cross-season IDs mapping display names to persistent IDs).
  - Season comparison views.
  - All-time H2H matrix in a dedicated expandable section rather than the toggle-based panel.

---

### Roster Upload Fuzzy Matching

- **Status:** Complete. PRs #202–#203 merged.
- **PROMPT_IDs:** P4-ROSTER-UPLOAD-FUZZY-MATCH-DOCS-v1, P4-ROSTER-UPLOAD-FUZZY-MATCH-v1, P4-ROSTER-UPLOAD-FUZZY-MATCH-REVIEW-v1, P4-ROSTER-UPLOAD-FUZZY-MATCH-FIX-v1, P4-ROSTER-UPLOAD-FUZZY-MATCH-FIX-v2
- **PRs merged:** #202 (docs), #203 (implementation + fixes)
- **Goals completed:**
  - **`rosterUploadValidator.ts`** (P4-ROSTER-UPLOAD-FUZZY-MATCH-v1): New pure validation lib. `getFBSTeams(teams)` filters team catalog to FBS-only pool via `inferSubdivisionFromConference` — FCS teams never included. `findFuzzyMatch(inputName, fbsTeams)` implements Levenshtein distance + token overlap scoring with a conservative 0.65 confidence threshold. `validateRosterCSV(csvText, existingAliases, teams)` applies exact → alias → fuzzy resolution priority; exact lookup includes the full `alts[]` array from teams.json for broad abbreviation coverage without fuzzy.
  - **`globalAliasStore.ts`** (P4-ROSTER-UPLOAD-FUZZY-MATCH-v1): New server-side global alias storage at `aliases:global / map`. `getGlobalAliases()`, `upsertGlobalAliases()`. `migrateYearScopedAliasesToGlobal()` performs a one-time exhaustive migration using `listAppStateKeys()` to discover all alias scopes across a year range (year−10 to year+1) for every known league slug — not just the single active year. Migration sentinel recorded after all scopes are processed. Idempotent — subsequent calls are immediate no-ops.
  - **`POST /api/owners/validate`** (P4-ROSTER-UPLOAD-FUZZY-MATCH-v1): New admin-gated endpoint at `src/app/api/owners/validate/route.ts`. Returns `RosterValidationResult + fbsTeams[]` for the admin UI. No writes of any kind.
  - **`PUT /api/owners` safety guard** (P4-ROSTER-UPLOAD-FUZZY-MATCH-v1): Server-side validation runs before every PUT — rejects with HTTP 400 and `unresolvedTeams` list if any team name cannot be resolved against FBS names and existing aliases. Enforced independently of the UI.
  - **`?scope=global` aliases support** (P4-ROSTER-UPLOAD-FUZZY-MATCH-v1, FIX-v1): `GET /api/aliases?scope=global` reads the global alias store; lazy migration triggered on first read. `PUT /api/aliases?scope=global` patches the global alias store. Year and league params ignored for global scope.
  - **`RosterUploadPanel.tsx`** (P4-ROSTER-UPLOAD-FUZZY-MATCH-v1): New three-phase admin upload component. Phase 1: league/year selector, file picker, validate button → POST to validate endpoint. Phase 2 (review): Confirmed section (collapsible, exact and alias matches), Needs Confirmation section (fuzzy suggestions with confidence indicator, confirm/override per item), No Match Found section (full FBS team picker with typeahead + alphabetical). Progress indicator. Complete Upload disabled until all items resolved. Phase 3: success message with team count and alias count. Added to `/admin/` page above `CFBScheduleApp`.
  - **Persistent upload error** (P4-ROSTER-UPLOAD-FUZZY-MATCH-FIX-v2): `uploadError` moved to a phase-agnostic render position with a "Try again" button — auto-upload failures (isComplete: true path) now surface immediately without requiring the admin to enter the review phase.
- **Key architectural decisions:**
  - **Upload-layer only** — fuzzy matching lives in the upload validation pipeline; `teamIdentity.ts` is unchanged. Schedule and game identity resolution are unaffected.
  - **FBS-only match pool** — `getFBSTeams()` is the hard boundary; FCS teams are never reachable regardless of input.
  - **`alts[]` in exact lookup** — common abbreviations (e.g., team.json entries like "App St", "Boise St") resolve as exact matches, not fuzzy, reducing unnecessary confirmation prompts.
  - **Global alias store** — confirmed fuzzy matches and manual selections are global (no league or year scoping); apply to all future uploads across all leagues and years. Legacy year-scoped aliases deprecated.
  - **Exhaustive lazy migration** (FIX-v2): Migration scans all league slug × year combinations via `listAppStateKeys()` rather than the single active year — ensures multi-year, multi-league alias history is fully migrated before the sentinel is written.
  - **Conservative confidence threshold** — 0.65; prefers returning null over a low-confidence suggestion. No-match items go to the manual FBS picker.
  - **Double-enforced upload guard** — UI prevents submission until `isComplete: true`; server-side PUT handler verifies independently.
- **Optional follow-up (not scheduled):**
  - Further fuzzy algorithm tuning based on observed real-world upload patterns.
  - Admin alias management page for reviewing and editing global aliases directly.

---

### Phase 4C — Season Detail UI

- **Status:** Complete. PR #201 merged.
- **PROMPT_IDs:** P4C-SEASON-DETAIL-UI-v1, P4C-ARCHIVE-DATA-MODEL-FIX-v1, P4C-ARCHIVE-DATA-MODEL-FIX-REVIEW-v1, P4C-ARCHIVE-DATA-MODEL-FIX-v2, P4C-LINT-FIX-v1, P4C-BUGS-v1, P4C-CLOSEOUT-v1
- **PRs merged:** #201
- **Goals completed:**
  - **`SeasonArchive` data model extension** (P4C-ARCHIVE-DATA-MODEL-FIX-v1): Added `games: AppGame[]` and `scoresByKey: Record<string, ScorePack>` to the `SeasonArchive` type in `src/lib/seasonArchive.ts`. Updated `buildSeasonArchive` in `src/lib/seasonRollover.ts` to include both fields in the returned archive. Required to enable game-pairing-level selectors (superlatives, H2H) — `StandingsHistory` alone does not store individual game pairings.
  - **Null guards for legacy archives** (P4C-ARCHIVE-DATA-MODEL-FIX-v2): Added `?? []` and `?? {}` at both selector consumption points in `historySelectors.ts` so archives written before the data model extension do not crash with `TypeError: undefined is not iterable`.
  - **`historySelectors.ts`** (P4C-SEASON-DETAIL-UI-v1): New selector file at `src/lib/selectors/historySelectors.ts`. Exports `selectFinalStandings`, `selectOwnerRoster`, `selectSeasonSuperlatives`, `selectHeadToHead`. `selectSeasonSuperlatives` derives 6 superlatives from game data: highest single-week score, biggest blowout, closest matchup, biggest upset (pre-game standings-based), most dominant stretch (consecutive wins), most improved (Week 1 to final rank). `selectHeadToHead` derives per-owner-pair W-L records and matchup details; `ownerA` is always lexicographically smaller; wins/losses from ownerA's perspective.
  - **Season detail page** (P4C-SEASON-DETAIL-UI-v1): New server component at `src/app/league/[slug]/history/[year]/page.tsx`. Validates year (>= 2000), looks up league from registry, reads archive via `getSeasonArchive`. Renders friendly "no archive" state with back link for missing seasons (with note that historical data starts from 2025). Back links point to `/league/${slug}/` with TODO comment to update to P4D history landing once that route exists.
  - **History components** (P4C-SEASON-DETAIL-UI-v1): 6 new components under `src/components/history/` — `ArchiveBanner` (amber "Archived — {year} Season" banner), `FinalStandingsTable` (rank/owner/record/GB/diff table), `SeasonArcChart` (client component wrapping `MiniTrendsGrid`), `SuperlativesPanel` (6 superlative cards with "Not available" fallbacks), `HeadToHeadPanel` (collapsible owner-pair rows with matchup detail expansion), `OwnerRosterCard` (team → owner grid from ownerRosterSnapshot).
  - **Bug fixes** (P4C-BUGS-v1): Added `awayOwner === homeOwner` exclusion guard in `getOwnedFinalGames` to prevent same-owner matchups from contaminating blowout/closest/H2H derivation. Fixed back links that pointed to unbuilt P4D route (consistent 404).
  - **Lint fix** (P4C-LINT-FIX-v1): Removed unused `ownerB` variable assignment in `selectHeadToHead` — confirmed not a logic bug; `pairingKey()` independently derives canonical ordering.
- **Key architectural decisions:**
  - **`StandingsHistory` gap** — `StandingsHistory` stores cumulative per-owner stats, not individual game pairings. Game-pairing data must come from `archive.games + archive.scoresByKey`. These were added to `SeasonArchive` rather than modifying `StandingsHistory` to avoid changing the charting data model.
  - **`NoClaim` exclusion** — `NO_CLAIM_OWNER = 'NoClaim'` sentinel is excluded from all game-pairing-level derivation to prevent unclaimed teams from appearing in superlatives or H2H.
  - **Biggest upset "pre-game" rank** — uses `byWeek[weeks[weekIdx - 1]]` (prior week standings) as the pre-game rank proxy; Week 1 games are excluded because no prior week exists.
  - **H2H canonical ordering** — `ownerA` is always lexicographically smaller; `pairingKey = ownerA::ownerB`; wins/losses from ownerA's perspective throughout.
  - **Null guards for backward compatibility** — `archive.games ?? []` and `archive.scoresByKey ?? {}` ensure the page does not crash when rendering archives written before the model extension; old archives render all game-derived panels as "Not available."
- **Optional follow-up (not scheduled):**
  - Update back links to `/league/${slug}/history/` once P4D history landing page is implemented (TODO comments left in page.tsx).
  - Owner career links from `OwnerRosterCard` once P4D owner career pages exist.

### Navigation, CTA Consistency & History Chrome (standalone)

**Navigation & Selector Integrity**

- Fixed matchup deep links in OverviewPanel and StandingsPanel to use league-scoped routes (`/league/[slug]/matchups`) instead of unsupported `?view=matchups` query params
- Fixed trends CTAs in OverviewPanel and StandingsPanel to use league-scoped routes (`/league/[slug]/standings?view=trends#trends`) instead of hardcoded root-scoped paths
- Retired `leagueHighlights` from `selectOverviewViewModel` — was producing an empty array with no consuming UI
- Removed TEMP-DIAG console logs from OverviewPanel.tsx

**CTA Consistency**

- Removed redundant "See full trends" CTA from Standings page — user is already viewing full trends content
- Replaced Trends section CTA with linked section header on Overview page
- Standardized all Overview page CTAs to plain text ↗ pattern matching "All results ↗"
- Removed `onViewStandings` prop from OverviewPanel after its consuming button was replaced with a Link

**History Page Chrome**

- Created `LeaguePageShell.tsx` — shared server-compatible league chrome component for standalone route pages
- Replaced standalone History page chrome (back link, h1, subtitle) with consistent league header and nav bar
- Added History as a separated muted tab in the main league nav with a vertical divider before it
- History page subtitle set to "Est. 2021" instead of active season year
- Removed "4 archived seasons" text from History page
- `foundedYear` identified as a Phase 7 commissioner settings field — hardcoded for now, to be made dynamic when league settings are built
- `LeaguePageShell` noted as a known duplication point with CFBScheduleApp header — to be reconciled in Phase 7

**Follow-up Fixes**

- Created `/league/[slug]/members/page.tsx` — Members was a client-side-only view mode with no dedicated route, causing LeaguePageShell Members tab to land on Overview instead. New route mirrors the Matchups/Standings pattern and renders CFBScheduleApp with `initialWeekViewMode="owner"`. All five nav tabs now have proper dedicated routes.
- Fixed Members tab href in `LeaguePageShell.tsx` to `/league/[slug]/members`

---

### Overview Page Polish (standalone)

**De-containerization**

- Removed outer card wrappers from Standings, Insights, Featured games, and GB Race sections
- Individual game cards retain borders — they are discrete objects
- Horizontal dividers replace card borders as section separators
- Season podium retains card treatment — amber border is doing meaningful visual work

**Podium redesign**

- Replaced mixed layout (wide #1 card + two half-width cards below) with three equal horizontal cards
- #1 card gets amber border and amber rank label — amber reserved exclusively for champion signals
- #2 and #3 get neutral borders and plain muted rank labels
- Removed narrative text from all podium cards — data speaks for itself
- Removed "Season podium" section title — self-evident from content
- Removed CHAMPION badge from Overview standings rows — podium handles champion signal

**Standings section restructure**

- Converted to trifold layout: Standings (25%) · AP Poll (25%) · Insights (50%)
- Removed column headers from Overview standings table — self-evident at this density
- Reordered standings row hierarchy: rank · name · record · GB on primary line, Win% · Diff on secondary line
- GB elevated to primary line — most important metric in a pool format
- Added inline last-5-weeks position delta columns to standings rows (Option A: week headers once at top)
- Removed CHAMPION badge from standings rows — redundant with podium above

**Champion narrative copy fix**

- Fixed champion margin narrative to use games back as primary descriptor
- Win% is a tiebreaker — no longer used as the margin of victory descriptor
- Correct: "Won the title by 7 games over Maleski"

**Owner color system**

- Created src/lib/ownerColors.ts as shared owner color utility
- getOwnerColor(ownerName) is now the sole source of owner color across the entire app
- Replaced position-based alphabetical color assignment with hardcoded name-to-color lookup
- Colors are now stable and consistent across all surfaces — chart lines, table legends, rank numbers
- Owner names are color-coded only when the table serves as a legend for an adjacent chart

**GB Race section**

- Renamed from "Trends" to "GB Race"
- Removed inline chart line labels — companion table serves as legend
- Reverted to top 5 lines on Overview — 14 lines too cluttered at this surface
- Added companion table showing GB change over last 5 weeks with current GB column
- Owner names color-coded in companion table to match chart lines

**AP Poll column**

- Added AP Poll snapshot as middle column of trifold
- Shows top 10 teams with week-over-week movement indicators
- Switches to CFP Rankings during postseason, back to AP at season end
- "Full rankings ↗" CTA links to FBS Polls page
- Fixed movement delta bug — was showing NR for all teams due to reference equality failure in previous week lookup
- Fixed week label alignment — converted to CSS grid so headers stay pinned to delta columns at all viewport widths

**DESIGN.md updates**

- Containerization rules
- Owner color encoding rules
- Podium design rules
- Champion narrative copy rules
- Section header rules
- Overview trifold layout
- Poll phase logic (inSeason → AP, postseason → CFP, complete → AP)

---

### Light Mode & Owner Color System (standalone)

**Light/dark mode foundation**

- Removed hardcoded className="dark" from layout.tsx
- Switched Tailwind darkMode from class-based to media strategy (prefers-color-scheme)
- Updated globals.css to use @media (prefers-color-scheme: dark) for CSS variables
- Landing page (RootPageClient.tsx) converted to theme-aware classes
- All card surfaces, borders, nav elements, and text hierarchy fixed for light mode
- Dark mode appearance unchanged throughout

**Owner color architecture**

- Deleted dead file src/app/trends/presentationColors.ts
- Rewrote ownerColors.ts with dynamic index-based palette (20 colors) supporting variable owner counts
- Centralized color map construction in CFBScheduleApp.tsx using canonical standings owner list
- Single ownerColorMap built once and passed as prop to all consuming components: StandingsPanel, OverviewPanel, MiniTrendsGrid, TrendsDetailSurface
- SeasonArcChart builds its own local map (isolated from app shell, correct deviation)
- Added isDark state with window.matchMedia listener so color map updates when system preference changes
- Removed all local buildOwnerColorMap() calls from consuming components

**Owner color palette**

- PALETTE_DARK: 20-color Tableau-derived palette optimized for dark backgrounds, vivid and distinct
- PALETTE_LIGHT: 20-color independently designed palette of rich saturated mid-lightness colors optimized for white backgrounds
- Both palettes designed for maximum perceptual separation across 20 slots
- Light and dark palettes are independent — each optimized for its own background, not required to match each other
- Assignment is alphabetical-index-based within each league for stable consistent color per owner
- Fallback: hash-based assignment for owners not in the sorted list

**Known limitations / future work**

- Dimmed chart lines in light mode (non-selected owners) are faint on white — opacity values tuned for dark mode
- Some color adjacency remains between a few owners at 14+ lines — inherent to the problem, mitigated by interactive hover/highlight
- User preference override (light/dark toggle) deferred until user accounts are built
- When user accounts land: switch Tailwind back to class strategy, add theme provider, store preference in user settings

---

### P7A-1 — Founded Year (Phase 7A)

**Data model**

- Added foundedYear?: number to the League type in src/lib/league.ts
- Auto-populated on league creation from current year — no commissioner input required
- PATCH /api/admin/leagues/[slug] now accepts and validates foundedYear (must be >= 1900, <= current year)

**Settings UI**

- Added Founded Year field to LeagueSettingsForm — editable number input
- Field pre-populates from saved value or current year if not yet set
- Helper text removed — field is self-explanatory

**History page**

- LeaguePageShell renders "Est. {foundedYear}" as subtitle when activeTab is history
- Subtitle only renders when foundedYear is explicitly set — no misleading fallback
- Added force-dynamic to history/page.tsx to prevent Next.js caching stale league data
- Fixed bug: second LeaguePageShell render path (main content) was missing foundedYear prop — only the empty state path had it
- TSC League foundedYear set to 2021 in production

**Debugging notes**

- Root cause of rendering failure: one of two render paths in history/page.tsx was missing the prop due to a partial find-and-replace during implementation
- Confirmed via Vercel function logs showing foundedYear: undefined in LeaguePageShell
- Diagnostic API route and console.logs removed before merge

---

### Phase 7A — Commissioner Self-Service

**PROMPT_IDs:** P7A-1-FOUNDED-YEAR-v1, P7A-1-FOUNDED-YEAR-FIX-v1 through v3, P7A-1-FOUNDED-YEAR-CLEANUP-v1 through v3, P7A-2-LEAGUE-HUB-STATUS-v1, P7A-3-ADMIN-POLISH-v1, P7A-3-FIX, P7A-4, P7A-4-FIX, P7A-4-FIX-2

**foundedYear field (P7A-1)**

- Added optional `foundedYear?: number` to League type
- Auto-populated on league creation from current year
- Editable in league settings via PATCH API (validated 1900–current year)
- History page subtitle shows "Est. {foundedYear}" when set, nothing when unset
- Bug fix: second LeaguePageShell render path was missing the prop due to partial find-and-replace

**League hub improvements (P7A-2)**

- LeagueStatusPanel surfaced on league hub (`/admin/{slug}`) above tool cards
- Setup progress checklist: league created, owners configured, draft confirmed, season live — incomplete steps link to relevant tools
- Settings card restored to Platform Admin hub commissioner tools
- Post-creation redirect sends commissioner to league hub instead of staying on leagues list

**Admin light mode (P7A-3)**

- All 10 admin shared components converted from hardcoded dark-only classes to theme-aware light/dark variants
- All 8 admin page files similarly fixed
- Pattern: bg-white/dark:bg-zinc-900 backgrounds, border-gray-200/dark:border-zinc-700 borders, text-gray-900/dark:text-zinc-100 text

**Aliases promoted to platform scope (P7A-4)**

- New `/admin/aliases` page loads and saves from `aliases:global` scope
- Aliases card added to Platform Admin hub
- Alias section removed from league Data page (replaced with redirect notice)
- Data card removed from commissioner tools on both hubs
- Existing `migrateYearScopedAliasesToGlobal()` handles legacy data migration automatically

**Status panel fixes (P7A-4-FIX, P7A-4-FIX-2)**

- Roster status simplified to "Roster set" (green) / "Not configured" (red) — no count, no timestamp
- "Not configured" indicator changed from amber to red (amber reserved for champion signals)

**Key decisions**

- `aliases:global` chosen over `aliases:{year}` — team names are stable across seasons, year-scoping added unnecessary complexity
- League Data page retained as redirect stub rather than deleted — preserves existing bookmarks and links

---

### P7B-7 — Draft Flow Polish

**PROMPT_IDs:** P7B-7, P7B-7-FIX through FIX-35, P7B-7-FIX-25-AUDIT, P7B-7-FIX-25-AUDIT-2, P7B-7-AUDIT-ROUND-COUNT

**Carousel redesign (FIX-3, FIX-17, FIX-18, FIX-19, FIX-28)**

- Five-card landscape strip with CSS grid crossfade on center card only
- Flex-ratio card sizing (far 0.65, near 0.85, center 2) replacing fixed-dimension absolute positioning
- Round boundary sidebars with vertical "Rd X" labels
- 900px max-width carousel, centered
- Mobile: three-card layout with reduced padding and fonts (FIX-28)

**Draft board table polish (FIX-8 through FIX-14, FIX-26, FIX-30, FIX-31)**

- Horizontal table: owners as columns, rounds as rows (FIX-12 reverted earlier transposition)
- Snake draft column ordering: even rounds L→R, odd rounds R→L
- Sticky Rd column, team color left-bar, abbreviated team names
- Fixed-frame layout: `calc(100dvh - 10rem)`, no vertical page scroll (FIX-14)
- Bottom team strip replacing sidebar (FIX-13)
- 86px column width to fit 14 owners without scroll at 1280px (FIX-31)
- 12px font on desktop, 11px on mobile (FIX-30)

**Page layout (FIX-20 through FIX-26, FIX-29)**

- Centered at 1400px max-width with inner wrapper div
- Responsive padding: 8px mobile, 24px desktop (Tailwind `px-2 md:px-6`)
- Duplicate settings gear icon removed (FIX-20)
- Full-width table and container (FIX-26)

**Timer and state fixes (FIX-15, FIX-16, FIX-27)**

- Random auto-pick selection from available teams (FIX-15)
- Timer expiry always pauses and prompts commissioner (FIX-16)
- `timerExpiryBehavior` setting honored: `pause-and-prompt` vs `auto-pick` (FIX-27)
- Setup auto-advance error recovery: prevents permanent loading state (FIX-27)

**Round control (FIX-32, FIX-33)**

- Team selection during round-boundary pause implicitly starts next round (FIX-32)
- Total rounds hard-capped at `Math.floor(fbsTeamCount / ownerCount)` — enforced in UI input, on save, and in API POST/PUT handlers (FIX-33)

**Draft summary page (FIX-34, FIX-35)**

- Summary page at `/league/[slug]/draft/summary` made publicly accessible (no auth required)
- Admin features (edit picks, confirm, reopen) remain gated behind `isAdmin`
- Owner roster cards sorted alphabetically with Pick #, Team, Conference columns
- Short display name resolution (e.g. "FIU" instead of "Florida International") sourced from team database (FIX-35)
- "View Draft Summary →" button on complete banner in both commissioner and spectator views
- Draft-complete banner on league overview page, auto-hides once Week 1 starts (date derived from schedule game data)

**Key decisions**

- Existing URL pattern `/league/[slug]/draft/summary` preserved (no `[year]` segment) — year derived from league status, consistent with all other draft routes
- DraftHeaderArea shared by both commissioner and spectator views — one component, one `summaryHref` prop covers both
- Week 1 date derived from `games.filter(g => g.week === 1)` minimum date — no hardcoded dates

---

### P7B Season Transition Architecture — Complete

**Status:** Complete. Branch `claude/audit-season-transition-pwKfH`.
**PROMPT_IDs:** P7B-AUDIT-HISTORY-AND-SEASON-TRANSITION, P7B-AUDIT-SCHEDULE-YEAR, P7B-SEASON-TRANSITION-A, P7B-SEASON-TRANSITION-B, P7B-SEASON-TRANSITION-B-FIX, P7B-SEASON-TRANSITION-C

**Goals completed:**

- Automatic season transition from preseason to season state
- Decoupled "Go Live" button from immediate state transition
- Fixed schedule year derivation for preseason state
- Pre-season overview page with owner rosters and schedule placeholder

**Key outcomes:**

**Schedule year derivation fix (P7B-SEASON-TRANSITION-A)**

- `seasonYearForToday()` threshold moved from August (`>= 7`) to July (`>= 6`) in all three copies (normalizers.ts, schedule/route.ts, HistoricalCachePanel.tsx)
- `GlobalRefreshPanel` accepts `defaultYear` prop — admin Data Cache page passes preseason year when any league is in preseason
- `CFBScheduleApp` overrides `selectedSeason` to `leagueStatus.year` when league is in preseason — all schedule fetches target the correct upcoming season

**"Complete Setup" rename and decoupling (P7B-SEASON-TRANSITION-B)**

- `goLive()` renamed to `completeSetup()` — no longer transitions to `state: 'season'`
- Sets `setupComplete: true` on the preseason `LeagueStatus` variant
- `LeagueStatus` preseason variant extended: `{ state: 'preseason'; year: number; setupComplete?: boolean }`
- UI updated: button text, blocker text, checklist label, draft summary prompt
- After setup complete: green "Setup Complete ✓" badge with "Season will go live automatically before the first game" note

**Automatic season transition cron (P7B-SEASON-TRANSITION-B)**

- `vercel.json` created with daily cron: `0 0 * * *` (00:00 UTC). The handler does internal date math to determine whether the transition actually fires — it probes for `firstGameDate` and only transitions preseason leagues the day before the first game.
- `/api/cron/season-transition` route secured via `CRON_SECRET` Bearer token
- `ScheduleProbeState` type in `src/lib/scheduleProbe.ts`: tracks `baseCachedAt`, `firstGameDate` per year
- Cron logic: find preseason leagues → probe CFBD for schedule → cache data → derive first game date → transition all preseason leagues the day before first game
- Schedule probe refetch window: re-fetches within 7 days of first game for updated kickoff times
- Manual schedule refresh (`bypassCache=1`) also updates probe state
- `CRON_SECRET` auth: distinguishes "not configured" from "invalid token" with actionable error messages

**Pre-season overview (P7B-SEASON-TRANSITION-C)**

- During preseason with no schedule data, shows owner roster cards (owner name + drafted teams) in a responsive grid
- Schedule placeholder: "2026 season schedule not yet available — check back closer to kickoff"
- Fatal bootstrap error suppressed in preseason (expected state — no schedule data is normal)
- No 2025 data bleed-through: `selectedSeason` set to `leagueStatus.year` (2026) during preseason, preventing any prior-year data from loading
- When 2026 schedule IS cached, normal views render with that data

**Key architectural decisions:**

- `setupComplete` stored on `LeagueStatus.preseason` variant (not separate appStateStore key) — disappears naturally when league transitions to `season`
- Schedule probe state stored in `appStateStore` scope `schedule-probe` — survives across deployments
- Cron uses `fetchUpstreamJson` + `mapCfbdScheduleGame` directly (not internal API call) for reliability
- Pre-season overview renders inline in `CFBScheduleApp.tsx` (no separate component) — consistent with existing preseason banner pattern

---

### P7B Dry Run Polish — Complete

**Status:** Complete. Branch `claude/polish-draft-flow-Rv5AF`. PR #270.
**PROMPT_IDs:** P7B-AUDIT-SEASON-STATE, P7B-AUDIT-ROSTER-CHECK, P7B-AUDIT-COMPLETE-SETUP-GUARD, P7B-OVERVIEW-BANNER, P7B-OVERVIEW-BANNER-STYLE, P7B-OVERVIEW-BANNER-STYLE-FIX, P7B-OVERVIEW-BANNER-COUNTDOWN, P7B-DRAFT-START-FIX, P7B-AUDIT-COMMISH-URL, P7B-CONTINUE-SETUP-LINK, P7B-PRESEASON-CHECKLIST-FIX, P7B-PRESEASON-REGRESSION-FIX, P7B-PRESEASON-REGRESSION-FIX-2, P7B-ROSTER-CHECK-FIX, P7B-SANDBOX-RESET-FIX, P7B-SANDBOX-AUTO-COMPLETE-DRAFT, P7B-DRAFT-SETUP-OWNERS-REMOVE, P7B-COMPLETE-SETUP-REVALIDATE, P7B-COMPLETE-SETUP-REVALIDATE-2, P7B-COMPLETE-SETUP-REVALIDATE-3, P7B-COMPLETE-SETUP-HUB-FIX, P7B-RESET-RACE-FIX, MERGE-CONFLICT-AUDIT, MERGE-CONFLICT-FIX

**Goals completed:**

- Full end-to-end dry run readiness: preseason setup → draft → complete setup flow works without manual workarounds
- All sandbox reset controls work correctly for repeated dry runs
- Admin hub reflects league state accurately

**Overview lifecycle banners (P7B-OVERVIEW-BANNER series)**

- State-driven banner system in `CFBScheduleApp.tsx` driven by `leagueStatus` prop
- States: offseason early/late, preseason (no draft / draft scheduled / draft in progress / draft complete), season (in progress / live)
- Left-border accent styling (3px inline border, dark backgrounds, right-side-only border radius)
- Pulsing live indicator dot on draft-in-progress state via CSS keyframe animation
- Draft scheduled countdown: adaptive label (days away / tomorrow / today / starting soon)
- Header subtitle reflects current league state ("Offseason" / "Pre-Season" / "Season")
- Banner year and draft lookup year derived from `leagueStatus.year` (not `league.year`) — fixes 2025→2026 bleed

**Draft start fix (P7B-DRAFT-START-FIX)**

- "Start Draft" button in `DraftSetupShell` now calls `PUT phase: 'live'` before navigating to board
- Previous behavior did bare redirect — draft board redirected back to setup (redirect loop)

**Commissioner setup links (P7B-CONTINUE-SETUP-LINK)**

- "Continue Setup →" link added to draft complete banner in `DraftHeaderArea`
- "Ready to complete setup? Continue Setup →" prompt added to `DraftSummaryClient`
- `DraftSummaryClient` auth fixed to dual-auth pattern: `useUser()` from Clerk + `hasStoredAdminToken()`

**Preseason checklist fixes**

- "Season live" item removed from checklist (was circular — Complete Setup button couldn't satisfy it)
- Button renamed from "Go Live" to "Complete Setup", bound to `completeSetup()` which sets `setupComplete: true` without transitioning to season state
- `LeagueStatus` preseason variant extended with `setupComplete?: boolean`
- Checklist uses `canCompleteSetup` guard; shows "Setup Complete ✓" badge post-completion

**Roster check fix (P7B-ROSTER-CHECK-FIX)**

- `hasRoster` check in `preseason/page.tsx` now falls back to owners CSV (`owners:${slug}:${year}/csv`)
- A completed draft satisfies the roster requirement without a separate preseason owners confirmation step
- Preseason owners list still checked first; either source sufficient

**Admin hub setup complete state (P7B-COMPLETE-SETUP-HUB-FIX)**

- Admin hub (`/admin/[slug]/page.tsx`) renders two distinct preseason states:
  - `setupComplete=false`: "Setup in Progress" + "Continue Setup" link
  - `setupComplete=true`: green "Setup Complete ✓" card with "Season will go live automatically" note

**Sandbox improvements**

- "Set: Pre-Season" now clears preseason-owners, owners CSV, and draft state for the target year (fresh start every time)
- "Reset to 2025 Season" now also clears all 2026 preseason/draft/owners/schedule-probe state
- "Reset Draft" unchanged — clears draft + owners CSV, leaves preseason owners intact
- New "Auto-complete Draft →" button: fills all remaining picks randomly (snake order), marks complete, writes owners CSV with NoClaim rows
- `migrateTestOwnersCsv` returns descriptive string message shown in UI
- Race condition fixed in `resetTestLeague()` — `updateLeague` and `updateLeagueStatus` serialized (both write same registry array)

**Draft settings cleanup (P7B-DRAFT-SETUP-OWNERS-REMOVE)**

- Owners add/remove section removed from `DraftSettingsPanel` — redundant with preseason owners confirmation flow
- Draft order section (drag-to-reorder, Random/Reverse Champ/Manual modes) unchanged
- `owners` state initialized from draft state or `priorOwners`; used by draft order and save logic

**Key architectural decisions:**

- `setupComplete` stored on `LeagueStatus.preseason` variant — disappears naturally on season transition
- `hasRoster` satisfied by either preseason owners list OR owners CSV — draft confirmation is sufficient
- Sandbox "Set: Pre-Season" always clears state to ensure idempotent dry runs

---

---

### P7B Launch Preparation — Complete

**Status:** Complete. Branch `claude/update-turf-war-branding-gVu4z`. PR #272.
**PROMPT_IDs:** P7B-APP-WIDE-AUDIT, P7B-UI-UX-POLISH-AUDIT, P7B-FORCE-DYNAMIC-FIX, P7B-UI-POLISH-DEMO-FIXES, P7B-CLERK-MIGRATION-AUDIT, P7B-BRANDING-UPDATE, P7B-LAUNCH-DOCS-CLOSEOUT

**Goals completed:**

- Comprehensive app-wide audit covering 16 sections; one build blocker identified and resolved
- Full UI/UX polish audit — page-by-page rating, top 10 improvements identified
- Force-dynamic build blocker fixed across 11 pages
- Demo UI polish: custom `not-found.tsx` and `error.tsx` added, light mode fix on cache admin page, `autoPickMetric` dropdown removed
- Clerk production instance migration: DNS configured, session token customized, production keys set in Vercel, commissioner account created with `platform_admin` role
- Domain acquisition: `turfwar.games` and `tscturfwar.com` registered via Porkbun
- Custom domain connected: `turfwar.games` pointed to Vercel production via A record
- TSC redirect: `tscturfwar.com` → `https://turfwar.games/league/tsc` permanent redirect — configured at the Vercel dashboard layer (not in `vercel.json`, which contains only cron definitions)
- Branding update: "CFB League Dashboard" → "Turf War" across all user-facing surfaces (`layout.tsx`, `RootPageClient.tsx`, login page, test assertion); URL example updated to `turfwar.games`
- Landing page tagline updated to "Your league, upgraded."

**Key outcomes:**

- App is publicly live at `turfwar.games`
- TSC league accessible at `turfwar.games/league/tsc` and via `tscturfwar.com` redirect
- Production Clerk instance active; development instance retired
- All user-facing branding consistently reads "Turf War"
- Build is clean — no force-dynamic blockers remain

---

### Event-Centric Date-Aware Odds Attachment — Complete

**Status:** Complete. PR #332 merged. Codex review clean (no findings).
**PROMPT_IDs:** PLATFORM-030-ATTACHMENT-REGRESSION-TESTS-v1 (PR #331), PLATFORM-031-EVENT-DATE-AWARE-ATTACHMENT-v1 + PLATFORM-031-GAP-CLOSURE-v1 (PR #332)

**Goals completed:**

- Locked the pre-existing pair-only odds-attachment weakness with test-only regression coverage (PLATFORM-030) before changing production behavior
- Rewrote `attachOddsEventsToSchedule` (`src/lib/oddsAttachment.ts`) to be event-centric and date-aware: resolve each upstream event's pair via centralized `teamIdentity`, narrow same-pair candidates by a ±24h commence-time tolerance, and attach only when exactly one candidate remains — no fan-out, no arbitrary first-win
- Added `unmatched_pair` / `ambiguous_pair` / `date_mismatch` / `consumed_or_duplicate` diagnostics for every non-attaching event
- Plumbed upstream `commence_time` through normalization as `commenceTime` via `normalizeUpstreamOddsEvent` in `routeInternals.ts` (Next.js route modules forbid non-handler exports)
- Closed the WIP-audit gaps (PLATFORM-031-GAP-CLOSURE): date-aligned repeat-matchup fixture, full `/api/odds` propagation test, fresh-cache-without-`commenceTime` backward-compat test, and `buildOddsByGame` both-spellings regression

**Key outcomes:**

- Same-pair rematches (e.g. regular-season meeting vs conference championship) now attach to the correct canonical identity by date instead of arbitrary first-win
- `commenceTime` is attachment metadata only — never added to `DurableOddsSnapshot`, `CombinedOdds`, or public `/api/odds` output
- Older cached entries lacking `commenceTime` remain valid (treated as undated) and never force a migration refetch; PLATFORM-020 quota/cache guards untouched
- Validation: `npm test` 983 pass / 0 fail / 0 skipped; tsc, lint:all, build all clean

---

### Template for future entries

Use this structure for each new completed phase/milestone:

- **Status:**
- **PROMPT_ID(s):**
- **Goals completed:**
- **Key outcomes:**
- **Optional follow-up debt (non-blocking):**

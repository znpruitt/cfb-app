# Prompt Registry

Status: Current ledger
Last verified: 2026-07-14
Owner: Project documentation
Canonical for: prompt ledger / historical implementation record (not an active backlog)
Supersedes: (none)

Purpose:

- track important prompts
- provide reusable references
- document prompt evolution

The registry should remain:

- concise
- high-signal
- manually maintained

---

## Prompt ledger (most recent first)

This is a historical record of executed prompts — a ledger, not a backlog. Active/queued work lives in `docs/next-tasks.md`; entries here describe work that has shipped.

### DOCS-009-PLATFORM-086-PLANNING-RECONCILIATION-v1

- Purpose: Implement the approved post-PLATFORM-086A planning reset as a narrow documentation-only change: record PLATFORM-086A as merged (PR #391) and the Markdownlint tooling as merged (PR #392); convert the seven confirmed deferred 086A findings into three scheduled correctness tasks (PLATFORM-086G/H/I); redefine the remaining campaign boundaries (086B live scores only; 086C Odds only; 086D absorbed/retired; 086E1 weekly schedule refresh; 086E2 rankings refresh; 086F diagnostics redesign last); adopt the hard small-PR rule; and correct stale active planning facts (CFBD quota, season-transition cadence).
- Result: `docs/next-tasks.md` — campaign-status rows for the provider campaign; 086A marked merged via PR #391; the trailing seven-findings prose replaced with the 086G/H/I assignments; the stale 086B–F bullet replaced with the full revised task set, execution order (docs reconciliation → 086G → 086H → 086I → 086B → 086C → 086E1 → 086E2 → 086F → product work), the 086B→086G technical-dependency note (086H precedes 086B as campaign discipline, not a code dependency), and the binding small-PR rule (one behavioral objective per PR; independence-based split rule; >15 files / >1,500 net lines stop-and-replan triggers; PLATFORM-086A's 77-file/~12k-line scope as the named failure case). `docs/roadmap.md` — new Platform workstream section for PLATFORM-086 with canonical provider limits (CFBD Tier 1 5,000/month; Odds 500 credits, ~450 target / ~50 buffer, 3 credits/request); campaign-table rows; corrected the stale "Wednesday cron" (season-transition runs daily 00:00 UTC) and "1,000/month free tier" claims. `docs/prompt-registry.md` — this entry; 086A marked merged with a planning-reset addendum superseding its old 086B–086E forward references. `docs/completed-work.md` — appended PLATFORM-086A (PR #391) and Markdownlint tooling (PR #392) milestone entries. `CLAUDE.md` — stale "CFBD ~1000/mo" quota guidance corrected to Tier 1 5,000/month. `docs/operations/deployment.md` (permitted sixth file — its env-var table flatly asserted "Quota ~1000/month" for the production CFBD key, directly contradicting the tier-derived canonical limit and uncorrectable via the five planned files) — corrected to the tier-derived model (current key: Tier 1 = 5,000). Future prompt IDs (086G/H/I, 086B/C/E1/E2/F implementation prompts) are reserved in planning docs only — none are represented as issued/executed.
- Scope guardrails: Docs-only (`docs/next-tasks.md`, `docs/roadmap.md`, `docs/prompt-registry.md`, `docs/completed-work.md`, `CLAUDE.md`, plus the justified `docs/operations/deployment.md` quota-row fix). No application code, tests, cron config, `vercel.json`, or Markdownlint config changes; `src/lib/providerDatasets.ts` untouched (its stale `plannedPolicy` campaign attributions are tracked as follow-up code changes for each provider family's implementation PR). No provider calls, no mutation routes, no durable-state changes. Historical records (old completed-work quota references, the 086A entry's original prompt text) preserved as point-in-time records rather than rewritten.
- Follow-ups: Execute the provider campaign in the recorded order, starting with PLATFORM-086G. Correct each dataset's `plannedPolicy` string in `src/lib/providerDatasets.ts` within that family's implementation PR.

### PLATFORM-086A-REFRESH-OBSERVABILITY-v1

- Status: **Merged via PR #391 (2026-07-14).** Post-merge planning reset (DOCS-009-PLATFORM-086-PLANNING-RECONCILIATION-v1): this entry's original forward references to "086B–086E" cadences and "086D operator UI" reflect the campaign boundaries as they stood at issuance and are **superseded** — 086D is absorbed into this prompt's delivered scope (only the settings error-rendering remnant remains, → PLATFORM-086I); 086C is narrowed to Odds polling only; weekly schedule and rankings refresh are 086E1/086E2; game-stats missing-week recovery is PLATFORM-086H; and the seven deferred review findings are scheduled as PLATFORM-086G/H/I. Current boundaries live in `docs/next-tasks.md`.
- Purpose: Build the operational foundation for PLATFORM-086 provider-refresh automation: a durable per-dataset refresh-status model, truthful attempt/success/failure recording, a unified platform-admin provider-data status panel (freshness, failures, missing-data, quota), operator auto-refresh pause/enable controls, cache-only missing-data diagnostics, and a reusable user-facing freshness primitive. Does NOT add the live-score/odds/schedule/rankings cron cadences (those stay in 086B–086E).
- Result:
  - **Status model** (`src/lib/server/providerRefreshStatus.ts`, scope `provider-refresh-status`, one key per dataset): `beginProviderRefreshAttempt` / `recordProviderRefreshSuccess` / `recordProviderRefreshFailure`. Truthfulness invariants — a failure never advances `lastSuccessAt` (preserves prior-good source/rows), success is recorded only after the durable provider commit, and all record helpers are best-effort (swallow their own store errors, never throw into the provider path so a status write can't poison the data commit).
  - **Settings** (`src/lib/server/providerRefreshSettings.ts`, scope `provider-refresh-settings`): durable `globalPause` + per-dataset `enabled`, defaults preserve current behavior (nothing paused, all enabled). `isAutoRefreshAllowed(dataset)` gates NONCRITICAL auto refresh; lifecycle-critical `schedule` (season-transition cron) is exempt. No editable cron/cadence fields.
  - **Instrumentation**: all six refresh entry points record status — `/api/scores`, `/api/schedule`, `/api/odds`, rankings loader, `/api/conferences`, `/api/game-stats`, plus the season-transition cron (schedule) and the game-stats cron. The game-stats cron additionally honors `isAutoRefreshAllowed('game-stats')` (global pause + dataset toggle); manual `/api/game-stats?bypassCache=1` stays available while paused.
  - **Admin API + panel**: `GET/POST /api/admin/provider-status` (cache-only GET: statuses + settings + diagnostics + durable odds-usage snapshot; POST mutates pause/enable) and `ProviderDataStatusPanel` on `/admin/diagnostics` — per-dataset last attempt/success/age/error/rows/source/partial state, missing-data warnings, manual refresh (all six datasets) with expected provider cost, global pause + per-dataset toggles, and a read-only current-vs-planned automation summary.
  - **Diagnostics** (`src/lib/server/providerDataDiagnostics.ts`): cache-only — completed slates missing scores/game-stats, stale/partial schedule, stale/missing rankings, odds snapshot recency. Games without offered odds are never classified as a failure.
  - **Freshness UI** (`src/lib/freshness.ts` + `src/components/FreshnessLabel.tsx`): pure `formatRelativeTimestamp`/`describeFreshness` + a subtle muted chip; integrated as an "Odds updated …" label in the schedule app's live-status row (driven by the odds snapshot's own `capturedAt`, never a global timestamp).
  - CFBD usage display continues to derive its limit from the provider-reported patron tier (`resolveCfbdUsage`), never a hardcoded 1,000 (canonical Tier 1 = 5,000, corrected by the admin-truthfulness hotfix below) — surfaced with `remaining` as the authoritative figure (the user is on a higher tier).
- Scope preservation: no new provider calls on public/read paths (status GET is cache-only); PLATFORM-084A/084B/085A/085B/085C intact; canonical standings/Insights/archives/RSC gain no provider calls; canonical schedule stays the source of game identity; team identity stays in `teamIdentity.ts`; auth/quota boundaries unchanged. No new cron cadence, no `vercel.json` change, no editable cron strings.
- Verification: `git diff --check` clean; `npx tsc --noEmit` clean; `npm run lint:all` clean. New tests (37): status truthfulness + best-effort, settings pause/enable + lifecycle exemption, freshness formatting, CFBD-limit-not-1000, cache-only diagnostics, provider-status API GET/POST + auth, game-stats cron pause + manual-still-available. Regressions green across scores/schedule/odds/conferences/season-transition/rankings routes, appStateStore, and standings selectors.
- Scope guardrails: new `src/lib/providerDatasets.ts`, `src/lib/freshness.ts`, `src/lib/server/providerRefreshStatus.ts`, `src/lib/server/providerRefreshSettings.ts`, `src/lib/server/providerDataDiagnostics.ts`, `src/components/FreshnessLabel.tsx`, `src/components/admin/ProviderDataStatusPanel.tsx`, `src/app/api/admin/provider-status/route.ts`; instrumentation edits to the six refresh routes + two crons; `CFBScheduleApp.tsx` (one freshness chip); `/admin/diagnostics` page wiring; docs. Explicitly NOT in scope: PLATFORM-086B live-score cron, 086C odds/schedule/rankings cadence, 086D operator UI beyond this panel, editable cron/quota fields, external alerting, DB migrations.
- Post-review remediation (PLATFORM-086A-CODEX-REMEDIATION-v1, folded in pre-merge): resolved all 7 Codex P2 findings. (1) diagnostics now group ALL games per slate and apply the completion threshold to the slate's max kickoff, so a split Thursday/Saturday week is not judged complete off the Thursday game. (2) manual game-stats refresh sends an explicit `seasonType`, so postseason repair hits the postseason cache key. (3) a `refresh=1` with a missing `ODDS_API_KEY` now records a matching failure (prior-good preserved) instead of a dangling attempt. (4) status helpers distinguish an absent record from a failed durable read — on a read failure they skip the write rather than null prior-good (new `__setAppStateReadFailureForTests` seam). (5) refreshes carry a unique attempt token + per-dataset in-process lock so overlapping attempts resolve deterministically (older late-resolving attempt can't clobber the newer attempt's error); cross-instance ordering documented as a best-effort limitation. (6) the panel treats a fallback response (`meta.fallbackUsed` / `local_snapshot`) as a failed refresh via a shared `interpretRefreshResponse`. (7) auto-refresh toggles are interactive only for datasets a live job consumes (`autoRefreshSettingConsumed`); the settings API rejects toggling planned/exempt datasets. New helper `src/components/admin/manualRefresh.ts`; +33 tests (concurrency permutations, read-failure, split-slate, postseason repair, missing-odds-key, fallback interpretation, honest-controls API).
- Third-review remediation (folded in pre-merge): resolved all 8 findings (1 P1 + 7 P2) of the third Codex review. (P1) `/api/scores` now rejects a **nonempty** CFBD payload that normalizes to **zero** score rows as schema-drift **failure** (parity with schedule 085C), plus a non-array guard — only a genuinely empty array remains a no-op, so stale scores are never silently frozen. (2) the season-transition cron resolves every begun attempt: an all-empty probe → no-op, a durable schedule-commit failure → recorded failure + rethrow. (3) it captures `committedAt`/`commitSeq` right after `setAppState` (before probe work) so probe work can't reorder success metadata. (4) an all-empty `/api/schedule` refresh records a no-op instead of advancing last-success with zero rows. (5) attempt IDs use `crypto.randomUUID()` (cross-process unique; a per-process counter collided across serverless instances). (6) a per-process monotonic **commit-sequence** tie-breaker orders two commits sharing the same-millisecond `committedAt` by true commit order, not record order. (7) `providerRefreshSettings` global-pause + dataset-toggle writes are serialized by an in-process lock (no lost update). (8) the stale-freshness window is per-dataset (`staleAfterMs` on the descriptor), not one 48h threshold for all. +67 tests.
- Seventh-review remediation (PLATFORM-086A-CODEX-SEVENTH-REMEDIATION-v1, folded in pre-merge): resolved all 3 P2 findings of the seventh Codex review — the server must own refresh applicability, client state must not mix years, and each attempt must preserve its most specific failure metadata. (1) the aggregate score-refresh endpoint is now **server-authoritative** for applicable partitions: a new shared `src/lib/server/scoreApplicability.ts` (`deriveApplicableScoreSeasonTypes` extracted from `providerDataDiagnostics.ts` + a cache-only `getApplicableScoreSeasonTypes(year)`) derives applicability from the durable schedule, and `handleAggregateScoreRefresh` uses it whenever the client omits/mis-sends `seasonTypes` — so `GlobalRefreshPanel` (which sent no list) and any client can no longer spend a doomed postseason CFBD request before bowls exist; a nonempty `seasonTypes` remains an explicit targeted repair. Both panels issue the ordinary form (`scoresAggregateRefreshUrl(year)` with no `seasonTypes`); the client-side `scoreSeasonTypes` threading was removed. (2) `ProviderDataStatusPanel.load()` now guards against a year-selection race with a monotonic request seq + `AbortController` + echoed-year validation (pure `isCurrentStatusResponse`), so an older year's response can't overwrite a newer selected year's feed, and superseded/aborted/unmounted loads set no stale error/spinner. (3) `loadSeasonRankings` resolves each attempt exactly once: the schema-drift branch records `rankings-partition-schema-drift` (+ `failedPartitions`) and throws a marked `RecordedRankingsRefreshError` that the outer catch rethrows WITHOUT a second generic `recordProviderRefreshFailure` (which previously erased the code); genuine fetch/network failures still record the generic code. +15 tests (server-derived applicability before/after postseason + no-schedule + explicit/invalid overrides + no doomed postseason call, year-race guard permutations, rankings drift code surviving the outer catch, generic-failure code). No ESPN, no diagnostics/applicability provider calls, no new cron cadence or `vercel.json` change.
- Admin-truthfulness hotfix (PLATFORM-086A-ADMIN-TRUTHFULNESS-HOTFIX-v2, folded in pre-merge): corrected the diagnostics page's operational truthfulness (impossible quota, misleading wording, ambiguous no-history state, year-selection races) without any dashboard redesign. (1) **CFBD Tier 1 = 5,000** — the stale `3,000` in `CFBD_LIMIT_BY_TIER` produced an impossible "0 used / 5,000 remaining / 3,000 limit"; the canonical map now lives once in `src/lib/api/providerQuota.ts` (`cfbdCanonicalLimitForTier`) and `resolveCfbdUsage` consumes it. (2) **Shared quota reconciliation** — new `normalizeProviderQuota` produces a single `NormalizedProviderQuota` (`used + remaining = limit`, single-missing-value derivation, canonical-limit fallback + inconsistent-mark for contradictory provider fields, "unavailable" when nothing is trustworthy); `/api/admin/usage` normalizes server-side and BOTH the Provider Data Status panel and the legacy **API Usage** panel render the same object (raw fields shown only as labeled diagnostic detail), so they can never disagree or show an impossible combination. (3) **Global control wording** — "Global automatic refresh — Active" → **"Global provider pause: Off/On"** (the persisted `globalPause` state), with supporting text that manual refresh + lifecycle transition keep running and most jobs are still planned; no persisted-setting or cron-behavior change. (4) **Refresh-history vs cached-data** — a dataset with no PLATFORM-086A status record is no longer a blanket "Never refreshed": new cache-only `getProviderCacheStates` (`src/lib/server/providerCacheState.ts`, one guarded read per dataset → `available`/`absent`/`unknown`, surfaced as `cacheStates` on the status feed) drives *serving cached data · no refresh history recorded* / *no cached data or refresh history* / conservative *no refresh history recorded* — missing observability is never equated with missing data. (5) **Current-year isolation** — a live `yearRef` + `shouldApplyStatusResponse` (echoed-year AND selected-year) means a response for an abandoned year can't replace/error/re-spinner the current feed; a stale manual/settings callback can't start an old-year load or abort the current one; settings mutations reload the year selected at completion; manual refresh reloads only if its year is still selected; manual action state is keyed by `${year}:${dataset}` (`manualActionKey`) so results/spinners never leak across years. Legacy diagnostics (API Usage, Team Database, Storage Status, Score Attachment) preserved; dashboard redesign deferred to PLATFORM-086F. New `src/lib/api/providerQuota.ts`, `src/lib/server/providerCacheState.ts`; +tests (quota tier/reconciliation/inconsistency/agreement, cache-state availability/absent/unknown, no-history cache-state summaries, year+dataset action keying, current-year response guard). No ESPN, no provider calls on diagnostics/quota-status paths beyond the existing live CFBD `/info` read, no new cron cadence or `vercel.json` change.
- Final-truthfulness remediation (PLATFORM-086A-CODEX-FINAL-TRUTHFULNESS-REMEDIATION-v1, folded in pre-merge): resolved the two P2 findings of the Codex review of `c9cb776` — the panel could render wrong-year/fabricated state, and empty-schedule classification could strand an attempt `in-progress` after a prior-cache read failure. (1) **Valid-feed-only rendering** — `ProviderDataStatusPanel` renders dataset cards, diagnostics, the global-pause control, and the odds quota ONLY from a successful feed whose `feed.year` equals the selected year (new pure `panelFeedRenderState` in `manualRefresh.ts`). The `feed?.datasets ?? PROVIDER_DATASETS.map(placeholderRow)` fallback is gone (no fabricated "no history" rows); a loading request shows "Loading provider status for {year}…", a failed load with no valid feed shows "Provider status unavailable for {year}" (+error), and a year switch hides the prior year's cards immediately instead of showing them under the new year. The CFBD quota stays visible (independent per-mount read). (2) **Schedule prior-cache read guard** — both `src/app/api/schedule/route.ts` and `src/app/api/cron/season-transition/route.ts` wrap the prior durable schedule read used to classify an empty provider response: on a throw they record the open attempt as failed (`schedule-prior-cache-read-failed`, best-effort, prior-good retained, no no-op/success), the route returns its established 502 and the cron rethrows to its established 500 without transitioning off the unverifiable probe — neither leaves a dangling `in-progress` attempt, and recording-then-returning (route) / mirroring the durable-commit-failure rethrow (cron) avoids any duplicate terminal resolution. The read-failure test seam `__setAppStateReadFailureForTests` gained an optional `scope` (parity with the write seam) so a test can fail only `'schedule'` reads while `'provider-refresh-status'` writes still persist. +tests (panelFeedRenderState loading/unavailable/stale-year/ready; schedule + season-transition prior-cache-read-failed resolves failed, prior-good retained, no transition). Preserves all prior hotfix behavior, `classifyEmptyScheduleRefresh`, lifecycle safety, and legacy diagnostics; PLATFORM-086F still deferred. No new cron cadence or `vercel.json` change.
- Final-truthfulness remediation v2 (PLATFORM-086A-CODEX-FINAL-TRUTHFULNESS-REMEDIATION-v2, folded in pre-merge): resolved the three P2 findings of the Codex review of `b7e521e` — false prior-good claims on cold failures, game-stats results leaking across partitions, and empty conference commits recorded as success. (1) **Cache-state-aware failed messaging** — `providerStatusSummary.ts` `describeFailedRefresh(cacheState)` replaces the unconditional "prior-good data still serving": `available` → "prior-good cached data is still serving", `absent` → "no cached data is available" (a cold first failure never claims prior-good), `unknown` → "could not be determined", unsupplied → conservative "availability is unknown"; a historical `lastSuccessAt` never overrides current `cacheState === 'absent'`. The `cacheState` opt lost its `'unknown'` default so undefined is distinguishable. (2) **Game-stats partition identity** — `manualActionKey(year, dataset, { week, seasonType })` extends game-stats to `${year}:game-stats:${week}:${seasonType}` (others unchanged); the panel captures year/week/seasonType at action start and renders with the current partition, so a Week 1 regular result/spinner never shows beside Week 2 or postseason, and year isolation is preserved. (3) **Conferences empty/malformed rejection** — `src/app/api/conferences/route.ts` classifies the raw provider payload before any durable write: a non-array → `conferences-invalid-payload` failure, an empty array or a nonempty payload with zero usable rows (usable = non-empty `name`, `isUsableConferenceRecord`) → `conferences-no-usable-rows` failure — no durable write, prior-good retained, last-success not advanced, and the bundled fallback (`fallbackUsed`/`local_snapshot`) makes the admin interpreter report a failed refresh; ≥1 usable row commits durable-first + records success. The three fallback returns were consolidated into `conferencesFallbackResponse()`, and recording-then-returning inside the try avoids any duplicate terminal resolution by the outer catch. +tests (five failed-messaging cache-state permutations incl. history-does-not-override-absent; game-stats week/season-type/year key isolation + non-game-stats ignores the partition arg; conferences non-array / empty / zero-usable / usable-commit + prior-good retention + no empty cache). No ESPN, no new provider calls, no new cron cadence or `vercel.json` change; PLATFORM-086F still deferred.
- Scoped refresh-status model (PLATFORM-086A-SCOPED-REFRESH-STATUS-MODEL-v1, folded in pre-merge): resolved the adversarial-review finding that a refresh for one year, partition, week, or Odds query variant could appear as the operational status for another selected year or a broader target. Provider-refresh status is now keyed by a **canonical target scope**, not merely by dataset. **New `src/lib/providerRefreshScope.ts`** (client-safe): typed `ProviderRefreshScope` (`global` | `year` | `season-partition` | `week-partition` | `odds-target` | `legacy-unscoped`), scope constructors, one deterministic `providerRefreshScopeKey(dataset, scope)` (season-type normalized, Odds keyed by the existing durable `odds-cache` key, legacy-unscoped → bare dataset key so no migration is needed), plus `describeProviderRefreshScope`/`scopeMatchesKey`. **`providerRefreshStatus.ts`**: records self-describe (`scope`/`scopeKey` persisted; a stored record whose `scopeKey` disagrees with its key is ignored, not shown as truth); `beginProviderRefreshAttempt`/`record*` all take `(dataset, scope, …)`; the in-process RMW lock and attempt-token ordering are per scope key, so a completion for one target can never overwrite another; new `getLegacyProviderRefreshStatus` reads the pre-scoped record for deep diagnostics only. **Writers**: conferences=`global`; schedule=`year`; single-partition scores=`season-partition` while the aggregate refresh records an explicit `year` rollup after resolving every applicable partition; rankings=`year` rollup (one op always covers both partitions); game-stats week (manual+cron)=`week-partition` (a job-level cron missing-key failure records the `year` rollup); odds=`odds-target` (canonical vs filtered). **Admin feed** (`/api/admin/provider-status`): each dataset card reads only its canonical scope for the requested year (`canonicalCardScope`) — a targeted partition/week or filtered odds query never masquerades as the year's whole-target status — and the legacy record is returned separately as `legacyStatus`. The panel shows a scope chip per card and consumes only the canonical status; all prior year-isolation/loading/unavailable/action-keying behavior is preserved. +tests (11 scope-key construction/normalization; storage isolation across year/partition/week/late-completion/legacy/mismatch; admin feed isolation for cross-year, targeted week, filtered odds, global conferences, legacy). The other seven review findings (GameStatsCachePanel no-op wording, pause/toggle mutation-error rendering, odds-usage read-failure absence, odds schema-drift empty commit, game-stats partial-slate cron recovery, scores unexpected-empty no-op, CFBD quota missing-field coercion) remain **pending**; PLATFORM-086F dashboard redesign remains **deferred**. No ESPN, no new provider calls, no new cron cadence or `vercel.json` change.
- Scoped-status review remediation (PLATFORM-086A-SCOPED-STATUS-REVIEW-REMEDIATION-v1, folded in pre-merge): resolved the four P2 findings of the focused Codex review of the scoped-status migration (`0db46b2`) — a subset operation must never establish success/freshness for a broader canonical target than it attempted. (1) **Targeted schedule scope** — new `scheduleRefreshScope(year, week, seasonType)` in `providerRefreshScope.ts` reserves the `year` rollup for the **full-year** refresh only (`week === null` + all season types); a specific `seasonType` records the `season-partition` and a specific week records the `week-partition`, so a `regular`/`postseason`/single-week schedule repair no longer writes the whole-year status (`src/app/api/schedule/route.ts` captures one `scheduleScope` before begin and threads it through every resolver). (2) **Complete-applicable score aggregate** — new `scoresAggregateScope(year, attempted, applicable)` writes the `year` rollup only when the attempted partitions cover **every applicable** partition; a caller subset that omits an applicable sibling (e.g. `seasonTypes=postseason` while regular is applicable) records its own `season-partition` (`src/app/api/scores/route.ts` derives `applicableSeasonTypes` via `getApplicableScoreSeasonTypes` and threads `aggregateScope` through begin + all four resolvers). (3) **Week-specific score scope** — new `scoresPartitionScope(year, week, seasonType)` records a whole-partition refresh (`week === null`) against the `season-partition` and a week-specific refresh against the `week-partition`, so a Week 3 repair never overwrites the whole regular/postseason partition. (4) **Misrouted-token rejection** — `providerRefreshStatus.ts` replaces the log-only `assertAttemptScope` with `isMisroutedAttempt`: a completion token whose `dataset` or `scopeKey` disagrees with the target being resolved causes the record helper to **skip the write** (log-only, never thrown into the provider path), so a 2025-schedule token can't mutate 2026, a regular token can't touch postseason, and a scores token can't resolve schedule — a valid, matching token still resolves normally. +tests (scope-helper selection for schedule full-year/partition/week and score partition/aggregate-completeness; provider-status token-mismatch rejection across year/partition/dataset/no-op with happy-path intact; scores route week-partition + targeted-subset year-rollup isolation; admin feed targeted-schedule-partition + targeted-postseason-score do not advance the year card). Full suite green (1550). The other seven review findings and PLATFORM-086F dashboard redesign remain **deferred** (unchanged by this pass). No ESPN, no new provider calls, no new cron cadence or `vercel.json` change.
- Scoped-status review remediation v2 (PLATFORM-086A-SCOPED-STATUS-REVIEW-REMEDIATION-v2, folded in pre-merge): resolved the three P2 findings of the Codex review of `f460be1` — a refresh outcome must belong to the exact canonical target attempted, a combined operation must not be coerced into one child, and the file fallback must not lose a durable record under concurrent writers. (1) **Game-stats cron week scope** — `src/app/api/cron/game-stats/route.ts` resolves its target week (`findLatestCompletedWeek`, cache-only) BEFORE the `CFBD_API_KEY` check and captures ONE `weekPartitionScope` reused by every terminal resolver, so a missing-key failure records against that exact week partition (not `game-stats:year:<year>`) and a later successful run of the same week replaces it; a run with no applicable target returns the established skipped response with no scoped failure and no provider call, and a target-resolution read failure uses the established 500 path without mutating any data scope. (2) **Schedule `week + all` split** — `scheduleRefreshScope` now **throws** for a specific week with `seasonType='all'` (was coercing to the regular week partition); `src/app/api/schedule/route.ts` handles that request via a new `refreshScheduleWeekPartition` per applicable child (regular + postseason), each with its own attempt, durable child-key commit, and week-partition status (own row count/source/errors), so a postseason failure never marks regular failed and a regular success never stores combined rows or collides with a later regular-only refresh; the aggregate HTTP response contract is preserved (200 combined items on success, 502 with committed+failed partitions on any child failure), and the full-year (`week === null`) and single-partition forms are unchanged. (3) **File-fallback write serialization** — `src/lib/server/appStateStore.ts` adds a per-backing-file mutex (`withFileWriteLock`, keyed by the normalized absolute path, mirroring `withScopeLock`) wrapping the whole-file read→modify→temp-write→atomic-rename critical section of `setAppState`/`deleteAppState`, across ALL keys/scopes, so concurrent writers to different keys cannot each read the same snapshot and drop one another's update on rename. The lock applies only to the file fallback (Postgres relies on the DB), never serializes reads, sits strictly below the per-scope status lock, and releases on every outcome (the write-failure test seam now throws inside the critical section to exercise release). +tests (cron missing-key week/postseason scope + no-target no-failure + resolution-failure no-mutation + failure-then-success replacement; schedule week+all both-succeed/regular-success+postseason-fail/valid-empty-postseason-no-op/later-regular-no-collision/explicit-all/both-empty; appStateStore concurrent-different-keys survival, provider-status+unrelated concurrent survival, interleaved writes+delete, failed-write lock release). Full suite green (1564). The seven deferred review findings and PLATFORM-086F remain **deferred** (unchanged); cross-process file locking remains out of scope. No ESPN, no new provider calls, no new cron cadence or `vercel.json` change.
- Week+all aggregate-cache remediation (PLATFORM-086A-WEEK-ALL-AGGREGATE-CACHE-REMEDIATION-v1, folded in pre-merge): resolved the single P2 of the Codex review of `bee2f04` — the `week + all` split refresh persisted only the regular/postseason child cache keys, but the cache-only read path still loads the aggregate `<year>-<week>-all` key, so a subsequent anonymous read returned 503 / a stale entry and an admin cache miss re-fetched despite a successful refresh. Fix (`src/app/api/schedule/route.ts`): after all applicable children resolve **without failure**, the combined child rows (the same canonical rows already committed to the child caches) are persisted durable-first under the aggregate `cacheKey`, then mirrored to the process cache — restoring the read contract while keeping provider-refresh status strictly child-scoped (the aggregate entry has NO status of its own; no `all`-week/year/season rollup is introduced). The aggregate write happens ONLY when ≥1 child committed rows: a both-no-op week writes no aggregate entry (preserving the no-op/prior-good semantics), and the partial-failure branch returns before it so a partial result can never replace prior-good aggregate data. A failed aggregate write after successful child commits does NOT roll back the child caches or rewrite their (succeeded) statuses and does not synthesize a child provider failure — it returns `schedule-week-all-aggregate-cache-commit-failed` (500), and the atomic file write leaves the prior-good aggregate entry intact. The write-failure test seam gained an optional per-**key** filter (`__setAppStateWriteFailureForTests(error, scope, key)`) so a test can fail only the aggregate key while child-key commits still persist. +tests (aggregate entry carries both partitions + cache-only read serves it with no provider call; stale aggregate replaced; partial failure retains prior aggregate; valid-empty sibling → aggregate from the applicable child; both-empty → no aggregate entry; aggregate-commit failure keeps child successes + retains prior aggregate + reports the code). Full suite green (1566). The seven deferred review findings, the two separate Markdownlint tooling findings, and PLATFORM-086F all remain **deferred/out of scope**; no aggregate status scope, no new schedule scope type, no ESPN, no new provider calls, no new cron cadence or `vercel.json` change.
- Week+all read-composition remediation (PLATFORM-086A-WEEK-ALL-READ-COMPOSITION-REMEDIATION-v1, folded in pre-merge): resolved the two P2 regressions the materialized `<year>-<week>-all` aggregate write (WEEK-ALL-AGGREGATE-CACHE-REMEDIATION-v1) introduced, by **replacing the second authoritative derived copy with read-time composition** — the invariant is "week + all read → compose from exact child partitions → use the legacy aggregate only as compatibility fallback → never maintain a second authoritative derived copy." The v3 write could (a) **drop prior-good rows**: with a pre-split aggregate covering both partitions but no child keys, one nonempty child plus one provider `[]` (classified as a no-op only against the missing child key) rewrote the aggregate with just the nonempty child's rows; and (b) **go stale**: a later targeted `?week=W&seasonType=regular` repair updated only the regular child, leaving the materialized aggregate (and its process-cache copy) serving pre-repair rows past TTL. Fix (`src/app/api/schedule/route.ts`): the materialized aggregate write (durable + process) and the `schedule-week-all-aggregate-cache-commit-failed` path are **removed**; the cache-only `week + all` read is now COMPOSED at read time by `readComposedWeekAllEntry` — per partition the precedence is **exact child cache `<year>-<week>-<seasonType>` (process cache, then durable) → matching partition rows of the legacy `<year>-<week>-all` aggregate (partitioned by canonical `item.seasonType`, durable-only, never promoted/mutated/deleted) → absent**, with the composed view stale iff its OLDEST contributing partition is stale, a full miss (no child, no legacy) returning 503 to non-admins / triggering an admin refresh, and single-partition coverage served truthfully. So a targeted child repair is reflected immediately and no derived copy can drift. Consistent with the composition, `refreshScheduleWeekPartition`'s empty-response classifier now consults the matching legacy-aggregate partition rows as prior-good: a provider `[]` for a partition whose child key is absent but which the legacy aggregate still covers is a rejected **unexpected empty replacement** (recorded child failure), never a silent no-op. The per-**key** write-failure test seam added in v3 had no remaining use (the aggregate-commit test was its only caller), so `__setAppStateWriteFailureForTests` was reverted to its scope-level signature (`(error, scope?)`); child-scoped status is preserved exactly (no aggregate/`all`/year/season status rollup) and the file-fallback serialization is unchanged. +tests (rewrote the week+all block for composition: legacy-only fallback read; child-precedence-over-legacy; `[]` over legacy-covered partition → failure + legacy retained; targeted-repair reflected by composed read; incomplete single-partition coverage; full-miss non-admin 503; stale composed view rebuildRequired; fresh+stale partitions → stale composed view; both-succeed writes no aggregate entry). Full suite green (1572). The seven deferred review findings, the two Markdownlint tooling findings, and PLATFORM-086F all remain **deferred/out of scope**; no new schedule scope type, no ESPN, no new provider calls, no new cron cadence or `vercel.json` change.
- Week+all composition-freshness remediation (PLATFORM-086A-WEEK-ALL-COMPOSITION-FRESHNESS-REMEDIATION-v1, folded in pre-merge): resolved the two P2 cache-freshness defects the read-composition implementation (`53f5cc3`) introduced. (1) **Expired process child masked newer durable data** — `readComposedWeekAllEntry` used any present `SCHEDULE_ROUTE_CACHE` child without consulting durable storage, so once a warm instance's process child passed TTL it kept composing the stale rows (and returning `rebuildRequired` to non-admins) even after another instance / a targeted repair committed a newer durable child, unlike the single-key path which re-reads durable after a process miss/expiry. Fix: a new shared `resolveChildCache(childKey, now)` mirrors the single-key contract — a FRESH process entry is a fast-path hit (no durable read), an EXPIRED or absent one re-reads durable (refreshing the process mirror and using the durable timestamp), and an expired entry with no durable row is absence (not a fresh hit). (2) **Empty legacy partition poisoned freshness** — a pre-split aggregate holding only regular rows (normal before postseason) still produced a postseason legacy resolution with `items: []` at the old legacy timestamp, dragging the composed `min(at)` stale even when the real coverage (a fresh regular child) was fresh — so non-admins saw false `rebuildRequired` and admins refetched. Fix: an empty legacy partition extraction (`legacyPartitionRows(...).length === 0`) adds no resolution — no rows, no timestamp, no source. Composed freshness now derives only from partitions that contribute actual rows. No materialized aggregate or aggregate status is reintroduced; child-scoped status, per-scope attempt ordering, and file-fallback serialization are unchanged. +7 tests (expired process child reloads newer durable regular/postseason; fresh process child served with zero durable reads via the read-failure seam; expired-process-no-durable → non-admin 503 not a stale hit; empty legacy postseason/regular does not stale a fresh sibling child; regular-only legacy composes at its own timestamp). Full suite green (1579). The seven deferred review findings, the two Markdownlint tooling findings, and PLATFORM-086F all remain **deferred/out of scope**; no new provider calls, cron cadence, or `vercel.json` change.
- Sixth-review remediation (PLATFORM-086A-CODEX-SIXTH-REMEDIATION-v1, folded in pre-merge): resolved all 5 P2 findings of the sixth Codex review — a healthy partition, valid no-op, or stale fallback must never conceal failure or schema drift in another partition. (1) rankings partitions are validated **independently before combining** (`classifyRankingsPartition` in `src/lib/server/rankings.ts`): a nonempty partition that normalizes to zero usable weeks is schema drift (`rankings-partition-schema-drift`) that rejects the whole aggregate and retains prior-good, so a usable partition can no longer mask a drifted one and drift is never a no-op (raw-empty still classifies as pre-poll no-op or empty-over-prior-good rejection). (2) the season-transition cron shares the schedule route's **one** empty-response classifier (`classifyEmptyScheduleRefresh` in `scheduleSeasonFetch.ts`): an empty probe over a populated prior-good schedule is a rejected failure (`schedule-empty-replacement-rejected`, prior-good retained, and the league does not flip off the empty probe) instead of a silent no-op. (3) status classification is **separator-agnostic** — `gameStatus.ts` normalizes provider/cache enum labels to space-delimited tokens before matching (`normalizeStatusTokens`), so `STATUS_CANCELED`/`STATUS_POSTPONED` are correctly terminal/disrupted (a bare `\b` boundary silently failed on `_`), keeping the score-terminal and game-stats-applicability logic honest. (4) the manual score refresh is **one aggregate action**: the admin panels issue a single `refresh=1&aggregate=1` request that fans out over the applicable partitions under ONE `scores` attempt (`handleAggregateScoreRefresh`), resolving exactly once from the combined outcomes (all-succeed → success, any-fail → failure with `failedPartitions` + `partialFailure`, all-no-op → no-op) so a partition's no-op/success can never erase another's failure; a direct single-partition `refresh=1` still records its own attempt (shared `refreshScorePartition` core). (5) the shared manual-refresh interpreter treats a **stale** prior-good fallback (`meta.stale`/`meta.rebuildRequired`, e.g. rankings after rejecting an empty/drifted replacement) as a failed refresh, alongside `meta.fallbackUsed`/`local_snapshot`. +16 tests (independent rankings drift permutations, shared schedule empty classifier, underscore/hyphen/spaced enum classification, aggregate score-refresh outcome permutations, stale rankings fallback). No ESPN, no diagnostics provider calls, no new cron cadence, no `vercel.json` change.
- Fifth-review remediation (PLATFORM-086A-CODEX-FIFTH-REMEDIATION-v1, folded in pre-merge): resolved all 6 P2 findings of the fifth Codex review — coverage/freshness must reflect applicable canonical expectations and usable data. (1) a shared `expectsGameStats` helper (`src/lib/gameStats/coverage.ts`) defines stat-producing games (disrupted = canceled/postponed/suspended/delayed excluded via `gameStatus.ts`), used by BOTH the cron slate selection and the diagnostics so a disrupted-only slate is never selected (no wasted CFBD quota) nor flagged missing. (2) the game-stats cron `findLatestCompletedWeek` skips disrupted-only slates and picks the latest *eligible* slate. (3) odds diagnostics read only the CANONICAL/DEFAULT season-scoped cache entry (`defaultOddsCacheKey`, hoisted with the default filter sets + `createOddsCacheKey` into `routeInternals.ts`) — never the newest across filtered markets/bookmakers keys — so a filtered refresh can't make the served snapshot look fresh; absence → unknown. (4) `isUsableGameStatsRow` now requires nonempty (trimmed) `home.school`/`away.school` — a blank-identity row (CFBD omitted/renamed the team field) is not coverage and doesn't stop cron repair. (5) both the cron and manual `/api/game-stats` route share `classifyGameStatsPayload`: a genuinely empty CFBD array → `no-op` (no `games: []` write, no last-success advance), a nonempty payload with zero usable rows → failure (`game-stats-no-usable-rows`, prior-good retained), ≥1 usable row → commit. (6) rankings diagnostics require ≥1 usable week in `response.weeks` (empty record ≠ coverage), and `loadSeasonRankings` classifies an empty refresh before persistence (pre-poll empty → no-op without persisting; empty over prior-good → failure `rankings-empty-replacement-rejected` retaining prior rankings). +20 tests (disrupted-slate cron skip + diagnostics suppression, blank-identity usability, payload classification, canonical vs filtered odds freshness, rankings empty coverage/no-op/reject). No ESPN, no diagnostics provider calls, no deferred cadence added.
- Fourth-review remediation (PLATFORM-086A-CODEX-FOURTH-REMEDIATION-v1, folded in pre-merge): resolved all 5 P2 findings of the fourth Codex review — observability must describe the data actually committed/served. (1) an **all-empty schedule** refresh is classified BEFORE any durable/process-cache write: an empty result over an already-populated schedule is **rejected** as an unexpected replacement (`502`, prior-good retained, recorded failed, `code: 'schedule-empty-replacement-rejected'`), while a genuinely inapplicable/unpublished empty resolves as a no-op — never committed-empty-then-labelled-a-no-op. (2) completed-slate **score** coverage requires a canonical **terminal** classification (new `isCanceledStatusLabel` in `gameStatus.ts`: final or canceled — an in-progress numeric row no longer counts, and postponed/suspended/delayed/unknown stay unresolved). (3) **game-stats** coverage is content-based via shared `src/lib/gameStats/coverage.ts` (`hasUsableGameStats`/`usableGameStatsGameIds`): a `games: []` or all-dropped record is not coverage, partial coverage surfaces as an info note, and the game-stats cron re-fetches such a week instead of treating the key as cached. (4) odds staleness derives from the season-scoped `odds-cache` `lastFetch` (via `getAppStateEntries('odds-cache', '${year}:')`), decoupled from the global quota-observation timestamp; quota usage stays a separate panel display. (5) the served-odds `FreshnessLabel` mounts in the normal clean state — extracted pure `shouldRenderLiveStatusSection` predicate now includes `oddsSnapshotAt`. +22 tests (schedule empty-replacement/inapplicable-no-op, terminal/canceled/unresolved score coverage, game-stats content/partial/cron-retry, season-scoped vs quota odds freshness, clean-state label predicate). No ESPN fallback or deferred cron cadence added.
- Second-review remediation (PLATFORM-086A-CODEX-REREVIEW-REMEDIATION-v1, folded in pre-merge): resolved all 7 findings of the second Codex review of the remediated commit, plus a product decision to remove ESPN as an automatic score fallback. **ESPN removal:** CFBD is now the sole normal production score provider — `/api/scores` no longer fetches ESPN or writes ESPN-sourced durable rows; a valid empty CFBD partition is a **no-op / valid absence** (200, prior-good preserved), and a CFBD failure preserves prior-good and reports a failure (dead `toScorePackFromEspn` + `Espn*` types deleted; the `source` union keeps `'espn'` only to read legacy cache entries). Findings: (1) manual score refresh fans out only over applicable partitions the feed derives cache-only from the schedule (`scoreSeasonTypes`) — skips a doomed postseason request pre-bowls — and the route's valid-empty→no-op means the action no longer reports failure. (2) the user-facing Odds freshness label now uses the SERVED season's odds cache-entry timestamp (`meta.snapshotCapturedAt`, threaded through `useLiveRefresh`), not the global quota snapshot or admin usage poll. (3) success ordering uses an explicit `committedAt` (durable commit time) so an older commit recording status late can't overwrite a newer commit. (4) the admin status feed reads durable odds usage once per request (`forceRefresh`) and shares it with the odds diagnostic, so a cross-instance refresh isn't masked by the process memo. (5) conferences, rankings, and both game-stats entry points now begin the attempt before credential validation and record a missing-key failure (parity with odds). (6) a schedule durable-commit failure resolves the open attempt as failed instead of dangling. (7) the panel summary reads an explicit `latestAttemptOutcome` (`in-progress`/`succeeded`/`partial`/`failed`/`no-op`) — extracted to pure `providerStatusSummary.ts` — so an in-flight/interrupted/no-op attempt is never mislabeled from historical fields; new `recordProviderRefreshNoop` + scope-aware `__setAppStateWriteFailureForTests`. +40 tests (commit-time ordering, no-op semantics, outcome state transitions, panel summary, applicable partitions, durable odds read, missing-key parity across routes/cron, schedule commit failure, ESPN-removal/valid-empty). Distributed limitation unchanged: cross-instance status writes remain best-effort (no store CAS), but explicit commit timestamps + attempt IDs remove the within-process ordering and unresolved-attempt hazards.

### PLATFORM-085C-SCHEDULE-ROUTE-SCHEMA-DRIFT-SAFETY-v1

- Purpose: Close the narrow edge PLATFORM-085B intentionally left open — the authorized `/api/schedule` refresh could treat a successful provider fetch whose **nonempty** payload normalizes/builds to **zero** schedule rows as a successful empty partition, committing (or overwriting good state with) an empty/incomplete schedule. Apply the 085B nonempty→zero-is-uncertainty rule to the schedule route.
- Root cause: `fetchSeasonType` (`src/app/api/schedule/route.ts`) mapped the upstream `CfbdScheduleGame[]` to `ScheduleItem[]` and returned `{ items }` even when a **nonempty** upstream dropped every row (missing team/week, shape change) — a `fulfilled` result with zero items. The GET handler's completeness gate (`hasRequiredSeasonTypeFailure`) only reacted to a **rejected** `fetchSeasonType`, so a schema-drifted partition passed as a "successful empty" one and (for `all`) could commit the other partition as a complete `partialFailure:false` schedule, or (for a single/week request) commit an empty schedule.
- Result: `fetchSeasonType` now **throws** on (a) a non-array upstream payload and (b) a nonempty upstream (`upstream.length > 0`) that maps to zero rows (`items.length === 0`) — schema drift → uncertainty. A thrown partition lands in `failedSeasonTypes`, and the existing gate returns `502` (with `failedSeasonTypes` for an `all` request, or the drift message for a single/week request) BEFORE the PLATFORM-085A durable-first commit block — so the durable `${cacheKey}`, `SCHEDULE_ROUTE_CACHE`, and standings invalidation are all left untouched and prior-good durable schedule is retained. A legitimately **empty** upstream array (`upstream.length === 0` — postseason before bowls, a future week) is unchanged: it returns `[]` and commits normally as valid absence. No change to the admin schedule route's completeness gate, durable-first ordering, or the season-transition cron (which already had its own equivalent classification from 085B).
- Scope preservation: no provider calls added; public `/api/scores`/`/api/odds` stay cache-only; canonical standings/Insights/archives/RSC gain no provider calls; PLATFORM-084A/084B/085A/085B intact; canonical schedule stays the source of game identity (no new identity/matching); auth/quota unchanged.
- Verification: `git diff --check` clean; `npx tsc --noEmit` clean; `npm run lint:all` clean. Schedule route test extended to 10 (existing 7 + new: schema-drift single-regular refresh → 502 + prior-good durable retained + zero standings tags via `workAsyncStorage` capture; schema-drift within `all` → 502 `partial upstream error` with `failedSeasonTypes:['regular']` + no commit; empty-postseason `all` refresh → 200 commit with `partialFailure:false`). 111 tests green across schedule/scores/cron-season-transition routes, `scheduleSeasonFetch`, scoreCacheReader, selectors-leagueStandings, seasonRollover, seasonArchive.
- Scope guardrails: `src/app/api/schedule/route.ts` + its test, plus docs (`AGENTS.md` Core rule #1, `storage-and-caching.md`, `game-data-flow.md`, `operations/deployment.md`, `next-tasks.md`, this entry). Explicitly NOT in scope: PLATFORM-086 refresh cadence, transition state-machine redesign, a global provider-schema-validation framework, new cron jobs.

### PLATFORM-085B-SEASON-TRANSITION-SCHEDULE-SAFETY-v1

- Purpose: Make season-transition schedule refreshes safe against partial provider results — do not durably commit partial/uncertain schedule data as a complete transition refresh, and retain prior-good durable schedule state when completeness is uncertain. Fixes ARCH-AUDIT-002's high-severity finding that transition/schedule refresh paths could treat partial provider success as complete fresh schedule state. Companion to PLATFORM-085A (which fixed memory-before-durable ordering); the broader transition state-machine / cron cadence (PLATFORM-086) stays deferred.
- Root cause: the season-transition cron (`src/app/api/cron/season-transition/route.ts`) reimplemented schedule fetching WITHOUT the completeness gate the admin schedule route already has (`hasRequiredSeasonTypeFailure`). Its `fetchCfbdSchedule` looped regular+postseason, swallowed a per-partition fetch failure ("continue with partial data"), and the handler wrote the survivors under `${year}-all-all` with `partialFailure: false` — i.e. a postseason fetch failure committed regular-only rows as a COMPLETE schedule, which canonical standings / Insights / rollover then read as authoritative.
- Result: `fetchCfbdSchedule` now returns `{ items, failedSeasonTypes }`, classifying each requested partition: a fetch that **throws**, returns a **non-array**, or normalizes a **nonempty** payload to **zero** rows (schema drift) is recorded as failed/uncertain; a successful fetch returning **zero** rows (e.g. postseason before bowls) is valid absence. The handler gates the durable schedule + probe write on `!hasRequiredSeasonTypeFailure('all', failedSeasonTypes)` — on any failure it retains prior-good durable schedule/probe, sets `partialFailure`/`failedSeasonTypes` on the year result, and does NOT cache/probe/transition from partial data (the next cron run retries). A complete-but-empty combined result writes nothing (never overwrites a good schedule with empty). The lifecycle status flip continues to run off the validated (current or prior-good) probe, so it only acts on complete schedule data; standings invalidation still fires only on the durable status flip (PLATFORM-071 behavior preserved). Also read `CFBD_API_KEY` at call time instead of a module-load const (removes an import-time capture fragility, aligns with the scores/schedule routes, enables deterministic tests).
- Scope preservation: no provider calls added; public `/api/scores` and `/api/odds` stay cache-only without `refresh=1`; canonical standings / Insights / archives / RSC gain no provider calls; PLATFORM-084A, 084B, 085A behavior intact; canonical schedule stays the source of game identity (no new identity/matching). The admin schedule route already gates `all` requests on any partition failure (502, no commit), so only the cron reimplementation needed fixing.
- Verification: `git diff --check` clean; `npx tsc --noEmit` clean; `npm run lint:all` clean. Cron route test extended to 7 (existing 3 + new: partial postseason failure → no commit/probe/transition/invalidation; prior-good schedule retained on partial fetch; nonempty→zero-rows schema drift treated as uncertainty; complete fetch commits durable schedule + probe). 117 tests green across cron season-transition, schedule/scores routes, durable-odds + odds-usage + rankings stores, scoreCacheReader, selectors-leagueStandings, seasonRollover, seasonArchive.
- Scope guardrails: `src/app/api/cron/season-transition/route.ts` + its test, plus docs (`AGENTS.md` Core rule #1, `storage-and-caching.md`, `game-data-flow.md`, `operations/deployment.md`, `next-tasks.md`, this entry). Explicitly NOT in scope: PLATFORM-086 refresh cadence / cron ownership, transition state-machine redesign, a global provider-schema-validation framework, new cron jobs, the admin schedule route's own nonempty→zero-mapped edge (it flags `partialFailure` truthfully and gates `all` on fetch failures — left as-is).

### PLATFORM-085A-PROVIDER-CACHE-COMMIT-ORDER-v1

- Purpose: Make provider cache writes durable-first so process memory never publishes "fresh" provider data before durable storage succeeds. Fixes ARCH-AUDIT-002's high-severity finding that a failed durable write could still appear fresh on one server instance. Scope limited to commit ordering; PLATFORM-085B (season-transition/partial-result safety) explicitly deferred.
- Result: Audited every provider refresh write path that maintains a process-local cache alongside durable app-state and reordered each to persist durably BEFORE publishing to memory and BEFORE invalidating standings. Sites fixed: scores route `SCORES_CACHE` (CFBD + ESPN branches), schedule route `SCHEDULE_ROUTE_CACHE`, odds route raw `oddsCache.entries`, conferences route `ConferencesRouteCache`, rankings cache `src/lib/server/rankings.ts` `CACHE` (found in Codex review — the initial audit missed it), durable canonical-odds store `setDurableOddsStore` + `updateDurableOddsStore` (`memoryStore`), and odds-usage memo `setLatestKnownOddsUsage`. Because the durable `await setAppState(...)` now lexically precedes the memory assignment, a throwing write short-circuits before the process cache is touched, and standings invalidation (already sequenced after the awaited write) only fires on a committed change. Read paths that hydrate the process cache from a durable read (cache-warming on a hit) were left as-is — that data is already durable.
- Quota/behavior preservation: no provider calls added or removed; public `/api/scores` and `/api/odds` remain cache-only without authorized `refresh=1`; PLATFORM-084A failure-vs-absence and PLATFORM-084B score reconciliation unchanged. Note: in the scores route the CFBD branch's existing try/catch still treats a durable-write failure as a provider failure and falls through to the ESPN branch (which also cannot persist and returns an error) — no fresh data is published either way; leaving that try/catch shape is within the "commit ordering only" scope (see Risks).
- Testing seam: added a narrow test-only `__setAppStateWriteFailureForTests(error)` to `appStateStore` (makes `setAppState` throw while reads still succeed; auto-cleared by `__resetAppStateForTests`) so durable-write-failure ordering is directly testable. New tests: durable-odds store (update + set: a write failure does not advance `memoryStore`; durable also unchanged), odds-usage store (write failure does not advance the memo), a scores-route integration test (a refresh whose durable write fails returns non-200 and a subsequent public read serves empty — process cache never poisoned), and a rankings integration test (a refresh whose durable write fails leaves `CACHE` unpopulated so a follow-up read demands an admin refresh instead of a poisoned hit; the success case still publishes to `CACHE`).
- Verification: `git diff --check` clean; `npx tsc --noEmit` clean; `npm run lint:all` clean. 138 tests green across scores/schedule/odds/conferences routes, durable-odds + odds-usage stores, odds durability, scores-scope, scoreCacheReader, selectors-leagueStandings, seasonArchive.
- Scope guardrails: `src/app/api/scores/route.ts`, `src/app/api/schedule/route.ts`, `src/app/api/odds/route.ts`, `src/app/api/conferences/route.ts`, `src/lib/server/durableOddsStore.ts`, `src/lib/server/oddsUsageStore.ts`, `src/lib/server/appStateStore.ts` (test seam), new/updated tests, plus docs (`AGENTS.md` Core rule #1, `storage-and-caching.md`, `game-data-flow.md`, `next-tasks.md`, this entry). Explicitly NOT in scope: PLATFORM-085B season-transition/partial-result safety, PLATFORM-086 refresh cadence, provider quota boundaries, canonical identity construction, new cron jobs.

### PLATFORM-084B-CANONICAL-SCORE-CACHE-RECONCILIATION-v1

- Purpose: Make canonical standings, rollover/archive, and public `/api/scores` use the SAME cache-only score reconciliation, so a week-specific score cache refresh (visible on `/api/scores`) is no longer invisible to canonical standings, Insights, and season archives (they previously read only the `${year}-all-*` score keys). Resolves ARCH-AUDIT-002's deferred score-cache mismatch finding.
- Result: Extracted the public season-wide reconciliation (`aggregateSeasonScoresResponse`) into a shared cache-only reader `loadReconciledSeasonScores` (`src/lib/server/scoreCacheReader.ts`). It reads every `scores` entry for `(year, seasonType)` — season-wide `${year}-all-${seasonType}` + per-week `${year}-<week>-${seasonType}` — in one bounded prefix read and dedupes rows by canonical game identity (home/away pair resolved via `teamIdentity.ts` + UTC date), newest cache entry winning per game (an empty newer entry contributes no rows, so it cannot erase a populated one). Three consumers now share it: (1) public `/api/scores` season read (route refactored to delegate; behavior byte-identical — same bundled-catalog + league-agnostic alias source, same freshness/empty semantics); (2) canonical standings `loadNormalizedScoreRows` (now takes the caller's already-loaded `teams`/`aliasMap`); (3) `buildSeasonArchive` (season rollover / admin backfill / admin rollover / cron season-rollover all funnel through it, so no per-route wiring). No new game-identity construction, no raw-label matching, no ownership/attachment/schedule changes; scores still attach to canonical schedule games.
- Quota + failure semantics: the reader is cache-only — no CFBD/ESPN call and no write; provider fetch remains solely on the authorized `refresh=1` branch of `/api/scores` (PLATFORM-075 intact). It honors PLATFORM-084A: `getAppStateEntries` returns `[]` only for a genuine miss and throws on a real store error, and the reader does not catch it, so a canonical consumer rejects on a store failure rather than caching an empty/default result; genuine absence (no scores before kickoff) returns no rows.
- Verification: `git diff --check` clean; `npx tsc --noEmit` clean; `npm run lint:all` clean. New `src/lib/__tests__/scoreCacheReader.test.ts` (7: reconcile all+week, week-only inclusion, dedup-no-double-count newest-wins, empty-newer cannot erase, seasonType filtering, genuine-absence, store-failure propagation); new canonical-standings integration test (a score present only in a per-week key credits the owner) and a parallel rollover-archive test; existing `scores/route`, `scores-scope`, `selectors-leagueStandings`, `seasonRollover-aliases`, `loadInsights`, `seasonArchive` suites green (99 across the affected set).
- Scope guardrails: `src/lib/server/scoreCacheReader.ts` (new), `src/app/api/scores/route.ts` (delegate + drop duplicated helpers), `src/lib/selectors/leagueStandings.ts` (`loadNormalizedScoreRows`), `src/lib/seasonRollover.ts`, new/updated tests, plus docs (`AGENTS.md` Core rule #1, `standings.md`, `game-data-flow.md`, `storage-and-caching.md`, `next-tasks.md`, this entry). Explicitly NOT in scope: PLATFORM-085A provider commit-order, PLATFORM-085B season-transition safety, PLATFORM-086 refresh cadence, odds, schedule cache redesign. Known follow-up (documented, low risk): the draft page's prior-year score read still reads only `-all-*` keys — prior/completed years are effectively-immutable so the week-key mismatch does not arise there.

### PLATFORM-084A-CANONICAL-CACHE-FAILURE-SEMANTICS-v1

- Purpose: Stop the canonical standings selector from caching *uncertainty* as valid output. Because the standings `unstable_cache` is tag-only (`revalidate: false`), a snapshot built from a failed store read would persist until a mutation happened to bust its tag — so critical store/read/build failures must reject (never persisted by `unstable_cache`) instead of degrading into a cacheable empty/default snapshot. Extends the PLATFORM-082A "failures are never cached" rule from archive/insights reads to the standings compute path. Explicitly excludes score-cache reconciliation (PLATFORM-084B).
- Result: Audited every app-state read in the `getCanonicalStandings` → `computeCanonicalStandings` → `resolve{Offseason,Season,Preseason}` → `liveDeriveStandings` path and classified each as absence-cacheable vs failure-must-reject. Most readers were already correct (`getLeague`, `listSeasonArchives`/`getSeasonArchive` (082A), owners-CSV read, `loadCachedScheduleItems`, `getScopedAliasMap`, `loadManualOverrides`, `loadNormalizedScoreRows`, `getScheduleProbeState`, and the cache wrapper, which only catches the `incrementalCache missing` non-RSC invariant). Two swallow-catches were removed: (1) `getPreseasonOwners` (`src/lib/preseasonOwnerStore.ts`) no longer wraps its read in `try/catch → null`, so a store failure propagates instead of masquerading as "no preseason owners" (genuine miss still returns `null`); (2) `liveDeriveStandings` (`src/lib/selectors/leagueStandings.ts`) no longer catches a `getTeamDatabaseItems()` failure into an empty catalog (the `.catch(() => [])` is gone — genuine absence is already handled inside `getTeamDatabaseItems` via the bundled `teams.json` fallback) nor a `buildScheduleFromApi` failure into a roster-only 0-0 snapshot. The legitimate absence path is preserved: an **empty cached schedule** (not fetched yet) still yields a roster-only snapshot; only a build failure over a **non-empty** schedule now rejects.
- Invariant added: AGENTS.md Standings Ownership Invariant #8 ("Cache valid absence, never cache uncertainty"). Provider quota behavior (cache-first, no self-fetch) and the schedule→canonical→standings architecture direction are unchanged; this is a failure-semantics hardening, not a data-flow or attribution change.
- Verification: `git diff --check` clean; `npx tsc --noEmit` clean; `npm run lint:all` clean. New `src/lib/__tests__/preseasonOwnerStore.test.ts` (5 tests — valid-absence `null`, round-trip, year-scoping, store-read-failure propagation, post-recovery success) and 2 new tests in `selectors-leagueStandings.test.ts` (store-read failure rejects instead of returning an empty snapshot; recovered store computes real standings) all pass; `loadInsights`, `postseason-boundaries`, `postseasonAttachmentEdges`, and the full `selectors-leagueStandings` regression green.
- Scope guardrails: `src/lib/preseasonOwnerStore.ts`, `src/lib/selectors/leagueStandings.ts` (removed swallow-catches only — no cache-key/tag/invalidation change), new + extended tests, plus docs (`AGENTS.md` invariant #8, `standings.md`, `storage-and-caching.md`, `next-tasks.md`, this entry). Explicitly NOT in scope: PLATFORM-084B score-cache reconciliation; no attribution/identity/ownership/lifecycle changes.

### PLATFORM-083-OWNERS-CSV-OPERATOR-GUARD-v1

- Purpose: Add an active-season owner-roster overwrite guard so a CSV import or inline roster-editor save cannot silently clobber a confirmed current-season roster. Resolves the "CSV current-season guard vs sanctioned admin override" deferral surfaced by the PLAN-002 audit.
- Result: `PUT /api/owners` (`src/app/api/owners/route.ts`) now guards league-scoped writes: for the league's active season (`year >= league.year`; past years are historical backfill), a write that would replace an already-populated roster (`parseOwnersCsv(existing).length > 0`) returns `409 { error: 'owner_roster_overwrite_requires_override', message }` unless `?override=1` is passed. Historical/backfill writes and initial roster creation (no existing populated roster) are unguarded. Team-name validation and post-write `invalidateStandings` are preserved (the latter wrapped to tolerate only the out-of-request-context `revalidateTag` Invariant so league-scoped writes are testable). Shared error code exported from a new leaf module `src/lib/ownerRosterGuard.ts`. Both admin write surfaces — `RosterUploadPanel` (CSV) and `RosterEditorPanel` (inline editor), which share the endpoint — detect the 409 and re-send with `override=1` after an explicit inline confirmation; cancel does not write. CSV panel + admin roster page relabeled "Historical / repair roster CSV import" with copy directing current-season ownership to the draft/manual flow.
- Auth posture unchanged: route stays platform-admin-only (`requireAdminRequest`); no league-admin/commissioner role introduced; `ADMIN_API_TOKEN` fallback untouched; league-password users still cannot write. This is a data-safety guard, not an authorization change.
- Concurrency: the populated-check is re-run immediately before each write (after the CSV path's async team-name validation), closing the window where a concurrent draft-confirm / manual write could populate an initially-empty scope between check and write. This narrows but does not distributed-lock the last-write-wins app-state store — matching every other owner-scope writer (draft confirm, pick edit), which are also unlocked. A store-level compare-and-set was intentionally left out of scope (DB-layer change); best-effort accidental-overwrite protection for a single-operator admin surface is the goal. Both UI confirm flows rebuild the roster/resolutions from current state at confirm (no stale captured edits); the CSV panel additionally pins the league+year that produced the 409 so a changed selector can't redirect the override to a different scope.
- Verification: `git diff --check` clean; `npm run lint:all` clean; `npx tsc --noEmit` clean. `src/app/api/owners/route.test.ts` extended (8 tests: initial-creation allowed, active-season overwrite rejected 409 + roster unchanged, override=1 succeeds, historical write allowed, active-season clear rejected, admin auth still required) — all pass; draft post-confirm-edit + `selectors-leagueStandings` regression green. UI override flow covered by logic/manual review (no component test harness in repo).
- Scope guardrails: `src/app/api/owners/route.ts`, `src/lib/ownerRosterGuard.ts` (new), `src/components/admin/RosterUploadPanel.tsx`, `src/components/admin/RosterEditorPanel.tsx`, `src/app/admin/[slug]/roster/page.tsx`, route test, plus docs (`AGENTS.md` #12, `identity-and-ownership.md`, `next-tasks.md`, this entry). No ownership-attribution/team-identity/draft-flow changes; no new auth role; no separate CSV endpoint.

### PLATFORM-082B-INSIGHTS-CACHE-ENTRYPOINTS-v1

- Purpose: Second/final split of `APPSTATESTORE-CACHING` — cache Insights output so it is not rebuilt on every page visit when inputs are unchanged, and review Insights entry-point cache behavior. Completes the campaign after PLATFORM-082A (archive reads).
- Result: Split the engine (`src/lib/insights/engine.ts`) into `generateRawInsights` (pure, deterministic in `context`) and `applySuppression` (stateful — reads+writes the suppression store; output depends on run count); `runInsightsEngine` now composes them with identical behavior. `loadInsightsForLeague` (`src/lib/insights/loadInsights.ts`) caches the expensive half (input load + `buildInsightContext` + `generateRawInsights`) via `React.cache` over `unstable_cache`, and applies suppression **per request** against the cached raw set — so the "fire once, then fade" behavior is byte-for-byte unchanged while the per-visit recompute is eliminated. `bypassSuppression` (admin/diagnostic) is computed directly (different generator set, no records) and not cached. Cache key `['insights', slug, resolvedYear, seeds:<SEED_ALIASES_HASH>]`. Freshness is tag-first + TTL backstop: the entry carries the canonical standings tags (new exported `standingsSlugTag`/`standingsYearTag` from `leagueStandings.ts`, refactored in place as the single source of truth) so every `invalidateStandings`/`invalidateAllLeaguesStandings` refreshes Insights immediately with zero new call-site wiring; `revalidate: 300` bounds staleness for the cross-league/infrequent inputs that do not flow through standings invalidation (season rankings — lazily cached during read, cannot safely `revalidateTag`; weekly game stats; wall-clock lifecycle/recency drift).
- Failure safety (PLATFORM-082A rule): the critical store reads inside the compute (owners CSV, canonical standings, archives) are not swallow-caught, so a transient failure rejects out of the cached callback and is never persisted as a bogus empty; `loadInsightsForLeague` then returns a graceful `emptyResponse` that is NOT cached. Optional inputs (schedule/team catalog/aliases/overrides/rankings) still degrade to defaults.
- Entry-point review: `/api/insights/[slug]` and `/league/[slug]/insights` remain `force-dynamic` — both do per-request auth (league password gate / admin session) and per-request suppression, so they must render dynamically; `force-dynamic` governs full-route/static caching only and does not disable `unstable_cache`, so the server-side compute is still cached. Neither self-fetches (PLATFORM-077), so no provider quota (PLATFORM-075). No entry-point code change was needed.
- Verification: `git diff --check` clean; `npm run lint:all` clean; `npx tsc --noEmit` clean. New `src/lib/__tests__/insights-cache.test.ts` (7 tests — cache key/tag isolation across slug+year, standings-tag piggyback, and the `generateRawInsights`/`applySuppression` split incl. fire-once-then-fade + per-league/season scoping) passes; existing insights + standings + archive + overview regression (`loadInsights`, `insights-lifecycle-awareness`, `insights-suppression`, `insights-context-aliases`, `selectors-leagueStandings`, `seasonArchive`, `overview`, `overview-canonical-contract` — 131 total) all green.
- Scope guardrails: `src/lib/insights/loadInsights.ts`, `src/lib/insights/engine.ts`, `src/lib/selectors/leagueStandings.ts` (additive tag-helper exports + in-place refactor to identical strings), new test, plus docs (`storage-and-caching.md`, `next-tasks.md`, this entry). No provider/standings-redesign/ownership/CSV/lifecycle-UI changes; suppression semantics preserved.
- Campaign status: **APPSTATESTORE-CACHING is now complete** (082A archive reads + 082B Insights output).

### PLATFORM-082A-ARCHIVE-READ-CACHE-v1

- Purpose: First split of `APPSTATESTORE-CACHING` — add a safe cross-request cache to season archive reads to cut repeated Postgres reads (and egress) on the hot history/insights paths before the August draft. Archive reads only; Insights output caching deferred to PLATFORM-082B.
- Result: Wrapped `getSeasonArchive(slug, year)` and `listSeasonArchives(slug)` (`src/lib/seasonArchive.ts`) in `React.cache` (per-request dedup) over `unstable_cache` (cross-request, tag-only, `revalidate: false`), mirroring the canonical-standings pattern. Cache keys are `['season-archive', slug, year]` and `['season-archive-years', slug]`; a per-year read carries tags `archive:${slug}` + `archive:${slug}:${year}`, the year list carries `archive:${slug}`. Archives are effectively-immutable persisted snapshots whose read output depends only on `(slug, year)` (alias/roster/owner-label state is baked in at write time), so those are the only key parts. Centralized invalidation in `saveSeasonArchive` via new `invalidateSeasonArchive(slug, year)` — busting the slug tag refreshes both the year list and every per-year entry, so all three writers (admin backfill, admin rollover, cron season-rollover) invalidate with no per-call-site wiring and a stale archive can never poison a recomputed standings snapshot. Both readers fall back to a direct store read on the `node:test` `incrementalCache missing` invariant; `saveSeasonArchive` swallows the out-of-context `revalidateTag` throw. No provider calls, no canonical/identity/ownership/standings invariant changes.
- Read-failure safety (Codex P1 remediation): the cache callbacks return `null`/`[]` ONLY for a genuine miss and let a real store/database error reject out of the callback, so `unstable_cache` never persists a bogus `null`/`[]` under `revalidate: false` — otherwise history would stay missing until the next write and a backfill could read a cached `null` as "no existing archive" and overwrite one without confirmation. The `incrementalCache missing` node:test fallback path also throws on real failure.
- Invalidation-failure safety (Codex P1 remediation): `saveSeasonArchive` no longer blanket-catches — it swallows ONLY the out-of-request-context `revalidateTag` Invariant (`static generation store missing` / NEXT code `E263`, i.e. scripts/tests) via `isMissingRequestStore`; a genuine invalidation failure inside a request propagates so the TTL-less cache can't serve stale history while the write falsely reports success. A separate reviewer claim that single-arg `revalidateTag` serves stale data under SWR was checked against installed Next 15.5.20 (`incremental-cache/index.js:309`, "if a tag was revalidated we don't return stale data" → hard miss) and confirmed a false positive: on-demand tag revalidation is a hard miss for `unstable_cache`, not SWR, so the standings recompute reads the fresh archive.
- Verification: `git diff --check` clean; `npm run lint:all` clean; `npx tsc --noEmit` clean. New `src/lib/__tests__/seasonArchive.test.ts` (18 tests — key/tag isolation across slug+year, read/write round-trip shape, cross-league/cross-year isolation, sorted year list, genuine empty list, read-failure propagation + post-recovery success for both readers, and `isMissingRequestStore` discrimination + out-of-context write tolerance) passes; standings + insights + rollover/history consumer tests (`selectors-leagueStandings`, `loadInsights`, `insights-context-aliases`, `seasonRollover-aliases`, `selectors-historySelectors`, `leagueRecords`, `historyOverview` — 168 total) all green.
- Scope guardrails: `src/lib/seasonArchive.ts` + its new test, plus docs (`docs/architecture/storage-and-caching.md`, `docs/next-tasks.md`, this entry). No changes to save-path routes (invalidation is centralized in `saveSeasonArchive`). Insights output caching / `loadInsightsForLeague` / `no-store`/`force-dynamic` review remain deferred to PLATFORM-082B; broader `APPSTATESTORE-CACHING` is NOT fully complete.
- Follow-ups: PLATFORM-082B — insights output cache + entry-point `no-store`/`force-dynamic` review.

### DOCS-008-FINAL-DOCS-CONSISTENCY-CLEANUP-v1 (PR #382)

- Purpose: Resolve the five small documentation-consistency findings from the broad post-closeout Codex review (after PRs #375–#381). Narrow docs-only cleanup; does not reopen the consolidation sequence.
- Result: (1) **Prompt-ID hygiene** — relabeled every `**Prompt ID to assign:**` bullet in `docs/next-tasks.md` (7) and `docs/roadmap.md` (7) to `**Backlog slug (provisional):**`, and added a note in each doc that backlog slugs are provisional planning labels, not formal prompt IDs — the formal `PROMPT_ID` (`<CAMPAIGN>-<###>-<SHORT_NAME>-v<version>` per `AGENTS.md`) is assigned only at task activation (with `<###>` checked against this registry then). No final prompt IDs invented; the noncompliant strings (e.g. `APPSTATESTORE-CACHING-v1`, `SERVER-FETCH-ARCHITECTURE-v1`) are no longer presented as prompt IDs. (2) **Deployment runbook access checklist** — rewrote §7D "Non-admin member validation" to distinguish public/no-password leagues (page loads anonymously) from passworded leagues (password gate appears → unlock loads the page, grants no admin/provider-refresh authority), and kept `/admin` as Clerk-gated; replaced the "commissioner account" framing throughout the runbook with "platform admin/operator" (the account created sets `role: platform_admin`, and commissioner-scoped auth is not yet enforced). (3) **Docs index traceability** — added DOCS-007 to the "sequence is now complete (…→ 006 → 007)" sentence in `docs/README.md` (the scope note already listed it). (4) **Architecture sketch ordering** — `docs/CFB_APP_ARCHITECTURE.md` now shows `schedule normalization + identity resolution → canonical AppGame model → …` so identity resolution is no longer implied to follow canonical construction. (5) **Markdown formatting** — deliberately did **not** run a Prettier sweep: `roadmap.md` (~125 lines) and `README.md` (~51 lines) would produce broad table-reflow churn, and `next-tasks.md`'s two Prettier warnings are pre-existing table-cell alignment unrelated to this change; new content is Prettier-clean. Markdown formatting remains outside enforced repo lint. `docs/prompt-registry.md` — this entry.
- Scope guardrails: Docs-only (`docs/next-tasks.md`, `docs/roadmap.md`, `docs/deployment-runbook.md`, `docs/README.md`, `docs/CFB_APP_ARCHITECTURE.md`, and this entry). No runtime/test/config/script/CSS/component/database-tooling changes. No Markdown-formatting enforcement added. No architecture/operations rewrite, no archive moves, no broad restructuring. No product/architecture deferral resolved (CSV current-season guard, owner-identity mapping, PLATFORM-040, `conferenceRecords` build, PLATFORM-039 archive parity, STANDINGS-PAGE-LIFECYCLE-LABELING — the last still appears only as a provisional backlog slug).
- Follow-ups: Markdown Prettier formatting remains non-enforced by repo lint; a deliberate, separately-scoped formatting pass could adopt it later. Otherwise none.

### DOCS-007-ROOT-DOCS-ARCHIVE-HYGIENE-v1 (PR #381)

- Purpose: Narrow post-DOCS-006 hygiene pass — audit the three remaining legacy-looking `docs/` root files and either archive them or justify keeping them, so root `docs/` reads cleanly. Docs-only; not a new archive campaign.
- Result: Audited all three. **Kept `docs/CFB_APP_ARCHITECTURE.md` in place** — it is genuinely `Status: Current (reference)` and actively cited by `CLAUDE.md` and `docs/architecture/overview.md` as a current quick-sketch companion, so archiving would mislabel it; it only *looked* legacy because it was a bare ASCII diagram, so added a proper H1 + lifecycle metadata header (and a "reference, not authority; see `architecture/overview.md`" note) to de-legacy it. **`git mv` `docs/cfb-engineering-operating-instructions.md` → `docs/archive/governance/cfb-engineering-operating-instructions.md`** (already Historical/superseded; kept its existing banner, fixed the internal `README.md` relative link, added an archive-index pointer). **`git mv` `docs/completed-work-archive.md` → `docs/archive/history/completed-work-archive.md`** (Phases 1–3 archive; added an "Archived — historical reference only" banner). Updated all live references to the two new paths: `AGENTS.md` + `CLAUDE.md` (Supersedes metadata; the CLAUDE map-table row and interaction-prefs origin note), `docs/architecture/overview.md`, `docs/roadmap.md` (§Architecture rules — repointed "canonical architecture principles" to `AGENTS.md`, preserving the archived doc as the historical formulation), `docs/README.md` (source-of-truth map: dropped the two now-archived individual rows, expanded the `docs/archive/` row to enumerate `governance/` + `history/`), and `docs/archive/README.md` (added the two new categories; moved those two docs out of "kept elsewhere" into the archive contents). `docs/prompt-registry.md` — this entry.
- Scope guardrails: Docs-only (the two `git mv`s + banner/link/label edits in the files above + this entry). Used `git mv` — no deletions, history preserved. `docs/campaigns/**` untouched. Historical prompt-ledger scope lines that reference the old root paths (e.g. `Scope: … docs/completed-work-archive.md`, `… docs/cfb-engineering-operating-instructions.md`) left unmodified as point-in-time records. No runtime/test/config/script/CSS/component/database-tooling changes. No product/architecture deferral resolved (CSV current-season guard, owner-identity mapping, PLATFORM-040, `conferenceRecords` build, PLATFORM-039 archive parity, STANDINGS-PAGE-LIFECYCLE-LABELING).
- Follow-ups: None. Root `docs/` now contains only current/current-ledger docs plus `CFB_APP_ARCHITECTURE.md` (Current reference); all historical/superseded standalone material lives under `docs/archive/**`.

### DOCS-006-ARCHIVE-PATH-DECISION-v1 (PR #380)

- Purpose: Resolve the final deferred documentation-closeout item — the `archive/` path decision — so standalone historical audit/design/prompt artifacts are preserved without reading as current implementation authority. Docs-only closeout; completes the DOCS-002 consolidation sequence.
- Result: **Decision: standardize `docs/archive/` for standalone historical artifacts, leave `docs/campaigns/**` in place** as an intentionally-retained campaign-retrospective area. `git mv`'d ten standalone artifacts under `docs/archive/{audits,designs,prompts}/` with kebab-case filenames: audits — `game-stats-audit`, `overview-feature-audit`, `p2c-foundation-hardening-audit-v2`, `p2c-standings-history-architecture-audit-v1` (the now-empty `docs/audits/` folded into `docs/archive/audits/`); designs — `history-redesign-spec`, `phase-3-multi-league-design`, `phase-4-historical-analytics-design`, `phase-5-draft-tool-design`, `phase-6-admin-auth-design`; prompts — `phase-2-revision-prompt`. Each moved file got a top-of-file "Archived — historical reference only (as of 2026-07-09)" banner pointing at the archive index. Created `docs/archive/README.md` (archive policy, what belongs where, the current-authority map, how to read historical records). Updated live references to the new paths: `docs/README.md` source-of-truth map (replaced the old phase/spec/audit row with a `docs/archive/` row + explicit campaigns disposition), `docs/architecture/overview.md` historical-docs paragraph, `docs/completed-work.md` phase-6 link, and the intra-archive `history-redesign-spec` link inside the moved phase-2 prompt. `docs/prompt-registry.md` — this entry; historical ledger scope lines (e.g. old `Scope: docs/game-stats-audit.md`) left unmodified as point-in-time records. `docs/next-tasks.md` — DOCS ledger line updated; closeout marked complete.
- Scope guardrails: Docs-only (moves under `docs/archive/**`, `docs/archive/README.md`, and link/label edits in the docs listed above). Used `git mv` — no history lost, no deletions. `docs/campaigns/**` untouched (retained, not archived) and not rewritten. `docs/cfb-engineering-operating-instructions.md` and `docs/completed-work-archive.md` left in place (already clearly labeled Historical/superseded / Archived). No runtime/test/config/script/CSS/component/database-tooling changes. No product/architecture deferral resolved (CSV current-season guard, owner-identity mapping, PLATFORM-040, `conferenceRecords` build, PLATFORM-039 archive parity, STANDINGS-PAGE-LIFECYCLE-LABELING).
- Follow-ups: None — this closes the documentation-consolidation sequence (DOCS-002A → 002B → 002C → 004 → 005 → 006). No deferred documentation-maintenance items remain in `docs/README.md` → "Planned documentation work".

### DOCS-005-LIFECYCLE-METADATA-ROLLOUT-v1 (PR #379)

- Purpose: Complete the deferred lifecycle-metadata rollout — add the standard per-doc metadata block (first adopted by the DOCS-002C architecture/operations docs) to the active/canonical governance and reference docs so readers can distinguish current guidance from historical records. Docs-only closeout.
- Result: Added a `Status / Last verified (2026-07-09) / Owner / Canonical for / Supersedes` block immediately under the H1 of ten docs: `AGENTS.md` (Current; canonical for binding engineering/architecture/implementation/review/documentation-timing rules; supersedes the historical `cfb-engineering-operating-instructions.md` jointly with CLAUDE.md), `CLAUDE.md` (Current; Claude workflow + prompt-handoff, explicitly does not supersede AGENTS.md), `DESIGN.md` (Current; durable UI/design principles), `docs/README.md` (Current; source-of-truth map + lifecycle definitions), `docs/next-tasks.md` (Current; active queue + unresolved decisions/deferrals), `docs/roadmap.md` (Current; high-level roadmap + philosophy only), `docs/prompt-registry.md` (`Status: Current ledger`; historical implementation record, not a backlog), `docs/deployment-runbook.md` (Current; detailed operator companion to `docs/operations/deployment.md`), `docs/vision.md` (Current; product vision + production data policy), and `docs/completed-work.md` (`Status: Historical (append-only ledger)`). `docs/README.md` — marked the lifecycle-metadata rollout ✅ Done, updated the scope note, and broke the `archive/` path decision out as the one clearly-labeled remaining deferred follow-up. `docs/prompt-registry.md` — this entry.
- Scope guardrails: Docs-only (the ten docs above + this ledger entry). No file moves; no `archive/` path decision. Historical campaign/phase/spec/audit records intentionally left unlabeled (they stay Historical). No architecture/runtime claims changed — metadata blocks only, existing headings/links preserved. No content rewrites. No runtime/test/config/script/CSS/component/database-tooling changes. No product/architecture deferral resolved (CSV current-season guard, owner-identity mapping, PLATFORM-040, `conferenceRecords` build, PLATFORM-039 archive parity, STANDINGS-PAGE-LIFECYCLE-LABELING). `docs/next-tasks.md` metadata added but its queue content untouched.
- Follow-ups: `archive/` path decision remains the sole deferred documentation follow-up (tracked in `docs/README.md` → "Planned documentation work").

### DOCS-004-DESIGN-CONTRADICTION-CLEANUP-v1 (PR #378)

- Purpose: Resolve the two known `DESIGN.md` self-contradictions deferred through DOCS-002A/C so the canonical UI/design doc is internally consistent — docs-only, no runtime UI change.
- Result: Verified current intended behavior from implementation (two read-only code sweeps) before editing. (1) **Standings rank numbers** — code shows the full Standings page owner-colors the rank digit (`StandingsPanel.tsx` inline `style={{ color: ownerColorFn(row.owner) }}`), while the Overview condensed snapshot, both podiums, and the History standings tables use muted `text-gray-*`/`text-zinc-*`; rewrote the "Color encoding" bullet (was the false absolute "Rank numbers in all standings tables are plain muted text — never colored") to state the real single rule and cross-reference the Tables section (which was already correct). (2) **Game-card borders** — code shows individual game cards are bordered discrete objects (`GameWeekPanel.tsx` `border border-gray-300 … dark:border-zinc-800` over a surface tint, with team-color accent bars), so corrected the stale "Game cards use a dark surface tint — no border, defined by background only" bullet to agree with the already-correct Containerization rule ("Individual game cards retain borders"). `docs/README.md` — marked the design-contradiction cleanup ✅ Done, updated the DESIGN.md status row + scope note. `docs/prompt-registry.md` — this entry.
- Scope guardrails: Docs-only (`DESIGN.md` + `docs/README.md` + `docs/next-tasks.md` + this ledger entry). No runtime/CSS/Tailwind/component/test/config/script changes — the docs were brought into line with existing behavior, not the reverse. No new design direction invented; both resolutions match verified implementation. `docs/next-tasks.md` edit was limited to its DOCS ledger line (marking DOCS-004 done and dropping design-contradiction cleanup from the remaining-follow-ups list). Remaining doc follow-ups (lifecycle-metadata rollout, `archive/` path decision) preserved as deferred.
- Follow-ups: None specific to DESIGN.md. Doc-lifecycle-metadata rollout and the `archive/` path decision remain deferred in `docs/README.md` → "Planned documentation work".

### DOCS-002C-ARCHITECTURE-OPERATIONS-DOCS-v1 (PR #377)

- Purpose: Third DOCS-002 slice — create a dedicated current-architecture and operations documentation layer so the durable runtime architecture and operator references have canonical homes (previously architecture lived only in `AGENTS.md` + the `CFB_APP_ARCHITECTURE.md` sketch, and operations only in `deployment-runbook.md`). Docs-only; describes present behavior and points back to `AGENTS.md` for binding invariants — does not restate or override them.
- Result: Added six architecture docs under `docs/architecture/` — `overview.md` (high-level structure, canonical data-flow `schedule → canonical games → scores/odds/ownership attach`, source-of-truth hierarchy, doc index), `game-data-flow.md` (schedule as source of truth, canonical `AppGame` construction, postseason canonical-week formula, score/odds attachment precedence, PLATFORM-075 public cache-reader + authorized-refresh policy, provider quotas), `identity-and-ownership.md` (`teamIdentity.ts` sole canonicalization boundary + 3-step resolution, alias precedence `stored global > year > seed`, `gameOwnership.ts` candidate order, PLATFORM-040/PLATFORM-039 deferrals, required CSV-role wording verbatim), `standings.md` (`getCanonicalStandings` authority, LiveDelta separate/never-merged, NoClaim at source, lifecycle/preseason states, cache tags + PLATFORM-070/071 invalidation wirings, PLATFORM-080 finalized-game refresh), `auth-and-privacy.md` (three independent mechanisms: Clerk / `ADMIN_API_TOKEN` / `LEAGUE_AUTH_SECRET`; middleware page gating vs `requireAdminAuth` API gating; `/api/debug/*` route-gated; `CRON_SECRET`; league password grants no role/no fetch authority), `storage-and-caching.md` (app-state store, alias/app-state storage, provider caches, standings cache keys/tags, PLATFORM-081 legacy-alias cleanup complete + zero remaining, future broad DB cleanup out of scope). Added two operations docs under `docs/operations/` — `deployment.md` (high-level env-var/auth-secret/cron overview, deploy-time checks, rollback/backup pointers; companions the still-current `deployment-runbook.md`) and `diagnostics.md` (diagnostic-surface auth, upstream-first debugging order `API response → normalization → canonical game model → attachment → UI`, per-layer inspection, guardrails). Each new doc carries the lifecycle metadata header (Status/Last verified/Owner/Canonical for/Supersedes). Linked all eight from `docs/README.md`'s source-of-truth map and marked the DOCS-002C planned-work item ✅ Done. `docs/prompt-registry.md` — this entry.
- Scope guardrails: Docs-only (new files under `docs/architecture/` + `docs/operations/`, plus `docs/README.md` link/status edits and this ledger entry). No runtime/test/config/script/database-tooling changes. No file moves — the `archive/` path decision for `docs/campaigns/**` and phase/spec records stays open. Did not resolve any deferred product/architecture decision (CSV current-season guard, owner-identity mapping across seasons, PLATFORM-040 normalized ownership-key index, `conferenceRecords` canonical build, PLATFORM-039 archive raw-label parity, STANDINGS-PAGE-LIFECYCLE-LABELING). CSV documented per the required wording — not overstated as history-only. No secret values exposed. `deployment-runbook.md` kept Current (not superseded).
- Follow-ups: Deferred **design-contradiction cleanup** and deferred **doc lifecycle metadata rollout** onto pre-existing active docs — both still tracked in `docs/README.md` → "Planned documentation work"; plus the still-open `archive/` path decision for campaigns/phase records.

### DOCS-002B-PLANNING-HISTORY-CLEANUP-v1

- Purpose: Second DOCS-002 slice — planning/history docs cleanup so the current queue, roadmap, ledger, and completed-work stop competing: remove stale "planned/pending/open" wording for shipped work, resolve the roadmap contradiction, collapse the verbose completed audit sequence, keep unresolved decisions visible. Docs-only.
- Result: `docs/next-tasks.md` — collapsed the completed "Audit-driven correctness + docs sequence" (Section 0, the full PLATFORM-069→081b + DOCS-001A/B + DOCS-003 detail) into a one-line-per-item ledger pointer (per-item history → `prompt-registry.md`; shipped context → `completed-work.md`/campaigns); dropped the stale "open correctness risks today" framing; added an explicit `#### Unresolved decisions & known deferrals` subsection (kept under the same Section 0 heading so the `AGENTS.md` single-source pointer stays valid); removed the two shipped items (STANDINGS-PRESEASON-STATE, INSIGHTS-LIFECYCLE-AWARENESS) that were lingering in the "Planned backlog" sections. `docs/roadmap.md` — fixed the completed-work summary table's "Standings Page — Preseason State: 🔄 Planned" to ✅ Complete (it contradicted the section already marked ✅ shipped). `docs/README.md` — marked the DOCS-002B planned-work item done. `docs/prompt-registry.md` — this entry.
- Scope guardrails: Docs-only. No architecture/operations docs (DOCS-002C stays deferred). No `AGENTS.md`/`DESIGN.md` edits; the only governance-doc change was a one-line `CLAUDE.md` pointer relabel during PR-review remediation ("Current unresolved correctness work" → "Unresolved decisions and deferrals" → the new subsection, since the audit correctness sequence has shipped) — the `AGENTS.md` single-source pointer stayed accurate via the preserved next-tasks structure. Also backfilled concise **DOCS-001A**/**DOCS-001B** ledger entries so the collapsed next-tasks pointer resolves to a real registry home. No file moves; `completed-work.md`/campaign retrospectives left as historical record. No runtime/test/config/script changes. All unresolved product/architecture decisions preserved (CSV guard, owner-identity mapping, PLATFORM-040, `conferenceRecords` build, PLATFORM-039 archive parity, STANDINGS-PAGE-LIFECYCLE-LABELING).
- Follow-ups: **DOCS-002C** (architecture/operations docs + `archive/` decision), deferred **design-contradiction cleanup**, and deferred **doc lifecycle metadata rollout** — all tracked in `docs/README.md` → "Planned documentation work".

### DOCS-002A-GOVERNANCE-AND-DOCUMENTATION-INDEX-v1

- Purpose: First, narrowed slice of the DOCS-002 structural docs consolidation — establish a documentation index / source-of-truth map and tighten the root governance docs, without the larger planning/history/architecture restructure. Deliberately scoped small and reviewable (PR-1).
- Result: Docs-only. Created `docs/README.md` as the documentation map — a source-of-truth table (which doc owns what), doc lifecycle status definitions (Current / Historical / Superseded / Archived, plus the ledger special case), an authority-boundaries section (AGENTS = binding architecture; DESIGN = UI; CLAUDE = Claude workflow; docs/README = map; next-tasks/prompt-registry/roadmap noted as current-for-now, scoped for later reduction), and a "Planned documentation work" section recording the deferred DOCS-002B/002C passes. Anchored each governance doc's "Doc authority" header to `docs/README.md` (`AGENTS.md`, `DESIGN.md`, `CLAUDE.md`) and added `docs/README.md` to CLAUDE.md's canonical doc-pointers table. Relabeled AGENTS.md's unresolved-work pointer from "correctness work" to "decisions and deferrals" (accurate now the audit sequence has shipped) while keeping its no-restate-statuses principle.
- Scope guardrails: No changes to `docs/next-tasks.md`, `docs/roadmap.md`, `docs/completed-work.md`, campaign docs, or the root `README.md` (an earlier broad pass over next-tasks/roadmap/root-README was reverted to keep this PR narrow — that reduction is DOCS-002B). No file moves. No runtime/test/config/script changes.
- PR-review remediation (DOCS-002A-PR-REVIEW-REMEDIATION-v1): addressed five Codex target-PR findings on PR #375, still docs-only: (1) marked `docs/cfb-engineering-operating-instructions.md` **Historical/superseded** (README row + a status note atop the file) since it carries old phase-style prompt-ID guidance — current authority is `AGENTS.md` (binding) + `CLAUDE.md` (workflow) + `prompt-registry.md` (ledger); re-anchored CLAUDE.md's header/interaction citations to AGENTS.md/this-file. (2) Renamed the registry `## Active Prompts` heading to **"Prompt ledger (most recent first)"** so it reads as a historical ledger, not a backlog. (3) Fixed CLAUDE.md's prompt-registration timing to match `AGENTS.md` → "Documentation closeout timing" (finalized pre-merge after review/remediation, not merely "after execution"). (4) `DESIGN.md` no longer presented as fully reconciled — two known contradictions (standings rank owner-colored vs muted; game cards border vs none) tracked as a deferred design-cleanup follow-up. (5) Per-doc lifecycle metadata block explicitly deferred with its template recorded.
- Follow-ups: **DOCS-002B** — planning/history cleanup (reduce `next-tasks.md` to a concise queue + unresolved-decisions; reconcile the `roadmap.md` completed-work table's stale "Standings Page — Preseason State: Planned" vs the shipped section; trim `prompt-registry.md` to read strictly as a ledger; consolidate `roadmap.md` vs `next-tasks` status duplication). **DOCS-002C** — architecture/operations docs extraction + decide on an explicit `archive/` path for campaigns/phase records. Plus deferred **design-contradiction cleanup** and **doc lifecycle metadata rollout**. All recorded in `docs/README.md` → "Planned documentation work".

### DOCS-001B-GOVERNANCE-CORRECTNESS-DOCS-CLEANUP-v1

- Purpose: Governance-correctness docs cleanup + three-doc (`AGENTS.md`/`CLAUDE.md`/`DESIGN.md`) deconfliction, ahead of the PLATFORM-069+ audit sequence. Docs-only.
- Result: ✅ Done (PR #357). Removed stale hang/`TeamsDebugPanel` warnings; corrected the role model; documented the `gameOwnership.ts` current-season attribution invariant; established the docs-closeout timing rule; honest CSV wording; reconciled `next-tasks.md`; added the "Doc authority (source of truth)" headers to the three governance docs.
- Notes: Backfilled retroactively during DOCS-002B (the collapsed `next-tasks.md` Section 0 points here for per-item history). No runtime/test/config/script changes.

### DOCS-001A-DEPLOYMENT-RUNBOOK-SECRETS-PRIVACY-v1

- Purpose: Deployment-runbook secrets + privacy wording fix. Docs-only.
- Result: ✅ Done (PR #356). Corrected the `docs/deployment-runbook.md` secrets/privacy guidance.
- Notes: Backfilled retroactively during DOCS-002B (the collapsed `next-tasks.md` Section 0 points here for per-item history). No runtime/test/config/script changes.

### PLATFORM-081b-CLEANUP-DRYRUN-READONLY-v1

- Purpose: Tooling hotfix (no runtime alias change). An operator dry-run of `npm run cleanup:legacy-aliases` failed BEFORE reporting: every durable read goes through `ensureDatabase()`, which unconditionally ran `create table if not exists app_state` — DDL a read-only production connection rejects with SQLSTATE 25006 (`cannot execute CREATE TABLE in a read-only transaction`). No data was deleted, but the dry run couldn't inspect anything. Fix: dry-run must inspect existing keys without DDL/writes; `--apply` still requires a writable postgres connection.
- Scope: `src/lib/server/appStateStore.ts` — factored the table DDL into `APP_STATE_TABLE_DDL`; `ensureDatabase()` now catches 25006 and, when the table already exists, proceeds (READ callers succeed on a read-only connection); new exported `assertAppStateWritable()` runs the DDL STRICTLY (no tolerance) as a write-capability probe; exported `isReadOnlyTransactionError()` (exact-code detector). `scripts/cleanup-legacy-league-aliases.ts` — `--apply` calls `assertAppStateWritable()` up front and refuses on a read-only connection before any report/delete; dry-run skips it. New `src/lib/server/__tests__/appStateStore.test.ts`.
- Safety: Read-only tolerance is narrow — triggers ONLY on exact SQLSTATE 25006 AND only when the table already exists (a genuinely missing table still throws). Writers are unaffected (they fail on their own INSERT/DELETE), so nothing writes through the degraded path. PLATFORM-081 deletion safety rules are unchanged; `--apply` still requires `mode === 'postgres'` AND now a proven-writable connection. Runtime alias behavior untouched.
- Notes: Codex clean, no findings (first pass). Verification: `git diff --check`/`tsc`/`lint:all` clean; targeted tests 11/11 (9 legacy alias cleanup + 2 new appStateStore). Branch `platform/platform-081b-cleanup-dryrun-readonly`, PR #373.
- Follow-ups: Operator can now dry-run against a read-only connection, then `--apply` against a writable primary. Unblocked the PLATFORM-081 production `--apply` operator step, which has since been run — 3 legacy keys (`aliases:test:2025`, `aliases:test:2026`, `aliases:tsc:2025`) deleted, zero remaining on confirmation dry-run.

### DOCS-003-STANDINGS-PRESEASON-STATE-CONTRADICTION-VERIFICATION-v1

- Purpose: Resolve the tracked `STANDINGS-PRESEASON-STATE` table-vs-prose contradiction by verifying from source whether the preseason cold-cache blank-standings behavior shipped or a correctness gap remains. Verification/docs task — no runtime change unless a trivial docs/test naming mismatch.
- Result: **Docs-stale.** The fix shipped in the Season Launch Hardening campaign (Phase 2, commits `88af434` + `43516b0`) and is verified present + tested. `src/lib/selectors/leagueStandings.ts` defines the `CanonicalStandingsSource` value `'preseason-awaiting-kickoff'` + `inferredSeasonStart` field; the season/preseason empty paths call `getScheduleProbeState(year)` and return `preseasonAwaitingKickoffSnapshot(...)` (no `Date.now()` in the cached selector). `StandingsPanel.tsx` and `CFBScheduleApp.tsx` do the render-time kickoff check and show explicit copy ("Season starts {date}" / "Pre-season" → "Standings will appear once games are played."; post-kickoff/empty → "Standings unavailable. Contact your commissioner."). No path renders silently blank. Covered by `selectors-leagueStandings.test.ts` (future/past/no-probe kickoff + preseason cases). No `seasonStartDate` config field was needed (start inferred from the schedule probe).
- Scope: Docs only. `docs/next-tasks.md` — resolved the tracked contradiction item and corrected the stale INSIGHTS-017 backlog line (status table at line 39 was already correct). `docs/roadmap.md` — retitled the "(planned)" section "(✅ shipped)" and removed the stale "silently blank"/"Prompt ID to assign" wording. This registry entry. No `src`/test edits, so no runtime invariants touched (canonical standings source-of-truth, PLATFORM-070/071 invalidation, PLATFORM-075 quota all intact).
- Verification: `git diff --check` clean. Post-edit grep confirms no remaining doc claims the standings page renders "silently blank" as an open issue. `tsc`/`lint:all` not run (docs-only, no runtime/test files changed). Branch `docs/standings-preseason-state-verification`.
- Follow-ups: None identified. Next queued: deferred product decisions (CSV current-season guard, owner-identity mapping, whether to schedule PLATFORM-040); `STANDINGS-PAGE-LIFECYCLE-LABELING` remains a separate planned polish item (broader lifecycle-label audit, distinct from this preseason-state fix).

### PLATFORM-081-SEED-KEY-CLEANUP-LEGACY-LEAGUE-SCOPED-ALIASES-v1

- Purpose: Clean up redundant legacy `aliases:${slug}:${year}` seed-copy app-state keys left behind after the PLATFORM-067 alias migration made runtime resolution ignore league-scoped keys. Touches production data → verify code paths, prefer dry-run/reporting, delete only keys proven redundant, preserve alias precedence (stored global → year → SEED), never reintroduce league-scoped runtime aliases.
- Deletion status: **Delivered as a manual operator step — NOT automated** (this session cannot touch production data); tooling is dry-run by default with `--apply` gated. **The operator step has since been run:** 3 legacy keys (`aliases:test:2025`, `aliases:test:2026`, `aliases:tsc:2025`) deleted from prod, confirmation dry-run found zero remaining.
- Scope: New `src/lib/server/legacyAliasCleanup.ts` — `parseAliasScope` (classifies a scope as global/year/league/other; league = 3-part `aliases:${slug}:${year}` with a 4-digit year and slug≠`global`), `classifyLeagueScopedAliasMap(map, storedGlobal)` (per-entry: seed-copy vs promoted-repair vs un-promoted-repair), `reportLegacyLeagueScopedAliases()` (read-only discovery), `cleanupLegacyLeagueScopedAliases({apply})` (dry-run default). New `scripts/cleanup-legacy-league-aliases.ts` + `npm run cleanup:legacy-aliases`. New `src/lib/server/appStateStore.ts` `listAppStateScopes(scopePrefix?)` (Postgres `select distinct scope` / file-store scan) so cleanup can discover scopes for leagues that may no longer be registered. Tests in `src/lib/server/__tests__/legacyAliasCleanup.test.ts`.
- Safety model: Runtime never reads `aliases:${slug}:${year}` (PLATFORM-067 — `getScopedAliasMap` ignores the slug; verified across draft/win-totals/debug/insights/standings/schedule/scores). A league key is deletable only when EVERY entry is either (a) a copied seed default (`isCopiedSeedDefault`) or (b) a manual repair whose EXACT target is already live in the stored global map. Promotion is judged **per entry against the real `aliases:global` map, NOT the `migration-done` sentinel** — the promotion migration only scans registered slugs in a bounded year window, so an unregistered/out-of-window scope can hold an un-promoted repair even with the sentinel set. Value (not just key) must match, because `aliases:global` can hold a demoted copied seed default at the same key (`uh → houston`) while the league scope repairs it elsewhere (`uh → Hawaii`); the migration would overwrite the demoted copy with the repair, so a bare key-existence check would delete the only copy. Refuses global/year/non-alias scopes structurally + defense-in-depth re-check before each delete. CLI loads `.env.local`/`.env` and refuses to run unless `getAppStateStorageStatus().mode === 'postgres'` (never mutates the file fallback). Legacy migration scan **kept** (a per-datastore sentinel can't be proven set across all deployments; cheap no-op once done).
- Notes: Three Codex rounds. Round-1 two P2s: (1) `safeToDelete` trusted the sentinel → fixed to per-entry promotion check; (2) script accessed app-state before loading env → silent file fallback → fixed with dotenv + postgres storage gate. Round-2 one P1: promotion counted key-existence, so a repair over a demoted seed copy was a false positive → fixed to require the stored global VALUE to equal the repair's target. Round-3 clean. Tests (9): runtime ignores league keys; report identifies legacy keys without mutating; cleanup preserves global/year/unrelated scopes; dry-run deletes nothing + `--apply` removes pure seed-copy but skips un-promoted repairs; promoted-via-global deletable; demoted-seed-copy repair skipped; un-promoted repair skipped despite sentinel. Verification: `tsc`/`lint:all` clean; targeted suite 9/9. Branch `platform/platform-081-seed-key-cleanup`, commits `b49714a`…`c739bd3`.
- Follow-ups: Production `--apply` run ✅ done — operator ran the cleanup against prod and safely deleted 3 legacy keys (`aliases:test:2025`, `aliases:test:2026`, `aliases:tsc:2025`); confirmation dry-run found zero remaining legacy league-scoped alias keys. **Dry-run hotfix → PLATFORM-081b** (the dry run hit a read-only-connection DDL failure in production; fixed so it inspects without writes). Next queued: deferred product decisions (CSV current-season guard, owner-identity mapping, whether to schedule PLATFORM-040).

### PLATFORM-080-IN-SESSION-FINALIZED-GAME-RSC-REFRESH-v1

- Purpose: Fix the pre-existing in-session standings staleness surfaced in the PLATFORM-079a review — when a live score poll observes a game finalize, `scoresByKey` updates but the RSC `canonicalStandings` prop stays fixed and `liveDelta` excludes final games, so records/ranks don't update until navigation. Trigger a narrowly-scoped RSC refresh only on a real finalization transition; do NOT revive client standings derivation.
- Scope: `src/components/hooks/useLiveRefresh.ts` — new pure, exported `detectScoreFinalizations({nextScores, scopeGameKeys, observedKeys, finalKeys})` that returns true only on a real non-final→final transition (classifies via canonical `classifyScorePackStatus`); new optional `onGamesFinalized` param + two memory refs (`observedScoreKeysRef`/`finalizedScoreKeysRef`) + a per-poll detection call after `setScoresByKey`. `src/components/CFBScheduleApp.tsx` — `handleGamesFinalized` (`router.refresh()`) wired to `onGamesFinalized`. `src/components/hooks/__tests__/useLiveRefresh.test.ts` — 5 regression cases.
- Notes: **Why `router.refresh()` suffices** — `getCanonicalStandings` is `unstable_cache`-wrapped (cached until `revalidateTag`), but the `/api/scores` write path already calls `invalidateStandingsForYear` when it writes a final, so the tag is busted and `router.refresh()`'s recompute picks up the new final. Recompute reads only the cache-only score/schedule caches → no client `deriveStandings` reintroduced and no upstream provider fetch (PLATFORM-075 intact); manual authorized refresh + postseason-override refresh unchanged. **Transition semantics:** `observedKeys` is seeded from the watched SCOPE (`scoreScopeForRequest` keys), not the score payload — so a scheduled game with no attached score row (cold/stale public cache or failed attach) is still tracked and its later finalization fires; seeding happens AFTER the final-check so initial already-final / enter-scope-already-final games never self-trigger, and `finalKeys` suppresses repeat finals. Two Codex rounds: round-1 P2 (detector missed watched-but-scoreless scheduled games because observed was seeded from the score payload) fixed by seeding from scope + a dedicated regression test; round-2 clean. Verification: `tsc`/`lint:all`/`git diff --check` clean; finalization tests 5/5, component+hooks sweep green; `git grep deriveStandings src/components src/app` shows only comments + the distinct `deriveStandingsInsights`/`deriveStandingsMovementByOwner` selectors. Branch `platform/platform-080-in-session-finalized-game-rsc-refresh`, commits `595c024`…`ba15e6b`.
- Follow-ups: None new. Seed-key cleanup remains the next queued item.

### PLATFORM-079b-ADMINDEBUGSURFACE-USELIVEREFRESH-DEAD-PLUMBING-CLEANUP-v1

- Purpose: Remove the PLATFORM-078-deferred `AdminDebugSurface` + `surface==='admin'` path and the now-dead state/handler/hook-prop chain it was the sole consumer of. (079b of a split PLATFORM-079; resolves the PLATFORM-078 AdminDebugSurface deferral.)
- Scope: Deleted `src/components/AdminDebugSurface.tsx`. `src/components/CFBScheduleApp.tsx` — removed its import/render + the `surface` prop (type + default) + every `isAdminSurface` branch (collapsed to the league path) + dead `leagueHref`; removed the 7 useState only AdminDebugSurface read (schedule meta, odds cache state, odds/schedule refresh timestamps, `diag`, owners-cache flags) and their setter calls in the reset fn + `loadScheduleFromApi`; removed the `clearCachedOwners`/`onOwnersFile` handlers + orphaned `clearOwnersDerivedState` + now-dead imports (`DiagEntry`/`ScheduleFetchMeta`/`LEGACY_STORAGE_KEYS`/`saveServerOwnersCsv`); stopped capturing the unused `refreshLiveData` return. `src/components/hooks/useLiveRefresh.ts` — dropped admin-only params `setDiag`/`setOddsCacheState`/`setLastOddsRefreshAt` (interface + destructure + internal calls + deps) and orphaned `scoreDiag`/`cacheState` locals. `src/components/hooks/useScheduleBootstrap.ts` — dropped `setHasCachedOwners`/`setOwnersLoadedFromCache` params + pass-through calls + deps. `src/components/__tests__/CFBScheduleApp.test.tsx` — removed the admin-surface-only test.
- Notes: `AdminDebugSurface` was reachable only through `CFBScheduleApp`'s `surface==='admin'` branch, which no production route mounts (only a test did). `refreshLiveData` and the `manual` authorized-refresh machinery are RETAINED — `refreshLiveData` powers internal auto-refresh (useEffect), and `manual` still authorizes upstream scores/odds refresh (PLATFORM-075 semantics unchanged); it simply has no live caller now. No change to debug/API auth (PLATFORM-074), provider quota policy (PLATFORM-075), or the 079a canonical sourcing (no client `deriveStandings` reintroduced). The 26 league-surface `CFBScheduleApp` tests already exercise the live paths without the admin plumbing. Net −303 lines. Verification: `tsc`/`lint:all`/`git diff --check` clean; component+hooks+bootstrap sweep 266/266; Codex clean first pass. Branch `platform/platform-079b-admindebugsurface-removal`, commit `6417580`.
- Follow-ups: Preserved-as-unresolved — the 079a in-session finalized-game RSC-refresh follow-up (pre-existing; own scoped task). None new.

### PLATFORM-079a-CFBSCHEDULEAPP-CANONICAL-STANDINGS-v1

- Purpose: Retire the client-side `deriveStandings` path in `CFBScheduleApp` (outside `src/lib/selectors/`) and source Members owner options/selection + owner colors + standings-fed surfaces from the canonical selector output, eliminating a parallel client derivation that could drift from canonical. (079a of a split PLATFORM-079; 079b = AdminDebugSurface removal.)
- Scope: `src/components/CFBScheduleApp.tsx` — removed the `standingsSnapshot`/`standingsCoverage`/`standingsHistory` memos (and the now-orphan `hasScoreLoadError`) plus the `deriveStandings`/`deriveStandingsCoverage`/`deriveStandingsHistory` imports; introduced `canonicalRows`/`canonicalHistory`/`canonicalCoverage`/`canonicalOwnerColorOrder` locals off the `canonicalStandings` prop and wired every consumer to them: `deriveOwnerViewSnapshot` (owner options + header), `buildOwnerColorMap` (colors, canonical order only — dropped the in-session roster supplement), `deriveOwnerMatchupMatrix`, `selectSeasonContext`, `resolveOverviewCanonicalInputs`, and the Overview/Standings panel `rows`/`coverage`/`standingsHistory` props. `src/components/__tests__/CFBScheduleApp.test.tsx` — added a `canonicalStandings` fixture helper, a regression test (client roster carries only "Zed", canonical only "Alice" → picker offers Alice never Zed), and supplied canonical to the 5 renders that relied on the removed client fallback. No changes to OwnerPanel/ownerView/panels/selectors — they already prefer canonical and now simply receive canonical-sourced inputs.
- Notes: Verified (via subagent map) canonical is guaranteed present at all 4 league routes (`getCanonicalStandings` never returns null/undefined; pages pass it unconditionally) and that every records-bearing surface already resolved `canonicalStandings?.rows ?? clientRows` → canonical won in production. So 079a removed a client value production already discarded — behavior-preserving; live in-session standings updates continue via the client `liveDelta` overlay over canonical. Split from the AdminDebugSurface work to keep each patch focused/reviewable (user decision). Verification: `tsc`/`lint:all`/`git diff --check` clean; affected component+selector sweep 271/271. Branch `platform/platform-079-cfb-schedule-app-canonical-standings`, commit `4c267b6`.
- Follow-ups: (1) **079b** — the PLATFORM-078-deferred `AdminDebugSurface` + `surface==='admin'` removal + `useLiveRefresh` dead-plumbing cleanup (separate branch/PR). (2) **Pre-existing (deferred, ID TBD)** — in-session standings staleness: a live score poll that finalizes a game updates `scoresByKey` but not the RSC `canonicalStandings` prop, and `liveDelta` excludes final games, so the new final isn't reflected until navigation/refresh. Predates 079a (all records surfaces already preferred the equally-stale canonical rows). Codex flagged it P2 on 079a; verified pre-existing, user deferred. Fix = `router.refresh()` on an actual scheduled→final transition after a score poll (mirrors the postseason-override path); touches the PLATFORM-075 refresh path, so own task.

### PLATFORM-078-DEAD-CODE-SWEEP-ALIASES-TEAMNAMES-ADMINDEBUGSURFACE-v1

- Purpose: Conservative P3 dead-code sweep — remove only code proven unreferenced/unreachable by static search; do not trust the candidate list blindly.
- Scope: Deleted `src/lib/aliases.ts` (whole module) and trimmed `src/lib/teamNames.ts` to `AliasMap` + `SEED_ALIASES` (removed `applyAliases`/`normWithAliases`/`variants` + the `normalizeTeamName`/`stripDiacritics` re-export + the now-unused `./teamNormalization` import). No runtime/live-path changes.
- Static-search evidence: `src/lib/aliases.ts` — `git grep "from '.../lib/aliases'"` → 0 importers; all 11 exports (`AliasEntry`/`AliasFile`/`AliasMap`/`OverrideMap`, `normalizeLabel`, `buildAliasMap`, `loadOverrides`, `saveOverrides`, `resolveCanonical`, `loadAliasMap`, `setAliasMapCache`) unimported; only surviving mentions are comments in `draft/board/boardData.ts`. `teamNames.ts` helpers — `git grep "applyAliases|normWithAliases|variants("` → 0 external callers (used only by each other); every `teamNames` importer (`draftSchedule`, `CFBScheduleApp`, `useLiveRefresh`, `useScheduleBootstrap`, `loadInsights`, `rankings.test`) uses only `AliasMap` or `SEED_ALIASES`.
- NOT deleted (documented per the "if still referenced/reachable, do not delete" guardrail): `AdminDebugSurface` + `surface==='admin'`. Static search contradicted the "unreachable branch" framing — it is imported/rendered by `CFBScheduleApp` and reachable via the component's own `surface` prop (test-mounted in `CFBScheduleApp.test.tsx`; no production *route* mounts it), and is the sole consumer of a web of otherwise-write-only `CFBScheduleApp` state (schedule meta, odds cache state, refresh timestamps, `diag`, owners-cache flags) + `clearCachedOwners`/`onOwnersFile` handlers + manual `refreshLiveData`, several passed into the shared `useLiveRefresh` hook. A trial full removal measured a 10-orphaned-binding blast radius requiring edits to `useLiveRefresh`'s signature + multiple live refresh handlers — architecture cleanup + live-path change beyond a focused sweep. Deferred to PLATFORM-079 (already touches `CFBScheduleApp`) or a dedicated 078b.
- Verification: `tsc`/`lint:all`/`git diff --check` clean; targeted tests (`CFBScheduleApp.test.tsx` + `rankings.test.ts` + `conferenceSubdivision.test.ts`) 49/49; final grep for removed symbols → none. Codex clean first pass. Branch `platform/platform-078-dead-code-sweep`, commit `339d030`.

### PLATFORM-077-INSIGHTS-CANONICAL-GAMES-IN-PROCESS-v1

- Purpose: Stop Insights from HTTP self-fetching its own app routes and privately rebuilding schedule/game state; consume the same canonical in-process game/lifecycle inputs production standings use.
- Scope: `src/lib/insights/loadInsights.ts` (drop `next/headers`/`deriveOrigin`/`fetchJson` and the `/api/schedule` + `/api/teams` self-fetches; read schedule items, team catalog, effective aliases, and postseason overrides in-process, then build games via `buildScheduleFromApi` now passing `manualOverrides`), new `src/lib/server/canonicalScheduleCache.ts` (`loadCachedScheduleItems(year)` = cache-only durable `schedule` app-state read, quota-safe; `loadPostseasonOverrides(slug, year)`), `src/lib/selectors/leagueStandings.ts` (its private `loadScheduleItems`/`loadManualOverrides` delegate to the shared module — one implementation, no behavior change). Test: `loadInsights.test.ts` asserts zero HTTP fetches while a non-offseason lifecycle is driven from the seeded in-process schedule cache.
- Notes: The self-fetch was server-calling-its-own-routes-over-HTTP — bypassing the in-process pipeline and (subtly) omitting `manualOverrides`, so Insights' `games` could diverge from the standings the same function already consumes via `getCanonicalStandings`. Fix aligns Insights' game build exactly with `liveDeriveStandings` (identical inputs → identical `AppGame[]`). Considered exposing `games` off `getCanonicalStandings` instead, but it is `unstable_cache`-wrapped, so adding the full games array would bloat every standings snapshot across all consumers — rebuilding in-process from shared readers is leaner and changes no cache contract. The schedule read is deliberately cache-only: Insights never triggers an upstream provider fetch, and the prior anonymous self-fetch already only ever got cache/stale/503 (never upstream), so behavior is preserved and made explicit. Codex clean first pass. Verification: `tsc`/`lint:all`/`git diff --check` clean; loadInsights 5/5; affected insights/standings/selectors/schedule sweep 157/157. Branch `platform/platform-077-insights-canonical-games-in-process`, commit `4d6dad7`.
- Follow-ups: pre-existing parity question (out of scope) — `liveDeriveStandings` builds games without `conferenceRecords` (Insights now matches); whether canonical standings should pass them is PLATFORM-070-adjacent. Deferred ownership-attribution parity (PLATFORM-039) remains untouched.

### PLATFORM-076-DEBUG-ROUTE-CANONICAL-PARITY-v1

- Purpose: Make `/api/debug/*` diagnostics trustworthy by resolving identity/schedule/attachment against the SAME canonical pipeline production uses, instead of a weaker parallel one. Concretely (the V9 audit items): effective aliases (`?scope=effective`), `providerWeek` in the postseason debug index, and `manualOverrides`/`observedNames` surfaced in the identity diagnostics.
- Scope: `src/app/api/debug/_lib/loadDebugSeasonContext.ts` (fetch aliases at `?scope=effective` = stored global > year > SEED, matching `getScopedAliasMap('', year)`; forward the caller's admin credentials on all four context sub-requests so a cold admin-gated `/api/conferences` can't 503-degrade to `[]`; now takes `req`), `src/app/api/debug/scores/route.ts` (use the shared loader → gains `conferenceRecords` + effective aliases; was inlining fetches that omitted conferences and reset the conference index → wrong eligible-game set; adds `canonicalGamesTotal`/`gamesTruncated`), `src/app/api/debug/postseason-score-attachment/route.ts` (`providerWeek` in the `buildScheduleIndex` input + output; `closestCandidate` compares canonical identity keys via `resolveTeamIdentityKey` instead of raw-label `!==`, and matches week against canonical+provider; `extractRows` defaults null provider `seasonType` to the fetched type), `src/app/api/debug/resolve-team/route.ts` + `schedule-eligibility/route.ts` (effective scope; surface `aliasScope`/`observedNames`; `resolve-team` reports the matched `manualAliasOverride`). New tests: `debug/scores/__tests__`, `debug/resolve-team/__tests__`, extended `postseason-score-attachment` suite.
- Notes: Root cause was uniform — debug routes fetched `/api/aliases?year=` (the year-only stored editor view) rather than the effective resolver map, so every identity/eligibility verdict resolved against a strictly weaker alias set than production. Audited all 14 debug routes via four parallel read-only analyses; `debug/schedule`, `debug/scores-attachment`, `conference-diagnostics`, and both insights routes were already canonical. **Deliberately deferred (recorded in next-tasks, preserved as unresolved):** archive-audit/archive-integrity ownership attribution re-derives game→owner with resolver-keyed matching vs production's raw-label `getGameOwners`/`deriveFinalOwnedParticipations` — entangled with the PLATFORM-039 historical raw-label deferral (fixing it aligns the audit to production's *deferred* behavior and reduces its precision), so it belongs to a separate ownership-parity follow-up; `game-stats-diagnostic` `resolveOwner` key-space mismatch (bespoke, no canonical counterpart); `schedule-eligibility` inline per-row eligibility vs `resolveRegularSeasonRow` (verdicts agree today, drift risk only); `insights-career-diagnostic` skips `computeRosterFallback`. Two Codex rounds converged (round 1 P2: shared loader wasn't forwarding admin auth → cold `/api/conferences` 503 silently degraded conference classification; round 2 clean). Verification: `tsc`/`lint:all`/`git diff --check` clean; debug suites 6/6; related identity/schedule/attachment/aliases suites 144/144. Branch `platform/platform-076-debug-route-canonical-parity`, commits `dadf006`…`4711078`.
- Follow-ups: the deferred ownership-attribution parity (archive + game-stats) is a coherent next task; `schedule-eligibility` orchestrator refactor and the `computeRosterFallback`/`conference-diagnostics` cold-instance notes are lower priority.

### PLATFORM-075-PROVIDER-QUOTA-HARDENING-PUBLIC-STALE-READS-v1

- Purpose: Protect the CFBD/Odds monthly quotas from public traffic by making the public `/api/odds` and `/api/scores` surfaces pure cache readers — anonymous requests never trigger a cold-cache upstream fetch — while keeping authorized refresh, admin diagnostics, and best-effort public freshness intact. Also: put `season` in the in-memory odds cache key and remove the dead `dayKey`.
- Scope: `src/app/api/odds/route.ts` (season-scoped in-memory key; anonymous path serves fresh hit / stale fallback / empty and never fetches — only `refresh=1` gated by `requireAdminAuth` fetches; filtered/non-canonical reads build from their own events with `seedDurableStore=false` so the full durable snapshot never leaks; `dayKey` removed), `src/app/api/odds/routeInternals.ts` (drop `dayKey` from the cache type/initializer/reset), `src/app/api/scores/route.ts` (anonymous cache-only; season-wide read aggregates the season snapshot + per-week caches in one `getAppStateEntries('scores', '${year}-')` read, deduped by canonical game identity via `teamIdentity`, newest-entry-wins; controlled empty 200 so the loader never fans out), `src/lib/server/appStateStore.ts` (`getAppStateEntries<T>(scope, keyPrefix?)`), `src/lib/scores/types.ts` (`ScoresMeta.cache` gains `'stale'`; `CfbdFallbackReason` gains `'upstream-suppressed'`; ESPN event/competition `date`), `src/lib/scores/normalizers.ts` (`toScorePackFromEspn` carries the ESPN kickoff date), `src/lib/scores.ts` + `src/components/hooks/useLiveRefresh.ts` + `src/components/admin/GlobalRefreshPanel.tsx` (thread `refresh=1` + admin auth headers on the admin/manual refresh paths only), `src/app/api/debug/{scores,scores-attachment,postseason-score-attachment}/route.ts` + `_lib/loadDebugSeasonContext.ts` (`forwardAdminAuthHeaders`; diagnostics fetch with `refresh=1` + forwarded admin auth). Tests across the odds/scores routes, scope, normalizers, and `useLiveRefresh`.
- Notes: Product call resolved as interpretation A — public is a pure cache reader; all upstream fetches require an authorized `refresh=1` (platform admin / server cron / `ADMIN_API_TOKEN` via `requireAdminAuth`); the league-password gate grants no fetch authority; public freshness is best-effort and quota protection wins. The hard part was the season-wide scores reconciliation: eight Codex rounds evolved it from a 200-empty (hid warm week caches) → 503 (client fan-out) → server-side week-level merge (double-counted postseason provider/canonical week aliases; an empty newer week entry erased season rows) → final **row-level dedup by canonical `teamIdentity` (pair + UTC date)**, which required populating the ESPN kickoff date so cross-provider rows key identically. Odds filtering had a parallel arc: cold filtered reads leaked the durable snapshot (round 5) then warm filtered hits still did (round 7) → `seedDurableStore` gate so only canonical queries read the durable store. Final round clean. Verification: `tsc`/`lint:all`/`git diff --check` clean; affected sweep 177/177. Follow-up risk recorded below. Branch `platform/platform-075-provider-quota-hardening`, commits `6c5827d`…`3e5d139`.
- Follow-ups: public reads no longer warm the cache, so season-persistent odds/scores freshness now depends on the authorized `refresh=1` paths (admin action + any server cron) — confirm a cron or scheduled refresh keeps caches warm in production. `getAppStateEntries` is year-prefixed but still a scan; fine at current key counts.

### PLATFORM-074-DEBUG-ROUTES-PLATFORM-ADMIN-MIDDLEWARE-GATE-v1

- Purpose: Gate the `/debug/*` browser page family behind platform-admin authorization (the `/debug/teams` page had no server-side gate) and consolidate the platform-admin definition into one shared predicate.
- Scope: `src/lib/auth/platformAdmin.ts` (new — `isPlatformAdminClaims(sessionClaims)` = app role at `publicMetadata.role`; `requiresPlatformAdminPage(pathname)` = `/admin` + `/debug` families, prefix-or-segment match, `/api/*` excluded), `src/middleware.ts` (gate `/admin/*` + `/debug/*` via the shared helpers; removed the inline `publicMetadata.role` check; fail-closed redirects), `src/lib/server/adminAuth.ts` (`isPlatformAdminSession` delegates its role decision to `isPlatformAdminClaims`). New test: `src/lib/auth/__tests__/platformAdmin.test.ts`.
- Notes: `/api/debug/*` is intentionally NOT middleware-gated — all 12 routes already call `requireAdminAuth` at the route boundary (PLATFORM-020), which uniquely supports the `ADMIN_API_TOKEN` fallback middleware can't express. The four concerns stay distinct: Clerk auth, Clerk admin role, league password (`LEAGUE_AUTH_SECRET`), admin API token. Satisfies AGENTS.md Auth invariant #6 (no inline `publicMetadata.role` checks outside the shared helper — verified zero remain). Middleware wiring is a thin layer over the two pure functions (not executed under `node:test`; its logic is fully unit-covered). Codex review clean first pass. Verification: `tsc`/`lint:all`/`git diff --check` clean; new suite 6/6; existing `admin-debug-auth` 13/13; auth sweep 35/35. PR #364.

### PLATFORM-073-POSTSEASON-ATTACHMENT-EDGE-CASES-v1

- Purpose: Fix three postseason edge cases in the canonical score/schedule attachment layer without introducing cross-phase mismatches or missing provider-id matches.
- Scope: `src/lib/scoreAttachment.ts` (index by `providerGameId` independent of team hydration; null-`seasonType` rows scored per phase with cross-phase-rematch refusal that defers to a kickoff-date tiebreak; per-side provider-id side-attribution guard; `attachScoresToSchedule` stores in schedule orientation via `match.orientation`), `src/lib/schedule.ts` (explicit `hasRegularSeasonContext` guard on the postseason week remap). New tests: `lib/__tests__/postseasonAttachmentEdges.test.ts`.
- Notes: Odds attachment uses a separate pair-keyed index (`gameAttachment.ts`, no provider-id path), so defect 1 is scoped to the score path. Seven Codex rounds converged: the provider-id path had to become resolution-independent (for placeholder hydration) yet side-safe (accept only when every KNOWN schedule side is confirmed in the row's corresponding position), and the review surfaced a pre-existing reversed-orientation standings-corruption bug — `attachScoresToSchedule` had ignored `match.orientation` and stored positionally — now fixed by storing home/away in schedule orientation (covers provider-id, `reversed_pair_week`, and `pair_date`). Final round clean. Verification: `tsc`/`lint:all`/`git diff --check` clean; new suite 12/12; full attachment / schedule / standings / seasonRollover / selectors suites 216/216. PR #363.

### PLATFORM-072-POST-CONFIRM-DRAFT-EDIT-OWNERSHIP-DRIFT-v1

- Purpose: Fix ownership drift when a draft pick is edited after confirmation. Confirmation copies picks into a separate persisted store (`owners:${slug}:${year}` / `'csv'`) that `parseOwnersCsv` → `gameOwnership` → standings consume; `PUT /pick/[n]` permits editing while `phase === 'complete'` but only updated draft state, so the confirmed CSV (and warm standings snapshot) kept crediting the old team→owner.
- Scope: `src/lib/draft.ts` (extracted the shared owners-CSV serialization: `buildConfirmedOwnersCsv` now returns `{ csv, rowCount }` with a structural count; new `patchConfirmedOwnersCsv` applies a single edit; shared `serializeOwnerRows` + `parseOwnersCsv` round-trip), `src/app/api/draft/[slug]/[year]/confirm/route.ts` (use the shared builder; validate the structural `rowCount` instead of splitting on `\n`), `src/app/api/draft/[slug]/[year]/pick/[n]/route.ts` (post-confirm edit patches the persisted CSV + `invalidateStandings(slug, year)`; passes its canonical resolver in). New tests: `draft/[slug]/[year]/__tests__/post-confirm-edit.test.ts` (route-level) + unit tests in `lib/__tests__/draft.test.ts`.
- Notes: Only `phase === 'complete'` resyncs; pre-confirm phases (incl. a draft reopened via confirm `DELETE`, which intentionally holds the last confirmed CSV until re-confirm) are unchanged. The patch MOVES the pick's claim (old-team→new-team) rather than rebuilding from picks, so it preserves unrelated `/api/owners` admin repairs. Five Codex rounds converged: split-newline row count → structural `rowCount`; full rebuild clobbering overrides → targeted patch; stale draft owner name after a correction → derive owner from the persisted `oldTeam` row; `NoClaim` prior row → fallback to draft owner; raw alias match → resolve rows through `teamIdentity` (route passes the resolver). Final round clean. Verification: `tsc`/`lint:all`/`git diff --check` clean; post-confirm suite (6) + draft unit tests + related suites (153) green. PR #362.

### PLATFORM-071-CRON-PRESEASON-STANDINGS-INVALIDATION-SWEEP-v1

- Purpose: Close the remaining documented `invalidateStandings` gaps for season-lifecycle and preseason ownership flows — mutations that change a league's standings surface but left the cached canonical snapshot stale (hard-refresh workaround).
- Scope: `src/app/admin/[slug]/actions.ts` (`confirmPreseasonOwners` → `invalidateStandings(slug, year)` before redirect; `beginPreseason` → `invalidateStandings(slug)`), `src/app/api/cron/season-rollover/route.ts` (per successfully rolled-over league, inside the loop), `src/app/api/cron/season-transition/route.ts` (per transitioned league, bound to the successful `updateLeagueStatus` flip — before the separate `updateLeague` year-sync so a failing year-sync can't strand a stale snapshot), `src/lib/selectors/leagueStandings.ts` (docstring: paths moved from "Known gaps" to "Wired into"; stale global-alias enumeration note corrected to the PLATFORM-070 shared-tag model). New tests: `admin/[slug]/__tests__/actions.test.ts`, `api/cron/season-rollover/__tests__/route.test.ts`, `api/cron/season-transition/__tests__/route.test.ts`.
- Notes: All four flows are league-scoped → per-league `invalidateStandings` (umbrella tag covers all cached years); no global tag, no registry enumeration. Failure/unauthorized/no-op/skip paths do not invalidate. Deliberately not wired (recorded in the docstring): `completeSetup` (setupComplete flag; no standings-content change) and the `slug='test'` dev-tooling actions. Three Codex rounds: runtime design accepted clean; fixed a transition invalidation-ordering edge case (P2 — invalidate on the status flip, not after the year-sync) and season-transition test determinism vs an inherited `CFBD_API_KEY` (P2 — stub upstream fetch). Verification: new suites (actions 3/3, rollover 4/4, transition 3/3) + related 141/141 + broader sweep 35/35; `git diff --check`/`tsc`/`lint:all` clean. Commit `957956d`; PR #361.

### PLATFORM-070-TEAM-DB-WRITES-STANDINGS-INVALIDATION-v1

- Purpose: Close the team-database write → canonical standings invalidation gap. `POST /api/admin/team-database` resynced the catalog (via `setTeamDatabaseFile`) but never invalidated standings, so warm `unstable_cache` snapshots kept resolving against the pre-sync catalog (team identity/canonical IDs/derived alts/FBS-FCS classification consumed by `computeCanonicalStandings` via `getTeamDatabaseItems()`).
- Scope: `src/lib/selectors/leagueStandings.ts` (add `ALL_STANDINGS_TAG` to every snapshot's tags; `invalidateAllLeaguesStandings()` busts that one shared tag — synchronous, no registry enumeration), `src/app/api/admin/team-database/route.ts` (invalidate after the write), `src/app/api/aliases/route.ts` (route the two global-scope invalidations through the shared helper), `src/lib/server/teamDatabaseStore.ts` (replace the process-lifetime `memoryStore` singleton with per-request `React.cache` so catalog reads are cross-instance fresh). New tests: `admin/team-database/__tests__/route.test.ts`, `lib/server/__tests__/teamDatabaseStore.test.ts`; updated `aliases/__tests__/route.test.ts` to the shared tag.
- Notes: Year/league-scoped mutations still use `invalidateStandings(slug, year)` unchanged. Design converged across three Codex rounds — P2 (registry-read ordering) → P1 (cross-instance catalog staleness defeated tag invalidation) → P2 (pre-write snapshot registry race) — landing on a single shared tag (race-free, no post-commit `getLeagues()` to fail) plus per-request catalog reads. Alias precedence unchanged (`stored global → year → SEED_ALIASES`); no league-scoped runtime aliases; no second resolver. Deferred (unchanged): `confirmPreseasonOwners` action + cron season transitions → PLATFORM-071. Verification: affected/related suites green (192/192 combined), `git diff --check`/`tsc`/`lint:all` clean; final Codex review clean ("The patch correctly invalidates canonical standings after global catalog or alias mutations and removes the stale process-level team catalog cache. No actionable regressions were identified."). Commit `ead1120`; PR #360.

### PLATFORM-069-DRAFT-WIN-TOTALS-CANONICAL-ALIAS-SOURCE-v1

- Purpose: Fix the remaining draft/win-totals alias-source bypass after PLATFORM-067 — resolve team names through the shared canonical scoped alias source instead of a locally built year+seed map that ignored stored global aliases.
- Scope: `src/app/api/draft/[slug]/[year]/pick/route.ts`, `pick/[n]/route.ts`, and `src/app/api/admin/win-totals/route.ts` — each replaced its `{ ...SEED_ALIASES, ...aliases:${year} }` construction with `getScopedAliasMap('', year)` (precedence **stored global → year → SEED_ALIASES**). Matching still flows through `createTeamIdentityResolver`; no second resolver, no local precedence. Tests: `pick-eligibility.test.ts` (stored-global regressions for POST /pick + PUT /pick/[n] + no-alias control) and new `win-totals-alias-source.test.ts` (stored-global honored/persisted-canonical, control unresolved, seed + year-scoped fallbacks preserved).
- Notes: `confirm/route.ts` inspected — writes already-canonical eligible team names, resolves no raw labels, so unchanged. No league-scoped runtime aliases reintroduced; no unrelated runtime behavior changed. Post-confirm draft-edit ownership drift remains **PLATFORM-072** (out of scope). Verification: new suites 12/12; related draft/teamIdentity/alias/odds suites 162/162; `git diff --check`, `tsc --noEmit`, `lint:all` clean. Independent Codex review clean ("The changed routes consistently use the canonical scoped alias source while preserving existing resolution and eligibility behavior. No actionable regressions were identified."). Commit `996a0f4`; PR #359.

### PLATFORM-067-REMOVE-LEAGUE-ALIAS-LAYER-v1

- Purpose: Remove league-scoped aliases from canonical alias resolution — team aliases are not league-specific (settled product decision). Final runtime precedence: **stored global → year → SEED_ALIASES**. Unblocked by the PLATFORM-066 production data check.
- Scope: `src/lib/server/globalAliasStore.ts` (`getScopedAliasMap` drops the `aliases:${slug}:${year}` layer; precedence docs). Precedence-comment sweep across draft (`draftSchedule.ts`, `board/boardData.ts`, `draft/page.tsx`), `bootstrap.ts`, `selectors/leagueStandings.ts`, `owners`/`owners/validate` routes, `debug/{archive-audit,game-stats-diagnostic}` routes, `aliasesApi.ts`, `storageKeys.ts`, `CFBScheduleApp.tsx`. Tests rewritten to assert league-scope is ignored / global>year across store, aliases route, canonical standings, draft, board, season rollover, insights, owner validation.
- Notes: `getScopedAliasMap(_leagueSlug, year)` keeps the slug arg for API/call-site compatibility but it no longer affects resolution. **PLATFORM-066 production data check** found NO unique league-scoped repairs — all prod `aliases:${slug}:${year}` entries (`test:2025`, `test:2026`, `tsc:2025`) were copied current-seed defaults already represented in `aliases:global` + `SEED_ALIASES`, so **no migration was required** (prod migration sentinel already set). The legacy migration scan (`migrateYearScopedAliasesToGlobal`, incl. its league-scope arm) is **retained as a safety net** for historical app-state; its tests are unchanged. Redundant production league-scoped seed-copy keys were **NOT** deleted. Preserved: `getGlobalAliases`, `getStoredGlobalAliases`, `mergeAliasLayers`, `hashSeedAliases`, `SEED_ALIASES`, `SEED_ALIASES_HASH` cache identity, copied-seed-default demotion, year-alias behavior, `/api/aliases` writes, client bootstrap fetch/retry/cache, canonical standings logic beyond alias source, schedule/liveDelta identity, score attachment, ownership. No production app-state mutated. Codex review clean ("The runtime alias resolver consistently removes the league-scoped layer while preserving global, year, and seed precedence. Updated consumers and tests align with the intended PLATFORM-067 behavior."). Full `npm test` 1151 pass / 0 fail; tsc/lint:all/build green. Commit `b82f8ac`; PR #355.
- Follow-up: optional league-scoped seed-key cleanup — delete redundant production `aliases:${slug}:${year}` seed-copy keys and consider retiring the legacy league-scope migration scan after another safety check. (ID note: this was informally earmarked "PLATFORM-068", but that ID was subsequently assigned to the app-wide audit — `PLATFORM-068-FABLE-APP-WIDE-AUDIT`. Track this seed-key cleanup within the post-`PLATFORM-069` cleanup batch in `docs/next-tasks.md`, not as PLATFORM-068.)

### PLATFORM-066-LEAGUE-ALIAS-DATA-CHECK-v1

- Purpose: Read-only production data check gating PLATFORM-067 — confirm whether any stored `aliases:${slug}:${year}` keys exist and whether they are already represented in `aliases:global`. No code or app-state changes.
- Scope: read-only `SELECT` against production `app_state` (Neon); no writes, no promotion, no deletes, no app routes called.
- Notes: Migration sentinel `aliases:global::migration-done` is SET in prod. Only 3 league scopes exist — `aliases:test:2025`, `aliases:test:2026`, `aliases:tsc:2025` (test/dev leagues) — and every entry is a copied current-`SEED_ALIASES` default already present in `aliases:global` (62 entries) with identical targets. Zero entries need promotion; zero conflicts; no real production league has a unique league-scoped repair. **Classification: safe to remove the league layer with no data migration** → executed as PLATFORM-067.

### PLATFORM-065-CLEANUP-ORPHANED-STAGING-UTILS-v1

- Purpose: Dead-code cleanup of the alias-**staging** helpers left orphaned after PLATFORM-064 removed the hidden league-scoped alias editor and its write path. No behavior change.
- Scope: deleted `src/lib/aliasStaging.ts` (`stageAliasFromMiss`); removed `hasStagedAliasChanges` + `getAdminAlertCount` from `src/lib/adminDiagnostics.ts` (+ its now-unused `AliasStaging` import); pruned the two tests that exclusively exercised `getAdminAlertCount` (`CFBScheduleApp.test.tsx`, `IssuesPanel.test.tsx`) + their orphaned `DiagEntry` import.
- Notes: Reachability confirmed all three helpers had **zero reachable production callers** post-064 (`aliasStaging.ts` no importers; `hasStagedAliasChanges` no refs; `getAdminAlertCount` test-only). Kept `splitIssueDiagnostics` — still live in `IssuesPanel.tsx`. **`storageKeys.aliasMap` (`cfb_name_map:*`) deliberately preserved**: `bootstrap.ts` still reads it as the read-only legacy degraded fallback (then clears it after a durable effective-cache write), so it is NOT dead — untouched here. No change to `getScopedAliasMap`, `mergeAliasLayers`, `/api/aliases`, `/admin/aliases`, `/admin/diagnostics`, bootstrap fallback precedence, or schedule/liveDelta identity. Reported-but-not-removed: the `AliasStaging` type (`diagnostics.ts:64`) + its `cfbScheduleTypes.ts` re-export are now consumer-less, left in place to keep the PR scoped to the named candidates (candidate future cleanup). Codex review clean ("The removed utilities have no remaining references, and the relevant scoped tests and TypeScript check pass"). Focused suites (bootstrap/aliases/aliasLayers/globalAliasStore/CFBScheduleApp/teamIdentity/gameOwnership/scoreAttachment) 1151 pass / 0 fail; tsc/lint:all/build green. Full `npm test` not run (documented Overview hang). Commit `0a2c9bb`; PR #354.
- Follow-up (remaining from the PLATFORM-061 audit): data-gated league alias layer removal — **done in PLATFORM-067** (prod data check PLATFORM-066 → league layer removed from `getScopedAliasMap`).

### PLATFORM-064-REMOVE-HIDDEN-LEAGUE-ALIAS-EDITOR-v1

- Purpose: Remove the unreachable in-app league-scoped alias editor + its write path (surfaced by the PLATFORM-061 audit; safe now per PLATFORM-062/063 follow-ups). No reachable behavior change.
- Scope: `CFBScheduleApp.tsx` (editor state/handlers), `AdminDebugSurface.tsx`, `IssuesPanel.tsx`, `aliasesApi.ts` (`saveServerAliases`/`loadServerAliases`), `bootstrap.ts` + `useScheduleBootstrap.ts` (stored-editor map load), `src/app/api/aliases/route.ts` (`?league=` GET/PUT branch); rewrote `bootstrap`/`aliases-route`/`IssuesPanel` tests. Kept `AliasEditorPanel` (`/admin/aliases` global editor) and `ScoreAttachmentDebugPanel` (`/admin/diagnostics`).
- Notes: The league editor rendered only under `CFBScheduleApp surface==='admin'`, which no route mounts (only a test), so its `PUT /api/aliases?league=` write path had no reachable caller. The league RESOLUTION layer in `getScopedAliasMap` is untouched (separate data-gated follow-up); it stays the ONLY client path to league-scoped repairs (via `GET ?scope=effective`). Client identity now flows solely through the effective resolver map. Nothing writes the legacy stored alias cache (`cfb_name_map:*`) anymore; legacy + effective caches are retained only as resolver fallback INPUTS during a degraded (offline) bootstrap. Editor commit `13f3070`; PR #353.
- Notes (Codex remediation — four sequential P2s, converged clean on the 5th review): (1) `172a56b` — removing the editor dropped the legacy stored cache from the effective-alias outage fallback; restored it as a READ-ONLY fallback layer so an upgraded pre-064 client with league repairs only in `cfb_name_map:*` (e.g. a mid-bootstrap quota failure dropped the effective cache) isn't rebuilt from seeds alone during an outage. (2) `bcb06fb` — the effective fetch is the sole client path surfacing league repairs, so a transient failure on a cold cache diverged identity; wrapped `loadEffectiveAliases` in a bounded retry (3 attempts, 150/300 ms backoff) that re-fetches the full resolver map (chosen over the reviewer's independent stored fetch, which on this branch can only return the deprecated year scope, not league repairs). (3) `8023cdf` — a removed `PUT /api/aliases?league=` was silently reinterpreted as a year-scoped write that mutates every league; now rejected with `410 Gone` (points to `?scope=global` or the year-scoped write). (4) `6073a1f` — the `172a56b` layer sat ABOVE the effective cache, letting a stale legacy copy override a freshly-fetched resolver map on a later outage; reordered to `[effectiveCache, legacyStored, seeds]` (effective wins collisions; legacy fills gaps / is sole source when no effective cache exists) AND clear the legacy `cfb_name_map:*` keys after a durable effective-cache write (skipped if the write throws, so it survives as fallback when it's the only copy). Tests: bootstrap suite (13) covers cold-cache legacy recovery, effective-over-legacy precedence, clear-on-success, and retry recovery; aliases-route test asserts `?league=` PUT → 410 + no write + no invalidation. Focused bootstrap/alias suites (13 + 57) + tsc/lint:all/build green each round. Full `npm test` not run (documented Overview hang). Final Codex review: clean ("No actionable regressions were identified").
- Notes (live verification, `/verify`): drove the route over HTTP against `next dev`. `PUT /api/aliases?league=foo&year=2025` (admin token) → `410` with the removal message and NO write landed (year map still `{}`); no-token → `401` (auth precedes the guard); whitespace `?league=%20` → `410`; control `PUT ?year=` (no league) → `200` write intact; `GET ?scope=effective&league=` → `200` resolver map intact; SSR `/` → `200` (CFBScheduleApp renders post-removal) and `/admin/aliases` + `/admin/diagnostics` → `307 → /login` (kept routes still mounted, not 500). The client `bootstrap.ts` change (retry / `[effective, legacy, seeds]` fallback / clear-legacy) is browser-only (no server surface) — not driven live; covered by the bootstrap unit suite.
- Follow-ups (remaining from the PLATFORM-061 audit): (1) orphaned staging-utility cleanup — **done in PLATFORM-065** (`aliasStaging.ts` / `hasStagedAliasChanges` / `getAdminAlertCount` deleted as dead; `storageKeys.aliasMap` kept as the read-only fallback); (2) data-gated league alias layer removal — **done in PLATFORM-066 (prod data check) + PLATFORM-067 (layer removed)**.

### PLATFORM-063-REMOVE-DEAD-TRENDS-PAGEDATA-v1

- Purpose: Delete the dead `trendsPageData` module + its test (dead-code cleanup surfaced by PLATFORM-062). No live behavior change.
- Scope: deleted `src/lib/trendsPageData.ts` and `src/lib/__tests__/trendsPageData.test.ts`.
- Notes: `trendsPageData.ts` (`loadCanonicalTrendsPageData` / `TrendsPageData`) was imported only by its own test — no production importers, no barrel re-exports. The live trends page (`src/app/league/[slug]/trends/page.tsx`) redirects to `standings?view=trends`, which renders through the canonical standings/client-bootstrap path; that redirect is untouched. Post-delete: zero dangling references, tsc/lint:all/build green, focused standings/aliases/odds/selectors/globalAliasStore suites (115 tests) green. Codex review clean ("deleted module was referenced only by its deleted test; the live trends route uses the canonical standings flow"). Full `npm test` not run (documented Overview hang).
- Follow-ups (remaining from the PLATFORM-061 audit): (1) hidden league alias editor removal (safe now — unreachable UI); (2) data-gated league alias layer removal (needs prod data check + product decision).

### PLATFORM-062-CANONICAL-ALIAS-ODDS-TRENDS-v1

- Purpose: Align the remaining odds/trends alias consumers with canonical effective resolution. Focused correctness PR — does NOT remove league-scoped aliases or the hidden editor.
- Scope: `src/app/api/odds/route.ts` (+ `route.test.ts`). Trends was found to be **dead code** (see below) — not modified.
- Notes: `odds/route.ts` `readAliasesForSeason` read only `aliases:${season}` (year scope) + hand-merged `SEED_ALIASES`, **missing stored global aliases**, so odds identity could diverge from canonical schedule/standings. Odds requests carry **no league context** (`/api/odds` query is season+markets; client fetches `?year=` only), so odds now resolves via `getScopedAliasMap('', season)` → stored global > year > SEED_ALIASES (league+year layer N/A). Removed the obsolete `readAliasesForSeason` helper + unused `SEED_ALIASES` import; no raw merge remains. Codex review clean ("odds route now uses the canonical effective alias map with the intended precedence … No regressions"). Tests: end-to-end GET proving an odds-provider label resolves to its canonical game ONLY via a stored global alias (impossible under the old year-only read), plus focused `getScopedAliasMap('', season)` source tests (year-only, SEED_ALIASES fallback, global-over-year precedence). Focused suites (218 tests) + tsc/lint:all/build green. Full `npm test` not run (documented Overview hang).
- **Trends finding:** `src/lib/trendsPageData.ts` (`loadCanonicalTrendsPageData`) is **DEAD CODE** — imported only by its own test; the trends page (`src/app/league/[slug]/trends/page.tsx`) redirects to `standings?view=trends`, which renders via the canonical client bootstrap (`effectiveAliasMap`) + standings selectors. No live trends divergence exists, so it was NOT "fixed." Scheduled for deletion under **PLATFORM-063-REMOVE-DEAD-TRENDS-PAGEDATA-v1** (delete `trendsPageData.ts` + its test after confirming no imports).
- Follow-ups (separate, from the PLATFORM-061 audit): (1) PLATFORM-063 delete dead `trendsPageData`; (2) hidden league alias editor removal (safe now); (3) data-gated league-scope layer removal (needs prod data check + product decision).

### PLATFORM-060-CANONICAL-ALIAS-REMAINING-CONSUMERS-v1

- Purpose: Fix the two remaining raw alias-consumer divergences found after the alias-model sequence (055→057→059→058). Focused correctness PR — does NOT remove league-scoped aliases.
- Scope: `src/app/league/[slug]/draft/page.tsx`, new `src/app/league/[slug]/draft/draftSchedule.ts` (+ test), `src/app/api/debug/{archive-audit,archive-integrity,game-stats-diagnostic}/route.ts`.
- Notes: `draft/page.tsx` had hand-merged `{ ...SEED_ALIASES, ...aliases:${year}, ...aliases:${slug}:${year} }` for both current- and prior-year schedules — it **missed stored `aliases:global`** and used **inverted precedence** (league > year, no stored-global tier), so draft-board identity could mis/unresolve a global- or seed-resolved team vs canonical/live. Both blocks now resolve via a small testable helper `resolveDraftScheduleGames()` → `getScopedAliasMap(slug, year)` (stored global > league+year > year > SEED_ALIASES); the helper returns the map so the prior-year score-attachment resolver reuses it. The three debug routes each hand-rolled the same `[league, year, global]` accumulator merge (also inverted, no seeds) and now call `getScopedAliasMap`; dead `loadAliasMap` helpers + unused imports removed. No alias storage/schema, `/api/aliases`, client bootstrap, or canonical-standings changes; **league scope still read as a layer** (removal deferred). Codex review clean ("routes alias resolution through the canonical scoped alias map without introducing functional regressions"). New `draftSchedule.test.ts` proves global-only, year-only, and SEED_ALIASES fallbacks + precedence (global > league+year > year); focused suites (210 tests) + tsc/lint:all/build green. Full `npm test` not run (documented Overview hang).
- Follow-up: the **league-scoped alias removal / hidden in-app editor decision** remains a separate product-gated item (see PLATFORM-058 note) — intentionally out of scope here.

### PLATFORM-058-CLIENT-EFFECTIVE-ALIAS-BOOTSTRAP-v1

- Purpose: Final alias-model item — make the client resolve schedule/liveDelta identity via the effective scoped alias map (stored global > league+year > year > SEED_ALIASES) instead of the stored league map, so the matchup/ownership UI and liveDelta agree with server canonical for global/year/seed-resolved aliases. **Completes the alias-model sequence 055 → 057 → 059 → 058.**
- Scope: `src/app/api/aliases/route.ts` (`?scope=effective` GET), `src/lib/aliasesApi.ts` (`loadEffectiveAliases`), `src/lib/bootstrap.ts` + `src/components/hooks/useScheduleBootstrap.ts` + `src/components/CFBScheduleApp.tsx` (stored-for-editor vs effective-for-resolver split), `src/lib/aliasLayers.ts` (shared pure `mergeAliasLayers` + `hashSeedAliases`), `src/lib/effectiveAliasCache.ts` (seed-versioned client cache), `src/lib/storageKeys.ts`. Tests: aliases-route effective GET, `aliasLayers`, expanded `bootstrap` (stored/effective split, partial-fetch, reconciliation, seed-version invalidation).
- Notes: **Stored vs effective are deliberately distinct.** `GET /api/aliases?scope=effective` is the read-only resolver view (`getScopedAliasMap`); the default `?league=` GET stays the editable STORED view, so the in-app alias editor never round-trips global/seed defaults into a scope. `getGlobalAliases`/`getScopedAliasMap` refactored onto the shared `mergeAliasLayers` (identity precedence + spelling preservation), also used by the client offline fallback so stored-over-seed precedence matches the server. Client bootstrap loads BOTH maps (stored→editor, effective→resolver via `buildScheduleFromApi`/`useLiveRefresh`), removed the client seed-if-empty write. Effective cache is seed-hash-versioned (`hashSeedAliases`, moved into the client-safe `aliasLayers`); the degraded fallback reconciles fresh-stored + version-matched-cache + current-seeds rather than trusting a flattened cache. Post-save flow: rebuild games with the fresh map first and publish state/cache only after a successful rebuild; `router.refresh()` runs in `finally` so canonical refreshes even if the client rebuild fails. Hardened across 6 Codex remediation rounds (all in the offline/save failure paths). Focused suites green; tsc/lint:all/build green. Full `npm test` not run (documented Overview hang).
- **Manual browser verification note:** The league-scoped alias editor/save-flow is NOT reachable through exposed production UI — it is gated behind `surface === 'admin'` (`CFBScheduleApp.tsx:1341/1779`, `AdminDebugSurface`/`AliasEditorPanel`), and no production route mounts `CFBScheduleApp` with that surface (every mount is a league page with the default `surface='league'`; `surface="admin"` appears only in `CFBScheduleApp.test.tsx`). So the post-save React wiring is covered by type/build/component-level coverage and code review, not manual browser verification. The exposed runtime surface that WAS verified live (/verify): `GET /api/aliases?scope=effective` returns the effective resolver map with `global > seed` precedence and year-fill; the default league alias GET stays stored-only (no seed leakage); normal league pages consume the effective map for schedule/liveDelta identity via `useScheduleBootstrap`.
- Follow-up: none required for the alias model. Product note: the in-app league-scoped alias editor is currently unreachable (admins manage aliases via `/admin/aliases`, global scope); consider wiring it up or removing the dead editor UI.

### PLATFORM-059-CANONICAL-ALIAS-SERVER-CONSUMERS-v1

- Purpose: Align the last server-side alias consumer with the effective scoped alias map after PLATFORM-055/057, so rollover/backfill archives can't diverge from live canonical.
- Scope: `src/lib/seasonRollover.ts` (`buildSeasonArchive`). Tests: new `src/lib/__tests__/seasonRollover-aliases.test.ts`.
- Notes: **`buildSeasonArchive` now consumes `getScopedAliasMap(slug, year)`** (stored global > league+year > year > `SEED_ALIASES`) instead of loading only `aliases:${slug}:${year}` for game identity — the same effective resolution live canonical standings use, feeding both `buildScheduleFromApi` and the score-attachment resolver. Removed the private league-only alias load; archive persistence format and display labels unchanged. `loadInsightsForLeague`'s games builder was already migrated in PLATFORM-057 — verified, not changed. Tests prove the archive resolves games via global-only / year-only / `SEED_ALIASES` fallbacks, a league+year repair beating the seed, and archive standings agreeing with live canonical for the same fixture. Codex review clean (no findings). Focused suites 186 pass / 0 fail; tsc/lint:all/build green. Full `npm test` not run (documented Overview hang).
- Follow-up (final alias-model item): **PLATFORM-058-CLIENT-EFFECTIVE-ALIAS-BOOTSTRAP** — now fully unblocked; change the client GET/bootstrap to consume the effective map.

### PLATFORM-057-SEED-ALIASES-TO-GLOBAL-v1

- Purpose: Make the static `SEED_ALIASES` bundle globally available to all server alias consumers so PLATFORM-058 can safely change client alias bootstrap. Prerequisite for 058.
- Scope: `src/lib/server/globalAliasStore.ts` (effective-map model + reconciliation), `src/lib/selectors/leagueStandings.ts` (cache-key seed versioning), `src/app/api/aliases/route.ts` (stored-only global GET), `src/app/api/owners/route.ts` + `src/app/api/owners/validate/route.ts` + `src/lib/insights/loadInsights.ts` (league-aware consumers → `getScopedAliasMap`). Tests: `globalAliasStore.test.ts` (expanded), new `owners/validate/__tests__/route.test.ts`, updated aliases-route + standings tests.
- Notes: **Approach (user-approved): seeds are merged IN-MEMORY, not persisted.** After weighing a persist+versioned-sentinel design, chose to expose `SEED_ALIASES` as a code-defined lowest-precedence layer, which dissolved the write/invalidation/versioning problems at the root. Final model:
  - Effective precedence **stored global > league+year > year > SEED_ALIASES** (seeds are defaults; any persisted manual repair beats them). Cross-layer conflicts dedup by resolver identity (`normalizeTeamName`); every distinct lookup spelling is preserved and a shadowed lower-layer spelling is remapped to the higher winner (so exact-key `validateRosterCSV` still resolves it).
  - Helpers: `getStoredGlobalAliases()` (persisted-only, admin GET), `getGlobalAliases()` (effective, global-only consumers), `getScopedAliasMap(slug, year)` (league-aware effective). All league-aware consumers use `getScopedAliasMap` — a seed can never override a scoped repair.
  - Canonical standings cache is versioned by `SEED_ALIASES_HASH` (folded into the `unstable_cache` key) so a seed change busts warm snapshots with no runtime write.
  - Persisted bootstrap copies (`bootstrapAliasesAndCaches` writes the seed bundle into empty scopes) are demoted in-memory via `KNOWN_SEED_DEFAULTS` (current + `RETIRED_SEED_DEFAULTS` for superseded targets) so they can't permanently shadow a corrected seed; a same-key different-target entry stays a manual repair. Documented residual: a manual repair identical to a seed default is indistinguishable and treated as a copy.
  - One-time legacy promotion (`migrateYearScopedAliasesToGlobal`) skips copied seed defaults, remaps normalized-identity collisions to the stored-global winner, and treats a copied default at an exact key as absent so a same-key repair still promotes.
  - Process-local write lock (re-read inside lock) serializes the remaining global writers; no read-path writes; admin global GET stays stored-only; `/api/aliases` league GET unchanged.
- Review: hardened across **9 Codex rounds** (in-memory pivot, then precedence/spelling/promotion/reconciliation edge cases + a NUL-separator encoding fix). Focused suites green each round; `tsc`/`lint:all`/`build` green. Full `npm test` not run (documented Overview hang).
- Follow-ups (sequencing preserved): **PLATFORM-059-CANONICAL-ALIAS-SERVER-CONSUMERS** — `seasonRollover.ts:buildSeasonArchive` still loads only `aliases:${slug}:${year}`; the `loadInsightsForLeague` games builder was already swapped to `getScopedAliasMap` here, so 059 primarily covers the archive builder. Then **PLATFORM-058-CLIENT-EFFECTIVE-ALIAS-BOOTSTRAP** — deferred until now-complete (static seeds live in the effective model); change the client GET/bootstrap to consume the effective map.

### PLATFORM-055-CODEX-FINDINGS-REMEDIATION-2-v1

- Purpose: Address Codex re-review of PLATFORM-055 — align every active alias consumer with canonical's effective (global-first) alias semantics. Two findings: (P1) client schedule bootstrap still loads league-scoped aliases only; (P2) Insights context used a private league-first merge.
- Scope: `src/lib/insights/context.ts` (P2, shipped); P1 flagged as a scope boundary (not shipped). Tests: new `src/lib/__tests__/insights-context-aliases.test.ts`.
- Notes: **P2 shipped** — `insights/context.ts` `loadOwnerSeasonStats` now resolves via `getScopedAliasMap` instead of the private `[league, year, global]` accumulator-wins merge (which was league-first and lacked the normalized dedup). Same resolver wiring as canonical; removed dead `loadAliasMap` + now-unused `getAppState`/`AliasMap` imports. New test proves a conflicting global-vs-league alias credits the global target (Alice) not the league target (Bob) through the real `aggregateOwnerSeasonStats` path. Focused suites 183 pass / 0 fail; tsc/lint:all/build green. **P1 NOT shipped — reported as a boundary:** naively changing `/api/aliases` GET (league branch) to return the effective map breaks the `SEED_ALIASES` seeding coupling. `bootstrap.ts:114-120` seeds the ~20-entry static `SEED_ALIASES` bundle (e.g. `ole miss`→`mississippi`) into `aliases:${slug}:${year}` **only when the league GET returns empty**; both the client map AND server canonical (`getScopedAliasMap` reads that scope) depend on it. If GET returns the merged map, a non-empty global store makes a never-seeded league look non-empty → seeding skipped → both client and canonical lose the static aliases. Correct fix requires migrating `SEED_ALIASES` into the global store (broad alias-model migration — explicitly out of PLATFORM-055 scope) or broadening GET to seed server-side (prohibited "mutation on GET"). Recommended follow-up: **PLATFORM-057-SEED-ALIASES-TO-GLOBAL** then the client GET effective-map change.

### PLATFORM-055-CODEX-FINDINGS-REMEDIATION-v1

- Purpose: Fix the two Codex review findings on PLATFORM-055 before merge (in-scope corrections, not follow-ups): (P1) alias precedence could be violated after key normalization; (P2) not every newly consumed alias writer invalidated canonical standings.
- Scope: `src/lib/server/globalAliasStore.ts` (dedupe the effective map by resolver identity), `src/app/api/aliases/route.ts` (year-only PUT + global GET migration invalidation); tests in `globalAliasStore.test.ts`, `aliases/route.test.ts`, `selectors-leagueStandings.test.ts`.
- Notes: **P1** — `getScopedAliasMap` now collapses entries by `normalizeTeamName` identity (the key `buildCanonicalRegistry` collides on — coarser than `normalizeAliasLookup`; the resolver registry is first-wins), precedence-ordered global > league+year > year. Two textually distinct keys that normalize to one identity (e.g. `gulf coast tech` vs `gulfcoasttech`) no longer let the lower-precedence scope win by insertion order; the higher-precedence key survives and the dup is dropped. Exact-key conflicts are a subset (unchanged). Benefits the draft board consumer too (its exact-key precedence test stays green). **P2** — year-only PUT (`aliases:${year}`, used by TeamsDebugPanel) now enumerates the registry and invalidates each league for that year; the global GET lazy migration invalidates every registered league only when it actually moved entries (`migrated > 0`, sentinel-guarded → fires at most once). Global PUT + league-scoped PUT invalidation unchanged. No change to ownership/`teamIdentity.ts`/persistence/UI/liveDelta; archived snapshots untouched; client GET response shape unchanged. Focused suites 156 pass / 0 fail; tsc/lint:all/build green. Full `npm test` not run (documented Overview hang).

### PLATFORM-055-CANONICAL-GLOBAL-ALIAS-MERGE-v1

- Purpose: Make canonical standings consume the effective (scoped) alias map instead of the league-only scope, and invalidate affected canonical standings caches when global aliases change — fixing a canonical identity correctness bug (global-only aliases never reached live derivation, so canonical roster owners were mis-credited) and the paired stale-cache gap.
- Scope: `src/lib/selectors/leagueStandings.ts` (swap private `loadAliasMap` → `getScopedAliasMap`; delete dead loader; update invalidation docs); `src/app/api/aliases/route.ts` (global PUT enumerates the registry and calls `invalidateStandings(slug)` per league). Tests: new `src/lib/server/__tests__/globalAliasStore.test.ts`, new `src/app/api/aliases/__tests__/route.test.ts`, and alias-scope integration cases added to `selectors-leagueStandings.test.ts`.
- Notes: Precedence preserved (global > league+year > year) via the existing `getScopedAliasMap`; no new merge helper, all matching still through `teamIdentity.ts`. Global alias writes invalidate the per-league umbrella tag only (no year), since a global alias can affect any cached year. Route invalidation is observed in tests via the established `work-async-storage` `pendingRevalidatedTags` shim (frozen `next/cache` export cannot be spied; `unstable_cache` is bypassed under `node:test`). Integration tests credit an owner via a global-only alias (1–0) with a negative control (no alias → 0–0), plus global-over-league conflict, league-only fallback, and no-alias catalog paths. Ownership/`gameOwnership.ts`/`teamIdentity.ts`/persistence untouched; archived snapshots untouched. Focused suites (teamIdentity, gameOwnership, scoreAttachment, selectors-leagueStandings, globalAliasStore, aliases, boardData, insights) 167 pass / 0 fail; tsc/lint:all/build green. Full `npm test` not run — CLAUDE.md documents it hangs on Overview tests with no usable signal; `lint:all` is the pre-merge gate. Resolves the PLATFORM-053 candidate (2).

### PLATFORM-053-INSIGHTS-CANONICAL-STANDINGS-INPUTS-v1

- Purpose: Make `loadInsightsForLeague` consume canonical standings rows/history from `getCanonicalStandings` instead of independently re-deriving standings (`deriveStandings`/`deriveStandingsHistory`) from schedule/scores/CSV/aliases — fixing a P1 where Insights could disagree with the canonical archive/offseason lifecycle, empty snapshots, and coverage/cache state.
- Scope: `src/lib/insights/loadInsights.ts` (standings rows/history from canonical; removed the local derivation + the score fetch that only fed it). Tests: new `loadInsights.test.ts`.
- Notes: Standings rows/history now come from `getCanonicalStandings({ slug, year, currentDate })` (`canonical.rows` → currentStandings; `canonical.standingsHistory` → weeklyStandings + `selectSeasonContext`); authoritative even when empty/null, no local fallback. `games`/roster/rankings/lifecycle/suppression preserved. Codex flagged 3 items — all confirmed as **consequences of aligning Insights to canonical** and **shipped as-is** (canonical is the source of truth for all surfaces; re-adding local paths would reintroduce the divergence): (1) canonical reads scores from the persisted cache only (no self-warm) — same as Standings/Overview; cold-cache freshness is a canonical/scores-layer concern → follow-up **PLATFORM-054-CANONICAL-SCORE-CACHE-WARMING** (candidate). (2) canonical resolves **league-only** aliases (no global merge) — pre-existing, shared by all canonical surfaces → the already-deferred alias-scope consolidation → **PLATFORM-055-CANONICAL-GLOBAL-ALIAS-MERGE** (candidate). (3) Insights active owners still come from the CSV roster via `buildInsightContext`/`computeRosterFallback` — **pre-existing, untouched by this PR** (prompt required preserving roster) → **PLATFORM-056-INSIGHTS-CANONICAL-OWNER-SOURCING** (candidate). No canonical generation change, no route-loader change, no `router.refresh`, no UI change. `npm test` 1073 pass / 0 fail / 0 skipped; tsc/lint:all/build green.

### PLATFORM-051-OVERVIEW-LIVEDELTA-OVERLAY-v1

- Purpose: Add the Standings/Members-compatible pending W–L `liveDelta` badge to Overview Top-N standings rows (Overview previously received `liveDelta` but `void`ed it). Preceded by the read-only **PLATFORM-050-OVERVIEW-LIVEDELTA-OVERLAY-AUDIT-v1**.
- Scope: `src/components/OverviewPanel.tsx` (consume `liveDelta`; thread into `CondensedStandingsTable`; badge beside record). Tests: `OverviewPanel.test.tsx`.
- Notes: Presentation-only badge on Top-N rows via the shared `selectFreshOwnerPendingDelta` — visible `+1–0`, title/aria `Live this week: 1–0`, `data-overview-live-pending`; gated by the rendered `row.owner`. Never mutates/projects rank/record/win%/differential and never re-sorts; canonical rows/history/coverage resolution (PLATFORM-047/048) untouched. Stale/missing/tied/NoClaim/absent deltas render nothing. The existing `{n} live` pill (a distinct signal) is unchanged; podium/hero cards get no badge this phase; no `router.refresh`. Codex review: clean, no findings. Deferred: **PLATFORM-052** (podium/hero live badge, candidate), `liveCountByOwner` staleness alignment (candidate), **PLATFORM-045** route-loader dedup. `npm test` 1069 pass / 0 fail / 0 skipped; tsc/lint:all/build green.

### PLATFORM-049-STANDINGS-COVERAGE-CANONICAL-CONTRACT-v1

- Purpose: Make Standings rows, history, and coverage all come from the same canonical snapshot when supplied (Standings already preferred canonical rows/history but still rendered raw local `standingsCoverage`, which could pair canonical archive rows with a stale client warning).
- Scope: new pure `src/lib/selectors/standingsCanonicalInputs.ts` (`resolveStandingsCanonicalInputs` + `STANDINGS_COVERAGE_UNAVAILABLE`), `src/components/StandingsPanel.tsx` (resolve rows/history/coverage together; warning uses resolved coverage). Tests: `standingsCanonicalInputs.test.ts`, `StandingsPanel.test.tsx`.
- Notes: Standings coverage now canonical-preferred; local coverage only when NO canonical snapshot is supplied; missing/null canonical coverage → conservative `{ state: 'error', message: 'Standings coverage is unavailable.' }` (never local; `CanonicalStandings.coverage` stays required — defensive runtime handling). Deliberately **not** reusing `resolveOverviewCanonicalInputs` (surfaces stay decoupled; new module imports only types so no server/appState code enters the client bundle). Coverage affects only the top warning paragraph/error styling — never row selection, sorting, movement/history, NoClaim, or liveDelta badges; canonical rows never mutated. No `CFBScheduleApp` wiring change (already supplies canonical + local coverage). Codex review: clean, no findings. Deferred: **PLATFORM-045** (route-loader dedup); candidate Overview liveDelta overlay. `npm test` 1060 pass / 0 fail / 0 skipped; tsc/lint:all/build green.

### PLATFORM-046-MEMBER-HEADER-LIVE-OVERLAY-v1

- Purpose: Add a Standings-compatible `liveDelta` pending W–L badge to the Members owner header without changing the canonical header baseline (the follow-up deferred from PLATFORM-044).
- Scope: `src/lib/selectors/liveDelta.ts` (new pure `selectFreshOwnerPendingDelta`), `src/components/StandingsPanel.tsx` (use the helper — behavior-neutral), `src/components/OwnerPanel.tsx` (optional `liveDelta` prop + badge beside Record), `src/components/CFBScheduleApp.tsx` (pass `liveDelta`). Tests: `selectors-liveDelta`, `OwnerPanel`, `StandingsPanel`, `CFBScheduleApp`.
- Notes: `selectFreshOwnerPendingDelta(liveDelta, owner)` centralizes stale suppression, owner lookup, NoClaim exclusion, and the nonzero-decision check (returns the fresh pending delta or null); Standings now uses it (markup/copy unchanged) and Members reuses it. The Members badge renders beside the header Record (`+1–0`, title `Live this week: 1–0`), gated by `snapshot.header?.owner` — a null header is never resurrected by liveDelta; canonical rank/record/win%/differential are untouched; no projected standings; no `router.refresh`. Fresh nonzero → badge; stale/missing/zero-decision → none; NoClaim never annotated. Codex review: clean, no findings. Deferred follow-ups: **PLATFORM-045** (route-loader dedup), and candidates — Overview liveDelta overlay, Standings-surface canonical coverage. `npm test` 1050 pass / 0 fail / 0 skipped; tsc/lint:all/build green.

### PLATFORM-048-OVERVIEW-COVERAGE-CANONICAL-CONTRACT-v1

- Purpose: Make Overview coverage canonical-preferred whenever a canonical standings snapshot is supplied (closing the remaining gap PLATFORM-047 characterized: rows/history were canonical but coverage stayed local).
- Scope: `src/lib/selectors/overview.ts` (`resolveOverviewCanonicalInputs` now resolves coverage + exports `CANONICAL_COVERAGE_UNAVAILABLE`), `src/components/OverviewPanel.tsx` (resolved coverage → selector + visible warning), `src/components/CFBScheduleApp.tsx` (resolve once, feed `deriveOverviewSnapshot`). Tests: `overview-canonical-contract.test.ts`, `selectors-leagueStandings.test.ts`.
- Notes: Overview coverage now comes from canonical when a snapshot is supplied; client-derived coverage is used only when NO snapshot is supplied. A supplied snapshot with missing/null coverage returns the conservative `{ state: 'error', message: 'Standings coverage is unavailable.' }` (never local) — `CanonicalStandings.coverage` stays required at the type level (defensive runtime handling only). `CFBScheduleApp` resolves rows/history/coverage once and feeds resolved coverage to `deriveOverviewSnapshot` (no canonical input of its own); `OverviewPanel` resolves identically for its selector and the visible coverage warning, so all consumers share the same resolved coverage. rows/history semantics + NoClaim exclusion from PLATFORM-047 preserved; liveDelta still not merged; no Overview UI rewrite; no canonical generation change (builders already populate coverage — now pinned). Codex review: clean, no findings. Deferred follow-ups unchanged: **PLATFORM-046** (Members header liveDelta overlay), **PLATFORM-045** (route-loader dedup), Overview liveDelta overlay, and (candidate) Standings-surface canonical coverage. `npm test` 1035 pass / 0 fail / 0 skipped; tsc/lint:all/build green.

### PLATFORM-047-OVERVIEW-CANONICAL-CONTRACT-CHARACTERIZATION-v1

- Purpose: Test-first characterization of the Overview canonical-vs-local source boundary before any behavioral migration. No behavior change.
- Scope: `src/lib/selectors/overview.ts` (new pure `resolveOverviewCanonicalInputs` extracted verbatim from the inline OverviewPanel resolution), `src/components/OverviewPanel.tsx` (call the helper — byte-identical behavior). Tests: new `overview-canonical-contract.test.ts`.
- Notes: Pinned Overview contract — **rows**: canonical when a snapshot is supplied (empty stays empty; omitting an owner does not resurrect local), local only when no snapshot; **history**: canonical when supplied (null stays null), local only when no snapshot; **coverage**: always client/schedule-derived — canonical coverage is NOT consumed by the resolution (returns only rows/history); **liveDelta**: not an input, not merged into Overview rows this phase; **NoClaim**: excluded from canonical rows (held in `noClaimRow`). Behavior-neutral extraction (existing OverviewPanel tests unchanged/green). Characterization surfaced the real remaining gap: **coverage is still client-derived while canonical is authoritative** → next implementation prompt **PLATFORM-048-OVERVIEW-COVERAGE-CANONICAL-CONTRACT-v1** (consciously decide/flip coverage to canonical with tests). No Overview rewrite, no UI/coverage/liveDelta/Insights/matchup/ownership/CSV changes. Codex review: clean, no findings. `npm test` 1032 pass / 0 fail / 0 skipped; tsc/lint:all/build green.

### PLATFORM-044-CANONICAL-MEMBER-RECORDS-v1

- Purpose: Make the Members view owner header (rank/record/win%/point differential) use canonical standings rows instead of locally derived standings, so Members agrees with the Standings surface.
- Scope: `src/lib/ownerView.ts` (`deriveOwnerViewSnapshot` takes optional `canonicalStandingsRows`; header sourced from it), `src/components/CFBScheduleApp.tsx` (pass `canonicalStandings?.rows`). Tests: `ownerView.test.ts`.
- Notes: Members owner header now prefers canonical standings. **Canonical is authoritative when supplied** (per review decision): when a canonical snapshot is passed — even empty or omitting the owner — the header is the canonical row or `null`, never the local row, so Members never resurrects an owner/standings canonical excludes. Local rows are used for the header only when NO canonical snapshot is supplied (`undefined`, e.g. Trends/History routes). Owner options, selection, roster rows, and weekly game details remain schedule/client-derived (PLATFORM-039 ownership resolution intact); NoClaim stays excluded. Codex P1 (do not fall back to local when canonical omits/empties an owner) was **adopted**, overriding the initial prompt's "empty → local" fallback wording. A second Codex P1 (canonical header not refreshed after client score hydration → stale/cold records) was **reviewed and deferred**: the residual staleness is a pre-existing, app-wide property of the static canonical prop that Standings' base record shares (canonical refreshes only on mutations via `router.refresh`, never on score hydration; live in-progress state is the separate `liveDelta` overlay). Members' canonical *base* record now agrees with Standings' base record (the goal). Codex's suggested `router.refresh`-after-hydration fix was **declined** as the wrong mechanism (contradicts the liveDelta-overlay redesign, app-wide, refetch-churn risk). Applying the `liveDelta` pending overlay to the Members owner header (to match Standings during live play) is a UI-additive follow-up → **PLATFORM-046-MEMBER-HEADER-LIVE-OVERLAY-v1**. No changes to canonical standings generation, schedule canonicalization, attachment, season resolution (PLATFORM-042), schedule-route inputs (PLATFORM-043), FBS/FCS (PLATFORM-036), CSV/bootstrap, Overview/Insights/matchup consumption, or UI. Next reviewed item: Overview canonical contract characterization. `npm test` 1023 pass / 0 fail / 0 skipped; tsc/lint:all/build green.

### PLATFORM-043-SCHEDULE-ROUTE-CANONICAL-INPUTS-v1

- Purpose: Make `/league/[slug]/schedule` provide the same canonical standings, league status, and archive context as the root league route, so entering directly through Schedule is a route-specific entry into the same canonical app state (WeekViewTabs can switch locally to Standings/Overview/Matchups/Members) rather than a lighter fallback-only entry.
- Scope: `src/app/league/[slug]/schedule/page.tsx` (load `getCanonicalStandings` + `listSeasonArchives` + derive `leagueStatus`/`mostRecentArchivedYear`, mirroring the root route). Test: new `src/app/league/[slug]/schedule/__tests__/page.test.tsx`.
- Notes: `/league/[slug]/schedule` now receives the same canonical standings/status/archive inputs as the root league route. Component fallbacks remain intentionally in place (empty/unavailable leagues still receive a canonical snapshot the fallback branches handle). Narrow change: no `WeekViewTabs`/UI behavior change, no `CFBScheduleApp` rewrite, no changes to canonical standings generation, schedule canonicalization, attachment, season resolution (PLATFORM-042), ownership (PLATFORM-039), FBS/FCS (PLATFORM-036), or CSV/bootstrap. Codex review: clean, no findings. The root/standings/schedule routes now share the same canonical-loader block — an optional dedup (`PLATFORM-045-LEAGUE-ROUTE-CANONICAL-LOADER-DEDUP-v1`) is deferred. Next reviewed item: Members canonical records. `npm test` 1016 pass / 0 fail / 0 skipped; tsc/lint:all/build green.

### PLATFORM-042-LEAGUE-SEASON-RESOLUTION-v1

- Purpose: Make `CFBScheduleApp` schedule/scores/aliases/rankings/insights/storage use the league-resolved season instead of falling back to global `DEFAULT_SEASON` for active-season and offseason leagues.
- Scope: new pure `src/lib/leagueSeason.ts` (`resolveLeagueSeason`); `src/components/CFBScheduleApp.tsx` (seed `selectedSeason` via the resolver; collapse the duplicate `draftLookupYear`). Tests: new `leagueSeason.test.ts` + a `CFBScheduleApp` active-season regression.
- Notes: Client schedule/scores/aliases/rankings/insights/storage now use the league-resolved season. `resolveLeagueSeason` precedence: `leagueStatus.year` (preseason/season) → `leagueYear` → `defaultSeason`; active-season and offseason leagues no longer silently use `DEFAULT_SEASON` when league-specific year info exists. `selectedSeason` is the single feed for all season-sensitive client ops, so the one-line initializer change fixes them all; `draftLookupYear` now reuses `selectedSeason` (provably identical across states). No explicit per-instance year override exists (env `NEXT_PUBLIC_SEASON` is baked into `DEFAULT_SEASON`). No changes to canonical standings, schedule canonicalization, attachment, ownership (PLATFORM-039), FBS/FCS (PLATFORM-036), CSV/bootstrap, auth, or UI. Codex review: clean, no findings. Schedule route canonical inputs remain next as **PLATFORM-043-SCHEDULE-ROUTE-CANONICAL-INPUTS-v1**. `npm test` 1013 pass / 0 fail / 0 skipped; tsc/lint:all/build green.

### PLATFORM-039-CANONICAL-GAME-OWNERSHIP-LOOKUP-v1

- Purpose: Make current-season ownership resolution use centralized, resolver-free game-identity candidates instead of raw provider-name equality (`rosterByTeam.get(game.csvHome/csvAway)`, `game.csvAway === teamName`), so stored/canonical assignments still match when provider labels differ (e.g. "Wash St" vs "Washington State").
- Scope: new `src/lib/gameOwnership.ts` (`sideIdentityCandidates`, `getOwnerForGameSide`, `getGameOwners`, `getGameSideForTeam`); adopted in `gameTags.ts` (behavior-neutral extraction), `standings.ts`, `selectors/liveDelta.ts`, `matchups.ts`, `selectors/gameWeek.ts`, `ownerView.ts`, and `OverviewPanel.tsx` (`liveCountByOwner`). Tests: new `gameOwnership.test.ts` + `ownerView.test.ts`; mismatch regressions in standings/liveDelta/matchups/gameWeek.
- Notes: Current-season ownership lookup now uses centralized resolver-free game ownership candidates (participant teamId → canonical/display/raw → `canHome/away` → `csvHome/away` legacy fallback; exact-match). This does **not** preserve or expand CSV-upload architecture. Provider-facing display labels (`csvHome/csvAway`) preserved. Codex P2 addressed: `OverviewPanel.liveCountByOwner` also routed through the shared helper. Codex P1 (roster labels that are themselves non-canonical aliases, e.g. stored `"wash st"`, still miss under exact-match) is a **pre-existing** limitation and an **intentional deferral** — resolving it needs normalized ownership keys or resolver/roster canonicalization, both explicitly out of scope here → **PLATFORM-040-OWNERSHIP-KEY-NORMALIZATION-v1**. Normalized ownership-key indexes, historical/archive ownership cleanup (`insights/*`, `historySelectors`, `leagueRecords`), historical CSV-upload / league-history behavior, alias-scope precedence consolidation, and canonical standings/overview/matchup migration all remain deferred. `npm test` 1005 pass / 0 fail / 0 skipped; tsc/lint:all/build green.

### PLATFORM-036-FBS-FCS-MATCHUP-SELECTOR-CLASSIFICATION-v1

- Purpose: Fix matchup selector/display so FCS opponents are identified through canonical conference subdivision policy instead of local `/\bfcs\b/i` conference-name regexes that only fired when a label literally contained "FCS" (missing Big Sky, MVFC, Patriot, SWAC, CAA, Ivy, SoCon, Southland, …).
- Scope: `src/lib/conferenceSubdivision.ts` (new pure `isPolicyFcsConference`), `src/lib/matchups.ts` / `src/lib/selectors/matchups.ts` / `src/lib/selectors/gameWeek.ts` (drop local regex helpers, use the shared helper in `deriveWeekMatchupSections` / `deriveOpponentDescriptor` / `deriveGameWeekPanelViewModel`). Tests: `conferenceSubdivision.test.ts`, `selectors-matchups.test.ts`, `selectors-gameWeek.test.ts`, `MatchupsWeekPanel.test.tsx` (synthetic `"FCS"` fixtures → real `"MVFC"`).
- Notes: Matchup selector/display FCS classification now uses shared conference subdivision policy (`isPolicyFcsConference`, backed by `resolvePresentDayConferencePolicy`) instead of local regexes; the helper is pure and does not consult the mutable CFBD conference index. Real FCS opponents render `FCS` (not `NoClaim (FBS)`), FCS participants cannot create owner matchups, unowned FBS opponents still render `NoClaim (FBS)`, and unknown/empty/OTHER stay non-FCS (only recognized FCS policy conferences flip). FBS×FCS inclusion and FCS×FCS exclusion remain upstream in schedule eligibility (unchanged). Direct `rosterByTeam.get(game.csvHome/csvAway)` ownership lookup intentionally left untouched — canonical ownership/alias cleanup remains deferred to **PLATFORM-039-CANONICAL-GAME-OWNERSHIP-LOOKUP-v1** (next likely task). Codex P2 addressed: MVFC's policy aliases lacked CFBD's `Missouri Valley` provider spelling (the form repo fixtures use), so those games still misclassified — added `missourivalley` to the static policy with a regression. `npm test` 992 pass / 0 fail / 0 skipped; tsc/lint:all/build green.

### PLATFORM-035-DRAFT-BOARD-CANONICAL-ALIAS-LOADING-v1

- Purpose: Fix the server-rendered spectator draft board so schedule-derived draft insights populate, by replacing the browser-era alias loader (`src/lib/aliases.ts` `loadAliasMap`, which reads `localStorage` / fetches a relative `/data/team-aliases.json` and fails silently on the server) with a server-safe scoped alias source.
- Scope: `src/lib/server/globalAliasStore.ts` (new exported `getScopedAliasMap(slug, year)`), `src/app/league/[slug]/draft/board/boardData.ts` (new `loadSpectatorBoardSchedule` extraction), `src/app/league/[slug]/draft/board/page.tsx` (route through the helper; drop the `aliases.ts` import), `src/app/league/[slug]/draft/board/__tests__/boardData.test.ts` (new regression).
- Notes: Spectator draft board alias loading now uses server-safe appState sources. `getScopedAliasMap` walks `aliases:global` + deprecated `aliases:{slug}:{year}` / `aliases:{year}` scopes with precedence **global > league+year > year** (global is the canonical store; legacy scopes are deprecated and migration preserves global entries — matches the owners upload merge). Codex P2 addressed: initial draft copied the legacy insights-path ordering (global lowest) which let a stale scoped mapping override the corrected global one; fixed to global-highest with a dedicated precedence regression. Broader alias scope/cache **precedence consolidation remains deferred** (the four duplicate scope-walk loaders in `insights/context.ts`, `leagueStandings.ts`, and the two `archive-*` debug routes are untouched, as is global precedence policy elsewhere). `src/lib/aliases.ts` is now unused but left in place — dead-helper retirement is a separate deferred item. No changes to draft eligibility/lifecycle, odds, scores, schedule canonicalization, standings, or appState infra. Next likely task: **PLATFORM-036-FBS-FCS-MATCHUP-SELECTOR-CLASSIFICATION-v1**. `npm test` 986 pass / 0 fail / 0 skipped; tsc/lint:all/build green.

### PLATFORM-031-EVENT-DATE-AWARE-ATTACHMENT-v1

- Purpose: Make production odds attachment event-centric and date-aware so upstream odds events attach to the correct canonical schedule game via team identity + commence time, with no same-pair fan-out and no arbitrary duplicate first-win. Implements the behavior the PLATFORM-030 `test.skip` contracts described.
- Scope: `src/lib/oddsAttachment.ts` (rewrite), `src/lib/gameAttachment.ts` (`ScheduleAttachmentGame.date`), `src/app/api/odds/routeInternals.ts` (moved + extended `normalizeUpstreamOddsEvent`/`NormalizedOddsEvent`/`UpstreamOddsEvent`, `SharedOddsCacheEntry.data` now `NormalizedOddsEvent[]`), `src/app/api/odds/route.ts` (carry `commenceTime` through prepared events), `src/lib/odds.ts` (legacy `buildOddsByGame` carries `commenceTime`). Tests: `oddsAttachment.test.ts` (un-skip 3 contracts + diagnostics), new `odds/__tests__/odds-normalization.test.ts`.
- Notes: Commit `(this PR)`. Algorithm: iterate events → resolve pair via `teamIdentity` `buildPairKey` → candidate canonical games from `buildSchedulePairIndex` → if `commenceTime` present and any candidate dated, narrow to ±24h window → attach only when exactly one candidate remains; skip on zero/multiple. One-to-one safety via a consumed-game set (a claimed game is never overwritten). Lightweight diagnostics sink (optional `diagnostics` param) with reason codes `unmatched_pair` / `ambiguous_pair` / `date_mismatch` / `consumed_or_duplicate`; no admin UI added. `normalizeUpstreamOddsEvent` had to move out of `route.ts` into `routeInternals.ts` because Next.js forbids non-handler exports from a route module. Behavior change: an undated event whose pair has multiple canonical games no longer fans out — it is skipped as ambiguous (single-candidate undated events still attach). PLATFORM-020 odds quota/cache guards untouched; score attachment, schedule canonicalization, teamIdentity unchanged. tsc/lint:all/build green; `npm test` 981 (981 pass, 0 skip, +6 vs 975; the 3 PLATFORM-030 contracts now run green).

### PLATFORM-030-ATTACHMENT-REGRESSION-TESTS-v1

- Purpose: Add regression coverage for schedule-based score/odds attachment and schedule eligibility BEFORE changing odds matching behavior (PLATFORM-031-EVENT-DATE-AWARE-ATTACHMENT-v1). Score attachment is strong; odds attachment is still pair-only and can misattach same-pair games (rematches, bowls, CFP repeats, duplicate provider events).
- Scope: Test-only. `src/lib/__tests__/{oddsAttachment,scoreAttachment,schedule-eligibility}.test.ts`. No production changes; no testability exports needed.
- Notes: Commit `(this PR)`. Odds: passing tests document current schedule-canonical safety (unmatched events create no entries; only canonical games attach) AND current UNSAFE pair-only behavior (one event fans out to both same-pair games; duplicate provider events first-win). Intended invariants that fail today are `test.skip` with explicit "requires PLATFORM-031-EVENT-DATE-AWARE-ATTACHMENT-v1 (event-centric/date-aware odds attachment)" comments — `OddsAttachmentEventBase` has no commence_time, so date disambiguation is unattainable until PLATFORM-031 extends the event shape. Score: resolved-but-unscheduled rows cannot create scores (`no_scheduled_match`); postseason providerWeek reset attaches to canonical postseason week; neutral-site reversed orientation attaches via identity-aware pair matching; regular vs postseason meetings of the same teams stay on distinct games. Eligibility: unit coverage of `getRegularSeasonEligibilityDecision`/`isOfficePoolEligibleTeamMatchup`/`classifyTeamSubdivision`/`isFbsTeam` — FBS×FBS and FBS×FCS included, FCS×FCS excluded, unknown/FBS fallback documented, classification driven by metadata/conference not team-name strings ("Georgia Southern" stays FBS). tsc/lint:all/build green; `npm test` 975 total — 972 pass, 3 skip (PLATFORM-031), 0 fail (+19 vs 956). Lineage: originally drafted as PLATFORM-001A, briefly relabeled ODDS-001/002; renamed to the required `<CAMPAIGN>-<###>-<SHORT_NAME>-v<version>` form using the approved `PLATFORM` campaign prefix.

### PLATFORM-020-ADMIN-DEBUG-API-GATES-v1

- Purpose: Require admin authorization on `/api/admin/*` and `/api/debug/*` GET routes that expose diagnostics / storage / API-usage state or can trigger quota-bearing internal fetches. Middleware protected `/admin` pages but several API routes had no `requireAdminAuth(req)`.
- Scope: 11 routes gated (auth as first statement, before any fetch/work): `admin/{usage,storage,odds-usage}`, `admin/win-totals` GET, and 7 debug routes (`conference-diagnostics`, `resolve-team`, `schedule`, `schedule-eligibility`, `scores`, `scores-attachment`, `postseason-score-attachment`). Admin-only client callers updated to send the admin token (`lib/apiUsage.ts` both fns, `AdminStorageStatusPanel`, `lib/scoreAttachmentDebug.ts`). `CFBScheduleApp` odds-usage fetch gated behind `isAdmin`. New tests `src/app/api/__tests__/admin-debug-auth.test.ts`.
- Notes: Commit `(this PR)`. `admin/usage` makes a live CFBD call (`fetchCfbdUsage`) — the primary quota-exposure fix. `admin/odds-usage` was being fetched by the public app for ALL visitors (leaking the owner's API-usage numbers) though it only reads a stored snapshot; per owner direction it is now admin-only and the public app no longer calls it (the odds-refresh quota guard defaults to "allow" when the value is absent — same as the pre-load state, and non-admin odds calls are cache-served, so no functional change for regular users). Routes already correctly gated were left unchanged; their gate ordering was verified. Tests prove: every gated route returns 401 unauthenticated; an unauthenticated `schedule-eligibility` call fires zero internal fetches (global-fetch spy); authorized requests still return 200. tsc/lint:all/build green; `npm test` 945/945, 0 fail, 0 cancelled (+13).

### DRAFT-010-CONFIRM-ELIGIBILITY-v1

- Purpose: Fix draft confirmation so it uses the same eligible-team definition as draft setup and works with the current `src/data/teams.json` shape. Confirmation counted expected teams via `t.classification === 'fbs'`, but no `teams.json` item carries `classification`, so a complete, valid draft was rejected as "0 of 0 picks."
- Scope: `src/lib/draft.ts` (new shared helper), `src/app/api/draft/[slug]/[year]/{confirm,route,pick/route,pick/[n]/route}.ts`, new tests `src/lib/__tests__/draft.test.ts` + `src/app/api/draft/[slug]/[year]/__tests__/confirm-eligibility.test.ts` (+ `_setup/` revalidate-context harness). No draft UX, pick-ordering, dependency, or odds/schedule/standings/appState-infra changes.
- Notes: Commit `(this PR)`. Added one source of truth in `draft.ts` — `getDraftEligibleTeams`/`isDraftEligibleTeam`/`NON_DRAFTABLE_SCHOOLS` defining eligibility as "exclude the `NoClaim` placeholder" (not a `classification` field). `confirm/route.ts` now derives `totalExpectedPicks`, recognized-team validation, and the undrafted-NoClaim remainder from the helper; `route.ts` (setup/update/auto-pick) and both pick routes route their eligibility checks through it too. Tests: helper-level (NoClaim excluded; current catalog yields non-zero eligible == all items, with explicit no-`classification`-key invariant) and route-level (complete draft confirms 200 — fails 422 pre-fix; 3-owner remainder writes correct NoClaim row count). Test-only `_setup/{installAsyncLocalStorage,revalidateContext}.ts` supplies a minimal Next `workAsyncStorage` store so `invalidateStandings`→`revalidateTag` runs under the bare `node:test` runner. tsc/lint:all/build green; `npm test` 916/916, 0 fail, 0 cancelled (911 baseline + 5).

### PLATFORM-003-TEST-APPSTATE-ISOLATION-v1

- Purpose: Remove the cross-process shared-appState flakes so the full Node test suite is deterministic (0 failures, 0 cancelled across repeated runs).
- Scope: `src/lib/server/appStateStore.ts` (test-only-gated path branch) + `package.json` test script. No production behavior change.
- Notes: Commit `(this PR)`. Root cause: the file fallback wrote to a single shared `data/app-state.json`, but `node:test` runs each test file in its own process — parallel appState-backed files (conferences, route-timer, schedule, scores, selectors-leagueStandings) raced on that one file, so the failing set varied per run. Fix: `appStateFilePath()` returns a pid-keyed temp path (`os.tmpdir()/cfb-app-app-state-test-<pid>.json`) when `APP_STATE_TEST_ISOLATION=1`, which the `test` script now sets; each test-file process gets its own store while intra-file `beforeEach` reset behavior is preserved. The flag is never set in dev/production, so the shared `data/app-state.json` path is unchanged there. No store logic bug found — purely a test-process isolation gap. Verified stable: 5 consecutive full `npm test` runs all 911/911, 0 fail, 0 cancelled; tsc/lint:all/build green. Completes the TEST-SUITE-BASELINE-CLEANUP arc.

### PLATFORM-004-TEST-TSC-FIXTURE-CLEANUP-v1

- Purpose: Restore a clean `npx tsc --noEmit`. PR #325's markup cleanup added `CanonicalStandings` test fixtures missing the `inferredSeasonStart` field, leaving 4 pre-existing TS2741 errors on main.
- Scope: Test fixtures only — `MatchupMatrixView.test.tsx`, `MatchupsWeekPanel.test.tsx`, `OwnerPanel.test.tsx`, `StandingsPanel.test.tsx`. No production changes.
- Notes: Commit `49132e5`. Added `inferredSeasonStart: null` to each fixture — `null` matches every source factory default in `leagueStandings.ts`, and these are render tests that don't exercise the `now > inferredSeasonStart` timing logic. `tsc --noEmit` 0 errors (was 4); `npm test` 910/911 (sole failure is the shared-appState flake → `PLATFORM-003-TEST-APPSTATE-ISOLATION-v1`, passes in isolation); lint:all + build green.

### PLATFORM-002-TEST-ROUTER-CLERK-CONTEXT-v1

- Purpose: Eliminate the 12 `CFBScheduleApp.test.tsx` failures caused by missing Next.js App Router and Clerk context (plus a JSX-runtime mismatch) under `renderToStaticMarkup`.
- Scope: Test/harness only — `src/components/__tests__/CFBScheduleApp.test.tsx`, new `src/components/__tests__/_setup/renderWithAppContext.tsx`, new `tsconfig.test.json`, and the `test` script in `package.json`. No production changes.
- Notes: Commit `(this PR)`. Three test-environment layers, none a product bug: (1) `useRouter()` threw "invariant expected app router to be mounted" — no App Router context; (2) `AppHeaderActions` calls `useClerk()`/`useUser()` — no Clerk context; (3) `AppHeaderActions` relies on the automatic JSX runtime (like production via Next SWC) but doesn't import React, while the tsx test loader used the classic runtime (`tsconfig.json` `jsx: "preserve"`), throwing "React is not defined". Fixes: `renderWithAppContext()` wraps elements in `AppRouterContext` + Clerk `ClerkInstanceContext`/`InitialStateProvider` stubs (loaded, signed-out); `tsconfig.test.json` (extends base, `jsx: "react-jsx"`) wired via `TSX_TSCONFIG_PATH` so the test transform matches production's automatic runtime (base tsconfig + Next build untouched); 9 stale markup assertions retargeted to current markup (Open Data Management, API Usage disclosure, Full standings, Team filter, `data-owner-pair-cell` matrix, Overview/Standings/Matchups/Members tabs). CFBScheduleApp 25/25; full suite 907/911, 0 cancelled (was 893/911, 18 fail). Remaining 4 are the cross-process shared-appState flakes (route-timer, selectors-leagueStandings, conferences/route — pass in isolation, victim set varies per run) → `PLATFORM-003-TEST-APPSTATE-ISOLATION-v1`.

### PLATFORM-001-TEST-BASELINE-CLEANUP-v1

- Purpose: Clean up the stale Node test baseline surfaced once `npm test` could terminate. Eliminate both cancelled (timed-out) test files, update stale component markup assertions, and fix architecture-adjacent lib tests whose expectations predated the postseason week-remapping guardrail.
- Scope: Test files only — `OverviewPanel.test.tsx`, `TrendsDetailSurface.test.tsx`, `MatchupsWeekPanel.test.tsx`, `MatchupMatrixView.test.tsx`, `StandingsPanel.test.tsx`, `RankingsPageContent.test.tsx`, `WeekViewTabs.test.tsx`, `GameWeekPanel.test.tsx`, `schedule-eligibility.test.ts`, `teamIdentity.test.ts`. No production changes.
- Notes: Commit `711a032`. The two cancellations were emergent: ~26 (OverviewPanel) / ~13 (TrendsDetailSurface) stale `assert.match` failures each carried the full ~14KB rendered HTML, and the accumulation choked the runner into a file-level timeout (TrendsDetailSurface's `selected focus mode` case also hit an async-teardown spin). Rewritten to query current markup (aria-label legend, tab-gated charts, podium/insight cards, `data-owner-card`/`data-owner-pair-cell`/`data-standings-column`) with semantic assertions over giant HTML regexes. teamIdentity/schedule-eligibility asserted raw provider weeks; production correctly remaps postseason weeks (`canonicalWeek = maxRegularSeasonWeek + providerWeek`) — confirmed stale tests, not product bugs. Full suite after: 0 cancelled, ~895/911 pass (was 818/854, 34 fail + 2 cancelled). Remaining failures are out of scope: CFBScheduleApp (12, needs useRouter/Clerk test context → `PLATFORM-002-TEST-ROUTER-CLERK-CONTEXT-v1`) and cross-process shared-appState flakes in route-timer / selectors-leagueStandings (both pass in isolation → `PLATFORM-003-TEST-APPSTATE-ISOLATION-v1`). **ID note:** the `PLATFORM-001` number predates this and is also used by `PLATFORM-001-ROLLOVER-UI-v1` (distinct short-name); future PLATFORM prompts should continue from `PLATFORM-002`.

### TEST-SUITE-HANG-BASELINE-FIX

- Purpose: Diagnose and fix the pre-existing `npm test` hang on `main` — the suite ran forever with no signal.
- Scope: `package.json` test script only. No production or test-file changes.
- Notes: Commit `dcdadd4` (PR #324). Root cause: `node:test` has no default per-test timeout, so a single runaway test blocks the whole suite indefinitely. Two stale-expectation files contained runaways — TrendsDetailSurface (async-recursion microtask loop; CPU-bound, confirmed via `sample`) and OverviewPanel (synchronous loop emergent across its sequence). Fix: add `--test-timeout=30000` so any runaway is bounded and the suite always terminates with usable results. Prerequisite to `PLATFORM-001-TEST-BASELINE-CLEANUP-v1`, which eliminates the runaways themselves.

### HISTORY-RECORDS-PHASE-2-CAMPAIGN-CLOSEOUT

- Purpose: Documentation closeout for the HISTORY-RECORDS Phase 2 campaign. Logs the rich-template entry in `docs/completed-work.md`, registers all formal Phase 2 PROMPT_IDs in `docs/prompt-registry.md`. No code changes.
- Scope: `docs/completed-work.md`, `docs/prompt-registry.md`. No source code changes.
- Notes: Documentation only. Captures architectural improvements (multi-line row pattern in DESIGN.md, container-query column degradation, scoped-suite + visual-reference conventions in AGENTS.md) and Phase 3 follow-ups (`RECORDS-SCORING-v1`, `SPARSE-DATA-LAYOUT-v1`, `HISTORY-DYNAMIC-TILING-v1`, `INSIGHT-ROUTING-PHASE-3-RETARGET-v1`). Test count grew 87 → 128 across the campaign.

### P7-HISTORY-RECORDS-PHASE-2-STANDINGS-TREND-COLUMN-v1

- Purpose: Add a "Recent Finish" trend chip column to the All-Time Standings table — last 5 seasons of finishes rendered as gold/silver/bronze podium-tier outlines plus default/bottom tiers. Container queries drop oldest-year cells first as the @container narrows.
- Scope: `src/components/history/overview/AllTimeStandingsSummary.tsx`, `src/lib/selectors/historyOverview.ts` (`selectStandingsWithRecentFinishes` + `RecentFinish` types), `src/app/league/[slug]/history/page.tsx`, `mockups/standings-trend.html`, tests.
- Notes: Commit `a4896ba`. Two-row thead when the trend window is non-empty. `TREND_HIDE_BY_POSITION_FROM_NEWEST` static array maps position to `@max-[560/640/720/800/880px]:hidden` (Tailwind JIT requires literal class strings; cannot be built dynamically). Group header hides at 560px matching the last cell. NoClaim filtered per archive before rank derivation. `FinishChip` renders em-dash for `rank === null` (dense-with-nulls array).

### P7-HISTORY-RECORDS-PHASE-2-LAYOUT-REMEDIATION-v1

- Purpose: Resolve standings-table truncation and page-width imbalance found by the layout diagnostic. Drop fixed colgroup widths and `text-ellipsis overflow-hidden whitespace-nowrap` rules; switch to `table-auto` + content-sized cells; remove `w-full` so the table sizes to its content; widen numeric-cell padding to `pl-5` for column separation; reintroduce `mx-auto max-w-7xl` page wrapper after the uncapped exploration scattered desktop content; balance row 3 column heights by dropping marquee record count 5 → 4 and compressing Records to 2-line block treatment.
- Scope: `src/components/history/overview/AllTimeStandingsSummary.tsx`, `src/components/history/overview/RecordsColumn.tsx`, `src/lib/selectors/historyOverview.ts` (`MARQUEE_RECORD_COUNT`), `src/app/league/[slug]/history/page.tsx`, tests.
- Notes: Commits `dc37763`, `904a8f8`, `704c4fa`, `fe99ec3`, `3e1a977`, `93e63fd`. Iterative — multiple visual-review cycles within the prompt's scope. Final standings markup: `<table className="border-collapse">` (no `w-full`, no `table-fixed`); `NUM_CELL = 'pb-2 tabular-nums pl-5 text-right'`. Records column: line 1 = `EYEBROW · Title` (eyebrow keeps category color); line 2 = holders · value.

### P7-HISTORY-RECORDS-PHASE-2-LAYOUT-DIAGNOSTIC-v1

- Purpose: Read-only diagnostic — measure actual rendered widths of standings columns, row 2 / row 3 grids, and inner container widths at the 1280px viewport to inform the layout remediation prompt.
- Scope: Read-only. No code changes.
- Notes: Established that the standings @container width is ~896px at the 1280px viewport with the `1fr / 280px` row 2 grid — earlier trend-column thresholds had been calibrated against viewport width by mistake and needed to be redrawn against actual container widths. Output informed `P7-HISTORY-RECORDS-PHASE-2-LAYOUT-REMEDIATION-v1` and `P7-HISTORY-RECORDS-PHASE-2-STANDINGS-TREND-COLUMN-v1`.

### P7-HISTORY-RECORDS-PHASE-2-VISUAL-REFINEMENT-v1

- Purpose: Tighten typography, color, and spacing in the new Overview block treatments — drop the amber color on "(won title)" annotations (line 2 inherits the dim treatment), drop the `font-medium text-gray-700` override on Championships editorial tags, add `tabular-nums` to Championships line 2.
- Scope: `src/components/history/overview/MoversSection.tsx`, `src/components/history/overview/ChampionshipsSection.tsx`.
- Notes: Commit `147b2f5`. Multi-line row pattern semantics: line-2 metadata inherits the dim color via shared className — section-specific overrides were removed so the pattern reads consistently across rows.

### P7-HISTORY-RECORDS-PHASE-2-CLEANUP-NITS-v1

- Purpose: Drop the "X still chasing" clause from the Championships summary header (low-signal counter) and simplify `computeChampionshipSummary` by removing `stillChasingCount`.
- Scope: `src/components/history/overview/ChampionshipsSection.tsx`, `src/lib/selectors/historyOverview.ts`, tests.
- Notes: Commit `60df930`. The counter was redundant with the "championless owners" context already implicit in the All-Time Standings table.

### P7-HISTORY-RECORDS-PHASE-2-VISUAL-REMEDIATION-AND-CLOSEOUT-v1

- Purpose: Visual-review pass after `PATH-B-AND-RESPONSIVE-v1` — adjust typography, spacing, and chip-tier colors to match the Path C mockup. Gold = yellow-500/yellow-600 light + amber-300 dark, font-semibold; silver = slate-500/slate-600 + slate-300/slate-200 dark; bronze = orange-900 light + arbitrary `#d4915c` dark; default = `black/10` border + dim text; bottom = transparent border + faint text. Writes the mid-campaign closeout summary.
- Scope: `src/components/history/overview/*.tsx`, `mockups/history-redesign-pathC.html`.
- Notes: Commit `49a6de2`. Reference mockup committed at `mockups/history-redesign-pathC.html` per the visual-reference convention later codified in AGENTS.md.

### P7-HISTORY-RECORDS-PHASE-2-PATH-B-AND-RESPONSIVE-v1

- Purpose: Implement the Path B Overview redesign — five-section composition (Championships, 2-row dashboard, Movers, Season archive). Build all overview components with multi-line row block treatment and container-query degradation.
- Scope: `src/components/history/overview/{AllTimeStandingsSummary,ChampionshipsSection,MoversSection,RecentPodiumsColumn,RecordsColumn,SeasonArchiveStrip,TitleStreaksTable,TopRivalriesList}.tsx` (new), `src/lib/selectors/historyOverview.ts` (12+ helpers including `selectChampionshipsWithContext`, `selectDroughtsWithContext`, `selectMoversWithContext`, `selectStreaksOrDroughts`, `selectMarqueeRecords`, `selectRecentPodiums`, `selectSeasonArchiveStrip`, `groupChampionsByOwner`, `computeChampionshipSummary`), `src/lib/selectors/historySelectors.ts` (`AllTimeStandingRow.totalPoints`, `StandingsRow.pointsFor`, `selectAllTimeHeadToHead.latestMeeting`), `src/app/league/[slug]/history/page.tsx`, tests.
- Notes: Commit `f4e093d`. Multi-line row pattern: line 1 = primary identifier + right-anchored value (14–15px, weight 500); line 2 = secondary metadata (12px, weight 400, dim color, 2px inter-line margin). Page wraps in `mx-auto max-w-7xl`; row 2 grid `lg:grid-cols-[1fr_280px]`; row 3 grid `lg:grid-cols-[1fr_1fr_280px]`. Selector composition pattern: `selectXWithContext` enrichment over base types.

### DESIGN-MD-MULTILINE-AND-DEGRADATION-v1

- Purpose: Document the multi-line row pattern, list row width discipline, and responsive column degradation as reusable design primitives in `DESIGN.md`. Reconcile the section-divider rule and the dense-table column-header rule. Align the Section Headers CTA arrow glyph with the implementation.
- Scope: `DESIGN.md`.
- Notes: Commits `083cca0`, `23a4ec6`. Pattern available for future tables under sidebar-narrow allocations. Tailwind JIT constraint documented: container-query syntax (`@container` + `@max-[Xpx]:hidden`) requires literal class strings — cannot be built dynamically.

### P7-HISTORY-RECORDS-PHASE-2-OVERVIEW-REVISION-FOLLOWUP-v1

- Purpose: Follow-up to `OVERVIEW-REVISION-v1` — exclude former owners from Title Droughts so the section doesn't list owners no longer in the league. Filter on `activeOwners` set passed from server.
- Scope: `src/lib/selectors/historyOverview.ts`, `src/app/league/[slug]/history/page.tsx`.
- Notes: Commits `b15b779`, `945b302`. `activeOwners` derives from `owners:{slug}:{year}` CSV. Codex-review remediation (`c0a2ca0`) later added an archive-union fallback for empty-CSV states (pre-upload, post-reset, storage-miss).

### P7-HISTORY-RECORDS-PHASE-2-OVERVIEW-REVISION-v1

- Purpose: First Overview redesign cut — replace the single-stat hero with whole-league-arc storytelling. Subtab routing infrastructure (`HistorySubNav`, `RecordBadge`) + Stats/Rivalries/Archive Phase 3 placeholder routes; Overview five-section scaffold; `resolveHistoryHref` extended with rivalry types.
- Scope: `src/components/history/{HistorySubNav,RecordBadge}.tsx` (new), `src/app/league/[slug]/history/page.tsx`, `src/app/league/[slug]/history/{stats,rivalries,archive}/page.tsx` (new), `src/components/OverviewPanel.tsx` (`resolveHistoryHref`), tests.
- Notes: Commits `164b79f`, `8534f15`, `f5f73aa`, `bcb64df`. Pre-revision Overview rendered as a single-stat hero with no drill-down. Subtab routes initially scaffolded as Phase 3 placeholders; `resolveHistoryHref` rivalry/drought/dynasty targets reverted to Overview anchors during codex-review fixes because the placeholders weren't user-ready (`INSIGHT-ROUTING-PHASE-3-RETARGET-v1` filed for re-pointing once Phase 3 ships content).

### SEASON-LAUNCH-HARDENING-CAMPAIGN-CLOSEOUT

- Purpose: Documentation closeout for the Season Launch Hardening campaign (Phases 1–3, all merged). Updates completed-work, AGENTS.md, prompt-registry, next-tasks. Creates campaign retrospective at `docs/campaigns/season-launch-hardening.md`. No code changes.
- Scope: `docs/completed-work.md`, `AGENTS.md`, `docs/prompt-registry.md`, `docs/next-tasks.md`, `docs/campaigns/season-launch-hardening.md` (new). No source code changes.
- Notes: Documentation only. Captures new architectural invariants: canAccessDraftBoard auth pattern, phase-aware polling cadence, time-dependent classification out of cached selectors, insights engine suppression layering + bypassSuppression semantics + usingArchivedRoster framing.

### SEASON-LAUNCH-HARDENING-PHASE-3-CODEX-REMEDIATION

- Purpose: Fix `shouldSuppressGenerator` to honor `bypassSuppression` — the new engine filter was unconditional, blocking admin diagnostic runs that expected unfiltered output.
- Scope: `src/lib/insights/engine.ts`, `src/lib/__tests__/insights-lifecycle-awareness.test.ts`.
- Notes: Commit `6358c2c`. Changed `.filter((g) => !shouldSuppressGenerator(g, context))` to `.filter((g) => bypassSuppression || !shouldSuppressGenerator(g, context))`. Bypass test added with save/restore of global generator registry.

### SEASON-LAUNCH-HARDENING-PHASE-3-INSIGHTS-LIFECYCLE-AWARENESS

- Purpose: Make the insights engine aware of preseason/archived-roster context — suppress, reframe, or add zero-game guards across all 11 generator surfaces. Add 22 new lifecycle-awareness tests.
- Scope: `src/lib/insights/engine.ts`, `src/lib/insights/framing.ts` (new), `src/lib/insights/generators/career.ts`, `src/lib/insights/generators/stats.ts`, `src/lib/insights/generators/existing.ts`, `src/lib/selectors/insights.ts`, `src/lib/__tests__/insights-lifecycle-awareness.test.ts` (new).
- Notes: Commit `385a071`. Engine: `shouldSuppressGenerator` cross-cutting filter (`career:rookie_benchmark` suppressed when `usingArchivedRoster`). Framing: `applyLastSeasonFraming` (7 surfaces, "Last season's" prefix), `applyReturningOwnerFraming` (4 surfaces, "Returning owner" narrative). `rookieBenchmarkGenerator` early-returns when `usingArchivedRoster`. Zero-game guards on `deriveLeagueInsights`, `deriveTightRaceInsight`, `deriveTightClusterInsight`. 22 tests covering framing helpers, per-generator on/off, lifecycle assertions, engine bypass.

### SEASON-LAUNCH-HARDENING-PHASE-2-CODEX-REMEDIATION

- Purpose: Move the kickoff-past `Date.now()` check out of the `unstable_cache`-wrapped selector and into consumers — the selector must return a time-invariant fact, not a time-dependent classification.
- Scope: `src/lib/selectors/leagueStandings.ts`, `src/components/StandingsPanel.tsx`, `src/components/CFBScheduleApp.tsx`, `src/lib/__tests__/selectors-leagueStandings.test.ts`.
- Notes: Commit `43516b0`. Selector always returns `preseason-awaiting-kickoff` when probe data exists; never embeds `Date.now()`. StandingsPanel and CFBScheduleApp evaluate `new Date(inferredSeasonStart).getTime() > Date.now()` at render time. Test `p2-season-kickoff-past` updated to assert `source: 'preseason-awaiting-kickoff'` (selector returns the fact; consumer decides what it means).

### SEASON-LAUNCH-HARDENING-PHASE-2-STANDINGS-PRESEASON-STATE

- Purpose: Build the `preseason-awaiting-kickoff` canonical standings source — selector consults `getScheduleProbeState` for a kickoff date, StandingsPanel renders a date-aware placeholder, CFBScheduleApp.isPreseason broadened to cover the awaiting-kickoff case.
- Scope: `src/lib/selectors/leagueStandings.ts`, `src/components/StandingsPanel.tsx`, `src/components/CFBScheduleApp.tsx`, `src/lib/__tests__/selectors-leagueStandings.test.ts`.
- Notes: Commit `88af434`. `CanonicalStandingsSource` extended with `'preseason-awaiting-kickoff'`. `inferredSeasonStart: string | null` added to `CanonicalStandings`. `resolveSeason` and `resolvePreseason` empty paths call `getScheduleProbeState(year).firstGameDate`. 5 new Phase 2 tests. No `Date.now()` in selector (time check moved to consumers in Phase 2 Codex remediation).

### SEASON-LAUNCH-HARDENING-PHASE-1-CODEX-REMEDIATION

- Purpose: Fix two Codex findings from Phase 1: (1) `/draft/summary` blocked spectators with an unintended redirect; (2) draft polling stopped on complete rather than slowing, missing re-open events.
- Scope: `src/app/league/[slug]/draft/summary/page.tsx`, `src/components/draft/DraftBoardClient.tsx`, `src/components/draft/SpectatorBoardClient.tsx`.
- Notes: Commit `d24a2f3`. Summary page: removed `if (!isAdmin) redirect(...)` — kept `isAdmin` computation for prop-passing only. Polling: changed complete-phase early `return` (interval cleared) to 30s interval so clients keep polling and detect re-open events.

### SEASON-LAUNCH-HARDENING-PHASE-1-DRAFT-AUTH-AND-POLLING

- Purpose: (A) Gate draft admin pages server-side via `canAccessDraftBoard`; remove inline `clerkRole` checks from three client components. (B) Add phase-aware polling to draft board clients.
- Scope: `src/lib/server/canAccessDraftBoard.ts` (new), `src/app/league/[slug]/draft/page.tsx`, `src/app/league/[slug]/draft/setup/page.tsx`, `src/app/league/[slug]/draft/summary/page.tsx`, `src/components/draft/DraftBoardClient.tsx`, `src/components/draft/DraftSetupShell.tsx`, `src/components/draft/DraftSummaryClient.tsx`, `src/components/draft/SpectatorBoardClient.tsx`.
- Notes: Commit `5968604`. `canAccessDraftBoard` wraps `isPlatformAdminSession()`; Phase 7 stub (`void slug`). Draft/setup pages redirect non-admins to `/draft/board`. `isAdmin` passed as server-derived prop; `useUser()`/`clerkRole`/`isTokenAdmin` removed from all three client components. Polling IIFE: 1.5s (live+running), 30s (complete), 5s default.

### SEASON-LAUNCH-HARDENING-DISCOVERY

- Purpose: Read-only pre-launch audit covering four known or suspected blockers: draft auth leakage, draft polling excess, standings preseason blank state, insights lifecycle blindness.
- Scope: Read-only. `src/app/league/[slug]/draft/`, `src/components/draft/`, `src/lib/selectors/leagueStandings.ts`, `src/lib/insights/`.
- Notes: No code changes. Output: written audit report with severity ratings, root-cause analysis, and remediation plan for each item. Commit chain for implementation: `5968604`, `d24a2f3`, `88af434`, `43516b0`, `385a071`, `6358c2c`.

### STANDINGS-OWNERSHIP-CAMPAIGN-CLOSEOUT

- Purpose: Documentation closeout for the Standings Ownership Model Redesign campaign (Phases 0-5, all merged). Updates completed-work, AGENTS.md, prompt registry, roadmap, and next-tasks. Creates campaign retrospective at `docs/campaigns/standings-ownership.md`. No code changes.
- Scope: `docs/completed-work.md`, `AGENTS.md`, `docs/prompt-registry.md`, `docs/roadmap.md`, `docs/next-tasks.md`, `docs/campaigns/standings-ownership.md` (new). No source code changes.
- Notes: Documentation only. Captures architectural invariants (standings data ownership, mutation invalidation, cache wrapping, NoClaim filtering, lifecycle parameterization) and deferred backlog items (INSIGHTS-LIFECYCLE-AWARENESS, POSTSEASON-START-WEEK-SCHEDULE-DERIVED, INVALIDATE-STANDINGS-PER-LEAGUE, HEADER-ARCHITECTURE-UNIFICATION).

### STANDINGS-OWNERSHIP-PHASE-5-LIFECYCLE-v1

- Purpose: Phase 5 lifecycle hardening — parameterize `currentDate` in `deriveLifecycleState`, add `usingArchivedRoster` flag to `InsightContext`, document `POSTSEASON_START_WEEK` constant with Option B rationale.
- Scope: `src/lib/lifecycle.ts` (or equivalent), `src/lib/insights/types.ts`, `src/lib/insights/context.ts`, relevant request handlers. No UI changes.
- Notes: Shipped. `currentDate` captured once at request-handler entry, passed through all derivation layers. `usingArchivedRoster: boolean` added to `InsightContext` for `fresh_offseason` fallback gating. `POSTSEASON_START_WEEK = 16` documented with rationale comment; schedule-derived derivation deferred (Option B).

### STANDINGS-OWNERSHIP-PHASE-4-HISTORY-v1

- Purpose: Phase 4 History live-rebuild migration — replace `buildSeasonArchive(slug, activeYear)` with `getCanonicalStandings({ slug, year: activeYear })` on the History page.
- Scope: `src/app/league/[slug]/history/page.tsx` (or equivalent history route).
- Notes: Shipped. History page now uses canonical standings rather than rebuilding an archive in-place. Eliminates a parallel derivation path.

### STANDINGS-OWNERSHIP-PHASE-3-MEMBERS-MATCHUPS-v1

- Purpose: Phase 3 Members + Matchups route migrations. Migrate `OwnerPanel`, `MatchupsWeekPanel`, `MatchupMatrixView` to consume canonical standings. Add pulsing LIVE pill dot as second liveDelta UI integration. Add `router.refresh()` to 5 admin forms.
- Scope: `src/app/league/[slug]/members/page.tsx` (or equivalent), `src/app/league/[slug]/matchups/page.tsx` (or equivalent), `src/components/OwnerPanel.tsx`, `src/components/MatchupsWeekPanel.tsx`, `src/components/MatchupMatrixView.tsx`, 5 admin form components.
- Notes: Shipped. LIVE pill pulsing dot wired to `liveDelta`. Admin forms: alias editor, postseason override, season rollover, backfill, roster editor — all call `router.refresh()` after success.

### STANDINGS-OWNERSHIP-PHASE-2-STANDINGS-ROUTE-v1

- Purpose: Phase 2 Standings route + StandingsPanel migration. Server route loads canonical. `StandingsPanel` consumes canonical rows, history, colorOrder. First liveDelta UI: W-L pending badges. NoClaim filtering moved to source.
- Scope: `src/app/league/[slug]/standings/page.tsx`, `src/components/StandingsPanel.tsx`, `src/lib/standings.ts` (or `src/lib/selectors/leagueStandings.ts`).
- Notes: Shipped (PR #294 area). `deriveStandings` returns `{ rows, noClaimRow, ... }` with rows excluding NoClaim. `splitOutNoClaim` helper added. W-L pending badges appear next to owner names when a live game is in progress.

### STANDINGS-OWNERSHIP-PHASE-1-OVERVIEW-v1

- Purpose: Phase 1 Overview takeover collapse — remove merge-at-render-time logic from `CFBScheduleApp`'s Overview path. Introduce `liveDelta` interface + `selectLiveDelta` selector + `useLiveDelta` hook.
- Scope: `src/components/CFBScheduleApp.tsx`, `src/lib/selectors/liveDelta.ts` (new), `src/hooks/useLiveDelta.ts` (new), `src/lib/selectors/types.ts`.
- Notes: Shipped. `LiveGameDelta`, `LivePendingOwnerDelta`, `LiveDelta` types defined. Canonical (server) owns rows/history/colorOrder; `liveDelta` (client) owns in-progress overlays. These travel as separate props to all consumers.

### STANDINGS-OWNERSHIP-PHASE-0-INVALIDATION-v1

- Purpose: Phase 0 invalidation infrastructure — wrap `getCanonicalStandings` with `unstable_cache` + `React.cache`, add `invalidateStandings` helper, wire into all mutation routes.
- Scope: `src/lib/selectors/leagueStandings.ts` (or equivalent), `src/lib/invalidateStandings.ts` (new or inline), all mutation routes under `src/app/api/`, `src/components/RosterUploadPanel.tsx`.
- Notes: Shipped. Tag granularity: `standings:{slug}` and `standings:{slug}:{year}`. Closure pattern bakes `slug+year` into `unstable_cache` key array. `RosterUploadPanel` calls `router.refresh()` after upload.

### STANDINGS-OWNERSHIP-MODEL-DISCOVERY-v1

- Purpose: Read-only scoping investigation — diagnose root cause of NoClaim-at-#1 and Overview inconsistency, evaluate merge-at-render-time vs canonical-server approaches, produce the 6-phase redesign plan.
- Scope: Read-only. Analyzed `CFBScheduleApp.tsx`, `StandingsPanel.tsx`, `OverviewPanel.tsx`, selectors, API routes. No code changes.
- Notes: Concluded that 8 remediation rounds on the Overview migration PR all addressed merge-at-render-time edge cases. Proposed architecture: server canonical for settled data, client `liveDelta` for live overlays, distinct props at consumer sites.

### STANDINGS-CANONICAL-SELECTOR-OVERVIEW-v1

- Purpose: Prompt 2 of original canonical selector campaign — migrate Overview path to consume canonical standings from server.
- Scope: `src/components/CFBScheduleApp.tsx`, `src/components/OverviewPanel.tsx`, related selectors.
- Notes: Shipped (PR #294). Multiple remediation rounds exposed that merge-at-render-time was architecturally brittle; informed the subsequent STANDINGS-OWNERSHIP-MODEL-DISCOVERY replanning.

### STANDINGS-CANONICAL-SELECTOR-CORE-v1

- Purpose: Prompt 1 of original canonical selector campaign — build `getCanonicalStandings` as a server-callable selector returning stable standings rows, owner color order, and Games Back values.
- Scope: `src/lib/selectors/leagueStandings.ts` (new), related type definitions.
- Notes: Shipped (PR #291). Established the `CanonicalStandings` type and the `getCanonicalStandings` function. Foundation for all subsequent migration phases.

### STANDINGS-CANONICAL-SELECTOR-DISCOVERY-v1

- Purpose: Read-only investigation — map all current standings derivation paths, identify inconsistencies, scope the canonical selector work. Originally proposed a 4-prompt campaign (CORE, OVERVIEW, FANOUT, SERVER-INSIGHTS).
- Scope: Read-only. No code changes, no commits.
- Notes: Identified the merge-at-render-time pattern as the root cause of Overview surface disagreements. Proposed canonical selector as the fix; later expanded to full 6-phase redesign after Phase 2 remediation experience.

### DOCS-CLOSEOUT-006

- Purpose: Documentation closeout for the INSIGHTS-017 campaign. Logs all shipped prompts + STANDINGS-SUBHEADER-FIX, updates roadmap and next-tasks with completion status, registers every prompt in the registry, and adds eight new backlog items surfaced during this campaign.
- Scope: `docs/completed-work.md`, `docs/roadmap.md`, `docs/next-tasks.md`, `docs/prompt-registry.md`. No code changes.
- Notes: Covers INSIGHTS-017-PANEL-UI, INSIGHTS-017-POLISH-DISCOVERY, INSIGHTS-017-POLISH-DISCOVERY-FOLLOWUP, INSIGHTS-017-PANEL-POLISH, INSIGHTS-017-POLISH-FOLLOWUP-DISCOVERY, INSIGHTS-017-PANEL-POLISH-FOLLOWUP, STANDINGS-SUBHEADER-DIAGNOSTIC, STANDINGS-SUBHEADER-FIX. Also logs Neon Postgres Free → Launch tier upgrade ($19/month) and adds eight new backlog items: INSIGHTS-017-PALETTE, HISTORY-REWORK, STANDINGS-PRESEASON-STATE, ALL-INSIGHTS-PAGE, APPSTATESTORE-CACHING, LINK-STYLING-AUDIT, STANDINGS-PAGE-LIFECYCLE-LABELING, INSIGHTS-RANKER-TUNING.

### STANDINGS-SUBHEADER-FIX

- Purpose: Wire `mostRecentArchivedYear` into the main league page so the offseason "{year} Final Standings" subheader branch fires when users reach the standings view via the WeekViewTabs click (the primary flow), not just via the dedicated `/standings` route.
- Scope: `src/app/league/[slug]/page.tsx` only.
- Notes: Commit `3890bad`. Single-file 9-line change. `listSeasonArchives(slug)` added to the existing `Promise.all`; `mostRecentArchivedYear` computed via `[...archiveYears].sort((a, b) => b - a)[0]` (matching the standings page); passed as prop to `CFBScheduleApp`. No changes to standings page, prop type, or subheader branch — those were already correct.

### STANDINGS-SUBHEADER-DIAGNOSTIC

- Purpose: Read-only investigation into why the offseason "{year} Final Standings" subheader branch added in INSIGHTS-017-PANEL-POLISH-FOLLOWUP was not firing on the standings page. Page rendered plain "Offseason" instead.
- Scope: Read-only diagnostic. No code changes, no commits.
- Notes: Root cause: `WeekViewTabs.tsx` "Standings" button is a `<button>` that toggles local state via `onChange`, not a route `<Link>`. Users reaching the standings view via the in-page tab stay on the `/league/{slug}` route where `mostRecentArchivedYear` had not been plumbed. Informed STANDINGS-SUBHEADER-FIX.

### INSIGHTS-017-PANEL-POLISH-FOLLOWUP

- Purpose: Final polish pass on the Insights Panel campaign. Reroute SEASON season_wrap insights (`champion_margin`, `failed_chase`) from `/standings` to year-scoped history; add offseason-correct "{year} Final Standings" subheader via `leagueStatus` plumbing and archive-based year resolution; tighten light-mode arrow contrast on insight rows.
- Scope: `src/components/OverviewPanel.tsx`, `src/components/StandingsPanel.tsx`, `src/app/league/[slug]/insights/AllInsightsRow.tsx`, `src/app/league/[slug]/standings/page.tsx`, `src/components/CFBScheduleApp.tsx`.
- Notes: Commit `113b27d`. `insightHref` signature extended with optional `panelYear?: number` 4th arg; reroutes only `season_wrap` + (`champion_margin` | `failed_chase`) + valid `panelYear` to `/history/{year}`. `leagueStatus={league?.status}` + `mostRecentArchivedYear` now passed to `CFBScheduleApp` from standings page; new nested ternary branch renders "{year} Final Standings" only when `leagueStatus.state === 'offseason'` AND `weekViewMode === 'standings'` AND a resolved archive year is available. Arrow class changed from `text-gray-400` to `text-gray-500` at all three render sites (OverviewPanel InsightRow, SeasonRecapRow, AllInsightsRow); `dark:text-zinc-500` unchanged. No changes to generators, derive helpers, `Insight` type, or `insightCategories.ts`.

### INSIGHTS-017-POLISH-FOLLOWUP-DISCOVERY

- Purpose: Read-only investigation to answer implementation questions for the INSIGHTS-017-PANEL-POLISH followup — confirms SEASON insight year availability, current `navigationTarget: 'standings'` call sites, arrow color contrast baseline, `leagueStatus` plumbing path, and history year route encoding.
- Scope: Read-only diagnostic. No code changes, no commits.
- Notes: Established that season year is not on the insight payload but is available at the panel layer (`currentYear` on OverviewPanel, `season` on StandingsPanel). Six `navigationTarget: 'standings'` call sites identified — only two (`champion_margin` line 450, `failed_chase` line 486) are `season_wrap`. Arrow color in light mode (`#9ca3af`) measured at ~2.85:1 contrast against white (below WCAG 3:1). Confirmed `listSeasonArchives` as authoritative source for "most recently completed season".

### INSIGHTS-017-PANEL-POLISH

- Purpose: Polish pass on the Insights Panel. Flatten row 1 prominence pending ranker maturity, add HISTORICAL/RIVALRY deep-link arrows via panel-layer resolver, add section anchors to the history page, fix light-mode banner colors.
- Scope: `src/components/OverviewPanel.tsx`, `src/app/league/[slug]/history/page.tsx`, `src/components/CFBScheduleApp.tsx`.
- Notes: Commit `a82ef02`. `insightHref` extended to 3-arg signature with optional `Insight` third param; `resolveHistoryHref()` added — Tier 1 routable (drought → `#dynasty-drought`, dynasty → `#championships`, career/owner generators → `/history/owner/{owner}`, `greatest_season` → `/history/{year}` via `parseYearFromInsightId`, rivalry types → `#rivalries`, `milestone_watch-wins` → owner page); Tier 2 returns `null` for `career_points_leader`, `career_turnover_margin`, `milestone_watch-points` pending HISTORY-REWORK. Three `<section id=>` anchors added to history page with `scroll-mt-4` buffer. All five CFBScheduleApp banner variants converted from hardcoded hex to paired `{light, dark}` palette objects keyed off existing `isDark`.

### INSIGHTS-017-POLISH-DISCOVERY-FOLLOWUP

- Purpose: Resolve five follow-up questions from INSIGHTS-017-POLISH-DISCOVERY — fixed header presence, owner slug URL convention, structural tied-owner insight analysis, destination-fit audit per insight type, DESIGN.md palette rules.
- Scope: Read-only diagnostic. No code changes, no commits.
- Notes: Confirmed no fixed header (scroll-mt-4 sufficient); canonical URL convention is `encodeURIComponent(owner)`; tied-owner insights cap at max 3 owners (`TIE_SUPPRESSION_THRESHOLD = 4`); three insight types flagged as Tier 2 (no viable history surface today); DESIGN.md codifies strict hue-level ban on amber/green/red/blue for category use.

### INSIGHTS-017-POLISH-DISCOVERY

- Purpose: Read-only investigation of row affordances, HISTORICAL/RIVALRY metadata, history page structure, deep-link feasibility, banner component, and category microlabel palette in preparation for INSIGHTS-017-PANEL-POLISH.
- Scope: Read-only diagnostic. No code changes, no commits.
- Notes: Mapped 13 history link sites using `encodeURIComponent(owner)`; identified five CFBScheduleApp banner variants with hardcoded dark-mode-only hex; inventoried 26 insight types by deep-link feasibility (Tier 1 vs Tier 2); enumerated category microlabel palette collisions (HISTORICAL/STANDINGS/SEASON share purple, STATS/LEAGUE/fallback share slate) for future INSIGHTS-017-PALETTE work.

### INSIGHTS-017-PANEL-UI

- Purpose: Initial Insights Panel UI redesign — 5 insights (up from 3), 10px uppercase category microlabels, first-row prominence via larger type, fully tappable rows with `→` affordance, "See all →" link to dedicated insights page.
- Scope: `src/components/OverviewPanel.tsx`, `src/app/league/[slug]/insights/AllInsightsRow.tsx` (new), `src/app/league/[slug]/insights/page.tsx` (new), `DESIGN.md`.
- Notes: Commit `1348605`. `AllInsightsRow` extracted as a `'use client'` component to access `useIsDarkMode()` for category colors (unblocks `light-dark()` CSS issue in server components). `fresh_offseason` featured slot becomes "Season Recap" card pointing to `/history`. `DESIGN.md` updated with Insights Panel + Insight Category Colors sections codifying the token pairs and the semantic-off-limits rule.

### DOCS-CLOSEOUT-005

- Purpose: Update all project documentation to reflect everything completed since DOCS-CLOSEOUT-004 — Copy Variation Architecture campaign and Insights Panel UI direction decisions.
- Scope: `docs/completed-work.md`, `docs/roadmap.md`, `docs/next-tasks.md`, `docs/prompt-registry.md`. No code changes.
- Notes: Covers INSIGHTS-016, INSIGHTS-016-COPY-VARIATION, INSIGHTS-016-COPY-FIX, INSIGHTS-016-CR-FIXES.

### INSIGHTS-016-CR-FIXES

- Purpose: Fix two code review bugs — league-scoped suppression records and gated suppression reset on rollover.
- Scope: `src/lib/insights/suppression.ts`, `src/app/api/cron/season-rollover/route.ts`.
- Notes: Suppression storage scope changed from global `'insights-suppression'` to `'insights-suppression:{leagueSlug}:{season}'`. `loadSuppressionRecords`, `saveSuppressionRecord`, `clearAllSuppressionRecords` now accept `leagueSlug` + `season`. Engine passes `context.leagueSlug` + `context.currentYear`. Rollover suppression clear moved inside per-league success path (gated on both archive + status update succeeding). Response reports `suppressionClearedFor: string[]`.

### INSIGHTS-016-COPY-FIX

- Purpose: Fix `career_points_leader` `extending_lead`/`narrowing_gap` hook-copy mismatch.
- Scope: `src/lib/insights/generators/career.ts` only.
- Notes: Post-hoc override block that wrote `narrowing_gap`-framed copy ("closest it's ever been") while the hook remained `extending_lead` was removed. "Closest it's ever been" language folded into the `narrowing_gap` template branch, conditioned on `ratio <= POINTS_CLOSE_RATIO`. `extending_lead` now always produces "pulling away" copy. `career_turnover_margin` audited — no override block, consistent copy.

### INSIGHTS-016-COPY-VARIATION

- Purpose: Full implementation of the Copy Variation Architecture — newsHook + statValue on all generators, suppression gate, async engine, per-generator templates.
- Scope: `src/lib/insights/types.ts`, `src/lib/selectors/insights.ts`, `src/lib/insights/suppression.ts` (new), `src/lib/insights/engine.ts`, `src/lib/insights/generators/historical.ts`, `src/lib/insights/generators/rivalry.ts`, `src/lib/insights/generators/career.ts`, `src/lib/insights/generators/stats.ts`, `src/lib/insights/generators/milestones.ts`, `src/lib/insights/generators/existing.ts`, `src/app/api/insights/[slug]/route.ts`, `src/app/api/cron/season-rollover/route.ts`.
- Notes: `newsHook` (11 types) + `statValue: number` required on `Insight`. `suppression.ts` implements per-league/season scope, per-type threshold rules, NEVER_SUPPRESS_TYPES set. Engine async: load → generate → filter suppressed → sort → slice 10 → write. `?bypassSuppression=1` bypasses gate. Season rollover clears suppression records.

### DOCS-CLOSEOUT-004

- Purpose: Update all project documentation to reflect everything completed since DOCS-CLOSEOUT-003 — Insights Engine Generator Batch 2, context extension, bug fixes, and copy variation architecture decisions.
- Scope: `docs/completed-work.md`, `docs/roadmap.md`, `docs/next-tasks.md`, `docs/prompt-registry.md`. No code changes.
- Notes: Covers INSIGHTS-014, INSIGHTS-015, INSIGHTS-015-BUG-FIXES, and Copy Variation Architecture decisions from Opus 1M Brainstorming Session 2.

### INSIGHTS-015-BUG-FIXES

- Purpose: Fix UTF-8 encoding issue (missing charset header on API response) and trending direction logic (strict monotonicity check).
- Scope: `src/app/api/insights/[slug]/route.ts`, `src/lib/insights/generators/career.ts`.
- Notes: Charset header added to Content-Type response. Trending up/down now requires all season-over-season deltas to be in the same direction (strict monotonicity), not just net direction.

### INSIGHTS-015-GENERATOR-BATCH-2

- Purpose: Build 16 new insight generators across career, stats, and milestones files. Add tone property and InsightWindow type.
- Scope: `src/lib/insights/generators/career.ts` (new), `src/lib/insights/generators/stats.ts` (new), `src/lib/insights/generators/milestones.ts` (new), `src/lib/insights/types.ts`, `src/lib/insights/generators/index.ts`.
- Notes: career.ts: career_points_leader, career_turnover_margin, volatility, never_last, title_chaser, rookie_benchmark, greatest_season, trending_up/down. stats.ts: ball_security, takeaway_king, yards_per_win, clock_crusher, third_down, team_identity. milestones.ts: milestone_watch, perfect_against. Generator-level `tone: 'factual' | 'playful'` added. `InsightWindow` type defined for future parameterization.

### INSIGHTS-014-CONTEXT-EXTENSION

- Purpose: Extend InsightContext with career stats — OwnerCareerStats type, buildOwnerCareerStats(), pointsAgainst on OwnerSeasonStats, and career diagnostic route.
- Scope: `src/lib/insights/types.ts`, `src/lib/insights/context.ts`, `src/lib/gameStats/ownerStats.ts`, `src/app/api/debug/insights-career-diagnostic/route.ts` (new).
- Notes: `OwnerCareerStats` fields: seasons, totalWins, totalLosses, totalPoints, totalPointsAgainst, totalYards, turnovers, turnoverMargin, titles, titleYears, finishHistory, firstSeason, isRookie. Career stats assembled at query time from archive data. `pointsAgainst` on `OwnerSeasonStats` unlocks Luck Score generator.

### DOCS-CLOSEOUT-003

- Purpose: Update all project docs after the Insights Engine generators, Season Rollover, History page polish, and code review fixes.
- Scope: `docs/completed-work.md`, `docs/roadmap.md`, `docs/next-tasks.md`, `docs/prompt-registry.md`. No code changes.
- Notes: Covers INSIGHTS-010 through INSIGHTS-013B, INSIGHTS-CR-001, PLATFORM-001, POLISH-003.

### INSIGHTS-CR-001-CODE-REVIEW-FIXES-v1

- Purpose: Fix two bugs from code review — missing league-scoped aliases in the insights API, and incorrect "tied" copy for non-tied even rivalries.
- Scope: `src/app/api/insights/[slug]/route.ts`, `src/lib/insights/generators/rivalry.ts`.
- Notes: PR #278. API now uses `getGlobalAliases()` + `aliases:{slug}:{year}` merge server-side (matches `/api/owners` routes). Even rivalry copy branches on `winDiff` — 0 → "tied at", 1 → "X leads Y N-M across K meetings — the closest rivalry in the league".

### INSIGHTS-013B-TIE-LOGIC-v1

- Purpose: Apply universal tie suppression across historical generators — 4+ tied suppress; 2–3 use group copy; 1 keeps existing copy.
- Scope: `src/lib/insights/generators/historical.ts`.
- Notes: PR #278. Applied to drought (incl. never-won), consistency (max top-3), improvement (same positions jumped). Dynasty unchanged (already handled ties). Added `TIE_SUPPRESSION_THRESHOLD = 4` and `formatOwnerList()` helper.

### INSIGHTS-013-GENERATOR-FIXES-v1

- Purpose: Fix dynasty tie handling, drought ranking for never-won owners, and active-owner filtering across all seven insight types.
- Scope: `src/lib/insights/generators/historical.ts`, `src/lib/insights/generators/rivalry.ts`.
- Notes: PR #278. Dynasty emits three copy variants (sole / tied-with-recent / tied-equal-recency). Drought = seasons played when never-won. Active-owner filter via `context.currentRoster` applied to drought, dynasty, improvement, consistency, lopsided_rivalry, even_rivalry, dominance_streak.

### POLISH-003-HISTORY-PAGE-FIXES-v1

- Purpose: Fix all-time standings sort order and add visual distinction for former league owners.
- Scope: `src/lib/selectors/historySelectors.ts`, `src/components/history/AllTimeStandingsTable.tsx`, `src/components/history/AllTimeHeadToHeadPanel.tsx`, `src/app/league/[slug]/history/page.tsx`.
- Notes: PR #278. New sort: Total Wins → Win% → Point Differential. `totalPointDifferential` added to `AllTimeStandingRow`. Active owners derived from `owners:{slug}:{year}` CSV on the server; former owners render muted + "Former" badge in both the all-time standings table and the Top Rivalries panel. `activeOwners: string[]` props (not `Set<string>`) to preserve server/client serialization.

### PLATFORM-001-ROLLOVER-UI-v1

- Purpose: Build a Season Rollover admin panel at `/admin/data/cache` with a two-phase preview/execute flow, plus an automatic rollover cron triggered by national championship game date + 7 days.
- Scope: `src/components/admin/SeasonRolloverPanel.tsx` (new), `src/app/api/admin/rollover/route.ts`, `src/app/api/cron/season-rollover/route.ts` (new), `src/lib/seasonRollover.ts`, `src/app/admin/data/cache/page.tsx`, `vercel.json`.
- Notes: PR #278. Preview response extended with `champion` + `top3` per league for UI display. `findNationalChampionshipGameDate()` prefers `playoffRound === 'national_championship'` with postseason fallback. Cron runs daily, filters non-test leagues in `state: 'season'`, per-league error isolation. TSC successfully rolled over via the new panel.

### INSIGHTS-012-LEAGUE-STATE-DIAGNOSTIC-v1

- Purpose: Diagnose why TSC was still in `state: 'season'` after the 2025 season ended. Read-only.
- Scope: Read-only diagnostic.
- Notes: Identified that existing cron only handles preseason→season; season→offseason required a manual rollover. Informed PLATFORM-001-ROLLOVER-UI.

### INSIGHTS-012-API-ROUTE-v1

- Purpose: Build `GET /api/insights/[slug]` and wire the insights engine into the overview panel.
- Scope: `src/app/api/insights/[slug]/route.ts` (new), `src/components/OverviewPanel.tsx`, `src/lib/selectors/overview.ts`.
- Notes: PR #278. Merge strategy — engine insights first, existing insights fill up to 3. Owners CSV, schedule, scores, rankings, and archives loaded server-side; context built via `buildInsightContext()`.

### INSIGHTS-011-GENERATORS-v1

- Purpose: Add historical (drought, dynasty, improvement, consistency) and rivalry (lopsided, even, dominance streak) generators, both self-registering.
- Scope: `src/lib/insights/generators/historical.ts` (new), `src/lib/insights/generators/rivalry.ts` (new), `src/lib/insights/generators/index.ts`.
- Notes: PR #278. Engine-level try/catch isolates per-generator failures. Active-owner filter derived from current roster.

### INSIGHTS-010-CLEANUP-v1

- Purpose: Canonicalize `aggregateOwnerSeasonStats()` in `ownerStats.ts` and remove the local mirror from `context.ts`.
- Scope: `src/lib/gameStats/ownerStats.ts`, `src/lib/insights/context.ts`.
- Notes: PR #278. Single source of truth for owner season-stat aggregation; no duplicate logic in context builder.

### INSIGHTS-010-CONTEXT-LIFECYCLE-v1

- Purpose: Add `deriveLifecycleState()` and `buildInsightContext()` so generators receive a consistent, self-contained context.
- Scope: `src/lib/insights/context.ts` (new), `src/lib/insights/types.ts`.
- Notes: PR #278. Lifecycle derived from `LeagueStatus` + `SeasonContext` + calendar (7 states). Context assembles standings history, games, game stats, archives, historical rosters, current roster, AP rankings.

### DOCS-CLOSEOUT-002

- Purpose: Update all project documentation to reflect Game Stats Pipeline completion and Insights Engine Foundation work.
- Scope: `docs/completed-work.md`, `docs/roadmap.md`, `docs/next-tasks.md`, `docs/prompt-registry.md`. No code changes.
- Notes: Covers INSIGHTS-006 through INSIGHTS-009, POLISH-001/002, ROADMAP-RESTRUCTURE, DOCS-CLOSEOUT-001.

### INSIGHTS-009-GENERATOR-RESTRUCTURE-v1

- Purpose: Restructure `selectors/insights.ts` around a formal generator interface. Resolve the `deriveLeagueInsights` naming conflict. Add `category`, `lifecycle`, `stat` fields to `Insight` type. Port existing functions as registered generators.
- Scope: `src/lib/insights/types.ts` (new), `src/lib/insights/engine.ts` (new), `src/lib/insights/generators/existing.ts` (new), `src/lib/selectors/insights.ts`, `src/lib/gameTags.ts`, `src/lib/selectors/overview.ts`, `src/lib/__tests__/gameTags.test.ts`.
- Notes: PR #276. `deriveLeagueInsights` in `gameTags.ts` renamed to `deriveGameMovementInsights`. Canonical `deriveLeagueInsights` in `selectors/insights.ts` retains its name. All 8 derive functions annotated with category + lifecycle. 43/43 tests pass.

### INSIGHTS-008-DEAD-CODE-CLEANUP-v1

- Purpose: Remove orphaned narrative insight logic from `leagueInsights.ts`, relocate all actively-consumed exports to `gameTags.ts`, clean up associated orphaned tests.
- Scope: `src/lib/gameTags.ts` (new, rename from `leagueInsights.ts`), `src/lib/__tests__/gameTags.test.ts` (renamed), `src/lib/selectors/gameWeek.ts`, `src/lib/selectors/overview.ts`, `src/components/GameWeekPanel.tsx`, `src/components/MatchupsWeekPanel.tsx`.
- Notes: PR #276. Removed `computeWeeklyInsights`, `WeeklyInsights`, `addOwnerCount`, `scoreForSide`, `projectedWinsForOwner` (252 lines). Discovered `overview.ts` was an undiscovered active consumer of `deriveLeagueInsights` — kept and moved, not deleted.

### INSIGHTS-007-EXISTING-AUDIT-v1

- Purpose: Fully map all existing insight logic before building the Insights Engine. Read-only audit.
- Scope: Read-only. All insight-related files: `selectors/insights.ts`, `leagueInsights.ts`, `selectors/overview.ts`, `StandingsPanel.tsx`, `OverviewPanel.tsx`, all test files.
- Notes: Identified two functions named `deriveLeagueInsights` (naming conflict). Found `deriveLeagueInsights` in `leagueInsights.ts` was incorrectly flagged as orphaned — `overview.ts` actively consumes it at line 947.

### INSIGHTS-006-ARCHITECTURE-REVIEW-v1

- Purpose: Read-only review of proposed Insights Engine architecture. Validate design against codebase, identify gaps, naming conflicts, missing types.
- Scope: Read-only audit.
- Notes: Confirmed the two-`Insight`-type naming collision as a blocker requiring resolution before generator work begins. Recommended extending `selectors/insights.ts` rather than replacing it.

### POLISH-002-RUNBOOK-UPDATE-v1

- Purpose: Update `docs/deployment-runbook.md` to reflect current Clerk-based auth model.
- Scope: `docs/deployment-runbook.md` only.
- Notes: PR #276. Removed all `ADMIN_API_TOKEN` references. Added Clerk production instance setup, `platform_admin` role configuration, and Vercel environment variable checklist.

### POLISH-001-QUALITY-BASELINE-v1

- Purpose: Restore passing lint and TypeScript baseline. Fix all existing lint violations and type errors without changing any logic.
- Scope: 86 source files reformatted (Prettier), 1 test fixed (`selectors-overview.test.ts`), zero ESLint violations.
- Notes: PR #276. No logic changes. Type fixes were structural (missing `as const`, narrowing patterns); formatter fixes were style-only.

### ROADMAP-RESTRUCTURE-v1

- Purpose: Replace phase-based naming with campaign-based workstream organization in all project docs.
- Scope: `docs/roadmap.md`, `docs/next-tasks.md`, `docs/completed-work.md`. No code changes.
- Notes: Phase numbering retired. Existing `P{n}` prompt IDs grandfathered. New prompts use `{CAMPAIGN}-{###}` format. Campaign prefixes: INSIGHTS, DRAFT, PLATFORM, POLISH.

### DOCS-CLOSEOUT-001-v1

- Purpose: Update project docs after Game Stats Pipeline completion (P7B-GAME-STATS-PIPELINE-A through INSIGHTS-004).
- Scope: `docs/completed-work.md`, `docs/roadmap.md`, `docs/next-tasks.md`, `docs/prompt-registry.md`. No code changes.
- Notes: Captured pipeline build, backfill, normalization, school name fix, and latest week fix.

### INSIGHTS-004-SCHOOL-NAME-FIX-v1

- Purpose: Fix CFBD school name field — normalizer was reading `school` field but CFBD response uses `team` field name.
- Scope: `src/lib/gameStats/normalizers.ts` only.
- Notes: PR #275. Corrected field reference from `.school` to `.team` in `normalizeGameTeamStats()`.

### INSIGHTS-003-DATA-DIAGNOSTIC-v1

- Purpose: Add temporary diagnostic route for owner game stats to inspect raw cached structure and resolution chain.
- Scope: `src/app/api/debug/game-stats-diagnostic/route.ts` (new). Admin-gated.
- Notes: PR #275. Three build fixes (`INSIGHTS-003-BUILD-FIX`, `-FIX-2`, `-FIX-3`) applied. Debug-FIX applied for raw cache inspection.

### INSIGHTS-002-LATEST-WEEK-FIX-v1

- Purpose: Fix latest week detection — was using week number comparison which could pick the current in-progress week instead of the most recently completed one.
- Scope: `src/app/api/cron/game-stats/route.ts`, `src/lib/gameStats/cache.ts`.
- Notes: PR #274. Use calendar date to determine last completed week — compare against `new Date()` to exclude current week.

### P7B-ROADMAP-INSIGHTS-CONSOLIDATE-v1

- Purpose: Merge Preseason Insights Panel into Insights Engine campaign in roadmap.
- Scope: `docs/roadmap.md` only. No code changes.

### P7B-GAME-STATS-NORMALIZE-v1

- Purpose: Add 6 special teams and defensive return fields to `TeamGameStats` and normalizer.
- Scope: `src/lib/gameStats/types.ts`, `src/lib/gameStats/normalizers.ts`.
- Notes: Fields: `interceptionReturnYards`, `interceptionReturnTDs`, `kickReturnYards`, `kickReturnTDs`, `puntReturnYards`, `puntReturnTDs`.

### P7B-GAME-STATS-BACKFILL-v1

- Purpose: Add "Backfill Full Season" button to game stats admin panel.
- Scope: `src/components/admin/GameStatsCachePanel.tsx`.
- Notes: Iterates all weeks 1–19 sequentially; progress shown inline.

### P7B-GAME-STATS-CACHE-PANEL-v1

- Purpose: Add `GameStatsCachePanel` with "Refresh Game Stats" button to admin cache page.
- Scope: `src/components/admin/GameStatsCachePanel.tsx` (new), `src/app/admin/data/cache/page.tsx`.
- Notes: Shows cache freshness per week. Refresh triggers `/api/game-stats` route.

### P7B-GAME-STATS-PIPELINE-A-v1

- Purpose: Build game stats data pipeline — types, normalizers, cache layer, owner aggregation, API route, cron route.
- Scope: `src/lib/gameStats/types.ts` (new), `src/lib/gameStats/normalizers.ts` (new), `src/lib/gameStats/cache.ts` (new), `src/lib/gameStats/ownerStats.ts` (new), `src/app/api/game-stats/route.ts` (new), `src/app/api/cron/game-stats/route.ts` (new).
- Notes: PR #274. One call per week to CFBD. `aggregateOwnerGameStats()` uses `TeamIdentityResolver`. Cache key `${year}:${week}:${seasonType}`.

### P7B-GAME-STATS-AUDIT-v1

- Purpose: Document CFBD game team stats endpoint shape and integration plan.
- Scope: `docs/game-stats-audit.md` (new). Read-only analysis.
- Notes: Confirmed endpoint `GET /games/teams`, documented all available stat categories, identified owner aggregation strategy.

### P7B-LAUNCH-DOCS-CLOSEOUT

- Purpose: Update completed-work, roadmap, next-tasks, and prompt-registry to reflect all launch preparation work completed since P7B-DRY-RUN-DOCS-CLOSEOUT.
- Scope: `docs/completed-work.md`, `docs/roadmap.md`, `docs/next-tasks.md`, `docs/prompt-registry.md`. No code changes.
- Notes: Documents comprehensive audit, UI/UX polish, force-dynamic fix, demo UI polish, Clerk migration, domain setup, and branding update.

### P7B-BRANDING-UPDATE

- Purpose: Rename all user-facing references from "CFB League Dashboard" / "CFB App" to "Turf War"; update URL examples to `turfwar.games`.
- Scope: `src/app/layout.tsx`, `src/app/login/[[...sign-in]]/page.tsx`, `src/components/RootPageClient.tsx`, `src/components/__tests__/CFBScheduleApp.test.tsx`.
- Notes: PR #272. No config, env var, or internal doc references changed. `cfb-app-preview.vercel.app` left unchanged (dev URL).

### P7B-CLERK-MIGRATION-AUDIT

- Purpose: Audit all Clerk configuration, session token claims, publicMetadata role patterns, and auth flows in preparation for production instance migration.
- Scope: Read-only audit. No code changes.
- Notes: Identified session token claim key (`platform_admin` in publicMetadata), all Clerk-dependent routes, and migration steps required.

### P7B-UI-POLISH-DEMO-FIXES

- Purpose: Fix demo-blocking UI issues identified in the comprehensive audit: custom not-found/error pages, light mode fix on cache admin, autoPickMetric dropdown removal.
- Scope: `src/app/not-found.tsx` (new), `src/app/error.tsx` (new), `src/app/admin/data/cache/page.tsx`, `src/components/draft/DraftSettingsPanel.tsx`.
- Notes: Resolves four items from P7B-UI-UX-POLISH-AUDIT top-10 list.

### P7B-FORCE-DYNAMIC-FIX

- Purpose: Add `export const dynamic = 'force-dynamic'` to all pages that read from the database or call server-side APIs at request time, resolving a Vercel build blocker.
- Scope: 11 pages across `src/app/`.
- Notes: Build blocker identified in P7B-COMPREHENSIVE-AUDIT. All affected pages now correctly opt out of static generation.

### P7B-UI-UX-POLISH-AUDIT

- Purpose: Full page-by-page UI/UX audit of the app; rate each surface and identify the top 10 improvements.
- Scope: Read-only audit. No code changes.
- Notes: 10 improvements prioritized; several addressed immediately in P7B-UI-POLISH-DEMO-FIXES.

### P7B-APP-WIDE-AUDIT

- Purpose: Comprehensive 16-section app-wide audit covering architecture, auth, data flows, API usage, build config, and deployment readiness.
- Scope: Read-only audit. No code changes.
- Notes: One build blocker identified (force-dynamic missing on 11 pages), resolved in P7B-FORCE-DYNAMIC-FIX.

### MERGE-CONFLICT-FIX

- Purpose: Resolve merge conflicts in three files after merging origin/main into polish-draft-flow branch.
- Scope: `src/app/admin/[slug]/actions.ts`, `src/app/admin/[slug]/components/TestLeagueControls.tsx`, `src/app/admin/[slug]/preseason/page.tsx`.
- Notes: 7 conflict hunks resolved. Kept ours' `autoCompleteDraft` and revalidatePaths; took theirs' `updateLeague` in `completeSetup`, string return from `migrateTestOwnersCsv`, `isSetupComplete` checklist item, two-state button rendering.

### MERGE-CONFLICT-AUDIT

- Purpose: Read-only audit of all conflict markers in three conflicted files before resolution.
- Scope: Read-only audit.
- Notes: Identified 5 compatible conflicts (keep both) and 2 mutually exclusive conflicts (take theirs — more complete implementation).

### P7B-RESET-RACE-FIX

- Purpose: Fix lost-update race in `resetTestLeague()` — `updateLeague` and `updateLeagueStatus` both write the same registry array and must not run in parallel.
- Scope: `src/app/admin/[slug]/actions.ts` only.
- Notes: Sequential awaits for the two registry writes; four `deleteAppState` calls remain parallel (independent keys).

### P7B-COMPLETE-SETUP-HUB-FIX

- Purpose: Admin hub now shows "Setup Complete ✓" green state when `setupComplete === true`.
- Scope: `src/app/admin/[slug]/page.tsx` only.
- Notes: Two distinct preseason cards: in-progress shows "Continue Setup" link; complete shows green badge with "Season will go live automatically" note.

### P7B-COMPLETE-SETUP-REVALIDATE-3

- Purpose: Audit async call chain in `completeSetup()` — confirmed all awaits correct, no missing awaits.
- Scope: Read-only audit of `completeSetup()` and `updateLeagueStatus()` internals.

### P7B-COMPLETE-SETUP-REVALIDATE-2

- Purpose: Add `revalidatePath('/admin/${slug}', 'layout')` to bust full route segment cache after setup complete.
- Scope: `src/app/admin/[slug]/actions.ts`.

### P7B-COMPLETE-SETUP-REVALIDATE

- Purpose: Add `revalidatePath` calls to `completeSetup()` so Next.js cache is busted before redirect.
- Scope: `src/app/admin/[slug]/actions.ts`.

### P7B-SANDBOX-AUTO-COMPLETE-DRAFT

- Purpose: Add "Auto-complete Draft" sandbox button that fills all remaining picks randomly and writes owners CSV.
- Scope: `src/app/admin/[slug]/actions.ts`, `src/app/admin/[slug]/components/TestLeagueControls.tsx`.
- Notes: Fisher-Yates shuffle; snake draft order via `getPickOwner` logic; writes `draft:test/{year}` as complete + `owners:test:{year}/csv` with NoClaim rows. Test league only.

### P7B-SANDBOX-RESET-FIX

- Purpose: Fix sandbox reset controls to clear all preseason state for clean dry runs.
- Scope: `src/app/admin/[slug]/actions.ts`.
- Notes: "Set: Pre-Season" clears preseason-owners, owners CSV, draft state for target year. "Reset to 2025 Season" also clears all 2026 state including schedule-probe. "Reset Draft" unchanged (draft + owners CSV only).

### P7B-ROSTER-CHECK-FIX

- Purpose: `hasRoster` falls back to owners CSV so a completed draft satisfies roster requirement.
- Scope: `src/app/admin/[slug]/preseason/page.tsx`.
- Notes: Fetches `owners:${slug}:${year}/csv` in parallel; `hasCsvRoster` = header + ≥2 data lines. Either source satisfies the check.

### P7B-AUDIT-ROSTER-CHECK

- Purpose: Read-only audit of `hasRoster` check — identified that confirm route writes owners CSV but `hasRoster` only reads preseason-owners store (different scope).
- Scope: Read-only audit.

### P7B-AUDIT-COMPLETE-SETUP-GUARD

- Purpose: Verify Complete Setup button is disabled when roster not configured — confirmed `canGoLive` guard is correct.
- Scope: Read-only audit of `src/app/admin/[slug]/preseason/page.tsx`.

### P7B-DRAFT-SETUP-OWNERS-REMOVE

- Purpose: Remove redundant owners add/remove section from `DraftSettingsPanel`.
- Scope: `src/components/draft/DraftSettingsPanel.tsx`.
- Notes: Owners initialized from `draftState.owners` or `priorOwners`; `setOwners` setter removed; handlers `handleAddOwner`/`handleRemoveOwner` removed. Draft order section unchanged.

### P7B-CONTINUE-SETUP-LINK

- Purpose: Add "Continue Setup →" links on draft board complete banner and draft summary page; fix `DraftSummaryClient` to use dual-auth pattern.
- Scope: `src/components/draft/DraftHeaderArea.tsx`, `src/components/draft/DraftSummaryClient.tsx`, `src/components/draft/DraftBoardClient.tsx`, `src/app/admin/[slug]/page.tsx`.
- Notes: "Continue Setup →" only shown when admin + league in preseason. `DraftSummaryClient` now uses `useUser()` from Clerk alongside `hasStoredAdminToken()`.

### P7B-AUDIT-COMMISH-URL

- Purpose: Read-only audit of commissioner URL patterns and auth detection across draft components.
- Scope: Read-only audit.

### P7B-DRAFT-START-FIX

- Purpose: Fix "Start Draft" button causing redirect loop — phase not transitioned to `live` before navigation.
- Scope: `src/components/draft/DraftSetupShell.tsx`.
- Notes: `handleStartDraft()` now calls `PUT /api/draft/${slug}/${year}` with `{ phase: 'live' }` before `window.location.href` redirect.

### P7B-OVERVIEW-BANNER-COUNTDOWN

- Purpose: Add adaptive countdown label to draft scheduled banner (days away / tomorrow / today / starting soon).
- Scope: `src/components/CFBScheduleApp.tsx`.

### P7B-OVERVIEW-BANNER-STYLE-FIX

- Purpose: Fix banner using wrong year (2025 vs 2026) and draft fetch not finding draft — both caused by using `league.year` instead of `leagueStatus.year`.
- Scope: `src/components/CFBScheduleApp.tsx`, `src/app/league/[slug]/page.tsx`.
- Notes: `bannerYear` and `draftLookupYear` now derived from `leagueStatus.year` when in preseason/season.

### P7B-OVERVIEW-BANNER-STYLE

- Purpose: Apply left-border accent styling and pulsing live indicator dot to overview lifecycle banners.
- Scope: `src/components/CFBScheduleApp.tsx`.
- Notes: 3px left border via inline styles; dark backgrounds; right-side-only border radius. CSS keyframes `cfb-pulse` and `cfb-pulse-ring` injected via `<style>` tag.

### P7B-OVERVIEW-BANNER

- Purpose: Add state-driven lifecycle banners and header subtitle to league overview page.
- Scope: `src/components/CFBScheduleApp.tsx`, `src/app/league/[slug]/page.tsx`.
- Notes: Banner system driven by `leagueStatus` prop. States: offseason, preseason (no draft/scheduled/in-progress/complete), season.

### P7B-AUDIT-SEASON-STATE

- Purpose: Read-only audit of league lifecycle state implementation — status storage, transition actions, UI rendering, year derivation.
- Scope: Read-only audit.

### P7B-PRESEASON-REGRESSION-FIX-2

- Purpose: Bind "Complete Setup" button to `completeSetup()` (not `goLive()`); restore raw CSV migration in `migrateTestOwnersCsv`.
- Scope: `src/app/admin/[slug]/preseason/page.tsx`, `src/app/admin/[slug]/components/TestLeagueControls.tsx`, `src/app/admin/[slug]/actions.ts`, `src/lib/league.ts`.
- Notes: `completeSetup()` sets `{ state: 'preseason', setupComplete: true }` — no season transition. `migrateTestOwnersCsv` reads/writes raw CSV without parsing.

### P7B-PRESEASON-REGRESSION-FIX

- Purpose: Rename "Go Live" button label to "Complete Setup"; add "Migrate Owners →" button to TestLeagueControls.
- Scope: `src/app/admin/[slug]/preseason/page.tsx`, `src/app/admin/[slug]/components/TestLeagueControls.tsx`.

### P7B-PRESEASON-CHECKLIST-FIX

- Purpose: Remove "Season live" item from preseason checklist — it was circular and unsatisfiable via the checklist flow.
- Scope: `src/app/admin/[slug]/preseason/page.tsx`.

### P7B-SEASON-TRANSITION-C

- Purpose: Pre-season overview page with owner rosters and schedule placeholder. Prevent prior season data bleed-through. Update all project documentation.
- Scope: `src/components/CFBScheduleApp.tsx`, `docs/completed-work.md`, `docs/roadmap.md`, `docs/next-tasks.md`, `docs/prompt-registry.md`.
- Notes: Owner roster cards rendered inline during preseason with no schedule. Fatal bootstrap error suppressed in preseason. `isPreseason` boolean added. No 2025 bleed — `selectedSeason` keyed to `leagueStatus.year`.

### P7B-SEASON-TRANSITION-B-FIX

- Purpose: Fix setupComplete UI state, confirm league.year sync in cron, improve CRON_SECRET error clarity.
- Scope: `src/app/admin/[slug]/preseason/page.tsx`, `src/app/api/cron/season-transition/route.ts`.
- Notes: Checklist item reactive to `setupComplete`. Green badge + cron note replaces button post-setup. `verifyCronSecret` returns discriminated `'ok' | 'not-configured' | 'invalid'` with distinct error messages.

### P7B-SEASON-TRANSITION-B

- Purpose: Rename "Go Live" to "Complete Setup", decouple from state transition, add Vercel cron for automatic season transition.
- Scope: `src/app/admin/[slug]/actions.ts`, `src/app/admin/[slug]/preseason/page.tsx`, `src/components/draft/DraftSummaryClient.tsx`, `src/app/api/cron/season-transition/route.ts` (new), `vercel.json` (new), `src/lib/scheduleProbe.ts` (new), `src/app/api/schedule/route.ts`.
- Notes: `completeSetup()` sets `setupComplete: true` on preseason status, no state transition. Cron probes CFBD, caches schedule, transitions leagues day before first game. `ScheduleProbeState` tracks `baseCachedAt` and `firstGameDate`. Manual refresh updates probe state.

### P7B-SEASON-TRANSITION-A

- Purpose: Fix schedule year derivation for preseason state.
- Scope: `src/lib/scores/normalizers.ts`, `src/app/api/schedule/route.ts`, `src/components/admin/GlobalRefreshPanel.tsx`, `src/components/CFBScheduleApp.tsx`, `src/components/admin/HistoricalCachePanel.tsx`, `src/app/admin/data/cache/page.tsx`.
- Notes: `seasonYearForToday()` threshold moved from `>= 7` (August) to `>= 6` (July). `GlobalRefreshPanel` accepts `defaultYear` prop. `CFBScheduleApp` uses `leagueStatus.year` for `selectedSeason` during preseason.

### P7B-AUDIT-SCHEDULE-YEAR

- Purpose: Read-only audit of schedule year derivation across the app.
- Scope: `GlobalRefreshPanel.tsx`, `CFBScheduleApp.tsx`, `schedule/route.ts`, `schedule.ts`, `useScheduleBootstrap.ts`, admin pages.
- Notes: Identified that all schedule fetches default to `seasonYearForToday()` (2025 in April 2026) — league state year is ignored. No path reads `leagueStatus.year` for schedule fetching.

### P7B-AUDIT-HISTORY-AND-SEASON-TRANSITION

- Purpose: Read-only audit of History tab, schedule caching, Go Live, first game date detection, cron mechanisms, and season archive connection.
- Scope: Full codebase read-only audit.
- Notes: History tab fully implemented (14 components, 3 routes). Schedule global, not per-league. No cron/scheduled mechanisms exist. First game date derivable from cached `ScheduleItem.startDate`. Archive → History connection already wired. `goLive()` only validates `state !== 'preseason'` — no server-side checklist enforcement.

### P7B-7

- Purpose: Polish the draft flow — remove redundant setup step, add drag-and-drop reordering, auto-pause between rounds, context-aware draft banner, neutral Available Teams background, visual hierarchy improvements.
- Scope: `src/components/draft/DraftSetupShell.tsx`, `src/components/draft/DraftSettingsPanel.tsx`, `src/components/draft/DraftBoardClient.tsx`, `src/components/draft/SpectatorBoardClient.tsx`, `src/components/draft/DraftBoardGrid.tsx`, `src/components/draft/DraftCard.tsx`, `src/components/draft/DraftControls.tsx`, `src/components/CFBScheduleApp.tsx`, doc updates.
- Notes: Setup step 1 (RosterSetupPanel) removed — auto-advance from preseason-owners; DraftSettingsPanel gains inline owner management + drag-and-drop + number entry for manual order; auto-pause at round boundaries with "Start Round X" button; spectator shows "Round X starting soon…"; league overview banner is blue-tinted with scheduled date or round info; DraftCard uses neutral bg-white/bg-zinc-800; section labels bolded with bottom borders; Available Teams panel gets subtle surface tint.

### P7B-6

- Purpose: Draft board UI polish — remove Rosters column, simplify DraftCard to name/conference/dot, update DraftBoardGrid cell colors, add spectator search, clean up landing page.
- Scope: `src/lib/selectors/draftTeamInsights.ts`, `src/components/draft/DraftCard.tsx`, `src/components/draft/DraftBoardGrid.tsx`, `src/components/draft/DraftBoardClient.tsx`, `src/components/draft/SpectatorBoardClient.tsx`, `src/components/RootPageClient.tsx`, `src/app/page.tsx`, doc updates.
- Notes: `teamColor: string | null` added to `DraftTeamInsights`; DraftCard stripped to 3 fields; `teamColorMap` passed to DraftBoardGrid for completed-cell tinting; active cell `bg-blue-600`, on-deck `bg-blue-100`; spectator now has search input; "Draft Setup →" removed from landing card; NoClaim filtered from owner count; status label derives from `league.status`.

### P7B-6-FIX

- Purpose: Follow-up fixes to draft board polish — on-the-clock consistent blue, active/on-deck cell colors.
- Scope: `src/components/draft/DraftBoardGrid.tsx`, `src/components/draft/DraftBoardClient.tsx`.

### P7B-6-FIX-2

- Purpose: Left color bar on Available Teams cards and pick cells.
- Scope: `src/components/draft/DraftCard.tsx`, `src/components/draft/DraftBoardGrid.tsx`.

### P7B-6-FIX-3

- Purpose: Team colors sourced from `getTeamDatabaseItems()`, conference colors as fallback.
- Scope: `src/lib/selectors/draftTeamInsights.ts`.

### P7B-6-FIX-3-HOTFIX

- Purpose: Hotfix for team color lookup casing mismatch.
- Scope: `src/components/draft/DraftBoardGrid.tsx`.

### P7B-6-FIX-4

- Purpose: Available Teams panel narrowed to 210px, search added to spectator view.
- Scope: `src/components/draft/SpectatorBoardClient.tsx`, `src/components/draft/DraftBoardClient.tsx`.

### P7B-6-FIX-5

- Purpose: Landing page cleanup — "Draft Setup →" link removed, NoClaim excluded from owner count.
- Scope: `src/components/RootPageClient.tsx`, `src/app/page.tsx`.

### P7B-6-FIX-5B

- Purpose: Draft status row links to draft when live/paused.
- Scope: `src/components/RootPageClient.tsx`.

### P7B-6-FIX-5C

- Purpose: Spectator banner removed.
- Scope: `src/components/draft/SpectatorBoardClient.tsx`.

### P7B-6-FIX-5D

- Purpose: md breakpoint fix for two-column layout.
- Scope: `src/components/draft/DraftBoardClient.tsx`, `src/components/draft/SpectatorBoardClient.tsx`.

### P7B-5-FIX-6

- Purpose: Fix manual assignment `teamsHref` re-introduced 404 — was set to `/admin/${slug}/assign`, corrected to `/admin/${slug}/preseason`.
- Scope: `src/app/admin/[slug]/preseason/page.tsx` only.
- Notes: Regression introduced in P7B-5 prompt which specified `/assign`; correct target is `/preseason` since manual assignment is coming-soon on that page.

### P7B-5-FIX-5

- Purpose: Bridge Clerk session auth in DraftBoardClient — add `useUser()` check alongside sessionStorage token to prevent premature redirect while Clerk loads.
- Scope: `src/components/draft/DraftBoardClient.tsx`.
- Notes: `isAdmin = isTokenAdmin || (clerkLoaded && clerkRole === 'platform_admin')`; redirect guard checks `if (isTokenAdmin) return; if (!clerkLoaded) return;`.

### P7B-5-FIX-4

- Purpose: Fix spectator board (`/league/[slug]/draft/board/page.tsx`) using `league.year` instead of lifecycle status year.
- Scope: `src/app/league/[slug]/draft/board/page.tsx`.
- Notes: Same `status?.state==='preseason'||status?.state==='season' ? status.year : league.year` pattern applied.

### P7B-5-FIX-3

- Purpose: Fix commissioner draft board (`/league/[slug]/draft/page.tsx`) using `league.year` instead of lifecycle status year — caused infinite redirect loop.
- Scope: `src/app/league/[slug]/draft/page.tsx`.
- Notes: `draft` looked up wrong year → null → redirect to setup → redirect back. Fixed with lifecycle-aware year derivation.

### P7B-5-FIX-2

- Purpose: Add Reset Draft button to TestLeagueControls — deletes all `draft:test/{year}` keys and corresponding `owners:test:{year}/csv` entries.
- Scope: `src/app/admin/[slug]/components/TestLeagueControls.tsx`, `src/app/admin/[slug]/actions.ts`.
- Notes: `resetTestDraft` server action uses `listAppStateKeys(draftScope('test'))` then `deleteAppState` for each; revalidates `/admin/test`.

### P7B-5-FIX

- Purpose: Fix owner confirmation page pre-population — three-step fallback: saved preseason-owners → archive → live owner CSV (fixes test league which has no archives).
- Scope: `src/app/admin/[slug]/preseason/owners/page.tsx`.
- Notes: Step 3 reads `getAppState<string>(\`owners:${slug}:${priorYear}\`, 'csv')` — corrected from prompt spec which had wrong key format.

### P7B-5

- Purpose: Build owner confirmation flow for pre-season setup, wire draft auto-populate from confirmed owner list, fix checklist links, close out P7B-4 in docs.
- Scope: `src/lib/preseasonOwnerStore.ts` (new), `src/app/admin/[slug]/preseason/owners/page.tsx` (new), `src/app/admin/[slug]/preseason/owners/OwnerConfirmationShell.tsx` (new), `src/app/admin/[slug]/actions.ts`, `src/app/admin/[slug]/preseason/page.tsx`, `src/app/league/[slug]/draft/setup/page.tsx`, doc updates.
- Notes: preseason-owners storage key `preseason-owners:{slug}` / `{year}`; confirmation requires ≥2 owners; checklist "Owners confirmed" checks preseason-owners not owners CSV; draft setup prefers confirmed list over archive-derived fallback; teamsHref now fully method-aware (draft/manual/null).

### P7B-4-FIX-5

- Purpose: Three fixes — sync `league.year` in goLive, method-aware `teamsAssigned` check with `manualAssignmentComplete` field, fix manual assignment link to `/preseason` (was 404 `/assign`).
- Scope: `src/lib/league.ts`, `src/app/admin/[slug]/actions.ts`, `src/app/admin/[slug]/preseason/page.tsx`.
- Notes: `goLive` now calls `updateLeague(slug, { year })` after `updateLeagueStatus`. `manualAssignmentComplete?: boolean` added to `League`. `teamsAssigned`: draft→`draftPhase==='complete'`, manual→`manualAssignmentComplete===true`, null→`false`. Coming-soon note added for manual method.

### P7B-4-FIX-4

- Purpose: Remove stale `tool.key === 'draft'` comparison in hub tool card loop that caused TypeScript build error after Draft card removal.
- Scope: `src/app/admin/[slug]/page.tsx` only.
- Notes: Replaced method-conditional href with unconditional `const href = \`/admin/\${slug}/\${tool.key}\``.

### P7B-4-FIX-3

- Purpose: Fix draft setup page using `league.year` instead of lifecycle status year; fix test controls season transition year carry-forward.
- Scope: `src/app/league/[slug]/draft/setup/page.tsx`, `src/app/admin/[slug]/actions.ts`.
- Notes: Draft setup now derives year from `status?.state`; `setTestLeagueStatus('season')` carries preseason year forward.

### P7B-4-FIX-2

- Purpose: Remove Draft card from hub tool cards array.
- Scope: `src/app/admin/[slug]/page.tsx`.
- Notes: Draft accessible only through pre-season flow, not directly from hub.

### P7B-4-FIX

- Purpose: Fix erratic year toggling in test controls (double-increment); add Reset to 2025 Season button.
- Scope: `src/app/admin/[slug]/actions.ts`, `src/app/admin/[slug]/components/TestLeagueControls.tsx`.
- Notes: `setTestLeagueStatus('preseason')` is now idempotent when already in preseason. `resetTestLeague` hard-resets league.year and status to `{season, 2025}`.

### P7B-4

- Purpose: Build pre-season setup flow: wire Begin Pre-Season button, new preseason page, three-item checklist, assignment method selection (draft/manual), Go Live button, hub cleanup.
- Scope: `src/app/admin/[slug]/page.tsx`, `src/app/admin/[slug]/preseason/page.tsx` (new), `src/app/admin/[slug]/components/AssignmentMethodCard.tsx` (new), `src/app/admin/[slug]/actions.ts`.
- Notes: Checklist: Owners confirmed / Teams assigned / Season live. Go Live gated by both. Assignment method persisted to `league.assignmentMethod`. Draft card removed from hub.

### P6-FINAL-CLOSEOUT-v1

- Purpose: Close out all remaining Phase 6 polish and fix work in planning docs and register all prompt IDs.
- Scope: `docs/completed-work.md`, `docs/roadmap.md`, `docs/next-tasks.md`, `docs/prompt-registry.md`. No code changes.
- Notes: Final Phase 6 closeout. Phase 7 first tasks documented in next-tasks.md.

### P6-ADMIN-NAV-FIX-v1

- Purpose: Fix two navigation issues on `/admin/[slug]` — remove duplicate back link, add "← Back to league" link.
- Scope: `src/app/admin/[slug]/page.tsx` only.
- Notes: Removed page-level "← Admin" link (layout breadcrumb handles this). Added `← Back to league` → `/league/${slug}` in blue-400 style — gives commissioners a clear return path after navigating from gear icon.

### P6-ADMIN-COMMISSIONER-POLISH-FIX-v1

- Purpose: Fix two bugs — pass explicit year param to schedule/scores refresh calls, and read schedule status from correct combined cache key (`${year}-all-all`).
- Scope: `src/components/admin/GlobalRefreshPanel.tsx`, `src/components/admin/LeagueStatusPanel.tsx` only.
- Notes: Bug 1: `GlobalRefreshPanel` now has a year number input defaulting to `seasonYearForToday()`; all three fetch calls pass `&year=${year}`. Bug 2: `LeagueStatusPanel` checks `${year}-all-all` first (default `seasonType=all`), falls back to `${year}-all-regular`.

### P6-ADMIN-COMMISSIONER-POLISH-REVIEW-v1

- Purpose: Read-only review of P6-ADMIN-COMMISSIONER-POLISH-v1 implementation before merging.
- Scope: Read-only. All changed files in the commissioner polish commit.
- Notes: All checklist items pass. Recommendation: merge.

### P6-ADMIN-COMMISSIONER-POLISH-v1

- Purpose: Commissioner tools polish — per-league status panel, settings page, global refresh panel, aliases-only data panel.
- Scope: `src/components/admin/LeagueDataPanel.tsx`, `src/components/admin/LeagueStatusPanel.tsx` (new), `src/components/admin/GlobalRefreshPanel.tsx` (new), `src/components/admin/LeagueSettingsForm.tsx` (new), `src/app/admin/[slug]/data/page.tsx`, `src/app/admin/[slug]/page.tsx`, `src/app/admin/[slug]/settings/page.tsx` (new), `src/app/admin/data/cache/page.tsx`.
- Notes: Schedule/Scores sections removed from `LeagueDataPanel` (moved to `GlobalRefreshPanel`). `LeagueStatusPanel` reads `appStateStore` directly as server component. Four cards in 2×2 grid at `/admin/[slug]`. PR #233.

### P6-LEAGUE-DATA-PAGE-FIX-v1

- Purpose: Fix alias key normalization and score refresh scope — apply `normalizeAliasLookup()` to alias keys before PUT, refresh both regular and postseason scores.
- Scope: `src/components/admin/LeagueDataPanel.tsx` only.
- Notes: Bug 1: alias keys now run through `normalizeAliasLookup(r.key.trim())` before building PUT payload — matches runtime lookup normalization. Bug 2: scores refresh upgraded from regular-only to `Promise.all` of regular + postseason.

### P6-LEAGUE-DATA-PAGE-v1

- Purpose: Replace CFBScheduleApp embed in `/admin/[slug]/data` with focused `LeagueDataPanel` (schedule, scores, aliases).
- Scope: `src/app/admin/[slug]/data/page.tsx`, `src/components/admin/LeagueDataPanel.tsx` (new).
- Notes: `CFBScheduleApp`, `HistoricalCachePanel`, and `auth()` call removed from page. `LeagueDataPanel` is a focused client component with three sections: Schedule, Scores, Aliases.

### P6-ADMIN-FONT-FIX-v1

- Purpose: Reduce league name font size in commissioner tools card on `/admin/page.tsx`.
- Scope: `src/app/admin/page.tsx` only.
- Notes: Added `text-sm` to league display name span — prevents oversized rendering at implicit `text-base`.

### P6-GEAR-ICON-FIX-v1

- Purpose: Right-justify gear icon in CFBScheduleApp league view header.
- Scope: `src/components/CFBScheduleApp.tsx` only.
- Notes: Restructured header to `flex items-start justify-between` — title/subtitle left, gear icon right.

### P6-ADMIN-SLUG-INDEX-v1

- Purpose: Add `/admin/[slug]` landing page as gear icon destination and commissioner entry point. Move Win Totals to platform admin.
- Scope: `src/app/admin/[slug]/page.tsx` (new), `src/app/admin/[slug]/win-totals/page.tsx` (replaced with redirect), `src/app/admin/page.tsx` (Data Cache card desc update).
- Notes: `/admin/[slug]` renders three commissioner tool cards (Roster, Draft, Data). `/admin/[slug]/win-totals` redirects to `/admin/data/cache`. Data Cache card desc updated to include schedule, scores, and historical data.

### P6-ADMIN-POLISH-CLOSEOUT-v1

- Purpose: Register Phase 6 admin polish prompt IDs and update planning docs.
- Scope: `docs/prompt-registry.md`, `docs/completed-work.md`, `docs/next-tasks.md`. No code changes.
- Notes: Intermediate closeout after initial polish pass; superseded by P6-FINAL-CLOSEOUT-v1 for final documentation.

### P6-ADMIN-POLISH-FIX-REVIEW-v1

- Purpose: Read-only review of P6-ADMIN-POLISH-FIX-v1 implementation. No changes.
- Scope: Read-only. All files modified in admin polish fix.
- Notes: All items pass. Recommendation: merge.

### P6-ADMIN-POLISH-FIX-v1

- Purpose: Remove `useAuth()` from `CFBScheduleApp`, lift auth check to server component parents, add `isAdmin` prop.
- Scope: `src/components/CFBScheduleApp.tsx`, `src/app/league/[slug]/page.tsx`, `src/app/league/[slug]/matchups/page.tsx`, `src/app/league/[slug]/schedule/page.tsx`, `src/app/league/[slug]/standings/page.tsx`.
- Notes: `isAdmin` derived via `auth()` from `@clerk/nextjs/server` in each server component parent; cast pattern for `sessionClaims.publicMetadata.role`. No Clerk hooks in `CFBScheduleApp`.

### P6-ADMIN-POLISH-REVIEW-v1

- Purpose: Read-only review of P6-ADMIN-POLISH-v1 implementation. No changes.
- Scope: Read-only. All files modified in admin polish pass.
- Notes: Found `useAuth()` usage in `CFBScheduleApp` violating auth architecture invariant. Addressed by P6-ADMIN-POLISH-FIX-v1.

### P7A-1-FOUNDED-YEAR-v1

- Purpose: Add foundedYear to league data model, settings form, and History page subtitle.
- Scope: `src/lib/league.ts`, league API routes, `LeagueSettingsForm.tsx`, `LeaguePageShell.tsx`, `history/page.tsx`.
- Notes: Optional field, auto-populated on creation. PRs #252–#253.

### P7A-2-LEAGUE-HUB-STATUS-v1

- Purpose: Surface LeagueStatusPanel and setup checklist on league hub, restore Settings card, add post-creation redirect.
- Scope: `src/app/admin/page.tsx`, `src/app/admin/[slug]/page.tsx`, `src/app/admin/leagues/page.tsx`.
- Notes: PR #255.

### P7A-3-ADMIN-POLISH-v1

- Purpose: Fix admin pages for light mode, link league names, remove redundant status panel from Data page.
- Scope: 8 admin page files + all 10 `src/components/admin/` components.
- Notes: PR #255.

### P7A-4

- Purpose: Promote aliases from league-scoped to platform-scoped storage and UI.
- Scope: New `src/app/admin/aliases/page.tsx`, `src/app/admin/page.tsx`, `src/app/admin/[slug]/page.tsx`, `src/app/admin/[slug]/data/page.tsx`.
- Notes: Uses existing `aliases:global` store. PR #256.

### P7A-CLOSEOUT

- Purpose: Update project docs to reflect Phase 7A completion.
- Scope: `docs/completed-work.md`, `docs/roadmap.md`, `docs/next-tasks.md`, `docs/prompt-registry.md`. No code changes.

### P6-ADMIN-POLISH-v1

- Purpose: Admin nav consistency, plain English copy, gear icon in league view header linking to `/admin/[slug]`.
- Scope: `src/app/admin/page.tsx`, `src/app/admin/season/page.tsx`, `src/app/admin/diagnostics/page.tsx`, `src/app/admin/draft/page.tsx`, `src/app/admin/[slug]/layout.tsx`, `src/components/CFBScheduleApp.tsx`, `src/components/AdminUsagePanel.tsx`, `src/components/AdminTeamDatabasePanel.tsx`, `src/components/AdminStorageStatusPanel.tsx`, `src/components/ScoreAttachmentDebugPanel.tsx`, `src/components/admin/BackfillPanel.tsx`, `src/components/SpRatingsCachePanel.tsx`, `src/components/admin/HistoricalCachePanel.tsx`.
- Notes: Blue back links, `text-2xl font-semibold` titles, plain English copy on all panels. Gear icon via `useAuth()` — fixed in P6-ADMIN-POLISH-FIX-v1.

### P6E-CLOSEOUT-v1

- Purpose: Close out Phase 6E in planning docs and register all P6E prompt IDs.
- Scope: `docs/completed-work.md`, `docs/roadmap.md`, `docs/next-tasks.md`, `docs/prompt-registry.md`. No code changes.
- Notes: P6E complete. Phase 6 all subphases P6A–P6E done. Phase 7 queued.

### P6E-ROSTER-EDITOR-FIX-v1

- Purpose: Fix two bugs — year scope mismatch between panels, and naive CSV parser corrupting quoted fields on re-save.
- Scope: `src/app/admin/[slug]/roster/page.tsx`, `src/components/admin/RosterEditorPanel.tsx`.
- Notes: Bug 1: `roster/page.tsx` now uses `league.year` for both panels (removed `seasonYearForToday()` call). Bug 2: `parseCsvRow()` RFC 4180 state-machine parser replaces naive `indexOf(',')` split — handles quoted fields, `""` unescaping, mixed rows. `buildCsv()` escaping verified correct and left unchanged.

### P6E-ROSTER-EDITOR-REVIEW-v1

- Purpose: Read-only review of P6E-ROSTER-EDITOR-v1 implementation against specification. No changes.
- Scope: `src/components/admin/RosterEditorPanel.tsx`, `src/app/admin/[slug]/roster/page.tsx`.
- Notes: All checklist items pass. Recommendation: merge.

### P6E-ROSTER-EDITOR-v1

- Purpose: Implement RosterEditorPanel — direct CRUD interface for team-owner assignments per league.
- Scope: `src/components/admin/RosterEditorPanel.tsx` (new), `src/app/admin/[slug]/roster/page.tsx` (updated).
- Notes: `savedOwners`/`draftOwners` Map split for dirty tracking. RFC 4180 `buildCsv()`. Bulk reassign local-state only. Accessible at `/admin/[slug]/roster` alongside `RosterUploadPanel`.

### P6D-CLOSEOUT-v1

- Purpose: Close out Phase 6D in planning docs and register all P6D prompt IDs.
- Scope: `docs/completed-work.md`, `docs/roadmap.md`, `docs/next-tasks.md`, `docs/prompt-registry.md`. No code changes.
- Notes: P6D complete. P6E (Roster Editor) set as active focus.

### P6D-ADMIN-RESTRUCTURE-FIX-REVIEW-v1

- Purpose: Read-only review of P6D-ADMIN-RESTRUCTURE-FIX-v1. No changes.
- Scope: `src/app/api/admin/leagues/route.ts`, `src/app/admin/data/page.tsx`. All items pass.
- Notes: Recommendation: merge.

### P6D-ADMIN-RESTRUCTURE-FIX-v1

- Purpose: Fix two bugs from code review — reserve admin route slugs in league creation, and restore `/admin/data` as a real league selector page.
- Scope: `src/app/api/admin/leagues/route.ts`, `src/app/admin/data/page.tsx`.
- Notes: `RESERVED_ADMIN_SLUGS` Set enforces six blocked slugs in `POST /api/admin/leagues`. `/admin/data` now auto-redirects for single league, shows card grid for multiple leagues, links to `/admin/leagues` when empty.

### P6D-ADMIN-RESTRUCTURE-REVIEW-v1

- Purpose: Read-only review of P6D-ADMIN-RESTRUCTURE-v1. No changes.
- Scope: All eight changed admin files. All items pass.
- Notes: One non-blocking observation: `external: true` field on draft tool entry is declared but never read — harmless. Recommendation: merge.

### P6D-ADMIN-RESTRUCTURE-v1

- Purpose: Restructure `/admin` landing into Platform Admin and per-league Commissioner buckets. Create league-scoped admin routes.
- Scope: `src/app/admin/page.tsx`, `src/app/admin/draft/page.tsx`, `src/app/admin/data/page.tsx`, `src/app/admin/data/cache/page.tsx` (new), `src/app/admin/[slug]/layout.tsx` (new), `src/app/admin/[slug]/roster/page.tsx` (new), `src/app/admin/[slug]/win-totals/page.tsx` (new), `src/app/admin/[slug]/data/page.tsx` (new).
- Notes: Named routes take precedence over `[slug]` — no collisions. Commissioner buckets derived from `getLeagues()` at runtime. Phase 7 prerequisite satisfied.

### P6-CLERK-FIXES-CLOSEOUT-v1

- Purpose: Document Clerk session token configuration requirement and register all P6 fix prompt IDs from the P6A/P6B/P6C debugging session.
- Scope: `docs/phase-6-admin-auth-design.md`, `docs/completed-work.md`, `docs/prompt-registry.md`. No code changes.
- Notes: Session 9 added to design doc covering Clerk session token customization requirement. JWT templates confirmed as wrong approach. currentUser() confirmed as unusable in middleware.

### P6C-DEBUG-CLEANUP-v1

- Purpose: Remove debug `console.log` from `page.tsx` added during owner count diagnosis.
- Scope: `src/app/page.tsx` only.
- Notes: Cleanup after P6C-OWNER-COUNT-DEBUG-v2 diagnosis.

### P6C-OWNER-SCOPE-AUDIT-v1

- Purpose: Read-only audit to find the exact appStateStore scope and key where the TSC 2025 owner CSV is stored.
- Scope: `src/app/api/owners/route.ts`, `src/lib/server/appStateStore.ts`. No changes.
- Notes: Confirmed scope is `owners:${slug}:${year}`, key is `csv`. Identified that CSV uploaded without `?league=` goes to wrong scope `owners:${year}`. `ownersScope()` helper exists in route.ts only.

### P6C-OWNER-COUNT-DEBUG-v2

- Purpose: Add temporary debug log to `page.tsx` to surface what appStateStore returns when reading the owner CSV.
- Scope: `src/app/page.tsx` only. Temporary diagnostic.
- Notes: Logged slug, activeYear, scope key, hasRecord, valueLength, valuePreview. Removed in P6C-DEBUG-CLEANUP-v1.

### P6C-OWNER-COUNT-DEBUG-v1

- Purpose: Add temporary debug logging to investigate owner count returning 0 for TSC league.
- Scope: `src/app/page.tsx` only. Temporary diagnostic.
- Notes: Earlier iteration of debug log; superseded by P6C-OWNER-COUNT-DEBUG-v2.

### P6C-OWNER-COUNT-FIX-v3

- Purpose: Fix owner count — use `seasonYearForToday()` instead of `league.year` to match the scope key used when the CSV was uploaded.
- Scope: `src/app/page.tsx` only.
- Notes: `league.year` may differ from the active CFB season year. `seasonYearForToday()` matches the year used during upload via the admin panel.

### P6C-OWNER-COUNT-FIX-v2

- Purpose: Iteration on owner count fix.
- Scope: `src/app/page.tsx` only.
- Notes: Intermediate fix; superseded by P6C-OWNER-COUNT-FIX-v3.

### P6B-ROSTER-UPLOAD-FIX-REVIEW-v1

- Purpose: Read-only review of P6B-ROSTER-UPLOAD-FIX-v2 implementation. No changes.
- Scope: `src/components/admin/RosterUploadPanel.tsx`. All checklist items pass.
- Notes: allResolved requires every needsConfirmation item resolved — correct, intentional. Recommendation: merge.

### P6B-ROSTER-UPLOAD-FIX-v2

- Purpose: Fix two bugs in admin RosterUploadPanel — add validation pipeline and sync year on league change.
- Scope: `src/components/admin/RosterUploadPanel.tsx` only.
- Notes: Bug 1: replaced direct PUT with POST to `/api/owners/validate` then PUT resolved CSV. Bug 2: `handleLeagueChange()` sets year to `league.year ?? seasonYearForToday()`.

### P6B-ROSTER-UPLOAD-FIX-v1

- Purpose: Add dedicated `RosterUploadPanel` to `/admin/data` — league/year scoped, writes to correct appStateStore key.
- Scope: `src/components/admin/RosterUploadPanel.tsx` (new), `src/app/admin/data/page.tsx`.
- Notes: Initial version used direct PUT without validation. Fixed in P6B-ROSTER-UPLOAD-FIX-v2.

### P6B-BACKFILL-FIX-REVIEW-v1

- Purpose: Read-only review of P6B-BACKFILL-FIX-v1 implementation. No changes.
- Scope: `src/components/admin/BackfillPanel.tsx`. All checklist items pass.
- Notes: Recommendation: merge.

### P6B-BACKFILL-FIX-v1

- Purpose: Fix backfill flow — terminal on first write, confirm only when requiresConfirmation returned.
- Scope: `src/components/admin/BackfillPanel.tsx` only.
- Notes: Fixed premature confirm prompt on first-time backfill.

### P6A-CLERK-MIDDLEWARE-DEBUG-v1

- Purpose: Add temporary debug logging to middleware to see sessionClaims contents when hitting /admin.
- Scope: `src/middleware.ts` only. Temporary diagnostic.
- Notes: Logged userId, full sessionClaims, and both role key paths. Confirmed publicMetadata absent without session token customization.

### P6A-CLERK-MIDDLEWARE-FIX-v4

- Purpose: Revert to `auth()`/`sessionClaims` approach — correct for Clerk v7 once session token is customized.
- Scope: `src/middleware.ts`, `src/lib/server/adminAuth.ts`.
- Notes: currentUser() cannot be used in middleware. auth() + sessionClaims.publicMetadata.role is correct once session token includes publicMetadata claim.

### P6A-CLERK-MIDDLEWARE-FIX-v3

- Purpose: Wrap `currentUser()` calls in try/catch for Clerk backend resilience.
- Scope: `src/middleware.ts` only.
- Notes: Intermediate fix during currentUser() exploration; superseded by P6A-CLERK-MIDDLEWARE-FIX-v4 revert.

### P6A-CLERK-MIDDLEWARE-FIX-v2

- Purpose: Switch to `currentUser()` for publicMetadata role check — exploration of alternative approach.
- Scope: `src/middleware.ts`, `src/lib/server/adminAuth.ts`.
- Notes: Ultimately reverted — currentUser() cannot be called in middleware context.

### P6A-CLERK-MIDDLEWARE-FIX-v1

- Purpose: Update middleware and adminAuth to read `public_metadata` instead of `publicMetadata` — matching JWT template claim key.
- Scope: `src/middleware.ts`, `src/lib/server/adminAuth.ts`.
- Notes: Later determined JWT templates are the wrong approach. Superseded by P6A-CLERK-MIDDLEWARE-FIX-v4.

### P6A-CLERK-ROUTE-FIX-v1

- Purpose: Fix login page — add catch-all route `[[...sign-in]]` and required `routing="path"` / `path="/login"` props.
- Scope: `src/app/login/` route structure and `page.tsx`.
- Notes: Multi-step Clerk auth flows require catch-all slug. Static route breaks after step 1.

### P6A-CLERK-REQUIREMENTS-AUDIT-v1

- Purpose: Audit Clerk configuration requirements — identify gaps between implementation and Clerk v7 requirements.
- Scope: Read-only audit. No changes.
- Notes: Identified session token customization requirement and login route catch-all requirement.

### P6C-OWNER-COUNT-FIX-v1

- Purpose: Fix owner count derivation — count distinct owner values from CSV rather than raw row count.
- Scope: `src/app/page.tsx` only.
- Notes: CSV format is `team,owner` (one row per team assignment). Previous `rows.length - 1` returned team count. Fix splits each data line at first comma, collects owner column values into a `Set<string>`, returns `Set.size`. Malformed rows and empty owner fields skipped gracefully.

### P6C-CLOSEOUT-v1

- Purpose: Close out Phase 6C and Phase 6 overall in planning docs, register all P6C prompt IDs, set Phase 7 as next focus.
- Scope: `docs/completed-work.md`, `docs/roadmap.md`, `docs/next-tasks.md`, `docs/prompt-registry.md`. No code changes.
- Notes: Phase 6 (P6A–P6C) fully complete. Phase 7 — Commissioner Self-Service is next planned campaign.

### P6C-LANDING-POLISH-REVIEW-v1

- Purpose: Read-only review of P6C-LANDING-POLISH-v1 implementation. No changes.
- Scope: `src/app/page.tsx`, `src/components/RootPageClient.tsx`. All checklist items pass.
- Notes: Redirect audit confirmed clean across all five audited files. All seven E2E auth flows verified correct in code. Recommendation: merge.

### P6C-LANDING-POLISH-v1

- Purpose: Polish public landing page, add live stats to admin dashboard league cards, audit redirects, validate E2E auth flows.
- Scope: `src/app/page.tsx`, `src/components/RootPageClient.tsx`. No other files.
- Notes: Owner count fetched server-side from `appStateStore` CSV per league — fails gracefully to `null`. League cards split into name/meta/View League/Draft Setup links. "Add League" footer link added. Empty state links to `/admin/leagues`. "Commissioner login" label used on public landing. No hardcoded slugs found in any audited file.

### P6B-CLOSEOUT-v1

- Purpose: Close out Phase 6B in planning docs and register all P6B prompt IDs.
- Scope: `docs/completed-work.md`, `docs/roadmap.md`, `docs/next-tasks.md`, `docs/prompt-registry.md`. No code changes.
- Notes: P6B fully complete. P6C (Root Route and Landing Page Polish) set as active focus.

### P6B-ADMIN-RESTRUCTURE-FIX-v1

- Purpose: Create `HistoricalCachePanel` and update `/admin/data` page to fill the historical cache tools gap identified in review.
- Scope: `src/components/admin/HistoricalCachePanel.tsx` (new), `src/app/admin/data/page.tsx` (make async, add `getLeagues()`, render panel).
- Notes: Fills pre-existing gap — `cache-historical-schedule` and `cache-historical-scores` routes had no UI. Panel has independent loading/error state per button; year input defaults to current year − 1.

### P6B-ADMIN-RESTRUCTURE-REVIEW-v1

- Purpose: Read-only review of P6B-ADMIN-RESTRUCTURE-v1 implementation against specification. No changes.
- Scope: All P6B files — `/admin/page.tsx`, sub-pages, new panel components, `CFBScheduleApp.tsx` modifications. Most items pass; historical cache tools identified as PARTIAL (no UI).
- Notes: Fix tracked as P6B-ADMIN-RESTRUCTURE-FIX-v1. Recommendation: merge with fix applied.

### P6B-ADMIN-RESTRUCTURE-v1

- Purpose: Full admin page restructure — navigation-only `/admin` landing, five sub-pages, new server/client panel components, remove Admin/Debug from league view.
- Scope: `src/app/admin/page.tsx`, `src/app/admin/draft/page.tsx` (new), `src/app/admin/data/page.tsx` (new), `src/app/admin/season/page.tsx` (new), `src/app/admin/diagnostics/page.tsx` (new), `src/components/admin/DraftSequencingPanel.tsx` (new), `src/components/admin/BackfillPanel.tsx` (new), `src/components/admin/ArchiveListPanel.tsx` (new), `src/components/admin/DiagnosticsScorePanel.tsx` (new), `src/components/CFBScheduleApp.tsx`, `src/lib/adminAuth.ts`.
- Notes: `requireAdminAuthHeaders()` fixed to return `{}` instead of throwing when no token — Clerk session cookie handles auth. `DraftSequencingPanel` is server component using `getAppState` directly.

### P6A-CLOSEOUT-v1

- Purpose: Close out Phase 6A in planning docs and register all P6A prompt IDs.
- Scope: `docs/completed-work.md`, `docs/roadmap.md`, `docs/next-tasks.md`, `docs/prompt-registry.md`. No code changes.
- Notes: P6A fully complete. PR #216 open. P6B set as active focus.

### P6A-CLERK-AUTH-FIX-v1

- Purpose: Add `.npmrc` with `legacy-peer-deps=true` to resolve Vercel deployment peer dependency conflict between `@clerk/nextjs@7.0.8` and `react@19.1.0`.
- Scope: `.npmrc` (new file, project root only). No other changes.

### P6A-CLERK-AUTH-REVIEW-v1

- Purpose: Read-only review of P6A-CLERK-AUTH-v1 implementation against specification. No changes.
- Scope: `middleware.ts`, `layout.tsx`, `login/page.tsx`, `page.tsx`, `RootPageClient.tsx`, `server/adminAuth.ts`, 25 API route files. All checklist items pass.
- Notes: One non-blocking observation — `requireAdminAuth` returns `Response | null` (drop-in compatible) rather than `{ authorized, method }` struct described in spec. Correct engineering tradeoff. Recommendation: merge.

### P6A-CLERK-AUTH-v1

- Purpose: Install and configure Clerk auth — middleware, login page, root route replacement, `requireAdminAuth()` helper, update all 25 API route call sites.
- Scope: `package.json`, `src/middleware.ts` (new), `src/app/layout.tsx`, `src/app/login/page.tsx` (new), `src/app/page.tsx`, `src/components/RootPageClient.tsx` (new), `src/lib/server/adminAuth.ts`, 25 API route files.
- Notes: `clerkMiddleware()` protects `/admin/*`. `<Show when="signed-in/out">` used throughout. `requireAdminRequest` retained as deprecated async alias — remove in Phase 7. `.npmrc` added in follow-up fix for Vercel peer dep resolution.

### P5D-CLOSEOUT-v1

- Purpose: Close out Phase 5D and Phase 5 overall in planning docs, register all P5D prompt IDs, archive Phases 1–3 entries, and set Phase 6 as active focus.
- Scope: `docs/completed-work.md`, `docs/completed-work-archive.md` (new), `docs/roadmap.md`, `docs/next-tasks.md`, `docs/prompt-registry.md`. No code changes.
- Notes: Phase 5 (P5A–P5D) fully complete. Phases 1–3 entries moved verbatim to archive file. Phase 6 — Admin Cleanup and Auth is next planned campaign.

### P5D-DRAFT-REOPEN-REVIEW-v1

- Purpose: Read-only review of P5D-DRAFT-REOPEN-v1 implementation. No changes.
- Scope: `confirm/route.ts` (DELETE handler), `DraftSummaryClient.tsx` (reopen button). All items pass.
- Notes: One non-blocking observation: `reopenLoading` not reset on success path — harmless because Reopen section unmounts immediately when `setDraft()` flips phase away from `complete`. Recommendation: merge.

### P5D-DRAFT-REOPEN-v1

- Purpose: Add reopen endpoint (DELETE) and Reopen Draft button to allow commissioner to re-open a confirmed draft for corrections.
- Scope: `src/app/api/draft/[slug]/[year]/confirm/route.ts` (new DELETE handler), `src/components/draft/DraftSummaryClient.tsx` (reopen state + handler + UI section). No other files.
- Notes: DELETE validates `phase === 'complete'`, sets phase to `live`, preserves picks and existing owner CSV. Reopen dialogue warns previous rosters remain in effect until re-confirm. Confirm section conditioned on `phase !== 'complete'`; Reopen section conditioned on `phase === 'complete'`.

### P5D-DRAFT-SUMMARY-FIX-REVIEW-v1

- Purpose: Read-only review of P5D-DRAFT-SUMMARY-FIX-v1 implementation. No changes.
- Scope: `confirm/route.ts`. All items pass.
- Notes: One non-blocking edge case noted — zero-owner draft produces `teamsPerOwner: Infinity`, unreachable in practice. Recommendation: merge.

### P5D-DRAFT-SUMMARY-FIX-v1

- Purpose: Fix two bugs — partial-draft confirmation allowed, and CSV fields with embedded double quotes not properly escaped.
- Scope: `src/app/api/draft/[slug]/[year]/confirm/route.ts` only. No other files.
- Notes: Pick count validation replaced phase+non-empty check with runtime FBS count derivation. `csvField()` RFC 4180 helper added — quotes and escapes all edge cases.

### P5D-DRAFT-SUMMARY-REVIEW-v1

- Purpose: Read-only review of P5D-DRAFT-SUMMARY-v1 implementation against specification. No changes.
- Scope: `confirm/route.ts`, `summary/page.tsx`, `DraftSummaryClient.tsx`, `InterestingFactsPanel.tsx`, `draft/page.tsx`. All items pass.
- Notes: One minor deviation — admin redirect goes to `/league/${slug}/draft` (commissioner board) not `/draft/setup`; consistent with P5C pattern, correct behavior. Recommendation: merge.

### P5D-DRAFT-SUMMARY-v1

- Purpose: Implement Phase 5D — confirm endpoint, summary page, DraftSummaryClient, InterestingFactsPanel, draft board Summary link.
- Scope: `src/app/api/draft/[slug]/[year]/confirm/route.ts` (new), `src/app/league/[slug]/draft/summary/page.tsx` (new), `src/components/draft/DraftSummaryClient.tsx` (new), `src/components/draft/InterestingFactsPanel.tsx` (new), `src/app/league/[slug]/draft/page.tsx` (modified).
- Notes: Confirm writes to `owners:${slug}:${year}` scope, `csv` key — matches existing upload route. Facts derived server-side; only `string[]` passed to client. Admin gate is client-side only (sessionStorage not server-readable).

### P5C-CLOSEOUT-AND-P5D-KICKOFF-v1

- Purpose: Close out Phase 5C in planning docs, register all P5C prompt IDs, and open Phase 5D with full task detail.
- Scope: `docs/completed-work.md`, `docs/roadmap.md`, `docs/next-tasks.md`, `docs/prompt-registry.md`. No code changes.
- Notes: P5C fully complete. P5D (Draft Summary and Confirmation) is active focus.

### P5C-LIVE-DRAFT-BOARD-FIX-REVIEW-v2

- Purpose: Read-only review of P5C-LIVE-DRAFT-BOARD-FIX-v3 implementation. No changes.
- Scope: `route.ts`, `DraftBoardClient.tsx`, `draft/page.tsx`. All four fixes confirmed passing.
- Notes: All items pass. One non-blocking observation: non-200 expire response leaves ref set, but 1s polling recovers state. Recommendation: merge.

### P5C-LIVE-DRAFT-BOARD-FIX-v3

- Purpose: Fix four bugs — expire validation, client-side expiry dispatch, server-safe alias loading, auto-pick metric.
- Scope: `src/app/api/draft/[slug]/[year]/route.ts`, `src/components/draft/DraftBoardClient.tsx`, `src/app/league/[slug]/draft/page.tsx`. No other files.
- Notes: B1 — expire accepted from `paused+expired`; `effectiveBehavior` always forces auto-pick in that state. B2 — client dispatches `timerAction: expire` when countdown reaches zero; `expireDispatchedRef` guards double-dispatch; polling effect moved before early return (hooks ordering fix). B3 — `loadAliasMap()` replaced with `appStateStore` reads of global + league-scoped alias maps merged with SEED_ALIASES. B4 — auto-pick branches on `autoPickMetric`: SP+ desc or preseason rank asc; falls back to alphabetical.

### P5C-LIVE-DRAFT-BOARD-FIX-REVIEW-v1

- Purpose: Read-only review of P5C-LIVE-DRAFT-BOARD-FIX-v1 implementation. No changes.
- Scope: All seven FIX-v1 files. All nine findings confirmed passing.
- Notes: One checklist wording discrepancy (F2 said `/draft/setup`, correct target is `/draft/board`). One stale JSDoc noted (fixed in FIX-v2). Recommendation: merge.

### P5C-LIVE-DRAFT-BOARD-FIX-v2

- Purpose: Fix stale JSDoc comment in reset route — said "return to preview phase", now says "return to setup phase".
- Scope: `src/app/api/draft/[slug]/[year]/reset/route.ts` only — one line.
- Notes: Comment-only fix; no runtime impact.

### P5C-LIVE-DRAFT-BOARD-FIX-v1

- Purpose: Fix all nine review findings from P5C-LIVE-DRAFT-BOARD-REVIEW-v1 before merge.
- Scope: 7 files — `reset/route.ts`, `draft/page.tsx`, `DraftBoardClient.tsx`, `PickNavigator.tsx`, `pick/route.ts`, `pick/[n]/route.ts`, `route.ts` (main draft PUT).
- Notes: F1 reset phase, F2 auth redirect, F3 preview redirect, F4 hide drafted teams, F5 post-reset redirect, F6 previous pick display, F7 prior year data, F8 identity resolver, F9 expire guards.

### P5C-LIVE-DRAFT-BOARD-REVIEW-v1

- Purpose: Read-only review of P5C-LIVE-DRAFT-BOARD-v1 implementation against spec. No changes.
- Scope: All P5C new and modified files. Nine findings (F1–F9) reported.
- Notes: Read-only. All findings addressed in P5C-LIVE-DRAFT-BOARD-FIX-v1.

### P5C-LIVE-DRAFT-BOARD-v1

- Purpose: Implement the live draft board — pick endpoints, timer actions, commissioner and spectator views, seven UI components.
- Scope: 4 new API routes (`pick`, `unpick`, `pick/[n]`, `reset`), PUT timer extension, 2 page routes, 7 components, redirect TODO fix in 2 existing components.
- Notes: Branch `claude/improve-thread-speed-v1YFg`. Review findings fixed in P5C-LIVE-DRAFT-BOARD-FIX-v1.

### P5B-CLOSEOUT-v1

- Purpose: Close out Phase 5B in planning docs, register all P5B prompt IDs, and flag the P5C redirect TODO items.
- Scope: `docs/completed-work.md`, `docs/roadmap.md`, `docs/next-tasks.md`, `docs/prompt-registry.md`. No code changes.
- Notes: P5B fully complete. P5C (Live Draft Board) is active focus. Redirect TODO: four occurrences in `DraftSettingsPanel.tsx` and `DraftSetupShell.tsx` point to `/draft/setup` temporarily — must be updated to `/draft` as P5C first task.

### P5B-DRAFT-SETUP-FIX-v4

- Purpose: Fix two bugs — redirects targeting non-existent `/draft` route (pre-P5C) and preview→settings phase not persisted via API.
- Scope: `src/components/draft/DraftSettingsPanel.tsx`, `src/components/draft/DraftSetupShell.tsx`.
- Notes: PR #211. DraftSettingsPanel redirects changed from `/draft` to `/draft/setup` for live and preview transitions. DraftSetupShell: "Start Draft" and "Go to Draft Board" redirects updated; "Back to Settings" button replaced client-only state flip with API PUT call, preserving server-side phase state.

### P5B-DRAFT-SETUP-FIX-v3

- Purpose: Fix build error — `ownerSet.size` reference remaining after `ownerSet` variable removal.
- Scope: `src/app/api/draft/[slug]/[year]/route.ts` only.
- Notes: PR #211. `ownerSet.size` → `ownerNames.length` on the `setsMatch` line.

### P5B-DRAFT-SETUP-FIX-v2

- Purpose: Remove dead code — unused `ownerSet` variable in draftOrder cross-validation.
- Scope: `src/app/api/draft/[slug]/[year]/route.ts` only.
- Notes: PR #211. One-line removal; validation logic unchanged.

### P5B-DRAFT-SETUP-FIX-REVIEW-v1

- Purpose: Verify all six fixes from P5B-DRAFT-SETUP-FIX-v1 are correctly implemented. Read-only.
- Scope: `src/app/api/draft/[slug]/[year]/route.ts`, `src/components/draft/DraftSettingsPanel.tsx`, `src/components/draft/RosterSetupPanel.tsx`. No changes.
- Notes: All six fixes verified pass. One dead code observation (unused `ownerSet`) flagged and addressed in FIX-v2/v3.

### P5B-DRAFT-SETUP-FIX-v1

- Purpose: Fix all six findings from P5B-DRAFT-SETUP-REVIEW-v1 — GET 404, POST settings acceptance and validation, POST preview promotion, draftOrder cross-validation, preview redirect, and empty owner list initialization.
- Scope: `src/app/api/draft/[slug]/[year]/route.ts`, `src/components/draft/DraftSettingsPanel.tsx`, `src/components/draft/RosterSetupPanel.tsx`.
- Notes: PR #211. GET returns 404 (not 200+null) when no draft; POST accepts/validates full settings object; POST promotes to 'preview' on future scheduledAt; draftOrder cross-validated against owners set; preview transition redirects to /draft/setup; RosterSetupPanel initialises to [] with empty-state message.

### P5B-DRAFT-SETUP-REVIEW-v1

- Purpose: Review P5B-DRAFT-SETUP-v1 implementation against specification before merging. Read-only.
- Scope: All P5B new files. No changes.
- Notes: Identified six findings: GET 200+null vs 404, POST ignoring settings, POST not promoting to preview, no draftOrder validation, preview redirect staying in-page, empty list `['']` initialisation. All addressed in FIX-v1.

### P5B-DRAFT-SETUP-v1

- Purpose: Implement Phase 5B — draft API route, setup page, roster and settings panels, Draft tab in navigation.
- Scope: `src/lib/draft.ts` (new), `src/app/api/draft/[slug]/[year]/route.ts` (new), `src/app/league/[slug]/draft/setup/page.tsx` (new), `src/components/draft/DraftSetupShell.tsx` (new), `src/components/draft/RosterSetupPanel.tsx` (new), `src/components/draft/DraftSettingsPanel.tsx` (new), `src/components/WeekViewTabs.tsx`.
- Notes: PR #211. DraftState/DraftSettings/DraftPick types in shared lib. Server-side phase transition validation. Prior year archive auto-population. FBS-based round auto-suggest.

### P5A-CLOSEOUT-v1

- Purpose: Close out Phase 5A in planning docs and register all P5A prompt IDs.
- Scope: `docs/completed-work.md`, `docs/roadmap.md`, `docs/next-tasks.md`, `docs/prompt-registry.md`. No code changes.
- Notes: P5A fully complete. P5B (Draft Setup and Settings) is active focus.

### P5A-IDENTITY-FIX-v1

- Purpose: Fix team name resolution in draftTeamInsights selector and win total upload — canonicalize provider names via teams.json alts[] in selector; replace direct string matching with createTeamIdentityResolver in win-totals route.
- Scope: `src/lib/selectors/draftTeamInsights.ts`, `src/app/api/admin/win-totals/route.ts`.
- Notes: PR #210. Selector uses providerToCanonical map from alts[]; win-totals route uses SEED_ALIASES + stored alias map merged, same pattern as odds/route.ts. No new matching logic.

### P5A-DRAFT-DATA-INFRA-REVIEW-v1

- Purpose: Review P5A implementation against spec; fix lastSeasonRecord (always-null deferred field) before merge.
- Scope: Read-only review + targeted fix to `src/lib/selectors/draftTeamInsights.ts`.
- Notes: PR #210. Added priorYearGames + priorYearScoresByKey optional params; computes W-L records following historySelectors.ts pattern. Removed unused percentileThreshold helper.

### P5A-DRAFT-DATA-INFRA-v1

- Purpose: Implement Phase 5A draft data infrastructure — SP+ cache endpoint, win total CSV upload, draftTeamInsights selector, DraftCard component, admin UI triggers.
- Scope: `src/lib/cfbd.ts`, `src/app/api/admin/cache-sp-ratings/route.ts` (new), `src/app/api/admin/win-totals/route.ts` (new), `src/lib/selectors/draftTeamInsights.ts` (new), `src/components/draft/DraftCard.tsx` (new), `src/components/SpRatingsCachePanel.tsx` (new), `src/components/WinTotalsUploadPanel.tsx` (new), `src/app/admin/page.tsx`.
- Notes: PR #210. Pure selector pattern; awaiting-ratings status for pre-season SP+ calls; DraftCard absent-means-absent design.

### P4D-CLOSEOUT-v2

- Purpose: Close any gaps between the organic session closeout and formal spec — rename completed-work entry, add P4-BACKFILL-v1 and remove P4D-HISTORY-POLISH-REVIEW-v1 from PROMPT_IDs, add backfill bullet, add roadmap subphase entry, update next-tasks Phase 5 first task, register P4D-CLOSEOUT-v2.
- Scope: `docs/completed-work.md`, `docs/roadmap.md`, `docs/next-tasks.md`, `docs/prompt-registry.md`. No code changes.
- Notes: Phase 4 fully complete including all polish and backfill work. Phase 5 active focus with design scoping as first step.

### P4D-NOCLAIM-FIX-v1

- Purpose: Fix selectOwnerCareer NoClaim early return — remove it so archived season data is preserved; add explicit NoClaim guard in H2H opponent aggregation loop.
- Scope: `src/lib/selectors/historySelectors.ts` only.
- Notes: PR #207. selectOwnerCareer now returns real data for NoClaim; NoClaim excluded from H2H matrix only. All other NoClaim exclusions unchanged.

### P4D-HISTORY-BANNER-v1

- Purpose: Add "Season in Progress" card to ChampionshipsBanner showing current season leader when active season is not yet archived.
- Scope: `src/components/history/ChampionshipsBanner.tsx` (new props + card), `src/app/league/[slug]/history/page.tsx` (pass props).
- Notes: PR #207. Neutral gray/white border distinct from amber champion card. "Current Leader" label. Derives first non-NoClaim owner from liveStandings. No card when props absent.

### P4D-HISTORY-LAYOUT-v1

- Purpose: Redesign history landing page to asymmetric 60/40 split using lg:grid-cols-5 with col-span-3/col-span-2.
- Scope: `src/app/league/[slug]/history/page.tsx` only.
- Notes: PR #207. ChampionshipsBanner remains full width above grid. Single column on mobile unchanged.

### P4D-HISTORY-POLISH-REVIEW-v1

- Purpose: Read-only review of P4D-HISTORY-POLISH-v1 implementation against specification.
- Scope: Read-only. All files modified by P4D-HISTORY-POLISH-v1.
- Notes: All items passed. One partial finding: ChampionshipsBanner renders full-width above grid rather than in left column per spec — accepted as better UX. Overall recommendation: Merge.

### P4D-HISTORY-POLISH-v1

- Purpose: Fix all-time standings sort order, remove NoClaim from all history views, redesign history landing to two-column layout, add League History nav tab, merge live season data into all-time standings.
- Scope: `src/lib/selectors/historySelectors.ts`, `src/components/history/AllTimeStandingsTable.tsx`, `src/app/league/[slug]/history/page.tsx`, `src/components/WeekViewTabs.tsx`, `src/components/CFBScheduleApp.tsx`.
- Notes: PR #207. winPct added to AllTimeStandingRow; sort: championships → winPct → totalWins. NoClaim excluded from 4 selectors. liveStandings optional param added to selectAllTimeStandings. History Link tab in WeekViewTabs via leagueSlug prop.

### P4-HISTORICAL-SCORES-CACHE-v1

- Purpose: Add POST /api/admin/cache-historical-scores — admin-gated, fetches and caches CFBD scores for a specified past year into the exact keys buildSeasonArchive reads.
- Scope: `src/app/api/admin/cache-historical-scores/route.ts` (new).
- Notes: PR #207. Writes scope=`scores`, keys=`${year}-all-regular` and `${year}-all-postseason`. alreadyCached when both keys exist. force: true to overwrite. Rejects active season year.

### P4-HISTORICAL-SCHEDULE-CACHE-v1

- Purpose: Add POST /api/admin/cache-historical-schedule — admin-gated, fetches and caches CFBD schedule for a specified past year into the exact key buildSeasonArchive reads.
- Scope: `src/app/api/admin/cache-historical-schedule/route.ts` (new).
- Notes: PR #207. Writes scope=`schedule`, key=`${year}-all-all`. alreadyCached check prevents quota waste. force: true to overwrite. Rejects active season year.

### P4D-CLOSEOUT-v1

- Purpose: Close out Phase 4D and Historical Season Backfill in planning docs; register all P4D and backfill prompt IDs; set Phase 5 as next planned campaign.
- Scope: docs only — completed-work.md, roadmap.md, next-tasks.md, prompt-registry.md. No code changes.
- Notes: Phase 4 fully complete. Phase 5 set as active focus.

### P4D-BUGS-v1

- Purpose: Fix two post-merge bugs: double-decoding URIError crash on owner route param, and rivalry lead/trail/tied label always showing ownerA regardless of record.
- Scope: `src/app/league/[slug]/history/owner/[name]/page.tsx` (remove double-decode), `src/components/history/AllTimeHeadToHeadPanel.tsx` (three-way leader label).
- Notes: Double-decode: Next.js App Router already decodes params — `decodeURIComponent` must not be applied again. Label fix: three-way conditional (ownerA leads / ownerB leads / series tied).

### P4D-BACKFILL-REVIEW-v1

- Purpose: Read-only review of P4D-LEAGUE-HISTORY-UI-FIX-v1 and P4-BACKFILL-v1 implementations against their specifications.
- Scope: Read-only. All P4D UI fix files and backfill endpoint.
- Notes: Found critical bug: `slug` declared in Props but not destructured in `AllTimeHeadToHeadPanel` — produced `/league/undefined/...` URLs. Addressed by P4D-LEAGUE-HISTORY-UI-FIX-v2.

### P4-BACKFILL-v1

- Purpose: Create `POST /api/admin/backfill` endpoint — admin-gated, builds and saves `SeasonArchive` for a specified past year, never calls `updateLeague`, two-phase confirmation when existing archive would be overwritten.
- Scope: `src/app/api/admin/backfill/route.ts` (new).
- Notes: Intentionally does NOT call `updateLeague` or advance the active season year. Two-phase: first call returns `requiresConfirmation: true` with diff; second call with `confirmed: true` performs overwrite.

### P4D-LEAGUE-HISTORY-UI-FIX-v2

- Purpose: Fix critical bug — `slug` was declared in `AllTimeHeadToHeadPanel` Props but omitted from component destructuring, producing `/league/undefined/history/owner/.../` URLs.
- Scope: `src/components/history/AllTimeHeadToHeadPanel.tsx` only — destructuring fix.
- Notes: PR #204. One-line fix caught in P4D-BACKFILL-REVIEW-v1.

### P4D-LEAGUE-HISTORY-UI-FIX-v1

- Purpose: Fix 5 review findings: missing career page Links in AllTimeHeadToHeadPanel, DynastyDroughtPanel, MostImprovedPanel; missing Games Back column in SeasonFinishHistory; wrong empty state copy on landing page.
- Scope: `src/components/history/AllTimeHeadToHeadPanel.tsx`, `src/components/history/DynastyDroughtPanel.tsx`, `src/components/history/MostImprovedPanel.tsx`, `src/components/history/SeasonFinishHistory.tsx`, `src/app/league/[slug]/history/page.tsx`.
- Notes: PR #204.

### P4D-LEAGUE-HISTORY-UI-REVIEW-v1

- Purpose: Read-only review of P4D-LEAGUE-HISTORY-UI-v1 implementation against detailed checklist.
- Scope: Read-only. All files created or modified by P4D-LEAGUE-HISTORY-UI-v1.
- Notes: Found 5 items requiring fixes — addressed by P4D-LEAGUE-HISTORY-UI-FIX-v1.

### P4D-LEAGUE-HISTORY-UI-v1

- Purpose: Implement League History landing page, Owner Career page, seven cross-season selectors, and back link update in history/[year]/page.tsx.
- Scope: `src/lib/selectors/historySelectors.ts` (7 new selectors + OwnerSeasonRecord.gamesBack), `src/app/league/[slug]/history/page.tsx` (new), `src/app/league/[slug]/history/owner/[name]/page.tsx` (new), `src/app/league/[slug]/history/[year]/page.tsx` (back link update), `src/components/history/` (9 new components).
- Notes: PR #204. Nine new history components: ChampionshipsBanner, AllTimeStandingsTable, SeasonListPanel, MostImprovedPanel, DynastyDroughtPanel, AllTimeHeadToHeadPanel, CareerSummaryCard, SeasonFinishHistory, AllTimeOwnerHeadToHeadPanel.

### P4D-KICKOFF-v1

- Purpose: Close out roster upload fuzzy matching in planning docs, register all prompt IDs, and set P4D as the active phase.
- Scope: docs only — completed-work.md, roadmap.md, next-tasks.md, prompt-registry.md. No code changes.
- Notes: Fuzzy matching complete. P4D kickoff.

### P4-ROSTER-UPLOAD-FUZZY-MATCH-FIX-v2

- Purpose: Fix two bugs from review: exhaustive alias migration across all league years via listAppStateKeys(), and persistent upload error display for auto-upload failures.
- Scope: `src/lib/server/globalAliasStore.ts` (migration year range + listAppStateKeys), `src/components/RosterUploadPanel.tsx` (phase-agnostic uploadError with retry button).
- Notes: PR #203.

### P4-ROSTER-UPLOAD-FUZZY-MATCH-FIX-v1

- Purpose: Wire lazy migrateYearScopedAliasesToGlobal() call in GET /api/aliases?scope=global so migration runs automatically on first global alias read after deploy.
- Scope: `src/app/api/aliases/route.ts` only — added getLeagues() call and migration invocation in the global scope GET branch.
- Notes: PR #203.

### P4-ROSTER-UPLOAD-FUZZY-MATCH-REVIEW-v1

- Purpose: Read-only review of P4-ROSTER-UPLOAD-FUZZY-MATCH-v1 implementation against the prompt specification.
- Scope: Read-only. All files introduced or modified in the fuzzy matching implementation.
- Notes: One failure found: migrateYearScopedAliasesToGlobal() was unreachable (no call site). Addressed by FIX-v1. All other 38 items passed. Recommendation: fix before merge.

### P4-ROSTER-UPLOAD-FUZZY-MATCH-v1

- Purpose: Add FBS-only fuzzy matching validation to the owner roster CSV upload pipeline.
- Scope: `src/lib/rosterUploadValidator.ts` (new), `src/lib/server/globalAliasStore.ts` (new), `src/app/api/owners/validate/route.ts` (new), `src/components/RosterUploadPanel.tsx` (new), `src/app/api/owners/route.ts` (PUT guard), `src/app/api/aliases/route.ts` (?scope=global), `src/app/admin/page.tsx` (RosterUploadPanel).
- Notes: PR #203.

### P4-ROSTER-UPLOAD-FUZZY-MATCH-DOCS-v1

- Purpose: Document the roster upload fuzzy matching design in planning docs and AGENTS.md before implementation.
- Scope: `docs/phase-4-historical-analytics-design.md` (§9 Roster Upload Validation), `AGENTS.md` (rule #10 upload-layer-only constraint). Docs only.
- Notes: PR #202.

### P4C-CLOSEOUT-v1

- Purpose: Update completed-work.md, roadmap.md, next-tasks.md, and prompt-registry.md to reflect P4C complete; register all P4C prompt IDs; set Roster Upload Fuzzy Matching as active next focus.
- Scope: docs only — no code changes.
- Notes: PR #201 closeout. Phase 4C complete.

### P4C-BUGS-v1

- Purpose: Fix three post-implementation bugs: exclude same-owner matchups from getOwnedFinalGames; fix back links pointing to unbuilt P4D route.
- Scope: `src/lib/selectors/historySelectors.ts` (same-owner guard in getOwnedFinalGames), `src/app/league/[slug]/history/[year]/page.tsx` (both back link instances).
- Notes: PR #201. Same-owner guard added to prevent self-blowouts/self-H2H contamination; back links changed to `/league/${slug}/` with TODO comments.

### P4C-LINT-FIX-v1

- Purpose: Investigate and remove unused `ownerB` variable assignment in selectHeadToHead.
- Scope: `src/lib/selectors/historySelectors.ts` only.
- Notes: PR #201. Confirmed not a logic bug — `pairingKey()` independently derives canonical ordering; assignment was dead code.

### P4C-ARCHIVE-DATA-MODEL-FIX-v2

- Purpose: Add `?? []` and `?? {}` null guards at both selector consumption points in historySelectors.ts for backward compatibility with legacy archives.
- Scope: `src/lib/selectors/historySelectors.ts` only — two call sites.
- Notes: PR #201. Prevents `TypeError: undefined is not iterable` when rendering archives written before games/scoresByKey fields were added.

### P4C-ARCHIVE-DATA-MODEL-FIX-REVIEW-v1

- Purpose: Read-only review of P4C-ARCHIVE-DATA-MODEL-FIX-v1 implementation — verify correctness and identify gaps.
- Scope: Read-only. `src/lib/seasonArchive.ts`, `src/lib/seasonRollover.ts`, `src/lib/selectors/historySelectors.ts`.
- Notes: Identified one critical gap — old archives with undefined games/scoresByKey would throw TypeError at runtime. Addressed by P4C-ARCHIVE-DATA-MODEL-FIX-v2.

### P4C-ARCHIVE-DATA-MODEL-FIX-v1

- Purpose: Add `games: AppGame[]` and `scoresByKey: Record<string, ScorePack>` to `SeasonArchive`; update `buildSeasonArchive` to populate both fields; rewrite superlative and H2H selectors to derive from game data.
- Scope: `src/lib/seasonArchive.ts`, `src/lib/seasonRollover.ts`, `src/lib/selectors/historySelectors.ts`.
- Notes: PR #201. Required because `StandingsHistory` stores cumulative per-owner stats only — no individual game pairings available from that model.

### P4C-SEASON-DETAIL-UI-v1

- Purpose: Implement `/league/[slug]/history/[year]/` season detail page with selectors, 6 history components, and server component page.
- Scope: `src/lib/selectors/historySelectors.ts` (new), `src/app/league/[slug]/history/[year]/page.tsx` (new), `src/components/history/` (6 new components: ArchiveBanner, FinalStandingsTable, SeasonArcChart, SuperlativesPanel, HeadToHeadPanel, OwnerRosterCard).
- Notes: PR #201. Initial implementation discovered StandingsHistory gap — follow-on P4C-ARCHIVE-DATA-MODEL-FIX-v1 added games/scoresByKey to SeasonArchive.

### P3-MULTILEG-CLOSEOUT-v1

- Purpose: Audit Phase 3 implementation against design doc, update planning docs to reflect Phase 3 complete, register all Phase 3 prompt IDs.
- Scope: docs only — completed-work.md, roadmap.md, next-tasks.md, prompt-registry.md, phase-3-multi-league-design.md.
- Notes: Phase 3 closeout. No code changes.

### P3-MULTILEG-FALLBACK-CLEANUP-v1

- Purpose: Remove now-redundant `readAliasesScopedOnly` function from aliases route — identical to `readAliases` after fallback removal.
- Scope: `src/app/api/aliases/route.ts` only.
- Notes: PR #196. Follow-on to P3-MULTILEG-FALLBACK-REMOVAL-v1.

### P3-MULTILEG-FALLBACK-REMOVAL-REVIEW-v1

- Purpose: Read-only verification that fallback removal is correct and scope helpers preserve the no-league-param path.
- Scope: Read-only. `src/app/api/owners/route.ts`, `src/app/api/aliases/route.ts`, `src/app/api/postseason-overrides/route.ts`.
- Notes: All items passed. Flagged that `readAliasesScopedOnly` was now redundant — addressed by P3-MULTILEG-FALLBACK-CLEANUP-v1.

### P3-MULTILEG-FALLBACK-REMOVAL-v1

- Purpose: Remove temporary TRANSITION FALLBACK from all three durable data GET handlers after TSC migration confirmed complete.
- Scope: `src/app/api/owners/route.ts`, `src/app/api/aliases/route.ts`, `src/app/api/postseason-overrides/route.ts` — GET handlers only.
- Notes: PR #196. No-league-param path unchanged on all three routes.

### P3-MULTILEG-ADMIN-UI-COPY-v1

- Purpose: Replace developer terminology with plain-language commissioner-facing copy on `/admin/leagues/`.
- Scope: `src/app/admin/leagues/page.tsx` only — copy and labels only.
- Notes: PR #195. Slug field relabeled "League URL", annotation updated to "(URL — permanent)", header description rewritten, empty state example year corrected to 2025.

### P3-MULTILEG-ADMIN-UI-FIX-v1

- Purpose: Improve empty state seed reminder to include example values for slug, display name, and year.
- Scope: `src/app/admin/leagues/page.tsx` only.
- Notes: PR #194. Empty state now includes: league URL — work-league, display name — Work League, year — 2025.

### P3-MULTILEG-ADMIN-UI-REVIEW-v1

- Purpose: Pre-merge review of P3-MULTILEG-ADMIN-UI-v1 implementation.
- Scope: Read-only. `src/app/admin/leagues/page.tsx`, `src/components/AdminDebugSurface.tsx`.
- Notes: One partial finding — empty state seed reminder lacked example values. Addressed by P3-MULTILEG-ADMIN-UI-FIX-v1.

### P3-MULTILEG-ADMIN-UI-v1

- Purpose: Create `/admin/leagues/` management page for commissioner to view, create, and edit leagues.
- Scope: `src/app/admin/leagues/page.tsx` (new), `src/components/AdminDebugSurface.tsx` (League Management link).
- Notes: PR #194. Reuses `AdminAuthPanel`, `requireAdminAuthHeaders`. Inline edit, create form with client-side slug validation.

### P3-MULTILEG-WRITE-SCOPE-REVIEW-v1

- Purpose: Read-only verification that write-scope fix correctly passes `leagueSlug` through all save functions.
- Scope: Read-only. API client functions and CFBScheduleApp save call sites.
- Notes: All items passed. Recommend merge.

### P3-MULTILEG-WRITE-SCOPE-FIX-v1

- Purpose: Fix write-path bug — save functions were not passing `leagueSlug` to API calls despite reads being league-scoped.
- Scope: `src/lib/aliasesApi.ts`, `src/lib/ownersApi.ts`, `src/lib/postseasonOverridesApi.ts`, `src/components/CFBScheduleApp.tsx`.
- Notes: PR #193. Establishes full read/write symmetry for all three durable data paths.

### P3-MULTILEG-ROUTING-FIX-REVIEW-v1

- Purpose: Read-only verification of routing fix — bootstrap chain threading and matchup href.
- Scope: Read-only. `src/components/CFBScheduleApp.tsx`, bootstrap chain files, `src/components/OverviewPanel.tsx`.
- Notes: All items passed. Recommend merge.

### P3-MULTILEG-ROUTING-FIX-v1

- Purpose: Thread `leagueSlug` through full bootstrap chain; restore `?view=matchups` on matchup insight links.
- Scope: `src/lib/bootstrap.ts`, `src/components/hooks/useScheduleBootstrap.ts`, `src/components/OverviewPanel.tsx`.
- Notes: PR #193. Bootstrap chain now complete: CFBScheduleApp → useScheduleBootstrap → bootstrapAliasesAndCaches → all three load functions.

### P3-MULTILEG-ROUTING-REVIEW-v1

- Purpose: Pre-merge review of P3-MULTILEG-ROUTING-v1 routing implementation.
- Scope: Read-only. All new league route files, root redirects, navigation components.
- Notes: Two findings: bootstrap chain not threaded end-to-end; matchup insight href missing `?view=matchups`. Both addressed by P3-MULTILEG-ROUTING-FIX-v1.

### P3-MULTILEG-ROUTING-v1

- Purpose: Implement `/league/[slug]/` route hierarchy; convert root routes to registry-based redirects; update navigation components.
- Scope: `src/app/league/[slug]/` (new pages), `src/app/page.tsx`, `src/app/standings/page.tsx`, `src/app/rankings/page.tsx`, `src/app/trends/page.tsx`, `src/components/CFBScheduleApp.tsx`, `src/components/OverviewPanel.tsx`, `src/components/RankingsPageContent.tsx`.
- Notes: PR #193. Root routes read registry at request time; redirect to first league's slug or render empty state if no leagues.

### P3-MULTILEG-FOUNDATION-FIX-v2

- Purpose: Fix malformed slug silent coercion bug and alias incremental merge inheritance bug.
- Scope: `src/app/api/aliases/route.ts` (readAliasesScopedOnly), `src/app/api/owners/route.ts`, `src/app/api/postseason-overrides/route.ts`.
- Notes: PR #192. Added slug format validation to PUT routes. Introduced `readAliasesScopedOnly` to prevent new leagues inheriting legacy alias map on first incremental write.

### P3-MULTILEG-FOUNDATION-FIX-VERIFY-v1

- Purpose: Read-only verification that registry check is only in PUT (not GET) after FIX-v1 changes.
- Scope: Read-only. `src/app/api/admin/leagues/route.ts` only.
- Notes: Confirmed GET is public, PUT has registry validation. Verified correct.

### P3-MULTILEG-FOUNDATION-FIX-v1

- Purpose: Fix three pre-merge review findings — duplicate guard into `addLeague()`, GET leagues public, PUT registry validation.
- Scope: `src/lib/leagueRegistry.ts`, `src/app/api/admin/leagues/route.ts`, `src/app/api/owners/route.ts`, `src/app/api/aliases/route.ts`, `src/app/api/postseason-overrides/route.ts`.
- Notes: PR #192.

### P3-MULTILEG-FOUNDATION-REVIEW-v1

- Purpose: Read-only pre-merge review of P3-MULTILEG-FOUNDATION-v1 storage layer implementation.
- Scope: Read-only. All files created or modified in foundation PR.
- Notes: Three findings addressed by P3-MULTILEG-FOUNDATION-FIX-v1.

### P3-MULTILEG-FOUNDATION-v1

- Purpose: Implement Phase 3 storage layer — `League` type, `leagueRegistry.ts`, admin API routes, updated durable-data routes with `?league=` support and TRANSITION FALLBACK.
- Scope: `src/lib/league.ts` (new), `src/lib/leagueRegistry.ts` (new), `src/app/api/admin/leagues/route.ts` (new), `src/app/api/admin/leagues/[slug]/route.ts` (new), `src/app/api/owners/route.ts`, `src/app/api/aliases/route.ts`, `src/app/api/postseason-overrides/route.ts`.
- Notes: PR #192.

### P2-FOUNDATION-AUDIT-v1

- Purpose: Read-only codebase audit — reconcile actual implementation state against all planning documents and produce a structured markdown discrepancy report.
- Scope: Read-only. All planning docs + key source files. No code or document changes.
- Notes: Produced discrepancy report covering data pipeline, owner model, historical data, selector architecture, admin/persistence, and feature completeness. Findings used to drive post-audit doc updates.

### P2-OVR-TRENDS-LABELS-v1

- Purpose: Color-code delta panel owner names to match trend line colors; restore endpoint annotations (owner name + GB) on trend chart.
- Scope: `src/components/MiniTrendsGrid.tsx` (export CONTENDER_COLORS, restore annotation lane), `src/components/OverviewPanel.tsx` (PositionDeltaPanel seriesColors prop).
- Notes: Added to PR #188 branch. Merged as part of PR #188.

### P2-OVR-TRENDS-POLISH-v1

- Purpose: Fix chart label dead space; add meaningful postseason week labels (CCG, Bowl, CFP) instead of raw W17/W18 on x-axis.
- Scope: `src/components/MiniTrendsGrid.tsx` (label lane removal), `src/lib/weekLabel.ts` (new file), `src/components/OverviewPanel.tsx` (weekLabelFn via buildWeekLabelMap).
- Notes: Added to PR #188 branch. Merged as part of PR #188.

### P2-OVR-TRENDS-POSTSEASON-v1

- Purpose: Fix postseason week truncation in trend charts; replace W/L dots panel with week-over-week standings position change deltas.
- Scope: `src/lib/schedule.ts` (postseasonCanonicalWeek), `src/lib/selectors/trends.ts` (selectPositionDeltas), `src/components/OverviewPanel.tsx` (PositionDeltaPanel replaces RecentFormPanel).
- Notes: PR #188. Covers the three-commit sequence merged on phase-3b-visual-sweep.

### P2C-STANDINGS-RULE-AND-DOCS-REALIGNMENT-v1

- Purpose: Fix standings sort to wins-first (primary) per league rules; add regression tests; realign docs to match.
- Scope: `src/lib/standings.ts` (sort comparator), `src/lib/__tests__/standings.test.ts` (three new regression tests), docs updates.
- Notes: PR #184. Corrected sort from winPct-first to wins-first with winPct/PD/PF tiebreakers.

### DOCS-CLAUDE-MD-BOOTSTRAP-v1

- Purpose: Create CLAUDE.md as a Claude Code-specific companion to AGENTS.md, establishing Claude's role, interaction preferences, and architectural guardrails without duplicating shared project operating content.
- Scope: `CLAUDE.md` (new file), `docs/prompt-registry.md` update only.
- Notes: Follow-on to DOCS-PHASE-RECONCILIATION-v1.

### P2D-TRENDS-FORM-DOTS-v1

- Purpose: Recent form dots panel — last-5-game W/L indicators using actual game scores, displayed alongside the title chase chart on the Overview Trends card.
- Scope: `src/components/OverviewPanel.tsx` (RecentFormPanel), `src/lib/selectors/trends.ts` (selectRecentOutcomes).
- Notes: Retroactively registered. Covers PR #183 on phase-3b-visual-sweep. Renamed from P3B-TRENDS-FORM-DOTS-v1 per DOCS-PHASE-RECONCILIATION-v1.

### DOCS-PHASE-RECONCILIATION-v1

- Purpose: Reconcile phase numbering across all project docs (3A/3B → 2C/2D), incorporate doc revisions, close duplication gaps.
- Scope: docs only — AGENTS.md, docs/roadmap.md, docs/next-tasks.md, docs/completed-work.md, docs/prompt-registry.md, docs/cfb-engineering-operating-instructions.md, docs/vision.md.
- Notes: Active. Single-commit docs reconciliation pass.

---

## Retroactively Registered Prompts

### P2D-TRENDS-TITLE-CHASE-v1

- Purpose: MiniTrendsGrid — compact SVG title chase chart (top-5 contenders, Games Back) for Overview Trends card. Iterated through viewBox fix, inline labels, bump chart, and final title chase framing.
- Scope: `src/components/MiniTrendsGrid.tsx`, `src/components/OverviewPanel.tsx`, `src/lib/selectors/trends.ts`.
- Notes: Retroactively registered. Covers PRs #178–#182. Renamed from P3B-TRENDS-TITLE-CHASE-v1 per DOCS-PHASE-RECONCILIATION-v1.

### P2C-OVERVIEW-REDESIGN-v1

- Purpose: Phase 2C visual redesign — champion podium hero, Rankings tab, app-wide palette and layout sweep, and Trends section restructure (removed TrendsDetailSurface from Overview).
- Scope: `src/components/OverviewPanel.tsx`, `src/components/MiniTrendsGrid.tsx` (initial), `src/app/trends/`.
- Notes: Retroactively registered. Covers PRs #173–#177. Renamed from P3A-OVERVIEW-REDESIGN-v1 per DOCS-PHASE-RECONCILIATION-v1.

### P2B-OVERVIEW-UX-CAMPAIGN-v1

- Purpose: Phase 2B league UX/engagement campaign — Overview hierarchy fix, signal-first copy pass, member feedback entry point, information density pass, app flow improvements, and visual design language.
- Scope: `src/components/OverviewPanel.tsx`, `src/components/StandingsPanel.tsx`, copy/label edits throughout.
- Notes: Retroactively registered. Covers PRs #167–#172 on branches phase-2b-*.

### P2B-OVERVIEW-FEATURE-AUDIT-v1

- Purpose: Audit current Overview page modules for overlap vs. unique value before UI redesign. Planning output only — no implementation.
- Scope: OverviewPanel analysis only. No code changes.
- Notes: Planning doc only. Informed P2B-OVERVIEW-UX-CAMPAIGN-v1 implementation.

### DOCS-PROMPT-GOVERNANCE-BOOTSTRAP-v4

- Purpose: Move engineering operating instructions into the repo and establish PROMPT_ID-based traceability.
- Scope: docs only.
- Notes: Initial bootstrap for in-repo prompt governance, summary identification, instruction block identification, and commit traceability.

### DOCS-CODEX-SELF-CHECK-v1

- Purpose: Require Codex to self-check PROMPT_ID compliance before returning summaries or creating commits.
- Scope: docs only.
- Notes: Follow-up governance hardening after initial in-repo bootstrap.

### DOCS-POST-MERGE-GOVERNANCE-FIXES-v1

- Purpose: Resolve optional instruction-block validation and improve commit traceability without degrading readable git history.
- Scope: docs only.
- Notes: Post-merge cleanup for governance consistency and maintainability.

### DOCS-PROMPT-RESPONSE-REQUIREMENT-v1

- Purpose: Update prompt governance to require explicit final response requirements in every Codex prompt.
- Scope: docs only.
- Notes: Ensures response-format expectations are restated at execution time, including Section 2 and Section 3.8 applicability.

### P7B-7-FIX

- Purpose: Remove unused `draftBannerDismissed` and `dismissDraftBanner` state.
- Scope: `DraftBoardClient.tsx`.
- Notes: Commit `daa477b`.

### P7B-7-FIX-2

- Purpose: Fix React hook violation — move `autoPauseRef` and `maybeAutoPauseForRound` before early return.
- Scope: `DraftBoardClient.tsx`.
- Notes: Commit `c1a0460`.

### P7B-7-FIX-3

- Purpose: Redesign draft header with three-card layout and circular countdown clock.
- Scope: `DraftHeaderArea.tsx` (new), `DraftBoardClient.tsx`, `SpectatorBoardClient.tsx`.
- Notes: Commit `21fcfb8`.

### P7B-7-FIX-5

- Purpose: Fix horizontal overflow on draft board pages.
- Scope: Draft board page wrappers.
- Notes: Commit `fcba082`.

### P7B-7-FIX-5B

- Purpose: Contain board table overflow without clipping sidebar.
- Scope: Draft board layout.
- Notes: Commit `1f33fe0`.

### P7B-7-FIX-7

- Purpose: Remove `max-w-screen-xl` and restore `mx-auto` on draft board page containers.
- Scope: Draft board pages.
- Notes: Commits `3d62546`, `3f72c9c`.

### P7B-7-FIX-8

- Purpose: Plain text badges, flanking card hierarchy, transposed draft board.
- Scope: `DraftHeaderArea.tsx`, `DraftBoardGrid.tsx`.
- Notes: Commits `2ebc6c3`, `8c529f5`.

### P7B-7-FIX-9

- Purpose: Abbreviated team names in draft board, 90px columns.
- Scope: `DraftBoardGrid.tsx`.
- Notes: Commit `f5223b1`.

### P7B-7-FIX-10

- Purpose: Narrow owner column, short names in sidebar, conference search, sticky sidebar.
- Scope: `DraftBoardClient.tsx`, `DraftBoardGrid.tsx`.
- Notes: Commit `d28aa08`.

### P7B-7-FIX-11

- Purpose: Team name resolution chain, header width constraint, sidebar names.
- Scope: `DraftBoardClient.tsx`, `DraftBoardGrid.tsx`.
- Notes: Commit `2342e56`.

### P7B-7-FIX-12

- Purpose: Revert to horizontal table orientation (owners as columns, rounds as rows).
- Scope: `DraftBoardGrid.tsx`.
- Notes: Commit `4fc41c2`.

### P7B-7-FIX-13

- Purpose: Replace sidebar with horizontal bottom team strip.
- Scope: `DraftBoardClient.tsx`, `SpectatorBoardClient.tsx`.
- Notes: Commit `d5784bc`.

### P7B-7-FIX-14

- Purpose: Fixed-frame layout — no vertical page scroll, `calc(100dvh - 10rem)`.
- Scope: `DraftBoardClient.tsx`, `SpectatorBoardClient.tsx`.
- Notes: Commit `47099d8`.

### P7B-7-FIX-15

- Purpose: Random auto-pick selection from available teams, updated search placeholder.
- Scope: `route.ts` (draft API), `DraftBoardClient.tsx`.
- Notes: Commit `299d064`.

### P7B-7-FIX-16

- Purpose: Timer expiry always pauses and prompts commissioner.
- Scope: `route.ts` (draft API).
- Notes: Commit `669e229`. Hotfix `edf8c41`.

### P7B-7-FIX-17

- Purpose: Carousel-based pick header with five cards and crossfade.
- Scope: `DraftHeaderArea.tsx`.
- Notes: Commit `59850c0`.

### P7B-7-FIX-18

- Purpose: Redesign carousel to compact landscape strip with round boundary labels.
- Scope: `DraftHeaderArea.tsx`.
- Notes: Commit `df5cd3c`. Flex-ratio card sizing, CSS grid crossfade, round boundary sidebars.

### P7B-7-FIX-19

- Purpose: Cap carousel strip at 900px max-width, centered.
- Scope: `DraftHeaderArea.tsx`.
- Notes: Commit `938cd9d`.

### P7B-7-FIX-20

- Purpose: Add 1400px max-width to draft page, remove duplicate gear icon.
- Scope: Draft board `page.tsx`.
- Notes: Commit `f24159d`.

### P7B-7-FIX-21

- Purpose: Widen page max-width to 1920px.
- Scope: Draft board `page.tsx`.
- Notes: Commit `d120557`.

### P7B-7-FIX-22

- Purpose: Remove max-width, add 24px horizontal padding.
- Scope: Draft board `page.tsx`.
- Notes: Commit `e94b543`.

### P7B-7-FIX-23

- Purpose: Fix page centering with explicit margin auto and max-width.
- Scope: Draft board `page.tsx`.
- Notes: Commit `3102d41`.

### P7B-7-FIX-25-AUDIT

- Purpose: Print exact JSX structure of draft page component for centering diagnosis.
- Scope: Read-only audit. No commits.

### P7B-7-FIX-25-AUDIT-2

- Purpose: Identify parent layouts causing left-alignment.
- Scope: Read-only audit. No commits.

### P7B-7-FIX-25

- Purpose: Center draft content at 1400px max-width with inner wrapper div.
- Scope: Draft board `page.tsx`.
- Notes: Commit `9dfa4fa`.

### P7B-7-FIX-26

- Purpose: Add `width: 100%` to draft board container, table wrapper, and table.
- Scope: `DraftBoardClient.tsx`, `DraftBoardGrid.tsx`.
- Notes: Commit `584858a`.

### P7B-7-FIX-27

- Purpose: Fix timer expiry behavior (honor `timerExpiryBehavior` setting) and setup auto-advance error recovery.
- Scope: `DraftHeaderArea.tsx`, `DraftSetupShell.tsx`.
- Notes: Commit `9606d2b`. Auto-fire auto-pick effect; `autoAdvancedRef` guard prevents permanent loading state.

### P7B-7-FIX-28

- Purpose: Mobile-responsive carousel — 3 cards on mobile, reduced padding/fonts.
- Scope: `DraftHeaderArea.tsx`.
- Notes: Commit `fbf8f0e`.

### P7B-7-FIX-29

- Purpose: Reduce horizontal padding to 8px on mobile, 24px on desktop.
- Scope: Draft board `page.tsx`.
- Notes: Commit `0995fa6`. Tailwind `px-2 md:px-6` (server component, no hooks).

### P7B-7-FIX-30

- Purpose: Increase draft board cell font to 12px on desktop, 11px on mobile.
- Scope: `DraftBoardGrid.tsx`.
- Notes: Commit `ea394f0`.

### P7B-7-FIX-31

- Purpose: Reduce owner column width from 100px to 86px for 14-column fit.
- Scope: `DraftBoardGrid.tsx`.
- Notes: Commit `66a9bc2`.

### P7B-7-FIX-32

- Purpose: Allow team selection during round-boundary pause — implicitly starts next round.
- Scope: `DraftBoardClient.tsx`.
- Notes: Commit `f7e2d1d`. Sequential PUT (resume) + POST (pick) when paused at round boundary.

### P7B-7-FIX-33

- Purpose: Hard-cap total rounds at `floor(fbsTeamCount / ownerCount)`.
- Scope: `DraftSettingsPanel.tsx`, `route.ts` (draft API).
- Notes: Commit `be4548d`. UI max, on-save clamp, and API validation in both POST and PUT.

### P7B-7-FIX-34

- Purpose: Draft summary page — public access, conference column, complete banners.
- Scope: `DraftSummaryClient.tsx`, summary `page.tsx`, `DraftHeaderArea.tsx`, `DraftBoardClient.tsx`, `SpectatorBoardClient.tsx`, `CFBScheduleApp.tsx`.
- Notes: Commit `edd7d4e`. Removed admin redirect; added conferenceMap; alphabetical owners; "View Draft Summary →" on complete banner; league overview draft-complete banner with Week 1 auto-hide.

### P7B-7-FIX-35

- Purpose: Use short display names on draft summary page (e.g. "FIU" instead of "Florida International").
- Scope: Summary `page.tsx`, `DraftSummaryClient.tsx`.
- Notes: Commit `b94c6f9`. `displayNameMap` built from `getTeamDatabaseItems()` with same resolution as `draftTeamInsights.ts`.

### P7B-7-AUDIT-ROUND-COUNT

- Purpose: Audit where total round count is defined, stored, and whether it's hardcoded or dynamic.
- Scope: Read-only audit. No commits.
- Notes: Found `totalRounds` is user-configurable (1–50), stored in draft state, with `ceil(fbsTeamCount/ownerCount)` suggestion. No hardcoded value of 10 found.

---

## Superseded Prompts

### P3A-OVERVIEW-REDESIGN-v1

- Superseded by: P2C-OVERVIEW-REDESIGN-v1
- Reason: Phase numbering reconciliation (DOCS-PHASE-RECONCILIATION-v1).

### P3B-TRENDS-TITLE-CHASE-v1

- Superseded by: P2D-TRENDS-TITLE-CHASE-v1
- Reason: Phase numbering reconciliation (DOCS-PHASE-RECONCILIATION-v1).

### P3B-TRENDS-FORM-DOTS-v1

- Superseded by: P2D-TRENDS-FORM-DOTS-v1
- Reason: Phase numbering reconciliation (DOCS-PHASE-RECONCILIATION-v1).

---

## Ledger entry template (example only)

Illustrative shape for a ledger entry — **not** current prompt-governance authority. The binding ID format and header rules live in `AGENTS.md` / `CLAUDE.md`; entries follow the current `<CAMPAIGN>-<###>-<SHORT_NAME>-v<version>` format (campaign prefixes: `INSIGHTS`, `DRAFT`, `PLATFORM`, `POLISH`, `DOCS`).

### `<CAMPAIGN>-<###>-<SHORT_NAME>-v<version>`

- Purpose: [one sentence]
- Scope: [files or modules affected]
- Notes: [optional — branch, PR refs, follow-up items, superseded IDs]

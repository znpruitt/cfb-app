# AGENTS.md

Status: Current
Last verified: 2026-08-05
Owner: Project documentation
Canonical for: binding engineering, architecture, implementation, review, and documentation-timing rules; agent operating rules
Supersedes: docs/archive/governance/cfb-engineering-operating-instructions.md (original prompt-governance model; jointly with CLAUDE.md)

> **Doc authority (source of truth):** `AGENTS.md` is canonical for **code architecture and agent operating rules**. `DESIGN.md` is canonical for **UI/UX and the design system** — defer to it on any visual/layout question and do not restate its content here. `CLAUDE.md` holds **Claude-specific working guidance only** and points back here rather than duplicating architecture. When these disagree, this hierarchy wins for architecture/rules and `DESIGN.md` wins for UI. See [`docs/README.md`](docs/README.md) for the full documentation map and per-doc ownership.

## Project purpose

This repository contains a Next.js college football office pool web app.

The app is now **API-first** for game loading and live enrichment:

- **CFBD** is the source of truth for schedule and scores, and the **sole normal production score provider** (PLATFORM-086A rereview removed ESPN as an automatic score fallback and durable score source). A CFBD failure preserves the prior-good durable score cache and reports a failure — it never silently substitutes a second provider; a valid empty CFBD partition (postseason before bowls, a future week) is a **no-op / valid absence** that writes nothing and preserves prior-good rows, not a failure.
- **The Odds API** is the source of truth for betting odds.
- Local app data supports:
  - owners upload + cache
  - alias persistence + repair
  - diagnostics/manual intervention tooling
  - minimal static team reference metadata

Changes should favor low-risk, behavior-preserving refactors unless explicitly asked otherwise.

## Project status

All foundational phases are complete (architecture, production hardening, league UX, multi-league, historical analytics, draft tool, admin auth, design audit, commissioner self-service, season lifecycle, launch prep). Work is now organized into named workstream campaigns.

Active campaign status is **not** duplicated here — it drifts. See `docs/next-tasks.md` (the active execution queue and current phase focus) and `docs/roadmap.md` (campaign definitions and development philosophy) for the current campaigns and their status.

**Unresolved decisions and deferrals** are tracked in one place: `docs/next-tasks.md` → "Unresolved decisions & known deferrals" (a top-level section since DOCS-012; it originated under the app-wide PLATFORM-068 audit sequence); per-item history is in `docs/prompt-registry.md`. That section is the single source — do not restate individual item statuses here or in `CLAUDE.md`, so they can't go stale as items ship.

---

## Runtime flow (current)

Typical runtime flow:

1. Load aliases from server, with local fallback.
2. Restore local cached user artifacts (owners CSV).
3. Fetch season schedule from CFBD-backed API route.
4. Load local teams catalog reference data.
5. Build normalized game identities and diagnostics.
6. Fetch odds via The Odds API adapter route.
7. Fetch scores via CFBD-backed scores route.
8. Surface diagnostics and allow alias repair workflows.

Notes:

- API-first schedule loading is the only supported schedule path.

---

## Architecture overview

### Main orchestrator

`src/components/CFBScheduleApp.tsx`

Responsibilities:

- hold top-level state
- coordinate bootstrap and refresh flows
- call schedule/scores/odds/team-catalog APIs
- coordinate alias and diagnostics workflows
- wire UI components together

Keep this file as an orchestrator. Do not move heavy parsing/matching logic into it.

### UI components

`src/components/` should contain focused rendering + UI handlers:

- `AliasEditorPanel.tsx`
- `IssuesPanel.tsx`
- `UploadPanel.tsx`
- `WeekControls.tsx`
- `GameWeekPanel.tsx`
- `TeamsDebugPanel.tsx`

### Reusable logic

Put shared/non-trivial logic in `src/lib/` (parsing, matching, transforms, diagnostics helpers, API client helpers).

Schedule-derived game attachment for live scores and odds should be implemented in shared lib helpers,
not duplicated in route handlers or UI components.

### Selectors (`src/lib/selectors/`)

All derived data — standings, insights, trends, matchup context, storylines — is computed in `src/lib/selectors/`. This is the **single source of derived truth** for the entire app.

Selectors are pure functions: same inputs always produce the same outputs. No side effects, no API calls, no database access.

Key selectors:

| File                   | Purpose                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| `insights.ts`          | League insights (movement, surge, collapse, race, etc.) — shared by Overview and Standings |
| `overview.ts`          | Full Overview page view model (hero, podium, standings context, live items)                |
| `trends.ts`            | Games Back trend, week-over-week position deltas, week labels                              |
| `matchups.ts`          | Head-to-head context per matchup                                                           |
| `storylines.ts`        | Contextual narratives                                                                      |
| `standingsMovement.ts` | Rank delta per owner                                                                       |
| `momentum.ts`          | Recent form derivation                                                                     |

UI components may perform lightweight presentation-layer logic (filtering, sorting already-derived arrays for display). They must not recompute league state inline.

### API routes

`src/app/api/` routes act as provider adapters:

- `schedule/` (CFBD-backed)
- `scores/` (CFBD-backed)
- `odds/` (The Odds API-backed)
- `teams/` (local teams catalog)
- `aliases/` (alias persistence)

Routes should normalize provider quirks and return stable app-facing structures.
Team canonicalization and schedule-game attachment belong in shared identity/attachment helpers in `src/lib/`.

---

## Static data

Static reference data lives in `src/data/`.

Canonical files:

- `src/data/teams.json` ← canonical team catalog source
- `src/data/alias-overrides.json` ← optional alias-derivation overrides for catalog generation script

Do not reintroduce `teams-<year>.json` / `teams-latest.json` copies unless there is a concrete, approved runtime behavior requirement.

---

## Core rules

1. **API-first schedule + scores**
   - CFBD-backed routes define schedule and score truth.
   - Do not silently reintroduce CSV-first schedule architecture.
   - **One cache-only season score reader (PLATFORM-084B).** Every season-level score consumer — public `/api/scores`, canonical standings, and the season-rollover archive build — reads cached scores through the shared `loadReconciledSeasonScores` (`src/lib/server/scoreCacheReader.ts`), which reconciles the season-wide (`${year}-all-*`) and per-week (`${year}-<week>-*`) cache entries by canonical game identity (newest wins). Do not add a canonical consumer that reads only the `-all-*` keys — that reintroduces the mismatch where a week-specific refresh is visible on `/api/scores` but not in standings/archives. The reader is cache-only (no provider call; provider fetch stays on the authorized `refresh=1` path per PLATFORM-075) and propagates store-read failures per PLATFORM-084A.
   - **Durable-first provider cache writes (PLATFORM-085A).** A provider refresh path that keeps a process-local cache alongside durable app-state must `await setAppState(...)` (durable) BEFORE updating the process cache and BEFORE invalidating standings — never memory-first. So a failed durable write surfaces as an error and never leaves one instance serving "fresh" provider data other instances can't reproduce. Order: `fetch/normalize → durable write → process-cache update → invalidation → response`. Hydrating the process cache FROM a durable read (cache-warming on a hit) is exempt — that data is already durable.
   - **Complete-before-commit for schedule refreshes (PLATFORM-085B / 085C).** Any schedule refresh that fetches provider partitions — the season-transition cron (regular + postseason → `${year}-all-all`) AND the authorized `/api/schedule` route — must validate that ALL requested partitions resolved before publishing durable schedule/probe state. A partition that **throws**, returns a **non-array**, or normalizes a **nonempty** payload to **zero** rows (schema drift) is **uncertainty** — retain prior-good durable state and surface the failure (cron: `partialFailure` on the result; `/api/schedule`: `502` via `hasRequiredSeasonTypeFailure`); do not commit partial/drifted rows as a complete schedule. A partition that fetches successfully with a **zero-length** array is **valid absence** (e.g. postseason before bowls, a future week). In `/api/schedule`, `fetchSeasonType` enforces the nonempty→zero and non-array checks by throwing so the partition lands in `failedSeasonTypes`; the completeness gate (`hasRequiredSeasonTypeFailure`) then rejects before the commit block. Reuse this shared classification rather than re-deriving completeness.
   - **Truthful provider-refresh status (PLATFORM-086A).** Every provider refresh entry point records status via `src/lib/server/providerRefreshStatus.ts` (scope `provider-refresh-status`), keyed by a **canonical target scope**, not merely by dataset (PLATFORM-086A-SCOPED). The scope is a typed `ProviderRefreshScope` built only through `src/lib/providerRefreshScope.ts` — `global` (conferences), `year` (the aggregate scores/rankings year rollup and the full-year schedule refresh), `season-partition` (a whole scores/schedule partition), `week-partition` (a game-stats week, or a week-specific scores/schedule refresh), `odds-target` (canonical vs filtered, keyed by the durable `odds-cache` key), or `legacy-unscoped` (pre-scoped records). **The operation's exact attempted target — never a broader rollup — chooses the scope (PLATFORM-086A-SCOPED-STATUS review remediation):** schedule uses `scheduleRefreshScope`, which reserves the `year` rollup for the **full-year** refresh only (`week === null` + all season types) — a targeted `seasonType` records the `season-partition` and a specific week records the `week-partition`, while a **specific week with no season type** (`week` + `all`) is split into TWO independent week-partition operations (regular + postseason), each committing to its own child key and recording its own week status so a sibling failure never cross-contaminates (`scheduleRefreshScope` **throws** for that combination rather than coercing it onto the regular week — review v2 #2); the combined `week + all` cache-only READ is **composed at read time** from the exact regular/postseason child caches (`readComposedWeekAllEntry`; per-partition precedence **exact child cache → matching partition rows of the legacy `<year>-<week>-all` aggregate → absent**, each child resolved through the shared `resolveChildCache` that mirrors the single-key freshness contract — a fresh process entry is a fast-path hit, an **expired** process entry re-reads durable so a newer durable child is never masked, and an expired-with-no-durable entry is absence not a hit; a partition contributing no rows — inapplicable, or an **empty legacy extraction** — contributes no timestamp, so it can never drag an otherwise-fresh view stale; the composed view is stale iff its OLDEST **contributing** partition is stale — WEEK-ALL-COMPOSITION-FRESHNESS review) rather than from a second materialized aggregate copy — so a targeted child repair is immediately reflected and no derived copy can drift or drop prior-good rows, and the pre-split `<year>-<week>-all` aggregate is now a **read-only legacy compatibility fallback** that is never written, replaced, or deleted (WEEK-ALL-READ-COMPOSITION review, superseding the materialized-aggregate write of review v3); consistent with that, the child empty-response classifier consults the matching legacy-aggregate partition rows as prior-good, so a provider `[]` for a partition whose child key is absent but which the legacy aggregate still covers is a rejected **unexpected empty replacement** (recorded failure), never a silent no-op; single-partition scores use `scoresPartitionScope` (`season-partition` for a whole-partition refresh, `week-partition` for a week-specific one); the aggregate scores refresh uses `scoresAggregateScope`, which writes the `year` rollup **only** when the attempted partitions cover **every applicable** partition (a subset omitting an applicable sibling records its own `season-partition`). `beginProviderRefreshAttempt`/`record*` all take `(dataset, scope, …)` and the durable key is `providerRefreshScopeKey(dataset, scope)`; a record is self-describing (persists its `scope`/`scopeKey`, and a mismatch is ignored, not shown as truth), each scope key has its own in-process lock, and a completion for one target can never overwrite another (a 2026 refresh, a targeted partition/week, or a filtered odds query never establishes a different year's or the whole target's success/freshness). A completion **token** that resolves a **different dataset or scope** than it was begun for is **rejected** — the record helper skips the write (`isMisroutedAttempt`), logging the mismatch and never throwing into the provider path — so a concurrent cross-year/cross-partition/cross-dataset refresh cannot cross-contaminate another target's record. The admin card reads only the **canonical** scope for the selected year (`canonicalCardScope`); legacy unscoped records are exposed as `legacyStatus` for deep diagnostics only — never selected-year truth, never clearing a scoped error, never implying scoped cache availability. A **failed** attempt must NEVER advance `lastSuccessAt` — it preserves the prior-good `source`/`rowsCommitted` still being served; **success** is recorded only AFTER the durable provider-data commit (composing with durable-first); and the record helpers are **best-effort** — they must never throw into the provider path, so a status-write failure can't corrupt the data commit. The newest attempt's result is an **explicit outcome** (`latestAttemptOutcome`: `in-progress`/`succeeded`/`partial`/`failed`/`no-op`), never inferred from the historical `lastSuccessAt`/`lastError` fields: begin marks `in-progress`; a valid empty/inapplicable provider partition resolves as **`no-op`** (`recordProviderRefreshNoop` — clears stale error, does not advance last-success), distinct from a failure. Success ordering uses an explicit **`committedAt`** (durable commit time captured right after `setAppState`, before post-commit work) so an older commit recording status late cannot overwrite a newer commit's metadata — status-call wall-clock time is not the ordering key. Each refresh gets a unique **attempt token** from `beginProviderRefreshAttempt` and passes it back on resolve, so an OLDER overlapping attempt finishing late cannot restore its attempt identity, clear a NEWER attempt's error, or replace its outcome (only the latest attempt owns the latest-attempt/outcome/error state; a later durable commit still advances last-success). Any refresh entry point with an early **missing-credential** return must begin the attempt BEFORE credential validation and record a failure on that exit (so the attempt is visible, prior-good preserved); a durable-commit failure after a successful fetch must resolve the open attempt as failed rather than dangle. The **game-stats cron** resolves its canonical target week (cache-only, no provider call) BEFORE the credential check, so a missing-key (or any) cron failure records against that exact **week partition** — never the year rollup — and a run with no applicable target records no scoped failure and spends no provider call (review v2 #1). A genuine durable **read** failure is distinct from an absent record — on a read failure the attempt/failure helpers SKIP their write rather than null out unknown prior-good state. Read-modify-write is serialized per dataset in-process; cross-instance status writes remain best-effort (the store has no compare-and-set) but the explicit commit timestamps + attempt IDs remove the within-process ordering and unresolved-attempt hazards. This per-**scope** attempt lock is DISTINCT from the per-**backing-file** lock in `appStateStore.ts` (`withFileWriteLock`): the file lock serializes the whole-file read → modify → temp-write → atomic-rename critical section of the **file fallback** across ALL keys/scopes (keyed by the normalized backing-file path) so concurrent writers to different keys cannot drop one another's update on rename (review v2 #3). It applies only to the file fallback (Postgres relies on the database), never serializes reads, sits strictly below the per-scope lock (no inversion), and releases on every outcome. Cross-process file locking is out of scope. Status/freshness metadata is observability only and is **never** a source of canonical data. The admin status feed reads durable **odds usage once** per request (forced through the memo) so cross-instance refreshes aren't masked. Operator auto-refresh controls (`provider-refresh-settings`: global pause + per-dataset enable) gate only **noncritical** automatic jobs via `isAutoRefreshAllowed(dataset)`; the lifecycle-critical season-transition cron is exempt, and manual admin refresh is never gated. A per-dataset enable toggle is only settable when a live job actually consumes it (`autoRefreshSettingConsumed`) — the admin API rejects toggling planned/exempt datasets rather than imply a runtime effect that does not exist. Do not add editable cron/cadence fields — cadence stays fixed in code / `vercel.json`. An **all-empty schedule** refresh is classified BEFORE any durable/process-cache write: an empty result over an already-populated schedule is **rejected** as an unexpected replacement (prior-good retained, recorded failed, `502`), while a genuinely inapplicable/unpublished empty resolves as a **no-op** — a schedule is never committed empty and then labelled a no-op (which would empty the cache while status claimed old rows still served). The **cache-only** diagnostics judge coverage by real content, never by presence: completed-slate **score** coverage requires a canonical **terminal** classification (final, or canceled — an in-progress numeric row does not count via `gameStatus.ts`); **game-stats** coverage is the evidence-based `evaluatePartitionCoverage` (participant-verified against the canonical slate through the shared evidence authority under `src/lib/gameStats/`), which the diagnostics consume; a `games: []`, all-dropped, or blank-team-identity record contributes no coverage. (`src/lib/gameStats/coverage.ts` is now only a limited presence / cache-availability probe — `isUsableGameStatsRow` / `usableGameStatsGameIds` for the admin cache-state panel — NOT the coverage or analytics authority.) And **odds** staleness derives from the **canonical/default season-scoped `odds-cache`** entry (`defaultOddsCacheKey`), never the newest across filtered markets/bookmakers variants and never the global quota-observation timestamp (quota freshness ≠ odds-data freshness). Only **stat-producing** games count as expected game-stats — disrupted games (canceled/postponed/suspended/delayed) are excluded by the canonical slate / evidence authority, so a disrupted-only slate is never expected, never polled (no wasted quota), and never warned as missing. The 15-minute cron selects at most ONE stat-applicable kickoff-window partition per run (`pollingTarget.ts`), not a whole-slate scan. Rankings empty results are classified before commit exactly as for schedule: a genuinely empty response is a **no-op** (no empty durable write, last-success not advanced), a **nonempty→zero-usable** payload is a **failure** (`rankings-empty-replacement-rejected`, prior-good retained), and an empty result over prior-good rankings is rejected rather than persisted as healthy coverage (rankings coverage requires ≥1 usable week). **Game-stats no longer uses a standalone payload classifier** (the retired classifier was deleted when the live legacy route/cron write path was cut over; the fenced legacy writer itself is NOT deleted — it remains in `src/lib/gameStats/cache.ts` but is refused under writer control `active`): the game-stats cron and the admin `/api/game-stats` refresh both flow through the ONE ingestion path (`ingestGameStatsPartitionResponse`) and the ONE outcome interpreter (`interpretGameStatsRefreshOutcome`) — an exact empty CFBD array is an `empty-response` no-op, a non-array top-level payload is an `invalid-payload` failure (a rejection reason), and a nonempty payload with no persistable observations is a `no-persistable-observations` failure (also a rejection reason). A payload that reaches the H2 durable merge is classified by the interpreter into ONE of four **kinds** — `success`, `partial`, `no-op`, or `failure` — each via a stable **reason**: `written-clean` → success; `written-mixed` / `partially-merged` → partial; `unchanged-clean` / `stale-clean` → no-op; `unchanged-mixed` / `stale-mixed` / `conflict` / `unavailable` / `indeterminate` → failure (only the confirmed-commit `written` / `partially-merged` outcomes may advance last-success). The interpreter's four kinds, the durable-merge outcomes, and the reason strings are distinct layers — not interchangeable labels. Durable game-stat writing goes through the H2 merge authority and requires writer control `active`. **Rankings partitions are validated independently before combining (6th review):** the regular and postseason payloads are each classified (`classifyRankingsPartition`) so a nonempty partition normalizing to zero usable weeks is schema drift (`rankings-partition-schema-drift`, whole aggregate rejected, prior-good retained) — one healthy partition can never mask a drifted one, and drift is never mistaken for the raw-empty no-op/rejected-replacement path. **The schedule empty-response policy is one shared classifier (6th review):** `classifyEmptyScheduleRefresh` (`scheduleSeasonFetch.ts`) is called by BOTH the `/api/schedule` route and the season-transition cron, so an empty cron probe over a populated prior-good schedule is a rejected failure (`schedule-empty-replacement-rejected`, prior-good retained, and the league does **not** transition off that empty probe), never a silent no-op. **Status classification is separator-agnostic (6th review):** `gameStatus.ts` normalizes provider/cache enum labels (`STATUS_CANCELED`, `STATUS_POSTPONED`, hyphen/space variants) to tokens before matching (a bare `\b` word boundary silently fails on `_`), so the score-terminal and game-stats-applicability logic that consumes these predicates cannot misbucket an underscore-delimited enum. **The manual score refresh is ONE aggregate action (6th review):** the admin panels issue a single `refresh=1&aggregate=1` request that fans out over the applicable partitions under a single `scores` attempt (`handleAggregateScoreRefresh`) so no partition's success or valid no-op can erase another partition's failure (the attempt resolves exactly once from the combined outcomes: all-succeed → success, any-fail → failure with `failedPartitions`, all-no-op → no-op); a direct single-partition `refresh=1` still records its own truthful attempt. **Applicability is SERVER-authoritative (7th review):** the aggregate endpoint derives the applicable partitions cache-only from the requested year's schedule (`getApplicableScoreSeasonTypes`, `src/lib/server/scoreApplicability.ts`), so an ordinary refresh never fires a doomed postseason request before bowls exist and a client omitting/mis-sending the partition list cannot force an unnecessary partition; a nonempty `seasonTypes` query is honored only as an explicit targeted repair. The status panel guards its loads against a **year-selection race** (monotonic request seq + `AbortController` + echoed-year validation, `isCurrentStatusResponse`) so an older year's response cannot overwrite a newer selected year's feed. The shared manual-refresh interpreter treats a **stale** prior-good fallback (`meta.stale`/`meta.rebuildRequired`, e.g. rankings after rejecting an empty/drifted replacement) as a failure, alongside `meta.fallbackUsed`/`local_snapshot`. **A rankings refresh resolves its attempt exactly once (7th review):** the schema-drift branch records its specific code/`failedPartitions` and throws a marked already-recorded error so the outer catch rethrows without a second generic recording that would erase the code (a genuine fetch/commit failure still records the generic code). Future PLATFORM-086 cron jobs reuse these helpers rather than re-implementing status/settings.

2. **Odds provider boundary**
   - Odds data should flow through internal odds route adapters, not raw provider shapes in UI state.

3. **Alias persistence stability**
   - Preserve server alias loading, local fallback behavior, alias editing, and rebuild flows.

4. **Diagnostics are required**
   - Do not remove diagnostic surfaces that aid reconciliation debugging.

5. **Local caching remains intentional**
   - Preserve practical season-scoped local cache behavior for owners/aliases unless explicitly asked to change it.

6. **Structured prompt headers are required for Codex prompts**
   - Every new project Codex prompt should begin with:
     - `PROMPT_ID`
     - `PURPOSE`
     - `SCOPE`
   - Use this standard ID format: `<CAMPAIGN>-<###>-<SHORT_NAME>-v<version>`
   - Campaign prefixes: `INSIGHTS`, `DRAFT`, `PLATFORM`, `POLISH`, `DOCS` (documentation/governance work).
   - A split or multi-part task may use a lettered sub-sequence (e.g. `PLATFORM-079a`/`079b`, `DOCS-002A`/`002B`/`002C`).
   - Example: `INSIGHTS-001-OWNER-AGGREGATION-v1`, `DRAFT-001-SLOW-MODE-v1`, `DOCS-002A-...-v1`.
   - Existing `P{n}` prompt IDs (e.g. `P7B-GAME-STATS-PIPELINE-A`) are grandfathered — do not renumber them.
   - IDs should be human-readable and stable for later reference.
   - Bump the version when behavior or scope changes materially.
   - Minor wording-only edits may keep the same version if task intent is unchanged.
   - In follow-up discussion, reference prior prompts by explicit `PROMPT_ID` (avoid vague references like “that earlier prompt”).
   - See `docs/prompt-registry.md` for the template, registry tracking, and populated prompt list.

7. **Centralized team identity**
   - All team matching must go through `src/lib/teamIdentity.ts`.
   - No duplicate matching logic in route handlers, UI components, or other lib modules.

8. **Postseason canonical week**
   - Postseason weeks from CFBD restart numbering from 1, colliding with regular-season week numbers.
   - Canonical week is computed as: `canonicalWeek = maxRegularSeasonWeek + providerWeek`
   - This prevents Set deduplication from collapsing postseason games into regular-season week slots.
   - `providerWeek` must be preserved alongside `canonicalWeek` — score attachment traces by `providerWeek`.
   - **Never revert or bypass this calculation.** Doing so will silently break postseason trend charts and score attachment.
   - Implementation: `src/lib/schedule.ts` (`buildScheduleFromApi`). Score attachment safety: `src/lib/scoreAttachment.ts` indexes by both `canonicalWeek` and `providerWeek`.

9. **Selector architecture**
   - All derived league data must be computed in `src/lib/selectors/`. Never inline in UI components.
   - Selectors are pure functions: same inputs → same outputs. No side effects, no API calls.
   - Any derivation found outside `src/lib/selectors/` is an architecture violation.
   - See the Selectors section in Architecture overview for the full catalog.

10. **Roster Upload Fuzzy Matching is Upload-Layer Only**
    - Team name fuzzy matching for owner roster CSV uploads is handled in the upload validation pipeline — not in `teamIdentity.ts`.
    - `teamIdentity.ts` handles runtime identity resolution from already-clean data. The two concerns must remain separated.
    - The FBS-only match pool constraint applies to roster uploads only — schedule and game identity resolution uses the full team catalog including FCS opponents.
    - Confirmed fuzzy matches and manual selections are saved as global aliases; the upload pipeline must not write unresolved teams to storage.

11. **Centralized game ownership**
    - Current-season game ownership attribution must flow through `src/lib/gameOwnership.ts` (canonical-identity candidate resolution: participant `teamId` → canonical/display/raw → `canHome/away` → `csvHome/away` legacy fallback).
    - UI surfaces, routes, and selectors must not duplicate ownership-resolution logic or attribute ownership by raw provider-label equality. Schedule-derived canonical `AppGame` identity remains the source of truth for game identity; ownership is an overlay on it.
    - Known deferrals (do not document as fixed): normalized ownership-key indexing (`PLATFORM-040`) and historical/archive ownership surfaces (`historySelectors`, `trends`, `leagueRecords`, and the Insights context/generators — `insights/context.ts`, `insights/generators/*`, which still resolve owners from `game.csvHome/csvAway` raw labels) that still match by raw label. These historical surfaces are a distinct deferral from `PLATFORM-040` (which is normalized-key-only), recorded under `PLATFORM-039`. A canonical **owner-identity** mapping across seasons (for renamed/returning owners) is also deferred — owner display names are currently raw strings.

12. **CSV is roster-import support, never a game-identity source (transitional)**
    - CSV is never a schedule or game-identity source, and must not reintroduce CSV-first schedule/identity architecture.
    - The in-app **draft / team-assignment flow is the intended current-season ownership mechanism.** A current-season owner CSV import is an explicit **admin repair** path, not the default user flow. `PUT /api/owners` (CSV import + inline roster editor) is platform-admin-only and, since **PLATFORM-083**, guards active-season overwrites: a league-scoped write to the league's active season (`year >= league.year`) that would replace an already-populated roster requires an explicit `?override=1` repair confirmation, so a CSV import or editor save can no longer silently clobber a confirmed-draft/manual roster. Historical/backfill (past-year) writes and initial roster creation are unguarded.
    - Honest current state: some current-season roster persistence still serializes via CSV (`owners:{slug}:{year}`), so CSV cannot yet be declared strictly history-only — do not overstate this as resolved. But current-season overwrites are now guarded (above), not silent. Historical archives legitimately preserve roster CSV snapshots.

---

## File size / complexity guardrails

To prevent monolith regressions:

- React components: aim for < ~400 lines
- Library modules: aim for < ~500 lines
- If approaching ~600 lines, extract:
  - UI sections to `src/components/`
  - shared logic to `src/lib/`

Favor clarity and maintainability over clever abstractions.

---

## Validation and testing expectations

Preferred checks:

- `npm run lint`
- `npx tsc --noEmit`
- `npm test` — runs the full test suite via Node's built-in `node:test` runner with the `tsx` loader. Tests live in `src/**/__tests__/`. There is no separate test runner config (no vitest/jest); the script is defined in `package.json`. The full suite is now deterministic and green (the earlier Overview-related hang was fixed under the `TEST-SUITE-BASELINE-CLEANUP` arc), so it is a valid verification gate. Scoped suites are still fine — and faster — for tightly-focused changes; see `## Verification and reference conventions` below.

When practical, verify key runtime flows still behave:

- API schedule load
- odds refresh
- scores refresh
- owners upload/caching
- alias editor + diagnostics panel
- week filtering

---

## Verification and reference conventions

1. **The full `npm test` suite is a valid verification gate; scoped suites are the fast path.**
   - The historical Overview-related full-suite hang was fixed under the `TEST-SUITE-BASELINE-CLEANUP` arc (`--test-timeout` + baseline cleanup + per-process app-state isolation), so `npm test` now runs deterministically to completion. Do not repeat the old "the full suite hangs / gives no signal" warning.
   - For tightly-scoped changes, running only the relevant test files plus selector tests in `src/lib/selectors/__tests__/` is still the quickest way to iterate.
   - Report the TEST DELTA and the risk each new test protects, not a raw suite total — see **Verification → Test accounting**. The historical "71-failure" full-suite baseline is obsolete; do not compare against it.

2. **Visual references must exist at the path a prompt references.**
   - Mockups (HTML/PNG) belong in `mockups/`; design specs (markdown) belong in `docs/`.
   - Commit reference files before dispatching prompts that point to them.
   - Implementers should flag missing references rather than guess at content — this is correct behavior, not a defect.

---

## Reporting expectations for Codex tasks

When completing work, report clearly:

1. What changed
2. Which files changed
3. Whether behavior changed
4. Risks / follow-up suggestions
5. Lint and type-check results
6. Any known unrelated failures

Be explicit and accurate.

---

## Review and remediation limits (binding)

Implementation prompts automate the review cycle instead of relaying each result through the user. The limit is **adaptive, not a fixed round count** — repeated rounds were the mechanism by which remediations introduced their own defects.

1. Complete the scoped work and its verification, then run one self-review.
2. Gather **both** independent reviews — Codex and `/code-review` — against the **same commit**, before changing anything. Do not remediate one reviewer's findings while the other is still running: an early patch invalidates the second review's target.
3. Evaluate every finding against the code before accepting or dismissing it. Establish **reachability** (can real inputs reach it, or does a guard upstream stop them?) and **attribution** (`git show <base>:<file>` — new in this diff, or pre-existing?). A severity label is not evidence. Refuting a finding with evidence is a valid, expected outcome.
4. Apply **at most one normal cohesive remediation round**, covering the accepted findings together.
5. Run one confirming pass of each reviewer against the remediated commit.
6. **A second remediation round requires explicit user approval**, and only for a narrow defect **directly caused by** the first round. Anything else — a newly surfaced pre-existing issue, a broader design concern, an accumulation of P3s — is a follow-up, not a second round.
7. After that, **no further patching**. Report the finding, evidence, impact, and a recommendation, and stop. Do not claim convergence.

**Reconstruction over accumulation.** When a branch has taken two remediation rounds and still yields credible findings, or when review shows the scope itself was wrong (crossing automation jobs, shipping an untested second surface), **abandon the branch and rebuild the settled behavior from clean `main`** rather than patching further. Reconstruct by re-deriving, not by cherry-picking the stopped commits — the stopped history carries the defects that stopped it. Record the abandoned attempt as superseded/unimplemented and the replacement as the execution record. Named failure case: `PLATFORM-086F2H1T1` v1 (two remediation rounds, a false claim in a commit message, and a client-feedback layer that could not work in production).

Reconstruction is for sedimentary **product behavior, architecture, or scope** — not merely for a
misstated comment or an overbuilt proof harness around otherwise-sound production code. Classify
accepted findings as product/security behavior, verification-harness defects, or documentation
inaccuracies. When independent reviews agree the production behavior is sound and only the latter
two remain, freeze the production implementation and limit any authorized correction to that proof
surface under the round limits above.

**What resolves review:** no credible in-scope P0/P1/P2 remains. A literal "clean" verdict is not required. P3s and unrelated or pre-existing findings become tracked follow-ups; do not silently discard them.

---

## Scope and sizing (binding)

Applies to all campaign work.

The goal is a correctly sized, cohesive PR: **one cohesive objective with a clear acceptance contract, independently reviewable, verifiable, deployable, and revertible.**

**Stop-and-reassess signals** (not hard limits): more than 15 changed files, or more than 1,500 net changed lines excluding lockfiles and generated data → stop, explain in the PR what expanded and why, then split or obtain explicit approval. Record the approval and the actual diffstat in the registry entry.

**A planning split is MANDATORY before implementation** when work crosses distinct provider families, **separate automation jobs**, substantial independent UI surfaces, or components shipping on different schedules. Related fixes may stay together when they share one provider family or one end-to-end behavior. Artificial one-finding-per-PR fragmentation is the opposite failure mode.

Never bundle live scores with Odds. Never fold information-architecture work into correctness or automation PRs. No opportunistic architecture cleanup outside the acceptance contract. Unrelated review findings become separately tracked follow-ups.

**Every surface a PR touches must carry its own tests.** Widening scope to a second module or job and shipping it without route-level coverage is a scope violation in itself, not merely a test gap — if deleting the new guard leaves the suite green, the guard is not in the PR's acceptance contract. Named failure cases: `PLATFORM-086A` (77 files / ~12k lines); `PLATFORM-086F2H1B` v1 (two automation jobs, second one untested).

**Inventory shared-policy consumers before editing.** A change to shared authentication, storage,
scheduling, lifecycle, or other policy authority begins with an inventory of its direct and indirect
consumers. Focused suites are the fast path, but they cannot establish compatibility for a shared
boundary; the full suite is mandatory before reporting that such a change is compatible.

**Proof infrastructure counts as scope.** Prefer direct behavioral acceptance tests. Add source
scans, structural pins, meta-tests, or custom harness machinery only when an important invariant
cannot be observed behaviorally. Do not grow speculative proof machinery for future file forms,
roots, call patterns, or framework behavior outside the acceptance contract.

---

## Verification (binding)

**Every gate runs as its own shell command, and its real exit code is reported.** Never behind a pipe, `grep`, `tail`, or a chained command whose status can be masked — a pipeline's exit status is the last command's, and `PIPESTATUS` is bash syntax that is empty under zsh. For noisy commands redirect to a file and echo `$?` on its own line, then inspect the log separately.

**Verification binds to an exact commit.** Report the SHA the gates ran against, and confirm the worktree was clean and `HEAD` unchanged at that moment. Results never carry forward across a commit: after any change to the tree, re-run every required gate against the new commit before reporting.

**A regression test must be verified failing against its own pre-fix code**, reverting one fix at a time. A multi-fix revert that breaks compilation fails the whole file and proves nothing. State explicitly that this was done. A test whose stated discriminating property is false is worse than no test.

**A negative assertion requires a proven observer.** A test claiming that nothing was written,
invalidated, logged, called, or otherwise changed must include a positive control proving that the
same harness detects the forbidden event on the same resolving or rejecting path. If the subject
throws, capture observations in `finally`; an empty collection populated only after successful
resolution proves nothing. Mutation-check the observer when practical, not only the production
guard it observes.

Use verification labels precisely:

- **Regression test:** demonstrated failing against the actual pre-fix behavior.
- **Contract pin:** preserves intended behavior but may not distinguish the previous implementation.
- **Structural pin:** verifies required code shape when runtime observation is impractical.
- **Positive control:** proves that the observer detects the event whose absence is asserted.

Test names, comments, commit messages, PR bodies, and registry entries are verification assertions.
Claim only what was observed. If a claim is found false, correct it explicitly rather than carrying
it into closeout documentation.

### Test accounting

Report **test deltas and the risk each protects** — not a raw full-suite total. A full-suite count is a smoke signal, not evidence that the change is covered.

| Report | Not |
| --- | --- |
| Tests added / replaced / removed, by name or intent | "3240 tests pass" alone |
| The acceptance risk each new test protects | The focused-suite total by itself |
| Which existing assertions were retargeted, and that none were weakened | "Updated the affected tests" |
| Focused-suite result **and** full-suite result, distinguished | One number standing for both |

When a test is retargeted because an API was retired, preserve every assertion and say so. Weakening an assertion to accommodate a deletion is a silent coverage loss.

---

## Documentation closeout timing

- Implementation prompts should include the relevant documentation updates **in scope** (registry entry, roadmap/next-tasks status, invariant or architecture notes the change affects).
- Finalize documentation **immediately before merge, after code review/remediation is complete**, so the docs describe the actual shipped behavior — not the plan. Do not mark work "complete" in governance/registry/roadmap docs while review findings remain open.
- When a change resolves or supersedes a previously-documented risk or follow-up, update that earlier note; when it leaves a known risk unresolved, keep it documented as unresolved rather than quietly dropping it.

### Ledger ownership during closeout

A final implementation report is not itself documentation content to copy into every ledger. When a
task affects multiple documentation files, write only the projection owned by each file:

- `docs/next-tasks.md` owns the current execution queue, planned/parked/blocked work, and the single
  canonical list of unresolved decisions and deferrals. Do not add shipped implementation
  narratives, review histories, commit lists, or test totals.
- `docs/roadmap.md` owns campaign goals, dependencies, coarse sequencing, and high-level status. Do
  not duplicate PR closeout reports, detailed review findings, file lists, commits, or verification
  counts.
- `docs/prompt-registry.md` owns the concise historical execution record for formal prompts. Record
  purpose, scope, outcome, review/verification, and implementation/merge status. Do not maintain
  mutable `NEXT` pointers there.
- `docs/completed-work.md` owns concise merged/shipped outcome milestones. It is not a current task
  list and must not restate canonical deferrals or future execution order.
- Architecture and operations documents change only when the implemented behavior changes their
  owned runtime contract or operating procedure.
- When the same fact is relevant to more than one document, keep the detailed record in its owning
  document and use a short link elsewhere. Never copy the implementation's complete final response
  into multiple ledgers.
- Pre-merge closeout records implementation/review truth without claiming merge. The normal
  post-merge flip updates merge status and appends the completed milestone; it must not reintroduce
  live queue pointers into historical ledgers.

---

## Standings Ownership Invariants

These rules apply from the Standings Ownership Redesign campaign onward and must not be violated:

1. **Server canonical owns standings data.** `getCanonicalStandings` is the single source of truth for standings rows, history, color order, owner identity, and lifecycle. No component, route, or helper should derive this data independently.

2. **Client owns only the liveDelta overlay.** In-progress game annotations and computed per-owner pending stats live in `LiveDelta`, computed by `selectLiveDelta` / `useLiveDelta`. Consumers receive canonical and `liveDelta` as **separate props**. Canonical defines what a row says; `liveDelta` defines what a badge or chip annotates next to it. Never merge the two inside a render function.

3. **Never merge at render time.** Do not combine canonical and live data using shape-readiness predicates (e.g., "if rows exist, use X; else use Y"). Merging at render time caused the original NoClaim-at-#1 bug and required eight remediation rounds before being replaced by this architecture.

4. **All mutation routes call invalidateStandings.** Every route that mutates standings inputs — owners, aliases, postseason overrides, draft confirm, scores, schedule, archives, rollover — must call `invalidateStandings(slug, year)`. Admin forms that mutate standings must call `useRouter().refresh()` after success.

5. **Cache key uses resolved year.** The canonical standings cache key uses the year resolved by `resolveStandingsYear`, not raw caller input. `React.cache` wraps `unstable_cache`: per-request dedup (outside) and cross-request tag invalidation (inside). Tags: `standings:{slug}` (slug-level) and `standings:{slug}:{year}` (year-level). The closure pattern is required to bake `slug+year` into the `unstable_cache` key array.

6. **NoClaim is filtered at the source.** `splitOutNoClaim` (shared helper in `src/lib/standings.ts`) runs inside `deriveStandings`. The return value is `{ rows, noClaimRow, ... }` where `rows` excludes NoClaim. Consumers that need NoClaim read `noClaimRow` explicitly. No consumer filters NoClaim from an unfiltered row array.

7. **currentDate is passed through, never captured inside derivations.** `currentDate` is captured at request-handler level and passed through to `deriveLifecycleState` and all downstream derivation functions. No implicit `new Date()` inside selectors or derivation helpers. `usingArchivedRoster` on `InsightContext` indicates `fresh_offseason` states using the prior archive's roster.

8. **Cache valid absence, never cache uncertainty (PLATFORM-084A).** The canonical standings cache is tag-only (`revalidate: false`), so a snapshot persists until a mutation busts its tag — a snapshot built from a _failed_ read would stick indefinitely. Every app-state read in the compute path must distinguish genuine **absence** (a legitimate, cacheable state — e.g. no owners CSV, empty cached schedule, missing archive/probe/preseason-owners record) from a store-read **failure** (must reject). `getAppState` embodies this: it returns `null` only when the row is absent and throws on a real store error. Do **not** wrap a critical input read in a swallow-catch that converts a failure into an empty/default result (`null`, `[]`, `{}`, empty roster, 0-0 rows, awaiting-kickoff) — `unstable_cache` never persists a rejected promise, so a propagated failure surfaces and the next request recomputes, whereas a swallowed one caches a lie. The only sanctioned catch on this path is the `incrementalCache missing` invariant (non-RSC runtime → direct compute). This extends the PLATFORM-082A archive/insights rule to the standings selector itself.

---

## Auth Architecture Invariants

These rules apply from Phase 6 onward and must not be violated:

1. **Clerk is the user-identity and app-role provider** — no other identity systems, no custom session handling, no roll-your-own JWT verification. Clerk establishes who the user is and their app/admin role (`platform_admin`, etc.). This is distinct from the per-league **password access gate** (`src/lib/leagueAuth.ts`, keyed by `LEAGUE_AUTH_SECRET`): the league password only unlocks a passworded league's pages via a signed `league_auth_<slug>` cookie — it is **not** Clerk authentication and **not** admin authorization, and it grants no elevated role. A canonical **owner-identity** mapping (a league member's identity across seasons) is a separate concern and remains deferred; today owner names are raw roster strings.

2. **Three roles defined in Clerk `publicMetadata`**: `platform_admin`, `commissioner`, `member`. Role storage shape: `{ role: 'platform_admin' | 'commissioner' | 'member' }`. Commissioner league scoping: `{ role: 'commissioner', leagues: ['tsc', 'family'] }` — defined now, enforced in Phase 7.

3. **Route protection via Clerk middleware only** — never roll custom auth middleware. The single Clerk middleware instance in `middleware.ts` is the only place route-level auth rules live.

4. **API routes use `requireAdminAuth(req)`** — this helper checks Clerk JWT first, falls back to `ADMIN_API_TOKEN` during the Phase 6 transition period. It is a drop-in replacement for the old `requireAdminRequest()`. All new admin API routes must support Clerk JWT from day one.

5. **`ADMIN_API_TOKEN` fallback is deferred until Phase 8** — it exists only for Phase 6 backward compatibility. Removal is deferred until the Phase 8 multi-tenant commissioner signup ships, at which point commissioner-scoped Clerk roles replace any remaining token-based fallbacks. Do not build new flows that depend on it. Removal trigger: Phase 8 work begins.

6. **Never hardcode role checks outside middleware, `requireAdminAuth()`, and `requireAdminAction()`** — no inline `publicMetadata.role` comparisons in UI components or API handlers. All role assertions go through the designated helpers.

7. **Commissioner scoping is enforced in Phase 7** — `/league/[slug]/draft/*` will require `platform_admin` or `commissioner` with a matching slug. Do not implement this in Phase 6; do not design against it being absent in Phase 7.

8. **Server Actions authorize at their own boundary via `requireAdminAction(name)`** (PLATFORM-086F2H1SB). Next treats an exported Server Action as a public endpoint reachable by its action id, so route protection is defense in depth and NEVER the action's authority. Every exported action in `src/app/admin/[slug]/actions.ts` calls the guard as its FIRST executable statement, before argument validation, registry/app-state reads, writes, cleanup, standings invalidation, `revalidatePath`, or redirects. The guard calls `resolvePlatformAdminDecision()` — the CLOSED shared decision in `src/lib/server/adminAuth.ts`, not the `isPlatformAdminSession()` boolean wrapper, which cannot supply the refusal reason — with NO argument, because passing a `Request` would reach the `ADMIN_API_TOKEN` branch whose no-token path authorizes any caller outside production. That decision refuses outright when `CLERK_SECRET_KEY` is blank (Clerk's header-signature check degrades to an HMAC over the empty string) and distinguishes `authorization-unavailable` from `not-platform-admin`, so a Clerk outage is never recorded as a role denial. It is shared with `requireAdminAuth`; middleware is a SEPARATE boundary that calls Clerk directly and does not consume it. Refusal is a plain thrown `Error`: never `redirect()` or `notFound()`, which would fetch or render the very route being refused. The precise guarantee is that after ACTION ENTRY no application or durable read, write, or side effect precedes authorization — Next deserializes arguments before entry, so "zero reads" is not claimed. A new Server Action module requires an explicit authorization decision; a test fails if one appears.

---

## Season Launch Hardening Invariants

These rules apply from the Season Launch Hardening campaign onward and must not be violated:

1. **Draft admin access uses `canAccessDraftBoard`** — all RSC-level draft admin gates go through `src/lib/server/canAccessDraftBoard.ts`. No inline `publicMetadata.role` or `clerkRole` comparisons in draft UI components. This fulfills Auth Invariant #6 for the draft subsystem. Commissioner slug-scoped enforcement is Phase 7 work; `canAccessDraftBoard` is already the right entry point.

2. **Draft polling is phase-aware** — polling intervals must account for draft phase: 1.5s when `phase === 'live' && timerState === 'running'`, 30s when `phase === 'complete'`, 5s default. Never lock to a single interval regardless of phase. Slow polling on complete (not stopping) preserves re-open event delivery.

3. **Time-dependent classification belongs in consumers, not cached selectors** — `unstable_cache`-wrapped selectors must return time-invariant facts (e.g. a kickoff date string). Components and route handlers evaluate `Date.now()` at render/request time. A `Date.now()` call inside a tagged cache closure produces stale classification that persists until the tag is manually invalidated.

4. **Insights engine suppression is layered and bypassable** — (a) `shouldSuppressGenerator(g, context)` handles (id, lifecycle, flag)-based generator-level skips; (b) `isSuppressed(insight, records)` handles per-insight record-level suppression. Both layers are controlled by `bypassSuppression`. Any new engine-level suppression rule must use `bypassSuppression || !<rule>` — never unconditional — so admin diagnostic runs (`?bypassSuppression=1`) receive unfiltered output.

5. **`usingArchivedRoster` drives framing, not just gating** — when `context.usingArchivedRoster` is true, generators must reframe their output (e.g. "Last season's" prefix, "Returning owner" narrative) rather than producing bare preseason-unsafe copy or suppressing entirely. Use `applyLastSeasonFraming` and `applyReturningOwnerFraming` from `src/lib/insights/framing.ts`. Suppress completely only when reframing would be meaningless (e.g. `rookie_benchmark` — there is no valid "returning owner" framing for a first-archive-owner comparison).

---

## Lifecycle Authority Invariants

These rules apply from PLATFORM-086F2B onward and must not be violated:

1. **`league.status` is the lifecycle authority; `league.year` is only its synchronized projection.** The guarded write authority and the fixed-target demo-league control share `applyLifecycleStatus`: `season`/`preseason` set `status` AND synchronize `league.year = status.year` in ONE registry write; `offseason` sets `status` and writes the last authoritative season year — the outgoing `status.year` when one exists — into `league.year` (healing any desynchronized legacy top-level year rather than carrying it forward). `guardedLifecycleWrite` is the serialized write authority for the commissioner transitions, the automatic season transition, and the demo-league control; do not add a parallel read-modify-write path. **There is no general-purpose lifecycle setter.** PLATFORM-086F2H1T1 retired the arbitrary-slug `updateLeagueStatus`, leaving `setTestLeagueLifecycleState(state)` and `resetTestLeagueLifecycle()` — which take NO slug and always target `TEST_LEAGUE_SLUG` (defined in `src/lib/league.ts`) — as the only writes without an expected-state predicate, because forcing a state is exactly what the sandbox controls exist to do. They are not unguarded in the other sense: the year is DERIVED and structurally validated inside the same transaction (`season(N)`→`preseason(N+1)`, `preseason(N)` stays at N, `preseason(N)`→`season(N)`, offseason/missing derive from the stored authoritative year), so an unusable stored year or an unrepresentable successor refuses without writing. `resetTestLeagueLifecycle()` derives nothing, so it always recovers a corrupt demo record. Demo controls clear only demo-SCOPED app-state, strictly after a confirmed commit, and never a year-keyed record shared with production leagues such as `schedule-probe/<year>`. The two controls clear DIFFERENT years, deliberately: preseason setup clears the year the authority returned (the preseason it just installed), while the reset clears the DERIVED SUCCESSOR (`returned year + 1`) — the preseason a fresh dry run will use — because clearing the season the reset just installed would wipe the demo's live owners and draft. The pre-existing `completeSeasonRollover` still hand-rolls the equivalent projection inside its own exact-year transaction under rule 5; converging it is F2H2. ALL registry mutations serialize on the registry key via `withAppStateKeyTransaction` (whole-array read-modify-write; without the lock, concurrent mutators would drop one another's update). Generic `updateLeague` and the league-configuration PATCH (`/api/admin/leagues/[slug]`) must not mutate `year` or `status` (the API rejects with `409 league-year-lifecycle-managed` / `league-status-lifecycle-managed`) — never reintroduce a second year authority. New leagues are created with an explicit `status: { state: 'season', year }`.

2. **Commissioner preseason mutations make their decision under the registry lock.** `beginPreseasonTransition` requires `offseason`, derives and validates the successor year under the same transaction, and writes the status/year projection once. `completePreseasonSetup` requires `preseason` at exactly the submitted year; a stale form writes nothing, while an already-complete record may heal only a stale top-level projection. Both return closed outcomes without credential-bearing league records. Callers may log a refusal, but they must not bypass the authority or recompute the lifecycle decision from a pre-lock snapshot.

   **The AUTOMATIC transition is guarded on the same terms** (PLATFORM-086F2H1B). `GET /api/cron/season-transition` reads its target snapshot once and then performs lengthy provider/probe work, so it commits through `completeSeasonTransition(slug, targetYear)`, which re-checks the expected state and exact year inside the registry transaction and returns one of four closed outcomes: `transitioned`, `already-in-target-season` (a benign idempotent overlap or redelivery, which also heals a stale top-level projection), `league-removed` (a normal admin deletion after selection), or `not-in-target-preseason` (genuinely stale). The four dispositions are counted INDEPENDENTLY and reported identically across the HTTP response, the runtime event, and the durable receipt — as counts only, never league slugs. Only a refusal is anomalous: a year with any refusal is ALWAYS `partial` (even when every target refused, since the authenticated run did its canonical stage and then did not complete its lifecycle work), which is what System Health surfaces; benign already/removed dispositions raise nothing either way, and classify `no-op` ONLY when the run committed nothing at all. `no-op` asserts that neither a canonical refresh nor a lifecycle projection landed, so two cases classify `success` instead: an `already-in-target-season` target whose stale top-level projection was durably healed, and a year whose E1A refresh durably committed a schedule (`cached`). Both are real writes, and the same `cached`-counts-as-work rule governs the post-commit failure paths — otherwise an identical year would read `no-op` when it completed cleanly and `partial` when its cache bust threw. The reason always names the LIFECYCLE outcome; the E1A detail travels on `scheduleRefreshReason`. `transitioned` in the HTTP body means `transitionedLeagues > 0` — an actual write occurred — not that the year is complete. **The demo league is NOT an automatic transition target** (PLATFORM-086F2H1T2). `TEST_LEAGUE_SLUG` is filtered out BEFORE the zero-target decision and before grouping by year, so a demo-only year never reaches a probe read or write, a provider refresh, a lifecycle write, standings invalidation, or any target or disposition count on the response, event, or receipt. A registry whose only preseason league is the demo reports `skipped / no-automatic-preseason-leagues` — distinct from `no-preseason-leagues`, which would falsely tell an operator no league awaits transition. Because that cron was the demo's only automatic preseason→season path, its manual control (`setTestLeagueStatus`) now carries the standings invalidation the cron performed. **The demo league is NOT a weekly schedule-maintenance target either** (PLATFORM-086F2H1T3). `GET /api/cron/schedule-refresh` filters `TEST_LEAGUE_SLUG` PER LEAGUE, inside the year-ownership loop — never against the resolved target years, which would drop a year a production league also occupies. This is an owner-selector rule, not only a target removal: `season` outranks `preseason` for a shared year, so a demo league in `season(Y)` must not promote Y to the pause-exempt active-season policy over production leagues in `preseason(Y)`. That is the direction the rule changes; production `season` precedence over `preseason` is PRESERVED, not newly created — the existing precedence already prevented a preseason league from displacing a `season` owner. A registry whose only active leagues are the demo reports `skipped / no-automatic-maintenance-target`; `no-maintenance-target` keeps its exact meaning (no active league at all). No per-year entry, provider request, settings read, probe or latch operation, presentation refresh, or receipt target is produced for a demo-only year. **No league-scoped duty transfers to the manual control** — every durable key this cron writes is year- or global-scoped — but two consequences follow from that same fact and are deliberate. First, existing `schedule-weekly-control/<year>` boundary latches are RETAINED, including any written while only the demo occupied that year: the latch records a year-level fact derived from the shared canonical schedule, and a production league later sharing the year is entitled to read it. Second, a registry whose only active leagues are the demo no longer refreshes the GLOBAL `venue-catalog` automatically, because the presentation authority runs only after a populated per-year refresh; an authenticated manual full-year refresh remains the supported path. Do NOT delete shared latch, probe, canonical schedule, or presentation state to "clean up" after the exclusion — that state is year- or global-scoped and is read on production leagues' behalf. **The demo league is NOT an automatic rankings-publication target either** (PLATFORM-086F2H1T4). `selectRankingsTargetYears` (`src/lib/rankings/automaticContext.ts`) resolves ownership from PRODUCTION leagues only, filtering `TEST_LEAGUE_SLUG` PER LEAGUE inside its ownership loop — never against the resolved target years, which would drop a year a production league also occupies — and returns a closed `{ years, excludedDemoCandidate }` so the years and the exclusion truth that shaped them cannot be observed apart. The flag is derived from `slug` and `status.state` ONLY, never `status.year`, so an unvalidated legacy year cannot flip the zero-target reason, and an `offseason` demo record is not an excluded CANDIDATE. **Unlike F2H1T3 this is NOT an owner-selector rule with behavioral weight:** `RankingsPublicationContext.lifecycle` is inert — no publication window branches on it, the publication key omits it, and it never reaches the durable receipt — so a demo `season(Y)` that previously outranked production `preseason(Y)` changed only the REPORTED lifecycle, not window eligibility, quota, provider spend, or any durable write. A registry whose only active leagues are the demo reports `skipped / no-automatic-ranking-target`; `no-ranking-target` keeps its exact meaning (no eligible league at all). The automation gate stays AHEAD of target selection, so a PAUSED demo-only run still reports `automation-paused-or-disabled` and a registry fault can never turn a deliberately paused job into a scheduler failure. No league-scoped duty transfers to the demo controls — this path writes none — but a year the demo occupies ALONE loses automatic publication outright: `rankings/<year>` is never refreshed, and the consequence is NOT uniform across readers. The draft board's AP annotation and Insights swallow the miss; the LEAGUE APP does not — `loadSeasonRankings` throws on a total cache miss, `/api/rankings` maps it to 503, and the resulting `CFBD rankings load failed:` note is suppressed only while the league is in PRESEASON, so a demo league in `season(Y)` on a demo-only year surfaces a standing operator-visible error. The authorized manual refresh is the upkeep path and is ungated by the automation settings, but it is NOT unconditionally reachable: `/api/rankings` rejects any year above `currentUTCYear + 1` with a 400 before authorizing, while the demo lifecycle authority imposes no such ceiling, so a demo parked far enough ahead has no upkeep path at all until the calendar catches up. Existing `rankings-publication-window/<year>:<kind>:<date>`, `rankings/<year>`, lease, and year-scoped provider-refresh records are RETAINED: they are year-scoped provider evidence a production league later sharing the year is entitled to read, and a completed window key names a slot that has already elapsed, so deleting it could not change any future run. **The demo league does NOT select the System Health operational year either** (PLATFORM-086F2H1T5). `resolveOperationalSeasonYear` (`src/lib/server/systemHealthYear.ts`) filters `TEST_LEAGUE_SLUG` out of its population ONCE, before BOTH resolution branches, and delegates the unchanged three-step rule to a private helper that receives only the filtered list. **The exclusion is UNCONDITIONAL — deliberately unlike F2H1T3/F2H1T4, and copying their `isActive &&` gate here ships the bug.** Those jobs gate because an `offseason` demo was never an automatic TARGET, so flagging it would falsify their zero-target reason. Here the second branch reads the top-level `league.year`, which `applyLifecycleStatus` keeps synchronized to the demo's lifecycle and RETAINS on the move to `offseason`, so an active-only exclusion leaves a demo parked in offseason still selecting the year. Offseason and status-less demo records are excluded too. The predicate is slug-only and never reads a demo `year`, so an unvalidated legacy value cannot influence resolution before the demo is rejected; a record whose slug is not the demo slug is treated as production, failing toward production rather than letting corruption acquire demo-like influence. Production lifecycle authority is preserved (`status.year` for an active league, never `league.year`), as are the production stored-year fallback, the calendar fallback, the `[2000, currentUTCYear + 1]` clamp, and the numeric return — this resolver is TOTAL, so there is no zero-target state and no `excludedDemoCandidate` analogue, new reason, receipt field, or event. **Scope truth:** this removes demo INFLUENCE; it does NOT promise the resolved year is one automation maintains. An all-offseason registry resolves to the last authoritative production projection and a registry with no production league resolves to the calendar season, either of which may still need manual provider-data preparation. **The shared-predicate decision is now CLOSED: no universal predicate is warranted.** All five sites share the canonical slug identity (`TEST_LEAGUE_SLUG`, which already is that shared abstraction) but not lifecycle eligibility or ownership semantics — their eligibility sets are `{season}` for rollover, `{preseason}` for the season transition, `{season, preseason}` for weekly schedule and rankings, and EVERY league here. Any predicate carrying an active-state gate is provably wrong at this site. Do not create a successor convergence slice merely because the weekly-schedule and rankings selectors have similar loops.

   **Standings invalidation follows the outcome.** A confirmed transition records its counters first and then invalidates; an `already-in-target-season` delivery also invalidates, reconciling an overlapping invocation or a redelivery that STILL HOLDS a preseason snapshot; it does NOT guarantee recovery on a later daily run, because a league that already moved to `season` is no longer selected by the preseason-only target filter (see `docs/next-tasks.md` for the deferral); `league-removed` and `not-in-target-preseason` invalidate nothing because nothing was mutated. A durable lifecycle write and a Next cache invalidation cannot be one atomic operation — an invalidation throw after a confirmed commit reports `standings-invalidation-failed` and never rolls back or relabels the committed write. That year is `partial` only when it actually recorded work — canonical data, a transition, a heal, or a refusal; a year whose sole target was an UNTOUCHED `already-in-target-season` match wrote nothing, so it is a clean `failure` rather than a `partial` asserting progress that did not happen. This narrows the window; it does not close it.

3. **The new-league season horizon is an ingress rule, not a legacy-record cutoff.** `POST /api/admin/leagues` accepts only integer years from `2000` through `currentUTCYear + 1` via `isCreatableSeasonYear`. Persisted records are checked only for safe lifecycle arithmetic (`isStructurallyValidSeasonYear`); applying the creation horizon during a transition would freeze legacy data. A transition that derives `year + 1` must validate the successor before writing it.

4. **Rendering never persists lifecycle state.** Admin pages/GETs read legacy missing-status records through the read-only `{ state: 'season', year: league.year }` inference; initialization or repair is an explicit operation, never a render side effect. (Legacy missing-status records are also excluded from rollover targeting — as they already were from the automatic cron pre-F2B; their explicit repair path is owned by the F2H lifecycle-recovery slice, deliberately not by F2B.) **The registry CONTAINER read is classified, and its consumers migrate one job at a time** (PLATFORM-086F2H1R1, first of five). `readLeagueRegistry()` returns `ok` / `missing` / `malformed`; a store failure still THROWS, so unavailability stays distinct from corruption, and a present record whose value is not an array is `malformed` — including a stored JSON `null`, which deliberately diverges from `readScheduleItems`, where a null-valued record is ordinary absence. `getLeagues()` delegates with its behavior UNCHANGED (absent and malformed both still yield `[]`), because ~69 modules depend on it; callers that can act on the distinction consume the reader directly. The classification is CONTAINER-level only — it does not validate individual records, so a non-object element still throws downstream. `GET /api/cron/season-transition` is the first consumer: a malformed container refuses with `failure / registry-malformed` (500) before any probe, provider, lifecycle, or invalidation work, instead of reporting a zero-target reason asserting no league is awaiting transition. **`GET /api/cron/schedule-refresh` is the SECOND consumer (PLATFORM-086F2H1R2), on the same shape: a malformed container refuses with `failure / registry-malformed` before any schedule, probe, latch, settings, provider, or presentation work, and production candidates surviving the demo exclusion are validated the same way. Its HTTP status DIFFERS deliberately — 200, not R1's 500 — because this route answers every controlled outcome with 200 and only auth returns 401; the divergence is the route's pre-existing convention, not a new rule, and reconciling the two is a recorded follow-up. `GET /api/cron/rankings` is the THIRD consumer (PLATFORM-086F2H1R3), same shape, with its container read kept strictly BEHIND the automation gate so a corrupt registry can never turn a deliberately paused run into a scheduler failure. Its refusal count is published into a REQUIRED sink as the selector counts it, because there the counting loop lives inside the pure selector where the run state is not in scope — a count returned after the loop is discarded by a mid-loop throw, which is how R3 first reintroduced the very defect R2 closed. **The one remaining registry-reading job — season-rollover — still collapses malformed into empty; that falsehood is live on it until R4 lands.** **The 200-vs-500 divergence is a DELIVERY-BOUNDARY rule, now stated once:** the QStash-delivered routes (`schedule-refresh`, `rankings`) answer every controlled outcome with 200 and reserve non-200 for auth, because an at-least-once delivery layer must not read a controlled refusal as a transport fault; the Vercel-native lifecycle crons keep 500. **And the refusal-degraded aggregate has a consequence that is sharper on rankings than on any sibling:** because `skipped` is that job's modal outcome, one unrepaired record makes nearly every run classify `failure` and shows a standing System Health warning until the record is fixed. That is the intended encoding of "a deferral alone never causes failure; the unusable production target does" — recorded, not accidental. **Production preseason candidates are then validated with `isStructurallyValidSeasonYear`, AFTER the demo exclusion** — validating first would let a malformed demo record flip the zero-target reason and undo F2H1T2. Refused candidates produce no year key, per-year entry, probe read/write, provider request, lifecycle write, or `targetLeagues` contribution; they are reported as one run-level `invalidLifecycleTargets` count on the response, event, and receipt (counts only — never a slug or the unusable value; LEAGUES, not distinct years). **The count must survive a mid-loop throw.** Where the loop that counts refusals is also the loop that can throw — the registry array is typed `League[]` but nothing validates each element, so a non-object member throws on property access — the count must be accumulated on the run state itself, not in a local published after the loop, which a throw would skip. The predicate is structural, not a plausibility window: an in-range but absurd year (`999999`) still passes and still drives billed work, which remains F2H1R's to close. Aggregation: no refusals → the normal aggregate; refusals with no executed years → `failure / unusable-lifecycle-year`; refusals plus executed years → preserve the executed years' uniform reason (`year-results` only when they genuinely disagree) and classify `partial` when their aggregate is `success` or `partial`, else `failure`. The reason is never overwritten by the refusal, because the receipt's year entries carry counts and no reason field, so overwriting would erase the only durable record of what those years did. **Correction to a long-standing claim in `leagueRegistry.ts`:** `guardedLifecycleWrite` is NOT the only lifecycle write path — `completeSeasonRollover` calls `mutateRegistry` directly, bypasses `applyLifecycleStatus`, and is the only lifecycle writer with no structural year check. Closing that is F2H1R4's.

5. **Season rollover — manual AND automatic — is per-year, strict, and shared.** Target selection goes through `groupRolloverTargets` (`src/lib/rolloverTargeting.ts`): non-test leagues with `status.state === 'season'`, grouped exclusively by `status.year` (never `league.year`, the first registered league, or the calendar). Both `/api/admin/rollover` and `/api/cron/season-rollover` execute only behind `resolveNationalChampionshipRollover` (structured `cfbd-structured` CFP national championship + confirmed complete final + seven-day delay; cache-only, no provider calls), re-evaluated on every manual POST — a previously generated preview never authorizes execution. Archive-before-status is guaranteed in both paths, at two deliberate granularities: the MANUAL route is group-atomic two-stage (all archives first; any archive failure prevents every status transition for the year group), while the automatic cron preserves its per-league isolation (each league transitions only after its own archive save; one league's archive failure skips only that league) — in neither path can a league transition without its own durable archive. Every season→offseason transition goes through the guarded `completeSeasonRollover` (inside the serialized registry transaction, the league must STILL be in `season` for the exact requested year — a stale request can never clobber a league another actor already rolled or advanced). Partial status failures are reported truthfully. There is no force/emergency bypass; an exceptional forced recovery would require a separately reviewed operation.

---

## Preview branch

After completing any implementation and pushing to the feature branch, always run the following command before ending the session:

```bash
git push origin HEAD:preview --force
```

This keeps the `preview` branch current for UI validation on a stable Vercel URL. The `--force` flag is intentional — `preview` is a throwaway testing surface that always reflects the latest work in progress. Never open a PR from `preview`. Never merge `preview` into `main`.

---

## Guiding principle

Optimize for:

- clarity
- maintainability
- predictability
- low surprise
- incremental improvement

Prefer understandable code over large rewrites.

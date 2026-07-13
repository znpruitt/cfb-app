# AGENTS.md

Status: Current
Last verified: 2026-07-09
Owner: Project documentation
Canonical for: binding engineering, architecture, implementation, review, and documentation-timing rules; agent operating rules
Supersedes: docs/archive/governance/cfb-engineering-operating-instructions.md (original prompt-governance model; jointly with CLAUDE.md)

> **Doc authority (source of truth):** `AGENTS.md` is canonical for **code architecture and agent operating rules**. `DESIGN.md` is canonical for **UI/UX and the design system** — defer to it on any visual/layout question and do not restate its content here. `CLAUDE.md` holds **Claude-specific working guidance only** and points back here rather than duplicating architecture. When these disagree, this hierarchy wins for architecture/rules and `DESIGN.md` wins for UI. See [`docs/README.md`](docs/README.md) for the full documentation map and per-doc ownership.

## Project purpose

This repository contains a Next.js college football office pool web app.

The app is now **API-first** for game loading and live enrichment:

- **CFBD** is the source of truth for schedule and scores.
- **The Odds API** is the source of truth for betting odds.
- Local app data supports:
  - owners upload + cache
  - alias persistence + repair
  - diagnostics/manual intervention tooling
  - minimal static team reference metadata

Changes should favor low-risk, behavior-preserving refactors unless explicitly asked otherwise.

## Project status

All foundational phases are complete (architecture, production hardening, league UX, multi-league, historical analytics, draft tool, admin auth, design audit, commissioner self-service, season lifecycle, launch prep). Work is now organized into named workstream campaigns — see `docs/roadmap.md` and `docs/next-tasks.md`.

Active campaigns: INSIGHTS (Game Stats Pipeline → Insights Engine), DRAFT (Slow Draft Mode), POLISH (Copy/UX Writing Audit), PLATFORM (Auth Hardening).

**Unresolved decisions and deferrals** are tracked in one place: `docs/next-tasks.md` → "Audit-driven correctness + docs sequence" (from the app-wide PLATFORM-068 audit); per-item history is in `docs/prompt-registry.md`. That section is the single source — do not restate individual item statuses here or in `CLAUDE.md`, so they can't go stale as items ship.

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

| File | Purpose |
|------|---------|
| `insights.ts` | League insights (movement, surge, collapse, race, etc.) — shared by Overview and Standings |
| `overview.ts` | Full Overview page view model (hero, podium, standings context, live items) |
| `trends.ts` | Games Back trend, week-over-week position deltas, week labels |
| `matchups.ts` | Head-to-head context per matchup |
| `storylines.ts` | Contextual narratives |
| `standingsMovement.ts` | Rank delta per owner |
| `momentum.ts` | Recent form derivation |

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
   - **Truthful provider-refresh status (PLATFORM-086A).** Every provider refresh entry point records per-dataset status via `src/lib/server/providerRefreshStatus.ts` (scope `provider-refresh-status`). A **failed** attempt must NEVER advance `lastSuccessAt` — it preserves the prior-good `source`/`rowsCommitted` still being served; **success** is recorded only AFTER the durable provider-data commit (composing with durable-first); and the record helpers are **best-effort** — they must never throw into the provider path, so a status-write failure can't corrupt the data commit. Each refresh gets a unique **attempt token** from `beginProviderRefreshAttempt` and passes it back on resolve, so an OLDER overlapping attempt finishing late cannot restore its attempt identity or clear a NEWER attempt's error (only the latest attempt owns the latest-attempt/error state; a later durable commit still advances last-success). A genuine durable **read** failure is distinct from an absent record — on a read failure the attempt/failure helpers SKIP their write rather than null out unknown prior-good state. Read-modify-write is serialized per dataset in-process; cross-instance ordering is best-effort (the store has no compare-and-set). Status/freshness metadata is observability only and is **never** a source of canonical data. Operator auto-refresh controls (`provider-refresh-settings`: global pause + per-dataset enable) gate only **noncritical** automatic jobs via `isAutoRefreshAllowed(dataset)`; the lifecycle-critical season-transition cron is exempt, and manual admin refresh is never gated. A per-dataset enable toggle is only settable when a live job actually consumes it (`autoRefreshSettingConsumed`) — the admin API rejects toggling planned/exempt datasets rather than imply a runtime effect that does not exist. Do not add editable cron/cadence fields — cadence stays fixed in code / `vercel.json`. Future PLATFORM-086 cron jobs reuse these helpers rather than re-implementing status/settings.

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
   - Confirm the relevant suite count holds or grows; the historical "71-failure" full-suite baseline is obsolete — do not compare against it.

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

## Documentation closeout timing

- Implementation prompts should include the relevant documentation updates **in scope** (registry entry, roadmap/next-tasks status, invariant or architecture notes the change affects).
- Finalize documentation **immediately before merge, after code review/remediation is complete**, so the docs describe the actual shipped behavior — not the plan. Do not mark work "complete" in governance/registry/roadmap docs while review findings remain open.
- When a change resolves or supersedes a previously-documented risk or follow-up, update that earlier note; when it leaves a known risk unresolved, keep it documented as unresolved rather than quietly dropping it.

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

8. **Cache valid absence, never cache uncertainty (PLATFORM-084A).** The canonical standings cache is tag-only (`revalidate: false`), so a snapshot persists until a mutation busts its tag — a snapshot built from a *failed* read would stick indefinitely. Every app-state read in the compute path must distinguish genuine **absence** (a legitimate, cacheable state — e.g. no owners CSV, empty cached schedule, missing archive/probe/preseason-owners record) from a store-read **failure** (must reject). `getAppState` embodies this: it returns `null` only when the row is absent and throws on a real store error. Do **not** wrap a critical input read in a swallow-catch that converts a failure into an empty/default result (`null`, `[]`, `{}`, empty roster, 0-0 rows, awaiting-kickoff) — `unstable_cache` never persists a rejected promise, so a propagated failure surfaces and the next request recomputes, whereas a swallowed one caches a lie. The only sanctioned catch on this path is the `incrementalCache missing` invariant (non-RSC runtime → direct compute). This extends the PLATFORM-082A archive/insights rule to the standings selector itself.

---

## Auth Architecture Invariants

These rules apply from Phase 6 onward and must not be violated:

1. **Clerk is the user-identity and app-role provider** — no other identity systems, no custom session handling, no roll-your-own JWT verification. Clerk establishes who the user is and their app/admin role (`platform_admin`, etc.). This is distinct from the per-league **password access gate** (`src/lib/leagueAuth.ts`, keyed by `LEAGUE_AUTH_SECRET`): the league password only unlocks a passworded league's pages via a signed `league_auth_<slug>` cookie — it is **not** Clerk authentication and **not** admin authorization, and it grants no elevated role. A canonical **owner-identity** mapping (a league member's identity across seasons) is a separate concern and remains deferred; today owner names are raw roster strings.

2. **Three roles defined in Clerk `publicMetadata`**: `platform_admin`, `commissioner`, `member`. Role storage shape: `{ role: 'platform_admin' | 'commissioner' | 'member' }`. Commissioner league scoping: `{ role: 'commissioner', leagues: ['tsc', 'family'] }` — defined now, enforced in Phase 7.

3. **Route protection via Clerk middleware only** — never roll custom auth middleware. The single Clerk middleware instance in `middleware.ts` is the only place route-level auth rules live.

4. **API routes use `requireAdminAuth(req)`** — this helper checks Clerk JWT first, falls back to `ADMIN_API_TOKEN` during the Phase 6 transition period. It is a drop-in replacement for the old `requireAdminRequest()`. All new admin API routes must support Clerk JWT from day one.

5. **`ADMIN_API_TOKEN` fallback is deferred until Phase 8** — it exists only for Phase 6 backward compatibility. Removal is deferred until the Phase 8 multi-tenant commissioner signup ships, at which point commissioner-scoped Clerk roles replace any remaining token-based fallbacks. Do not build new flows that depend on it. Removal trigger: Phase 8 work begins.

6. **Never hardcode role checks outside middleware and `requireAdminAuth()`** — no inline `publicMetadata.role` comparisons in UI components or API handlers. All role assertions go through the designated helpers.

7. **Commissioner scoping is enforced in Phase 7** — `/league/[slug]/draft/*` will require `platform_admin` or `commissioner` with a matching slug. Do not implement this in Phase 6; do not design against it being absent in Phase 7.

---

## Season Launch Hardening Invariants

These rules apply from the Season Launch Hardening campaign onward and must not be violated:

1. **Draft admin access uses `canAccessDraftBoard`** — all RSC-level draft admin gates go through `src/lib/server/canAccessDraftBoard.ts`. No inline `publicMetadata.role` or `clerkRole` comparisons in draft UI components. This fulfills Auth Invariant #6 for the draft subsystem. Commissioner slug-scoped enforcement is Phase 7 work; `canAccessDraftBoard` is already the right entry point.

2. **Draft polling is phase-aware** — polling intervals must account for draft phase: 1.5s when `phase === 'live' && timerState === 'running'`, 30s when `phase === 'complete'`, 5s default. Never lock to a single interval regardless of phase. Slow polling on complete (not stopping) preserves re-open event delivery.

3. **Time-dependent classification belongs in consumers, not cached selectors** — `unstable_cache`-wrapped selectors must return time-invariant facts (e.g. a kickoff date string). Components and route handlers evaluate `Date.now()` at render/request time. A `Date.now()` call inside a tagged cache closure produces stale classification that persists until the tag is manually invalidated.

4. **Insights engine suppression is layered and bypassable** — (a) `shouldSuppressGenerator(g, context)` handles (id, lifecycle, flag)-based generator-level skips; (b) `isSuppressed(insight, records)` handles per-insight record-level suppression. Both layers are controlled by `bypassSuppression`. Any new engine-level suppression rule must use `bypassSuppression || !<rule>` — never unconditional — so admin diagnostic runs (`?bypassSuppression=1`) receive unfiltered output.

5. **`usingArchivedRoster` drives framing, not just gating** — when `context.usingArchivedRoster` is true, generators must reframe their output (e.g. "Last season's" prefix, "Returning owner" narrative) rather than producing bare preseason-unsafe copy or suppressing entirely. Use `applyLastSeasonFraming` and `applyReturningOwnerFraming` from `src/lib/insights/framing.ts`. Suppress completely only when reframing would be meaningless (e.g. `rookie_benchmark` — there is no valid "returning owner" framing for a first-archive-owner comparison).

---

## Preview branch

After completing any implementation and pushing to the feature branch, always run the following command before ending the session:

```
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

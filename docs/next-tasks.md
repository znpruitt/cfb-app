# Next Tasks (Active Queue)

## Purpose / How to use this document

- This file is the **active execution queue** for current campaigns.
- Keep tasks small and scoped to a **single implementation PR** where practical.
- Move completed work summaries to `docs/completed-work.md`.
- Keep broader context and later-phase ideas in `docs/roadmap.md`.
- Reference implementation prompts by explicit `PROMPT_ID` and follow the header convention documented in `docs/prompt-registry.md`.

## Campaign status

All foundational phases are complete. Work is now organized into named workstream campaigns.

| Workstream          | Campaign                                                                                | Status      |
| ------------------- | --------------------------------------------------------------------------------------- | ----------- |
| Data & Intelligence | Game Stats Pipeline                                                                     | ✅ Complete |
| Data & Intelligence | Insights Engine Foundation                                                              | ✅ Complete |
| Data & Intelligence | Insights Engine — Generators and Wiring                                                 | ✅ Complete |
| Data & Intelligence | Insights Engine — Context Extension                                                     | ✅ Complete |
| Data & Intelligence | Insights Engine — Generator Batch 2                                                     | ✅ Complete |
| Data & Intelligence | Copy Variation Architecture                                                             | ✅ Complete |
| Data & Intelligence | Insights Panel UI Redesign + Polish                                                     | ✅ Complete |
| Platform            | Season Launch Hardening (Draft Auth + Polling, Standings Preseason, Insights Lifecycle) | ✅ Complete |
| Platform            | Standings Ownership Model Redesign (Phases 0–5)                                         | ✅ Complete |
| Data & Intelligence | Insights Engine — Weekly In-Season Pulses (INSIGHTS-018)                                | Planned     |
| Data & Intelligence | Insights Diagnostic Endpoint (INSIGHTS-019)                                             | Planned     |
| Data & Intelligence | Insights Panel — Microlabel Palette (INSIGHTS-017-PALETTE)                              | Planned     |
| Data & Intelligence | Insights Ranker — Priority Tuning (INSIGHTS-RANKER-TUNING)                              | Planned     |
| Data & Intelligence | Insights — All Insights Page (ALL-INSIGHTS-PAGE)                                        | ✅ Complete |
| Data & Intelligence | Pairing Cards                                                                           | Planned     |
| Data & Intelligence | Luck Score + Bounce-Back Generators                                                     | Planned     |
| Platform            | Season Rollover UI and Cron                                                             | ✅ Complete |
| Platform            | AppStateStore Caching — Egress Optimization (APPSTATESTORE-CACHING)                     | Planned     |
| Platform            | Server Fetch Architecture Audit (SERVER-FETCH-ARCHITECTURE)                             | Planned     |
| Polish              | History Page Polish                                                                     | ✅ Complete |
| Polish              | History Rework Foundation (HISTORY-REWORK-FOUNDATION)                                   | ✅ Complete |
| Polish              | History Records (HISTORY-RECORDS)                                                       | In progress |
| Polish              | Standings Page — Preseason State (STANDINGS-PRESEASON-STATE)                            | ✅ Complete |
| Polish              | Standings Page — Lifecycle Labeling Sweep (STANDINGS-PAGE-LIFECYCLE-LABELING)           | Planned     |
| Polish              | Link Styling Audit (LINK-STYLING-AUDIT)                                                 | Planned     |
| Draft               | Slow Draft Mode                                                                         | Planned     |
| Draft               | Draft Difficulty Settings                                                               | Planned     |
| Platform            | Multi-tenant Commissioner Sign-up                                                       | Planned     |
| Platform            | Server Action Auth Hardening                                                            | Planned     |
| Polish              | Design Audit (remaining pages)                                                          | Planned     |
| Polish              | Copy / UX Writing Audit                                                                 | Planned     |
| Polish              | Back Button Audit                                                                       | Planned     |
| Polish              | Aliases Platform Migration                                                              | ✅ Done      |
| Polish              | History Page — Filter Former Owners                                                     | Planned     |
| Polish              | Test Suite Baseline Cleanup (TEST-SUITE-BASELINE-CLEANUP)                               | ✅ Done      |

## Active priorities

### 0. Audit-driven correctness + docs sequence (from the PLATFORM-068 app-wide audit)

Accepted order for the audit follow-ups. No P0s were found; these are P1/P2 correctness fixes plus the docs cleanup, sequenced so docs describe shipped behavior. **Do not mark the PLATFORM-069+ items complete until each ships** — they are open correctness risks today.

- **DOCS-001A** — deployment runbook secrets + privacy wording. ✅ Done (PR #356).
- **DOCS-001B** — governance-correctness docs cleanup + three-doc deconfliction: stale hang/`TeamsDebugPanel` warnings, role model, `gameOwnership.ts` invariant, docs-closeout rule, honest CSV wording, next-tasks reconciliation, doc-authority headers. ✅ Done (PR #357).
- **PLATFORM-069** — draft/win-totals alias-source bypass → resolved via `getScopedAliasMap` (P1; highest user impact). ✅ Done (PR #359): draft `pick`/`pick/[n]` and win-totals import now resolve through the shared scoped alias source (stored global > year > SEED) instead of local year+seed maps.
- **PLATFORM-070** — team-database write → canonical standings invalidation (P1). ✅ Done (PR #360): team-database syncs now bust a shared `standings:all` tag carried by every canonical snapshot (also wired the two global-alias paths through it), and the team catalog is read per-request (React `cache`) instead of a process-lifetime singleton so a sync on one instance is observed cross-instance. Next correctness task is **PLATFORM-071**.
- **PLATFORM-071** — invalidation sweep: cron season-rollover, season-transition, preseason-owner confirm (P2). ✅ Done (PR #361): `confirmPreseasonOwners`, `beginPreseason`, cron `season-rollover` (per rolled-over league), and cron `season-transition` (per transitioned league, bound to the status flip) now call `invalidateStandings`. Remaining un-wired mutators are intentional (`completeSetup` — no standings-content change; `slug='test'` dev tooling), recorded in the `leagueStandings.ts` docstring. Next correctness task is **PLATFORM-072**.
- **PLATFORM-072** — post-confirm draft edit ownership drift (P2). ✅ Done (PR #362): confirmation copies picks into the separate `owners:${slug}:${year}` CSV (consumed by `parseOwnersCsv` → `gameOwnership` → standings); a pick edit while the draft is `complete` now keeps that CSV in sync and invalidates standings. Implemented as a targeted patch (`patchConfirmedOwnersCsv`) that MOVES the pick's claim old-team→new-team rather than rebuilding from picks — preserving unrelated `/api/owners` admin repairs, carrying owner-name corrections (derives the owner from the persisted roster row, not the stale draft name), treating a `NoClaim` prior row as absent (fallback to the draft owner), and matching rows through the canonical `teamIdentity` resolver so a stored alias can't create a duplicate row. Next correctness task is **PLATFORM-073**.
- **PLATFORM-073** — postseason attachment edge cases (P2). ✅ Done (PR #363): (1) `buildScheduleIndex` now indexes by `providerGameId` independent of team hydration, so a placeholder bowl/CFP slot is attachable by id; (2) a null-`seasonType` score row is scored per phase and refuses to attach across a regular/postseason rematch unless a kickoff date uniquely separates the meetings; (3) the postseason week remap is gated on an explicit `hasRegularSeasonContext` so postseason-only input keeps provider weeks. Review also hardened score side-attribution: a provider-id match is accepted only when every KNOWN schedule side is confirmed in the row's corresponding position, and `attachScoresToSchedule` now stores scores in schedule orientation (honoring `match.orientation`), closing a pre-existing reversed-attribution/standings-corruption class. Next correctness task is **PLATFORM-074** (first item of the deferred batch below).

Remaining audit findings (deferred until the P1s above land; proposed IDs, not yet formal registry entries — enumerated so none is lost):

- **PLATFORM-074** — gate `/debug/*` pages via middleware; shared platform-admin predicate (V14, P2).
- **PLATFORM-075** — provider quota hardening: anon stale-serve for odds, CFBD quota guard on scores, season in the in-memory odds cache key, remove dead `dayKey` (V13/V10, P2). Needs a product call on public odds/scores fetch policy first.
- **PLATFORM-076** — debug-route canonical parity: effective aliases (`?scope=effective`), `manualOverrides`, `observedNames`, `providerWeek` in the postseason debug index (V9, P2).
- **PLATFORM-077** — Insights consume canonical games/lifecycle in-process (drop HTTP self-fetch + private schedule build) (V5, P2).
- **PLATFORM-078** — dead-code sweep: delete `src/lib/aliases.ts`, the orphan `teamNames.ts` helpers, and `AdminDebugSurface` + the unreachable `surface==='admin'` branch/test (P3).
- **PLATFORM-079** — Members owner options/selection + owner color palette off `canonicalStandings`; retire the client `deriveStandings` path in `CFBScheduleApp.tsx` that lives outside `src/lib/selectors/` (V11, P2).
- **Seed-key cleanup** (formerly the informal "PLATFORM-068" earmark; ID TBD) — delete redundant production `aliases:${slug}:${year}` seed-copy keys; consider retiring the legacy league-scope migration scan after a safety check.
- Deferred product decisions surfaced by the audit: CSV current-season guard vs sanctioned override; delete vs wire `AdminDebugSurface`; public odds/scores fetch policy; owner-identity mapping across seasons; whether to schedule PLATFORM-040.
- **`STANDINGS-PRESEASON-STATE` docs contradiction** (pre-existing; surfaced during DOCS-001B / PR #357, ID TBD) — the campaign/status table marks `STANDINGS-PRESEASON-STATE` complete, but active-priority prose still describes the cold-cache blank-standings issue as unresolved. Needs a separate verification pass to determine whether the code shipped and only the docs are stale, or whether a correctness task remains. Track only — do not resolve here.

Finally, **DOCS-002** (larger structural docs restructure) after the correctness work lands.

### 1. INSIGHTS-018 — NEW tag + signature system

Per-league global (not per-user) NEW-tag system for the insights panel. 48-hour active-season window, 7-day offseason window. Signature-based detection so that hook/owner/statValue changes register as a fresh insight while semantically identical re-renders do not.

- **Prompt ID to assign:** `INSIGHTS-018-NEW-TAG-v1`

### 2. INSIGHTS-019 — Diagnostic endpoint

Admin-gated `GET /api/debug/insights/[leagueSlug]` that returns: generator pool size, rendered set, suppressed set, per-insight signatures, and last-change timestamps. Enables at-a-glance verification of NEW tag behavior and suppression correctness without reading logs.

- **Prompt ID to assign:** `INSIGHTS-019-DIAGNOSTIC-v1`

### INSIGHTS-020-RECORD-CHANGE-v1

Surface recently changed records as insights. Wires up the dormant `RecordEntry.recentChange` field (declared in Phase 1, never populated). Pairs with INSIGHTS-018 (NEW tag) and INSIGHTS-019 (diagnostic endpoint) as part of the insights freshness campaign.

**Scope:**

- Snapshot store for prior `selectAllRecords` output (likely `appStateStore`)
- Diff trigger and cadence (per-week post-scoring, on-demand, or cron — design decision)
- TTL / "recent" window semantics
- New insight generator: `src/lib/insights/generators/recordChange.ts`
- Suppression rule integration with existing insight category logic
- NEW tag interaction: record changes are inherently "new since last visit" — should inherit INSIGHTS-018 wiring

**Dependencies:** INSIGHTS-018 (NEW tag) preferred to ship first so record-change insights inherit the freshness wiring.

**Estimated: 2–3 PROMPT_IDs end-to-end.**

### 3. APPSTATESTORE-CACHING — Egress optimization before August draft

Server-side caching for insights panel output (1-hour TTL) and archive reads (longer TTL). Single biggest egress-reduction lever available. Neon Launch tier provides 50 GB/month but active-season + draft-day traffic could push limits without caching. **Season-launch-blocking priority.**

- **Prompt ID to assign:** `APPSTATESTORE-CACHING-v1`

### 4. DRAFT — Slow Draft Mode

Enable async drafts with configurable per-pick windows. Requires email notification infrastructure (new). See `docs/roadmap.md` for full scope.

### 5. PLATFORM — Server Action Auth Hardening

Enforce commissioner role on all mutating server actions. Remove `ADMIN_API_TOKEN` fallback from public routes.

## Planned backlog (from INSIGHTS-017 campaign)

Items surfaced during the Insights Panel Redesign + Polish campaign and queued for future implementation:

- **INSIGHTS-017-PALETTE** — Category microlabel palette rationalization. Resolves HISTORICAL/STANDINGS/SEASON shared-purple and STATS/LEAGUE/fallback shared-slate token collisions. Includes micro-discovery on why SEASON labels render when no generator appears to set that category. Constrained by `DESIGN.md`'s strict ban on amber/green/red/blue hues for category use.
- **STANDINGS-PRESEASON-STATE** — Preseason content for the standings page. Three-state progression: offseason (prior season's final standings, ✓ built via STANDINGS-SUBHEADER-FIX), preseason (alphabetical owner list + "Season starts {date}" banner), active season (live data). Includes cold-cache safety net — currently in preseason with a cold cache the standings page renders silently blank. Requires a season-start-date field on league config.
- **APPSTATESTORE-CACHING** — See: Active priorities #3.
- **SERVER-FETCH-ARCHITECTURE** — Audit server-side routes that fetch their own API endpoints (e.g. `/league/[slug]/insights` fetching `/api/insights/...`) and evaluate whether they should instead call the underlying selector or data function directly. Current pattern requires URL construction via headers (`x-forwarded-host`, `x-forwarded-proto`), which surfaced a silent-failure bug during INSIGHTS-017 code review (`ALL-INSIGHTS-SCHEME-FIX`). Direct selector calls would eliminate the URL-construction class of bugs entirely and reduce latency. Priority: low — "when you have time" cleanup, not urgent. Scope: codebase audit first, then scoped fixes per route.
- **LINK-STYLING-AUDIT** — App-wide standardization of "view more" / "full view" / "see all" cross-links. Current split: blue `↗` on history/Overview column headers vs. muted `→` on Insights "See all". Convention chosen: muted text + horizontal arrow. Removes redundant blue accent on already-interactive links, aligns with `DESIGN.md`'s single-purpose use of blue for interactivity.
- **STANDINGS-PAGE-LIFECYCLE-LABELING** — Broader "Offseason" vs "{year} Season" label inconsistency audit across surfaces beyond the standings page. STANDINGS-SUBHEADER-FIX addressed the standings page itself; other surfaces may still show stale or contradictory year/lifecycle labels during offseason.
- **INSIGHTS-RANKER-TUNING** — Audit base priority weights across all 26 generators. Add sample-depth awareness (e.g. "perfect record at 6 games" should not rank as high as "perfect record at 20 games"). Foundation for eventually restoring row-1 prominence once the ranker earns it. Revisit when priority decay ships.

## Planned backlog (from Standings Ownership Redesign campaign)

Items surfaced during the Standings Ownership Model Redesign campaign and queued for future implementation:

- **INSIGHTS-LIFECYCLE-AWARENESS** — ✅ Resolved in Season Launch Hardening Phase 3 (`385a071`, `6358c2c`). Engine-level `shouldSuppressGenerator` suppresses `rookie_benchmark` during rollover; framing helpers (`applyLastSeasonFraming`, `applyReturningOwnerFraming`) reframe archived-roster output; zero-game guards added to `deriveLeagueInsights`, `deriveTightRaceInsight`, `deriveTightClusterInsight`.
- **POSTSEASON-START-WEEK-SCHEDULE-DERIVED** — `POSTSEASON_START_WEEK` is currently a hardcoded constant (`= 16`) with a rationale comment (Option B). Option A (derive from schedule data — the week of the earliest `seasonType === 'postseason'` game) is the correct long-term solution. Deferred because the constant works for current seasons; revisit before any season with an unusual CFP bracket structure.
- **INVALIDATE-STANDINGS-PER-LEAGUE** — `invalidateStandings` enumerates all leagues when called for global/year-scope mutations (e.g., global or year alias writes that apply across leagues). Documented limitation in the `invalidateStandings` JSDoc. Note: the original "per-league alias scope would allow targeted invalidation" premise is now moot — **PLATFORM-067 removed league-scoped aliases from runtime resolution** (team aliases are not league-specific). Alias writes are inherently global/year, so the fan-out is correct by construction; any future targeting must be justified on different grounds (e.g., which leagues actually reference a changed alias), not per-league alias scope.
- **HEADER-ARCHITECTURE-UNIFICATION** — `LeaguePageShell` and `CFBScheduleApp` render independent header regions; they should share a single `LeagueHeader` component. Flagged during LEAGUE-HEADER-USER-MENU work but out of scope for this campaign. Separate Polish prompt when header structure stabilizes.

## Planned backlog (from PRE-LAUNCH-TIDYUP)

Items surfaced when the `npm test` script was added in PRE-LAUNCH-TIDYUP (PR #306, commit `1d1b451`). The PRE-LAUNCH-TIDYUP campaign itself shipped: `npm test` script added, `papaparse` removed, doc drift fixes for cron schedule and custom domain redirect landed, ADMIN_API_TOKEN sunset timeline documented. The test-baseline cleanup surfaced by the new test script is now **complete** (retained below as a shipped record):

- **TEST-SUITE-BASELINE-CLEANUP** — _✅ Done (arc complete; see final line of this item)._ Two prerequisite prompts landed: `TEST-SUITE-HANG-BASELINE-FIX` (PR #324, commit `dcdadd4`) added `--test-timeout=30000` so `npm test` terminates instead of hanging, and `PLATFORM-001-TEST-BASELINE-CLEANUP-v1` (commit `711a032`) eliminated both cancelled (timed-out) files and the stale-markup / postseason-week-remapping failures. Full suite now: **0 cancelled, ~895/911 pass** (was 818/854 + 34 fail + 2 cancelled — note the earlier "71/679" figure predated several campaigns and the test count has since grown).
  - ✅ Done: stale HTML/DOM expectations updated (OverviewPanel, TrendsDetailSurface, MatchupsWeekPanel, MatchupMatrixView, StandingsPanel, RankingsPageContent, WeekViewTabs, GameWeekPanel) and architecture-adjacent lib tests (teamIdentity, schedule-eligibility) made guardrail-aware — all confirmed stale tests, no product bugs.
  - ✅ Done: **`PLATFORM-002-TEST-ROUTER-CLERK-CONTEXT-v1`** — the 12 `CFBScheduleApp.test.tsx` failures fixed via a shared `renderWithAppContext()` helper (App Router + Clerk context stubs) and `tsconfig.test.json` (`jsx: "react-jsx"`, wired via `TSX_TSCONFIG_PATH`) so the test transform matches production's automatic JSX runtime. Full suite now **907/911, 0 cancelled**.
  - ✅ Done: **`PLATFORM-004-TEST-TSC-FIXTURE-CLEANUP-v1`** — added `inferredSeasonStart: null` to 4 `CanonicalStandings` test fixtures; `npx tsc --noEmit` is clean again (was 4 TS2741 errors carried in from the PLATFORM-001 markup work).
  - ✅ Done: **`PLATFORM-003-TEST-APPSTATE-ISOLATION-v1`** — the file-fallback appState store now uses a pid-keyed temp path under `APP_STATE_TEST_ISOLATION=1` (set by the `test` script), so parallel test processes no longer race on a shared `data/app-state.json`. Verified stable across 5 consecutive full runs.
  - ✅ **Arc complete.** `npm test` is now **deterministic: 911/911, 0 fail, 0 cancelled** (5/5 runs); `npx tsc --noEmit`, `npm run lint:all`, and `npm run build` all green. The suite is a meaningful CI signal.
  - **Prompt IDs:** `TEST-SUITE-HANG-BASELINE-FIX` (done), `PLATFORM-001-TEST-BASELINE-CLEANUP-v1` (done), `PLATFORM-002-TEST-ROUTER-CLERK-CONTEXT-v1` (done), `PLATFORM-004-TEST-TSC-FIXTURE-CLEANUP-v1` (done), `PLATFORM-003-TEST-APPSTATE-ISOLATION-v1` (done).

## Planned backlog (from HISTORY-RECORDS campaign)

Items surfaced during the HISTORY-RECORDS Phase 2 Overview revision and queued for Phase 3:

- **RECORDS-SCORING** — Auto-score the records surfaced in the History Overview Records column. Today, `selectMarqueeRecords` (in `src/lib/selectors/historyOverview.ts`) picks 5 records via an implicit rule (one from each of `career` / `season` / `rivalry` / `event`, then one extra by category-priority order). The rule is editorial-by-default and undiscoverable; as new records get added to `selectAllRecords()` the marquee will drift away from "the most narratively interesting records the league has." Replace the implicit rule with an auto-computed score on each `RecordEntry`, mirroring the Insights ranker pattern. Score weights to consider: recency of when the record was set or last changed hands, magnitude of the leader's gap-to-second, volatility (how often the record changes hands across archived seasons), whether the holder changed in the most recent season. Implementation hint: extend `RecordEntry` with a computed `score` (or equivalent) field populated inside `selectAllRecords`; reduce `selectMarqueeRecords` to a sort-by-score-desc + slice. The Records column then renders the top N with no manual curation. Trigger to prioritize: HISTORY-RECORDS Phase 3, alongside the Stats / Rivalries / Archive subtab content wiring.
  - **Prompt ID to assign:** `RECORDS-SCORING-v1`

- **SPARSE-DATA-LAYOUT** — The History Overview dashboard restructure (P7-HISTORY-RECORDS-PHASE-2-VISUAL-REFINEMENT-v1) achieves visual balance under the assumption that each section fills its column. In current TSC data (6 seasons), some sections render with fewer rows than their peers — Title droughts shows 4 rows vs Top rivalries' 5; Recent podiums shows only the 3 most recent seasons regardless of league age. The page accommodates this via whitespace, but at very sparse data states (a brand-new league with 1–2 seasons, for example) the imbalance becomes more visible. Goal: evaluate whether sections should respond to their own data density — narrowing column width when sparse, or stacking with peer sections in a different layout — vs accepting the imbalance as the cost of designing for the eventual fully-populated state. Implementation hint: this is primarily a layout discipline decision rather than a selector change; the data shape already reflects density via row counts. Possible directions: per-section `lg:col-span-*` adjustments based on row count, a row-count-aware grid utility, or an explicit "compact" rendering mode for sections at certain thresholds. Trigger to prioritize: when a new league is created and onboarded with very few seasons of data, or when the existing layout proves uncomfortable at any point in the league's growth arc.
  - **Prompt ID to assign:** `SPARSE-DATA-LAYOUT-v1`

- **INSIGHT-ROUTING-PHASE-3-RETARGET** — Re-point insight deep links from Overview anchors to the Stats and Rivalries subtabs once Phase 3 ships their content. `resolveHistoryHref` (in `src/components/OverviewPanel.tsx`) currently routes drought → `/history#dynasty-drought`, dynasty → `/history#championships`, and rivalry types (`perfect_against`, `lopsided_rivalry`, `even_rivalry`, `dominance_streak`) → `/history#rivalries`. These were reverted from the Phase 2 subtab routes (`/history/stats`, `/history/rivalries`) because those subtabs render "Coming in Phase 3" placeholders today and create dead-end navigation. Trigger to prioritize: alongside Phase 3's Stats/Rivalries subtab content wiring; update both the routing and the matching `insightHref-history-routing.test.tsx` assertions.
  - **Prompt ID to assign:** `INSIGHT-ROUTING-PHASE-3-RETARGET-v1`

- **HISTORY-DYNAMIC-TILING** — The History Overview currently uses a stacked dashboard layout with vertical scroll. During Phase 2, repeated visual iteration surfaced that History's content is structurally sparser than main Overview's, leading to whitespace problems that were ultimately addressed with an `mx-auto max-w-7xl` cap (commit `3e1a977`). An alternative design direction was explored conversationally but deferred: dynamic tiling, where sections rearrange into a packed grid that fills available 2D space rather than stacking vertically. Goal: explore whether History (and possibly other sparse-content pages) should use a dashboard tiling layout instead of vertical stacking. Sections become tiles that pack into available width, eliminating vertical whitespace by using horizontal space efficiently. Reference Pinterest / Trello / Notion as precedent patterns. Implementation hint: evaluate CSS Grid `auto-flow: dense` vs JS-based packing libraries (e.g. Muuri, react-grid-layout) vs hand-tuned per-breakpoint grid placements. Each has tradeoffs around predictability, complexity, and dependency cost. Why it was deferred: committing to tiling would mean re-thinking the page's section composition, visual hierarchy, and breakpoint behavior from scratch. Phase 2 was already a long iteration cycle and shipping a polished stacked-with-cap layout was the higher-priority action; revisit when the campaign has space for fresh design exploration. Trigger to prioritize: if living with the stacked-and-capped History page reveals that its layout still feels structurally wrong, OR when other sparse-content pages (e.g., a future Stats subtab) face the same whitespace problems and a unified solution becomes valuable.
  - **Prompt ID to assign:** `HISTORY-DYNAMIC-TILING-v1`

## Completed campaigns (summary)

All foundational work is complete. See `docs/completed-work.md` for full records:

- Architecture Stabilization
- Production Hardening
- League UX / Engagement + Visual Redesign + Trends
- Multi-League Support (PRs #192–#196)
- Historical Analytics (all subphases)
- Draft Tool (P5A–P5D, PR #214)
- Admin Cleanup and Auth (P6A–P6E)
- Product Design Audit (7A–7F)
- Commissioner Self-Service (PRs #252–#256)
- Season Lifecycle (P7B-4 through P7B-7)
- Season Transition + Dry Run Polish
- Launch Prep (Turf War naming, Clerk production, custom domain)
- Game Stats Pipeline (PRs #274–#275)
- Insights Engine Foundation (PR #276): generator interface, types, engine, naming conflict resolved
- Insights Engine — Generators and Wiring (PR #278): historical + rivalry generators, lifecycle derivation, context assembler, API route, tie suppression, active-owner filtering
- Season Rollover UI and Cron (PR #278): two-phase admin panel + daily cron at championship + 7 days
- History Page Polish (PR #278): all-time standings sort order, former-owner visual distinction
- Insights Engine — Context Extension (INSIGHTS-014): `pointsAgainst` + `OwnerCareerStats` type + `buildOwnerCareerStats()` + career diagnostic route
- Insights Engine — Generator Batch 2 (INSIGHTS-015): 16 generators across career.ts, stats.ts, milestones.ts; tone property; InsightWindow type; UTF-8 + trending direction bug fixes
- Copy Variation Architecture (INSIGHTS-016): newsHook + statValue on all generators; per-league/season suppression gate; async engine; 2–5 templates per insight type; rollover clear gated per league
- Admin/Debug API Auth Gates (PLATFORM-020-ADMIN-DEBUG-API-GATES-v1): added `requireAdminAuth(req)` (before any fetch/work) to 11 ungated `/api/admin/*` + `/api/debug/*` GET routes exposing diagnostics / storage / API-usage state or quota-bearing internal fetches; admin-only client callers now send the admin token and the public app no longer fetches `admin/odds-usage` (now admin-only)
- Attachment Regression Tests First (PLATFORM-030-ATTACHMENT-REGRESSION-TESTS-v1): test-only coverage locking schedule-canonical score/odds attachment + eligibility before the odds-matching fix. Documents the current pair-only odds misattach risk (same-pair rematch fan-out, duplicate provider events) with passing "current behavior" tests plus `test.skip` intended-invariant tests that **require PLATFORM-031-EVENT-DATE-AWARE-ATTACHMENT-v1** (event-centric/date-aware odds attachment). **PLATFORM-031-EVENT-DATE-AWARE-ATTACHMENT-v1 is the follow-up** that must make odds attachment event/date-aware and flip those skipped tests green.
- Insights Canonical Standings Inputs (PLATFORM-053-INSIGHTS-CANONICAL-STANDINGS-INPUTS-v1): _Done._ `loadInsightsForLeague` now sources standings rows/history from `getCanonicalStandings` instead of an Insights-local `deriveStandings`/`deriveStandingsHistory` re-derivation (removed, along with the score fetch that only fed it); canonical authoritative even when empty/null. games/roster/rankings/lifecycle/suppression preserved. 3 Codex findings shipped as-is (all consequences of aligning Insights to canonical — the goal): canonical uses cache-only scores + league-only aliases + CSV-derived owners, same as Standings/Overview. **Deferred (canonical-layer, all-surfaces):** **PLATFORM-054-CANONICAL-SCORE-CACHE-WARMING** (candidate), **PLATFORM-055-CANONICAL-GLOBAL-ALIAS-MERGE** (candidate; the long-deferred alias-scope consolidation), **PLATFORM-056-INSIGHTS-CANONICAL-OWNER-SOURCING** (candidate; owners still CSV-derived). Plus prior deferrals unchanged (PLATFORM-052 podium badge, PLATFORM-045 route-loader dedup).
- Overview LiveDelta Overlay (PLATFORM-051-OVERVIEW-LIVEDELTA-OVERLAY-v1): _Done._ Overview Top-N standings rows now show the Standings/Members-compatible pending W–L badge (`+1–0`, title `Live this week: 1–0`, `data-overview-live-pending`) via the shared `selectFreshOwnerPendingDelta`; Overview previously `void`ed `liveDelta`. Presentation-only — no projected values, no re-sort; canonical rows/history/coverage (PLATFORM-047/048) untouched; stale/missing/tied/NoClaim/absent → no badge. Existing `{n} live` pill unchanged; podium/hero unbadged this phase. (Audit: PLATFORM-050.) Deferred: **PLATFORM-052** podium/hero live badge (candidate); `liveCountByOwner` staleness alignment (candidate); **PLATFORM-045** route-loader dedup.
- Standings Coverage Canonical Contract (PLATFORM-049-STANDINGS-COVERAGE-CANONICAL-CONTRACT-v1): _Done._ Standings rows, history, and coverage now all come from the same canonical snapshot when supplied, via the new Standings-specific pure `resolveStandingsCanonicalInputs` (local fallback only when no snapshot; missing/null canonical coverage → conservative `{state:'error', message:'Standings coverage is unavailable.'}`, never local). Not reusing `resolveOverviewCanonicalInputs` (surfaces decoupled). Coverage affects only the top warning paragraph/error styling — never row selection/sorting/movement/history/NoClaim/liveDelta badges; canonical rows never mutated; no `CFBScheduleApp` wiring change. Deferred: **PLATFORM-045** (route-loader dedup); candidate Overview liveDelta overlay.
- Members Header Live Overlay (PLATFORM-046-MEMBER-HEADER-LIVE-OVERLAY-v1): _Done._ Members owner header now shows a Standings-compatible `liveDelta` pending W–L badge beside the Record (`+1–0`, title `Live this week: 1–0`) via the new shared pure `selectFreshOwnerPendingDelta` (stale suppression + owner lookup + NoClaim exclusion + nonzero-decision check). Standings reuses the same helper (behavior-neutral). The badge never changes the canonical header baseline (rank/record/win%/differential), is gated by `snapshot.header?.owner` (null header not resurrected), computes no projected standings, and uses no `router.refresh`. Deferred: **PLATFORM-045** (route-loader dedup); candidates — Overview liveDelta overlay, Standings-surface canonical coverage.
- Overview Coverage Canonical Contract (PLATFORM-048-OVERVIEW-COVERAGE-CANONICAL-CONTRACT-v1): _Done._ Overview coverage is now canonical-preferred: `resolveOverviewCanonicalInputs` resolves coverage from the canonical snapshot when supplied (local coverage only when no snapshot; missing/null canonical coverage → conservative `{state:'error', message:'Standings coverage is unavailable.'}`, never local). `CFBScheduleApp` resolves rows/history/coverage once and feeds resolved coverage to `deriveOverviewSnapshot`; `OverviewPanel` resolves identically for the selector + visible warning. Rows/history/NoClaim from PLATFORM-047 preserved; liveDelta still not merged; no UI rewrite; builders already populate coverage (now pinned). Remaining Overview follow-up: **liveDelta overlay on Overview** (candidate). Other deferrals unchanged (PLATFORM-046 Members live overlay, PLATFORM-045 route-loader dedup; candidate Standings-surface canonical coverage).
- Overview Canonical Contract Characterization (PLATFORM-047-OVERVIEW-CANONICAL-CONTRACT-CHARACTERIZATION-v1): _Done._ Test-first pinning of the Overview source-of-truth boundary via the extracted pure `resolveOverviewCanonicalInputs` (behavior-neutral). **Canonical**: rows (canonical when supplied, empty stays empty, omit doesn't resurrect local) and history (canonical when supplied, null stays null); local only when no snapshot. **Client/schedule-derived**: coverage (canonical coverage NOT consumed), selected games; liveDelta not merged into Overview rows this phase; NoClaim excluded. No Overview rewrite/UI change. Characterization shows the remaining gap is coverage → next implementation prompt **PLATFORM-048-OVERVIEW-COVERAGE-CANONICAL-CONTRACT-v1**. Other deferrals unchanged (PLATFORM-046 Members live overlay, PLATFORM-045 route-loader dedup, Overview liveDelta overlay).
- Canonical Member Records (PLATFORM-044-CANONICAL-MEMBER-RECORDS-v1): _Done._ Members owner header (rank/record/win%/point differential) now uses canonical standings rows via `deriveOwnerViewSnapshot`'s `canonicalStandingsRows`. Canonical is authoritative when supplied — an empty or owner-omitting canonical snapshot yields the canonical result (header `null`), never a local fallback (Codex P1 adopted, overriding the prompt's "empty → local" wording); local rows are used only when no canonical snapshot is supplied (Trends/History). Owner options/selection/roster/game details remain schedule/client-derived (PLATFORM-039 intact); NoClaim excluded. A second Codex P1 (canonical header not live-refreshed after score hydration) was reviewed and deferred — it's a pre-existing static-canonical property Standings shares, and Codex's `router.refresh` fix was declined as the wrong mechanism; applying the `liveDelta` overlay to the owner header is a UI-additive follow-up. **Deferred:** Overview canonical contract characterization (next reviewed item); `PLATFORM-046-MEMBER-HEADER-LIVE-OVERLAY-v1` (liveDelta overlay on the Members owner header); optional route-loader dedup (`PLATFORM-045-LEAGUE-ROUTE-CANONICAL-LOADER-DEDUP-v1`).
- Schedule Route Canonical Inputs (PLATFORM-043-SCHEDULE-ROUTE-CANONICAL-INPUTS-v1): _Done._ `/league/[slug]/schedule` now loads and passes the same canonical standings/status/archive inputs as the root league route (`getCanonicalStandings` + `leagueStatus` default + `mostRecentArchivedYear`), so direct entry through Schedule is a route-specific entry into the same canonical app state instead of a lighter fallback-only entry. Component fallbacks remain intentionally in place; no `WeekViewTabs`/UI/`CFBScheduleApp` changes. **Deferred:** an optional shared canonical-loader dedup across root/standings/schedule (`PLATFORM-045-LEAGUE-ROUTE-CANONICAL-LOADER-DEDUP-v1`). Next reviewed item: Members canonical records.
- League Season Resolution (PLATFORM-042-LEAGUE-SEASON-RESOLUTION-v1): _Done._ `CFBScheduleApp` client schedule/scores/aliases/rankings/insights/storage now use the league-resolved season via pure `resolveLeagueSeason` (`src/lib/leagueSeason.ts`; precedence `leagueStatus.year` → `leagueYear` → `DEFAULT_SEASON`) instead of falling back to global `DEFAULT_SEASON` for active-season/offseason leagues. `selectedSeason` is the single feed for season-sensitive client ops; `draftLookupYear` now reuses it. No canonical standings/schedule/attachment/ownership/FBS-FCS/CSV/auth/UI changes. Next: schedule route canonical inputs → **PLATFORM-043-SCHEDULE-ROUTE-CANONICAL-INPUTS-v1**.
- Canonical Game Ownership Lookup (PLATFORM-039-CANONICAL-GAME-OWNERSHIP-LOOKUP-v1): _Done._ Current-season ownership lookup now uses centralized resolver-free game ownership candidates (`src/lib/gameOwnership.ts`: participant teamId → canonical/display/raw → `canHome/away` → `csvHome/away` legacy fallback) instead of raw provider-name equality, adopted in standings, liveDelta, matchups, gameWeek, ownerView, gameTags, and Overview `liveCountByOwner`. Stored/canonical assignments now resolve even when provider labels differ ("Wash St" vs "Washington State"); provider-facing display labels preserved. Does **not** preserve/expand CSV-upload architecture. **Deferred:** normalized ownership-key indexes (roster labels that are themselves non-canonical aliases, e.g. stored `"wash st"`) → **PLATFORM-040-OWNERSHIP-KEY-NORMALIZATION-v1**; historical/archive ownership cleanup (`insights/*`, `historySelectors`, `leagueRecords`); historical CSV-upload / league-history behavior; alias-scope precedence consolidation; canonical standings/overview/matchup migration.
- FBS/FCS Matchup Selector Classification (PLATFORM-036-FBS-FCS-MATCHUP-SELECTOR-CLASSIFICATION-v1): _Done._ Matchup selector/display FCS classification now uses shared conference subdivision policy (`isPolicyFcsConference`, backed by `resolvePresentDayConferencePolicy`) instead of local `/\bfcs\b/i` regexes, so real FCS conferences (Big Sky, MVFC, Patriot, SWAC, …) are classified correctly and render `FCS` rather than `NoClaim (FBS)`; FCS participants cannot create owner matchups. The helper is pure (no mutable CFBD-record dependency). Unknown/OTHER behavior preserved; FBS×FCS inclusion and FCS×FCS exclusion remain upstream in schedule eligibility. Canonical ownership/alias cleanup (the direct `rosterByTeam.get(game.csvHome/csvAway)` lookup) **remains deferred** → next likely task **PLATFORM-039-CANONICAL-GAME-OWNERSHIP-LOOKUP-v1**.
- Spectator Draft Board Canonical Alias Loading (PLATFORM-035-DRAFT-BOARD-CANONICAL-ALIAS-LOADING-v1): _Done._ Spectator draft board alias loading now uses server-safe alias sources — replaced the browser-era `loadAliasMap` (which fetched a relative `/data/team-aliases.json` and failed silently during server render, emptying schedule-derived insights) with `getScopedAliasMap(slug, year)` on the canonical global alias store, walking `aliases:global` + deprecated league/year scopes at precedence **global > league+year > year**. Schedule loading extracted to `board/boardData.ts` so an absent alias map no longer masquerades as "schedule not cached." Broader alias scope/cache **precedence consolidation remains deferred** (the duplicate scope-walk loaders elsewhere are untouched). Next likely task: **PLATFORM-036-FBS-FCS-MATCHUP-SELECTOR-CLASSIFICATION-v1**.
- Event/Date-Aware Odds Attachment (PLATFORM-031-EVENT-DATE-AWARE-ATTACHMENT-v1): _Done._ Rewrote `attachOddsEventsToSchedule` to be event-centric and date-aware — resolves the pair via `teamIdentity`, narrows same-pair candidates by `commenceTime` (±24h), attaches only on a unique match, and enforces one-to-one (no fan-out, no duplicate overwrite) with `unmatched_pair`/`ambiguous_pair`/`date_mismatch`/`consumed_or_duplicate` diagnostics. `commence_time` now flows through `normalizeUpstreamOddsEvent` (moved to `routeInternals.ts`) as `commenceTime`. The 3 PLATFORM-030 contracts now run green. PLATFORM-020 quota/cache guards and score attachment unchanged.
- Draft Confirm Eligibility Fix (DRAFT-010-CONFIRM-ELIGIBILITY-v1): centralized draft-eligible-team definition (`getDraftEligibleTeams` in `src/lib/draft.ts`, excludes the `NoClaim` placeholder) and routed setup/update/auto-pick/pick/confirm through it; fixes confirmation rejecting complete drafts because it counted teams via a `classification` field absent from `teams.json`
- Insights Panel UI Redesign + Polish (INSIGHTS-017 + polish passes + STANDINGS-SUBHEADER-FIX): 5-insight panel with category microlabels, tappable rows, first-row prominence (flattened pending ranker), "See all →" link; HISTORICAL/RIVALRY deep-link arrows via panel-layer resolver; three history-page section anchors; light-mode banner fix across all five CFBScheduleApp banner variants; `champion_margin` / `failed_chase` rerouted to `/history/{year}`; `leagueStatus` plumbed to standings page with offseason "{year} Final Standings" subheader via archive-resolved year; arrow contrast tuned to WCAG 3:1; subheader plumbing extended to main league page so the branch fires on the primary WeekViewTabs flow
- Standings Ownership Model Redesign (Phases 0–5): 6-phase architectural redesign eliminating merge-at-render-time standings derivation. Server canonical (`getCanonicalStandings`) owns rows/history/colorOrder; client `liveDelta` owns live overlays as distinct props. Tag-based invalidation (`invalidateStandings`) wired into all mutation routes. NoClaim filtering moved to source. `currentDate` parameterized. Phases 0–5 all shipped.

## Hosted deployment runbook

- Use `docs/deployment-runbook.md` for the operator checklist during the real Vercel + Postgres setup and first hosted preview validation.

## Out of scope for this queue

- New matching systems or changes to schedule-first identity rules.
- Heavy infrastructure beyond one small managed database plus the hosted app.
- Broad analytics/history work before hosted stability is complete.

## Non-blocking maintenance

- Revisit TypeScript import/test-runner cleanup separately from active campaign work.
- Keep optional decomposition of `CFBScheduleApp.tsx` and `scoreAttachment.ts` as non-blocking technical debt unless explicitly scheduled.

# Prompt Registry

Purpose:

- track important prompts
- provide reusable references
- document prompt evolution

The registry should remain:

- concise
- high-signal
- manually maintained

---

## Active Prompts

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

## Prompt Template

### <PHASE>-<AREA>-<SHORT_NAME>-v<version>
- Purpose: [one sentence]
- Scope: [files or modules affected]
- Notes: [optional — branch, PR refs, follow-up items, superseded IDs]

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
| Polish              | Aliases Platform Migration                                                              | Planned     |
| Polish              | History Page — Filter Former Owners                                                     | Planned     |
| Polish              | Test Suite Baseline Cleanup (TEST-SUITE-BASELINE-CLEANUP)                               | Planned     |

## Active priorities

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
- **INVALIDATE-STANDINGS-PER-LEAGUE** — `invalidateStandings` currently enumerates all leagues when called for global-scope mutations (e.g., alias writes that apply across leagues). Documented limitation in the `invalidateStandings` JSDoc. A per-league alias scope would allow more targeted invalidation. Prerequisite: alias per-league scoping work (tracked separately under Aliases Platform Migration).
- **HEADER-ARCHITECTURE-UNIFICATION** — `LeaguePageShell` and `CFBScheduleApp` render independent header regions; they should share a single `LeagueHeader` component. Flagged during LEAGUE-HEADER-USER-MENU work but out of scope for this campaign. Separate Polish prompt when header structure stabilizes.

## Planned backlog (from PRE-LAUNCH-TIDYUP)

Items surfaced when the `npm test` script was added in PRE-LAUNCH-TIDYUP (PR #306, commit `1d1b451`). The PRE-LAUNCH-TIDYUP campaign itself shipped: `npm test` script added, `papaparse` removed, doc drift fixes for cron schedule and custom domain redirect landed, ADMIN_API_TOKEN sunset timeline documented. Residual backlog below — the test-baseline cleanup is the unfinished work surfaced by the new test script:

- **TEST-SUITE-BASELINE-CLEANUP** — _Largely shipped._ Two prerequisite prompts landed: `TEST-SUITE-HANG-BASELINE-FIX` (PR #324, commit `dcdadd4`) added `--test-timeout=30000` so `npm test` terminates instead of hanging, and `PLATFORM-001-TEST-BASELINE-CLEANUP-v1` (commit `711a032`) eliminated both cancelled (timed-out) files and the stale-markup / postseason-week-remapping failures. Full suite now: **0 cancelled, ~895/911 pass** (was 818/854 + 34 fail + 2 cancelled — note the earlier "71/679" figure predated several campaigns and the test count has since grown).
  - ✅ Done: stale HTML/DOM expectations updated (OverviewPanel, TrendsDetailSurface, MatchupsWeekPanel, MatchupMatrixView, StandingsPanel, RankingsPageContent, WeekViewTabs, GameWeekPanel) and architecture-adjacent lib tests (teamIdentity, schedule-eligibility) made guardrail-aware — all confirmed stale tests, no product bugs.
  - ▶ Remaining (tracked as follow-ups): **`PLATFORM-002-TEST-ROUTER-CLERK-CONTEXT-v1`** — 12 `CFBScheduleApp.test.tsx` failures need a Next.js App Router context (`useRouter` invariant) plus a Clerk `useUser` wrapper/mock (shared `renderWithAppContext()` util). **`PLATFORM-003-TEST-APPSTATE-ISOLATION-v1`** — `route-timer` + `selectors-leagueStandings` pass in isolation but flake under parallel processes via the shared file-based appState store; give each process an isolated store path or run serially.
  - Goal once both follow-ups land: single-digit failures and a deterministic CI signal.
  - **Prompt IDs:** `TEST-SUITE-HANG-BASELINE-FIX` (done), `PLATFORM-001-TEST-BASELINE-CLEANUP-v1` (done), `PLATFORM-002-TEST-ROUTER-CLERK-CONTEXT-v1` + `PLATFORM-003-TEST-APPSTATE-ISOLATION-v1` (planned).

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

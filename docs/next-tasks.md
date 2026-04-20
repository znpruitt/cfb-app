# Next Tasks (Active Queue)

## Purpose / How to use this document

- This file is the **active execution queue** for current campaigns.
- Keep tasks small and scoped to a **single implementation PR** where practical.
- Move completed work summaries to `docs/completed-work.md`.
- Keep broader context and later-phase ideas in `docs/roadmap.md`.
- Reference implementation prompts by explicit `PROMPT_ID` and follow the header convention documented in `docs/prompt-registry.md`.

## Campaign status

All foundational phases are complete. Work is now organized into named workstream campaigns.

| Workstream | Campaign | Status |
|------------|----------|--------|
| Data & Intelligence | Game Stats Pipeline | ✅ Complete |
| Data & Intelligence | Insights Engine Foundation | ✅ Complete |
| Data & Intelligence | Insights Engine — Generators and Wiring | ✅ Complete |
| Data & Intelligence | Insights Engine — Context Extension | ✅ Complete |
| Data & Intelligence | Insights Engine — Generator Batch 2 | ✅ Complete |
| Data & Intelligence | Copy Variation Architecture | ✅ Complete |
| Data & Intelligence | Insights Panel UI Redesign + Polish | ✅ Complete |
| Data & Intelligence | Insights Engine — Weekly In-Season Pulses (INSIGHTS-018) | Planned |
| Data & Intelligence | Insights Diagnostic Endpoint (INSIGHTS-019) | Planned |
| Data & Intelligence | Insights Panel — Microlabel Palette (INSIGHTS-017-PALETTE) | Planned |
| Data & Intelligence | Insights Ranker — Priority Tuning (INSIGHTS-RANKER-TUNING) | Planned |
| Data & Intelligence | Insights — All Insights Page (ALL-INSIGHTS-PAGE) | Planned |
| Data & Intelligence | Pairing Cards | Planned |
| Data & Intelligence | Luck Score + Bounce-Back Generators | Planned |
| Platform | Season Rollover UI and Cron | ✅ Complete |
| Platform | AppStateStore Caching — Egress Optimization (APPSTATESTORE-CACHING) | Planned |
| Platform | Server Fetch Architecture Audit (SERVER-FETCH-ARCHITECTURE) | Planned |
| Polish | History Page Polish | ✅ Complete |
| Polish | History Rework — Career Stats Surface (HISTORY-REWORK) | Planned |
| Polish | Standings Page — Preseason State (STANDINGS-PRESEASON-STATE) | Planned |
| Polish | Standings Page — Lifecycle Labeling Sweep (STANDINGS-PAGE-LIFECYCLE-LABELING) | Planned |
| Polish | Link Styling Audit (LINK-STYLING-AUDIT) | Planned |
| Draft | Slow Draft Mode | Planned |
| Draft | Draft Difficulty Settings | Planned |
| Platform | Multi-tenant Commissioner Sign-up | Planned |
| Platform | Server Action Auth Hardening | Planned |
| Polish | Design Audit (remaining pages) | Planned |
| Polish | Copy / UX Writing Audit | Planned |
| Polish | Back Button Audit | Planned |
| Polish | Aliases Platform Migration | Planned |
| Polish | History Page — Filter Former Owners | Planned |

## Active priorities

### 1. INSIGHTS-018 — NEW tag + signature system

Per-league global (not per-user) NEW-tag system for the insights panel. 48-hour active-season window, 7-day offseason window. Signature-based detection so that hook/owner/statValue changes register as a fresh insight while semantically identical re-renders do not.

- **Prompt ID to assign:** `INSIGHTS-018-NEW-TAG-v1`

### 2. INSIGHTS-019 — Diagnostic endpoint

Admin-gated `GET /api/debug/insights/[leagueSlug]` that returns: generator pool size, rendered set, suppressed set, per-insight signatures, and last-change timestamps. Enables at-a-glance verification of NEW tag behavior and suppression correctness without reading logs.

- **Prompt ID to assign:** `INSIGHTS-019-DIAGNOSTIC-v1`

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
- **HISTORY-REWORK** — History page polish and dedicated career stats surface. Unblocks Tier 2 insight routing (`career_points_leader`, `career_turnover_margin`, `milestone_watch-points` currently render without arrows). Also improves destinations for insights already routing to history.
- **STANDINGS-PRESEASON-STATE** — Preseason content for the standings page. Three-state progression: offseason (prior season's final standings, ✓ built via STANDINGS-SUBHEADER-FIX), preseason (alphabetical owner list + "Season starts {date}" banner), active season (live data). Includes cold-cache safety net — currently in preseason with a cold cache the standings page renders silently blank. Requires a season-start-date field on league config.
- **ALL-INSIGHTS-PAGE** — Build out `/league/[slug]/insights` to render the full insight pool. Page is scaffolded with `AllInsightsRow` plumbing but the parent page does not fetch and render insights. Currently shows "No insights available yet". The "See all →" link on Overview already points here.
- **APPSTATESTORE-CACHING** — Server-side caching for insights panel output (1-hour TTL) and archive reads (longer TTL). Single biggest egress-reduction lever. Target: before August draft. Launch tier 50 GB/month should hold but draft-day traffic could push limits without caching.
- **SERVER-FETCH-ARCHITECTURE** — Audit server-side routes that fetch their own API endpoints (e.g. `/league/[slug]/insights` fetching `/api/insights/...`) and evaluate whether they should instead call the underlying selector or data function directly. Current pattern requires URL construction via headers (`x-forwarded-host`, `x-forwarded-proto`), which surfaced a silent-failure bug during INSIGHTS-017 code review (`ALL-INSIGHTS-SCHEME-FIX`). Direct selector calls would eliminate the URL-construction class of bugs entirely and reduce latency. Priority: low — "when you have time" cleanup, not urgent. Scope: codebase audit first, then scoped fixes per route.
- **LINK-STYLING-AUDIT** — App-wide standardization of "view more" / "full view" / "see all" cross-links. Current split: blue `↗` on history/Overview column headers vs. muted `→` on Insights "See all". Convention chosen: muted text + horizontal arrow. Removes redundant blue accent on already-interactive links, aligns with `DESIGN.md`'s single-purpose use of blue for interactivity.
- **STANDINGS-PAGE-LIFECYCLE-LABELING** — Broader "Offseason" vs "{year} Season" label inconsistency audit across surfaces beyond the standings page. STANDINGS-SUBHEADER-FIX addressed the standings page itself; other surfaces may still show stale or contradictory year/lifecycle labels during offseason.
- **INSIGHTS-RANKER-TUNING** — Audit base priority weights across all 26 generators. Add sample-depth awareness (e.g. "perfect record at 6 games" should not rank as high as "perfect record at 20 games"). Foundation for eventually restoring row-1 prominence once the ranker earns it. Revisit when priority decay ships.

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

## Hosted deployment runbook

- Use `docs/deployment-runbook.md` for the operator checklist during the real Vercel + Postgres setup and first hosted preview validation.

## Out of scope for this queue

- New matching systems or changes to schedule-first identity rules.
- Heavy infrastructure beyond one small managed database plus the hosted app.
- Broad analytics/history work before hosted stability is complete.

## Non-blocking maintenance

- Revisit TypeScript import/test-runner cleanup separately from active campaign work.
- Keep optional decomposition of `CFBScheduleApp.tsx` and `scoreAttachment.ts` as non-blocking technical debt unless explicitly scheduled.

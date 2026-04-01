# Completed Work Log

## Purpose / How to use this document

- This file is an **append-only log** of completed phases and major milestones.
- Record **what was built and why it mattered** (outcomes), not a commit-by-commit changelog.
- This is **not** an active task list.
- Add future completed phases/milestones here instead of mixing history into `docs/next-tasks.md`.

## Completed phases / milestones

### Phase 3 — Multi-League Support

- **Status:** Complete. PRs #192–#196 merged.
- **PROMPT_IDs:** P3-MULTILEG-FOUNDATION-v1, P3-MULTILEG-FOUNDATION-REVIEW-v1, P3-MULTILEG-FOUNDATION-FIX-v1, P3-MULTILEG-FOUNDATION-FIX-VERIFY-v1, P3-MULTILEG-FOUNDATION-FIX-v2, P3-MULTILEG-ROUTING-v1, P3-MULTILEG-ROUTING-REVIEW-v1, P3-MULTILEG-ROUTING-FIX-v1, P3-MULTILEG-ROUTING-FIX-REVIEW-v1, P3-MULTILEG-WRITE-SCOPE-FIX-v1, P3-MULTILEG-WRITE-SCOPE-REVIEW-v1, P3-MULTILEG-ADMIN-UI-v1, P3-MULTILEG-ADMIN-UI-REVIEW-v1, P3-MULTILEG-ADMIN-UI-FIX-v1, P3-MULTILEG-ADMIN-UI-COPY-v1, P3-MULTILEG-FALLBACK-REMOVAL-v1, P3-MULTILEG-FALLBACK-REMOVAL-REVIEW-v1, P3-MULTILEG-FALLBACK-CLEANUP-v1, P3-MULTILEG-CLOSEOUT-v1
- **PRs merged:** #192 (foundation), #193 (routing), #194 (admin UI), #195 (admin UI copy polish), #196 (fallback removal + cleanup)
- **Goals completed:**
  - **League type and registry** (PR #192, P3-MULTILEG-FOUNDATION-v1): Defined `League` type (`slug`, `displayName`, `year`, `createdAt`). Implemented `leagueRegistry.ts` with `getLeagues`, `getLeague`, `addLeague`, `updateLeague`. Added admin API routes — `GET /api/admin/leagues` (public), `POST /api/admin/leagues` (admin-gated), `PATCH /api/admin/leagues/:slug` (admin-gated). Updated all three durable data routes (`/api/owners`, `/api/aliases`, `/api/postseason-overrides`) with league-scoped read/write and TRANSITION FALLBACK for migration.
  - **Foundation fixes** (PR #192, P3-MULTILEG-FOUNDATION-FIX-v1 + v2): Added duplicate guard to `addLeague()`. Made `GET /api/admin/leagues` public for server-side routing. Added PUT registry validation. Fixed malformed slug silent coercion bug. Fixed alias incremental merge inheritance bug by introducing `readAliasesScopedOnly`.
  - **League-scoped routing** (PR #193, P3-MULTILEG-ROUTING-v1 + fix): Created `/league/[slug]/` route hierarchy — `page.tsx` (overview), `standings/page.tsx`, `trends/page.tsx` (redirect to standings?view=trends), `rankings/page.tsx`. Converted all four root routes to registry-based redirects reading `getLeagues()` at request time. Threaded `leagueSlug` through full bootstrap chain: `CFBScheduleApp` → `useScheduleBootstrap` → `bootstrapAliasesAndCaches` → all three API client functions. Updated `OverviewPanel` and `RankingsPageContent` nav links for league-aware routing.
  - **Write-scope symmetry** (PR #193, P3-MULTILEG-WRITE-SCOPE-FIX-v1): All three save functions (`saveServerAliases`, `saveServerOwnersCsv`, `saveServerPostseasonOverrides`) updated to pass `leagueSlug` to API calls. Read/write now fully symmetric.
  - **Admin leagues UI** (PR #194–#195, P3-MULTILEG-ADMIN-UI-v1 + fixes): Created `src/app/admin/leagues/page.tsx` — league list, inline edit (displayName + year), create form with client-side slug validation, `AdminAuthPanel` reuse, plain-language copy. Added "League Management" navigation link to `AdminDebugSurface`.
  - **Fallback removal** (PR #196, P3-MULTILEG-FALLBACK-REMOVAL-v1): Removed TRANSITION FALLBACK from all three GET handlers after TSC league migration confirmed complete. Removed redundant `readAliasesScopedOnly` function (now identical to `readAliases` after fallback removal).
- **Key architectural decisions implemented:**
  - **Slugs are runtime data, not configuration** — no slug hardcoded in application code; all routing and storage keys derive from the registry at runtime.
  - **League-scoped storage key convention** — `${type}:${slug}:${year}` for owners, aliases, postseason-overrides; year-only path unchanged for callers without `?league=`.
  - **Registry-based dynamic redirects** — root routes read the registry at request time, redirect to the first league's slug; no hardcoded redirect target.
  - **Bootstrap call chain is league-aware end-to-end** — `leagueSlug` flows from route param through every layer to API calls.
  - **Read fallback introduced for migration, then removed** — TRANSITION FALLBACK enabled phased migration without downtime; removed after TSC league confirmed migrated to scoped keys.
  - **Phase 4 sequencing satisfied** — league slugs and registry in place; archive keys can be league-scoped from first write with no migration debt.
- **Optional follow-up (not scheduled):**
  - `/league/:slug/schedule` and `/league/:slug/matchups` as discrete routes (currently served via `?view=` query params on main page).
  - League deletion support (explicitly deferred at Phase 3 launch).

---

### Post-Phase 2D Corrections and Trend Enhancements

- **Status:** Complete. PRs #184–#188 merged on phase-3b-visual-sweep.
- **PROMPT_IDs:** P2C-STANDINGS-RULE-AND-DOCS-REALIGNMENT-v1, P2-OVR-TRENDS-POSTSEASON-v1, P2-OVR-TRENDS-POLISH-v1, P2-OVR-TRENDS-LABELS-v1
- **Goals completed:**
  - **Standings sort rule fix** (PR #184, P2C-STANDINGS-RULE-AND-DOCS-REALIGNMENT-v1): Corrected sort comparator from winPct-first to wins-first per league rules. Added three regression tests covering wins-beats-winPct, winPct tiebreaker, and point differential tiebreaker.
  - **Postseason week truncation fix** (PR #188, P2-OVR-TRENDS-POSTSEASON-v1): CFBD postseason API restarts week numbers from 1; `buildScheduleFromApi` now computes `postseasonCanonicalWeek = maxRegularSeasonWeek + providerWeek`, making postseason weeks 17+ and preventing Set deduplication from collapsing them into regular-season slots. `providerWeek` preserved for score attachment. `selectPositionDeltas` selector added to `trends.ts` — derives week-over-week standings position delta (positive = moved up) for last N resolved weeks. Replaced `RecentFormPanel` (W/L dots) in Overview with `PositionDeltaPanel` (rank change arrows).
  - **Chart dead space and week labels** (P2-OVR-TRENDS-POLISH-v1): Removed empty label lane from `MiniTrendsGrid` VIEWBOX when no annotations were present. Added `buildWeekLabelMap` / `formatWeekLabel` utilities in `src/lib/weekLabel.ts` — map postseason game stages to human-readable labels (CFP, Bowl, CCG) driven by actual schedule data; x-axis now shows meaningful postseason week labels instead of W17/W18.
  - **Endpoint annotations and color coordination** (P2-OVR-TRENDS-LABELS-v1): Restored 90-unit annotation lane in `MiniTrendsGrid` with owner name + GB endpoint labels (collision-detected). Exported `CONTENDER_COLORS` from `MiniTrendsGrid` for shared use. `PositionDeltaPanel` owner name `<span>`s colored to match their corresponding trend line using `CONTENDER_COLORS`.
- **Key outcomes:**
  - Standings sort now correctly ranks by wins (primary), then win percentage, then point differential — matching the stated league rules.
  - Trend charts display the full season arc including postseason weeks; no data truncation at week 16.
  - Overview Trends card shows position-change momentum alongside the title-race chart, with color continuity between panels.
  - Postseason x-axis labels (CFP, Bowl, CCG) replace meaningless W17/W18 labels throughout the chart.
- **Optional follow-up (not scheduled):**
  - Magic number / elimination tracker as a third panel candidate.

---

### Phase 2D — Overview Trends Visual Sweep

*Formerly labeled Phase 3B prior to phase numbering reconciliation (DOCS-PHASE-RECONCILIATION-v1).*

- **Status:** Complete. PRs #178–#183 merged.
- **PROMPT_IDs:** P2D-TRENDS-TITLE-CHASE-v1, P2D-TRENDS-FORM-DOTS-v1
- **Goals completed:**
  - Built `MiniTrendsGrid` component — compact SVG line chart embedded in Overview Trends card.
  - Iterated through viewBox letterboxing fix, inline end labels with push-down deconfliction, and bump chart (all 15 owners).
  - Pivoted to "title chase" framing: top-5-contenders Games Back chart, last 5 weeks, half-width layout, leader label clamp.
  - Added `selectGamesBackTrend`, `selectRankTrend` selectors to `src/lib/selectors/trends.ts`.
  - Added Games Back column to `CondensedStandingsTable` on the Overview standings card.
  - Added `selectRecentOutcomes` selector — derives per-week W/L from actual game scores (`games + scoresByKey + rosterByTeam`), not inferred cumulative diffs.
  - Built `RecentFormPanel` — green/red dot grid for last 5 game outcomes, all owners, sorted by current standings rank (superseded by `PositionDeltaPanel` in post-2D corrections).
  - Responsive layout — stacks vertically on mobile, side-by-side on `sm+`.
- **Key outcomes:**
  - Overview Trends card conveys the title race narrative at a glance without navigating to the full Trends page.
  - Form dots reflect verified final game scores, not standing estimates.
  - Chart and form panel are visually cohesive, compact, and work on mobile.
- **Optional follow-up (not scheduled):**
  - Further form dot polish (sizing, legend, win-streak callout).
  - Magic number / elimination tracker as a third panel candidate.

---

### Phase 2C — Overview Visual Redesign

*Formerly labeled Phase 3A prior to phase numbering reconciliation (DOCS-PHASE-RECONCILIATION-v1).*

- **Status:** Complete. PRs #173–#177 merged.
- **PROMPT_ID:** P2C-OVERVIEW-REDESIGN-v1
- **Goals completed:**
  - Redesigned Overview hero into a champion podium with gold/silver/bronze medal accents and a "Champion" badge for the season winner.
  - Added Win% leaders section and a dedicated Rankings tab surfacing AP/Coaches poll data.
  - App-wide visual sweep — tab bar styling, matchup card layout, flat insights list.
  - Design refinements — muted blue palette, corrected win bar rendering, removed duplicate bars from Trends.
  - Restructured Trends section — removed embedded `TrendsDetailSurface` from Overview; relocated to a compact mini-chart placeholder in Standings sidebar pending Phase 3B build-out.
- **Key outcomes:**
  - Overview has a clear visual hierarchy: podium hero → standings/insights grid → results/matchups → trends.
  - App-wide color and type language is consistent across Overview, Standings, and Matchups surfaces.
  - Rankings data is surfaced without cluttering primary league views.
- **Optional follow-up (not scheduled):**
  - Podium animation or expanded champion celebration for postseason.
  - Win% bar chart integration into Trends card if space allows.

---

### Phase 2B — UX/Engagement Campaign

- **Status:** Complete. PRs #167–#172 merged.
- **PROMPT_ID:** P2B-OVERVIEW-UX-CAMPAIGN-v1
- **Goals completed:**
  - Overview hierarchy fix — standings + insights grid repositioned immediately after the hero; narrative sections pushed below.
  - Signal-first copy pass — removed redundant "League" prefixes, filler language, and "this week" suffixes throughout.
  - Member feedback entry point — lightweight "Report an issue" link added to the page footer.
  - UX / information density pass — mobile nav improvements, discoverability enhancements, layout clarity.
  - App flow — tab reorder reflecting usage priority, Matrix season-scope fix, copy alignment across pages.
  - Visual design language — consistent type size floor, letter-spacing, border-radius, and hover state conventions.
- **Key outcomes:**
  - Standings are visible on mobile without scrolling past narrative sections.
  - Copy is data-first throughout; reduced cognitive overhead for scan-and-leave usage patterns.
  - Members have a low-friction path to report data issues without leaving the app.
  - Design language is consistent enough to extend without per-component decisions.
- **Optional follow-up (not scheduled):**
  - Commissioner recovery UX refinements — defer until real hosted usage patterns emerge.

---

### Shared Insights System + Overview Restructure (Phase 2B delivery)

- **Status:** Complete through Phase 6 (convergence). Phase 7 expansion items are optional and not scheduled.
- **Goals completed:**
  - Built `deriveLeagueInsights()` as the canonical shared selector in `src/lib/selectors/insights.ts` (589 lines).
  - Implemented 8 deterministic insight types: `movement`, `toilet_bowl`, `surge`, `collapse`, `race`, `champion_margin`, `failed_chase`, `tight_cluster`.
  - Built filtered consumer selectors: `deriveOverviewInsights()` (top-3 for Overview) and `deriveStandingsInsights()` (1–2 contextual insights for Standings).
  - Integrated shared selector into both OverviewPanel and StandingsPanel; removed all page-level insight derivation.
  - Added standings movement (rank delta) column with directional arrow indicators.
  - Restructured Overview into a two-column grid: standings context left, insights/results/live right.
  - Moved head-to-head matchup matrix from Overview into a dedicated week-view matrix tab.
- **Key outcomes:**
  - All league insights derive from a single source — no duplicate or contradictory derivation across pages.
  - Insight ranking is deterministic: same inputs always produce the same ordered output.
  - Overview and Standings both surface the same insight catalog through different filtered lenses.
  - Head-to-head matrix is accessible without cluttering the primary Overview layout.
- **Optional follow-up (not scheduled):**
  - Phase 7 insight type expansion (longest streak, volatility, late-season pressure) — add only if specific member feedback warrants it.

---

### Phase 2A — Production Hardening Closeout

- **Status:** Complete. Engineering closeout and mobile/device validation sign-off both landed.
- **Goals completed:**
  - Hardened shared durable commissioner-managed state for hosted reads.
  - Protected commissioner mutation and refresh flows with lightweight admin authorization.
  - Enforced season-persistent cache-first behavior with admin-only rebuild semantics for schedule/reference refresh.
  - Landed shared cache snapshots for expensive regenerable data and conservative quota-aware refresh behavior.
  - Clarified diagnostics authority by distinguishing shared durable state from ephemeral process-memory counters.
  - Shipped targeted mobile responsiveness fixes: text size floors, touch target improvements, admin button sizing, and AliasEditorPanel header wrapping.
- **Key outcomes:**
  - Ordinary member traffic now reads shared cached state without opportunistic upstream rebuilds of schedule/reference data.
  - Commissioner/admin refresh actions are explicit and auditable.
  - Diagnostics are clearer for hosted operators, reducing confusion during production recovery workflows.
  - Core member surfaces (GameScoreboard, GameWeekPanel, MatchupsWeekPanel, StandingsPanel, OverviewPanel, WeekControls) validated for real-device mobile use.
- **Optional follow-up debt (non-blocking):**
  - Continue tightening admin/debug copy based on real hosted usage feedback.
  - Optional decomposition of larger files remains available after hosted validation stabilizes.

---

### Phase 2 — Score Hydration + Weekly Usability Progress

- **Status:** Landed; follow-on Phase 2 usability work remains active.
- **Goals completed:**
  - Defaulted the dashboard to the current in-season week with sensible fallback behavior.
  - Improved weekly dashboard scanability and cleaned up ownership labeling.
  - Expanded score hydration to cover season-wide manual refresh flows.
  - Tightened bootstrap score hydration scope for safer initial loading.
  - Added automatic postseason score hydration on first postseason tab visit.
- **Key outcomes:**
  - The weekly dashboard now opens closer to the most relevant league view with less user friction.
  - Score visibility and refresh behavior are more complete across regular-season and postseason browsing.
  - The remaining Phase 2 queue can now focus on matchup framing, responsive polish, standings, and feedback entry points.
- **Optional follow-up debt (non-blocking):**
  - Additional refinement of weekly matchup presentation and mobile ergonomics is still tracked in the active Phase 2 queue.

---

### Phase 1 — Architecture Stabilization

- **Status:** Complete (close-out audit finished).
- **Goals completed:**
  - Shifted runtime flow to API-first schedule and scores via CFBD-backed adapters.
  - Established odds ingestion through internal adapter boundaries.
  - Preserved alias persistence, local fallback behavior, and repair workflows.
  - Maintained diagnostics surfaces for reconciliation and operator visibility.
  - Landed shared retry/backoff/pacing protections and schedule-derived attachment boundaries.
- **Key outcomes:**
  - Stable and predictable ingestion pipeline: schedule as source-of-truth, with scores/odds attached through shared identity helpers.
  - Clear architecture boundaries between routes, orchestrator UI, and shared lib logic.
  - Practical local caching model retained for commissioner workflows.
- **Optional follow-up debt (non-blocking):**
  - Additional decomposition of `src/components/CFBScheduleApp.tsx`.
  - Additional decomposition of `src/lib/scoreAttachment.ts`.

---

### Template for future entries

Use this structure for each new completed phase/milestone:

- **Status:**
- **PROMPT_ID(s):**
- **Goals completed:**
- **Key outcomes:**
- **Optional follow-up debt (non-blocking):**

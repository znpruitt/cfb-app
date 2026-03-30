# Completed Work Log

## Purpose / How to use this document

- This file is an **append-only log** of completed phases and major milestones.
- Record **what was built and why it mattered** (outcomes), not a commit-by-commit changelog.
- This is **not** an active task list.
- Add future completed phases/milestones here instead of mixing history into `docs/next-tasks.md`.

## Completed phases / milestones

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
- **Goals completed:**
- **Key outcomes:**
- **Optional follow-up debt (non-blocking):**

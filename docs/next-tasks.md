# Next Tasks (Active Queue)

## Purpose / How to use this document

- This file is the **active execution queue** for the current production-hardening phase.
- Keep tasks small and scoped to a **single implementation PR** where practical.
- Move completed work summaries to `docs/completed-work.md`.
- Keep broader context and later-phase ideas in `docs/roadmap.md`.
- Reference implementation prompts by explicit `PROMPT_ID` and follow the header convention documented in `docs/prompt-registry.md`.

## Current phase

- **Phase 1 (architecture stabilization):** Complete.
- **Phase 2 (core league surfaces):** Complete.
- **Phase 2A (production hardening):** Complete.
- **Phase 2B (league UX / engagement):** Complete. See `docs/completed-work.md`.
- **Phase 2C (overview visual redesign):** Complete. See `docs/completed-work.md`.
- **Phase 2D (overview trends visual sweep):** Complete. See `docs/completed-work.md`.
- **Phase 3 (multi-league support):** ✅ Complete. PRs #192–#196 merged. See `docs/completed-work.md`.
- **Phase 4 (historical analytics):** ✅ Complete. All subphases (P4A–P4D) and Historical Season Backfill Endpoint shipped. See `docs/completed-work.md`.
- **Phase 5 (draft/owner assignment tool):** ✅ Complete. All subphases (P5A–P5D) shipped. PR #214 open. See `docs/completed-work.md`.
- **Phase 6 (admin cleanup and auth):** ✅ Complete. All subphases P6A–P6E shipped. See `docs/completed-work.md`.
- **Active execution focus: Phase 7 — Commissioner Self-Service (queued).**

## Hosted deployment runbook

- Use `docs/deployment-runbook.md` for the operator checklist during the real Vercel + Postgres setup and first hosted preview validation.
- Keep `docs/next-tasks.md` focused on the active engineering queue rather than repeating the step-by-step deployment procedure.

## Phase 2A closeout status — complete ✅

1. **Shared durable commissioner data** ✅
2. **Admin protection for mutating flows** ✅
3. **Season-persistent cache policy** ✅
4. **Shared cache for expensive regenerable data** ✅
5. **Quota-safe live refresh behavior** ✅
6. **Production recovery + observability basics** ✅
7. **Mobile / device launch validation** ✅ — targeted fixes shipped; core member surfaces validated.

## Active queue: Phase 2B league experience improvements

### Resolved — no further action needed

- **Shared Insights System** — Complete through Phase 6. See `docs/completed-work.md`.
- **Standings movement column** — Shipped.
- **League summary bar** — Satisfied by LeagueSummaryHero; no separate bar needed.
- **Head-to-head matrix** — Moved to week-view matrix tab; documented in roadmap.
- **Overview hierarchy fix** ✅ — Shipped in PR #167 (phase-2b-docs-and-overview-hierarchy).
- **Signal-first copy pass** ✅ — Shipped in PR #168 (phase-2b-signal-first-copy).
- **Feedback/report issue entry point** ✅ — Shipped in PR #169 (phase-2b-feedback).
- **UX / information density pass** ✅ — Shipped in PR #170 (phase-2b-ux-density).
- **App flow improvements** ✅ — Shipped in PR #171 (phase-2b-app-flow).
- **Visual design language** ✅ — Shipped in PR #172 (phase-2b-visual-polish).
- **Phase 2C Overview redesign** ✅ — Shipped in PRs #173–#177. See `docs/completed-work.md`.
- **Phase 2D MiniTrendsGrid + title chase** ✅ — Shipped in PRs #178–#182. See `docs/completed-work.md`.
- **Phase 2D form dots polish** ✅ — Merged PR #183 (phase-3b-visual-sweep). See `docs/completed-work.md`.
- **Standings sort rule fix** ✅ — Merged PR #184. See `docs/completed-work.md`.
- **Postseason trend fix + position deltas panel** ✅ — Merged PR #188. See `docs/completed-work.md`.

### Completed — Phase 4 subphases

- **P4A — Data Foundation:** ✅ Complete. `SeasonArchive` type, `getSeasonArchive`/`setSeasonArchive`, `/api/history/[year]` route.
- **P4B — Season Rollover and Admin Action:** ✅ Complete. CFP Final detection, `"Start New Season"` button, `/api/admin/rollover`, re-archive diff.
- **P4C — Season Detail UI:** ✅ Complete. PR #201 merged. `/league/[slug]/history/[year]/` page with all history components. See `docs/completed-work.md`.

- **Roster Upload Fuzzy Matching:** ✅ Complete. PRs #202–#203 merged. See `docs/completed-work.md`.
- **P4D — League History and Owner Career UI:** ✅ Complete. PR #204 merged. See `docs/completed-work.md`.
- **Historical Season Backfill Endpoint:** ✅ Complete. Shipped in same branch as P4D. See `docs/completed-work.md`.
- **Historical Cache Endpoints + P4D Polish:** ✅ Complete. PR #207 merged. Schedule and scores cache endpoints; standings sort/winPct; NoClaim filter; 60/40 layout; History nav tab; live standings merge; banner card. See `docs/completed-work.md`.

## Active queue: Phase 5 — Draft / Owner Assignment Tool

Replace manual CSV owner roster uploads with a live in-app draft tool for the commissioner. Full design approved — see `docs/phase-5-draft-tool-design.md`. All open questions resolved; no prerequisites blocking implementation.

### Phase 5 subphases

- **P5A — Draft Data Infrastructure** ✅ Complete. PR #210 merged. See `docs/completed-work.md`.

- **P5B — Draft Setup and Settings** ✅ Complete. PR #211 open. See `docs/completed-work.md`.

- **P5C — Live Draft Board** ✅ Complete. Branch `claude/improve-thread-speed-v1YFg`. See `docs/completed-work.md`.

- **P5D — Draft Summary and Confirmation** ✅ Complete. PR #214 open. See `docs/completed-work.md`.

## Phase 6 — Admin Cleanup and Auth ✅ Complete

All subphases P6A–P6E and Admin Polish complete. See `docs/completed-work.md` for full record.

- **P6D** ✅ Complete. PR #228.
- **P6E** ✅ Complete. PR #229. `RosterEditorPanel` — inline CRUD for team-owner assignments at `/admin/[slug]/roster`.
- **P6 Admin Polish and Commissioner UX** ✅ Complete. PRs #230–#233. Gear icon, `isAdmin` prop pattern, per-league commissioner landing (`/admin/[slug]`), `LeagueStatusPanel`, `LeagueSettingsForm`, `GlobalRefreshPanel` with year input.

## Upcoming phases

### Phase 7 — Commissioner Self-Service (next)

First tasks:
- **Commissioner role enforcement** — protect `/league/[slug]/draft/*` and `/admin/[slug]/*` routes for `commissioner` role in Clerk middleware; currently only `platform_admin` is enforced.
- **Commissioner self-registration and invite link flow** — mechanism for platform_admin to grant `commissioner` role to a league member for a specific slug.
- **League-scoped permissions in Clerk `publicMetadata`** — data model for associating a user with one or more league slugs as commissioner.
- **Member login and personalized views** — Clerk `member` role; personalized owner views filtered to logged-in member's teams.
- **`ADMIN_API_TOKEN` full removal** — Phase 6 left a fallback; Phase 7 removes it and requires Clerk JWT for all admin API routes.

See `docs/roadmap.md` for full Phase 7 scope.

- **Phase 8+:** Not scheduled. See `docs/roadmap.md`.

## Out of scope for this queue

- New matching systems or changes to schedule-first identity rules.
- Heavy infrastructure beyond one small managed database plus the hosted app.
- Broad analytics/history work before hosted stability is complete.

## Non-blocking maintenance

- Revisit TypeScript import/test-runner cleanup separately from production-hardening work.
- Keep optional decomposition of `CFBScheduleApp.tsx` and `scoreAttachment.ts` as non-blocking technical debt unless explicitly scheduled.

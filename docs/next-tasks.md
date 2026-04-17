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
| Data & Intelligence | Insights Engine — Next Generator Batch | In progress |
| Data & Intelligence | Insights Engine — Two Weekly Pulses | Planned |
| Platform | Season Rollover UI and Cron | ✅ Complete |
| Polish | History Page Polish | ✅ Complete |
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

### 1. INSIGHTS — Next Generator Batch (12 Tier 1 insights)

**Generators and wiring complete (PR #278).** Historical + rivalry generators live on the overview panel, `buildInsightContext()` + `deriveLifecycleState()` in place, `GET /api/insights/[slug]` merged.

**Next steps (new Claude Code session):**
- **Stats Outliers generator** — first batch: yards-per-win efficiency, ball security (lowest turnovers), takeaway king (highest takeaways), team identity (run-heavy / pass-heavy / balanced)
- Remaining Tier 1 insights (10): Clock Crusher, Third Down Specialist, Career Points Leader, Volatility Award, Never Finished Last, Title Chaser / Bridesmaid, Career Turnover Margin, Trending Up/Down
- **Points-against data pipeline** — required to unlock Luck Score and a broader set of Tier 2 insights
- See Insights Engine — Opus 1M Brainstorming in `docs/completed-work.md` for the full 18-idea inventory and tiering

**Non-blocking future polish:** Remove dead view model properties (`keyMovements`, `leaguePulse`, `shouldShowLeaguePulse`) from `selectOverviewViewModel`.

### 2. INSIGHTS — Two Weekly In-Season Pulses (future)

Monday Look Back + Thursday Forward Look. Deferred until the next generator batch lands and in-season lifecycle output is validated.

### 3. DRAFT — Slow Draft Mode

Enable async drafts with configurable per-pick windows. Requires email notification infrastructure (new). See `docs/roadmap.md` for full scope.

### 4. POLISH — Copy / UX Writing Audit

Systematic review of all user-facing strings for consistent voice. No logic changes. See `docs/roadmap.md` for campaign scope.

### 5. PLATFORM — Server Action Auth Hardening

Enforce commissioner role on all mutating server actions. Remove `ADMIN_API_TOKEN` fallback from public routes.

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

## Hosted deployment runbook

- Use `docs/deployment-runbook.md` for the operator checklist during the real Vercel + Postgres setup and first hosted preview validation.

## Out of scope for this queue

- New matching systems or changes to schedule-first identity rules.
- Heavy infrastructure beyond one small managed database plus the hosted app.
- Broad analytics/history work before hosted stability is complete.

## Non-blocking maintenance

- Revisit TypeScript import/test-runner cleanup separately from active campaign work.
- Keep optional decomposition of `CFBScheduleApp.tsx` and `scoreAttachment.ts` as non-blocking technical debt unless explicitly scheduled.

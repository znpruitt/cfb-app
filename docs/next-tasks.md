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
| Data & Intelligence | Game Stats Pipeline | In progress |
| Data & Intelligence | Insights Engine | Planned |
| Draft | Slow Draft Mode | Planned |
| Draft | Draft Difficulty Settings | Planned |
| Platform | Multi-tenant Commissioner Sign-up | Planned |
| Platform | Server Action Auth Hardening | Planned |
| Polish | Design Audit (remaining pages) | Planned |
| Polish | Copy / UX Writing Audit | Planned |
| Polish | Back Button Audit | Planned |
| Polish | Aliases Platform Migration | Planned |

## Active priorities

### 1. INSIGHTS — Game Stats normalization → Insights Engine

**Game Stats Pipeline** is in progress. Core pipeline shipped (types, normalizers, cache, API route, cron route, admin panel with backfill). Six additional normalized return stat fields added.

**Next steps:**
- Verify raw stat categories against live CFBD data (run a single backfill to confirm category list)
- Build Insights Engine selector layer — derive owner-level insights from game stats + standings + history
- Two weekly pulse system (Monday look-back, Thursday forward-look)
- Preseason insights tier (history + draft stats — always available, no API dependency)

### 2. DRAFT — Slow Draft Mode

Enable async drafts with configurable per-pick windows. Requires email notification infrastructure (new). See `docs/roadmap.md` for full scope.

### 3. POLISH — Copy / UX Writing Audit

Systematic review of all user-facing strings for consistent voice. No logic changes. See `docs/roadmap.md` for campaign scope.

### 4. PLATFORM — Server Action Auth Hardening

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

## Hosted deployment runbook

- Use `docs/deployment-runbook.md` for the operator checklist during the real Vercel + Postgres setup and first hosted preview validation.

## Out of scope for this queue

- New matching systems or changes to schedule-first identity rules.
- Heavy infrastructure beyond one small managed database plus the hosted app.
- Broad analytics/history work before hosted stability is complete.

## Non-blocking maintenance

- Revisit TypeScript import/test-runner cleanup separately from active campaign work.
- Keep optional decomposition of `CFBScheduleApp.tsx` and `scoreAttachment.ts` as non-blocking technical debt unless explicitly scheduled.

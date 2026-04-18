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
| Data & Intelligence | Insights Panel UI Redesign | Planned |
| Data & Intelligence | Pairing Cards | Planned |
| Data & Intelligence | Luck Score + Bounce-Back Generators | Planned |
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

### 1. INSIGHTS — Insights Panel UI Redesign

Copy Variation Architecture complete. Next: redesign the insights panel UI.

**Scope:**
- Display 5 insights (not 3); first at 15px, rest at 14px
- 10px uppercase category microlabel above each title
- Owner names in assigned color, regular weight
- Full row tappable; `→` always visible at 13px muted
- "See all →" link to dedicated insights page
- Mobile: full-width, no tab strip, no scroll strip
- `fresh_offseason`: featured slot becomes Season Recap card
- Owner color map prop from canonical standings source
- **Prompt ID to assign:** `INSIGHTS-017-PANEL-UI-v1`

### 2. INSIGHTS — Pairing Cards

Post-processing pass after all generators run. Pairing priority = `max(A, B) + 10`. Natural pairings: Title Chaser + Volatility, Ball Security + Takeaways, Career Points + Drought, Trending Leader.
- AI copy for pairing cards: cache-time generation, curated subset only
- **Prompt ID to assign:** `INSIGHTS-018-PAIRING-CARDS-v1`

### 3. INSIGHTS — Luck Score + Bounce-Back Generators

Both unblocked by Context Extension (INSIGHTS-014).
- Luck Score: points scored vs points allowed differential
- Bounce-Back Candidate: Volatility + Trending Down signals combined
- **Prompt ID to assign:** `INSIGHTS-019-LUCK-SCORE-v1`

### 4. DRAFT — Slow Draft Mode

Enable async drafts with configurable per-pick windows. Requires email notification infrastructure (new). See `docs/roadmap.md` for full scope.

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
- Insights Engine — Context Extension (INSIGHTS-014): `pointsAgainst` + `OwnerCareerStats` type + `buildOwnerCareerStats()` + career diagnostic route
- Insights Engine — Generator Batch 2 (INSIGHTS-015): 16 generators across career.ts, stats.ts, milestones.ts; tone property; InsightWindow type; UTF-8 + trending direction bug fixes
- Copy Variation Architecture (INSIGHTS-016): newsHook + statValue on all generators; per-league/season suppression gate; async engine; 2–5 templates per insight type; rollover clear gated per league

## Hosted deployment runbook

- Use `docs/deployment-runbook.md` for the operator checklist during the real Vercel + Postgres setup and first hosted preview validation.

## Out of scope for this queue

- New matching systems or changes to schedule-first identity rules.
- Heavy infrastructure beyond one small managed database plus the hosted app.
- Broad analytics/history work before hosted stability is complete.

## Non-blocking maintenance

- Revisit TypeScript import/test-runner cleanup separately from active campaign work.
- Keep optional decomposition of `CFBScheduleApp.tsx` and `scoreAttachment.ts` as non-blocking technical debt unless explicitly scheduled.

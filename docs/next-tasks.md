# Next Tasks (Active Queue)

## Purpose / How to use this document

- This file is the **active execution queue** for the current production-hardening phase.
- Keep tasks small and scoped to a **single implementation PR** where practical.
- Move completed work summaries to `docs/completed-work.md`.
- Keep broader context and later-phase ideas in `docs/roadmap.md`.
- Reference implementation prompts by explicit `PROMPT_ID` and follow the header convention documented in `docs/prompt-registry.md`.

## Current phase

- **Phase 1 (architecture stabilization):** Complete.
- **Phase 2 (core league surfaces):** Substantially complete foundation.
- **Phase 2A (production hardening):** Complete.
- **Active execution focus:** **Phase 2B league UX / engagement**.

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

### Active tasks

1. **Overview hierarchy fix** ← start here
   - Move the two-column grid (Standings + Insights/Results/Live) immediately after the Hero.
   - Push LeagueStorylines and League Trends to secondary position below.
   - File: `src/components/OverviewPanel.tsx` — JSX block reorder, no logic changes.
   - Goal: standings visible on mobile without scrolling past narrative sections.

2. **Signal-first copy pass**
   - Tighten copy in Storylines card items and Trends section labels.
   - Reduce narrative filler in favor of data-first scanning.
   - No component changes — label/copy edits only.

3. **Feedback/report issue entry point** (polish tier)
   - Lightweight member-facing way to report data issues or leave feedback.
   - Scope TBD — could be a simple link, modal, or external form.

4. **Commissioner recovery UX refinements** (polish tier)
   - Based on real hosted usage feedback.
   - No specific changes identified yet — leave until production usage patterns emerge.

## Future-planned note: Multi-league support (scoped)

- Multi-league support is future-planned, not part of the active production-hardening queue.
- League-specific boundary: owner table / ownership overlay data.
- Shared global CFB/reference data remains common across leagues (schedule, scores, odds, rankings, conferences).
- Expected approach: league slug or `leagueId` routing boundary without duplicating CFBD ingestion.

## Out of scope for this queue

- New matching systems or changes to schedule-first identity rules.
- Heavy infrastructure beyond one small managed database plus the hosted app.
- Broad analytics/history work before hosted stability is complete.

## Non-blocking maintenance

- Revisit TypeScript import/test-runner cleanup separately from production-hardening work.
- Keep optional decomposition of `CFBScheduleApp.tsx` and `scoreAttachment.ts` as non-blocking technical debt unless explicitly scheduled.

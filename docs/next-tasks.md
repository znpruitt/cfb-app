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
- **Phase 2B (league UX / engagement):** Complete. See `docs/completed-work.md`.
- **Phase 2C (overview visual redesign):** Complete. See `docs/completed-work.md`.
- **Phase 2D (overview trends visual sweep):** Complete. All PRs merged. See `docs/completed-work.md`.
- **Active execution focus:** Planning pause — no active implementation tasks. Next campaign: **Phase 3 (Multi-League Support)** — design approved, implementation prompt not yet written.

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

### Active tasks

No active tasks. Planning pause in effect.

1. **Commissioner recovery UX refinements** (polish tier — parked)
   - Based on real hosted usage feedback.
   - No specific changes identified yet — leave until production usage patterns emerge.

## Post-Phase 2D planning pause

- Phase 2D is complete. No active implementation tasks.
- Next campaign to be defined before resuming implementation work.

## Upcoming phases

- **Phase 3 — Multi-League Support:** Design approved. See `docs/phase-3-multi-league-design.md`. Implementation prompt not yet written.
- **Phase 4 — Historical Analytics:** Design approved. See `docs/phase-4-historical-analytics-design.md`. Requires Phase 3 to be complete first.
- **Phase 5 — Draft/Owner Assignment Tool:** Planned. See `docs/roadmap.md`.
- **Phase 6 — Commissioner Self-Service:** Long-term vision. Not scheduled. See `docs/roadmap.md`.

## Out of scope for this queue

- New matching systems or changes to schedule-first identity rules.
- Heavy infrastructure beyond one small managed database plus the hosted app.
- Broad analytics/history work before hosted stability is complete.

## Non-blocking maintenance

- Revisit TypeScript import/test-runner cleanup separately from production-hardening work.
- Keep optional decomposition of `CFBScheduleApp.tsx` and `scoreAttachment.ts` as non-blocking technical debt unless explicitly scheduled.

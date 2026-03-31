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
- **Active execution focus:** **Phase 2D overview trends visual sweep** — PR #183 open.

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

### Active tasks

1. **Phase 2D form dots polish** — PR #183 open on phase-3b-visual-sweep.
   - Title chase chart, RecentFormPanel, responsive layout.
   - PROMPT_ID: P2D-TRENDS-FORM-DOTS-v1.
   - Merge when form dot visual polish is satisfactory.

2. **Commissioner recovery UX refinements** (polish tier)
   - Based on real hosted usage feedback.
   - No specific changes identified yet — leave until production usage patterns emerge.

## Post-Phase 2D planning pause

- Once PR #183 merges, Phase 2D is complete. No active implementation tasks.
- Next campaign to be defined before resuming implementation work.

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

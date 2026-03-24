# Next Tasks (Active Queue)

## Purpose / How to use this document

- This file is the **active execution queue** for the current production-hardening phase.
- Keep tasks small and scoped to a **single implementation PR** where practical.
- Move completed work summaries to `docs/completed-work.md`.
- Keep broader context and later-phase ideas in `docs/roadmap.md`.

## Current phase

- **Phase 1 (architecture stabilization):** Complete.
- **Phase 2 (core league surfaces):** Substantially complete foundation.
- **Active execution focus:** **Phase 2A final closeout + hosted launch validation**.

## Hosted deployment runbook

- Use `docs/deployment-runbook.md` for the operator checklist during the real Vercel + Postgres setup and first hosted preview validation.
- Keep `docs/next-tasks.md` focused on the active engineering queue rather than repeating the step-by-step deployment procedure.

## Phase 2A closeout status (production-safe path)

Completed in codebase:

1. **Shared durable commissioner data** ✅
2. **Admin protection for mutating flows** ✅
3. **Season-persistent cache policy** ✅
4. **Shared cache for expensive regenerable data** ✅
5. **Quota-safe live refresh behavior** ✅
6. **Production recovery + observability basics** ✅

Remaining before full Phase 2A sign-off:

7. **Mobile / device launch validation** ⏳
   - Validate core hosted flows on mobile Safari, Android Chrome, and major desktop browsers.
   - Confirm admin workflows remain usable on smaller screens when needed.

## Active final-closeout queue

1. **Hosted validation execution + evidence capture**
   - Run the deployment-runbook checklist against hosted preview and production config.
   - Capture pass/fail notes for schedule load, scores refresh, odds policy behavior, owner upload, alias edits, and admin refresh workflows.

2. **Cross-device validation**
   - Validate primary member and commissioner flows on mobile Safari, Android Chrome, and desktop browsers.
   - Record any ergonomics regressions as tightly scoped follow-up tasks.

3. **Phase 2A sign-off update**
   - Move final closeout summary to `docs/completed-work.md`.
   - Mark Phase 2A complete in roadmap status once validation evidence is logged.

## Recommended follow-on queue

- Keep tightening production copy in admin/debug surfaces where hosted usage reveals confusion.
- Add a lightweight member-facing issue/reporting path once hosted stability is in place.
- Revisit optional decomposition of large files only after the production-safe path is stable.

## Next execution phase (after production hardening): League experience improvements

This block starts after the production-safe path above is complete and stable in hosted usage.

1. **Overview hierarchy restructure**
   - Reorder the Overview page so standings/leader context is first.
   - Keep matchup details present but secondary to league-state signal.

2. **League summary bar**
   - Add a compact top-level summary strip with immediate league context.
   - Keep it data-first and scan-friendly on mobile and desktop.

3. **Recent results emphasis**
   - Increase visibility of recently completed games and their league impact.
   - Reduce friction to answer “what just happened?” in one pass.

4. **Live-state clarity**
   - Surface live-game context more clearly when games are in progress.
   - Keep presentation consistent with quota-safe refresh constraints.

5. **Head-to-head table tuning**
   - De-emphasize or condense lower-signal table sections that crowd primary league context.
   - Preserve commissioner/debug utility while reducing member-facing noise.

6. **Mobile-first readability pass**
   - Tighten spacing, hierarchy, and scan order for small screens.
   - Validate quick league-state comprehension within seconds on phones.

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

# Next Tasks (Active Queue)

## Purpose / How to use this document

- This file is the **active execution queue** for the current production-hardening phase.
- Keep tasks small and scoped to a **single implementation PR** where practical.
- Move completed work summaries to `docs/completed-work.md`.
- Keep broader context and later-phase ideas in `docs/roadmap.md`.

## Current phase

- **Phase 1 (architecture stabilization):** Complete.
- **Phase 2 (core league surfaces):** Substantially complete foundation.
- **Active execution focus:** **Production hardening for hosted league-member access**.

## Hosted deployment runbook

- Use `docs/deployment-runbook.md` for the operator checklist during the real Vercel + Postgres setup and first hosted preview validation.
- Keep `docs/next-tasks.md` focused on the active engineering queue rather than repeating the step-by-step deployment procedure.

## Production-safe path first (ordered, PR-sized)

1. **Shared durable commissioner data**
   - Move shared alias persistence to durable server-side storage.
   - Add shared owner-roster persistence so all members read the same roster.
   - Add shared postseason-override persistence for commissioner repair flows.

2. **Admin protection for mutating flows**
   - Protect alias edits, owner uploads, manual refreshes, and team database sync behind lightweight admin authorization.
   - Ensure public/member traffic can continue to read cached/shared state without needing admin credentials.

3. **Season-persistent cache policy**
   - Make season-persistent/reference data read from shared cached state first.
   - Restrict schedule/reference rebuilds to explicit admin refresh flows.
   - Prevent ordinary member traffic from triggering repeated upstream rebuild work.

4. **Shared cache for expensive regenerable data**
   - Add shared durable cache snapshots for conferences, rankings, and other expensive but regenerable data.
   - Remove product dependence on per-instance or per-browser cache assumptions.

5. **Quota-safe live refresh behavior**
   - Keep scores fresher than other data, but route them through shared cache-first reads.
   - Keep odds especially conservative: member reads should favor existing shared snapshots, with refresh driven by admin/manual policy.
   - Avoid interval-heavy refresh behavior that can burn CFBD or Odds API quotas.

6. **Production recovery + observability basics**
   - Clarify admin recovery workflows for bad aliases, bad owners upload, stale schedule cache, and quota exhaustion.
   - Add production-facing logging/diagnostic notes that distinguish shared durable state from ephemeral in-memory counters.

7. **Mobile / device launch validation**
   - Validate core hosted flows on mobile Safari, Android Chrome, and major desktop browsers.
   - Confirm admin workflows remain usable on smaller screens when needed.

## Recommended follow-on queue

- Tighten production copy in admin/debug surfaces to reflect shared durable storage and admin-only refresh semantics.
- Add a lightweight member-facing issue/reporting path once hosted stability is in place.
- Revisit optional decomposition of large files only after the production-safe path is stable.

## Out of scope for this queue

- New matching systems or changes to schedule-first identity rules.
- Heavy infrastructure beyond one small managed database plus the hosted app.
- Broad analytics/history work before hosted stability is complete.

## Non-blocking maintenance

- Revisit TypeScript import/test-runner cleanup separately from production-hardening work.
- Keep optional decomposition of `CFBScheduleApp.tsx` and `scoreAttachment.ts` as non-blocking technical debt unless explicitly scheduled.

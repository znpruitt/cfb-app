# Next Tasks (Active Queue)

## Purpose / How to use this document

- This file is the **active execution queue** for the current phase.
- Keep tasks small and scoped to a **single implementation PR** where practical.
- Treat this file as **forward-looking only**.
- Move/summarize completed work in `docs/completed-work.md`.
- Keep long-term or not-yet-active ideas in `docs/roadmap.md`.

## Current phase

- **Phase 1 (architecture stabilization):** Complete.
- **Active phase:** **Phase 2 — user-facing usability improvements**.

## Phase 2 execution queue (ordered, PR-sized)

1. **Weekly dashboard default flow**
   - Default to the current in-season week (with sensible fallback when offseason).
   - Keep week switching explicit and predictable.

2. **Matchup-centric game cards**
   - Present owner-vs-owner context as the primary card framing.
   - Keep odds/scores visible without exposing raw provider shapes.

3. **Responsive polish pass**
   - Improve layout behavior for mobile and tablet breakpoints.
   - Ensure controls and game cards remain readable and scannable.

4. **Standings baseline**
   - Add/update a simple standings view (wins/losses; optional point differential if low risk).
   - Use existing API-first schedule/scores pipeline as source data.

5. **Feedback capture path**
   - Add a lightweight in-app mechanism for league members to report data issues.
   - Keep diagnostics and commissioner repair workflows intact.

## Out of scope for this queue

- Phase 3 historical analytics and long-term ideas stay in `docs/roadmap.md` until promoted.
- Optional technical debt (extra decomposition of `CFBScheduleApp.tsx` and `scoreAttachment.ts`) is non-blocking unless explicitly scheduled.

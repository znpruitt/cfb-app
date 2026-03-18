# Next Tasks (Active Queue)

## Purpose / How to use this document

- This file is the **active execution queue** for the current phase.
- Keep tasks small and scoped to a **single implementation PR** where practical.
- Treat this file as **forward-looking only**.
- Move completed work summaries to `docs/completed-work.md`.
- Keep long-term or not-yet-active ideas in `docs/roadmap.md`.

## Current phase

- **Phase 1 (architecture stabilization):** Complete.
- **Active phase:** **Phase 2 — user-facing usability improvements**.

## Phase 2 execution queue (ordered, PR-sized)

1. **Matchup-first weekly card framing**
   - Make owner-vs-owner context the primary weekly card framing.
   - Keep team, owner, score, and spread context immediately scannable.

2. **Responsive/mobile weekly dashboard polish**
   - Improve weekly dashboard behavior on phone and tablet breakpoints.
   - Preserve readability of controls, cards, and game state at smaller sizes.

3. **Standings baseline**
   - Add a simple standings view with wins/losses.
   - Include point differential only if it stays low risk and easy to verify.

4. **Feedback / report issue entry point**
   - Add a lightweight way for league members to report data issues or UX confusion.
   - Keep commissioner diagnostics and repair workflows as the primary follow-up path.

## Recently completed Phase 2 work

- Current-week default behavior.
- Weekly dashboard scanability improvements.
- Ownership labeling cleanup.
- Score hydration follow-through: season-wide manual refresh coverage, safe bootstrap scope, and automatic first-visit postseason hydration.

## Out of scope for this queue

- Phase 3 historical analytics and long-term ideas stay in `docs/roadmap.md` until promoted.
- Optional technical debt (extra decomposition of `CFBScheduleApp.tsx` and `scoreAttachment.ts`) is non-blocking unless explicitly scheduled.

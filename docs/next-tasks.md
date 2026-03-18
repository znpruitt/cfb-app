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

1. **Matchups card scanability follow-through**
   - Add stronger in-card cues for favored owner and currently leading owner in the Matchups view.
   - Keep the enhancement presentation-only and derived from existing score/odds attachments.

2. **Responsive/mobile Matchups polish**
   - Improve Matchups card behavior on phone and tablet breakpoints.
   - Preserve readability of owner labels, score context, and odds/status chips at smaller sizes.

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
- Matchups tab / weekly view split: Schedule remains the canonical game browser while Matchups provides league-first owner-centric weekly cards.
- Score hydration follow-through: season-wide manual refresh coverage, safe bootstrap scope, and automatic first-visit postseason hydration.

## Out of scope for this queue

- Phase 3 historical analytics and long-term ideas stay in `docs/roadmap.md` until promoted.
- Optional technical debt (extra decomposition of `CFBScheduleApp.tsx` and `scoreAttachment.ts`) is non-blocking unless explicitly scheduled.

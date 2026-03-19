# Next Tasks (Active Queue)

## Purpose / How to use this document

- This file is the **active execution queue** for the current phase.
- Keep tasks small and scoped to a **single implementation PR** where practical.
- Treat this file as **forward-looking only**.
- Move completed work summaries to `docs/completed-work.md`.
- Keep long-term or not-yet-active ideas in `docs/roadmap.md`.

## Current phase

- **Phase 1 (architecture stabilization):** Complete.
- **Active phase:** **Phase 2 — core league surfaces and usability**.

## Phase 2 execution queue (ordered, PR-sized)

1. **Standings foundation**
   - Lock in standings rules for league-owned teams before UI implementation drifts, including self-matchups counting as both a win and a loss for the same owner.
   - Implement shared derived league metrics / owner metrics utility using those standings rules consistently across standings and league summaries.
   - Add a first-class Standings tab / view.

2. **League overview / homepage foundation**
   - Add a lightweight league-first landing experience.
   - Include standings snapshot, live league-relevant games, and key weekly matchups.
   - Keep schedule as canonical data truth while making league orientation the primary user value.

3. **Postseason league surfaces**
   - Make Matchups behavior postseason-aware.
   - Add postseason-safe standings treatment / presentation.
   - Ensure the league narrative continues cleanly once regular-season weekly browsing ends.

4. **Responsive/mobile polish**
   - Apply responsive cleanup across Matchups, Standings, and Overview.
   - Do not optimize only the current weekly surface in isolation.

5. **Feedback / report issue entry point**
   - Add a lightweight reporting path for league members.
   - Keep commissioner diagnostics and repair workflows as the primary follow-up path.

6. **Optional presentation refinements**
   - Add favored-owner / leading-owner emphasis only after standings and overview exist.
   - Consider other small scanability improvements that stay presentation-only.

## Recently completed Phase 2 work

- Current-week default behavior.
- Weekly dashboard scanability improvements.
- Ownership labeling cleanup.
- Matchups tab / weekly view split: Schedule remains the canonical game browser while Matchups provides a strong owner-centric weekly foundation for league consumption.
- Score hydration follow-through: season-wide manual refresh coverage, safe bootstrap scope, and automatic first-visit postseason hydration.

## Out of scope for this queue

- Phase 3 historical analytics and long-term ideas stay in `docs/roadmap.md` until promoted.
- Optional technical debt (extra decomposition of `CFBScheduleApp.tsx` and `scoreAttachment.ts`) is non-blocking unless explicitly scheduled.

## Cleanup / Maintenance (Non-blocking)

### Tooling: TypeScript import + test runner cleanup

- [ ] Review repo-wide `.ts` import specifier changes introduced with `allowImportingTsExtensions`
- [ ] Determine if the plain `node --test` workflow can be supported with a more localized solution:
  - test-only config, loader (e.g. tsx), or narrower tsconfig change
- [ ] Reduce repo-wide impact if possible (avoid requiring `.ts` specifiers across all source files)
- [ ] Ensure no regression to the current passing test suite

Notes:
- This is intentionally separated from feature work.
- Do not combine with odds, schedule, or UI changes.
- Only execute when it can be done safely without destabilizing the working app.

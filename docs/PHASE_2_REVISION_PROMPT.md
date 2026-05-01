# PROMPT_ID: P7-HISTORY-RECORDS-PHASE-2-OVERVIEW-REVISION-v1

## PURPOSE

Replace the V2 Overview composition on the History tab with the redesign specified in `docs/HISTORY_REDESIGN_SPEC.md` and visually rendered in `mockups/history-redesign-minimal.html`. The current V2 Overview composition (EraSummary + TitleTimeline + Storylines + 18-card Record Book grid) is a regression against production and is being replaced.

This is a **revision of unmerged work** on the `claude/history-records-phase-2` branch. The branch's structural deliverables (subtab routing, HistorySubNav, RecordBadge, records selector consumption, foundedYear, resolveHistoryHref fix) are being kept. Only the Overview page composition is being replaced.

## CONTEXT

- Phase 1 (records selector) is merged. `src/lib/selectors/leagueRecords.ts` and `selectAllRecords()` exist and produce the data the Records column will consume.
- HISTORY-REWORK-FOUNDATION is merged. FormerOwnerBadge, anchor IDs, Active/Former filter on All-Time Standings, LeaguePageShell wrapping, HeadToHeadPanel owner linking are all present in production.
- Phase 2 structural work (subtab routing, HistorySubNav, RecordBadge, foundedYear, anchor URL resolver fix) is present on the branch and stays.
- Phase 2 V2 composition work (EraSummary, TitleTimeline, Storylines, 18-card Record Book grid) is being removed.
- Phase 3 will wire up Stats / Rivalries / Archive subtab content. Phase 2 leaves those subtabs as placeholder routes.

## SCOPE

### Remove from `claude/history-records-phase-2` branch

Delete or de-import the following components on the History Overview composition:

- `EraSummary`
- `TitleTimeline`
- `Storylines` (the empty-state-only variant introduced in V2)
- The 18-card `RecordBook` grid composition (the component file may persist if reusable sub-pieces are needed for Phase 3 Stats subtab; remove its rendering on Overview)
- `ChampionshipsBanner` (the V1/V2 banner with the "Most Recent Champion" hero card)
- `SeasonRecapCard`

Audit the codebase for orphan imports of these components. Remove unused imports. If any retired component file is no longer imported anywhere, delete the file unless it has documented reusable sub-pieces tagged for Phase 3.

### Implement on the History Overview tab

Build the Overview composition described in `docs/HISTORY_REDESIGN_SPEC.md` with the visual reference of `mockups/history-redesign-minimal.html`. The composition is, in render order:

1. Championships section (full-width)
2. Dashboard row — three columns: All-time standings · Recent podiums · Records
3. Top rivalries + Title streaks row (1.4fr / 1fr split)
4. Season-over-season movement section (climbs + drops side by side)
5. Season archive horizontal strip

Each section follows the section-head pattern (h2 left, summary stat or delegation link right, 20px gap to content). No card chrome, no top/bottom borders framing sections, no row borders inside lists or tables. Two horizontal rules exist on the entire page: the subnav active-tab underline (existing) and the column-header underline inside `data-table` (functional separator only).

Use the spacing scale from the spec (40 / 20 / 10 / 8). Use existing Tailwind utilities and existing component primitives (`LeaguePageShell`, `FormerOwnerBadge`, `RecordBadge`) where they apply. Translate the mockup's CSS layout intent into Tailwind — do not transcribe raw CSS.

### Subtab placeholder routes

Stats, Rivalries, and Archive subtabs render under the same `LeaguePageShell` + HistorySubNav scaffold as Overview. Each renders a minimal "Coming in Phase 3" placeholder. The `resolveHistoryHref` resolver should produce valid URLs for all four subtabs; clicking a section-head delegation link from Overview should land on the appropriate placeholder page without a 404 or error state.

### Data wiring

The redesign consumes the data sources listed in spec section 9. Before implementing each component:

1. Confirm the selector exists. If it does, wire the component to it.
2. If the selector is missing, surface that in the final response — do not invent data, do not silently skip the component.

The Recent Podiums column requires per-season top-3 finishers with wins for 1st place and games-behind for 2nd/3rd. If this data shape does not currently exist, flag it in the final response and stub the component with an empty-state placeholder ("Recent podium data unavailable") rather than fabricating values.

### Out of scope

- Stats / Rivalries / Archive subtab content (Phase 3)
- Modifications to main Overview, Standings, Matchups, Insights, or Members tabs
- Changes to per-owner or per-season detail pages
- Changes to selectors beyond reading from existing ones
- Visual changes outside the History tab

## CRITICAL CONSTRAINTS

- **Do not modify Phase 1 selectors.** `src/lib/selectors/leagueRecords.ts` and `selectAllRecords()` are merged infrastructure. Read from them; do not change them.
- **Do not introduce a hero treatment.** Championships is a section, not a hero. The page leads with the Championships section's h2.
- **Do not reintroduce row borders or section frame borders.** The two-divider rule (subnav underline + table column-header underline) is the entire divider budget.
- **Do not introduce new color treatments.** Amber for championship-related, green/red for movement deltas, category colors (teal/purple/coral/blue) for Records eyebrows only, info-link blue for delegation links, neutrals everywhere else.
- **Do not break existing infrastructure.** HistorySubNav, RecordBadge, foundedYear, resolveHistoryHref, FormerOwnerBadge, LeaguePageShell wrapping all stay functional.
- **Do not assume offseason vs in-season behavior changes.** The redesign reads the same in both states because Championships is no longer competing with the main Overview's "Most Recent Champion" treatment.
- **Do not exceed the spec's section list.** No new sections, no Storylines revival, no inline narrative cards. Page is the 5 sections in the order listed.
- **Run `npm run lint:all`** before pushing (full scope, includes test files — Vercel runs the full scope).
- **Run verification commands synchronously in the foreground.** No backgrounded test runs with polling output files.

## WALK-THROUGH SCENARIOS

### Scenario A — User navigates to History during offseason

User lands on `/league/tsc/history`. Page renders with HistorySubNav above (Overview tab active). Below the subnav, Championships section heads with "4 champions across 6 seasons · 11 still chasing." Below it, the dashboard row renders three columns: standings table on the left, podium blocks for 2025/2024/2023 in the middle, 5 record items on the right. Below that, Rivalries + Streaks row, then Movers, then Archive. No empty-state placeholders, no "Coming soon" copy on the Overview tab itself.

### Scenario B — User clicks "Full standings →" on Overview

The link routes to the Stats subtab placeholder route. The page renders under the same LeaguePageShell + HistorySubNav. The Stats subtab is now active in the subnav. Body renders a "Stats — Coming in Phase 3" placeholder. No 404, no error.

### Scenario C — User loads History on a brand-new league with 0 seasons

Championships section renders with empty state ("No champions yet — the league has not completed a season"). Dashboard row renders Standings as empty state, Podiums as empty state, Records as empty state. Page does not crash; sections degrade gracefully. The empty-state copy is the standard pattern used elsewhere in the app — do not invent new empty-state styling.

### Scenario D — A former owner appears in Championships, Rivalries, or Movers

FormerOwnerBadge renders inline next to the name, no special positioning treatment. The badge does not push other row content out of alignment. Champions sorted by title count then year — former owners sort naturally without special placement.

### Scenario E — Recent Podiums data shape is missing

The component renders a single-row empty state ("Recent podium data unavailable — see full season pages for podiums") with no broken layout. The final response of this prompt flags that the selector for top-3 finishers + wins/GB needs to be added in Phase 3.

## FINAL RESPONSE REQUIREMENT

Your final response must follow the standard reporting format:

### Files Changed

List every file modified, created, or deleted. For deletions, note whether the file had non-Overview imports (and how they were handled).

### Implementation Notes

- Confirmation that each section was implemented per spec
- Any deviations from the mockup or spec, with rationale
- Tailwind translations of any non-trivial CSS layout patterns (e.g., the flex `margin-left: auto` patterns)

### Data Wiring

For each of the 8 components in spec section 9, state:
- Selector used (or "stubbed with empty state — see flag below" if missing)
- Any data shape mismatches encountered

If any selector was missing and the component is stubbed, list those at the end of this section as Phase 3 follow-up work.

### Subtab Placeholder Status

Confirm Stats / Rivalries / Archive routes scaffolded, render under LeaguePageShell + HistorySubNav, and resolve via `resolveHistoryHref` without 404.

### Verification

- `npm run lint:all` result
- `npm test` result with explicit comparison to the 71-failure baseline ("failures held at 71" or "failures changed: now N")
- Vercel preview build status
- Screenshot or screen recording of the History Overview tab on the preview branch (or note that visual verification is pending user review)

### Open Questions

Anything that surfaced during implementation that needs PM/PO input before merging. Examples: which 5 records to surface in the Records column if the selector returns more than 5 with no priority field, edge cases on champion sorting, data model mismatches.

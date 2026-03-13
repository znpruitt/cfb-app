# AGENTS.md

## Project purpose

This repository contains a Next.js college football office pool web app.

The app is now **API-first** for game loading and live enrichment:

- **CFBD** is the source of truth for schedule and scores.
- **The Odds API** is the source of truth for betting odds.
- Local app data supports:
  - owners upload + cache
  - alias persistence + repair
  - diagnostics/manual intervention tooling
  - minimal static team reference metadata

Changes should favor low-risk, behavior-preserving refactors unless explicitly asked otherwise.

---

## Runtime flow (current)

Typical runtime flow:

1. Load aliases from server, with local fallback.
2. Restore local cached user artifacts (owners CSV, legacy schedule CSV fallback).
3. Fetch season schedule from CFBD-backed API route.
4. Load local teams catalog reference data.
5. Build normalized game identities and diagnostics.
6. Fetch odds via The Odds API adapter route.
7. Fetch scores via CFBD-backed scores route.
8. Surface diagnostics and allow alias repair workflows.

Notes:
- API-first schedule loading is the normal path.
- Legacy schedule CSV handling may exist as fallback/migration support and should not become primary again without explicit instruction.

---

## Architecture overview

### Main orchestrator

`src/components/CFBScheduleApp.tsx`

Responsibilities:

- hold top-level state
- coordinate bootstrap and refresh flows
- call schedule/scores/odds/team-catalog APIs
- coordinate alias and diagnostics workflows
- wire UI components together

Keep this file as an orchestrator. Do not move heavy parsing/matching logic into it.

### UI components

`src/components/` should contain focused rendering + UI handlers:

- `AliasEditorPanel.tsx`
- `IssuesPanel.tsx`
- `UploadPanel.tsx`
- `WeekControls.tsx`
- `GameWeekPanel.tsx`
- `TeamsDebugPanel.tsx`

### Reusable logic

Put shared/non-trivial logic in `src/lib/` (parsing, matching, transforms, diagnostics helpers, API client helpers).

### API routes

`src/app/api/` routes act as provider adapters:

- `schedule/` (CFBD-backed)
- `scores/` (CFBD-backed)
- `odds/` (The Odds API-backed)
- `teams/` (local teams catalog)
- `aliases/` (alias persistence)

Routes should normalize provider quirks and return stable app-facing structures.

---

## Static data

Static reference data lives in `src/data/`.

Canonical files:

- `src/data/teams.json` ← canonical team catalog source
- `src/data/alias-overrides.json` ← optional alias-derivation overrides for catalog generation script

Do not reintroduce `teams-<year>.json` / `teams-latest.json` copies unless there is a concrete, approved runtime behavior requirement.

---

## Core rules

1. **API-first schedule + scores**
   - CFBD-backed routes define schedule and score truth.
   - Do not silently reintroduce CSV-first schedule architecture.

2. **Odds provider boundary**
   - Odds data should flow through internal odds route adapters, not raw provider shapes in UI state.

3. **Alias persistence stability**
   - Preserve server alias loading, local fallback behavior, alias editing, and rebuild flows.

4. **Diagnostics are required**
   - Do not remove diagnostic surfaces that aid reconciliation debugging.

5. **Local caching remains intentional**
   - Preserve practical local cache behavior for owners/aliases and migration fallback artifacts unless explicitly asked to change it.

---

## File size / complexity guardrails

To prevent monolith regressions:

- React components: aim for < ~400 lines
- Library modules: aim for < ~500 lines
- If approaching ~600 lines, extract:
  - UI sections to `src/components/`
  - shared logic to `src/lib/`

Favor clarity and maintainability over clever abstractions.

---

## Validation and testing expectations

Preferred checks:

- `npm run lint`
- `npx tsc --noEmit`

Known pre-existing issue:

- A TypeScript issue exists in `src/components/TeamsDebugPanel.tsx`.
- Do not report it as a regression unless that file is modified.

When practical, verify key runtime flows still behave:

- API schedule load
- odds refresh
- scores refresh
- owners upload/caching
- alias editor + diagnostics panel
- week filtering

---

## Reporting expectations for Codex tasks

When completing work, report clearly:

1. What changed
2. Which files changed
3. Whether behavior changed
4. Risks / follow-up suggestions
5. Lint and type-check results
6. Any known unrelated failures

Be explicit and accurate.

---

## Guiding principle

Optimize for:

- clarity
- maintainability
- predictability
- low surprise
- incremental improvement

Prefer understandable code over large rewrites.

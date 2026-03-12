# AGENTS.md

## Repo purpose

- This repository hosts a Next.js CFB office-pool app centered on schedule CSV ingestion, owner mapping, alias reconciliation, and live odds/scores refresh.
- The app is intentionally CSV-first for schedule/owners data in current refactor phases.

## Key app flow

1. Load alias map from `/api/aliases` (with seed fallback/caching).
2. Restore cached schedule/owners CSV text from `localStorage` when available.
3. Parse schedule CSV + reconcile names via alias map and team catalog fallback.
4. Parse owners CSV and map teams to owners.
5. Refresh odds and scores from API routes and surface diagnostics.
6. Stage alias fixes from diagnostics and persist aliases back via `/api/aliases`.

## Important files and directories

- `src/components/CFBScheduleApp.tsx`
  - Main orchestrator for app state + wiring.
- `src/components/AliasEditorPanel.tsx`
- `src/components/IssuesPanel.tsx`
- `src/components/UploadPanel.tsx`
- `src/components/cfbScheduleTypes.ts`
- `src/lib/teamNames.ts`
- `src/lib/csv.ts`
- `src/lib/parseOwnersCsv.ts`
- `src/lib/parseScheduleCsv.ts`
- `src/lib/odds.ts`
- `src/lib/scores.ts`
- `src/lib/aliasStaging.ts`
- `src/lib/rebuildGames.ts`
- `src/app/api/*`
  - Backing routes for aliases, teams, odds, and scores.

## Local commands

- Dev server: `npm run dev`
- Lint: `npm run lint`
- Type check: `npx tsc --noEmit`
- Build: `npm run build`

## Known issue (pre-existing)

- `npx tsc --noEmit` currently fails due to a pre-existing TS issue in:
  - `src/components/TeamsDebugPanel.tsx`
- Treat that as unrelated unless a task explicitly asks to fix it.

## Refactor constraints

- Preserve CSV-first workflow for schedule/owners ingestion.
- Preserve `localStorage` caching behavior.
- Prefer low-risk extractions and small reviewable diffs over redesign.
- Do not silently change business rules.
- Do not remove diagnostics/alias staging features unless explicitly requested.

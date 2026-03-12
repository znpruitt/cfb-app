# AGENTS.md

## Project purpose

This repository contains a Next.js college football office pool web app.

The app is currently CSV-first:

- A Schedule CSV defines the season schedule.
- An Owners CSV maps teams to pool participants.
- The app enriches loaded games with live odds and scores fetched from internal API routes.
- Team name reconciliation is handled through normalization, alias maps, and provider matching logic.

The system functions primarily as a data reconciliation tool that overlays live sports data on a user-provided schedule.

Changes should favor low-risk, behavior-preserving refactors unless a task explicitly requests architectural or product changes.

---

# Product flow

The typical runtime flow is:

1. Load alias map from server or fallback data.
2. Restore cached CSV data from localStorage if available.
3. Parse the Schedule CSV into internal Game objects.
4. Parse the Owners CSV into roster ownership mappings.
5. Reconcile CSV team names into canonical team identities.
6. Fetch odds and scores from API routes.
7. Match provider data back onto games.
8. Surface diagnostics for mismatches.
9. Allow alias repair through UI tools.
10. Persist alias changes and rebuild game keys when necessary.

This workflow is intentional and should not be changed without explicit instruction.

---

# Architecture overview

## Main orchestrator

src/components/CFBScheduleApp.tsx

Responsibilities:

- Own top-level application state
- Coordinate CSV parsing
- Coordinate alias reconciliation
- Trigger odds and scores refresh
- Manage caching and bootstrap behavior
- Wire together UI components

This file should remain an orchestration layer, not a location for heavy logic.

---

# UI components

The UI is split into focused components:

src/components/

- AliasEditorPanel.tsx  
- IssuesPanel.tsx  
- UploadPanel.tsx  
- WeekControls.tsx  
- GameWeekPanel.tsx  
- TeamsDebugPanel.tsx  

These components should primarily contain:

- UI rendering
- simple display helpers
- event handlers passed from the parent component

Business logic should not accumulate here.

---

# Library helpers

Reusable logic lives in:

src/lib/

- teamNames.ts  
- csv.ts  
- parseOwnersCsv.ts  
- parseScheduleCsv.ts  
- odds.ts  
- scores.ts  
- aliasStaging.ts  
- rebuildGames.ts  
- aliasesApi.ts  
- gameUi.ts  
- diagnostics.ts  

These files contain:

- parsing
- matching
- alias logic
- data transformations
- UI status helpers
- diagnostics types

New reusable logic should be placed here when possible.

---

# API routes

The application exposes internal endpoints:

src/app/api/

- aliases/
- teams/
- scores/
- odds/

These routes act as provider adapters and should:

- normalize external API data
- provide stable internal data structures
- avoid leaking provider-specific quirks to the UI

---

# Static data

Reference data lives in:

src/data/

- alias-overrides.json
- teams-2025.json
- teams-latest.json

These files contain:

- known alias overrides
- team metadata
- reference catalogs used for reconciliation

They should remain stable and deterministic.

---

# Core business rules

## 1. CSV-first architecture

The application is intentionally CSV-first.

This means:

- The schedule CSV defines the game universe.
- Owners CSV defines pool participants.
- API calls enrich the schedule rather than replacing it.

Do not silently migrate the app to API-first schedule loading.

---

## 2. Alias persistence

Alias handling is central to the system.

Alias behavior must preserve:

- server alias map loading
- local alias cache fallback
- alias staging before persistence
- alias editing UI
- rebuild of game keys when aliases change

Alias workflows should remain stable unless explicitly redesigned.

---

## 3. Local caching

The app caches important data in localStorage:

- schedule CSV
- owners CSV
- alias map

This allows the app to restore state on reload.

Do not remove or alter caching behavior without clear instruction.

---

## 4. Diagnostics system

Diagnostics are used to expose reconciliation issues.

Current diagnostics include:

- score misses
- week mismatches
- general issues
- alias staging suggestions

Diagnostics are important debugging tools and should not be removed.

---

## 5. FBS filtering behavior

The score matching logic intentionally filters out irrelevant FCS vs FCS noise when possible.

Provider score rows that do not involve FBS teams may be ignored during matching.

This behavior is intentional and should be preserved.

---

# Schedule CSV format

The schedule CSV is a matrix schedule format.

Expected columns:

Conference, Team, Week 0..Week N

Cell semantics:

@ Opponent   → Away game  
vs Opponent  → Neutral site  
Opponent     → Home game  
BYE          → Bye week  

The parser:

- reads team rows
- detects week columns
- interprets cell contents
- merges duplicate observations
- detects conflicts
- builds internal Game objects

This logic lives in parseScheduleCsv.

---

# Team identity reconciliation

Team identity resolution can involve:

- raw CSV names
- canonical school names
- alias map lookups
- normalized string variants
- team catalog alternate names
- mascot variants
- provider labels

Matching logic must remain tolerant and conservative to avoid data mismatches.

Do not aggressively tighten matching rules without careful review.

---

# Schedule parsing guardrail

Schedule parsing must never leave stale UI state.

If parseScheduleCsv returns zero valid games, the application must clear all schedule-derived state before returning.

This includes resetting:

- games
- weeks
- byes
- conferences
- selectedWeek
- scoresByKey
- oddsByKey

Leaving these populated would cause stale schedule data from previously loaded CSV files to remain visible.

This bug was previously caught during PR review and fixed.  
Future changes must preserve this behavior.

---

# Component design rule

CFBScheduleApp.tsx is the application orchestrator.

It should primarily:

- coordinate state
- coordinate parsing
- coordinate refresh flows
- wire UI components together

Heavy logic should live in src/lib.

The component should not grow back into a large monolithic file unless explicitly necessary.

---

# Refactor philosophy

Favor small, low-risk refactors.

Good refactors include:

- extracting UI sections into components
- moving helpers to src/lib
- removing duplicated helper logic
- improving clarity and comments
- improving state visibility

Avoid:

- large rewrites
- speculative architectural changes
- silently altering product behavior
- removing diagnostics
- converting CSV-first architecture to API-first

Readable code is preferred over clever abstractions.

---

# Validation and testing

Preferred checks:

npm run lint  
npx tsc --noEmit

Known current issue:

A pre-existing TypeScript error exists in:

src/components/TeamsDebugPanel.tsx

Do not report this error as a regression unless that file is modified.

---

# Runtime verification

When practical, ensure these flows still work:

- schedule CSV upload
- owners CSV upload
- cached CSV restoration
- odds refresh
- scores refresh
- alias editor
- diagnostics panel
- week filtering

If browser automation is unavailable or crashes, report it clearly.

---

# Git workflow

Preferred workflow:

- implement changes on a branch
- create a pull request
- allow review before merge

If the runtime cannot push to GitHub:

- state this clearly
- provide a patch or diff artifact

Avoid leaving untracked changes inside isolated environments.

---

# Reporting expectations

When completing work, report:

1. What changed
2. Which files changed
3. Whether behavior changed
4. Risks or follow-up suggestions
5. Lint/type-check results
6. Any known unrelated failures

Be explicit and accurate.

---

# Guiding principle

This project is maintained by an engineer using AI assistance to build and maintain a hobby application.

Code changes should optimize for:

- clarity
- maintainability
- predictability
- low surprise
- incremental improvement

Prefer understandable code over clever solutions.

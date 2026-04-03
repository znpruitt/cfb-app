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

## Phase status

- Phase 1 (architecture stabilization): Complete.
- Phase 2 (core league surfaces + UX/engagement + visual sweep): Substantially complete. Phase 2D form dots polish in PR #183.
- Active focus: Phase 2D close-out, then planning pause before Phase 3.

---

## Runtime flow (current)

Typical runtime flow:

1. Load aliases from server, with local fallback.
2. Restore local cached user artifacts (owners CSV).
3. Fetch season schedule from CFBD-backed API route.
4. Load local teams catalog reference data.
5. Build normalized game identities and diagnostics.
6. Fetch odds via The Odds API adapter route.
7. Fetch scores via CFBD-backed scores route.
8. Surface diagnostics and allow alias repair workflows.

Notes:
- API-first schedule loading is the only supported schedule path.

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

Schedule-derived game attachment for live scores and odds should be implemented in shared lib helpers,
not duplicated in route handlers or UI components.

### Selectors (`src/lib/selectors/`)

All derived data — standings, insights, trends, matchup context, storylines — is computed in `src/lib/selectors/`. This is the **single source of derived truth** for the entire app.

Selectors are pure functions: same inputs always produce the same outputs. No side effects, no API calls, no database access.

Key selectors:

| File | Purpose |
|------|---------|
| `insights.ts` | League insights (movement, surge, collapse, race, etc.) — shared by Overview and Standings |
| `overview.ts` | Full Overview page view model (hero, podium, standings context, live items) |
| `trends.ts` | Games Back trend, week-over-week position deltas, week labels |
| `matchups.ts` | Head-to-head context per matchup |
| `storylines.ts` | Contextual narratives |
| `standingsMovement.ts` | Rank delta per owner |
| `momentum.ts` | Recent form derivation |

UI components may perform lightweight presentation-layer logic (filtering, sorting already-derived arrays for display). They must not recompute league state inline.

### API routes

`src/app/api/` routes act as provider adapters:

- `schedule/` (CFBD-backed)
- `scores/` (CFBD-backed)
- `odds/` (The Odds API-backed)
- `teams/` (local teams catalog)
- `aliases/` (alias persistence)

Routes should normalize provider quirks and return stable app-facing structures.
Team canonicalization and schedule-game attachment belong in shared identity/attachment helpers in `src/lib/`.

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
   - Preserve practical season-scoped local cache behavior for owners/aliases unless explicitly asked to change it.

6. **Structured prompt headers are required for Codex prompts**
   - Every new project Codex prompt should begin with:
     - `PROMPT_ID`
     - `PURPOSE`
     - `SCOPE`
   - Use this standard ID format: `<PHASE>-<AREA>-<SHORT_NAME>-v<version>`
   - IDs should be human-readable and stable for later reference.
   - Bump the version when behavior or scope changes materially.
   - Minor wording-only edits may keep the same version if task intent is unchanged.
   - In follow-up discussion, reference prior prompts by explicit `PROMPT_ID` (avoid vague references like “that earlier prompt”).
   - See `docs/prompt-registry.md` for the template, registry tracking, and populated prompt list.

7. **Centralized team identity**
   - All team matching must go through `src/lib/teamIdentity.ts`.
   - No duplicate matching logic in route handlers, UI components, or other lib modules.

8. **Postseason canonical week**
   - Postseason weeks from CFBD restart numbering from 1, colliding with regular-season week numbers.
   - Canonical week is computed as: `canonicalWeek = maxRegularSeasonWeek + providerWeek`
   - This prevents Set deduplication from collapsing postseason games into regular-season week slots.
   - `providerWeek` must be preserved alongside `canonicalWeek` — score attachment traces by `providerWeek`.
   - **Never revert or bypass this calculation.** Doing so will silently break postseason trend charts and score attachment.
   - Implementation: `src/lib/schedule.ts` (`buildScheduleFromApi`). Score attachment safety: `src/lib/scoreAttachment.ts` indexes by both `canonicalWeek` and `providerWeek`.

9. **Selector architecture**
   - All derived league data must be computed in `src/lib/selectors/`. Never inline in UI components.
   - Selectors are pure functions: same inputs → same outputs. No side effects, no API calls.
   - Any derivation found outside `src/lib/selectors/` is an architecture violation.
   - See the Selectors section in Architecture overview for the full catalog.

10. **Roster Upload Fuzzy Matching is Upload-Layer Only**
    - Team name fuzzy matching for owner roster CSV uploads is handled in the upload validation pipeline — not in `teamIdentity.ts`.
    - `teamIdentity.ts` handles runtime identity resolution from already-clean data. The two concerns must remain separated.
    - The FBS-only match pool constraint applies to roster uploads only — schedule and game identity resolution uses the full team catalog including FCS opponents.
    - Confirmed fuzzy matches and manual selections are saved as global aliases; the upload pipeline must not write unresolved teams to storage.

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

## Auth Architecture Invariants

These rules apply from Phase 6 onward and must not be violated:

1. **Clerk is the auth provider** — no other auth systems, no custom session handling, no roll-your-own JWT verification.

2. **Three roles defined in Clerk `publicMetadata`**: `platform_admin`, `commissioner`, `member`. Role storage shape: `{ role: 'platform_admin' | 'commissioner' | 'member' }`. Commissioner league scoping: `{ role: 'commissioner', leagues: ['tsc', 'family'] }` — defined now, enforced in Phase 7.

3. **Route protection via Clerk middleware only** — never roll custom auth middleware. The single Clerk middleware instance in `middleware.ts` is the only place route-level auth rules live.

4. **API routes use `requireAdminAuth(req)`** — this helper checks Clerk JWT first, falls back to `ADMIN_API_TOKEN` during the Phase 6 transition period. It is a drop-in replacement for the old `requireAdminRequest()`. All new admin API routes must support Clerk JWT from day one.

5. **`ADMIN_API_TOKEN` fallback is temporary** — it exists only for Phase 6 backward compatibility. It will be removed in Phase 7. Do not build new flows that depend on it.

6. **Never hardcode role checks outside middleware and `requireAdminAuth()`** — no inline `publicMetadata.role` comparisons in UI components or API handlers. All role assertions go through the designated helpers.

7. **Commissioner scoping is enforced in Phase 7** — `/league/[slug]/draft/*` will require `platform_admin` or `commissioner` with a matching slug. Do not implement this in Phase 6; do not design against it being absent in Phase 7.

---

## Guiding principle

Optimize for:

- clarity
- maintainability
- predictability
- low surprise
- incremental improvement

Prefer understandable code over large rewrites.

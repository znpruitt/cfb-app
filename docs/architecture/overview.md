# Architecture Overview

Status: Current
Last verified: 2026-07-09
Owner: Project documentation
Canonical for: high-level runtime architecture, data-flow overview, source-of-truth hierarchy, architecture-doc index
Supersedes: (none — complements `AGENTS.md`; the `docs/CFB_APP_ARCHITECTURE.md` pipeline sketch is the one-line version of the data flow below)

This is the entry point for **current** runtime architecture. `AGENTS.md` remains the binding source for architecture invariants and agent operating rules; this doc and its siblings under `docs/architecture/` describe how the running system fits together so you don't have to reconstruct it from campaign retrospectives or audit prompts.

## High-level structure

A Next.js (App Router) college-football office-pool app. It is **API-first**: CFBD is the upstream source of truth for schedule and scores, The Odds API for betting odds. A small managed Postgres (`app_state`) holds durable shared state (aliases, owner rosters, postseason overrides, team-database snapshot, cached provider snapshots). Members read shared cached state; season-persistent data changes only through admin/commissioner flows.

- **`src/app/`** — routes. `src/app/api/*` are provider adapters (`schedule`, `scores`, `odds`, `teams`, `aliases`, `owners`, `debug/*`, `cron/*`); `src/app/league/[slug]/*` and `src/app/admin/*` are the pages.
- **`src/components/CFBScheduleApp.tsx`** — the client orchestrator: holds top-level state, coordinates bootstrap/refresh, wires UI. Not a place for parsing/matching logic.
- **`src/lib/`** — shared logic: identity resolution, schedule build, score/odds attachment, server data access, auth helpers.
- **`src/lib/selectors/`** — the single home for derived view models (standings, insights, trends, matchups). Pure functions, no I/O.
- **`src/data/teams.json`** — canonical team catalog.

## The canonical data flow

The one rule that anchors everything:

```
schedule → canonical games → scores / odds / ownership attach
```

The CFBD **schedule is the source of truth for the game universe.** `buildScheduleFromApi` constructs canonical `AppGame` identities from it, resolving team identity through `src/lib/teamIdentity.ts`. Scores, odds, and ownership then **attach onto** those schedule-derived games — they never construct game identity independently. Diagnose in this same upstream-first order (see [diagnostics](../operations/diagnostics.md)):

```
API response → normalization layer → canonical game model → attachment layers → UI
```

## Source-of-truth hierarchy

| Concern | Source of truth |
|---------|-----------------|
| Game universe / identity | CFBD schedule → canonical `AppGame` (`buildScheduleFromApi`) |
| Team-name canonicalization | `src/lib/teamIdentity.ts` (sole boundary) |
| Current-season ownership attribution | `src/lib/gameOwnership.ts` (overlay on canonical games) |
| Standings (rows, history, color order, owner identity, lifecycle) | `getCanonicalStandings` (server) |
| Live in-progress annotations | client `LiveDelta` overlay (never merged into canonical at render time) |
| Scores / odds | CFBD / The Odds API, attached to canonical games; public reads are cache-only |
| User identity + app role | Clerk (`platform_admin` / `commissioner` / `member`) |
| Per-league page access | league password gate (`LEAGUE_AUTH_SECRET`) — separate from Clerk, grants no role |

## Deeper architecture docs

- [game-data-flow.md](game-data-flow.md) — schedule → canonical games, score/odds attachment, provider cache/quota policy.
- [identity-and-ownership.md](identity-and-ownership.md) — `teamIdentity.ts`, alias precedence, `gameOwnership.ts`, CSV's role.
- [standings.md](standings.md) — canonical standings authority, LiveDelta, NoClaim, cache invalidation, lifecycle states.
- [auth-and-privacy.md](auth-and-privacy.md) — Clerk vs `ADMIN_API_TOKEN` vs league password; route/API auth.
- [storage-and-caching.md](storage-and-caching.md) — `app_state` store, alias/standings cache keys/tags, provider caches.
- Operations: [deployment.md](../operations/deployment.md), [diagnostics.md](../operations/diagnostics.md).

## Current docs vs historical docs

These `docs/architecture/` and `docs/operations/` docs describe **current** behavior and are the authority for their topics. Campaign retrospectives (`docs/campaigns/**`) and the archived audits/design-specs/prompt records under `docs/archive/**` (see [`docs/archive/README.md`](../archive/README.md)), along with `docs/completed-work.md`, are **historical records** — accurate as of their time, useful for "why," but not current implementation authority. `docs/archive/governance/cfb-engineering-operating-instructions.md` is Historical/superseded. See [`docs/README.md`](../README.md) for the full source-of-truth map and doc lifecycle statuses.

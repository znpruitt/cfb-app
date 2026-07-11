# Game Data Flow

Status: Current
Last verified: 2026-07-09
Owner: Project documentation
Canonical for: schedule → canonical games, score/odds attachment, public cache-reader + authorized-refresh policy, provider quota
Supersedes: (none — complements `AGENTS.md` Core rules #1, #7, #8)

The whole system hangs off one direction of flow:

```
CFBD schedule → canonical AppGame → scores / odds attach onto those games
```

Score and odds layers **attach onto** schedule-derived canonical games; they never construct game identity independently.

## Schedule is the source of truth

`buildScheduleFromApi(...)` (`src/lib/schedule.ts`) builds canonical `AppGame[]` from the CFBD schedule wire items, resolving every team through the centralized `createTeamIdentityResolver({ teams, aliasMap, observedNames })` (see [identity-and-ownership.md](identity-and-ownership.md)). Each `AppGame` carries `week`, `providerWeek`, `canonicalWeek`, and `providerGameId`.

**Postseason canonical week** is computed as `canonicalWeek = maxRegularSeasonWeek + providerWeek`, applied only when there's regular-season context. `providerWeek` is **always preserved** alongside `canonicalWeek` because score/odds fetching and attachment trace by `providerWeek`.

## Score attachment (`src/lib/scoreAttachment.ts`)

`buildScheduleIndex` indexes the canonical games four ways — by `providerGameId`, home/away+week, pair+week, and pair+date — with week indexes keyed by **both** `canonicalWeek` and `providerWeek`. `matchScoreRowToSchedule` attaches by precedence:

1. **Provider event id** — strongest and hydration-independent (so a placeholder bowl/CFP slot is still attachable). Accepted only when every *known* schedule side resolves to the correspondingly-positioned row team (orientation must be `direct`); a reversed/unresolvable side declines and falls through, preventing a swapped positional attach.
2. **Team-resolved fallbacks** — exact home/away+week, then reversed pair+week, then pair+date (±18h).

Match orientation (`direct`/`reversed`) is tracked so scores are stored in schedule orientation.

## Odds attachment (`src/lib/oddsAttachment.ts`)

`attachOddsEventsToSchedule` is event-centric and schedule-canonical: **odds never create canonical identities** — only games already present in the schedule can be returned. Each event's pair is resolved via `resolver.buildPairKey`, narrowed to candidates within `±24h` of `commenceTime`, and attached **one-to-one**: an already-claimed game is never overwritten; zero candidates → `date_mismatch`/`unmatched_pair`, more than one → `ambiguous_pair` (it refuses to guess).

## Public cache-reader policy (PLATFORM-075)

**Public reads must not spend provider quota.** The public `/api/scores` and `/api/odds` surfaces are **pure cache readers**: an anonymous request serves fresh cache, else stale cache, else a controlled empty/stale response — it **never** triggers a cold-cache upstream fetch.

Only an **authorized refresh** spends quota. Both routes gate on `refresh=1` behind `requireAdminAuth` (see [auth-and-privacy.md](auth-and-privacy.md)): the upstream CFBD/ESPN/Odds fetch lives *only* in the authorized branch. `/api/schedule` follows the same shape via `bypassCache=1` (admin-gated); a non-admin cache miss serves stale or asks for an admin refresh rather than fetching.

- **Authorized refresh / cron keeps caches warm** — platform admin, server cron, or `ADMIN_API_TOKEN` may refresh; `GlobalRefreshPanel` and `/api/debug/*` score diagnostics forward `refresh=1` + admin auth.
- **The league password grants no fetch authority** — unlocking a passworded league never authorizes quota spend; that gate is solely `requireAdminAuth`.

**Provider refreshes publish durable cache before process memory (PLATFORM-085A).** On an authorized refresh, each provider route/store persists the durable app-state snapshot first, then updates its process-local cache, then invalidates dependent standings — never memory-first. A failed durable write therefore surfaces as an error and leaves the process cache untouched, so it can never make one instance report "fresh" schedule/scores/odds that durable storage (and other instances) don't have. See [storage-and-caching.md](storage-and-caching.md) → "Durable-first commit order".

**Public scores and canonical consumers share ONE cache-only season score reconciliation (PLATFORM-084B).** Scores cache under a season-wide key (`${year}-all-${seasonType}`) and per-week keys (`${year}-<week>-${seasonType}`). The shared reader `loadReconciledSeasonScores` (`src/lib/server/scoreCacheReader.ts`) merges the season-wide and per-week entries — deduped by canonical game identity (through `teamIdentity.ts`), newest cache entry winning — and is used by the public `/api/scores` season read, canonical standings, and the season-rollover archive build alike. So a week-specific refresh visible on `/api/scores` is now equally visible to standings, Insights, and archives. The reader is cache-only (no provider call); see [storage-and-caching.md](storage-and-caching.md) for the reconciliation mechanics.

## Provider quota constraints

CFBD is the source of truth for schedule/scores (~1000 calls/month free tier); The Odds API for odds (~500/month). The cache-reader policy exists to keep public/member traffic from exhausting these quotas; season-persistent data updates through admin/cron flows, not opportunistically from public reads.

## Non-negotiable

- Public reads never spend provider quota; authorized refresh/cron keep caches warm.
- Game identity is constructed once, in the schedule layer — score and odds layers attach to it and must not build identity independently. Team canonicalization and schedule-game attachment live in shared `src/lib/` helpers, never duplicated in route handlers or UI.

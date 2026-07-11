# Standings

Status: Current
Last verified: 2026-07-09
Owner: Project documentation
Canonical for: canonical standings authority, selector/LiveDelta boundaries, NoClaim, standings cache invalidation, lifecycle/preseason states
Supersedes: (none — complements `AGENTS.md` → Standings Ownership Invariants)

Standings are the app's highest-stakes derived data: getting them wrong (the historical "NoClaim at #1" bug) took eight remediation rounds. The architecture that replaced that keeps a single server source of truth and a strictly separate client overlay.

## Canonical standings are the source of truth

`getCanonicalStandings({ slug, year, currentDate })` (`src/lib/selectors/leagueStandings.ts`) is the single source of truth for standings **rows, history, owner color order, owner identity, and lifecycle**. No component, route, or helper derives this independently — every owner-record surface (Standings, Overview, Members, Trends, Insights, History live-year) consumes it. The `CanonicalStandings` snapshot carries `rows`, `noClaimRow`, `ownerColorOrder`, `standingsHistory`, `coverage`, `source`, `lifecycle`, `inferredSeasonStart`, and more.

**UI must not independently recompute league standings.** Presentation-layer filtering/sorting of already-derived arrays is fine; recomputing standings inline is an architecture violation.

## LiveDelta is a separate client overlay — never merged at render time

In-progress annotations (per-owner pending W–L badges) live in the client-only `LiveDelta`, computed by the pure `selectLiveDelta` / `useLiveDelta`. Consumers receive **canonical and `liveDelta` as separate props**: canonical defines what a row *says*; `liveDelta` defines what a badge *annotates next to it*.

- Never combine the two with a shape-readiness predicate ("if rows exist use X, else Y") inside a render function — that is exactly what caused the original bug.
- `LiveDelta` **excludes final games** (those are already in the canonical snapshot) and computes no projected rank/record/win%/differential. `canonical` is passed into the selector but not consumed by its computation.

## NoClaim is filtered at the source

`splitOutNoClaim` runs inside the derivation; the snapshot's `rows` **exclude** NoClaim, and NoClaim is exposed separately as `noClaimRow`. No consumer filters NoClaim out of an unfiltered array — a surface that needs it reads `noClaimRow` explicitly. `LiveDelta` likewise excludes NoClaim from its aggregates.

## Lifecycle & preseason states

The snapshot's `source` is one of `archive | live | preseason-names | preseason-awaiting-kickoff | empty`. Compute dispatches on lifecycle: `resolveOffseason` / `resolvePreseason` / `resolveSeason`.

For the preseason cold-cache case (shipped in Season Launch Hardening Phase 2), the empty season/preseason paths read `getScheduleProbeState(year)?.firstGameDate` and return a `preseason-awaiting-kickoff` snapshot carrying `inferredSeasonStart` (an ISO kickoff date), so the standings page never renders silently blank.

**Time-dependent classification belongs in consumers, not the cached selector.** The selector is `unstable_cache`-wrapped with tag-only invalidation, so it returns the time-invariant *fact* (the kickoff date string); consumers do the `now > inferredSeasonStart` check at render time (`CFBScheduleApp` `isAwaitingKickoff`, `StandingsPanel` `isStillBeforeKickoff`). After kickoff the cached snapshot collapses onto the same diagnostic copy as `source: 'empty'` until a mutation invalidates the tag. `currentDate` is captured at the request handler and passed through to `deriveLifecycleState` and downstream — never an implicit `new Date()` inside a selector.

## Caching & invalidation

`getCanonicalStandings` is `React.cache`-wrapped (per-request dedup) around an `unstable_cache` (cross-request, tag-only — `revalidate: false`). Every snapshot is tagged:

- `standings:all` (`ALL_STANDINGS_TAG`)
- `standings:${slug}`
- `standings:${slug}:${year}` (when year resolved)

The cache key bakes in `slug + resolved year` (via a closure) plus a seed-alias hash, so alias-seed changes bust snapshots. `currentDate` is intentionally **not** in the cache key.

Invalidation helpers:

- `invalidateStandings(slug, year?)` → `revalidateTag('standings:${slug}')` (+ the year tag when given).
- `invalidateAllLeaguesStandings()` → `revalidateTag('standings:all')`.
- `invalidateStandingsForYear(year)` → per-league `invalidateStandings(league.slug, year)` (scores are season-scoped, not league-scoped).

**Every mutation route that changes standings inputs calls one of these.** Verified wirings:

- **Team-database writes (PLATFORM-070)** → `invalidateAllLeaguesStandings()` (a team-DB change can affect any league); global-alias writes also bust it.
- **Cron + preseason (PLATFORM-071)** → `season-transition` and `season-rollover` crons call `invalidateStandings(slug)`; `confirmPreseasonOwners` / `beginPreseason` call `invalidateStandings(slug[, year])`.
- **Scores write path** → `invalidateStandingsForYear(year)` after each cache write.
- Also: owners CSV `PUT`, postseason overrides, draft confirm + pick edit, schedule admin refresh, backfill, rollover, year-scoped alias writes.
- Intentionally un-wired (documented): `completeSetup` (no standings-content change) and `slug='test'` dev tooling.

**Cache valid absence, never cache uncertainty (PLATFORM-084A).** The tag-only (`revalidate: false`) cache never expires on its own, so a snapshot built from a *failed* read would persist until a mutation happens to bust its tag. Compute therefore separates genuine absence (a legitimate, cacheable snapshot) from a store-read failure (must reject, so nothing bogus is cached):

- **Absence → valid default snapshot** (cacheable): no owners CSV → no roster (`live` returns `null`); empty cached schedule → roster-only 0-0; missing archive/probe/scores/aliases → the corresponding empty default; missing `preseason-owners` record → `null` → awaiting-kickoff.
- **Failure → reject** (never cached): every app-state read (`getLeague`, owners CSV, `listSeasonArchives`/`getSeasonArchive`, `getScopedAliasMap`, `loadManualOverrides`, `loadNormalizedScoreRows`, `getScheduleProbeState`, `getTeamDatabaseItems`, `getPreseasonOwners`) lets a real store error propagate; `unstable_cache` never persists a rejected promise, so the failure surfaces and the next request recomputes.

Two swallow-catches were removed to enforce this: `getPreseasonOwners` no longer converts a store failure to `null`, and `liveDeriveStandings` no longer catches a `getTeamDatabaseItems` failure into an empty catalog or a `buildScheduleFromApi` failure (over a **non-empty** schedule) into a roster-only 0-0 snapshot. The `getCanonicalStandings` cache wrapper itself only catches the `incrementalCache missing` invariant (non-RSC runtime → direct compute); every other error propagates.

## In-session finalized-game refresh (PLATFORM-080)

Because `LiveDelta` excludes final games and the RSC `canonicalStandings` prop is fixed for the render, a game finalizing during a live poll wouldn't update standings until navigation. `detectScoreFinalizations` (in `useLiveRefresh`) fires an `onGamesFinalized` callback — wired to `router.refresh()` — only on a **real non-final→final transition** (observed keys seeded from the watched score scope; never fires on first-seen-already-final or repeat finals). `router.refresh()` suffices because the `/api/scores` write path already invalidated the standings tag, so the recompute is **cache-only** — no client standings derivation and no upstream provider fetch (PLATFORM-075 intact).

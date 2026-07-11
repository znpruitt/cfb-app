# Storage & Caching

Status: Current
Last verified: 2026-07-10
Owner: Project documentation
Canonical for: app-state store, alias/app-state storage layout, provider caches, standings cache keys/tags, season archive read cache keys/tags, Insights output cache keys/tags/freshness, legacy-alias cleanup status
Supersedes: (none — complements [standings.md](standings.md) for the standings cache and [game-data-flow.md](game-data-flow.md) for provider caches)

Durable shared state is deliberately small and lives in one place; layered on top are request- and tag-scoped caches that keep public reads cheap and quota-safe.

## The app-state store (`src/lib/server/appStateStore.ts`)

A single key/value table, `app_state (scope text, key text, value jsonb, updated_at timestamptz, primary key (scope, key))`. Every durable read/write goes through this store, keyed by `(scope, key)`.

- **Backends:** Postgres when `DATABASE_URL` is set; otherwise a local JSON file fallback (`data/app-state.json`) for dev, and a per-pid temp file under `APP_STATE_TEST_ISOLATION=1` for tests.
- **Production requires Postgres.** `getAppStateStorageStatus()` reports `mode`: `postgres` (DB configured), `production-misconfigured` (`NODE_ENV=production` with no `DATABASE_URL`), or `file-fallback` (dev). In the misconfigured mode the store **throws** rather than silently using the file fallback — production must never run on the file store.
- **Read-only tolerance is narrow:** the `create table if not exists` bootstrap is tolerated on a read-only connection only for SQLSTATE 25006 *and* only when the table already exists (so dry-run inspection works against a read replica); a genuine write path (`assertAppStateWritable()`) never tolerates read-only.

### Scope layout (examples)

| Scope | Holds |
|-------|-------|
| `aliases:global` (key `map`) | stored global alias map (top runtime layer) |
| `aliases:${year}` | year-scoped alias layer |
| `aliases:${slug}:${year}` | **legacy** league-scoped aliases — not read at runtime (see below) |
| `aliases:global` (key `migration-done`) | migration sentinel |
| `owners:${slug}:${year}` (key `csv`) | current-season owner roster CSV |
| `preseason-owners:${slug}` | preseason owner names |
| `schedule` | cached canonical schedule items (per year) |
| (others) | league registry, durable odds snapshots, team-database snapshot, odds-usage, feedback |

## Alias storage

The stored global map lives at `aliases:global`/`map`; the year layer at `aliases:${year}`. Runtime resolution (`getScopedAliasMap`) reads only the global + year scopes plus the code seeds — precedence **stored global > year > SEED** (see [identity-and-ownership.md](identity-and-ownership.md)). Writes are serialized behind a write lock; a `migration-done` sentinel (`aliases:global`/`migration-done`) records the one-time year→global promotion.

## Standings cache

`getCanonicalStandings` layers `React.cache` (per-request dedup) over `unstable_cache` (cross-request, tag-only — no time expiry). Snapshots are tagged `standings:all`, `standings:${slug}`, and `standings:${slug}:${year}`; the cache key bakes in `slug + resolved year` and a seed-alias hash. Invalidation is tag-based (`invalidateStandings`, `invalidateAllLeaguesStandings`, `invalidateStandingsForYear`) — see [standings.md](standings.md) for which mutation paths call which.

**Cache valid absence, never cache uncertainty** (PLATFORM-084A). Because the standings cache is tag-only (`revalidate: false`), a snapshot persists until a mutation busts its tag — so a snapshot computed from a *failed* read would stick indefinitely. Every app-state read in the compute path therefore distinguishes genuine absence (cacheable) from a store-read failure (must reject): `getAppState` returns `null` only when the row is absent and throws on a real failure. `getLeague`, the owners-CSV read, `listSeasonArchives`/`getSeasonArchive`, `getScopedAliasMap`, `loadManualOverrides`, `loadNormalizedScoreRows`, `getScheduleProbeState`, `getTeamDatabaseItems`, and `getPreseasonOwners` all let a failure propagate; only genuine absence degrades to a valid default (empty roster / 0-0 rows / bundled team catalog / awaiting-kickoff). Two gaps were closed here: `getPreseasonOwners` no longer swallows a store failure to `null` (which would cache "no preseason owners"), and `liveDeriveStandings` no longer catches a `getTeamDatabaseItems` failure into an empty catalog or a `buildScheduleFromApi` failure into a roster-only 0-0 snapshot — both were indistinguishable from valid absence and would be persisted. A rejected compute is never stored by `unstable_cache`, so the failure surfaces and the next request recomputes. (The still-legitimate absence path is preserved: an empty *cached schedule* — schedule not fetched yet — still yields a roster-only snapshot; only a build failure over a *non-empty* schedule now rejects.)

## Season archive read cache

`getSeasonArchive(slug, year)` and `listSeasonArchives(slug)` (`src/lib/seasonArchive.ts`) layer `React.cache` (per-request dedup) over `unstable_cache` (cross-request, tag-only — no time expiry), mirroring the standings cache. Season archives are persisted, effectively-immutable snapshots (written at rollover/backfill, only overwritten by a deliberate re-backfill of the same year), so the read output depends solely on `(slug, year)` — the alias/roster/owner-label state is baked into the snapshot at write time and is **not** part of the cache key. This removes repeated Postgres reads on the hot history/insights paths (Insights career context reads every archived year; the standings selector reads the offseason/final archive) without a self-fetch or provider call.

Cache keys: `['season-archive', slug, year]` for a single archive, `['season-archive-years', slug]` for the year list. Tags: a per-year read carries `archive:${slug}` and `archive:${slug}:${year}`; the year list carries `archive:${slug}`. Invalidation is centralized in `saveSeasonArchive` — it calls `invalidateSeasonArchive(slug, year)` (busts both tags, so the slug tag alone refreshes the year list plus every per-year entry) after the write. Because every writer (admin backfill, admin rollover, cron season-rollover) goes through `saveSeasonArchive`, no per-call-site wiring is needed and a stale archive can never poison a recomputed standings snapshot. Outside Next's RSC runtime (`node:test`) `unstable_cache` throws `incrementalCache missing`; both readers fall back to a direct store read. `saveSeasonArchive` ignores ONLY the out-of-request-context `revalidateTag` Invariant (`static generation store missing`, NEXT code `E263` — scripts/tests, no cache to bust); any other invalidation failure propagates, because the TTL-less cache would otherwise serve the previous archive indefinitely while the write reported success — surfacing it lets the admin/cron writer be retried.

**Failures are never cached.** The `unstable_cache` callbacks return `null` / `[]` only for a genuine miss (`getAppState`/`listAppStateKeys` distinguish "row/scope absent" from "read failed"); a transient store/database error is allowed to reject out of the callback, so `unstable_cache` never persists a bogus `null`/`[]` under `revalidate: false`. This matters twice: history would otherwise stay missing until the next write/deploy after a blip, and a backfill inspecting `getSeasonArchive` before writing must never read a cached `null` as "no existing archive" and overwrite one without confirmation.

## Insights output cache

`loadInsightsForLeague` (`src/lib/insights/loadInsights.ts`) caches the **expensive half** of Insights — loading every input, building the `InsightContext`, and running the 26 generators to a raw (pre-suppression) insight set — via `React.cache` over `unstable_cache`. The engine is split (`src/lib/insights/engine.ts`) into `generateRawInsights` (pure, deterministic in `context` → cacheable) and `applySuppression` (stateful: reads + writes the suppression store, output depends on how many times it has run). **Suppression runs per request against the cached raw set, never inside the cache** — so the "fire once, then fade" behavior is byte-for-byte unchanged while the per-page-visit recompute is eliminated. `bypassSuppression` (admin/diagnostic) runs a different generator set and writes no records, so it is computed directly and not cached.

Cache key: `['insights', slug, resolvedYear, seeds:<SEED_ALIASES_HASH>]` (distinct leagues/years/seed-sets never share an entry; the seed hash mirrors the standings cache because identity resolution feeds context). Freshness is **tag-first with a TTL backstop**:

- **Tags** — the entry deliberately carries the canonical standings tags (`standings:all`, `standings:${slug}`, `standings:${slug}:${year}`, via the shared `standingsSlugTag`/`standingsYearTag` helpers). Insights output is a strict function of canonical standings plus the same upstream inputs, so every existing `invalidateStandings` / `invalidateAllLeaguesStandings` call — roster, alias, postseason, draft, schedule, scores/finalized-games, backfill, rollover, preseason, team-database — refreshes Insights immediately, with zero duplicate call-site wiring.
- **TTL** (`revalidate: 300`) — a backstop for the inputs that do NOT flow through standings invalidation: season rankings (`loadSeasonRankings`, lazily cached during read, so it cannot safely `revalidateTag`) and weekly game stats, plus pure wall-clock drift in lifecycle/recency classification (the pinned `currentDate` of the warming request). Both are cross-league and infrequent, so a 5-minute bound is safe.

**Failures are never cached** (PLATFORM-082A rule, extended by PLATFORM-084A): the store reads inside the compute (owners CSV, canonical standings, season archives, team catalog, preseason owners, aliases, postseason overrides, schedule/scores) are not wrapped in swallow-catches, so a transient failure rejects out of the cached callback and is never persisted as a bogus empty result; `loadInsightsForLeague` then returns a graceful `emptyResponse` **without** caching it. Only genuinely-*absent* inputs (missing schedule → 0-0, absent team-catalog record → bundled catalog, absent aliases/overrides → empty maps, missing rankings) degrade to defaults; a store-read *failure* on any of them propagates rather than degrading. Outside Next's RSC runtime (`node:test`) `unstable_cache` throws `incrementalCache missing`; the loader falls back to a direct compute.

**Entry points stay `force-dynamic`** (`/api/insights/[slug]`, `/league/[slug]/insights`): both perform per-request authorization (league password gate / admin session) and per-request suppression, so the route/page must render dynamically. `force-dynamic` governs full-route/static caching only — it does not disable `unstable_cache`, so the server-side compute is still cached. Neither entry point self-fetches (in-process reads, PLATFORM-077), so public reads spend no provider quota (PLATFORM-075).

Together with PLATFORM-082A (archive reads), this completes the **APPSTATESTORE-CACHING** campaign.

## Provider caches (scores / odds / schedule)

Scores, odds, and schedule each have durable app-state snapshots plus (for odds) an in-memory layer. Public reads serve these caches only and never trigger upstream fetches; authorized `refresh=1` / `bypassCache=1` (admin/cron) refreshes them (see [game-data-flow.md](game-data-flow.md)). The team catalog is read per-request (`React.cache`) rather than a process-lifetime singleton, so an admin sync on one instance is observed cross-instance.

### Durable-first commit order (PLATFORM-085A)

Every provider refresh path that maintains a process-local cache alongside durable app-state **persists durably first, then publishes to process memory, then invalidates dependent caches** — never the reverse. Ordering:

```
provider fetch/normalize → await setAppState(...) (durable) → process-cache update → downstream invalidation → response
```

If the durable write throws, the process cache is **not** updated and standings invalidation does **not** run, so a failed persist can never leave one instance serving "fresh" provider data that other instances (and durable readers) cannot reproduce. The awaited durable write sequenced before the memory assignment is what enforces this: a throw short-circuits before the process cache is touched. Standings invalidation is likewise sequenced after the awaited write, so it only fires on a committed change.

Covered write paths: the scores route (`SCORES_CACHE`, both the CFBD and ESPN branches), the schedule route (`SCHEDULE_ROUTE_CACHE`), the raw odds cache (`oddsCache.entries`), the conferences route (`ConferencesRouteCache`), the durable canonical-odds store (`setDurableOddsStore` / `updateDurableOddsStore` → `memoryStore`), and the odds usage memo (`setLatestKnownOddsUsage`). Read paths that hydrate the process cache **from** a durable read (cache-warming on a hit) are unaffected — that data is already durable. Populating `unstable_cache` and stale-fallback reads are unchanged. This does not add or remove provider calls, and does not change PLATFORM-084A failure-vs-absence or PLATFORM-084B score-reconciliation behavior.

### Season score cache reconciliation (all + week keys, PLATFORM-084B)

Scores are cached under both a season-wide key (`${year}-all-${seasonType}`) and per-week keys (`${year}-<week>-${seasonType}`); an authorized refresh of a single week writes only that week's key. A **shared cache-only reconciliation** in `src/lib/server/scoreCacheReader.ts` reconciles the season-wide entry with every per-week entry for a `(year, seasonType)` in one bounded prefix read, deduping at the ROW level by canonical game identity (home/away pair resolved through `teamIdentity.ts` + UTC date) with the **newest contributing cache entry winning** per game (an empty newer entry contributes no rows, so it can never erase a populated one).

This one reconciliation is used by **all** season-level score consumers so they read the same cache keys and merge them the same way:

- public `/api/scores` season-wide read (`aggregateSeasonScoresResponse`) via `loadReconciledSeasonScores` (one `seasonType` per request);
- canonical standings (`loadNormalizedScoreRows`) and the season-rollover archive build (`buildSeasonArchive`) via `loadReconciledSeasonScoresByType`, which returns both season types from a **single** `${year}-` prefix read (partitioned in memory) rather than scanning twice.

The identity resolver used for dedup is caller-supplied (public route: bundled `teams.json`; canonical consumers: the synced team-DB catalog). Aliases are league-agnostic so they resolve identically; a difference in team **catalog** can only change how duplicate rows GROUP, and the downstream schedule attachment re-keys by canonical game, so it can never double-count — i.e. the read set and merge rule are identical across surfaces, catalog parity is not required.

Before this, canonical standings and the archive read only the `${year}-all-*` keys, so a week-specific refresh visible on `/api/scores` was invisible to standings/Insights/archives. The reconciliation is **cache-only** — it never contacts CFBD/ESPN and never writes; provider fetches remain solely on the authorized `refresh=1` path in `/api/scores` (PLATFORM-075). It also honors the PLATFORM-084A rule: `getAppStateEntries` returns an empty list only for a genuine miss and throws on a real store error, and the reader does not catch it — a failed read propagates (so a canonical consumer rejects rather than caching empty standings) while genuine absence (no scores before kickoff) returns no rows.

Known remaining consumer (follow-up, not a live-season risk): the draft page's prior-year score read still reads only `${priorYear}-all-*` keys; prior years are effectively-complete/archived, so the week-key mismatch does not arise in practice.

## Legacy league-scoped alias keys — cleanup status

`aliases:${slug}:${year}` keys are **deprecated**: since PLATFORM-067 runtime resolution never reads them (team aliases are not league-specific). PLATFORM-081 shipped a cleanup tool (`npm run cleanup:legacy-aliases`, dry-run by default, `--apply` gated) that deletes only keys proven redundant — every entry either a copied seed default or a manual repair whose exact target is already live in the global map — and structurally refuses to touch `aliases:global`, `aliases:${year}`, or non-alias scopes.

**The operator cleanup is complete:** running `--apply` against production deleted the three legacy keys `aliases:test:2025`, `aliases:test:2026`, and `aliases:tsc:2025`, and a confirmation dry-run found **zero** remaining legacy league-scoped alias keys.

Broader database cleanup beyond this legacy-alias sweep is **not** part of this architecture doc and is not currently scoped.

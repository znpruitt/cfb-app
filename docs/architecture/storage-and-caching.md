# Storage & Caching

Status: Current
Last verified: 2026-07-10
Owner: Project documentation
Canonical for: app-state store, alias/app-state storage layout, provider caches, standings cache keys/tags, season archive read cache keys/tags, legacy-alias cleanup status
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

## Season archive read cache

`getSeasonArchive(slug, year)` and `listSeasonArchives(slug)` (`src/lib/seasonArchive.ts`) layer `React.cache` (per-request dedup) over `unstable_cache` (cross-request, tag-only — no time expiry), mirroring the standings cache. Season archives are persisted, effectively-immutable snapshots (written at rollover/backfill, only overwritten by a deliberate re-backfill of the same year), so the read output depends solely on `(slug, year)` — the alias/roster/owner-label state is baked into the snapshot at write time and is **not** part of the cache key. This removes repeated Postgres reads on the hot history/insights paths (Insights career context reads every archived year; the standings selector reads the offseason/final archive) without a self-fetch or provider call.

Cache keys: `['season-archive', slug, year]` for a single archive, `['season-archive-years', slug]` for the year list. Tags: a per-year read carries `archive:${slug}` and `archive:${slug}:${year}`; the year list carries `archive:${slug}`. Invalidation is centralized in `saveSeasonArchive` — it calls `invalidateSeasonArchive(slug, year)` (busts both tags, so the slug tag alone refreshes the year list plus every per-year entry) after the write. Because every writer (admin backfill, admin rollover, cron season-rollover) goes through `saveSeasonArchive`, no per-call-site wiring is needed and a stale archive can never poison a recomputed standings snapshot. Outside Next's RSC runtime (`node:test`) `unstable_cache` throws `incrementalCache missing`; both readers fall back to a direct store read. `saveSeasonArchive` ignores ONLY the out-of-request-context `revalidateTag` Invariant (`static generation store missing`, NEXT code `E263` — scripts/tests, no cache to bust); any other invalidation failure propagates, because the TTL-less cache would otherwise serve the previous archive indefinitely while the write reported success — surfacing it lets the admin/cron writer be retried.

**Failures are never cached.** The `unstable_cache` callbacks return `null` / `[]` only for a genuine miss (`getAppState`/`listAppStateKeys` distinguish "row/scope absent" from "read failed"); a transient store/database error is allowed to reject out of the callback, so `unstable_cache` never persists a bogus `null`/`[]` under `revalidate: false`. This matters twice: history would otherwise stay missing until the next write/deploy after a blip, and a backfill inspecting `getSeasonArchive` before writing must never read a cached `null` as "no existing archive" and overwrite one without confirmation.

> Insights **output** caching (`loadInsightsForLeague`) remains deferred to PLATFORM-082B; only archive reads are cached here.

## Provider caches (scores / odds / schedule)

Scores, odds, and schedule each have durable app-state snapshots plus (for odds) an in-memory layer. Public reads serve these caches only and never trigger upstream fetches; authorized `refresh=1` / `bypassCache=1` (admin/cron) refreshes them (see [game-data-flow.md](game-data-flow.md)). The team catalog is read per-request (`React.cache`) rather than a process-lifetime singleton, so an admin sync on one instance is observed cross-instance.

## Legacy league-scoped alias keys — cleanup status

`aliases:${slug}:${year}` keys are **deprecated**: since PLATFORM-067 runtime resolution never reads them (team aliases are not league-specific). PLATFORM-081 shipped a cleanup tool (`npm run cleanup:legacy-aliases`, dry-run by default, `--apply` gated) that deletes only keys proven redundant — every entry either a copied seed default or a manual repair whose exact target is already live in the global map — and structurally refuses to touch `aliases:global`, `aliases:${year}`, or non-alias scopes.

**The operator cleanup is complete:** running `--apply` against production deleted the three legacy keys `aliases:test:2025`, `aliases:test:2026`, and `aliases:tsc:2025`, and a confirmation dry-run found **zero** remaining legacy league-scoped alias keys.

Broader database cleanup beyond this legacy-alias sweep is **not** part of this architecture doc and is not currently scoped.

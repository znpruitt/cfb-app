import { getAppState, listAppStateKeys, setAppState } from './appStateStore.ts';
import { SEED_ALIASES, type AliasMap } from '../teamNames.ts';
import { normalizeAliasLookup, normalizeTeamName } from '../teamNormalization.ts';

// ---------------------------------------------------------------------------
// Global alias store
// ---------------------------------------------------------------------------
// Global aliases are stored at scope='aliases:global', key='map'.
// They are not scoped to any league or year — confirmed fuzzy matches and
// manual roster upload selections are written here and apply to all future
// uploads across all leagues and years.
//
// Legacy year-scoped alias maps (scope 'aliases:${league}:${year}' or
// 'aliases:${year}') are DEPRECATED. migrateYearScopedAliasesToGlobal()
// reads them once and merges their entries into the global store. Legacy
// entries are left in place for backward compatibility with the runtime
// teamIdentity resolver which still reads league-scoped maps.
//
// The static SEED_ALIASES bundle (universal aliases like `ole miss` →
// `mississippi`) is migrated into the global store by
// migrateSeedAliasesToGlobal(), invoked lazily from BOTH getScopedAliasMap()
// and getGlobalAliases() (so scoped and direct global readers alike see the
// seeds without manual action), and again at the top of the legacy year-scope
// migration so seed-over-legacy precedence holds regardless of entry point.
// All global-map writes are serialized through withGlobalAliasWriteLock() with
// a re-read inside the lock, so concurrent read-modify-writes cannot clobber
// one another.
// ---------------------------------------------------------------------------

const GLOBAL_SCOPE = 'aliases:global';
const GLOBAL_KEY = 'map';
const MIGRATION_DONE_KEY = 'migration-done';
const SEED_MIGRATION_DONE_KEY = 'seed-migration-done';

// Process-local serialization for global-alias mutations. Every writer of
// `aliases:global/map` (seed migration, year-scoped migration, upsert) does a
// read-modify-write of the whole map, so concurrent writers could otherwise
// read a stale map and clobber each other's entries. Chaining all writes
// through this lock — and re-reading the current map *inside* the lock — makes
// each read-modify-write atomic within the process. (Cross-instance atomicity
// would require transactional KV support and is intentionally out of scope.)
let globalAliasWriteLock: Promise<unknown> = Promise.resolve();
function withGlobalAliasWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = globalAliasWriteLock.then(fn, fn);
  // Keep the chain alive regardless of success/failure so one rejected write
  // never wedges the lock.
  globalAliasWriteLock = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

/**
 * Raw read of the global alias map with no migration side effects. Used by the
 * migration/upsert writers (which must not re-trigger migrations — that would
 * recurse) and by the public `getGlobalAliases`.
 */
async function readGlobalAliasMapRaw(): Promise<AliasMap> {
  const record = await getAppState<AliasMap>(GLOBAL_SCOPE, GLOBAL_KEY);
  const map = record?.value;
  return map && typeof map === 'object' && !Array.isArray(map) ? (map as AliasMap) : {};
}

/**
 * Public global alias read. Ensures the static SEED_ALIASES have been migrated
 * into the global store first, so direct global readers (owner validation,
 * owner writes, Insights game building, the admin alias GET) see the seeds
 * without depending on a prior scoped read having run.
 */
export async function getGlobalAliases(): Promise<AliasMap> {
  await migrateSeedAliasesToGlobal();
  return readGlobalAliasMapRaw();
}

/**
 * Resolves the effective alias map for a league/year on the server by walking
 * the global store plus the deprecated league/year scopes.
 *
 * Precedence is global > league+year > year: the canonical global store wins on
 * key conflicts, because legacy league/year scopes are deprecated and
 * migrateYearScopedAliasesToGlobal() deliberately preserves existing global
 * entries — so a stale scoped mapping must not override the current global one.
 * This matches how the owners upload path merges aliases (global last/highest).
 * Among the two legacy scopes, the more specific league+year wins over year.
 *
 * Precedence is enforced by the resolver's canonical identity, NOT by raw key
 * text. The team-identity resolver keys aliases by `normalizeTeamName`
 * (space- and punctuation-stripping) and is first-wins, so two textually
 * different keys that normalize to the same identity (e.g. `gulf coast tech`
 * globally and `gulfcoasttech` in a legacy scope) would otherwise let the
 * lower-precedence scope win purely on insertion order. Collapsing by
 * normalized identity here guarantees the higher-precedence scope's target
 * survives regardless of key formatting. Exact-key conflicts are a subset of
 * this (same identity → global processed first wins), so this preserves the
 * prior exact-key behavior.
 *
 * Server-safe: reads only appState (no `localStorage`, no static-file fetch),
 * so it works during server render — unlike the browser-era loader in
 * `src/lib/aliases.ts`. Returns {} when no scope holds an alias map; never
 * throws on missing data, so an empty result cannot masquerade as an unrelated
 * failure in callers.
 */
export async function getScopedAliasMap(leagueSlug: string, year: number): Promise<AliasMap> {
  // Ensure the universal static aliases (SEED_ALIASES) live in the global store
  // before any consumer read. Idempotent + sentinel-guarded, so once migrated
  // this is a single cheap sentinel read. This is the shared chokepoint for all
  // server-side alias consumers (canonical standings, Insights, draft board),
  // so seeding here makes the static aliases available everywhere without any
  // manual admin action.
  await migrateSeedAliasesToGlobal();

  // Highest precedence first: global > league+year > year.
  const scopes = [GLOBAL_SCOPE, `aliases:${leagueSlug}:${year}`, `aliases:${year}`];
  const aliasMap: AliasMap = {};
  const seenIdentities = new Set<string>();
  for (const scope of scopes) {
    const record = await getAppState<AliasMap>(scope, GLOBAL_KEY);
    const value = record?.value;
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    for (const [key, target] of Object.entries(value)) {
      if (typeof target !== 'string') continue;
      const identity = normalizeTeamName(key);
      // Keys that normalize to nothing can never be matched by the resolver
      // (its registry is keyed by the same normalization), so skipping them is
      // harmless and avoids a bogus empty-identity dedup bucket.
      if (!identity || seenIdentities.has(identity)) continue;
      seenIdentities.add(identity);
      aliasMap[key] = target;
    }
  }
  return aliasMap;
}

/**
 * Merges the given entries into the global alias store.
 * Keys are lowercased for consistent lookup. Existing entries are preserved
 * when the incoming map does not include them.
 * Returns the full updated alias map.
 */
export async function upsertGlobalAliases(entries: AliasMap): Promise<AliasMap> {
  // Ensure seeds exist first so a manual upsert never races ahead of the seed
  // migration and leaves the store without them.
  await migrateSeedAliasesToGlobal();
  return withGlobalAliasWriteLock(async () => {
    // Re-read inside the lock so we merge onto the freshest map, not a snapshot
    // that a concurrent writer may have already superseded.
    const current = await readGlobalAliasMapRaw();
    const next: AliasMap = { ...current };
    for (const [k, v] of Object.entries(entries)) {
      const key = normalizeAliasLookup(k);
      if (key && typeof v === 'string' && v.trim()) {
        next[key] = v.trim();
      }
    }
    await setAppState(GLOBAL_SCOPE, GLOBAL_KEY, next);
    return next;
  });
}

/**
 * One-time migration of the static `SEED_ALIASES` bundle (universal team
 * aliases such as `ole miss` → `mississippi`, `byu` → `brigham young`) into the
 * global alias store. Once global, they are consumed by every server-side alias
 * reader through `getScopedAliasMap` (canonical standings, Insights, draft
 * board) rather than depending on the client's per-league seed-if-empty path.
 *
 * Fill-only precedence: existing global entries always win. A seed is skipped
 * when the global store already holds a key with the same resolver identity
 * (`normalizeTeamName`) — the same identity `getScopedAliasMap` dedupes on — so
 * a manually corrected global alias is never shadowed by a static seed that
 * collapses to the same identity.
 *
 * Idempotent: guarded by its own sentinel (separate from the year-scoped
 * migration), so it does work once and is safe to call on every
 * `getScopedAliasMap` invocation.
 */
export async function migrateSeedAliasesToGlobal(): Promise<{ migrated: number }> {
  // Fast path outside the lock: once the sentinel is set this is a single read.
  const done = await getAppState<boolean>(GLOBAL_SCOPE, SEED_MIGRATION_DONE_KEY);
  if (done?.value === true) return { migrated: 0 };

  return withGlobalAliasWriteLock(async () => {
    // Re-check the sentinel inside the lock: a concurrent caller may have
    // completed the migration while we waited.
    const doneInLock = await getAppState<boolean>(GLOBAL_SCOPE, SEED_MIGRATION_DONE_KEY);
    if (doneInLock?.value === true) return { migrated: 0 };

    // Raw read (no migration trigger) inside the lock so we merge onto the
    // freshest map — never through getGlobalAliases (that would recurse).
    const current = await readGlobalAliasMapRaw();
    const next: AliasMap = { ...current };
    // Existing global identities win — seeds only fill genuinely-missing ones.
    const existingIdentities = new Set(
      Object.keys(current)
        .map((k) => normalizeTeamName(k))
        .filter(Boolean)
    );

    let migrated = 0;
    for (const [rawKey, rawValue] of Object.entries(SEED_ALIASES)) {
      const key = normalizeAliasLookup(rawKey);
      const identity = normalizeTeamName(rawKey);
      if (!key || !identity || typeof rawValue !== 'string' || !rawValue.trim()) continue;
      if (existingIdentities.has(identity)) continue;
      next[key] = rawValue.trim();
      existingIdentities.add(identity);
      migrated++;
    }

    // Map is written before the sentinel, so a crash between the two re-runs the
    // migration rather than marking it done with the write lost.
    await setAppState(GLOBAL_SCOPE, GLOBAL_KEY, next);
    await setAppState(GLOBAL_SCOPE, SEED_MIGRATION_DONE_KEY, true);
    return { migrated };
  });
}

/**
 * One-time migration from year-scoped alias maps into the global alias store.
 *
 * Discovers all legacy alias scopes by scanning a year range around the
 * provided year (year−10 to year+1) for every known league slug, plus the
 * legacy year-only scopes for the same range. Uses listAppStateKeys() to
 * verify each candidate scope has a 'map' key before reading, so only scopes
 * with actual data are touched.
 *
 * Existing global entries are never overwritten. Records a migration sentinel
 * after all discovered scopes are processed so subsequent calls are no-ops.
 *
 * Safe to call repeatedly — only performs work once per deployment.
 */
export async function migrateYearScopedAliasesToGlobal(
  leagueSlugs: string[],
  year: number
): Promise<{ migrated: number }> {
  // Seeds must be established BEFORE legacy promotion so a scoped key (e.g.
  // `ole miss`) can't be promoted into global first and then be mistaken for a
  // manual correction that pre-empts the static seed. Running seed migration
  // here makes seed-over-legacy precedence hold regardless of entry-point order.
  await migrateSeedAliasesToGlobal();

  const migrationRecord = await getAppState<boolean>(GLOBAL_SCOPE, MIGRATION_DONE_KEY);
  if (migrationRecord?.value === true) return { migrated: 0 };

  // Discover legacy scopes with data OUTSIDE the write lock (read-only, and the
  // scan is the slow part) so we hold the lock only for the read-modify-write.
  const yearStart = Math.max(2000, year - 10);
  const yearEnd = year + 1;
  const candidateScopes: string[] = [];
  for (let y = yearStart; y <= yearEnd; y++) {
    candidateScopes.push(`aliases:${y}`); // legacy year-only scope
    for (const slug of leagueSlugs) {
      candidateScopes.push(`aliases:${slug}:${y}`); // league-scoped scope
    }
  }

  const legacyMaps: AliasMap[] = [];
  for (const scope of candidateScopes) {
    const keys = await listAppStateKeys(scope);
    if (!keys.includes('map')) continue;
    const record = await getAppState<AliasMap>(scope, 'map');
    const legacyMap = record?.value;
    if (!legacyMap || typeof legacyMap !== 'object' || Array.isArray(legacyMap)) continue;
    legacyMaps.push(legacyMap as AliasMap);
  }

  return withGlobalAliasWriteLock(async () => {
    // Re-check the sentinel and re-read the map inside the lock.
    const doneInLock = await getAppState<boolean>(GLOBAL_SCOPE, MIGRATION_DONE_KEY);
    if (doneInLock?.value === true) return { migrated: 0 };

    const current = await readGlobalAliasMapRaw();
    const next: AliasMap = { ...current };
    let migrated = 0;
    // Fill-only: existing global entries (including the seeds migrated above and
    // any manual corrections) always win over deprecated scoped/year aliases.
    for (const legacyMap of legacyMaps) {
      for (const [k, v] of Object.entries(legacyMap)) {
        const key = normalizeAliasLookup(k);
        if (key && typeof v === 'string' && v.trim() && !next[key]) {
          next[key] = v.trim();
          migrated++;
        }
      }
    }

    await setAppState(GLOBAL_SCOPE, GLOBAL_KEY, next);
    await setAppState(GLOBAL_SCOPE, MIGRATION_DONE_KEY, true);
    return { migrated };
  });
}

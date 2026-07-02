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
// `mississippi`) is NOT persisted. It is merged in-memory as a fixed
// lowest-but-one precedence layer by both getGlobalAliases() and
// getScopedAliasMap(), so every server reader sees it, it is always current
// with the shipped code (no version sentinel to reconcile), and no read path
// ever writes to `aliases:global` (so there is no write that would need — and
// bypass — canonical standings invalidation). The only writers of the global
// map are upsertGlobalAliases() and migrateYearScopedAliasesToGlobal(), both
// invoked from request handlers that invalidate. Legacy promotion deliberately
// skips any scoped key whose identity is owned by a seed, so seed-over-legacy
// precedence holds even after promotion.
//
// Effective precedence: manual/stored global > SEED_ALIASES > league+year > year.
//
// All global-map writes are serialized through withGlobalAliasWriteLock() with
// a re-read inside the lock, so concurrent read-modify-writes cannot clobber
// one another.
// ---------------------------------------------------------------------------

const GLOBAL_SCOPE = 'aliases:global';
const GLOBAL_KEY = 'map';
const MIGRATION_DONE_KEY = 'migration-done';

// Precompute the seed layer once: normalized lookup key + resolver identity +
// trimmed target. Entries that normalize to nothing (unmatchable) are dropped.
const SEED_ENTRIES: ReadonlyArray<{ key: string; identity: string; target: string }> =
  Object.entries(SEED_ALIASES)
    .map(([rawKey, rawValue]) => ({
      key: normalizeAliasLookup(rawKey),
      identity: normalizeTeamName(rawKey),
      target: typeof rawValue === 'string' ? rawValue.trim() : '',
    }))
    .filter((e) => e.key && e.identity && e.target);

// Identities owned by a static seed. Legacy promotion skips these so a
// deprecated scoped alias can never be promoted into the global store and
// thereby outrank the seed it collides with.
const SEED_IDENTITIES: ReadonlySet<string> = new Set(SEED_ENTRIES.map((e) => e.identity));

// Process-local serialization for global-alias mutations. Every writer of
// `aliases:global/map` (year-scoped migration, upsert) does a read-modify-write
// of the whole map, so concurrent writers could otherwise read a stale map and
// clobber each other's entries. Chaining all writes through this lock — and
// re-reading the current map *inside* the lock — makes each read-modify-write
// atomic within the process. (Cross-instance atomicity would require
// transactional KV support and is intentionally out of scope.)
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
 * Raw read of the stored global alias map (no seed layer, no migration). Used
 * by the writers, which must persist only real stored entries — never the
 * in-memory seed layer.
 */
async function readGlobalAliasMapRaw(): Promise<AliasMap> {
  const record = await getAppState<AliasMap>(GLOBAL_SCOPE, GLOBAL_KEY);
  const map = record?.value;
  return map && typeof map === 'object' && !Array.isArray(map) ? (map as AliasMap) : {};
}

/**
 * Add `map`'s entries to `into`, first-wins by resolver identity: an identity
 * already claimed by a higher-precedence layer is skipped, so lower-precedence
 * layers only fill genuine gaps. Keys that normalize to nothing are ignored.
 */
function addAliasLayer(into: AliasMap, claimed: Set<string>, map: AliasMap): void {
  for (const [key, target] of Object.entries(map)) {
    if (typeof target !== 'string') continue;
    const identity = normalizeTeamName(key);
    if (!identity || claimed.has(identity)) continue;
    claimed.add(identity);
    into[key] = target;
  }
}

/** Fill the static seed layer into `into` for any identity not already claimed. */
function addSeedLayer(into: AliasMap, claimed: Set<string>): void {
  for (const { key, identity, target } of SEED_ENTRIES) {
    if (claimed.has(identity)) continue;
    claimed.add(identity);
    into[key] = target;
  }
}

/**
 * Public global alias read: the stored global map with the static SEED_ALIASES
 * merged underneath (stored entries win on identity conflict). Direct global
 * readers (owner validation, owner writes, Insights game building, the admin
 * alias GET) therefore always see the seeds without any persisted migration.
 */
export async function getGlobalAliases(): Promise<AliasMap> {
  const stored = await readGlobalAliasMapRaw();
  const result: AliasMap = {};
  const claimed = new Set<string>();
  addAliasLayer(result, claimed, stored); // manual/stored global wins
  addSeedLayer(result, claimed); // seeds fill missing identities
  return result;
}

/**
 * Resolves the effective alias map for a league/year on the server.
 *
 * Precedence (highest first): stored global > SEED_ALIASES > league+year > year.
 * Enforced by the resolver's canonical identity (`normalizeTeamName`), NOT raw
 * key text — the resolver keys aliases by that normalization and is first-wins,
 * so two textually different keys that collapse to the same identity (e.g.
 * `gulf coast tech` vs `gulfcoasttech`) must not let a lower-precedence layer
 * win on insertion order. The static seeds sit just below the stored global
 * store (manual corrections win) and above the deprecated scoped/year stores.
 *
 * Server-safe: reads only appState and the in-memory seed constant (no
 * `localStorage`, no static-file fetch, no writes), so it is safe during server
 * render. Returns {} only if nothing (not even a seed) matches; never throws on
 * missing data.
 */
export async function getScopedAliasMap(leagueSlug: string, year: number): Promise<AliasMap> {
  const [storedGlobal, leagueMap, yearMap] = await Promise.all([
    readGlobalAliasMapRaw(),
    readScopedMap(`aliases:${leagueSlug}:${year}`),
    readScopedMap(`aliases:${year}`),
  ]);

  const aliasMap: AliasMap = {};
  const claimed = new Set<string>();
  addAliasLayer(aliasMap, claimed, storedGlobal); // 1. stored/manual global
  addSeedLayer(aliasMap, claimed); //                2. static seeds
  addAliasLayer(aliasMap, claimed, leagueMap); //    3. deprecated league+year
  addAliasLayer(aliasMap, claimed, yearMap); //      4. deprecated year-only
  return aliasMap;
}

async function readScopedMap(scope: string): Promise<AliasMap> {
  const record = await getAppState<AliasMap>(scope, GLOBAL_KEY);
  const value = record?.value;
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as AliasMap) : {};
}

/**
 * Merges the given entries into the stored global alias map.
 * Keys are normalized for consistent lookup. Existing entries are preserved
 * when the incoming map does not include them. Returns the full updated stored
 * map (seed layer is not persisted and not included).
 */
export async function upsertGlobalAliases(entries: AliasMap): Promise<AliasMap> {
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
 * One-time migration from year-scoped alias maps into the global alias store.
 *
 * Discovers all legacy alias scopes by scanning a year range around the
 * provided year (year−10 to year+1) for every known league slug, plus the
 * legacy year-only scopes for the same range. Uses listAppStateKeys() to
 * verify each candidate scope has a 'map' key before reading, so only scopes
 * with actual data are touched.
 *
 * Fill-only: existing stored global entries are never overwritten, and any
 * scoped key whose identity is owned by a static seed is skipped — so promotion
 * can never push a deprecated alias above the seed it collides with. Records a
 * migration sentinel after all discovered scopes are processed so subsequent
 * calls are no-ops. Safe to call repeatedly.
 */
export async function migrateYearScopedAliasesToGlobal(
  leagueSlugs: string[],
  year: number
): Promise<{ migrated: number }> {
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
    for (const legacyMap of legacyMaps) {
      for (const [k, v] of Object.entries(legacyMap)) {
        const key = normalizeAliasLookup(k);
        if (!key || typeof v !== 'string' || !v.trim()) continue;
        if (next[key]) continue; // existing stored global wins
        // A seed owns this identity → never promote a deprecated alias above it.
        if (SEED_IDENTITIES.has(normalizeTeamName(key))) continue;
        next[key] = v.trim();
        migrated++;
      }
    }

    await setAppState(GLOBAL_SCOPE, GLOBAL_KEY, next);
    await setAppState(GLOBAL_SCOPE, MIGRATION_DONE_KEY, true);
    return { migrated };
  });
}

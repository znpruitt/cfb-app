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
// `mississippi`) is NOT persisted. It is merged in-memory as the LOWEST
// precedence layer (a code-defined default) by both getGlobalAliases() and
// getScopedAliasMap(), so every server reader sees it, it is always current
// with the shipped code (no version sentinel to reconcile), and no read path
// ever writes to `aliases:global` (so there is no write that would need — and
// bypass — canonical standings invalidation). The only writers of the global
// map are upsertGlobalAliases() and migrateYearScopedAliasesToGlobal(), both
// invoked from request handlers that invalidate.
//
// Effective precedence: stored global > league+year > year > SEED_ALIASES.
// Seeds are DEFAULTS, weaker than any persisted alias, so a manual repair for a
// seed key (global or scoped) always wins. Cross-layer conflicts dedup by
// resolver identity; distinct spellings within one layer are all preserved.
//
// All global-map writes are serialized through withGlobalAliasWriteLock() with
// a re-read inside the lock, so concurrent read-modify-writes cannot clobber
// one another.
// ---------------------------------------------------------------------------

const GLOBAL_SCOPE = 'aliases:global';
const GLOBAL_KEY = 'map';
const MIGRATION_DONE_KEY = 'migration-done';

// Precompute the seed layer once as a normalized lookup-key → target map. Seeds
// are code-defined DEFAULTS: they are the lowest-precedence layer, below every
// persisted alias (stored global, league+year, year), so a persisted manual
// repair for a seed key (e.g. mapping ambiguous `uh` → Hawaii) always wins.
const SEED_ALIAS_MAP: AliasMap = (() => {
  const map: AliasMap = {};
  for (const [rawKey, rawValue] of Object.entries(SEED_ALIASES)) {
    const key = normalizeAliasLookup(rawKey);
    const target = typeof rawValue === 'string' ? rawValue.trim() : '';
    if (key && target && !(key in map)) map[key] = target;
  }
  return map;
})();

/**
 * Deterministic FNV-1a hash of the SEED_ALIASES contents (order-independent).
 * Because seeds are code-defined and merged in-memory (never persisted, so no
 * runtime write fires an invalidation), any cache whose output depends on the
 * seed set — notably canonical standings — must fold this hash into its cache
 * identity. When SEED_ALIASES changes, the hash changes and those caches miss
 * naturally, with no manual alias write required.
 */
export function hashSeedAliases(seeds: AliasMap): string {
  const serialized = Object.entries(seeds)
    .map(([k, v]) => `${normalizeAliasLookup(k)}=${typeof v === 'string' ? v.trim() : ''}`)
    .sort()
    .join(';');
  let h = 0x811c9dc5;
  for (let i = 0; i < serialized.length; i++) {
    h ^= serialized.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

export const SEED_ALIASES_HASH = hashSeedAliases(SEED_ALIASES);

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
 * Merge one precedence layer into `into`, resolving cross-layer conflicts by the
 * resolver's canonical identity (`normalizeTeamName`) while PRESERVING every
 * distinct lookup spelling.
 *
 * `identityWinner` maps a normalized team identity → the target chosen by the
 * highest-precedence layer that owns it. When a lower layer has a key whose
 * identity is already owned (e.g. global `gulf coast tech` owns `gulfcoasttech`,
 * and a scoped `gulfcoasttech` arrives later), the spelling is KEPT but remapped
 * to the winning target — so exact-key consumers like validateRosterCSV resolve
 * that spelling to the correct (higher-precedence) team instead of missing it.
 * Same-layer siblings don't shadow each other: identities are registered only
 * after the whole layer is processed.
 */
function addAliasLayer(into: AliasMap, identityWinner: Map<string, string>, map: AliasMap): void {
  const firstSeen: Array<[string, string]> = [];
  for (const [key, target] of Object.entries(map)) {
    if (typeof target !== 'string') continue;
    const identity = normalizeTeamName(key);
    // Keys that normalize to nothing can never be matched by the resolver.
    if (!identity) continue;
    const winner = identityWinner.get(identity);
    if (winner !== undefined) {
      // A higher-precedence layer owns this identity: preserve this spelling but
      // point it at the winning target.
      into[key] = winner;
    } else {
      into[key] = target;
      firstSeen.push([identity, target]);
    }
  }
  for (const [identity, target] of firstSeen) {
    if (!identityWinner.has(identity)) identityWinner.set(identity, target);
  }
}

/**
 * Stored/manual global aliases only — the persisted `aliases:global/map`
 * WITHOUT the in-memory seed layer. Use this for admin/editor storage views so
 * a normal save can never round-trip the code-defined seeds back into the store
 * as manual entries (which would then permanently shadow future seed edits).
 */
export async function getStoredGlobalAliases(): Promise<AliasMap> {
  return readGlobalAliasMapRaw();
}

/**
 * Effective global alias read: the stored global map with the static
 * SEED_ALIASES merged underneath as a default (stored entries win; every stored
 * spelling is preserved). Resolver consumers (owner validation, owner writes,
 * Insights game building) use this so they always see the seed defaults. NOT for
 * editable admin views — see getStoredGlobalAliases.
 */
export async function getGlobalAliases(): Promise<AliasMap> {
  const stored = await readGlobalAliasMapRaw();
  const result: AliasMap = {};
  const identityWinner = new Map<string, string>();
  addAliasLayer(result, identityWinner, stored); // 1. stored/manual global wins
  addAliasLayer(result, identityWinner, SEED_ALIAS_MAP); // 2. seed defaults fill gaps
  return result;
}

/**
 * Resolves the effective alias map for a league/year on the server.
 *
 * Precedence (highest first): stored global > league+year > year > SEED_ALIASES.
 * Static seeds are code-defined DEFAULTS — the LOWEST layer — so any persisted
 * manual repair (global or scoped) always beats them. Cross-layer conflicts are
 * resolved by the resolver's canonical identity (`normalizeTeamName`, first-wins
 * across layers), but every distinct stored spelling WITHIN a layer is
 * preserved so exact-key consumers don't lose a valid alias.
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
  const identityWinner = new Map<string, string>();
  addAliasLayer(aliasMap, identityWinner, storedGlobal); // 1. stored/manual global
  addAliasLayer(aliasMap, identityWinner, leagueMap); //    2. deprecated league+year
  addAliasLayer(aliasMap, identityWinner, yearMap); //      3. deprecated year-only
  addAliasLayer(aliasMap, identityWinner, SEED_ALIAS_MAP); // 4. static seed defaults
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
 * Fill-only: existing stored global entries are never overwritten. Promoted
 * entries become stored global aliases, which correctly outrank the static seed
 * defaults (seeds are the lowest layer). Entries that are exact copies of a seed
 * default (same normalized key AND target) are NOT promoted — those are
 * bootstrap-written defaults, not manual repairs, and promoting them would
 * permanently shadow future seed edits. Records a migration sentinel after all
 * discovered scopes are processed so subsequent calls are no-ops. Safe to call
 * repeatedly.
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
        // Skip copied bootstrap defaults: `bootstrapAliasesAndCaches` writes the
        // full SEED_ALIASES bundle into empty scopes, and those are NOT manual
        // repairs — promoting them would turn a code default into a stored
        // global entry that permanently shadows future seed edits. A seed KEY
        // with a DIFFERENT target is a genuine repair and still promotes.
        if (SEED_ALIAS_MAP[key] === v.trim()) continue;
        next[key] = v.trim();
        migrated++;
      }
    }

    await setAppState(GLOBAL_SCOPE, GLOBAL_KEY, next);
    await setAppState(GLOBAL_SCOPE, MIGRATION_DONE_KEY, true);
    return { migrated };
  });
}

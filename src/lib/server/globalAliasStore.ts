import { getAppState, listAppStateKeys, setAppState } from './appStateStore.ts';
import { hashSeedAliases, mergeAliasLayers } from '../aliasLayers.ts';
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
// Legacy scoped alias maps (scope 'aliases:${league}:${year}' or
// 'aliases:${year}') are DEPRECATED. migrateYearScopedAliasesToGlobal()
// reads them once and merges their entries into the global store. As of
// PLATFORM-067, runtime resolution (getScopedAliasMap) NO LONGER reads
// league-scoped maps at all — team aliases are not league-specific — so
// those keys are legacy storage only; the migration scan remains as a
// promotion safety net for any historical app-state. Year-scoped maps are
// still read at runtime as a resolution layer below stored global.
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
// Effective precedence: stored global > year > SEED_ALIASES.
// Seeds are DEFAULTS, weaker than any persisted alias, so a manual repair for a
// seed key (global or year) always wins. Cross-layer conflicts dedup by
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
// persisted alias (stored global, year), so a persisted manual repair for a
// seed key (e.g. mapping ambiguous `uh` → Hawaii) always wins.
const SEED_ALIAS_MAP: AliasMap = (() => {
  const map: AliasMap = {};
  for (const [rawKey, rawValue] of Object.entries(SEED_ALIASES)) {
    const key = normalizeAliasLookup(rawKey);
    const target = typeof rawValue === 'string' ? rawValue.trim() : '';
    if (key && target && !(key in map)) map[key] = target;
  }
  return map;
})();

// (normalizedKey, target) pairs that SEED_ALIASES has EVER shipped. A persisted
// alias whose key+target matches one of these is a bootstrap/default copy —
// `bootstrapAliasesAndCaches` writes the whole seed bundle into empty scopes,
// and earlier attempts persisted seeds too — NOT a manual repair. Such copies
// are demoted from the effective stored layers (so the current code seed fills
// the identity) and are never promoted into stored global. When a seed's target
// changes or is removed, add the OLD (key, target) to RETIRED_SEED_DEFAULTS so
// existing installs' stale persisted copies stop shadowing the corrected seed.
//
// Residual limitation (documented, accepted): a genuine MANUAL repair whose
// key+target happens to exactly equal a known seed default is indistinguishable
// from a bootstrap copy and is treated as one. The outcome — the current code
// seed applies for that identity — is the reasonable default.
const RETIRED_SEED_DEFAULTS: ReadonlyArray<readonly [string, string]> = [
  // ['uh', 'houston'], // e.g. superseded by a corrected seed target
];
const KNOWN_SEED_DEFAULTS: ReadonlySet<string> = new Set<string>([
  ...Object.entries(SEED_ALIAS_MAP).map(([k, v]) => `${k}\u0000${v}`),
  ...RETIRED_SEED_DEFAULTS.map(([k, v]) => `${normalizeAliasLookup(k)}\u0000${v.trim()}`),
]);

export function isCopiedSeedDefault(normalizedKey: string, target: string): boolean {
  return KNOWN_SEED_DEFAULTS.has(`${normalizedKey}\u0000${target.trim()}`);
}

/**
 * Drop persisted entries that are copies of a known seed default, so the current
 * code-defined seed (not a stale persisted copy) resolves that identity. A
 * same-key DIFFERENT-target entry is a manual repair and is preserved.
 */
function withoutCopiedSeedDefaults(map: AliasMap): AliasMap {
  const result: AliasMap = {};
  for (const [key, target] of Object.entries(map)) {
    if (typeof target !== 'string') continue;
    if (isCopiedSeedDefault(normalizeAliasLookup(key), target)) continue;
    result[key] = target;
  }
  return result;
}

// Re-exported for existing importers; the implementation is the shared,
// client-safe `hashSeedAliases` in ../aliasLayers.ts. Folded into the canonical
// standings cache identity so a SEED_ALIASES change misses those caches.
export { hashSeedAliases };
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
  // Demote persisted copies of known seed defaults so the CURRENT code seed
  // resolves the identity (manual repairs — different targets — are preserved).
  return mergeAliasLayers([
    withoutCopiedSeedDefaults(stored), // 1. stored/manual global
    SEED_ALIAS_MAP, //                    2. seed defaults
  ]);
}

/**
 * Resolves the effective alias map for a league/year on the server.
 *
 * Precedence (highest first): stored global > year > SEED_ALIASES.
 * Static seeds are code-defined DEFAULTS — the LOWEST layer — so any persisted
 * manual repair (global or year) always beats them. Cross-layer conflicts are
 * resolved by the resolver's canonical identity (`normalizeTeamName`, first-wins
 * across layers), but every distinct stored spelling WITHIN a layer is
 * preserved so exact-key consumers don't lose a valid alias.
 *
 * League-scoped aliases (`aliases:${slug}:${year}`) are legacy storage only.
 * Per the settled product decision, team aliases are NOT league-specific, so
 * runtime resolution ignores them (PLATFORM-067). The `_leagueSlug` argument is
 * retained for call-site/API compatibility but no longer affects resolution.
 * `migrateYearScopedAliasesToGlobal` still scans league scopes as a promotion
 * safety net for any historical app-state.
 *
 * Server-safe: reads only appState and the in-memory seed constant (no
 * `localStorage`, no static-file fetch, no writes), so it is safe during server
 * render. Returns {} only if nothing (not even a seed) matches; never throws on
 * missing data.
 */
export async function getScopedAliasMap(_leagueSlug: string, year: number): Promise<AliasMap> {
  const [storedGlobal, yearMap] = await Promise.all([
    readGlobalAliasMapRaw(),
    readScopedMap(`aliases:${year}`),
  ]);

  // Persisted copies of known seed defaults are demoted from every stored layer
  // so a corrected code seed is never shadowed by a stale bootstrap copy; genuine
  // manual repairs (different targets) survive and keep their precedence.
  return mergeAliasLayers([
    withoutCopiedSeedDefaults(storedGlobal), // 1. stored/manual global
    withoutCopiedSeedDefaults(yearMap), //      2. year
    SEED_ALIAS_MAP, //                          3. seed defaults
  ]);
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
 * defaults (seeds are the lowest layer). Two guards keep this consistent with
 * the effective-map precedence:
 *   - Copies of a known seed default (current or RETIRED, same normalized key
 *     AND target) are NOT promoted — those are bootstrap-written defaults, not
 *     manual repairs, and promoting them would permanently shadow future seeds.
 *   - A legacy key that collides by normalized identity with an existing stored
 *     global winner is promoted with the WINNER's target (spelling preserved for
 *     exact-key validation), never the conflicting lower-precedence target.
 * Records a migration sentinel after all discovered scopes are processed so
 * subsequent calls are no-ops. Safe to call repeatedly.
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
    // Winning target per normalized identity in the stored global map, so a
    // promoted spelling never contradicts an existing global winner (mirrors the
    // effective-map remap). Updated as we promote so later legacy siblings agree.
    // Built from the FILTERED map: a demoted bootstrap seed copy (e.g.
    // `uh`→houston) must NOT count as a winner, or a differently-spelled repair
    // (`u h`→Hawaii) would be remapped to the copy's target and defeat the repair.
    const identityWinner = new Map<string, string>();
    for (const [k, v] of Object.entries(withoutCopiedSeedDefaults(next))) {
      const id = normalizeTeamName(k);
      if (id && !identityWinner.has(id)) identityWinner.set(id, v);
    }
    let migrated = 0;
    for (const legacyMap of legacyMaps) {
      for (const [k, v] of Object.entries(legacyMap)) {
        const key = normalizeAliasLookup(k);
        if (!key || typeof v !== 'string' || !v.trim()) continue;
        // A real stored global entry at this exact key wins. A copied seed
        // default there is demoted at read time, so treat it as absent — a
        // same-key manual repair must be able to promote over it.
        const existing = next[key];
        if (existing !== undefined && !isCopiedSeedDefault(key, existing)) continue;
        const identity = normalizeTeamName(key);
        const winner = identity ? identityWinner.get(identity) : undefined;
        if (winner !== undefined) {
          // Identity already owned by a higher-precedence stored global winner:
          // preserve the spelling but map it to the winner — never promote the
          // conflicting lower-precedence target.
          if (next[key] !== winner) {
            next[key] = winner;
            migrated++;
          }
          continue;
        }
        // Copied bootstrap/default (current or retired): NOT a manual repair, so
        // don't promote a code default into stored global. A seed KEY with a
        // DIFFERENT target is a genuine repair and still promotes below.
        if (isCopiedSeedDefault(key, v)) continue;
        next[key] = v.trim();
        if (identity) identityWinner.set(identity, v.trim());
        migrated++;
      }
    }

    await setAppState(GLOBAL_SCOPE, GLOBAL_KEY, next);
    await setAppState(GLOBAL_SCOPE, MIGRATION_DONE_KEY, true);
    return { migrated };
  });
}

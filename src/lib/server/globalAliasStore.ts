import { getAppState, listAppStateKeys, setAppState } from './appStateStore.ts';
import type { AliasMap } from '../teamNames.ts';
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
// ---------------------------------------------------------------------------

const GLOBAL_SCOPE = 'aliases:global';
const GLOBAL_KEY = 'map';
const MIGRATION_DONE_KEY = 'migration-done';

export async function getGlobalAliases(): Promise<AliasMap> {
  const record = await getAppState<AliasMap>(GLOBAL_SCOPE, GLOBAL_KEY);
  const map = record?.value;
  return map && typeof map === 'object' && !Array.isArray(map) ? (map as AliasMap) : {};
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
  const current = await getGlobalAliases();
  const next: AliasMap = { ...current };
  for (const [k, v] of Object.entries(entries)) {
    const key = normalizeAliasLookup(k);
    if (key && typeof v === 'string' && v.trim()) {
      next[key] = v.trim();
    }
  }
  await setAppState(GLOBAL_SCOPE, GLOBAL_KEY, next);
  return next;
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
  const migrationRecord = await getAppState<boolean>(GLOBAL_SCOPE, MIGRATION_DONE_KEY);
  if (migrationRecord?.value === true) return { migrated: 0 };

  const current = await getGlobalAliases();
  const next: AliasMap = { ...current };
  let migrated = 0;

  // Build the full candidate scope list across all leagues and a year range.
  // This ensures multi-league, multi-year alias data is not silently skipped.
  const yearStart = Math.max(2000, year - 10);
  const yearEnd = year + 1;
  const candidateScopes: string[] = [];
  for (let y = yearStart; y <= yearEnd; y++) {
    candidateScopes.push(`aliases:${y}`); // legacy year-only scope
    for (const slug of leagueSlugs) {
      candidateScopes.push(`aliases:${slug}:${y}`); // league-scoped scope
    }
  }

  // Use listAppStateKeys() to verify each scope has a 'map' key before reading.
  // Only scopes with actual alias data incur a second read.
  for (const scope of candidateScopes) {
    const keys = await listAppStateKeys(scope);
    if (!keys.includes('map')) continue;
    const record = await getAppState<AliasMap>(scope, 'map');
    const legacyMap = record?.value;
    if (!legacyMap || typeof legacyMap !== 'object' || Array.isArray(legacyMap)) continue;
    for (const [k, v] of Object.entries(legacyMap as AliasMap)) {
      const key = normalizeAliasLookup(k);
      if (key && typeof v === 'string' && v.trim() && !next[key]) {
        next[key] = v.trim();
        migrated++;
      }
    }
  }

  // Write global store and sentinel only after all scopes are processed.
  await setAppState(GLOBAL_SCOPE, GLOBAL_KEY, next);
  await setAppState(GLOBAL_SCOPE, MIGRATION_DONE_KEY, true);
  return { migrated };
}

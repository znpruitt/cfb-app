import { getAppState, listAppStateKeys, setAppState } from './appStateStore.ts';
import type { AliasMap } from '../teamNames.ts';
import { normalizeAliasLookup } from '../teamNormalization.ts';

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

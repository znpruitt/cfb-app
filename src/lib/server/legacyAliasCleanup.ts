import {
  deleteAppState,
  getAppState,
  listAppStateKeys,
  listAppStateScopes,
} from './appStateStore.ts';
import { isCopiedSeedDefault } from './globalAliasStore.ts';
import { normalizeAliasLookup } from '../teamNormalization.ts';
import type { AliasMap } from '../teamNames.ts';

// ---------------------------------------------------------------------------
// Legacy league-scoped alias cleanup (PLATFORM-081)
// ---------------------------------------------------------------------------
// League-scoped alias maps (`aliases:${slug}:${year}`) are DEPRECATED legacy
// storage. As of PLATFORM-067 runtime resolution (getScopedAliasMap) never reads
// them — team aliases are not league-specific. They linger only as (a) bootstrap
// seed copies and (b) any manual repairs that predate the global store.
//
// This module identifies those keys and can delete the ones proven redundant.
// It NEVER touches the two scopes that ARE read at runtime:
//   - `aliases:global`      (stored global map — the top resolution layer)
//   - `aliases:${year}`     (year-scoped map — the second resolution layer)
// nor any non-alias app-state scope.
//
// Safety model for deleting a league-scoped key:
//   - a key whose entries are ALL copies of a known seed default is redundant
//     regardless of migration state (the migration never promotes seed copies),
//   - any key is redundant once `migrateYearScopedAliasesToGlobal` has completed
//     (its `migration-done` sentinel is set) because every genuine manual repair
//     has by then been promoted into the stored global map.
// A key that still holds un-promoted manual repairs (migration not yet done) is
// skipped, never deleted, so no repair is lost before promotion.
// ---------------------------------------------------------------------------

const ALIAS_SCOPE_PREFIX = 'aliases:';
const GLOBAL_SCOPE = 'aliases:global';
const MIGRATION_DONE_KEY = 'migration-done';
const MAP_KEY = 'map';
const YEAR_RE = /^\d{4}$/;

export type AliasScopeKind = 'global' | 'year' | 'league' | 'other';

/**
 * Classifies an app-state scope string within the alias namespace. Only `league`
 * scopes (`aliases:${slug}:${year}`) are cleanup targets; `global` and `year`
 * are live runtime layers and `other` is anything outside the alias namespace.
 */
export function parseAliasScope(scope: string): {
  kind: AliasScopeKind;
  slug?: string;
  year?: number;
} {
  if (scope === GLOBAL_SCOPE) return { kind: 'global' };
  const parts = scope.split(':');
  if (parts[0] !== 'aliases') return { kind: 'other' };
  // Year-scoped: ['aliases', '2024'] — a live runtime layer.
  if (parts.length === 2 && YEAR_RE.test(parts[1])) {
    return { kind: 'year', year: Number(parts[1]) };
  }
  // League-scoped: ['aliases', slug, '2024'] — legacy, cleanup target.
  if (parts.length === 3 && parts[1] && parts[1] !== 'global' && YEAR_RE.test(parts[2])) {
    return { kind: 'league', slug: parts[1], year: Number(parts[2]) };
  }
  return { kind: 'other' };
}

/**
 * Splits a stored league-scoped alias map into seed-copy vs manual-repair
 * entries. A seed copy has the same normalized key AND target as a known seed
 * default (current or retired); everything else is treated as a manual repair.
 */
export function classifyLeagueScopedAliasMap(map: AliasMap): {
  entryCount: number;
  seedCopyCount: number;
  manualRepairCount: number;
} {
  let entryCount = 0;
  let seedCopyCount = 0;
  let manualRepairCount = 0;
  for (const [key, target] of Object.entries(map)) {
    if (typeof target !== 'string' || !target.trim()) continue;
    entryCount++;
    if (isCopiedSeedDefault(normalizeAliasLookup(key), target)) seedCopyCount++;
    else manualRepairCount++;
  }
  return { entryCount, seedCopyCount, manualRepairCount };
}

export type LegacyLeagueAliasScopeReport = {
  scope: string;
  slug: string;
  year: number;
  entryCount: number;
  seedCopyCount: number;
  manualRepairCount: number;
  /** True when this key can be deleted without losing an un-promoted repair. */
  safeToDelete: boolean;
};

export type LegacyLeagueAliasReport = {
  migrationDone: boolean;
  scopes: LegacyLeagueAliasScopeReport[];
};

/**
 * Read-only scan (dry run): discovers every `aliases:${slug}:${year}` key that
 * holds a map and classifies it. Never mutates storage.
 */
export async function reportLegacyLeagueScopedAliases(): Promise<LegacyLeagueAliasReport> {
  const migrationRecord = await getAppState<boolean>(GLOBAL_SCOPE, MIGRATION_DONE_KEY);
  const migrationDone = migrationRecord?.value === true;

  const scopes: LegacyLeagueAliasScopeReport[] = [];
  for (const scope of await listAppStateScopes(ALIAS_SCOPE_PREFIX)) {
    const parsed = parseAliasScope(scope);
    if (parsed.kind !== 'league') continue;
    const keys = await listAppStateKeys(scope);
    if (!keys.includes(MAP_KEY)) continue;
    const record = await getAppState<AliasMap>(scope, MAP_KEY);
    const map = record?.value;
    if (!map || typeof map !== 'object' || Array.isArray(map)) continue;
    const { entryCount, seedCopyCount, manualRepairCount } = classifyLeagueScopedAliasMap(map);
    scopes.push({
      scope,
      slug: parsed.slug ?? '',
      year: parsed.year ?? 0,
      entryCount,
      seedCopyCount,
      manualRepairCount,
      safeToDelete: manualRepairCount === 0 || migrationDone,
    });
  }
  return { migrationDone, scopes };
}

export type LegacyLeagueAliasCleanupResult = {
  applied: boolean;
  migrationDone: boolean;
  found: string[];
  deleted: string[];
  skipped: Array<{ scope: string; reason: string }>;
};

/**
 * Deletes redundant legacy league-scoped alias keys. Dry run by default —
 * pass `{ apply: true }` to actually delete. Only ever deletes keys classified
 * `league` and marked safe; refuses global/year/other scopes structurally, and
 * skips (never deletes) league keys that still hold un-promoted manual repairs.
 */
export async function cleanupLegacyLeagueScopedAliases(
  options: { apply?: boolean } = {}
): Promise<LegacyLeagueAliasCleanupResult> {
  const apply = options.apply === true;
  const report = await reportLegacyLeagueScopedAliases();

  const found = report.scopes.map((s) => s.scope);
  const deleted: string[] = [];
  const skipped: Array<{ scope: string; reason: string }> = [];

  for (const entry of report.scopes) {
    // Defense in depth: re-verify the scope is league-scoped before any delete.
    if (parseAliasScope(entry.scope).kind !== 'league') {
      skipped.push({ scope: entry.scope, reason: 'not-league-scoped' });
      continue;
    }
    if (!entry.safeToDelete) {
      skipped.push({
        scope: entry.scope,
        reason: `has ${entry.manualRepairCount} un-promoted manual repair(s); run the alias migration first`,
      });
      continue;
    }
    if (!apply) {
      skipped.push({ scope: entry.scope, reason: 'dry-run (would delete)' });
      continue;
    }
    await deleteAppState(entry.scope, MAP_KEY);
    deleted.push(entry.scope);
  }

  return { applied: apply, migrationDone: report.migrationDone, found, deleted, skipped };
}

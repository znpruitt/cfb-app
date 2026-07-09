import {
  deleteAppState,
  getAppState,
  listAppStateKeys,
  listAppStateScopes,
} from './appStateStore.ts';
import { getStoredGlobalAliases, isCopiedSeedDefault } from './globalAliasStore.ts';
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
// Safety model for deleting a league-scoped key — a key is safe to delete only
// when every entry is already accounted for and would lose nothing runtime uses:
//   - a seed copy (same normalized key AND target as a known seed default) is
//     redundant — the code seed supplies that identity,
//   - a manual repair is redundant ONLY once its identity is present in the
//     stored global map (`aliases:global`) — i.e. verifiably PROMOTED.
// The `migration-done` sentinel is NOT trusted for this: the promotion migration
// only scans registered league slugs within a bounded year window before setting
// it, so an unregistered/out-of-window scope can carry manual repairs that were
// never promoted even though the sentinel is set. We verify promotion per entry
// against the actual global map instead. A key holding any un-promoted manual
// repair is skipped, never deleted, so no repair is lost.
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
 * Classifies a stored league-scoped alias map against the current stored global
 * map. Each entry is one of:
 *   - a seed copy (same normalized key AND target as a known seed default),
 *   - a PROMOTED manual repair (stored global holds this exact key→target),
 *   - an UN-PROMOTED manual repair (neither) — the only thing that blocks
 *     deletion, since deleting it could drop a repair that was never promoted.
 * `unpromotedRepairCount === 0` ⇒ the key is redundant and safe to delete.
 *
 * "Promoted" requires the stored global VALUE to match, not just the key to
 * exist: `aliases:global` can hold a demoted copied seed default (e.g.
 * `uh → houston`) at the same key while this repair maps it elsewhere
 * (`uh → Hawaii`). Runtime demotes that seed copy and the migration would
 * overwrite it with the repair, so a bare key-existence check would delete the
 * only copy of an un-promoted repair. Comparing targets keeps it skipped.
 */
export function classifyLeagueScopedAliasMap(
  map: AliasMap,
  storedGlobal: AliasMap
): {
  entryCount: number;
  seedCopyCount: number;
  promotedRepairCount: number;
  unpromotedRepairCount: number;
} {
  let entryCount = 0;
  let seedCopyCount = 0;
  let promotedRepairCount = 0;
  let unpromotedRepairCount = 0;
  for (const [key, target] of Object.entries(map)) {
    if (typeof target !== 'string' || !target.trim()) continue;
    entryCount++;
    const normalizedKey = normalizeAliasLookup(key);
    if (isCopiedSeedDefault(normalizedKey, target)) {
      seedCopyCount++;
    } else if (
      typeof storedGlobal[normalizedKey] === 'string' &&
      storedGlobal[normalizedKey].trim() === target.trim()
    ) {
      // Promoted only when stored global holds THIS repair's exact target — not
      // merely the same key (which could be a demoted seed copy pointing
      // elsewhere that the migration would overwrite with this repair).
      promotedRepairCount++;
    } else {
      unpromotedRepairCount++;
    }
  }
  return { entryCount, seedCopyCount, promotedRepairCount, unpromotedRepairCount };
}

export type LegacyLeagueAliasScopeReport = {
  scope: string;
  slug: string;
  year: number;
  entryCount: number;
  seedCopyCount: number;
  promotedRepairCount: number;
  unpromotedRepairCount: number;
  /** True when this key can be deleted without losing an un-promoted repair. */
  safeToDelete: boolean;
};

export type LegacyLeagueAliasReport = {
  /** Informational only — NOT used to decide deletion safety (see module docs). */
  migrationDone: boolean;
  scopes: LegacyLeagueAliasScopeReport[];
};

/**
 * Read-only scan (dry run): discovers every `aliases:${slug}:${year}` key that
 * holds a map and classifies it against the current stored global map. Never
 * mutates storage.
 */
export async function reportLegacyLeagueScopedAliases(): Promise<LegacyLeagueAliasReport> {
  const [migrationRecord, storedGlobal] = await Promise.all([
    getAppState<boolean>(GLOBAL_SCOPE, MIGRATION_DONE_KEY),
    getStoredGlobalAliases(),
  ]);
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
    const { entryCount, seedCopyCount, promotedRepairCount, unpromotedRepairCount } =
      classifyLeagueScopedAliasMap(map, storedGlobal);
    scopes.push({
      scope,
      slug: parsed.slug ?? '',
      year: parsed.year ?? 0,
      entryCount,
      seedCopyCount,
      promotedRepairCount,
      unpromotedRepairCount,
      safeToDelete: unpromotedRepairCount === 0,
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
        reason: `has ${entry.unpromotedRepairCount} un-promoted manual repair(s); run the alias migration first`,
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

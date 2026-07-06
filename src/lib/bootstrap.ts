import { loadServerAliases, loadEffectiveAliases } from './aliasesApi.ts';
import { mergeAliasLayers } from './aliasLayers.ts';
import { loadServerOwnersCsv } from './ownersApi.ts';
import {
  loadServerPostseasonOverrides,
  type PostseasonOverridesMap,
} from './postseasonOverridesApi.ts';
import { LEGACY_STORAGE_KEYS, seasonOnlyStorageKeys, seasonStorageKeys } from './storageKeys.ts';
import type { AliasMap } from './teamNames.ts';

/**
 * Read a localStorage value, checking the current key first, then an optional
 * intermediate fallback key (season-only format), then the legacy unscoped key.
 * When a fallback hit occurs the value is promoted to the current key and the
 * old key is removed.
 */
function readWithMigrationChain(
  currentKey: string,
  seasonOnlyKey: string | null,
  legacyKey: string | null
): string | null {
  const current = window.localStorage.getItem(currentKey);
  if (current != null) return current;

  // Try intermediate season-only key (e.g. cfb_owners_csv:2025)
  if (seasonOnlyKey) {
    const seasonOnly = window.localStorage.getItem(seasonOnlyKey);
    if (seasonOnly != null) {
      window.localStorage.setItem(currentKey, seasonOnly);
      window.localStorage.removeItem(seasonOnlyKey);
      return seasonOnly;
    }
  }

  // Try legacy unscoped key (e.g. cfb_owners_csv)
  if (legacyKey) {
    const legacy = window.localStorage.getItem(legacyKey);
    if (legacy != null) {
      window.localStorage.setItem(currentKey, legacy);
      return legacy;
    }
  }

  return null;
}

/** Parse a cached alias-map JSON string, returning `fallback` on null/invalid. */
function parseAliasMap(raw: string | null, fallback: AliasMap): AliasMap {
  if (raw == null) return fallback;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as AliasMap)
      : fallback;
  } catch {
    return fallback;
  }
}

function readOwnersCsvWithMigration(
  storageKey: string,
  seasonOnlyKey: string | null
): string | null {
  return readWithMigrationChain(storageKey, seasonOnlyKey, LEGACY_STORAGE_KEYS.ownersCsv);
}

function writeOwnersCsvToLocal(storageKey: string, csvText: string | null): void {
  if (typeof csvText === 'string' && csvText.trim()) {
    window.localStorage.setItem(storageKey, csvText);
    return;
  }

  window.localStorage.removeItem(storageKey);
  window.localStorage.removeItem(LEGACY_STORAGE_KEYS.ownersCsv);
}

function readLocalPostseasonOverrides(
  storageKey: string,
  seasonOnlyKey: string | null
): PostseasonOverridesMap {
  try {
    const raw = readWithMigrationChain(
      storageKey,
      seasonOnlyKey,
      LEGACY_STORAGE_KEYS.postseasonOverrides
    );
    if (!raw) return {};
    return JSON.parse(raw) as PostseasonOverridesMap;
  } catch {
    return {};
  }
}

function writePostseasonOverridesToLocal(
  storageKey: string,
  overrides: PostseasonOverridesMap
): void {
  if (Object.keys(overrides).length > 0) {
    window.localStorage.setItem(storageKey, JSON.stringify(overrides));
    return;
  }

  window.localStorage.removeItem(storageKey);
  window.localStorage.removeItem(LEGACY_STORAGE_KEYS.postseasonOverrides);
}

export async function bootstrapAliasesAndCaches(params: {
  season: number;
  seedAliases: AliasMap;
  leagueSlug?: string;
}): Promise<{
  aliasMap: AliasMap;
  effectiveAliasMap: AliasMap;
  aliasLoadIssue?: string;
  ownersCsvText: string | null;
  ownersLoadIssue?: string;
  postseasonOverrides: PostseasonOverridesMap;
  postseasonOverridesLoadIssue?: string;
}> {
  const { season, seedAliases, leagueSlug } = params;
  const storageKeys = seasonStorageKeys(season, leagueSlug);
  // Season-only keys for migrating data stored before league-scoped keys existed.
  // Only relevant when leagueSlug is provided — otherwise the keys are identical.
  const oldSeasonKeys = leagueSlug ? seasonOnlyStorageKeys(season) : null;

  // Two alias maps with distinct purposes:
  // - aliasMap:          STORED league aliases (`aliases:${slug}:${year}`) — the
  //                      editable view the in-app alias editor manages.
  // - effectiveAliasMap: the RESOLVER view (stored global > league+year > year >
  //                      SEED_ALIASES) used to build the client schedule/games so
  //                      client identity matches server canonical. SEED_ALIASES
  //                      now come from the server effective map, so the client no
  //                      longer seeds them into the league scope.
  let aliasMap: AliasMap = {};
  let effectiveAliasMap: AliasMap = {};
  let aliasLoadIssue: string | undefined;

  // Editor-map fallback: cached STORED league aliases only — never seeds. This
  // map backs the alias editor, and a save persists whatever it contains into
  // the league scope, so seeding it would leak defaults there.
  const storedFallback = (): AliasMap =>
    parseAliasMap(
      readWithMigrationChain(storageKeys.aliasMap, oldSeasonKeys?.aliasMap ?? null, null),
      {}
    );
  // Resolver-map fallback: prefer the separately cached EFFECTIVE map so
  // global/year aliases survive a degraded bootstrap; only if no effective cache
  // exists fall back to the stored map over the seed defaults (drops global/year
  // — the last resort on a first-ever offline load). Uses mergeAliasLayers so
  // stored-over-seed precedence matches the server (a stored `u-h`→Hawaii repair
  // beats the seed `uh`→Houston by normalized identity, spellings preserved).
  const effectiveFallback = (stored: AliasMap): AliasMap => {
    const merged = mergeAliasLayers([stored, seedAliases]);
    const cached = window.localStorage.getItem(storageKeys.effectiveAliasMap);
    return cached != null ? parseAliasMap(cached, merged) : merged;
  };

  // Fetch both maps independently: a transient failure of one must NOT discard a
  // successful fetch of the other (which would reintroduce a client/server
  // identity mismatch).
  const [storedResult, effectiveResult] = await Promise.allSettled([
    loadServerAliases(season, leagueSlug),
    loadEffectiveAliases(season, leagueSlug),
  ]);

  if (storedResult.status === 'fulfilled') {
    aliasMap = storedResult.value;
    try {
      window.localStorage.setItem(storageKeys.aliasMap, JSON.stringify(aliasMap));
    } catch {
      // ignore quota/serialization failures — cache is best-effort
    }
  } else {
    aliasLoadIssue = `Aliases load failed: ${(storedResult.reason as Error)?.message ?? 'unknown'}`;
    aliasMap = storedFallback();
  }

  if (effectiveResult.status === 'fulfilled') {
    effectiveAliasMap = effectiveResult.value;
    try {
      window.localStorage.setItem(storageKeys.effectiveAliasMap, JSON.stringify(effectiveAliasMap));
    } catch {
      // ignore quota/serialization failures — cache is best-effort
    }
  } else {
    aliasLoadIssue ??= `Aliases load failed: ${(effectiveResult.reason as Error)?.message ?? 'unknown'}`;
    effectiveAliasMap = effectiveFallback(aliasMap);
  }

  let ownersCsvText = readOwnersCsvWithMigration(
    storageKeys.ownersCsv,
    oldSeasonKeys?.ownersCsv ?? null
  );
  let ownersLoadIssue: string | undefined;
  try {
    const serverOwnersState = await loadServerOwnersCsv(season, leagueSlug);
    if (serverOwnersState.hasStoredValue) {
      ownersCsvText = serverOwnersState.csvText;
      writeOwnersCsvToLocal(storageKeys.ownersCsv, serverOwnersState.csvText);
    } else if (leagueSlug) {
      // Server is authoritative for league-scoped data — no stored value means empty.
      ownersCsvText = null;
      writeOwnersCsvToLocal(storageKeys.ownersCsv, null);
    }
  } catch (err) {
    ownersLoadIssue = `Owners load failed: ${(err as Error).message}`;
  }

  let postseasonOverrides = readLocalPostseasonOverrides(
    storageKeys.postseasonOverrides,
    oldSeasonKeys?.postseasonOverrides ?? null
  );
  let postseasonOverridesLoadIssue: string | undefined;
  try {
    const serverOverridesState = await loadServerPostseasonOverrides(season, leagueSlug);
    if (serverOverridesState.hasStoredValue) {
      postseasonOverrides = serverOverridesState.map;
      writePostseasonOverridesToLocal(storageKeys.postseasonOverrides, serverOverridesState.map);
    } else if (leagueSlug) {
      // Server is authoritative for league-scoped data — no stored value means empty.
      postseasonOverrides = {};
      writePostseasonOverridesToLocal(storageKeys.postseasonOverrides, {});
    }
  } catch (err) {
    postseasonOverridesLoadIssue = `Postseason overrides load failed: ${(err as Error).message}`;
  }

  return {
    aliasMap,
    effectiveAliasMap,
    aliasLoadIssue,
    ownersCsvText,
    ownersLoadIssue,
    postseasonOverrides,
    postseasonOverridesLoadIssue,
  };
}

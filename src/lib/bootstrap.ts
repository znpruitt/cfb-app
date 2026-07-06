import { loadEffectiveAliases } from './aliasesApi.ts';
import { mergeAliasLayers } from './aliasLayers.ts';
import { readEffectiveAliasCache, serializeEffectiveAliasCache } from './effectiveAliasCache.ts';
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

// The effective-alias fetch is the ONLY client path that surfaces league-scoped
// stored repairs (via getScopedAliasMap: stored global > league+year > year >
// seeds); the league-scoped stored GET was removed with the in-app editor. So a
// transient failure of this single request on a cold cache would drop identity
// to the local fallback (cached effective / legacy stored / seeds) and diverge
// from server canonical until a reload. A small bounded retry closes that window
// for momentary blips while re-fetching the FULL resolver map (all repair
// layers), so it beats fetching any narrower sub-scope. Only the failure path
// pays the delay — a first-attempt success returns immediately.
const EFFECTIVE_ALIAS_FETCH_ATTEMPTS = 3; // 1 initial + 2 retries
const EFFECTIVE_ALIAS_RETRY_BASE_MS = 150; // linear backoff: 150ms, 300ms

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadEffectiveAliasesWithRetry(
  season: number,
  leagueSlug: string | undefined
): Promise<AliasMap> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= EFFECTIVE_ALIAS_FETCH_ATTEMPTS; attempt += 1) {
    try {
      return await loadEffectiveAliases(season, leagueSlug);
    } catch (err) {
      lastError = err;
      if (attempt < EFFECTIVE_ALIAS_FETCH_ATTEMPTS) {
        await sleep(EFFECTIVE_ALIAS_RETRY_BASE_MS * attempt);
      }
    }
  }
  throw lastError;
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

  // effectiveAliasMap is the RESOLVER view (stored global > league+year > year >
  // SEED_ALIASES) used to build the client schedule/games so client identity
  // matches server canonical. It is the only client alias map — the former
  // stored-league editor map was removed with the (unreachable) in-app editor.
  let effectiveAliasMap: AliasMap = {};
  let aliasLoadIssue: string | undefined;

  // Resolver-map fallback: reconcile rather than trust a flattened cache. Layer
  // (highest first) any legacy STORED league-alias cache, then the cached
  // effective map IF its seed version still matches (else discarded so a
  // deploy-changed seed set can't resurrect stale identities), then the current
  // seed defaults. mergeAliasLayers gives the same stored > effective > seeds
  // precedence as the server resolver.
  //
  // The `cfb_name_map:*` cache is read-only here: the in-app editor and its
  // write path were removed (PLATFORM-064), so nothing writes this key anymore.
  // Reading it still matters during an effective-alias outage — a client
  // upgraded from pre-064 may hold persisted league repairs ONLY in this key
  // (e.g. a mid-bootstrap quota failure dropped the effective cache). Without
  // this layer that outage would rebuild identity from seeds alone and break
  // game/score attachment until the next successful fetch.
  const effectiveFallback = (): AliasMap => {
    const cached = readEffectiveAliasCache(
      window.localStorage.getItem(storageKeys.effectiveAliasMap),
      seedAliases
    );
    const storedLegacy = parseAliasMap(
      readWithMigrationChain(storageKeys.aliasMap, oldSeasonKeys?.aliasMap ?? null, null),
      {}
    );
    return mergeAliasLayers(
      cached ? [storedLegacy, cached, seedAliases] : [storedLegacy, seedAliases]
    );
  };

  try {
    effectiveAliasMap = await loadEffectiveAliasesWithRetry(season, leagueSlug);
    try {
      window.localStorage.setItem(
        storageKeys.effectiveAliasMap,
        serializeEffectiveAliasCache(effectiveAliasMap, seedAliases)
      );
    } catch {
      // ignore quota/serialization failures — cache is best-effort
    }
  } catch (err) {
    aliasLoadIssue = `Aliases load failed: ${(err as Error)?.message ?? 'unknown'}`;
    effectiveAliasMap = effectiveFallback();
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
    effectiveAliasMap,
    aliasLoadIssue,
    ownersCsvText,
    ownersLoadIssue,
    postseasonOverrides,
    postseasonOverridesLoadIssue,
  };
}

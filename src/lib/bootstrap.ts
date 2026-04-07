import { loadServerAliases, saveServerAliases } from './aliasesApi.ts';
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

  let aliasMap: AliasMap = {};
  let aliasLoadIssue: string | undefined;

  try {
    let serverMap = await loadServerAliases(season, leagueSlug);
    if (!Object.keys(serverMap).length && Object.keys(seedAliases).length) {
      serverMap = await saveServerAliases(seedAliases, [], season, leagueSlug);
    }
    aliasMap = serverMap;
    window.localStorage.setItem(storageKeys.aliasMap, JSON.stringify(serverMap));
  } catch (err) {
    aliasLoadIssue = `Aliases load failed: ${(err as Error).message}`;
    const cached = readWithMigrationChain(
      storageKeys.aliasMap,
      oldSeasonKeys?.aliasMap ?? null,
      null
    );
    if (cached) {
      try {
        aliasMap = JSON.parse(cached) as AliasMap;
      } catch {
        aliasMap = { ...seedAliases };
      }
    } else {
      aliasMap = { ...seedAliases };
    }
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
    aliasLoadIssue,
    ownersCsvText,
    ownersLoadIssue,
    postseasonOverrides,
    postseasonOverridesLoadIssue,
  };
}

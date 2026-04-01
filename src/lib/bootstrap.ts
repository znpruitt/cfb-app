import { loadServerAliases, saveServerAliases } from './aliasesApi.ts';
import { loadServerOwnersCsv } from './ownersApi.ts';
import {
  loadServerPostseasonOverrides,
  type PostseasonOverridesMap,
} from './postseasonOverridesApi.ts';
import { LEGACY_STORAGE_KEYS, seasonStorageKeys } from './storageKeys.ts';
import type { AliasMap } from './teamNames.ts';

function readOwnersCsvWithMigration(storageKey: string): string | null {
  const scoped = window.localStorage.getItem(storageKey);
  if (scoped != null) return scoped;

  const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEYS.ownersCsv);
  if (legacy != null) {
    window.localStorage.setItem(storageKey, legacy);
  }
  return legacy;
}

function writeOwnersCsvToLocal(storageKey: string, csvText: string | null): void {
  if (typeof csvText === 'string' && csvText.trim()) {
    window.localStorage.setItem(storageKey, csvText);
    return;
  }

  window.localStorage.removeItem(storageKey);
  window.localStorage.removeItem(LEGACY_STORAGE_KEYS.ownersCsv);
}

function readLocalPostseasonOverrides(storageKey: string): PostseasonOverridesMap {
  try {
    let rawOverrides = window.localStorage.getItem(storageKey);
    if (!rawOverrides) {
      rawOverrides = window.localStorage.getItem(LEGACY_STORAGE_KEYS.postseasonOverrides);
      if (rawOverrides) {
        window.localStorage.setItem(storageKey, rawOverrides);
      }
    }
    if (!rawOverrides) return {};
    return JSON.parse(rawOverrides) as PostseasonOverridesMap;
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
  const storageKeys = seasonStorageKeys(season);

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
    const cached = window.localStorage.getItem(storageKeys.aliasMap);
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

  let ownersCsvText = readOwnersCsvWithMigration(storageKeys.ownersCsv);
  let ownersLoadIssue: string | undefined;
  try {
    const serverOwnersState = await loadServerOwnersCsv(season, leagueSlug);
    if (serverOwnersState.hasStoredValue) {
      ownersCsvText = serverOwnersState.csvText;
      writeOwnersCsvToLocal(storageKeys.ownersCsv, serverOwnersState.csvText);
    }
  } catch (err) {
    ownersLoadIssue = `Owners load failed: ${(err as Error).message}`;
  }

  let postseasonOverrides = readLocalPostseasonOverrides(storageKeys.postseasonOverrides);
  let postseasonOverridesLoadIssue: string | undefined;
  try {
    const serverOverridesState = await loadServerPostseasonOverrides(season, leagueSlug);
    if (serverOverridesState.hasStoredValue) {
      postseasonOverrides = serverOverridesState.map;
      writePostseasonOverridesToLocal(storageKeys.postseasonOverrides, serverOverridesState.map);
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

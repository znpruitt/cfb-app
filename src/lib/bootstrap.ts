import { loadServerAliases, saveServerAliases } from './aliasesApi';
import { LEGACY_STORAGE_KEYS, seasonStorageKeys } from './storageKeys';
import type { AliasMap } from './teamNames';

function readSeasonScopedValue(key: string, legacyKey: string): string | null {
  const scoped = window.localStorage.getItem(key);
  if (scoped != null) return scoped;
  return window.localStorage.getItem(legacyKey);
}

export async function bootstrapAliasesAndCaches(params: {
  season: number;
  seedAliases: AliasMap;
}): Promise<{
  aliasMap: AliasMap;
  aliasLoadIssue?: string;
  ownersCsvText: string | null;
}> {
  const { season, seedAliases } = params;
  const storageKeys = seasonStorageKeys(season);

  let aliasMap: AliasMap = {};
  let aliasLoadIssue: string | undefined;

  try {
    let serverMap = await loadServerAliases(season);
    if (!Object.keys(serverMap).length && Object.keys(seedAliases).length) {
      serverMap = await saveServerAliases(seedAliases, [], season);
    }
    aliasMap = serverMap;
    window.localStorage.setItem(storageKeys.aliasMap, JSON.stringify(serverMap));
  } catch (err) {
    aliasLoadIssue = `Aliases load failed: ${(err as Error).message}`;
    const cached = readSeasonScopedValue(storageKeys.aliasMap, LEGACY_STORAGE_KEYS.aliasMap);
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

  const ownersCsvText = readSeasonScopedValue(storageKeys.ownersCsv, LEGACY_STORAGE_KEYS.ownersCsv);

  return { aliasMap, aliasLoadIssue, ownersCsvText };
}

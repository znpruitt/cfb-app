import { loadServerAliases, saveServerAliases } from './aliasesApi';
import { LEGACY_STORAGE_KEYS, seasonStorageKeys } from './storageKeys';
import type { AliasMap } from './teamNames';

function readOwnersCsvWithMigration(storageKey: string): string | null {
  const scoped = window.localStorage.getItem(storageKey);
  if (scoped != null) return scoped;

  const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEYS.ownersCsv);
  if (legacy != null) {
    window.localStorage.setItem(storageKey, legacy);
  }
  return legacy;
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

  const ownersCsvText = readOwnersCsvWithMigration(storageKeys.ownersCsv);

  return { aliasMap, aliasLoadIssue, ownersCsvText };
}

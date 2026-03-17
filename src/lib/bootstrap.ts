import { loadServerAliases, saveServerAliases } from './aliasesApi';
import { seasonStorageKeys } from './storageKeys';
import type { AliasMap } from './teamNames';

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

  const ownersCsvText = window.localStorage.getItem(storageKeys.ownersCsv);

  return { aliasMap, aliasLoadIssue, ownersCsvText };
}

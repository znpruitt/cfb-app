import { loadServerAliases, saveServerAliases } from './aliasesApi';
import type { AliasMap } from './teamNames';

export async function bootstrapAliasesAndCaches(params: {
  season: number;
  seedAliases: AliasMap;
}): Promise<{
  aliasMap: AliasMap;
  aliasLoadIssue?: string;
  scheduleCsvText: string | null;
  ownersCsvText: string | null;
}> {
  const { season, seedAliases } = params;

  let aliasMap: AliasMap = {};
  let aliasLoadIssue: string | undefined;

  try {
    let serverMap = await loadServerAliases(season);
    if (!Object.keys(serverMap).length && Object.keys(seedAliases).length) {
      serverMap = await saveServerAliases(seedAliases, [], season);
    }
    aliasMap = serverMap;
    window.localStorage.setItem('cfb_name_map', JSON.stringify(serverMap));
  } catch (err) {
    aliasLoadIssue = `Aliases load failed: ${(err as Error).message}`;
    const cached = window.localStorage.getItem('cfb_name_map');
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

  const scheduleCsvText = window.localStorage.getItem('cfb_schedule_csv');
  const ownersCsvText = window.localStorage.getItem('cfb_owners_csv');

  return { aliasMap, aliasLoadIssue, scheduleCsvText, ownersCsvText };
}

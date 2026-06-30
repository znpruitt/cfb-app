import { getAppState } from '@/lib/server/appStateStore';
import { getScopedAliasMap } from '@/lib/server/globalAliasStore';
import { buildScheduleFromApi, type AppGame, type ScheduleWireItem } from '@/lib/schedule';
import type { TeamCatalogItem } from '@/lib/teamIdentity';

/**
 * Loads the cached schedule for the spectator draft board and derives canonical
 * games using server-safe scoped alias resolution.
 *
 * Alias resolution goes through `getScopedAliasMap` (appState scopes:
 * league+year → year → global), never the browser-era loader in
 * `src/lib/aliases.ts` — so it works during server render and schedule-derived
 * draft insights populate instead of silently emptying out. Returns `[]` when
 * no schedule is cached for the season.
 */
export async function loadSpectatorBoardSchedule(params: {
  slug: string;
  year: number;
  teams: TeamCatalogItem[];
}): Promise<AppGame[]> {
  const { slug, year, teams } = params;
  const aliasMap = await getScopedAliasMap(slug, year);
  const schedRecord = await getAppState<{ items: unknown[] }>('schedule', `${year}-all-all`);
  const schedItems = (schedRecord?.value?.items ?? []) as ScheduleWireItem[];
  if (schedItems.length === 0) return [];
  return buildScheduleFromApi({ scheduleItems: schedItems, teams, aliasMap, season: year }).games;
}

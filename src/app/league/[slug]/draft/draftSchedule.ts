import { buildScheduleFromApi, type ScheduleWireItem, type AppGame } from '@/lib/schedule';
import { getScopedAliasMap } from '@/lib/server/globalAliasStore';
import type { TeamCatalogItem } from '@/lib/teamIdentity';
import type { AliasMap } from '@/lib/teamNames';

/**
 * Resolve a cached draft-season schedule to canonical games using the SAME
 * effective alias map as canonical/live paths
 * (`getScopedAliasMap`: stored global > year > SEED_ALIASES), so
 * the draft board's game identity never diverges from server canonical. Returns
 * the resolved alias map too — the prior-year caller reuses it to build the
 * score-attachment resolver.
 */
export async function resolveDraftScheduleGames(params: {
  slug: string;
  year: number;
  teams: TeamCatalogItem[];
  scheduleItems: ScheduleWireItem[];
}): Promise<{ games: AppGame[]; aliasMap: AliasMap }> {
  const { slug, year, teams, scheduleItems } = params;
  const aliasMap = await getScopedAliasMap(slug, year);
  const { games } = buildScheduleFromApi({ scheduleItems, teams, aliasMap, season: year });
  return { games, aliasMap };
}

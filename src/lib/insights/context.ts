import type { CfbdSeasonType } from '../cfbd';
import { getCachedGameStats, listCachedGameStatsWeeks } from '../gameStats/cache';
import { aggregateOwnerSeasonStats } from '../gameStats/ownerStats';
import type { GameStats } from '../gameStats/types';
import type { League } from '../league';
import { parseOwnersCsv } from '../parseOwnersCsv';
import type { RankingsResponse } from '../rankings';
import type { AppGame } from '../schedule';
import { getSeasonArchive, listSeasonArchives, type SeasonArchive } from '../seasonArchive';
import { getAppState } from '../server/appStateStore';
import { getTeamDatabaseItems } from '../server/teamDatabaseStore';
import type { SeasonContext } from '../selectors/seasonContext';
import type { OwnerStandingsRow } from '../standings';
import type { StandingsHistoryWeekSnapshot } from '../standingsHistory';
import { createTeamIdentityResolver } from '../teamIdentity';
import type { AliasMap } from '../teamNames';
import { chooseDefaultWeek, deriveRegularWeeks } from '../weekSelection';
import { deriveLifecycleState, deriveTotalRegularSeasonWeeks } from './lifecycle';
import type { InsightContext, OwnerSeasonStats } from './types';

async function loadAliasMap(leagueSlug: string, year: number): Promise<AliasMap> {
  let aliasMap: AliasMap = {};
  const scopes = [`aliases:${leagueSlug}:${year}`, `aliases:${year}`, 'aliases:global'];
  for (const scope of scopes) {
    const record = await getAppState<AliasMap>(scope, 'map');
    const value = record?.value;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      aliasMap = { ...value, ...aliasMap };
    }
  }
  return aliasMap;
}

async function loadArchives(leagueSlug: string): Promise<SeasonArchive[]> {
  const years = await listSeasonArchives(leagueSlug);
  const archives = await Promise.all(years.map((year) => getSeasonArchive(leagueSlug, year)));
  return archives.filter((archive): archive is SeasonArchive => archive !== null);
}

function buildHistoricalRosters(archives: SeasonArchive[]): Record<number, Map<string, string>> {
  const result: Record<number, Map<string, string>> = {};
  for (const archive of archives) {
    const rows = parseOwnersCsv(archive.ownerRosterSnapshot);
    result[archive.year] = new Map(rows.map((row) => [row.team, row.owner]));
  }
  return result;
}

async function loadOwnerSeasonStats(
  leagueSlug: string,
  year: number,
  currentRoster: Map<string, string>,
  games: AppGame[]
): Promise<OwnerSeasonStats[] | null> {
  const weekKeys = await listCachedGameStatsWeeks(year);
  if (weekKeys.length === 0) return null;

  const [teams, aliasMap] = await Promise.all([
    getTeamDatabaseItems(),
    loadAliasMap(leagueSlug, year),
  ]);
  const observedNames = Array.from(
    new Set(games.flatMap((game) => [game.csvAway, game.csvHome]).filter(Boolean))
  );
  const resolver = createTeamIdentityResolver({ teams, aliasMap, observedNames });

  const weeklyGames: GameStats[][] = [];
  for (const key of weekKeys) {
    const parts = key.split(':');
    if (parts.length !== 3) continue;
    const week = Number(parts[1]);
    if (!Number.isFinite(week)) continue;
    const seasonType = parts[2] as CfbdSeasonType;
    const stats = await getCachedGameStats(year, week, seasonType);
    if (!stats) continue;
    weeklyGames.push(stats.games);
  }

  if (weeklyGames.length === 0) return null;
  return aggregateOwnerSeasonStats(weeklyGames, currentRoster, resolver, year);
}

export async function buildInsightContext(
  leagueSlug: string,
  league: League,
  currentStandings: OwnerStandingsRow[],
  weeklyStandings: StandingsHistoryWeekSnapshot[],
  games: AppGame[],
  seasonContext: SeasonContext,
  rankings: RankingsResponse | null,
  currentRoster: Map<string, string>
): Promise<InsightContext> {
  const regularWeeks = deriveRegularWeeks(games);
  const currentWeek = chooseDefaultWeek({ games, regularWeeks });
  const totalRegularSeasonWeeks = deriveTotalRegularSeasonWeeks(games);
  const leagueStatus = league.status ?? { state: 'season', year: league.year };
  const lifecycleState = deriveLifecycleState(
    leagueStatus,
    seasonContext,
    currentWeek,
    totalRegularSeasonWeeks,
    new Date()
  );

  const archives = await loadArchives(leagueSlug);
  const historicalRosters = buildHistoricalRosters(archives);

  const ownerGameStats =
    lifecycleState === 'preseason' || lifecycleState === 'offseason'
      ? null
      : await loadOwnerSeasonStats(leagueSlug, league.year, currentRoster, games);

  return {
    leagueSlug,
    currentYear: league.year,
    lifecycleState,
    seasonContext,
    currentWeek,
    currentStandings,
    weeklyStandings,
    games,
    ownerGameStats,
    archives,
    historicalRosters,
    rankings,
    currentRoster,
  };
}

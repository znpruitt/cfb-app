import type { CfbdSeasonType } from '../cfbd';
import { getCachedGameStats, listCachedGameStatsWeeks } from '../gameStats/cache';
import type { GameStats, TeamGameStats } from '../gameStats/types';
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
import { createTeamIdentityResolver, type TeamIdentityResolver } from '../teamIdentity';
import type { AliasMap } from '../teamNames';
import { deriveRegularWeeks, chooseDefaultWeek } from '../weekSelection';
import { deriveLifecycleState, deriveTotalRegularSeasonWeeks } from './lifecycle';
import type { InsightContext, OwnerSeasonStats } from './types';

type SeasonAccumulator = {
  owner: string;
  gamesPlayed: number;
  points: number;
  totalYards: number;
  rushingYards: number;
  passingYards: number;
  turnovers: number;
  turnoversForced: number;
  thirdDownConversions: number;
  thirdDownAttempts: number;
  possessionSeconds: number;
};

function emptySeasonAccumulator(owner: string): SeasonAccumulator {
  return {
    owner,
    gamesPlayed: 0,
    points: 0,
    totalYards: 0,
    rushingYards: 0,
    passingYards: 0,
    turnovers: 0,
    turnoversForced: 0,
    thirdDownConversions: 0,
    thirdDownAttempts: 0,
    possessionSeconds: 0,
  };
}

function addTeamToSeasonAccumulator(
  acc: SeasonAccumulator,
  team: TeamGameStats,
  opponent: TeamGameStats
): void {
  acc.gamesPlayed += 1;
  acc.points += team.points;
  acc.totalYards += team.totalYards;
  acc.rushingYards += team.rushingYards;
  acc.passingYards += team.passingYards;
  acc.turnovers += team.turnovers;
  acc.turnoversForced += opponent.turnovers;
  acc.thirdDownConversions += team.thirdDownConversions;
  acc.thirdDownAttempts += team.thirdDownAttempts;
  acc.possessionSeconds += team.possessionSeconds;
}

function resolveOwner(
  team: TeamGameStats,
  rosterByTeam: Map<string, string>,
  resolver: TeamIdentityResolver
): string | null {
  const resolved = resolver.resolveName(team.school);
  if (resolved.identityKey) {
    const owner = rosterByTeam.get(resolved.identityKey);
    if (owner) return owner;
  }
  const canonical = resolved.canonicalName ?? team.school;
  return rosterByTeam.get(canonical) ?? null;
}

function toOwnerSeasonStats(acc: SeasonAccumulator, season: number): OwnerSeasonStats {
  return {
    owner: acc.owner,
    season,
    gamesPlayed: acc.gamesPlayed,
    points: acc.points,
    totalYards: acc.totalYards,
    rushingYards: acc.rushingYards,
    passingYards: acc.passingYards,
    turnovers: acc.turnovers,
    turnoversForced: acc.turnoversForced,
    turnoverMargin: acc.turnoversForced - acc.turnovers,
    thirdDownConversions: acc.thirdDownConversions,
    thirdDownAttempts: acc.thirdDownAttempts,
    thirdDownPct: acc.thirdDownAttempts > 0 ? acc.thirdDownConversions / acc.thirdDownAttempts : 0,
    possessionSeconds: acc.possessionSeconds,
  };
}

function aggregateOwnerSeasonStats(
  games: GameStats[],
  rosterByTeam: Map<string, string>,
  resolver: TeamIdentityResolver,
  season: number
): OwnerSeasonStats[] {
  const accumulators = new Map<string, SeasonAccumulator>();

  for (const game of games) {
    const sides: Array<{ team: TeamGameStats; opponent: TeamGameStats }> = [
      { team: game.home, opponent: game.away },
      { team: game.away, opponent: game.home },
    ];
    for (const { team, opponent } of sides) {
      const owner = resolveOwner(team, rosterByTeam, resolver);
      if (!owner) continue;
      const acc = accumulators.get(owner) ?? emptySeasonAccumulator(owner);
      addTeamToSeasonAccumulator(acc, team, opponent);
      accumulators.set(owner, acc);
    }
  }

  return Array.from(accumulators.values()).map((acc) => toOwnerSeasonStats(acc, season));
}

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

  const allGames: GameStats[] = [];
  for (const key of weekKeys) {
    const parts = key.split(':');
    if (parts.length !== 3) continue;
    const week = Number(parts[1]);
    if (!Number.isFinite(week)) continue;
    const seasonType = parts[2] as CfbdSeasonType;
    const stats = await getCachedGameStats(year, week, seasonType);
    if (!stats) continue;
    allGames.push(...stats.games);
  }

  if (allGames.length === 0) return null;
  return aggregateOwnerSeasonStats(allGames, currentRoster, resolver, year);
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

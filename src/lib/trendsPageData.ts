import { loadServerAliases } from './aliasesApi';
import { parseOwnersCsv } from './parseOwnersCsv';
import { loadServerOwnersCsv } from './ownersApi';
import {
  buildScheduleFromApi,
  fetchSeasonSchedule,
  type BuiltSchedule,
  type ScheduleFetchMeta,
} from './schedule';
import { fetchScoresByGame, type ScorePack } from './scores';
import { selectSeasonContext, type SeasonContext } from './selectors/seasonContext';
import { deriveStandingsHistory, type StandingsHistory } from './standingsHistory';
import { fetchTeamsCatalog } from './teamsCatalog';

export type TrendsPageData = {
  standingsHistory: StandingsHistory | null;
  seasonContext: SeasonContext | null;
  season: number;
  issues: string[];
  hasPartialData: boolean;
  scheduleMeta: ScheduleFetchMeta;
};

type TrendsPageDataDependencies = {
  fetchTeamsCatalog: typeof fetchTeamsCatalog;
  loadServerAliases: typeof loadServerAliases;
  loadServerOwnersCsv: typeof loadServerOwnersCsv;
  fetchSeasonSchedule: typeof fetchSeasonSchedule;
  buildScheduleFromApi: typeof buildScheduleFromApi;
  fetchScoresByGame: typeof fetchScoresByGame;
};

const DEFAULT_DEPENDENCIES: TrendsPageDataDependencies = {
  fetchTeamsCatalog,
  loadServerAliases,
  loadServerOwnersCsv,
  fetchSeasonSchedule,
  buildScheduleFromApi,
  fetchScoresByGame,
};

function buildRosterByTeamMap(csvText: string | null): Map<string, string> {
  const roster = parseOwnersCsv(csvText ?? '');
  return new Map(roster.map((entry) => [entry.team, entry.owner]));
}

function emptyResult(params: {
  season: number;
  issues: string[];
  hasPartialData: boolean;
  scheduleMeta?: ScheduleFetchMeta;
}): TrendsPageData {
  const { season, issues, hasPartialData, scheduleMeta = {} } = params;

  return {
    standingsHistory: null,
    seasonContext: null,
    season,
    issues,
    hasPartialData,
    scheduleMeta,
  };
}

export async function loadCanonicalTrendsPageData(
  season: number,
  deps: Partial<TrendsPageDataDependencies> = {}
): Promise<TrendsPageData> {
  const services: TrendsPageDataDependencies = { ...DEFAULT_DEPENDENCIES, ...deps };
  const issues: string[] = [];
  let hasPartialData = false;

  const [teamsResult, aliasesResult, ownersResult, scheduleResult] = await Promise.allSettled([
    services.fetchTeamsCatalog(),
    services.loadServerAliases(season),
    services.loadServerOwnersCsv(season),
    services.fetchSeasonSchedule(season),
  ]);

  const teams = teamsResult.status === 'fulfilled' ? teamsResult.value : [];
  const aliasMap = aliasesResult.status === 'fulfilled' ? aliasesResult.value : {};
  const ownersCsvText = ownersResult.status === 'fulfilled' ? ownersResult.value.csvText : null;

  if (teamsResult.status === 'rejected') {
    issues.push('Failed to load teams catalog');
    hasPartialData = true;
  }
  if (aliasesResult.status === 'rejected') {
    issues.push('Failed to load aliases');
    hasPartialData = true;
  }

  if (ownersResult.status === 'rejected') {
    issues.push('Failed to load owners CSV');
    hasPartialData = true;
  } else if (!ownersResult.value.csvText) {
    issues.push('Owners CSV missing or empty');
    hasPartialData = true;
  }

  if (scheduleResult.status === 'rejected') {
    issues.push('Failed to load schedule');
    return emptyResult({
      season,
      issues,
      hasPartialData: true,
    });
  }

  let builtSchedule: BuiltSchedule;
  try {
    builtSchedule = services.buildScheduleFromApi({
      scheduleItems: scheduleResult.value.items,
      teams,
      aliasMap,
      season,
    });
    if (builtSchedule.issues.length > 0) {
      issues.push(...builtSchedule.issues);
      hasPartialData = true;
    }
  } catch {
    issues.push('Failed to normalize schedule');
    return emptyResult({
      season,
      issues,
      hasPartialData: true,
      scheduleMeta: scheduleResult.value.meta,
    });
  }

  const rosterByTeam = buildRosterByTeamMap(ownersCsvText);
  let scoresByKey: Record<string, ScorePack> = {};

  if (builtSchedule.games.length > 0) {
    try {
      const scoresResult = await services.fetchScoresByGame({
        games: builtSchedule.games,
        aliasMap,
        season,
        teams,
      });
      scoresByKey = scoresResult.scoresByKey;
      if (scoresResult.issues.length > 0) {
        issues.push(...scoresResult.issues);
        hasPartialData = true;
      }
    } catch {
      issues.push('Failed to load scores');
      hasPartialData = true;
    }
  }

  const standingsHistory = deriveStandingsHistory({
    games: builtSchedule.games,
    rosterByTeam,
    scoresByKey,
  });

  return {
    standingsHistory,
    seasonContext: selectSeasonContext({ standingsHistory }),
    season,
    issues,
    hasPartialData,
    scheduleMeta: scheduleResult.value.meta,
  };
}

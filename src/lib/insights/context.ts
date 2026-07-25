import { getCachedGameStats, listCachedGameStatsWeeks } from '../gameStats/cache';
import {
  assembleArchiveAnalyticsProvenance,
  assembleLiveAnalyticsProvenance,
  type AnalyticsProvenanceUnavailableReason,
} from '../gameStats/analyticsProvenance';
import type { AnalyticsGameStats, SeasonRelation } from '../gameStats/contract';
import { aggregateOwnerSeasonStats } from '../gameStats/ownerStats';
import { projectAnalyticsPartition } from '../gameStats/publicProjection';
import type { League } from '../league';
import { parseOwnersCsv } from '../parseOwnersCsv';
import type { RankingsResponse } from '../rankings';
import type { AppGame } from '../schedule';
import { getSeasonArchive, listSeasonArchives, type SeasonArchive } from '../seasonArchive';
import { getScopedAliasMap } from '../server/globalAliasStore';
import { getTeamDatabaseItems } from '../server/teamDatabaseStore';
import type { SeasonContext } from '../selectors/seasonContext';
import type { OwnerStandingsRow } from '../standings';
import type { StandingsHistoryWeekSnapshot } from '../standingsHistory';
import { createTeamIdentityResolver } from '../teamIdentity';
import { chooseDefaultWeek, deriveRegularWeeks } from '../weekSelection';
import { deriveLifecycleState, deriveTotalRegularSeasonWeeks } from './lifecycle';
import { selectAllRecords } from '../selectors/leagueRecords';
import type { InsightContext, OwnerCareerStats, OwnerSeasonStats } from './types';

const NO_CLAIM_OWNER = 'NoClaim';

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

/** The paired provenance a season-stats load runs against. */
export type OwnerSeasonStatsSource = { kind: 'live' } | { kind: 'archive'; archive: SeasonArchive };

export type OwnerSeasonStatsUnavailableReason =
  | AnalyticsProvenanceUnavailableReason
  | 'no-cached-partitions';

export type OwnerSeasonStatsLoad =
  | { status: 'available'; stats: OwnerSeasonStats[] }
  | { status: 'unavailable'; reason: OwnerSeasonStatsUnavailableReason };

/**
 * PLATFORM-086H3E3 — owner season stats consume ONLY the final-and-complete
 * analytics projection over ONE paired provenance:
 *
 *   - `live`: the league-scoped scored build assembled once, cache-only, with
 *     the slate derived from that exact build;
 *   - `archive`: the archive's own `gameStatSlate` snapshot paired with the
 *     archive's own `scoresByKey` — absent/malformed snapshots FAIL CLOSED
 *     with a distinct reason (no live rebuild, no cross-provenance fallback).
 *
 * Committed weekly records are read cache-only; each partition projects
 * through `projectAnalyticsPartition` (final canonical score + complete,
 * participant-verified evidence, per game, sibling-independent) and only the
 * projected rows aggregate.
 */
export async function loadOwnerSeasonStats(
  leagueSlug: string,
  year: number,
  currentRoster: Map<string, string>,
  source: OwnerSeasonStatsSource
): Promise<OwnerSeasonStatsLoad> {
  const provenance =
    source.kind === 'live'
      ? await assembleLiveAnalyticsProvenance({ leagueSlug, year, now: new Date() })
      : assembleArchiveAnalyticsProvenance(source.archive);
  if (provenance.status === 'unavailable') {
    return { status: 'unavailable', reason: provenance.reason };
  }

  const weekKeys = await listCachedGameStatsWeeks(year);
  if (weekKeys.length === 0) return { status: 'unavailable', reason: 'no-cached-partitions' };

  const [teams, aliasMap] = await Promise.all([
    getTeamDatabaseItems(),
    getScopedAliasMap(leagueSlug, year),
  ]);
  // Observed names seed from the provenance slate's SETTLED participants —
  // never from raw provider labels of another build.
  const observedNames = Array.from(
    new Set(
      provenance.input.slate.games
        .flatMap((game) => [game.home?.canonicalName, game.away?.canonicalName])
        .filter((name): name is string => Boolean(name))
    )
  );
  const resolver = createTeamIdentityResolver({ teams, aliasMap, observedNames });

  // Season relation only disambiguates DEFECTIVE evidence (current → absent /
  // recoverable, historical → manual-only); neither state ever aggregates.
  const seasonRelation: SeasonRelation = source.kind === 'archive' ? 'historical' : 'current';

  const weeklyGames: AnalyticsGameStats[][] = [];
  for (const key of weekKeys) {
    const parts = key.split(':');
    if (parts.length !== 3) continue;
    const week = Number(parts[1]);
    if (!Number.isFinite(week)) continue;
    const seasonType = parts[2];
    if (seasonType !== 'regular' && seasonType !== 'postseason') continue;
    const stats = await getCachedGameStats(year, week, seasonType);
    const rows = projectAnalyticsPartition(
      provenance.input,
      week,
      seasonType,
      stats,
      seasonRelation
    );
    if (rows.length > 0) weeklyGames.push(rows);
  }

  return {
    status: 'available',
    stats: aggregateOwnerSeasonStats(weeklyGames, currentRoster, resolver, year),
  };
}

export type CareerStatsDiagnostic = {
  totalGames: number;
  resolvedGames: number;
  unresolvedGames: number;
  gameStatsCacheAvailable: boolean;
  /** Set when game stats are unavailable — the distinct fail-closed reason. */
  gameStatsUnavailableReason?: OwnerSeasonStatsUnavailableReason;
  ownersInFinalStandings: number;
};

export type CareerStatsBuildResult = {
  ownerCareerStats: OwnerCareerStats[];
  diagnosticsByYear: Record<number, CareerStatsDiagnostic>;
};

type CareerAccumulator = {
  owner: string;
  seasons: number;
  totalWins: number;
  totalLosses: number;
  totalPoints: number;
  totalPointsAgainst: number;
  totalYards: number;
  totalTurnovers: number;
  totalTurnoversForced: number;
  titles: number;
  titleYears: number[];
  finishHistory: { year: number; rank: number }[];
  firstSeason: number | null;
};

function emptyCareerAccumulator(owner: string): CareerAccumulator {
  return {
    owner,
    seasons: 0,
    totalWins: 0,
    totalLosses: 0,
    totalPoints: 0,
    totalPointsAgainst: 0,
    totalYards: 0,
    totalTurnovers: 0,
    totalTurnoversForced: 0,
    titles: 0,
    titleYears: [],
    finishHistory: [],
    firstSeason: null,
  };
}

function countUnresolvedGames(archive: SeasonArchive, roster: Map<string, string>): number {
  let unresolved = 0;
  for (const game of archive.games) {
    const homeOwner = roster.get(game.csvHome) ?? roster.get(game.canHome);
    const awayOwner = roster.get(game.csvAway) ?? roster.get(game.canAway);
    if (!homeOwner && !awayOwner) unresolved += 1;
  }
  return unresolved;
}

function countResolvedGames(archive: SeasonArchive, roster: Map<string, string>): number {
  let resolved = 0;
  for (const game of archive.games) {
    const homeOwner = roster.get(game.csvHome) ?? roster.get(game.canHome);
    const awayOwner = roster.get(game.csvAway) ?? roster.get(game.canAway);
    if (homeOwner || awayOwner) resolved += 1;
  }
  return resolved;
}

export async function buildOwnerCareerStats(params: {
  leagueSlug: string;
  currentYear: number;
  archives: SeasonArchive[];
  historicalRosters: Record<number, Map<string, string>>;
  currentRoster: Map<string, string>;
}): Promise<CareerStatsBuildResult> {
  const { leagueSlug, currentYear, archives, historicalRosters, currentRoster } = params;

  const activeOwners = new Set<string>();
  for (const owner of currentRoster.values()) {
    if (owner && owner !== NO_CLAIM_OWNER) activeOwners.add(owner);
  }

  const accumulators = new Map<string, CareerAccumulator>();
  for (const owner of activeOwners) {
    accumulators.set(owner, emptyCareerAccumulator(owner));
  }

  const diagnosticsByYear: Record<number, CareerStatsDiagnostic> = {};
  const sortedArchives = [...archives].sort((a, b) => a.year - b.year);

  for (const archive of sortedArchives) {
    const yearRoster = historicalRosters[archive.year] ?? new Map<string, string>();
    const standings = archive.finalStandings;
    const eligibleRows = standings.filter(
      (row) => row.owner && row.owner !== NO_CLAIM_OWNER && activeOwners.has(row.owner)
    );

    const eligibleStandings = standings.filter((row) => row.owner && row.owner !== NO_CLAIM_OWNER);
    for (let i = 0; i < eligibleStandings.length; i++) {
      const row = eligibleStandings[i]!;
      if (!activeOwners.has(row.owner)) continue;

      const acc = accumulators.get(row.owner)!;
      acc.seasons += 1;
      acc.totalWins += row.wins;
      acc.totalLosses += row.losses;
      acc.totalPoints += row.pointsFor;
      acc.totalPointsAgainst += row.pointsAgainst;
      const rank = i + 1;
      acc.finishHistory.push({ year: archive.year, rank });
      if (rank === 1) {
        acc.titles += 1;
        acc.titleYears.push(archive.year);
      }
      if (acc.firstSeason === null || archive.year < acc.firstSeason) {
        acc.firstSeason = archive.year;
      }
    }

    // Archived-year game stats consume the archive's OWN paired provenance
    // (gameStatSlate + scoresByKey); a pre-E1 archive without a snapshot fails
    // closed here with a distinct reason until it is backfilled.
    const yearStats = await loadOwnerSeasonStats(leagueSlug, archive.year, yearRoster, {
      kind: 'archive',
      archive,
    });
    if (yearStats.status === 'available') {
      for (const stats of yearStats.stats) {
        if (!activeOwners.has(stats.owner)) continue;
        const acc = accumulators.get(stats.owner)!;
        acc.totalYards += stats.totalYards;
        acc.totalTurnovers += stats.turnovers;
        acc.totalTurnoversForced += stats.turnoversForced;
      }
    }

    diagnosticsByYear[archive.year] = {
      totalGames: archive.games.length,
      resolvedGames: countResolvedGames(archive, yearRoster),
      unresolvedGames: countUnresolvedGames(archive, yearRoster),
      gameStatsCacheAvailable: yearStats.status === 'available',
      ...(yearStats.status === 'unavailable'
        ? { gameStatsUnavailableReason: yearStats.reason }
        : {}),
      ownersInFinalStandings: eligibleRows.length,
    };
  }

  const ownerCareerStats: OwnerCareerStats[] = [];
  for (const acc of accumulators.values()) {
    const firstSeason = acc.firstSeason ?? currentYear;
    ownerCareerStats.push({
      owner: acc.owner,
      seasons: acc.seasons,
      totalWins: acc.totalWins,
      totalLosses: acc.totalLosses,
      totalPoints: acc.totalPoints,
      totalPointsAgainst: acc.totalPointsAgainst,
      totalYards: acc.totalYards,
      totalTurnovers: acc.totalTurnovers,
      totalTurnoversForced: acc.totalTurnoversForced,
      totalTurnoverMargin: acc.totalTurnoversForced - acc.totalTurnovers,
      titles: acc.titles,
      titleYears: acc.titleYears,
      finishHistory: acc.finishHistory.sort((a, b) => a.year - b.year),
      firstSeason,
      isRookie: firstSeason === currentYear,
    });
  }

  ownerCareerStats.sort((a, b) => b.totalWins - a.totalWins);
  return { ownerCareerStats, diagnosticsByYear };
}

// Pure: exported for testing. Resolves the effective roster for insight
// generation, borrowing from the most recent archive when the current-year CSV
// is empty (fresh_offseason rollover window).
export function computeRosterFallback(
  currentRoster: Map<string, string>,
  archives: SeasonArchive[]
): { resolvedRoster: Map<string, string>; usingArchivedRoster: boolean } {
  if (currentRoster.size > 0 || archives.length === 0) {
    return { resolvedRoster: currentRoster, usingArchivedRoster: false };
  }
  const mostRecent = [...archives].sort((a, b) => b.year - a.year)[0]!;
  const rows = parseOwnersCsv(mostRecent.ownerRosterSnapshot);
  return {
    resolvedRoster: new Map(rows.map((r) => [r.team, r.owner])),
    usingArchivedRoster: true,
  };
}

export async function buildInsightContext(
  leagueSlug: string,
  league: League,
  currentStandings: OwnerStandingsRow[],
  weeklyStandings: StandingsHistoryWeekSnapshot[],
  games: AppGame[],
  seasonContext: SeasonContext,
  rankings: RankingsResponse | null,
  currentRoster: Map<string, string>,
  currentDate: Date
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
    currentDate
  );

  const archives = await loadArchives(leagueSlug);
  const historicalRosters = buildHistoricalRosters(archives);

  const { resolvedRoster, usingArchivedRoster } = computeRosterFallback(currentRoster, archives);

  let ownerGameStats: OwnerSeasonStats[] | null = null;
  if (lifecycleState !== 'preseason' && lifecycleState !== 'offseason') {
    const load = await loadOwnerSeasonStats(leagueSlug, league.year, resolvedRoster, {
      kind: 'live',
    });
    ownerGameStats = load.status === 'available' ? load.stats : null;
  }

  const { ownerCareerStats } = await buildOwnerCareerStats({
    leagueSlug,
    currentYear: league.year,
    archives,
    historicalRosters,
    currentRoster: resolvedRoster,
  });

  const records = selectAllRecords({
    archives,
    historicalRosters,
    currentYear: league.year,
    currentRoster: resolvedRoster,
  });

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
    ownerCareerStats,
    archives,
    historicalRosters,
    rankings,
    currentRoster: resolvedRoster,
    usingArchivedRoster,
    records,
  };
}

import type { ScorePack } from './scores.ts';
import type { AppGame } from './schedule.ts';
import {
  deriveStandings,
  deriveStandingsCoverage,
  type OwnerStandingsRow,
  type StandingsCoverage,
} from './standings.ts';

export type StandingsHistoryStandingRow = OwnerStandingsRow & {
  ties: number;
};

export type StandingsHistoryWeekSnapshot = {
  week: number;
  standings: StandingsHistoryStandingRow[];
  coverage: StandingsCoverage;
};

export type OwnerStandingsSeriesPoint = {
  week: number;
  wins: number;
  losses: number;
  ties: number;
  winPct: number;
  pointsFor: number;
  pointsAgainst: number;
  pointDifferential: number;
  gamesBack: number;
};

export type StandingsHistory = {
  weeks: number[];
  byWeek: Record<number, StandingsHistoryWeekSnapshot>;
  byOwner: Record<string, OwnerStandingsSeriesPoint[]>;
};

function normalizeRosterByTeam(
  rosterByTeam: Map<string, string> | Record<string, string>
): Map<string, string> {
  if (rosterByTeam instanceof Map) return rosterByTeam;
  return new Map(Object.entries(rosterByTeam));
}

function deriveOrderedWeeks(games: AppGame[]): number[] {
  return Array.from(
    new Set(games.map((game) => game.week).filter((week): week is number => Number.isFinite(week)))
  ).sort((a, b) => a - b);
}

function toHistoryStandingsRows(rows: OwnerStandingsRow[]): StandingsHistoryStandingRow[] {
  return rows.map((row) => ({
    ...row,
    ties: 0,
  }));
}

function toSeriesPoint(week: number, row: StandingsHistoryStandingRow): OwnerStandingsSeriesPoint {
  return {
    week,
    wins: row.wins,
    losses: row.losses,
    ties: row.ties,
    winPct: row.winPct,
    pointsFor: row.pointsFor,
    pointsAgainst: row.pointsAgainst,
    pointDifferential: row.pointDifferential,
    gamesBack: row.gamesBack,
  };
}

export function deriveStandingsHistory(args: {
  games: AppGame[];
  rosterByTeam: Map<string, string> | Record<string, string>;
  scoresByKey: Record<string, ScorePack>;
}): StandingsHistory {
  const { games, scoresByKey } = args;
  const rosterByTeam = normalizeRosterByTeam(args.rosterByTeam);
  const weeks = deriveOrderedWeeks(games);

  if (weeks.length === 0) {
    return {
      weeks: [],
      byWeek: {},
      byOwner: {},
    };
  }

  const byWeek: Record<number, StandingsHistoryWeekSnapshot> = {};
  const byOwner: Record<string, OwnerStandingsSeriesPoint[]> = {};
  const gamesByWeek = new Map<number, AppGame[]>();

  for (const week of weeks) {
    gamesByWeek.set(
      week,
      games.filter((game) => game.week === week)
    );
  }

  const cumulativeGames: AppGame[] = [];
  for (const week of weeks) {
    const weekGames = gamesByWeek.get(week) ?? [];
    cumulativeGames.push(...weekGames);

    const snapshot = deriveStandings(cumulativeGames, rosterByTeam, scoresByKey);
    const standings = toHistoryStandingsRows(snapshot.rows);
    const coverage = deriveStandingsCoverage(cumulativeGames, rosterByTeam, scoresByKey);

    byWeek[week] = {
      week,
      standings,
      coverage,
    };

    for (const row of standings) {
      if (!byOwner[row.owner]) byOwner[row.owner] = [];
      byOwner[row.owner]!.push(toSeriesPoint(week, row));
    }
  }

  return {
    weeks,
    byWeek,
    byOwner,
  };
}

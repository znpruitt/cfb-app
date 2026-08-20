import type { ScorePack } from './scores.ts';
import type { AppGame } from './schedule.ts';
import { getGameOwners } from './gameOwnership.ts';
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
  /**
   * PLATFORM-105 — has this week actually been played?
   *
   * SEPARATE from `coverage`, which answers "are we missing scores for games
   * that were played". A week with nothing played has no final games, so nothing
   * is missing, so its coverage is `complete` — which is how an unplayed week
   * came to count as resolved and a season in progress reported itself over from
   * week one. The two facts now have two fields.
   *
   * OPTIONAL because durable season archives written before this field exist and
   * cannot grow it retroactively. Absent means PLAYED: an archive is a completed
   * season by definition, and `snapshotFromArchive` serves it as `offseason`
   * regardless. See `docs/architecture/week-resolution.md`.
   */
  played?: boolean;
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

/**
 * How long a game can possibly last: regulation, overtime, a weather delay, and
 * a wide margin. NOT a tuning knob — its only job is to stop a game that kicked
 * off ninety minutes ago from being read as one that will never be played.
 */
const GAME_MAX_DURATION_MS = 8 * 60 * 60 * 1000;

/**
 * Has this game reached a state it will never leave?
 *
 * `final` is the ordinary answer. The elapsed-time clause exists because CFBD
 * cannot tell us a game was cancelled: `/games` has no status field at all, and
 * a cancelled game keeps `completed: false` with null scores permanently —
 * `Liberty @ App State` (week 5, 2024, Hurricane Helene) still returned
 * `completed: false` when CFBD was queried directly on 2026-08-19, nearly two
 * years later. A future game and an abandoned one differ only in whether their
 * kickoff is ahead of us or behind us, so that is what this reads.
 */
export function isGameConcluded(game: AppGame, now: Date): boolean {
  if (game.status === 'final') return true;
  if (!game.date) return false;
  const kickoff = Date.parse(game.date);
  if (!Number.isFinite(kickoff)) return false;
  return now.getTime() - kickoff > GAME_MAX_DURATION_MS;
}

/** A game concluded by elapsed time rather than by the provider saying so. */
export type InferredConclusion = {
  key: string;
  week: number;
  date: string | null;
  status: AppGame['status'];
};

export function deriveStandingsHistory(args: {
  games: AppGame[];
  rosterByTeam: Map<string, string> | Record<string, string>;
  scoresByKey: Record<string, ScorePack>;
  coverageOptions?: {
    isLoadingScores?: boolean;
    hasScoreLoadError?: boolean;
  };
  /**
   * Evaluation time for the elapsed-time clause. Explicit so a test can place
   * itself in a season rather than depending on the wall clock, and so a replay
   * of a past date is honest.
   */
  now?: Date;
  /**
   * The canonical team catalogue. Weeks are judged over games between catalogue
   * teams (owner ruling, 2026-08-19): across six cached seasons, eleven of the
   * twelve games that never resolved were non-FBS provider noise, and scoping
   * excludes all eleven before any inference is needed. Omitted, the population
   * falls back to games involving a ROSTERED team, which is what coverage uses.
   */
  canonicalTeams?: ReadonlySet<string>;
}): StandingsHistory {
  const { games, scoresByKey, coverageOptions, canonicalTeams } = args;
  const now = args.now ?? new Date();
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

  // The population a week is judged over. The catalogue when we have it, the
  // roster otherwise — see the `canonicalTeams` note on the parameter.
  const inPopulation = (game: AppGame): boolean => {
    if (canonicalTeams) {
      const home =
        game.participants.home.kind === 'team' ? game.participants.home.canonicalName : null;
      const away =
        game.participants.away.kind === 'team' ? game.participants.away.canonicalName : null;
      return home != null && away != null && canonicalTeams.has(home) && canonicalTeams.has(away);
    }
    const owners = getGameOwners(game, rosterByTeam);
    return owners.homeOwner !== undefined || owners.awayOwner !== undefined;
  };

  const cumulativeGames: AppGame[] = [];
  for (const week of weeks) {
    const weekGames = gamesByWeek.get(week) ?? [];
    cumulativeGames.push(...weekGames);

    const snapshot = deriveStandings(cumulativeGames, rosterByTeam, scoresByKey);
    const standings = toHistoryStandingsRows(snapshot.rows);
    const coverage = deriveStandingsCoverage(
      cumulativeGames,
      rosterByTeam,
      scoresByKey,
      coverageOptions
    );

    // PLAYED is judged over THIS week's games, not the cumulative list — the
    // question is whether this week happened, and every earlier week already
    // has. A week with no relevant games is not played: it cannot be, and
    // counting it as played is how an empty future week closed a season.
    const relevant = weekGames.filter((game) => inPopulation(game));
    byWeek[week] = {
      week,
      standings,
      coverage,
      played: relevant.length > 0 && relevant.every((game) => isGameConcluded(game, now)),
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

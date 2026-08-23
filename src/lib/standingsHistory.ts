import type { ScorePack } from './scores.ts';
import type { AppGame } from './schedule.ts';
import { classifyGameConclusionEvidence, isDisruptedStatusLabel } from './gameStatus.ts';
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
   * PLATFORM-105 — every real game in this week has concluded on POSITIVE
   * EVIDENCE (a result, the provider's completed flag, or a terminal status).
   *
   * SEPARATE from `coverage`, which asks whether scores are missing for games
   * that were played. A week with nothing played has no final games, so nothing
   * is missing, so its coverage is `complete` — which is how an unplayed week
   * came to count as resolved and a season in progress reported itself over from
   * week one.
   *
   * TIME-INVARIANT: the elapsed-time allowance for an abandoned game is NOT
   * folded in here, because this value is cached and `AGENTS.md` invariant 3
   * forbids caching a clock-dependent classification. `pending` carries what a
   * consumer needs to apply the clock itself.
   *
   * OPTIONAL because durable season archives predate the field. Absent means
   * played: `buildSeasonArchive` strips it, and an archive is a completed season.
   */
  played?: boolean;
  /**
   * Real games in this week with no conclusion yet, each with the kickoff it was
   * planned for (null when it was never planned to a determined time).
   *
   * Time-invariant. `selectSeasonContext` reads this and applies the
   * eight-hour abandonment rule at request time.
   */
  pending?: PendingGame[];
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
 * a wide margin. Its only job is to stop a game that kicked off ninety minutes
 * ago from being read as one that will never be played.
 */
export const GAME_MAX_DURATION_MS = 8 * 60 * 60 * 1000;

/**
 * A REAL game has both teams known (owner ruling, 2026-08-20).
 *
 * A playoff or conference-championship shell — "winner of A vs winner of B" — is
 * not a game to wait on. It becomes one once the bracket resolves, and then it
 * gets a result like anything else. Earlier rounds excluded shells from the
 * population instead, which made an ALL-shell week unable to ever resolve.
 */
export function isRealGame(game: AppGame): boolean {
  return game.participants.home.kind === 'team' && game.participants.away.kind === 'team';
}

/**
 * A PLANNED game is a real game with a determined start date AND time.
 *
 * Only a planned game can be said not to have happened: a game can only "not
 * happen" if it was ever planned to occur. A bowl matchup announced without a
 * kickoff time is an incomplete dataset the weekly schedule refresh resolves —
 * not a stuck game.
 */
export function isPlannedGame(game: AppGame): boolean {
  return isRealGame(game) && Boolean(game.date) && game.startTimeTBD !== true;
}

/**
 * Has this game reached a terminal state on POSITIVE EVIDENCE alone?
 *
 * TIME-INVARIANT by construction, which is the point: `AGENTS.md` invariant 3
 * requires `unstable_cache`-wrapped selectors to return time-invariant facts,
 * and earlier rounds of this slice cached a clock-dependent verdict instead.
 * Both reviewers raised it three times before I checked the rule.
 *
 * Evidence in order of authority. `game.status` is effectively never `final` for
 * production schedule data — CFBD supplies no status string — and `rawStatus` is
 * always `scheduled`, so the labels are read from the SCORE, where `toStatus`
 * preserves an unrecognized provider value verbatim.
 */
export function isConcludedByEvidence(game: AppGame, score: ScorePack | undefined): boolean {
  return classifyGameConclusionEvidence(game, score) !== 'unresolved';
}

/** Postponed / suspended / delayed: still coming, so never abandoned. */
export function isDisruptedGame(game: AppGame, score: ScorePack | undefined): boolean {
  return isDisruptedStatusLabel(game.rawStatus) || isDisruptedStatusLabel(score?.status);
}

/**
 * A real game with no conclusion yet, and the kickoff it was planned for.
 *
 * `kickoff` is null when the game was never planned to a moment — an unresolved
 * date or a TBD time — which is exactly the case where "it didn't happen" cannot
 * be inferred. Stored rather than decided, so the clock is applied by whoever
 * asks. See `hasGameBeenAbandoned`.
 */
export type PendingGame = {
  key: string;
  week: number;
  /** ISO kickoff, or null when the game was never planned to a determined time. */
  kickoff: string | null;
};

/**
 * Was this pending game planned for a kickoff far enough in the past that
 * nothing will ever resolve it?
 *
 * The escape hatch for the genuine never-resolves case — `Liberty @ App State`
 * (week 5 2024, Hurricane Helene) still returns `completed: false` from CFBD
 * nearly two years on. Evaluated at request time, never cached.
 */
export function hasGameBeenAbandoned(pending: PendingGame, now: Date): boolean {
  if (!pending.kickoff) return false;
  const kickoff = Date.parse(pending.kickoff);
  if (!Number.isFinite(kickoff)) return false;
  return now.getTime() - kickoff > GAME_MAX_DURATION_MS;
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

  // NO population filter. The first round required BOTH participants in the
  // FBS catalogue, and `/code-review` showed that filter is net-harmful: the
  // non-FBS noise it was written for — Alderson-Broaddus, the NESCAC fixtures —
  // never enters `games` at all, because `isTrackedGame` excludes both-non-FBS
  // games upstream. Its only LIVE effect was dropping FBS-vs-FCS games, which
  // `buildScheduleFromApi` deliberately keeps and which move the standings. A
  // week could then read as played on Sunday while an owned team's Labor Day
  // game against an FCS opponent was still to come, and Monday's result would
  // silently rewrite a week already treated as settled.
  //
  // `games` is already the tracked, canonical set. That IS the owner's "all
  // canonical FBS games" population; the extra filter only narrowed it wrongly.
  const cumulativeGames: AppGame[] = [];
  for (const week of weeks) {
    const weekGames = gamesByWeek.get(week) ?? [];
    cumulativeGames.push(...weekGames);

    const snapshot = deriveStandings(cumulativeGames, rosterByTeam, scoresByKey);
    const standings = toHistoryStandingsRows(snapshot.rows);
    const coverage = deriveStandingsCoverage(cumulativeGames, rosterByTeam, scoresByKey);

    // PLAYED is judged over THIS week's games, not the cumulative list — the
    // question is whether this week happened, and every earlier week already
    // has. A week with no relevant games is not played: it cannot be, and
    // counting it as played is how an empty future week closed a season.
    // REAL games only — both teams known. A bracket shell is not a game to wait
    // on; it becomes one when the bracket resolves. Earlier rounds excluded
    // shells by `isPlaceholder`, which then made an ALL-shell week unable to
    // ever resolve, and the week-level answer was gating whether the SEASON had
    // ended. Season-over is now a question about games (`selectSeasonContext`),
    // so an all-shell week simply contributes nothing.
    const realGames = weekGames.filter(isRealGame);
    const pending: PendingGame[] = realGames
      .filter((game) => {
        const score = scoresByKey[game.key];
        if (isConcludedByEvidence(game, score)) return false;
        // A disrupted game is still coming, so it is pending with NO kickoff to
        // measure against — its cached one is the kickoff it no longer has.
        if (isDisruptedGame(game, score)) return true;
        return true;
      })
      .map((game) => ({
        key: game.key,
        week: game.week,
        // Null unless the game was PLANNED to a determined moment, and null for
        // a disrupted game whose cached kickoff has been superseded.
        kickoff:
          isPlannedGame(game) && !isDisruptedGame(game, scoresByKey[game.key]) ? game.date : null,
      }));

    byWeek[week] = {
      week,
      standings,
      coverage,
      // Time-invariant: evidence only. The abandonment allowance is applied by
      // consumers, from `pending`.
      played: realGames.length > 0 && pending.length === 0,
      pending,
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

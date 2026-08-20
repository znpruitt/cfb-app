import type { ScorePack } from './scores.ts';
import type { AppGame } from './schedule.ts';
import {
  classifyScorePackStatus,
  isCanceledStatusLabel,
  isDisruptedStatusLabel,
} from './gameStatus.ts';
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
  /**
   * Games this derivation concluded from ELAPSED TIME alone — no result, no
   * completion flag, no terminal status, just a kickoff long past. Observation
   * only: it never changes what the predicate decided.
   *
   * Optional because durable archives predate it. Empty and absent mean the same
   * thing, which is the safe direction for a diagnostic.
   */
  inferredConclusions?: InferredConclusion[];
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
 *
 * This is the LAST resort, not the primary signal — see `isGameConcluded`.
 */
const GAME_MAX_DURATION_MS = 8 * 60 * 60 * 1000;

/**
 * Has this game reached a state it will never leave?
 *
 * The evidence is consulted in order of authority, and the first round of this
 * slice consulted almost none of it. It tested `game.status === 'final'`, which
 * BOTH REVIEWERS found is unreachable for production schedule data: CFBD's
 * `/games` carries no status string, `cfbdSchedule` defaults it to `scheduled`,
 * and `mapStatus` therefore never yields `final`. Every week was decided purely
 * by the wall clock — a Saturday's games could all be final and cached by
 * 11:30pm and the week would stay unplayed until 4am, while a week whose games
 * merely kicked off eight hours ago counted as played with no scores at all.
 *
 * The authoritative signals were already in hand. `scoresByKey` is a parameter
 * of `deriveStandingsHistory`; `AppGame.completed` is populated from CFBD's own
 * flag; `rawStatus` carries the provider label.
 *
 * ORDER MATTERS. A postponed game must be tested before elapsed time, or a
 * fixture rescheduled for November is declared concluded eight hours after the
 * kickoff it no longer has.
 */
export function isGameConcluded(game: AppGame, score: ScorePack | undefined, now: Date): boolean {
  // 1. We have the result. Nothing outranks that.
  if (classifyScorePackStatus(score) === 'final') return true;

  // 2. The provider says so. This is CFBD's only completion signal on /games.
  if (game.completed === true) return true;

  // 3. The wire status says so, when a provider ever supplies one.
  if (game.status === 'final') return true;

  // 4. Cancelled is TERMINAL — it will never produce a final score. The repo
  //    already draws this line, and draws it narrowly on purpose.
  //
  //    BOTH labels are consulted, because the schedule's is always inert: every
  //    one of the 22,691 cached schedule items carries `status: 'scheduled'`, so
  //    `game.rawStatus` never says anything. The signal lives on the SCORE —
  //    `toStatus` preserves an unrecognized provider label verbatim, so a
  //    postponed game arrives as `ScorePack.status === 'Postponed'`. The first
  //    version of this guard asked only the schedule, which is why review found
  //    it unreachable: the check was on the wrong object.
  if (isCanceledStatusLabel(game.rawStatus) || isCanceledStatusLabel(score?.status)) return true;

  // 5. Postponed / suspended / delayed are disrupted but NOT terminal: the game
  //    is still coming, and its cached kickoff is the one it no longer has.
  //    Falling through to the elapsed clause would close its week tomorrow.
  if (isDisruptedStatusLabel(game.rawStatus) || isDisruptedStatusLabel(score?.status)) {
    return false;
  }

  // 5b. A placeholder kickoff is not a kickoff. `startTimeTBD` marks a timestamp
  //     the app refuses to trust elsewhere — `gameCardPresentation` renders those
  //     games date-only — so measuring elapsed time against it could conclude a
  //     game BEFORE it is played.
  if (game.startTimeTBD === true) return false;

  // 6. Last resort. A game whose kickoff is long past, with no result and no
  //    completion flag, is one nothing will ever resolve — CFBD cannot tell us a
  //    game was cancelled, so this inference is ours to make. `Liberty @ App
  //    State` (week 5 2024, Hurricane Helene) still returns `completed: false`.
  if (!game.date) return false;
  const kickoff = Date.parse(game.date);
  if (!Number.isFinite(kickoff)) return false;
  return now.getTime() - kickoff > GAME_MAX_DURATION_MS;
}

/**
 * A game concluded by ELAPSED TIME rather than by any positive evidence — the
 * step 6 fallback above. Reported rather than silently absorbed: one is a
 * hurricane, twenty is a broken feed, and the difference has to be visible.
 */
export type InferredConclusion = {
  key: string;
  week: number;
  date: string | null;
  status: AppGame['status'];
};

/** Did this game conclude only because its kickoff is long past? */
function isInferredConclusion(game: AppGame, score: ScorePack | undefined, now: Date): boolean {
  if (classifyScorePackStatus(score) === 'final') return false;
  if (game.completed === true) return false;
  if (game.status === 'final') return false;
  if (isCanceledStatusLabel(game.rawStatus) || isCanceledStatusLabel(score?.status)) return false;
  return isGameConcluded(game, score, now);
}

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
}): StandingsHistory {
  const { games, scoresByKey, coverageOptions } = args;
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
  const inferredConclusions: InferredConclusion[] = [];
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
    // PLACEHOLDER rows are excluded. A postseason bracket shell carries
    // `startDate: null` and can never be final, so under "every game must
    // conclude" ONE of them pins its week to `played: false` forever — the live
    // season could then never reach `final`, suppressing the champion, recap and
    // cluster cards from the last whistle until rollover writes an archive. That
    // is the same failure `buildSeasonArchive` guards against, which review
    // rightly pointed out I had fixed on one path only.
    const realGames = weekGames.filter((game) => !game.isPlaceholder);
    for (const game of realGames) {
      if (isInferredConclusion(game, scoresByKey[game.key], now)) {
        inferredConclusions.push({
          key: game.key,
          week: game.week,
          date: game.date,
          status: game.status,
        });
      }
    }
    byWeek[week] = {
      week,
      standings,
      coverage,
      played:
        realGames.length > 0 &&
        realGames.every((game) => isGameConcluded(game, scoresByKey[game.key], now)),
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
    inferredConclusions,
  };
}

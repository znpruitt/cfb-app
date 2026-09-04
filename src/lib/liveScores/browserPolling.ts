import {
  classifyScorePackStatus,
  classifyStatusLabel,
  isCanceledOrPostponedStatusLabel,
} from '@/lib/gameStatus';
import type { AppGame } from '@/lib/schedule';
import type { ScorePack } from '@/lib/scores';
import { seasonYearForToday } from '@/lib/scores/normalizers';

/**
 * PLATFORM-086B2B — client-safe eligibility for BROWSER live-score polling.
 *
 * Pure and dependency-light (no server imports) so `useLiveRefresh` can re-evaluate
 * it on every browser heartbeat and on focus/visibility changes. It mirrors the B1
 * cron's schedule-armed `[kickoff − 15 min, kickoff + 24 h]` window and its
 * disruption rules, but decides only whether a VISIBLE tab should issue a
 * cache-only score read — never a provider call. Browser reads are provider-free,
 * but still invoke the dynamic route and durable score reconciliation. The server
 * cron remains the authoritative, quota-spending eligibility (it also has
 * pending-confirmation metadata).
 */

/** Browser live-score cadence when the eligible window has no game in progress. */
export const LIVE_SCORE_POLL_INTERVAL_MS = 3 * 60 * 1000;
/** Browser live-score cadence while at least one eligible game is in progress. */
export const LIVE_SCORE_IN_PROGRESS_POLL_INTERVAL_MS = 90 * 1000;
/** Inclusive window: 15 minutes before kickoff through 24 hours after (== B1). */
export const LIVE_SCORE_WINDOW_BEFORE_MS = 15 * 60 * 1000;
export const LIVE_SCORE_WINDOW_AFTER_MS = 24 * 60 * 60 * 1000;

/** The canonical current season — browser auto-polling never arms a past season. */
export function isCurrentLiveScoreSeason(season: number, now: Date = new Date()): boolean {
  return season === seasonYearForToday(now);
}

/** Provider partition of a game: `(providerWeek, seasonType)` — postseason uses providerWeek. */
export type LiveScorePartition = { providerWeek: number; seasonType: 'regular' | 'postseason' };

function partitionOf(game: AppGame): LiveScorePartition {
  // Conference championships are CFBD `seasonType: 'regular'` (week ~15), so the
  // canonical slate + the live cron write their scores to the REGULAR partition
  // (see gameStats/canonicalSlate). The exact-partition read must target that
  // same partition, hence the explicit conference-championship → regular case;
  // only true postseason (bowls/playoff) reads the postseason partition.
  const seasonType: 'regular' | 'postseason' =
    game.stage === 'regular' || game.postseasonRole === 'conference_championship'
      ? 'regular'
      : 'postseason';
  return { providerWeek: game.providerWeek ?? game.week, seasonType };
}

/**
 * Whether one game is eligible for a browser cache-only score poll at `now`:
 * schedule-owned (a parseable kickoff), inside the inclusive `[−15 min, +24 h]`
 * window, and not canceled/postponed. Delayed/suspended games stay eligible.
 *
 * A cached FINAL does NOT end eligibility. The cron publishes a scoreboard
 * `completed` row as `final` BEFORE its later `/games` reconciliation, which can
 * correct the score (and invalidate standings). The browser cannot cheaply tell a
 * provisional final from a `/games`-confirmed one (the client response carries no
 * pending-confirmation set), so it keeps polling in-window finals cache-only at
 * the three-minute cadence. That bounded read is provider-free, not cost-free: it
 * still invokes the scores route and durable reconciliation. A truly resolved
 * final simply ages out of the window. Canceled/postponed are TERMINAL (never
 * corrected) and DO end eligibility. The provider schedule status is preserved
 * on `AppGame.rawStatus`, so a game with no score row can still be excluded.
 */
export function isLiveScoreEligibleGame(
  game: AppGame,
  score: ScorePack | undefined,
  now: Date
): boolean {
  if (!game.date) return false;
  const kickoffMs = Date.parse(game.date);
  if (!Number.isFinite(kickoffMs)) return false;
  const age = now.getTime() - kickoffMs;
  if (!Number.isFinite(age)) return false;
  if (age < -LIVE_SCORE_WINDOW_BEFORE_MS || age > LIVE_SCORE_WINDOW_AFTER_MS) return false;

  if (isCanceledOrPostponedStatusLabel(game.rawStatus)) return false;

  // Canceled/postponed are terminal → end eligibility; delayed/suspended (also
  // `disrupted`) and finals (still correctable until the window closes) do not.
  if (
    score &&
    classifyScorePackStatus(score) === 'disrupted' &&
    isCanceledOrPostponedStatusLabel(score.status)
  ) {
    return false;
  }
  return true;
}

/**
 * The eligible games for a browser live-score poll — empty (no poll) unless the
 * viewed season is the canonical current one.
 */
export function selectLiveScorePollGames(params: {
  games: AppGame[];
  scoresByKey: Record<string, ScorePack>;
  season: number;
  now?: Date;
}): AppGame[] {
  const { games, scoresByKey, season, now = new Date() } = params;
  if (!isCurrentLiveScoreSeason(season, now)) return [];
  return games.filter((game) => isLiveScoreEligibleGame(game, scoresByKey[game.key], now));
}

/**
 * Whether at least one already-eligible game has reached kickoff and is not final.
 *
 * Kickoff time is deliberately sufficient to enter the fast tier: the first cron
 * write may not have produced a score pack yet, and waiting for one would delay
 * the 90-second cadence at the moment it matters. Once a score pack exists its
 * status is the freshest finality signal; before then, the schedule's retained
 * `completed` flag, mapped status, and raw status prevent an already-final game
 * from being treated as live.
 */
export function hasInProgressLiveScoreGame(params: {
  eligibleGames: AppGame[];
  scoresByKey: Record<string, ScorePack>;
  now?: Date;
}): boolean {
  const { eligibleGames, scoresByKey, now = new Date() } = params;
  const nowMs = now.getTime();

  return eligibleGames.some((game) => {
    if (!game.date) return false;
    const kickoffMs = Date.parse(game.date);
    if (!Number.isFinite(kickoffMs) || kickoffMs > nowMs) return false;

    const score = scoresByKey[game.key];
    const isFinal = score
      ? classifyScorePackStatus(score) === 'final'
      : game.completed === true ||
        game.status === 'final' ||
        classifyStatusLabel(game.rawStatus) === 'final';
    return !isFinal;
  });
}

/** Deduped `(providerWeek, seasonType)` partitions for the exact-partition read. */
export function deriveLiveScorePartitions(games: AppGame[]): LiveScorePartition[] {
  const byKey = new Map<string, LiveScorePartition>();
  for (const game of games) {
    const partition = partitionOf(game);
    byKey.set(`${partition.providerWeek}:${partition.seasonType}`, partition);
  }
  return [...byKey.values()];
}

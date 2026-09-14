import { hasUsableFinalScore } from '../gameStatus';
import { gameStateFromScore } from '../gameUi';
import { POLLING_WINDOW_AFTER_KICKOFF_MS } from '../liveScores/pollingTarget';
import type { AppGame } from '../schedule';
import type { ScorePack } from '../scores';
import { isDisruptedGame, isPlannedGame } from '../standingsHistory';

export type GameScoreboardState = 'scheduled' | 'live' | 'awaiting' | 'unavailable' | 'final';

/** Planning-owned fifth-state copy; one seam keeps a later owner override one line. */
export const NO_SCORE_REPORTED_LABEL = 'No score reported' as const;

export function isScorePollingWindowExpired(
  kickoff: string | null | undefined,
  nowMs: number
): boolean {
  const kickoffMs = kickoff ? Date.parse(kickoff) : Number.NaN;
  return (
    Number.isFinite(kickoffMs) &&
    Number.isFinite(nowMs) &&
    nowMs - kickoffMs > POLLING_WINDOW_AFTER_KICKOFF_MS
  );
}

/**
 * Positive eligibility for post-kickoff score-reporting states. A game may
 * enter awaiting, and later earn the terminal no-score claim, only when both
 * participants are real, the schedule explicitly confirms its kickoff time,
 * and neither schedule nor score evidence says play was disrupted. In
 * particular, the optional `startTimeTBD` field fails closed: only `false`
 * confirms the provider's timestamp.
 *
 * Score-pack finality is deliberately absent from this gate. A partial final
 * still describes a real game that should have produced a complete score; it
 * awaits completion through the polling window and becomes unavailable after.
 */
export function isScoreReportExpectedGame(game: AppGame, score: ScorePack | undefined): boolean {
  if (game.startTimeTBD !== false) return false;
  if (game.status === 'placeholder' || game.isPlaceholder || !isPlannedGame(game)) return false;
  if (!Number.isFinite(Date.parse(game.date ?? ''))) return false;
  return !isDisruptedGame(game, score);
}

/**
 * Project only the state a scoreboard row can truthfully render. Ownership and
 * section placement remain decisions owned by their existing selectors.
 *
 * Two intentionally different clocks sit around this projection. The eight-hour
 * `GAME_MAX_DURATION_MS` abandonment gate is a fact about football: a game cannot
 * still be live that long after kickoff. This 24-hour polling bound is a fact about
 * our score system: through the boundary a late result may still attach (as
 * PLATFORM-105A measured), but after it the pipeline has stopped trying. Do not
 * converge those constants; the interval between them is real and meaningful.
 */
export function projectGameScoreboardState(params: {
  game: AppGame;
  score?: ScorePack;
  nowMs: number;
}): GameScoreboardState {
  const { game, score, nowMs } = params;
  const scoreState = gameStateFromScore(score);

  if (hasUsableFinalScore(score)) return 'final';
  if (scoreState === 'inprogress') return 'live';

  // Scheduled/awaiting/unavailable are schedule-derived claims. Do not let a
  // missing optional flag, a placeholder, or a disrupted game fall into a new
  // state merely because it was not caught by another branch.
  if (!isScoreReportExpectedGame(game, score) || !Number.isFinite(nowMs)) {
    return 'scheduled';
  }
  const kickoffMs = Date.parse(game.date ?? '');
  if (kickoffMs > nowMs) return 'scheduled';
  if (isScorePollingWindowExpired(game.date, nowMs)) return 'unavailable';
  return 'awaiting';
}

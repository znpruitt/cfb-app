import { hasUsableFinalScore } from '../gameStatus';
import { gameStateFromScore } from '../gameUi';
import { POLLING_WINDOW_AFTER_KICKOFF_MS } from '../liveScores/pollingTarget';
import type { ScorePack } from '../scores';

export type GameScoreboardState = 'scheduled' | 'live' | 'awaiting' | 'unavailable' | 'final';

/** Planning-owned fifth-state copy; one seam keeps a later owner override one line. */
export const NO_SCORE_REPORTED_LABEL = 'No score reported.' as const;

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
export function projectGameScoreboardState(
  score: ScorePack | undefined,
  kickoff: string | null | undefined,
  nowMs: number
): GameScoreboardState {
  const scoreState = gameStateFromScore(score);
  const kickoffMs = kickoff ? Date.parse(kickoff) : Number.NaN;

  if (hasUsableFinalScore(score)) return 'final';
  if (scoreState === 'inprogress') return 'live';
  if (!Number.isFinite(kickoffMs) || !Number.isFinite(nowMs) || kickoffMs > nowMs) {
    return 'scheduled';
  }
  if (isScorePollingWindowExpired(kickoff, nowMs)) return 'unavailable';
  return 'awaiting';
}

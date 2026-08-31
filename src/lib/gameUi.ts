import { classifyScorePackStatus } from './gameStatus.ts';
import type { AppGame } from './schedule.ts';
import type { ScorePack } from './scores.ts';

export function usesNeutralSiteSemantics(
  game: Pick<AppGame, 'neutral' | 'neutralDisplay' | 'stage'>
): boolean {
  return game.neutralDisplay === 'vs' || (game.stage !== 'regular' && game.neutral);
}

export function formatGameMatchupLabel(
  game: Pick<AppGame, 'csvAway' | 'csvHome' | 'neutral' | 'neutralDisplay' | 'stage'>,
  options?: { homeAwaySeparator?: string }
): string {
  if (usesNeutralSiteSemantics(game) || game.neutral) {
    return `${game.csvAway} vs ${game.csvHome}`;
  }

  return `${game.csvAway} ${options?.homeAwaySeparator ?? 'at'} ${game.csvHome}`;
}

/**
 * Is this game happening RIGHT NOW?
 *
 * The ATTACHED SCORE decides, and nothing else. `game.status` used to be ORed in
 * on the premise that "the schedule is authoritative when it says so" — that was
 * backwards. Schedule status is written by the weekly `schedule-refresh` cron and
 * never rewritten by the live-scores engine, which polls every three minutes, so
 * it can only ever be EQUAL TO or STALER THAN the score feed. It is never the
 * leading signal, and it cannot be: at kickoff the schedule row was written days
 * earlier saying `scheduled`.
 *
 * What it could do is lie. A schedule snapshot taken mid-slate leaves rows marked
 * `in_progress`; hours later those games are over and their scores say `final`,
 * but the OR short-circuited before ever consulting the score — so an owner card
 * rendered "Live" beside a final scoreboard until the next weekly refresh.
 *
 * Consequence worth stating: a game with NO attached score is not live here.
 * Absence of data is not evidence of play, and callers that then read
 * `scoresByKey[game.key]` are now guaranteed a score when this returns true.
 *
 * Scope: this annotates ONE ROW. It is not a basis for any page-wide "we are
 * live" claim — a single stale or missing row would light the whole surface, and
 * answering that question needs evidence that provider data actually refreshed,
 * which the client does not currently receive. See `docs/next-tasks.md` 57.
 */
export function isLiveGame(score?: ScorePack): boolean {
  return gameStateFromScore(score) === 'inprogress';
}

export function gameStateFromScore(
  score?: ScorePack
): 'final' | 'inprogress' | 'scheduled' | 'unknown' {
  if (!score) return 'unknown';
  // Preserve the "no status information" signal: a score row with an empty /
  // whitespace status stays 'unknown' (not 'scheduled'), so callers that
  // distinguish a data-less score keep their behavior. A non-empty label routes
  // through the SINGLE central status classifier (`classifyScorePackStatus`),
  // so live labels this loose substring matcher used to miss — `Q3 8:14`, `OT`,
  // `In Progress` — are recognized as in-progress consistently with every other
  // status consumer (PLATFORM-086B1). Disrupted labels (postponed/canceled/
  // suspended/delayed) present as 'scheduled', matching the classifier's buckets.
  if (!(score.status ?? '').trim()) return 'unknown';
  const bucket = classifyScorePackStatus(score);
  if (bucket === 'final') return 'final';
  if (bucket === 'inprogress') return 'inprogress';
  return 'scheduled';
}

export type GameStatusLabelTone = 'live' | 'final' | 'scheduled' | 'unknown';

export type GameStatusLabelPresentation = {
  className: string;
  dotClassName: string | null;
};

export type GameStatusLabelOptions = {
  liveHue?: 'emerald' | 'neutral';
  liveDot?: 'static' | 'pulse' | 'none';
};

const STATUS_LABEL_TONE_CLASSES: Record<GameStatusLabelTone, string> = {
  live: 'dark:text-emerald-400',
  final: 'dark:text-zinc-300',
  scheduled: 'dark:text-sky-400',
  unknown: 'dark:text-zinc-400',
};

export function gameStatusLabelPresentation(
  tone: GameStatusLabelTone,
  options: GameStatusLabelOptions = {}
): GameStatusLabelPresentation {
  const { liveHue = 'emerald', liveDot = 'static' } = options;
  const toneClassName =
    tone === 'live' && liveHue === 'neutral'
      ? 'dark:text-zinc-300'
      : STATUS_LABEL_TONE_CLASSES[tone];
  const dotClassName =
    tone === 'live' && liveDot !== 'none'
      ? `size-1.5 rounded-full bg-current${liveDot === 'pulse' ? ' animate-pulse' : ''}`
      : null;

  return {
    className: `inline-flex w-fit shrink-0 items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${toneClassName}`,
    dotClassName,
  };
}

export function chipClass(): string {
  return 'text-[10px] uppercase tracking-wide border rounded px-1 py-0.5 bg-white text-gray-700 border-gray-300 dark:bg-zinc-800 dark:text-zinc-100 dark:border-zinc-600';
}

export function pillClass(): string {
  return 'text-xs border rounded px-1 py-0.5 bg-white text-gray-700 border-gray-300 dark:bg-zinc-800 dark:text-zinc-100 dark:border-zinc-600';
}

import { classifyScorePackStatus, normalizeStatusTokens } from './gameStatus.ts';
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

const LIVE_CLOCK_ISO_DATE_PREFIX_RE = /^\d{4}-\d{2}-\d{2}[t\s]\d{2}:\d{2}/i;
const LIVE_CLOCK_ISO_UTC_SUFFIX_RE = /z$/i;

export function formatLiveGameClock(score: ScorePack | null | undefined): string | null {
  if (!score) return null;

  const status = score.status.trim();
  const statusTokens = normalizeStatusTokens(status);
  const hasGenericLiveStatus =
    statusTokens === 'in progress' ||
    statusTokens === 'inprogress' ||
    statusTokens === 'status in progress' ||
    statusTokens === 'live' ||
    statusTokens === 'status live';

  const scoreTime = score.time?.trim() ?? '';
  const looksLikeKickoffTimestamp =
    scoreTime.length > 0 &&
    (LIVE_CLOCK_ISO_DATE_PREFIX_RE.test(scoreTime) ||
      LIVE_CLOCK_ISO_UTC_SUFFIX_RE.test(scoreTime)) &&
    Number.isFinite(Date.parse(scoreTime));
  const clock = looksLikeKickoffTimestamp ? '' : scoreTime;

  if (hasGenericLiveStatus) return clock || null;
  if (!status) return clock || null;
  if (!clock || status.toLocaleLowerCase().includes(clock.toLocaleLowerCase())) return status;
  return `${status} ${clock}`;
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
      ? `size-1.5 rounded-full bg-current${liveDot === 'pulse' ? ' motion-safe:animate-pulse' : ''}`
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

/**
 * The eyebrow-tag treatment — ONE definition, consumed by Overview, Schedule and
 * Matchups (PLATFORM-153). Do not inline a bronze literal at a call site: three
 * near-identical string literals is exactly how Schedule and Matchups drifted
 * apart, and how Overview kept a non-compliant blue after both were corrected.
 *
 * Bronze, not blue. `DESIGN.md` → *Color*: "Blue signals interactivity or active
 * state only — never use blue to mean 'featured' or 'important'." An eyebrow tag
 * is precisely a featured/important signal, so blue here was non-compliant rather
 * than merely a weaker choice.
 *
 * Border `rgba(201,166,107,0.40)` at 0.5px and text `#dbc190` are the settled
 * values (`mockups/matchups-schedule-mockup.html`, `mockups/weekly-recap-mockup.html`).
 * Each shipped surface previously had exactly one of the two right: Schedule ran a
 * 1px border with 10px text, Matchups a 0.5px border with 12px text.
 *
 * `rounded-full`, `px-1.5 py-0.5` and `tracking-wide` are held as shipped and
 * DELIBERATELY diverge from the mockup's `3px` radius, `1px 5px` padding and
 * `0.08em` tracking. `AGENTS.md` rules the mockup NON-AUTHORITATIVE on those
 * three: they were set incrementally while it was built and were never derived.
 * Item 143 picks them against a real slate. Border width and colour are the
 * mockup's and are settled here; radius, padding and tracking are not its call.
 *
 * `shrink-0` is part of the treatment, not layout — the mockup gives every tag
 * `flex: none` so a label can never compress or wrap inside its own pill. Only
 * DISPLAY is the caller's, because Matchups hides its secondary tags below the
 * `sm` breakpoint and a baked-in `inline-flex` would fight that.
 */
export const EYEBROW_TAG_CLASSES =
  'shrink-0 rounded-full border-[0.5px] border-[rgba(201,166,107,0.40)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#dbc190]';

/**
 * Plain bronze text, no pill — `#c9a66b`, 8.63:1 on the dark composition against
 * the pill's brighter `#dbc190` at 11.35:1.
 *
 * **NO PRODUCTION CONSUMER, retained for Item 113.** Its only consumer was
 * Overview's watchlist reason label, which Item 175 converted to the shared pill:
 * that label sits INLINE BESIDE A TAG, so it is functioning as a tag and takes the
 * one treatment. What this token is reserved for is the FEATURED TILE's reason row
 * — a card title on its own line, where a border would read as chrome on a tile
 * that already has some — which is Item 113's unbuilt work and is the only
 * plain-text bronze the design calls for (`mockups/live-scoreboard-mockup.html`
 * → `.fx-reason-row`). Named here rather than deleted per `AGENTS.md` →
 * *Documentation closeout timing*, alongside `teamColors.ts`/Item 119.
 */
export const EYEBROW_REASON_CLASSES =
  'text-[10px] font-semibold uppercase tracking-wide text-[#c9a66b]';

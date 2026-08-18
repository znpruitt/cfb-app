import { classifyScorePackStatus, normalizeStatusTokens } from '@/lib/gameStatus';
import type { AppGame } from '@/lib/schedule';
import type { ScorePack } from '@/lib/scores';
import { seasonYearForToday } from '@/lib/scores/normalizers';

/**
 * PLATFORM-086B2B — client-safe eligibility for BROWSER live-score polling.
 *
 * Pure and dependency-light (no server imports) so `useLiveRefresh` can re-evaluate
 * it on every 3-minute tick and on focus/visibility changes. It mirrors the B1
 * cron's schedule-armed `[kickoff − 15 min, kickoff + 24 h]` window and its
 * disruption rules, but decides only whether a VISIBLE tab should issue a
 * cache-only score read — never a provider call. The server cron remains the
 * authoritative, quota-spending eligibility (it has the raw provider status and
 * pending-confirmation metadata the browser lacks); a slightly looser browser
 * decision only costs a free cache read.
 */

/** Browser live-score poll cadence: every 3 minutes while a tab is visible. */
export const LIVE_SCORE_POLL_INTERVAL_MS = 3 * 60 * 1000;
/** Inclusive window: 15 minutes before kickoff through 24 hours after (== B1). */
export const LIVE_SCORE_WINDOW_BEFORE_MS = 15 * 60 * 1000;
export const LIVE_SCORE_WINDOW_AFTER_MS = 24 * 60 * 60 * 1000;

const CANCELED_OR_POSTPONED_RE = /\b(?:canceled|cancelled|postponed)\b/;

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
 * pending-confirmation set), so it keeps polling in-window finals cache-only — the
 * only cost is a free cache read, bounded by the `+24 h` window — so a
 * reconciliation correction still reaches an open page. A truly resolved final
 * simply ages out of the window. Canceled/postponed are TERMINAL (never corrected)
 * and DO end eligibility; disruption is read from the cached score's status (the
 * only disrupted signal the browser has — `AppGame.status` collapses it). A game
 * with no cached score is judged solely by its window.
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

  // Canceled/postponed are terminal → end eligibility; delayed/suspended (also
  // `disrupted`) and finals (still correctable until the window closes) do not.
  if (
    score &&
    classifyScorePackStatus(score) === 'disrupted' &&
    CANCELED_OR_POSTPONED_RE.test(normalizeStatusTokens(score.status))
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
 * What the league surface tells a member about live coverage.
 *
 * Owner design, 2026-08-18. This is deliberately derived from the POLLER'S OWN
 * ARMING RULE rather than from game status: `selectLiveScorePollGames` is the
 * set the app is actually refreshing, so the claim is grounded in work being
 * done rather than inferred from a field.
 *
 * That also removes the defect both reviewers found in the first attempt. The
 * previous predicate read `game.status`, which is written by the schedule-refresh
 * cron and never rewritten by the live-scores engine — so a schedule snapshotted
 * mid-slate left rows marked `in_progress` and lit a "Live" badge for hours over
 * a week of finals. Schedule status is not consulted here at all, so there is
 * nothing to go stale.
 *
 *  - `null`      nothing armed, or every armed game is final. No badge.
 *  - `preparing` armed, kickoff still ahead. Polling starts 15 minutes early, so
 *                the app IS working and has nothing to report yet.
 *  - `tracking`  at least one armed, non-final game has kicked off.
 *
 * The two states are clock-driven, so both self-expire: the arming window closes
 * on its own, and `preparing` becomes `tracking` at kickoff without any data
 * arriving. Callers must pass a ticking `now` (AGENTS.md: time-dependent
 * classification belongs in the consumer, never inside a cached selector).
 */
export type LiveTrackingState = 'preparing' | 'tracking';

export function deriveLiveTrackingState(params: {
  games: AppGame[];
  scoresByKey: Record<string, ScorePack>;
  season: number;
  now?: Date;
}): LiveTrackingState | null {
  const { games, scoresByKey, season, now = new Date() } = params;
  const armed = selectLiveScorePollGames({ games, scoresByKey, season, now });

  // A final score ends coverage for that game even though the poll window stays
  // open for corrections — otherwise the badge would run the full 24 hours after
  // a Saturday slate.
  const outstanding = armed.filter(
    (game) => classifyScorePackStatus(scoresByKey[game.key]) !== 'final'
  );
  if (outstanding.length === 0) return null;

  const nowMs = now.getTime();
  const kickedOff = outstanding.some((game) => {
    if (!game.date) return false;
    const kickoffMs = Date.parse(game.date);
    return Number.isFinite(kickoffMs) && kickoffMs <= nowMs;
  });
  return kickedOff ? 'tracking' : 'preparing';
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

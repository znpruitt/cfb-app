/**
 * PLATFORM-086C1 — pure, deterministic Odds polling target + cadence policy
 * (DORMANT: built and tested for the FUTURE PLATFORM-086C2 cron, wired to NO
 * runtime route or scheduler in C1).
 *
 * A canonical Odds target is eligible when at least one canonical game belongs to
 * the current season, has BOTH participants resolved through canonical identity,
 * has a parseable FUTURE kickoff, is not disrupted (canceled/postponed/suspended/
 * delayed) under the shared status classifier, and kicks off within the seven-day
 * expected-Odds horizon. No eligible game ⇒ `skipped / no-eligible-target`.
 *
 * Cadence (QStash will eventually invoke the C2 route hourly; this pure policy
 * decides whether a provider request is actually DUE):
 *   - Baseline: due when the freshest completed signal is >= 6 hours old.
 *   - Pregame priority: group eligible games by America/Chicago calendar date,
 *     take each date's EARLIEST kickoff (over resolved, non-disrupted games —
 *     including already-started ones, so a date's FIRST kickoff, not a later game,
 *     defines the window and acceleration ends once it passes and never reignites
 *     that day). During the 6 hours before that earliest kickoff, due when the
 *     freshest completed signal is >= 2 hours old. Pregame priority WINS the
 *     cadence label when active; a baseline-due decision remains valid inside the
 *     window (6h >= 2h).
 *   - `automaticNotBefore` (durable backoff) overrides both cadence modes.
 *
 * The freshest completed signal is `max(canonical raw entry effective observation,
 * lastCompletedCheckAt)`, so a valid empty no-op (which advances
 * `lastCompletedCheckAt`) suppresses an immediate repeat, and a provider failure
 * (which only sets backoff, never a data snapshot) never fabricates freshness.
 */

import { isDisruptedStatusLabel } from '../gameStatus.ts';
import type { OddsRefreshControl } from './refreshLease.ts';

/** Kickoffs within this window are expected to have posted odds (7 days). */
export const ODDS_EXPECTED_KICKOFF_HORIZON_MS = 7 * 24 * 60 * 60 * 1000;
/** Baseline cadence: a completed check older than this is due. */
export const ODDS_BASELINE_CADENCE_MS = 6 * 60 * 60 * 1000;
/** Pregame cadence inside the priority window. */
export const ODDS_PREGAME_CADENCE_MS = 2 * 60 * 60 * 1000;
/** The pregame priority window: the 6 hours before a slate's first kickoff. */
export const ODDS_PREGAME_WINDOW_MS = 6 * 60 * 60 * 1000;

/**
 * The minimal per-game signal the cadence needs. `rawStatus` is the RAW schedule
 * status (the built `AppGame.status` enum collapses disruption labels, so the
 * cache-only context carries the schedule row's raw status here for the shared
 * disruption classifier).
 */
export type OddsCanonicalGame = {
  key: string;
  homeResolved: boolean;
  awayResolved: boolean;
  kickoff: string | null;
  rawStatus: string | null;
};

export type EligibleOddsGame = { game: OddsCanonicalGame; kickoffMs: number };

export type OddsPollingDecision =
  | { due: false; reason: 'no-eligible-target' | 'refresh-not-due' | 'automatic-backoff' }
  | { due: true; cadence: 'baseline' | 'pregame' };

// America/Chicago calendar-date key (`YYYY-MM-DD`); the timeZone option handles
// CST/CDT so a Saturday slate groups correctly across DST boundaries.
const CENTRAL_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Chicago',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function centralDateKey(ms: number): string {
  return CENTRAL_DATE_FORMATTER.format(new Date(ms));
}

function isResolvedNonDisrupted(game: OddsCanonicalGame): boolean {
  return game.homeResolved && game.awayResolved && !isDisruptedStatusLabel(game.rawStatus);
}

/**
 * The eligible Odds games: resolved, non-disrupted, with a parseable FUTURE
 * kickoff inside the seven-day horizon. A missing/unparseable kickoff can never
 * prove eligibility, so it is excluded (fail-safe for quota).
 */
export function collectEligibleOddsGames(
  games: readonly OddsCanonicalGame[],
  now: number
): EligibleOddsGame[] {
  const out: EligibleOddsGame[] = [];
  for (const game of games) {
    if (!isResolvedNonDisrupted(game)) continue;
    const kickoffMs = game.kickoff === null ? Number.NaN : Date.parse(game.kickoff);
    if (!Number.isFinite(kickoffMs)) continue;
    if (kickoffMs <= now) continue;
    if (kickoffMs - now > ODDS_EXPECTED_KICKOFF_HORIZON_MS) continue;
    out.push({ game, kickoffMs });
  }
  return out;
}

/**
 * Whether the pregame priority window is active: some America/Chicago date's
 * earliest kickoff (over resolved, non-disrupted, parseable games — including
 * already-started ones) is still future AND within 6 hours ahead. Because the
 * window keys on a date's FIRST kickoff, it closes once that kickoff passes and
 * never reignites merely because later games remain — a full Saturday slate is
 * never accelerated all day.
 */
export function isPregameWindowActive(games: readonly OddsCanonicalGame[], now: number): boolean {
  const earliestByDate = new Map<string, number>();
  for (const game of games) {
    if (!isResolvedNonDisrupted(game)) continue;
    const kickoffMs = game.kickoff === null ? Number.NaN : Date.parse(game.kickoff);
    if (!Number.isFinite(kickoffMs)) continue;
    const date = centralDateKey(kickoffMs);
    const prior = earliestByDate.get(date);
    if (prior === undefined || kickoffMs < prior) earliestByDate.set(date, kickoffMs);
  }
  for (const kickoffMs of earliestByDate.values()) {
    if (kickoffMs > now && kickoffMs - now <= ODDS_PREGAME_WINDOW_MS) return true;
  }
  return false;
}

/**
 * The elapsed time since the freshest completed signal (`max` of the canonical
 * raw entry's effective observation and `lastCompletedCheckAt`). A cold target
 * with no signal is infinitely old (always due).
 */
function elapsedSinceFreshestSignal(
  control: OddsRefreshControl,
  rawObservationMs: number | null,
  now: number
): number {
  const signals: number[] = [];
  if (rawObservationMs !== null && Number.isFinite(rawObservationMs))
    signals.push(rawObservationMs);
  if (control.lastCompletedCheckAt) {
    const ms = Date.parse(control.lastCompletedCheckAt);
    if (Number.isFinite(ms)) signals.push(ms);
  }
  if (signals.length === 0) return Number.POSITIVE_INFINITY;
  return now - Math.max(...signals);
}

/**
 * Decide whether a provider request is due for the canonical Odds target. Pure
 * and deterministic (`now` injected). No eligible game ⇒ not due
 * (`no-eligible-target`); active durable backoff ⇒ not due (`automatic-backoff`);
 * otherwise the cadence threshold (2h inside the pregame window, else 6h) decides.
 */
export function selectOddsPollingDecision(params: {
  games: readonly OddsCanonicalGame[];
  control: OddsRefreshControl;
  rawObservationMs: number | null;
  now: number;
}): OddsPollingDecision {
  const { games, control, rawObservationMs, now } = params;

  if (collectEligibleOddsGames(games, now).length === 0) {
    return { due: false, reason: 'no-eligible-target' };
  }

  // Durable automatic backoff overrides both cadence modes.
  if (control.automaticNotBefore) {
    const notBeforeMs = Date.parse(control.automaticNotBefore);
    if (Number.isFinite(notBeforeMs) && now < notBeforeMs) {
      return { due: false, reason: 'automatic-backoff' };
    }
  }

  const age = elapsedSinceFreshestSignal(control, rawObservationMs, now);
  if (isPregameWindowActive(games, now)) {
    return age >= ODDS_PREGAME_CADENCE_MS
      ? { due: true, cadence: 'pregame' }
      : { due: false, reason: 'refresh-not-due' };
  }
  return age >= ODDS_BASELINE_CADENCE_MS
    ? { due: true, cadence: 'baseline' }
    : { due: false, reason: 'refresh-not-due' };
}

/**
 * PLATFORM-086C1 — pure, deterministic Odds polling target + cadence policy
 * (DORMANT: built and tested for the FUTURE PLATFORM-086C2 cron, wired to NO
 * runtime route or scheduler in C1).
 *
 * A canonical Odds target is eligible when at least one canonical game belongs to
 * the current season, has BOTH participants resolved through canonical identity,
 * has a parseable FUTURE kickoff, is not disrupted (canceled/postponed/suspended/
 * delayed) under the shared status classifier, and kicks off within the 45-day
 * polling horizon (PLATFORM-089; it was 7 days through C2). No eligible game ⇒
 * `skipped / no-eligible-target`.
 *
 * Cadence (QStash invokes the route hourly; this pure policy decides whether a
 * provider request is actually DUE — the scheduler's cadence is unchanged, and
 * most hourly deliveries remain provider-free skips):
 *   - Early: nearest kickoff > 7 days out ⇒ due when the freshest completed
 *     signal is >= 24 hours old. One request a day, so the widened horizon costs
 *     at most ~3 credits/day while lines are still weeks from moving.
 *   - Baseline: nearest kickoff <= 7 days out ⇒ due when that signal is >= 6
 *     hours old.
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

/**
 * The OUTER polling horizon (45 days). A canonical future game inside this window
 * makes the season a polling target at all.
 *
 * PLATFORM-089 — this used to be the 7-day window below, and production proved
 * that wrong on 2026-08-09: the canonical 2026 refresh had committed 125 rows on
 * Jul 29, so useful lines demonstrably existed, and then the snapshot aged until
 * System Health reported `odds-cache-stale` while every hourly invocation
 * returned `skipped / no-eligible-target · 0 eligible game(s)`. The policy was
 * knowingly leaving ALREADY-AVAILABLE served data to rot for weeks.
 *
 * NOT to be conflated with the identically-named constant in
 * `emptyOddsClassifier.ts`. That one answers a different question — whether an
 * EMPTY provider response is surprising — and 7 days remains right for it: no
 * book is expected to have posted lines for a game 40 days out, so an empty
 * response out here is a benign no-op, not a fault. Widening this horizon
 * deliberately does not widen that one.
 */
export const ODDS_EARLY_KICKOFF_HORIZON_MS = 45 * 24 * 60 * 60 * 1000;
/** Kickoffs within this window are expected to have posted odds (7 days). */
export const ODDS_EXPECTED_KICKOFF_HORIZON_MS = 7 * 24 * 60 * 60 * 1000;
/** Early cadence: outside the 7-day window, one check a day is enough. */
export const ODDS_EARLY_CADENCE_MS = 24 * 60 * 60 * 1000;
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
  | { due: true; cadence: 'early' | 'baseline' | 'pregame' };

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
 * Whether a kickoff is inside the outer polling horizon: strictly FUTURE and no
 * more than 45 days out. Exported as the single authority for that question —
 * the Odds diagnostic asks it of the raw schedule so health and the cron cannot
 * disagree about whether a target exists at all.
 */
export function isWithinEarlyOddsPollingHorizon(kickoffMs: number, now: number): boolean {
  if (!Number.isFinite(kickoffMs)) return false;
  if (kickoffMs <= now) return false;
  return kickoffMs - now <= ODDS_EARLY_KICKOFF_HORIZON_MS;
}

/**
 * The eligible Odds games: resolved, non-disrupted, with a parseable FUTURE
 * kickoff inside the 45-day polling horizon. A missing/unparseable kickoff can
 * never prove eligibility, so it is excluded (fail-safe for quota).
 *
 * Eligibility is only the question of whether a target EXISTS. How often that
 * target is checked is the cadence's job below, and it is what keeps the widened
 * horizon cheap: a game 40 days out makes the season pollable, at one request a
 * day, not at the six-hour pregame rate.
 */
export function collectEligibleOddsGames(
  games: readonly OddsCanonicalGame[],
  now: number
): EligibleOddsGame[] {
  const out: EligibleOddsGame[] = [];
  for (const game of games) {
    if (!isResolvedNonDisrupted(game)) continue;
    const kickoffMs = game.kickoff === null ? Number.NaN : Date.parse(game.kickoff);
    if (!isWithinEarlyOddsPollingHorizon(kickoffMs, now)) continue;
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
 * The freshest completed-check signal: `max` of the canonical raw entry's
 * effective observation and `lastCompletedCheckAt`, or `null` when neither
 * exists (a cold target).
 *
 * THE TWO SIGNALS ANSWER DIFFERENT QUESTIONS, which is the whole point of taking
 * the max. The raw observation says when data last CHANGED; `lastCompletedCheckAt`
 * says when the provider was last successfully ASKED — including a valid no-op,
 * where the answer was "nothing new". A provider failure sets neither (it only
 * arms backoff), so nothing here can fabricate freshness out of a failure.
 *
 * Exported because the Odds DIAGNOSTIC needs the same answer. It used to read the
 * raw `lastFetch` alone, so a run of correct no-ops — the provider genuinely
 * having nothing new — would age the snapshot into an `odds-cache-stale` warning
 * that no refresh could clear, and health would contradict a cron that was
 * working exactly as designed.
 */
export function freshestOddsSignalMs(
  control: Pick<OddsRefreshControl, 'lastCompletedCheckAt'> | null,
  rawObservationMs: number | null
): number | null {
  const signals: number[] = [];
  if (rawObservationMs !== null && Number.isFinite(rawObservationMs))
    signals.push(rawObservationMs);
  if (control?.lastCompletedCheckAt) {
    const ms = Date.parse(control.lastCompletedCheckAt);
    if (Number.isFinite(ms)) signals.push(ms);
  }
  return signals.length === 0 ? null : Math.max(...signals);
}

/**
 * The elapsed time since the freshest completed signal. A cold target with no
 * signal is infinitely old (always due).
 */
function elapsedSinceFreshestSignal(
  control: OddsRefreshControl,
  rawObservationMs: number | null,
  now: number
): number {
  const freshest = freshestOddsSignalMs(control, rawObservationMs);
  return freshest === null ? Number.POSITIVE_INFINITY : now - freshest;
}

/**
 * Decide whether a provider request is due for the canonical Odds target. Pure
 * and deterministic (`now` injected). No eligible game ⇒ not due
 * (`no-eligible-target`); active durable backoff ⇒ not due (`automatic-backoff`);
 * otherwise the STAGED cadence decides, keyed on the distance to the NEAREST
 * eligible kickoff:
 *
 *   pregame   2h   inside the 6h window before a Central date's first kickoff
 *   baseline  6h   nearest kickoff <= 7 days away
 *   early    24h   nearest kickoff > 7 and <= 45 days away
 *
 * The stages are ordered by how fast lines actually move, not by convenience.
 * Boundaries are inclusive downward — at EXACTLY 7 days the target has entered
 * the normal horizon and takes the 6-hour cadence — so each stage's threshold is
 * the one that applies from its boundary inward.
 *
 * Pregame is checked first and cannot collide with `early`: its window requires a
 * kickoff within 6 hours, which is inside every horizon below it.
 */
export function selectOddsPollingDecision(params: {
  games: readonly OddsCanonicalGame[];
  control: OddsRefreshControl;
  rawObservationMs: number | null;
  now: number;
}): OddsPollingDecision {
  const { games, control, rawObservationMs, now } = params;

  const eligible = collectEligibleOddsGames(games, now);
  if (eligible.length === 0) {
    return { due: false, reason: 'no-eligible-target' };
  }

  // Durable automatic backoff overrides every cadence mode.
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

  // The NEAREST eligible kickoff sets the stage. Nearest, not furthest: one game
  // inside the normal horizon means lines are moving now, and a distant game
  // must not slow the check down to the early rate.
  let nearestKickoffMs = eligible[0]!.kickoffMs;
  for (const entry of eligible) {
    if (entry.kickoffMs < nearestKickoffMs) nearestKickoffMs = entry.kickoffMs;
  }
  if (nearestKickoffMs - now > ODDS_EXPECTED_KICKOFF_HORIZON_MS) {
    return age >= ODDS_EARLY_CADENCE_MS
      ? { due: true, cadence: 'early' }
      : { due: false, reason: 'refresh-not-due' };
  }
  return age >= ODDS_BASELINE_CADENCE_MS
    ? { due: true, cadence: 'baseline' }
    : { due: false, reason: 'refresh-not-due' };
}

/**
 * Contextual classification of an EMPTY Odds provider response
 * (PLATFORM-086G2, deferred finding #4).
 *
 * An empty upstream payload used to be committed as a successful empty refresh,
 * which silently replaced prior-good target data and made a provider regression
 * look identical to a legitimately quiet target (offseason, no near-term
 * games). This pure classifier distinguishes the two using ONLY target-scoped
 * evidence the caller already holds — no provider call, no parallel Odds
 * identity or cache-target system.
 *
 * The "rows expected" contract is deliberately NARROW — upcoming schedule rows
 * alone must not imply every scheduled game already has posted odds:
 *
 *   - prior-good evidence: the prior durable/process entry for the SAME
 *     canonical target contains events whose commence time is STILL IN THE
 *     FUTURE. Events for games that already kicked off legitimately drop out of
 *     the provider feed, so only still-upcoming prior events count — a target
 *     that previously had future events should not silently lose them all.
 *   - near-horizon schedule evidence: the canonical schedule shows
 *     non-disrupted games kicking off within {@link ODDS_EXPECTED_KICKOFF_HORIZON_MS}
 *     (7 days). Across the canonical multi-book default set, games inside one
 *     week of kickoff during an active season reliably carry posted lines; games
 *     beyond the horizon (future seasons, far-out slates) create no expectation.
 *     Callers apply this evidence ONLY to the canonical/default target — a
 *     filtered bookmaker/market subset may legitimately have no rows, so its
 *     only evidence is its own prior-good data.
 *
 * Conservative by construction — every uncertainty resolves to valid absence:
 * unparseable or missing times are never evidence; games already kicked off are
 * never evidence; canceled/postponed (and suspended/delayed) games never
 * independently create an expectation (delegated to the canonical `gameStatus`
 * predicates). Schedule remains the source of game identity.
 */

import { isDisruptedStatusLabel } from '../gameStatus.ts';

/** Kickoffs within this window of `now` are expected to have posted odds. */
export const ODDS_EXPECTED_KICKOFF_HORIZON_MS = 7 * 24 * 60 * 60 * 1000;

/** Minimal slice of a prior-good cached odds event used as evidence. */
export type PriorOddsEventEvidence = { commenceTime: string | null };

/** Minimal slice of a canonical schedule item used as evidence. */
export type OddsScheduleEvidenceItem = {
  startDate: string | null;
  status: string | null;
};

export type EmptyOddsClassification =
  | { kind: 'valid-absence' }
  | {
      kind: 'unexpected-empty';
      /** Prior-good events for this exact target that have not kicked off yet. */
      priorUpcomingEventCount: number;
      /** Non-disrupted canonical-schedule games kicking off within the horizon. */
      nearHorizonGameCount: number;
    };

/**
 * Classify an empty Odds provider response for one canonical target.
 *
 * `scheduleItems` must be `null` when schedule evidence does not apply (a
 * filtered target, or the schedule read failed — unavailability is never
 * evidence). `priorEvents` must come from the entry for the SAME season-scoped
 * cache key the refresh would overwrite — evidence is never widened to sibling
 * targets.
 */
export function classifyEmptyOddsResponse(params: {
  priorEvents: readonly PriorOddsEventEvidence[];
  scheduleItems: readonly OddsScheduleEvidenceItem[] | null;
  now: number;
}): EmptyOddsClassification {
  const { priorEvents, scheduleItems, now } = params;

  let priorUpcomingEventCount = 0;
  for (const event of priorEvents) {
    if (event.commenceTime === null) continue;
    const commenceMs = Date.parse(event.commenceTime);
    // Already kicked off (or unparseable) → legitimately absent from the feed.
    if (!Number.isFinite(commenceMs) || commenceMs <= now) continue;
    priorUpcomingEventCount += 1;
  }

  let nearHorizonGameCount = 0;
  for (const item of scheduleItems ?? []) {
    if (isDisruptedStatusLabel(item.status)) continue;
    if (item.startDate === null) continue;
    const startMs = Date.parse(item.startDate);
    if (!Number.isFinite(startMs)) continue;
    // Only games strictly ahead of now and inside the horizon create an
    // expectation: kicked-off games drop from the provider feed, and far-out
    // games may legitimately have no posted lines yet.
    if (startMs <= now || startMs - now > ODDS_EXPECTED_KICKOFF_HORIZON_MS) continue;
    nearHorizonGameCount += 1;
  }

  if (priorUpcomingEventCount > 0 || nearHorizonGameCount > 0) {
    return { kind: 'unexpected-empty', priorUpcomingEventCount, nearHorizonGameCount };
  }
  return { kind: 'valid-absence' };
}

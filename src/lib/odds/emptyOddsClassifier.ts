/**
 * Contextual classification of an EMPTY Odds provider response
 * (PLATFORM-086G2, deferred finding #4; prior-evidence schedule reconciliation
 * added by the seam-audit remediation).
 *
 * An empty upstream payload used to be committed as a successful empty refresh,
 * which silently replaced prior-good target data and made a provider regression
 * look identical to a legitimately quiet target. This pure classifier
 * distinguishes the two using ONLY target-scoped evidence the caller already
 * holds — no provider call, no parallel Odds identity or cache-target system.
 *
 * Evidence sources:
 *
 *   - prior-good events for the SAME canonical target, RECONCILED against the
 *     current canonical schedule: a cached event is "still expected" only when
 *     it matches a schedule game (via the SAME canonical identity resolution
 *     and pair/date matching the odds-attachment layer uses — never raw label
 *     equality) that is not disrupted and whose CURRENT authoritative kickoff
 *     is still in the future. A cached commence time alone proves nothing: the
 *     provider legitimately drops events whose games were canceled/postponed,
 *     rescheduled, or removed from the slate.
 *   - near-horizon schedule evidence: non-disrupted games kicking off within
 *     {@link ODDS_EXPECTED_KICKOFF_HORIZON_MS} (7 days). Positive expectation
 *     from the schedule applies ONLY to the canonical/default target
 *     (`includeScheduleExpectation`) — a filtered bookmaker/market subset may
 *     legitimately have no rows. The schedule is still consulted as
 *     EXCULPATORY evidence (dismissing stale prior events) for every target.
 *
 * Reconciliation is only trusted when it is actually possible: the schedule
 * loaded successfully AND is nonempty AND identity-resolver inputs loaded.
 * Otherwise the classifier falls back to the original conservative rule (a
 * parseable future cached commence time counts), because the ABSENCE of
 * exculpatory data is never itself evidence — and nothing is ever "provably
 * obsolete" without authoritative schedule data.
 *
 * Valid-absence verdicts additionally report whether EVERY retained prior
 * event is provably obsolete (expired, matched to a disrupted or
 * started/completed game, or unmatched against a successfully loaded slate) so
 * the caller may replace a fully obsolete entry with the fresh empty result
 * instead of retaining dead rows indefinitely. Any healthy or indeterminate
 * event blocks that.
 */

import { attachOddsEventsToSchedule } from '../oddsAttachment.ts';
import type { ScheduleAttachmentGame } from '../gameAttachment.ts';
import type { TeamIdentityResolver } from '../teamIdentity.ts';
import { buildPlaceholderParticipant } from '../schedulePostseasonHelpers.ts';
import { isDisruptedStatusLabel } from '../gameStatus.ts';

/**
 * Whether a schedule label denotes a REAL resolved team, per the canonical
 * placeholder classifier the schedule build itself uses
 * (`buildPlaceholderParticipant`): blank labels, `TBD`, bracket-style slot
 * labels ("CFP Quarterfinal 2"), "Winner of …" derivations, and unresolved
 * names all classify as non-team slots. The slotId/defaultDisplay params are
 * display-only and inert here.
 */
function isResolvedTeamLabel(resolver: TeamIdentityResolver, raw: string): boolean {
  return (
    buildPlaceholderParticipant({
      resolver,
      raw,
      slotId: 'odds-empty-evidence',
      defaultDisplay: 'TBD',
    }).kind === 'team'
  );
}

/** Kickoffs within this window of `now` are expected to have posted odds. */
export const ODDS_EXPECTED_KICKOFF_HORIZON_MS = 7 * 24 * 60 * 60 * 1000;

/** Minimal slice of a prior-good cached odds event used as evidence. */
export type PriorOddsEventEvidence = {
  homeTeam: string;
  awayTeam: string;
  commenceTime: string | null;
};

/** Minimal slice of a canonical schedule item used as evidence. */
export type OddsScheduleEvidenceItem = {
  homeTeam: string;
  awayTeam: string;
  week?: number | null;
  startDate: string | null;
  status: string | null;
};

export type EmptyOddsClassification =
  | {
      kind: 'valid-absence';
      /**
       * True only when authoritative reconciliation ran and EVERY retained
       * prior event proved obsolete — the caller may then commit the fresh
       * empty entry over the dead rows. Always false when reconciliation was
       * not possible (schedule/resolver unavailable or empty slate).
       */
      priorRowsProvablyObsolete: boolean;
    }
  | {
      kind: 'unexpected-empty';
      /** Prior-good events still expected per the reconciliation rules above. */
      priorUpcomingEventCount: number;
      /** Non-disrupted canonical-schedule games kicking off within the horizon. */
      nearHorizonGameCount: number;
    };

/**
 * Classify an empty Odds provider response for one canonical target.
 *
 * `scheduleItems === null` means the schedule read FAILED (unavailability is
 * never evidence); an EMPTY array is treated the same for reconciliation — a
 * real season slate is never empty, so an empty result proves nothing about a
 * cached event's game. `resolver === null` means identity inputs were
 * unavailable; both prior-event reconciliation AND positive near-horizon
 * expectation require it (the latter to exclude unresolved placeholder
 * matchups). `includeScheduleExpectation` must be true only for the
 * canonical/default target.
 */
export function classifyEmptyOddsResponse(params: {
  priorEvents: readonly PriorOddsEventEvidence[];
  scheduleItems: readonly OddsScheduleEvidenceItem[] | null;
  resolver: TeamIdentityResolver | null;
  includeScheduleExpectation: boolean;
  now: number;
}): EmptyOddsClassification {
  const { priorEvents, scheduleItems, resolver, includeScheduleExpectation, now } = params;

  // Positive schedule expectation requires the resolver: the provider cannot
  // publish an event until BOTH participants are known, so a dated postseason
  // placeholder (CFP/bowl/championship slot with TBD or bracket labels) must
  // never make an empty response "unexpected" — and only the canonical
  // identity machinery can tell a real team label from a placeholder.
  let nearHorizonGameCount = 0;
  if (includeScheduleExpectation && scheduleItems !== null && resolver !== null) {
    for (const item of scheduleItems) {
      // Canceled/postponed/suspended/delayed games must not independently make
      // odds rows expected; only games strictly ahead of now and inside the
      // horizon create an expectation (kicked-off games drop from the provider
      // feed, and far-out games may legitimately have no posted lines yet).
      if (isDisruptedStatusLabel(item.status)) continue;
      if (item.startDate === null) continue;
      const startMs = Date.parse(item.startDate);
      if (!Number.isFinite(startMs)) continue;
      if (startMs <= now || startMs - now > ODDS_EXPECTED_KICKOFF_HORIZON_MS) continue;
      // Unresolved matchups contribute no positive evidence (they stay in the
      // schedule untouched — they simply cannot have posted odds yet).
      if (
        !isResolvedTeamLabel(resolver, item.homeTeam) ||
        !isResolvedTeamLabel(resolver, item.awayTeam)
      ) {
        continue;
      }
      nearHorizonGameCount += 1;
    }
  }

  const reconcilable = scheduleItems !== null && scheduleItems.length > 0 && resolver !== null;

  let priorUpcomingEventCount = 0;
  let priorRowsProvablyObsolete = false;

  if (!reconcilable) {
    // Fallback (schedule or identity inputs unavailable): the original
    // conservative rule — a parseable future cached commence time counts,
    // and nothing can be proven obsolete.
    for (const event of priorEvents) {
      if (event.commenceTime === null) continue;
      const commenceMs = Date.parse(event.commenceTime);
      if (!Number.isFinite(commenceMs) || commenceMs <= now) continue;
      priorUpcomingEventCount += 1;
    }
  } else if (priorEvents.length > 0) {
    // Reconcile each prior event against the current canonical slate using the
    // SAME pair-key + kickoff-proximity matcher the attachment layer uses.
    const games: ScheduleAttachmentGame[] = scheduleItems.map((item, index) => ({
      key: `evidence-${index}`,
      week: item.week ?? 0,
      canHome: item.homeTeam,
      canAway: item.awayTeam,
      csvHome: item.homeTeam,
      csvAway: item.awayTeam,
      date: item.startDate,
    }));
    const itemByGameKey = new Map<string, OddsScheduleEvidenceItem>(
      scheduleItems.map((item, index) => [`evidence-${index}`, item])
    );
    const attached = attachOddsEventsToSchedule({
      games,
      events: priorEvents as PriorOddsEventEvidence[],
      resolver,
    });
    const gameKeyByEvent = new Map<PriorOddsEventEvidence, string>(
      attached.map((match) => [match.event, match.gameKey])
    );

    let obsoleteCount = 0;
    for (const event of priorEvents) {
      const gameKey = gameKeyByEvent.get(event);
      if (gameKey === undefined) {
        // Unmatched against a successfully loaded slate: the cached line's
        // game no longer exists there (removed, or moved past the matcher's
        // kickoff tolerance) — provably obsolete, never evidence.
        obsoleteCount += 1;
        continue;
      }
      const game = itemByGameKey.get(gameKey);
      if (!game) continue; // unreachable; defensive — indeterminate
      if (isDisruptedStatusLabel(game.status)) {
        obsoleteCount += 1;
        continue;
      }
      const startMs = game.startDate === null ? Number.NaN : Date.parse(game.startDate);
      if (Number.isFinite(startMs) && startMs > now) {
        // Healthy: the AUTHORITATIVE current kickoff is still ahead —
        // deliberately with NO horizon cap, so a provider regression dropping
        // early-posted lines beyond 7 days is still caught.
        priorUpcomingEventCount += 1;
        continue;
      }
      if (Number.isFinite(startMs)) {
        // Started/completed per the authoritative kickoff (e.g. rescheduled
        // earlier): legitimately absent from the provider feed.
        obsoleteCount += 1;
        continue;
      }
      // Matched game with no parseable kickoff: not evidence, but expired
      // cached commence still proves obsolescence; otherwise indeterminate
      // (blocks clearing, contributes nothing).
      const commenceMs = event.commenceTime === null ? Number.NaN : Date.parse(event.commenceTime);
      if (Number.isFinite(commenceMs) && commenceMs <= now) {
        obsoleteCount += 1;
      }
    }
    priorRowsProvablyObsolete = obsoleteCount === priorEvents.length;
  }

  if (priorUpcomingEventCount > 0 || nearHorizonGameCount > 0) {
    return { kind: 'unexpected-empty', priorUpcomingEventCount, nearHorizonGameCount };
  }
  return { kind: 'valid-absence', priorRowsProvablyObsolete };
}

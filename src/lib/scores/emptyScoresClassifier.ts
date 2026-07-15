/**
 * Contextual classification of an EMPTY CFBD Scores response
 * (PLATFORM-086G1, deferred finding #6).
 *
 * An empty provider payload used to be treated unconditionally as a valid
 * no-op, which silently masked a provider regression: CFBD returning zero rows
 * for a target that demonstrably has score-bearing games looked identical to a
 * legitimately empty target (postseason before bowls). This pure classifier
 * distinguishes the two using ONLY target-scoped evidence the caller already
 * holds — no provider call, no new game-identity or schedule-matching system:
 *
 *   - populated prior-good durable score rows for the SAME canonical cache
 *     target (a target that once had provider rows should not silently lose
 *     them all); or
 *   - canonical schedule games in the target that have STARTED (kickoff in the
 *     past) and are not disrupted — those games should currently have
 *     provider-visible score state.
 *
 * Conservative by construction — every uncertainty resolves to valid absence:
 *   - future targets (no started games) stay valid no-ops;
 *   - targets with no expected games stay valid no-ops;
 *   - canceled/postponed (and suspended/delayed) games never independently
 *     create an expectation of score rows — disruption classification is
 *     delegated to the canonical `gameStatus` predicates, the single status
 *     classifier;
 *   - a game with no parseable kickoff time is never counted as evidence.
 *
 * Schedule remains the source of game identity: evidence items come from the
 * canonical schedule cache, never from provider score rows.
 */

import { isDisruptedStatusLabel } from '../gameStatus.ts';
import type { SeasonType } from './types.ts';

/** Minimal slice of a canonical schedule item used as empty-response evidence. */
export type ScheduleScoreEvidenceItem = {
  week: number;
  seasonType?: SeasonType | string | null;
  startDate: string | null;
  status: string | null;
};

export type EmptyScoresClassification =
  | { kind: 'valid-absence' }
  | {
      kind: 'unexpected-empty';
      /** Rows in the prior-good durable entry for the exact same target. */
      priorGoodRowCount: number;
      /** Started, non-disrupted canonical schedule games inside the target. */
      startedGameCount: number;
    };

/**
 * Missing/unknown season types normalize to 'regular', matching
 * `scoreApplicability.deriveApplicableScoreSeasonTypes` so the classifier and
 * the applicability derivation can never disagree on which partition a
 * schedule item belongs to.
 */
function normalizeSeasonType(value: unknown): SeasonType {
  return value === 'postseason' ? 'postseason' : 'regular';
}

/**
 * Classify an empty Scores provider response for one refresh target.
 *
 * `week === null` means a season-wide (whole-partition) target; a numeric week
 * narrows the schedule evidence to exactly that week. `priorGoodRowCount` must
 * be the row count of the durable entry for the SAME cache key the refresh
 * would overwrite — evidence is never widened to sibling targets.
 */
export function classifyEmptyScoresResponse(params: {
  priorGoodRowCount: number;
  scheduleItems: readonly ScheduleScoreEvidenceItem[];
  seasonType: SeasonType;
  week: number | null;
  now: number;
}): EmptyScoresClassification {
  const { priorGoodRowCount, scheduleItems, seasonType, week, now } = params;

  let startedGameCount = 0;
  for (const item of scheduleItems) {
    if (normalizeSeasonType(item.seasonType) !== seasonType) continue;
    if (week !== null && item.week !== week) continue;
    // Canceled/postponed/suspended/delayed games must not independently make
    // score rows expected (finding #6 conservatism requirement).
    if (isDisruptedStatusLabel(item.status)) continue;
    if (item.startDate === null) continue;
    const startMs = Date.parse(item.startDate);
    // Unparseable kickoff or future kickoff → not trustworthy started-game
    // evidence. Future-only targets therefore remain valid no-ops.
    if (!Number.isFinite(startMs) || startMs > now) continue;
    startedGameCount += 1;
  }

  if (priorGoodRowCount > 0 || startedGameCount > 0) {
    return { kind: 'unexpected-empty', priorGoodRowCount, startedGameCount };
  }
  return { kind: 'valid-absence' };
}

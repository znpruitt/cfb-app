import type { GameStatsIngestionResult } from './ingestionCoordinator.ts';

/**
 * PLATFORM-086H3E2 — the ONE typed refresh-outcome interpreter (ACTIVE).
 *
 * Both the manual route and the cron (wired by E3, now live) interpret a
 * `GameStatsIngestionResult` through THIS module and nothing else, so the two
 * callers can never diverge on what an ingestion attempt meant. It consumes
 * C2's complete result — with H2's `DurableMergeResult` nested UNCHANGED — and
 * re-derives no parsing, persistability, merge, stale, duplicate, conflict, or
 * completeness policy: the mapping below is pure classification of outcomes
 * those authorities already produced.
 *
 * Locked semantic mapping (the H3E activation contract, verbatim):
 *
 *   | Ingestion/H2 result            | Meaning                                       |
 *   |--------------------------------|-----------------------------------------------|
 *   | exact empty response           | no-op; no commit, no last-success advance     |
 *   | invalid payload / nothing      | failure; prior-good preserved                 |
 *   |   persistable                  |                                               |
 *   | written, rowAcceptance clean   | success (confirmed durable commit)            |
 *   | written, rowAcceptance mixed   | partial                                       |
 *   | partially-merged               | partial; confirmed commit advances            |
 *   |                                |   last-success                                |
 *   | unchanged/stale, clean         | no-op; no last-success advance                |
 *   | unchanged/stale, mixed         | failure (invalid rows ignored, nothing        |
 *   |                                |   repaired)                                   |
 *   | conflict                       | failure; HTTP 409 for the manual route        |
 *   | unavailable                    | failure, known-unchanged; safe 503            |
 *   | indeterminate                  | failure, durability UNKNOWN; 503; durable     |
 *   |                                |   reread required, no success inference, no   |
 *   |                                |   immediate retry                             |
 *
 * H2 returns `written`/`partially-merged` only after a CONFIRMED transaction
 * commit, so those outcomes ARE the "confirmed durable commit" the contract
 * requires before any last-success advance. A failure must never advance
 * prior-good success metadata; attempt-token bookkeeping, the durable reread,
 * and response construction remain the callers' (E3's) responsibility.
 */

export type GameStatsRefreshOutcomeKind = 'success' | 'partial' | 'no-op' | 'failure';

export type GameStatsRefreshOutcomeReason =
  | 'empty-response'
  | 'invalid-payload'
  | 'no-persistable-observations'
  | 'written-clean'
  | 'written-mixed'
  | 'partially-merged'
  | 'unchanged-clean'
  | 'unchanged-mixed'
  | 'stale-clean'
  | 'stale-mixed'
  | 'conflict'
  | 'unavailable'
  | 'indeterminate';

export type GameStatsRefreshInterpretation = {
  kind: GameStatsRefreshOutcomeKind;
  /** Stable machine-readable reason — one per matrix row. */
  reason: GameStatsRefreshOutcomeReason;
  /** The HTTP status the authenticated manual route must return. */
  httpStatus: 200 | 409 | 502 | 503;
  /**
   * True ONLY when a confirmed durable commit occurred (`written` /
   * `partially-merged`) — the sole license to advance last-success metadata.
   */
  advanceLastSuccess: boolean;
  /**
   * True when success metadata must record `partialFailure: true`
   * (`recordProviderRefreshSuccess`'s existing vocabulary).
   */
  partialFailure: boolean;
  /**
   * True when the durable partition is KNOWN unchanged by this attempt (empty
   * batch, rejection, clean unchanged/stale, mixed unchanged/stale, conflict,
   * unavailable). False when a commit occurred — or when durability is unknown.
   */
  knownUnchanged: boolean;
  /**
   * True ONLY for `indeterminate`: the merge transaction's fate is unknown.
   * The caller must reread the exact durable partition, must not infer
   * success, and must not retry within the same request/run.
   */
  durabilityUnknown: boolean;
};

function interpretation(
  kind: GameStatsRefreshOutcomeKind,
  reason: GameStatsRefreshOutcomeReason,
  httpStatus: 200 | 409 | 502 | 503,
  flags?: Partial<
    Pick<
      GameStatsRefreshInterpretation,
      'advanceLastSuccess' | 'partialFailure' | 'knownUnchanged' | 'durabilityUnknown'
    >
  >
): GameStatsRefreshInterpretation {
  return {
    kind,
    reason,
    httpStatus,
    advanceLastSuccess: flags?.advanceLastSuccess ?? false,
    partialFailure: flags?.partialFailure ?? false,
    knownUnchanged: flags?.knownUnchanged ?? false,
    durabilityUnknown: flags?.durabilityUnknown ?? false,
  };
}

/**
 * Classify one complete ingestion attempt. Pure and total over the typed
 * result; an outcome outside the closed union is a programming error in the
 * in-process pipeline (never durable data) and throws.
 */
export function interpretGameStatsRefreshOutcome(
  result: GameStatsIngestionResult
): GameStatsRefreshInterpretation {
  if (result.kind === 'no-op') {
    return interpretation('no-op', 'empty-response', 200, { knownUnchanged: true });
  }
  if (result.kind === 'rejected') {
    return interpretation('failure', result.reason, 502, { knownUnchanged: true });
  }

  const { merge, diagnostics } = result;
  const mixed = diagnostics.rowAcceptance === 'mixed';
  switch (merge.outcome) {
    case 'written':
      return mixed
        ? interpretation('partial', 'written-mixed', 200, {
            advanceLastSuccess: true,
            partialFailure: true,
          })
        : interpretation('success', 'written-clean', 200, { advanceLastSuccess: true });
    case 'partially-merged':
      // A confirmed durable commit occurred for the merged subset — partial
      // regardless of batch acceptance; the commit may advance last-success.
      return interpretation('partial', 'partially-merged', 200, {
        advanceLastSuccess: true,
        partialFailure: true,
      });
    case 'unchanged':
      return mixed
        ? interpretation('failure', 'unchanged-mixed', 502, { knownUnchanged: true })
        : interpretation('no-op', 'unchanged-clean', 200, { knownUnchanged: true });
    case 'stale':
      return mixed
        ? interpretation('failure', 'stale-mixed', 502, { knownUnchanged: true })
        : interpretation('no-op', 'stale-clean', 200, { knownUnchanged: true });
    case 'conflict':
      return interpretation('failure', 'conflict', 409, { knownUnchanged: true });
    case 'unavailable':
      return interpretation('failure', 'unavailable', 503, { knownUnchanged: true });
    case 'indeterminate':
      return interpretation('failure', 'indeterminate', 503, { durabilityUnknown: true });
    default: {
      const impossible: never = merge.outcome;
      throw new Error(`unknown durable merge outcome: ${String(impossible)}`);
    }
  }
}

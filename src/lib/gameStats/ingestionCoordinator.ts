import type { CfbdSeasonType } from '../cfbd.ts';
import {
  isPersistableIncomingRow,
  parseV2GameObservation,
  type ParsedV2Observation,
  type V2ObservationParseFailureReason,
} from './contract.ts';
import { mergeGameStatsPartitionDurable, type DurableMergeResult } from './durableMerge.ts';

/**
 * PLATFORM-086H3C2 — dormant safe ingestion coordination (DORMANT).
 *
 * The smallest adapter connecting ONE already-fetched CFBD `/games/teams`
 * response to H1 parsing (`contract.ts`) and H2 durable merging
 * (`durableMerge.ts`). It owns exactly one responsibility that neither H1 nor H2
 * provides: batch coordination. It validates the top-level response, runs every
 * provider row through H1's single parser, decides whether the batch carries any
 * persistable evidence at all, and — only then — calls H2 once for the requested
 * partition with EVERY successfully parsed observation, returning H2's exact
 * result alongside batch diagnostics.
 *
 * It deliberately duplicates NO policy that already has a home:
 *   - parsing, identity, and the persistence predicate live in H1;
 *   - merging, conflict, stale-data, completeness, per-game fencing,
 *     duplicate/version handling, non-persistable filtering, and the typed
 *     outcome vocabulary live in H2.
 * H1's persistence predicate is used here ONLY as the batch-level gate and the
 * diagnostic authority; the adapter never filters what H2 receives. H2 remains
 * responsible for filtering successfully parsed but non-persistable observations
 * and reporting `skippedNonPersistable`.
 *
 * DORMANT: nothing in production imports it. No CFBD fetch, credentials, retry,
 * pacing, or quota; no route or status-code mapping; no cron, polling cadence,
 * targeting, arming, or final-status confirmation; no provider-refresh records;
 * no schedule association or whole-slate coverage; no reader/analytics/Insights
 * surface; no writer-control permission check; no recovery/lease/backoff/repair.
 * Polling, scheduler, route, reader, and production activation belong in E — not
 * here. The recursive dormant-boundary guard enforces this (the adapter is an
 * authorized dormant home of H1/H2 imports; every live file is forbidden from
 * importing it). It is NOT exported from any game-stats barrel.
 */

/** The requested partition plus the already-fetched, untrusted provider response. */
export type GameStatsIngestionInput = {
  year: number;
  week: number;
  seasonType: CfbdSeasonType;
  /**
   * When the provider request that produced `payload` STARTED — supplied by the
   * future caller. Passed to H2 verbatim as the observation fence; the adapter
   * never generates a later timestamp after receiving the response, and never
   * validates the fence itself (H2 owns fence policy: an invalid fence makes H2
   * `unavailable`, which is returned unchanged).
   */
  fetchStartedAt: string;
  /** The raw CFBD `/games/teams` response body — untrusted, top level unvalidated. */
  payload: unknown;
};

export type GameStatsBatchRowAcceptance = 'clean' | 'mixed';

/**
 * Batch-level diagnostics added ONLY to a `merge-result`. They summarize how the
 * raw response decomposed through H1; they never restate or reshape H2's result
 * (H2's own `skippedNonPersistable` remains the authority on what H2 filtered).
 */
export type GameStatsBatchDiagnostics = {
  /** Total rows in the raw response array. */
  rawRowCount: number;
  /** Rows that H1 parsed into a typed observation. */
  parsedRowCount: number;
  /** Successfully parsed observations that satisfy H1's persistence predicate. */
  persistableRowCount: number;
  /** Successfully parsed observations that do NOT (evidence too thin to persist). */
  nonPersistableParsedRowCount: number;
  /** Parse-failure tallies grouped by H1's existing failure reason (present reasons only). */
  parseFailureCounts: Partial<Record<V2ObservationParseFailureReason, number>>;
  /**
   * `clean` when every raw row parsed AND every parsed observation is
   * persistable; `mixed` when the batch also carried parse failures or
   * non-persistable observations. Independent of H2's outcome — a `mixed` batch
   * may still merge to `written`, `partially-merged`, `stale`, or `conflict`.
   */
  rowAcceptance: GameStatsBatchRowAcceptance;
};

/**
 * The adapter's discriminated result:
 *   - `no-op` — the response was exactly `[]`; a valid empty batch. H2 is NOT
 *     called and nothing is written (an empty array is never a deletion).
 *   - `rejected` — `invalid-payload` when the top level is not an array;
 *     `no-persistable-observations` when the array is nonempty but no parsed
 *     observation is persistable. H2 is NOT called; prior durable data is
 *     untouched.
 *   - `merge-result` — H2 was called once; carries H2's complete
 *     `DurableMergeResult` UNCHANGED (outcome never renamed or collapsed) plus
 *     the batch diagnostics.
 */
export type GameStatsIngestionResult =
  | { kind: 'no-op'; reason: 'empty-response' }
  | { kind: 'rejected'; reason: 'invalid-payload' | 'no-persistable-observations' }
  | { kind: 'merge-result'; merge: DurableMergeResult; diagnostics: GameStatsBatchDiagnostics };

/**
 * Coordinate one CFBD `/games/teams` response into H1 parsing and H2 durable
 * merging for a single weekly partition. Pure coordination: it fetches nothing,
 * maps to no HTTP status, and initiates no recovery. Unexpected thrown
 * programming errors from H2 propagate unchanged — they are never converted into
 * an operational outcome.
 */
export async function ingestGameStatsPartitionResponse(
  input: GameStatsIngestionInput
): Promise<GameStatsIngestionResult> {
  const { year, week, seasonType, fetchStartedAt, payload } = input;

  // 1. Top-level shape. A non-array response is a structural rejection — the
  //    adapter must never hand a non-batch to H2.
  if (!Array.isArray(payload)) {
    return { kind: 'rejected', reason: 'invalid-payload' };
  }
  // An exact empty array is a valid no-op: no write, no deletion, H2 not called.
  if (payload.length === 0) {
    return { kind: 'no-op', reason: 'empty-response' };
  }

  // 2. Run every provider row through H1's single parser. Successfully parsed
  //    observations flow to H2 WHOLE (persistable or not); parse failures are
  //    tallied by H1's own reason for diagnostics.
  const parsed: ParsedV2Observation[] = [];
  const parseFailureCounts: Partial<Record<V2ObservationParseFailureReason, number>> = {};
  for (const row of payload) {
    const result = parseV2GameObservation(row);
    if (result.ok) {
      parsed.push(result.observation);
    } else {
      parseFailureCounts[result.reason] = (parseFailureCounts[result.reason] ?? 0) + 1;
    }
  }

  // 3. Batch-level persistence gate + diagnostics. H1's predicate is the ONLY
  //    persistence authority; here it decides whether the batch is worth a merge
  //    and counts persistable vs non-persistable parsed rows. It never removes
  //    observations from the collection handed to H2.
  let persistableRowCount = 0;
  for (const observation of parsed) {
    if (isPersistableIncomingRow(observation)) persistableRowCount += 1;
  }
  const parsedRowCount = parsed.length;
  const nonPersistableParsedRowCount = parsedRowCount - persistableRowCount;

  // No parsed observation is persistable: reject WITHOUT calling H2, so prior
  // durable data is provably untouched.
  if (persistableRowCount === 0) {
    return { kind: 'rejected', reason: 'no-persistable-observations' };
  }

  const diagnostics: GameStatsBatchDiagnostics = {
    rawRowCount: payload.length,
    parsedRowCount,
    persistableRowCount,
    nonPersistableParsedRowCount,
    parseFailureCounts,
    rowAcceptance:
      Object.keys(parseFailureCounts).length > 0 || nonPersistableParsedRowCount > 0
        ? 'mixed'
        : 'clean',
  };

  // 4. One durable merge call for the requested partition with EVERY parsed
  //    observation. H2 filters non-persistable rows, reports
  //    `skippedNonPersistable`, and owns the outcome; the adapter returns that
  //    result verbatim (`unavailable`/`indeterminate`/`stale`/`conflict`/… are
  //    never relabeled or collapsed).
  const merge = await mergeGameStatsPartitionDurable({
    year,
    week,
    seasonType,
    fetchStartedAt,
    observations: parsed,
  });

  return { kind: 'merge-result', merge, diagnostics };
}

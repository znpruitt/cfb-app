import type { CfbdSeasonType } from '../cfbd.ts';
import {
  isPersistableIncomingRow,
  isValidProviderGameId,
  parseV2GameObservation,
  type ParsedV2Observation,
  type V2ObservationParseFailureReason,
} from './contract.ts';
import { mergeGameStatsPartitionDurable, type DurableMergeResult } from './durableMerge.ts';

/**
 * PLATFORM-086H3C2 — safe ingestion coordination (ACTIVE).
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
 * diagnostic authority; the adapter applies NO policy of its own to what H2
 * receives. H2 remains responsible for filtering successfully parsed but
 * non-persistable observations and reporting `skippedNonPersistable`.
 *
 * The ONE exception is `restrictToProviderGameIds` (PLATFORM-110A): an OPTIONAL,
 * explicit set of provider game ids supplied BY THE CALLER that bounds which
 * parsed observations reach H2. It is a caller-supplied bound, not adapter
 * policy — the adapter never derives, widens, or defaults it, and its absence
 * leaves the whole-batch behaviour above exactly as it was for the route and
 * cron. An EMPTY set is REFUSED (`empty-restriction`), never read as "no
 * restriction"; a set carrying an invalid id is REFUSED
 * (`invalid-restriction-id`); a set whose ids match no parsed observation is
 * REFUSED (`restriction-matched-nothing`) — INCLUDING against an exactly empty
 * response, which is a valid no-op only when nothing in particular was asked
 * for; and a set only PARTIALLY matched merges what it found but can never
 * report `clean`, because some named game was not re-observed. It
 * exists so a bounded recovery can re-observe named games without rewriting the
 * rest of a partition it happened to fetch — the provider endpoint is
 * partition-granular, the repair is not. Recurring reconciliation over satisfied
 * partitions is Item 110B and is NOT this parameter.
 *
 * Batch coordination ONLY: it performs no CFBD fetch, credentials, retry,
 * pacing, or quota; no route or status-code mapping; no cron, polling cadence,
 * targeting, arming, or final-status confirmation; no provider-refresh records;
 * no schedule association or whole-slate coverage; no reader/analytics/Insights
 * surface; no writer-control permission check; no recovery/lease/backoff/repair.
 * Those concerns live in the activated route and cron (`/api/game-stats`,
 * `/api/cron/game-stats`, PLATFORM-086H3E), which are this adapter's only
 * production callers — it is the ONE ingestion path both reach. The activation-
 * invariant guard keeps the H2 durable-merge entry points confined to this
 * adapter and H2's own module. It is NOT exported from any game-stats barrel.
 */

/** The requested partition plus the already-fetched, untrusted provider response. */
export type GameStatsIngestionInput = {
  year: number;
  week: number;
  seasonType: CfbdSeasonType;
  /**
   * When the provider request that produced `payload` STARTED — supplied by the
   * calling route/cron. Passed to H2 verbatim as the observation fence; the adapter
   * never generates a later timestamp after receiving the response, and never
   * validates the fence itself (H2 owns fence policy: an invalid fence makes H2
   * `unavailable`, which is returned unchanged).
   */
  fetchStartedAt: string;
  /** The raw CFBD `/games/teams` response body — untrusted, top level unvalidated. */
  payload: unknown;
  /**
   * OPTIONAL caller-supplied recovery bound (PLATFORM-110A). When present, only
   * parsed observations whose `providerGameId` is in this set are handed to H2;
   * every other row of the response is discarded BEFORE the persistence gate,
   * the diagnostics, and the merge, so H2's `retainedExisting` provably covers
   * the untouched games. When ABSENT the adapter merges the whole batch — the
   * long-standing behaviour of the route and cron, unchanged.
   *
   * Validated, never coerced: the set must be nonempty and every member must be
   * a valid provider game id. An empty set is a refusal, not a wildcard.
   */
  restrictToProviderGameIds?: ReadonlySet<number>;
};

export type GameStatsBatchRowAcceptance = 'clean' | 'mixed';

/**
 * Batch-level diagnostics added ONLY to a `merge-result`. They summarize how the
 * raw response decomposed through H1; they never restate or reshape H2's result
 * (H2's own `skippedNonPersistable` remains the authority on what H2 filtered).
 */
export type GameStatsBatchRestriction = {
  /** Sorted provider game ids the CALLER bounded this ingestion to. */
  requestedProviderGameIds: number[];
  /** Sorted requested ids a parsed observation actually matched. */
  matchedProviderGameIds: number[];
  /** Sorted requested ids the response did not carry (absent, or unparseable). */
  unmatchedProviderGameIds: number[];
  /** Rows in the WHOLE raw response array, before the restriction narrowed it. */
  responseRowCount: number;
  /** Parsed observations the restriction excluded from the merge. */
  excludedParsedRowCount: number;
  /** Parse-failure tallies across the WHOLE response, restricted or not. */
  responseParseFailureCounts: Partial<Record<V2ObservationParseFailureReason, number>>;
};

export type GameStatsBatchDiagnostics = {
  /**
   * Rows in the INGESTED batch: the raw response array, or — when
   * `restrictToProviderGameIds` narrowed it — the rows that survived the
   * restriction. Every other count in this object describes the same ingested
   * batch, so `rowAcceptance` can never be dragged to `mixed` by a row the
   * caller deliberately excluded. `restriction.responseRowCount` carries the
   * untruncated response size.
   */
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
   * persistable AND — under a restriction — every requested id was matched;
   * `mixed` when the batch carried parse failures, non-persistable
   * observations, or an unmatched requested id. Independent of H2's outcome —
   * a `mixed` batch may still merge to `written`, `partially-merged`, `stale`,
   * or `conflict`.
   */
  rowAcceptance: GameStatsBatchRowAcceptance;
  /**
   * Present ONLY when the caller supplied `restrictToProviderGameIds`. Records
   * what was asked for, what the response carried, and what the bound excluded,
   * so a bounded recovery's evidence can be read against the whole response it
   * was cut from.
   */
  restriction?: GameStatsBatchRestriction;
};

/**
 * The adapter's discriminated result:
 *   - `no-op` — the response was exactly `[]`; a valid empty batch. H2 is NOT
 *     called and nothing is written (an empty array is never a deletion).
 *   - `rejected` — `invalid-payload` when the top level is not an array;
 *     `no-persistable-observations` when the array is nonempty but no parsed
 *     observation is persistable; `empty-restriction` when the caller supplied
 *     an empty `restrictToProviderGameIds`; `invalid-restriction-id` when it
 *     carries an id that is not a valid provider game id;
 *     `restriction-matched-nothing` when a valid restriction matched no parsed
 *     observation — including against an exactly empty response. H2 is NOT
 *     called; prior durable data is untouched.
 *   - `merge-result` — H2 was called once; carries H2's complete
 *     `DurableMergeResult` UNCHANGED (outcome never renamed or collapsed) plus
 *     the batch diagnostics.
 */
export type GameStatsIngestionResult =
  | { kind: 'no-op'; reason: 'empty-response' }
  | {
      kind: 'rejected';
      reason:
        | 'invalid-payload'
        | 'no-persistable-observations'
        | 'empty-restriction'
        | 'invalid-restriction-id'
        | 'restriction-matched-nothing';
    }
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
  const { year, week, seasonType, fetchStartedAt, payload, restrictToProviderGameIds } = input;

  // 0. Validate the caller's bound BEFORE the payload, so an unusable
  //    restriction can never be masked by an empty or malformed response. A
  //    present-but-empty set, or one carrying an invalid id, is an operator
  //    error: refuse it. It is never widened to "everything".
  if (restrictToProviderGameIds !== undefined) {
    if (restrictToProviderGameIds.size === 0) {
      return { kind: 'rejected', reason: 'empty-restriction' };
    }
    for (const id of restrictToProviderGameIds) {
      if (!isValidProviderGameId(id)) {
        return { kind: 'rejected', reason: 'invalid-restriction-id' };
      }
    }
  }

  // 1. Top-level shape. A non-array response is a structural rejection — the
  //    adapter must never hand a non-batch to H2.
  if (!Array.isArray(payload)) {
    return { kind: 'rejected', reason: 'invalid-payload' };
  }
  // An exact empty array is a valid no-op ONLY when nothing in particular was
  // asked for. Under a restriction the caller named games and the response
  // carried none of them, which is the `restriction-matched-nothing` failure —
  // reporting it as a no-op would tell an operator the repair succeeded.
  if (payload.length === 0) {
    return restrictToProviderGameIds === undefined
      ? { kind: 'no-op', reason: 'empty-response' }
      : { kind: 'rejected', reason: 'restriction-matched-nothing' };
  }

  // 2. Run every provider row through H1's single parser. Successfully parsed
  //    observations flow to H2 WHOLE (persistable or not); parse failures are
  //    tallied by H1's own reason for diagnostics.
  const allParsed: ParsedV2Observation[] = [];
  const responseParseFailureCounts: Partial<Record<V2ObservationParseFailureReason, number>> = {};
  for (const row of payload) {
    const result = parseV2GameObservation(row);
    if (result.ok) {
      allParsed.push(result.observation);
    } else {
      responseParseFailureCounts[result.reason] =
        (responseParseFailureCounts[result.reason] ?? 0) + 1;
    }
  }

  // 2b. Apply the caller's explicit bound, if any. Everything downstream — the
  //     persistence gate, the diagnostics, and the merge — sees ONLY the
  //     selected observations, so the merge behaves exactly as if the provider
  //     had returned just those games and H2 reports every other stored game in
  //     `retainedExisting`. A restriction that matches nothing is a truthful
  //     FAILURE, not a no-op: the caller asked for named games and got none.
  const parsed =
    restrictToProviderGameIds === undefined
      ? allParsed
      : allParsed.filter((observation) =>
          restrictToProviderGameIds.has(observation.providerGameId)
        );
  let restriction: GameStatsBatchRestriction | undefined;
  if (restrictToProviderGameIds !== undefined) {
    const matched = new Set(parsed.map((observation) => observation.providerGameId));
    const requested = [...restrictToProviderGameIds].sort((a, b) => a - b);
    restriction = {
      requestedProviderGameIds: requested,
      matchedProviderGameIds: requested.filter((id) => matched.has(id)),
      unmatchedProviderGameIds: requested.filter((id) => !matched.has(id)),
      responseRowCount: payload.length,
      excludedParsedRowCount: allParsed.length - parsed.length,
      responseParseFailureCounts,
    };
    if (parsed.length === 0) {
      return { kind: 'rejected', reason: 'restriction-matched-nothing' };
    }
  }
  // Parse failures cannot be attributed to a provider game id, so a restricted
  // batch reports none here by construction (every selected row parsed); the
  // whole response's tallies live on `restriction.responseParseFailureCounts`.
  const parseFailureCounts: Partial<Record<V2ObservationParseFailureReason, number>> =
    restrictToProviderGameIds === undefined ? responseParseFailureCounts : {};

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

  // A restriction that matched only SOME of its ids merges what it found — a
  // named game the provider omitted must not block the repair of the others —
  // but the batch can never be `clean`, because a requested game was not
  // re-observed. `mixed` routes it to `written-mixed` → `partial`, so the
  // caller records `partialFailure` and never reports a whole success.
  const someRequestedIdUnmatched =
    restriction !== undefined && restriction.unmatchedProviderGameIds.length > 0;
  const rowAcceptance: GameStatsBatchRowAcceptance =
    Object.keys(parseFailureCounts).length > 0 ||
    nonPersistableParsedRowCount > 0 ||
    someRequestedIdUnmatched
      ? 'mixed'
      : 'clean';
  // Branch rather than a conditional spread: `restriction` is present only for
  // a bounded ingestion, and an `undefined` property would read as "restricted
  // to nothing" to a consumer checking `in`.
  const diagnostics: GameStatsBatchDiagnostics =
    restriction === undefined
      ? {
          rawRowCount: payload.length,
          parsedRowCount,
          persistableRowCount,
          nonPersistableParsedRowCount,
          parseFailureCounts,
          rowAcceptance,
        }
      : {
          rawRowCount: parsed.length,
          parsedRowCount,
          persistableRowCount,
          nonPersistableParsedRowCount,
          parseFailureCounts,
          rowAcceptance,
          restriction,
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

/**
 * PLATFORM-086E1A — the ONE typed shared full-season schedule refresh-result
 * contract.
 *
 * Every production full-season schedule writer — the authorized full-year
 * `/api/schedule?bypassCache=1` refresh, the season-transition cron, and the
 * historical schedule repair — drives the shared authority and consumes THIS
 * value to learn what the refresh meant. Callers MUST read outcome truth from
 * this typed result, never re-derive it by reparsing an HTTP response, so the
 * three callers can never diverge on "did the schedule change / commit / fail".
 *
 * The status axis is small and total:
 *   - `in-progress` — a nonexpired durable lease already holds this year; the
 *                     losing caller made NO provider request and began no attempt.
 *   - `success`     — a complete result was durably committed (fresh rows written,
 *                     or unchanged content with newer observation metadata).
 *   - `no-op`       — the provider validated but nothing authoritative was written
 *                     (a valid absence, or a stale observation that lost to a
 *                     fresher committed one). Never advances a fabricated success.
 *   - `failure`     — a partition fetch/payload rejection, an empty replacement of
 *                     populated prior-good, or a durable store failure. Prior-good
 *                     durable schedule is retained; no success/cache is published.
 *
 * The reason axis is a closed, stable, secret-free union. It NEVER carries a
 * request/response object, provider payload, environment value, credential, error
 * stack, or arbitrary error message.
 */

import type { CacheEntry } from '@/app/api/schedule/cache';
import type { SeasonType } from '@/lib/schedule/cfbdSchedule';
import type { FinalScoreDifferenceIdentity } from '@/lib/schedule/finalScoreSweep';

export type FullSeasonScheduleRefreshStatus = 'success' | 'no-op' | 'failure' | 'in-progress';

export type FullSeasonScheduleRefreshReason =
  // ---- in-progress (no provider request, no attempt) ----
  | 'refresh-in-progress' // a nonexpired durable lease already holds this year
  // ---- failure ----
  | 'cfbd-api-key-missing' // CFBD_API_KEY absent (attempt begun, then resolved failed)
  | 'canonical-context-unavailable' // prior durable schedule state could not be read
  | 'partition-fetch-failed' // a required partition fetch threw (transport/HTTP)
  | 'partition-invalid-payload' // a required partition returned a non-array payload
  | 'partition-schema-drift' // a required partition normalized a nonempty payload to zero rows
  | 'empty-replacement-rejected' // an all-empty result over populated prior-good — rejected
  | 'durable-commit-failed' // the lease/commit durable store operation failed
  | 'unexpected-error' // an unclassified internal error
  // ---- no-op (validated, nothing authoritative written) ----
  | 'empty-response' // a genuinely unpublished/inapplicable all-empty result — no write
  | 'stale-observation' // this observation lost to a fresher committed one — no write
  // ---- success ----
  | 'unchanged-clean' // recomputed items equal prior-good; only observation metadata committed
  | 'written-clean'; // fresh rows were durably committed

export type FullSeasonScheduleRefreshResult = {
  status: FullSeasonScheduleRefreshStatus;
  reason: FullSeasonScheduleRefreshReason;
  /** HTTP status the authorized manual route returns for this outcome. */
  httpStatus: 200 | 400 | 409 | 500 | 502 | 503;
  /** The year the refresh targeted. */
  requestedYear: number;
  /** Season-type partitions the authority attempted (empty on a pre-fetch outcome). */
  attemptedSeasonTypes: SeasonType[];
  /**
   * Required partitions that were UNCERTAIN (fetch-failed / invalid-payload /
   * schema-drift) and caused an aggregate `partition-*` rejection. Empty for every
   * other outcome. Lets the season-transition cron report exactly which partition
   * failed without re-deriving it from an HTTP response.
   */
  failedSeasonTypes: SeasonType[];
  /** Total usable rows received across attempted partitions (0 before any fetch). */
  rowsReceived: number;
  /** Rows durably committed — nonzero only on `written-clean`. */
  rowsCommitted: number;
  /** Whether committed schedule CONTENT changed (drives standings invalidation). */
  dataChanged: boolean;
  /** Final score gaps filled through the existing per-partition score merge. */
  scoreRepairs: number;
  /** Existing immutable finals whose scores differed from this CFBD observation. */
  scoreDifferenceCount: number;
  /** Bounded game/partition identities for the differing finals. */
  scoreDifferences: FinalScoreDifferenceIdentity[];
  /** Whether `scoreDifferences` was bounded below `scoreDifferenceCount`. */
  scoreDifferencesTruncated: boolean;
  /** Score partitions whose gap-fill merge failed after the schedule commit. */
  scoreSweepFailedPartitions: Array<{ week: number; seasonType: SeasonType }>;
  /** Games present in both schedule observations whose kickoff instant changed. */
  kickoffsChanged: number;
  /**
   * Whether THIS refresh started the schedule provider-fetch stage
   * (PLATFORM-086E1B instrumentation). `false` for every pre-provider exit —
   * prior-state read failure, lease contention or lease-store failure, missing
   * CFBD credentials; set `true` immediately before the regular/postseason fetch
   * pair begins and it REMAINS true after a transport, payload, completeness, or
   * commit failure. It refers only to the provider-fetch stage (never status or
   * store work) and does not count internal retries. Callers consume this field
   * directly — never re-derive it from `attemptedSeasonTypes`, HTTP status,
   * response text, or the result reason.
   */
  providerCallAttempted: boolean;
  /** The observation instant captured immediately before provider work (ISO), or null. */
  observedAt: string | null;
  /** The confirmed durable commit instant (ISO) — set only when a write happened. */
  committedAt: string | null;
  /**
   * The confirmed canonical schedule items lifecycle callers consume WITHOUT a
   * refetch: the freshly committed rows on `written-clean`/`unchanged-clean`, or
   * the prior-good rows served on `stale-observation`. Empty on `empty-response`,
   * every failure, and `in-progress`.
   */
  items: CacheEntry['items'];
  /** The confirmed durable entry that backs `items`, when one exists. */
  entry: CacheEntry | null;
};

const REASON_HTTP_STATUS: Record<
  FullSeasonScheduleRefreshReason,
  FullSeasonScheduleRefreshResult['httpStatus']
> = {
  'refresh-in-progress': 409,
  'cfbd-api-key-missing': 503,
  'canonical-context-unavailable': 503,
  'partition-fetch-failed': 502,
  'partition-invalid-payload': 502,
  'partition-schema-drift': 502,
  'empty-replacement-rejected': 502,
  'durable-commit-failed': 500,
  'unexpected-error': 500,
  'empty-response': 200,
  'stale-observation': 200,
  'unchanged-clean': 200,
  'written-clean': 200,
};

const STATUS_FOR_REASON: Record<FullSeasonScheduleRefreshReason, FullSeasonScheduleRefreshStatus> =
  {
    'refresh-in-progress': 'in-progress',
    'cfbd-api-key-missing': 'failure',
    'canonical-context-unavailable': 'failure',
    'partition-fetch-failed': 'failure',
    'partition-invalid-payload': 'failure',
    'partition-schema-drift': 'failure',
    'empty-replacement-rejected': 'failure',
    'durable-commit-failed': 'failure',
    'unexpected-error': 'failure',
    'empty-response': 'no-op',
    'stale-observation': 'no-op',
    'unchanged-clean': 'success',
    'written-clean': 'success',
  };

/**
 * Build a refresh result. The status and HTTP status are derived from the reason
 * (the single mapping every caller shares), so a reason can never be paired with
 * a contradictory status/HTTP code. A commit-store failure that is NOT the schedule
 * transaction (e.g. a lease-store outage) may pass `httpStatusOverride: 503`.
 */
export function fullSeasonScheduleRefreshResult(params: {
  reason: FullSeasonScheduleRefreshReason;
  requestedYear: number;
  attemptedSeasonTypes?: SeasonType[];
  failedSeasonTypes?: SeasonType[];
  rowsReceived?: number;
  rowsCommitted?: number;
  dataChanged?: boolean;
  scoreRepairs?: number;
  scoreDifferenceCount?: number;
  scoreDifferences?: FinalScoreDifferenceIdentity[];
  scoreDifferencesTruncated?: boolean;
  scoreSweepFailedPartitions?: Array<{ week: number; seasonType: SeasonType }>;
  kickoffsChanged?: number;
  providerCallAttempted?: boolean;
  observedAt?: string | null;
  committedAt?: string | null;
  items?: CacheEntry['items'];
  entry?: CacheEntry | null;
  httpStatusOverride?: FullSeasonScheduleRefreshResult['httpStatus'];
}): FullSeasonScheduleRefreshResult {
  return {
    status: STATUS_FOR_REASON[params.reason],
    reason: params.reason,
    httpStatus: params.httpStatusOverride ?? REASON_HTTP_STATUS[params.reason],
    requestedYear: params.requestedYear,
    attemptedSeasonTypes: params.attemptedSeasonTypes ?? [],
    failedSeasonTypes: params.failedSeasonTypes ?? [],
    rowsReceived: params.rowsReceived ?? 0,
    rowsCommitted: params.rowsCommitted ?? 0,
    dataChanged: params.dataChanged ?? false,
    scoreRepairs: params.scoreRepairs ?? 0,
    scoreDifferenceCount: params.scoreDifferenceCount ?? 0,
    scoreDifferences: params.scoreDifferences ?? [],
    scoreDifferencesTruncated: params.scoreDifferencesTruncated ?? false,
    scoreSweepFailedPartitions: params.scoreSweepFailedPartitions ?? [],
    kickoffsChanged: params.kickoffsChanged ?? 0,
    providerCallAttempted: params.providerCallAttempted ?? false,
    observedAt: params.observedAt ?? null,
    committedAt: params.committedAt ?? null,
    items: params.items ?? [],
    entry: params.entry ?? null,
  };
}

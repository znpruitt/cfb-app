/**
 * PLATFORM-086E2A — the ONE typed shared season rankings refresh-result contract.
 *
 * Every rankings refresher — the authorized manual `/api/rankings?bypassCache=1`
 * refresh today, and the PLATFORM-086E2B publication-aware cron later — drives the
 * shared authority (`refreshAuthority.ts`) and consumes THIS value to learn what
 * the refresh meant. Callers MUST read outcome truth from this typed result,
 * never re-derive it by reparsing an HTTP response or catching exceptions, so
 * manual and automatic callers can never diverge on "did the rankings change /
 * commit / fail".
 *
 * The status axis is small and total:
 *   - `in-progress` — a nonexpired durable lease already holds this year; the
 *                     losing caller made NO provider request and began no attempt.
 *   - `success`     — a complete aggregate was durably committed (fresh weeks
 *                     written, or unchanged content with newer observation
 *                     metadata).
 *   - `no-op`       — the provider validated but nothing authoritative was written
 *                     (a genuine pre-poll absence, or a stale observation that lost
 *                     to a fresher committed one). Never advances a fabricated
 *                     success.
 *   - `failure`     — a partition fetch/payload rejection, a prior-relative
 *                     completeness rejection, an empty replacement of populated
 *                     prior-good, or a durable store failure. Prior-good durable
 *                     rankings are retained and no success/cache is published —
 *                     with one honest caveat: a commit whose ACKNOWLEDGMENT was
 *                     lost (`durable-commit-failed`) may in fact have durably
 *                     applied; it is still reported as a failure (never a
 *                     fabricated success), the memo stays unpublished, and the
 *                     next refresh reconciles via observation ordering.
 *
 * The reason axis is a closed, stable, secret-free union. It NEVER carries a
 * request/response object, provider payload, environment value, credential, error
 * stack, or arbitrary error message.
 */

import type { RankingsResponse } from '../rankings.ts';

export type RankingsRefreshTrigger = 'manual' | 'automatic';

/** The two CFBD rankings partitions one season refresh always covers. */
export type RankingsSeasonType = 'regular' | 'postseason';

export type RankingsRefreshStatus = 'success' | 'no-op' | 'failure' | 'in-progress';

export type RankingsRefreshReason =
  // ---- success ----
  | 'written-clean' // fresh weeks were durably committed
  | 'unchanged-clean' // recomputed content equals prior-good; only observation metadata committed
  // ---- no-op (validated, nothing authoritative written) ----
  | 'empty-response' // a genuine pre-poll all-empty aggregate with no prior-good — no write
  | 'stale-observation' // this observation lost to a fresher committed one — no write
  // ---- in-progress (no provider request, no attempt) ----
  | 'refresh-in-progress' // a nonexpired durable lease already holds this year
  // ---- failure ----
  | 'store-unavailable' // the lease store or prior-state durable read failed (fails closed)
  | 'cfbd-api-key-missing' // CFBD_API_KEY absent (attempt begun, then resolved failed)
  | 'provider-fetch-failed' // a required partition fetch threw (transport/HTTP)
  | 'invalid-provider-payload' // a required partition returned a non-array top-level payload
  | 'rankings-partition-schema-drift' // a nonempty partition payload normalized to zero usable weeks
  | 'rankings-partition-incomplete' // the aggregate would lose prior-good weeks or populated poll sources
  | 'rankings-empty-replacement-rejected' // an all-empty aggregate over populated prior-good — rejected
  | 'durable-commit-failed' // the rankings-key commit transaction failed
  | 'unexpected-error'; // an unclassified internal error

export type RankingsRefreshResult = {
  status: RankingsRefreshStatus;
  reason: RankingsRefreshReason;
  /** HTTP status the authorized manual route returns for this outcome. */
  httpStatus: number;
  /** The season year the refresh targeted. */
  year: number;
  /** Which caller class drove this refresh (manual route vs E2B automation). */
  trigger: RankingsRefreshTrigger;
  /**
   * Partitions whose provider fetch this refresh actually started. Populated
   * (both partitions) exactly when `providerCallAttempted` flips true; EMPTY on
   * every pre-fetch exit — lease contention, store failure, missing credentials
   * — so a refusal never fabricates attempted partitions.
   */
  attemptedSeasonTypes: RankingsSeasonType[];
  /**
   * Partitions that caused a partition-level rejection: the uncertain partitions
   * on fetch/payload/drift failures, or the partitions whose prior-good coverage
   * the incoming aggregate would lose on `rankings-partition-incomplete`. Empty
   * for every other outcome.
   */
  failedSeasonTypes: RankingsSeasonType[];
  /**
   * Whether THIS refresh started the rankings provider-fetch stage. `false` for
   * every pre-provider exit — lease contention, store failure, missing CFBD
   * credentials; flips `true` immediately before the regular/postseason request
   * pair begins and REMAINS true after a transport, payload, completeness, or
   * commit failure. Callers consume this field directly — never re-derive it
   * from the reason.
   */
  providerCallAttempted: boolean;
  /**
   * Usable normalized weeks received across partitions that returned arrays —
   * counted per partition BEFORE the aggregate gate, so a partition that
   * returned rows still reports them when the sibling partition fails. Nothing
   * is committed from a rejected aggregate regardless.
   */
  rowsReceived: number;
  /** Weeks durably committed — nonzero only on `written-clean`. */
  rowsCommitted: number;
  /** Whether committed rankings CONTENT changed (false on `unchanged-clean`). */
  dataChanged: boolean;
  /**
   * The refresh's observation instant (ISO). For outcomes that reached the
   * provider-fetch stage this is captured immediately before the request pair
   * (and is the commit's observation-ordering timestamp); for pre-fetch exits it
   * is the acquisition instant captured immediately before lease acquisition.
   */
  observedAt: string;
  /** The confirmed durable commit instant (ISO) — set only when a write happened. */
  committedAt: string | null;
  /**
   * The rankings payload the manual route serves for this outcome: the freshly
   * committed response on success, the fresher committed response on
   * `stale-observation`, a clean empty response on a genuine `empty-response`
   * no-op, prior-good (stale-marked) on a retained rejection, or null when there
   * is nothing servable (the route returns an error body instead).
   */
  response: RankingsResponse | null;
};

/**
 * Default HTTP status per reason. Failure reasons surface as HTTP 500 — the
 * manual route historically mapped every thrown refresh error to 500, and E2A
 * preserves that public behavior. The three retained-capable rejections default
 * to 200 because they serve prior-good (stale-marked) rankings exactly as the
 * pre-E2A route did; when prior-good is ABSENT the builder receives
 * `httpStatusOverride: 500` (the only sanctioned divergence from this map).
 */
const REASON_HTTP_STATUS: Record<RankingsRefreshReason, number> = {
  'written-clean': 200,
  'unchanged-clean': 200,
  'empty-response': 200,
  'stale-observation': 200,
  'refresh-in-progress': 409,
  'store-unavailable': 500,
  'cfbd-api-key-missing': 500,
  'provider-fetch-failed': 500,
  'invalid-provider-payload': 500,
  'rankings-partition-schema-drift': 200,
  'rankings-partition-incomplete': 200,
  'rankings-empty-replacement-rejected': 200,
  'durable-commit-failed': 500,
  'unexpected-error': 500,
};

const STATUS_FOR_REASON: Record<RankingsRefreshReason, RankingsRefreshStatus> = {
  'written-clean': 'success',
  'unchanged-clean': 'success',
  'empty-response': 'no-op',
  'stale-observation': 'no-op',
  'refresh-in-progress': 'in-progress',
  'store-unavailable': 'failure',
  'cfbd-api-key-missing': 'failure',
  'provider-fetch-failed': 'failure',
  'invalid-provider-payload': 'failure',
  'rankings-partition-schema-drift': 'failure',
  'rankings-partition-incomplete': 'failure',
  'rankings-empty-replacement-rejected': 'failure',
  'durable-commit-failed': 'failure',
  'unexpected-error': 'failure',
};

/**
 * Build a refresh result. The status and HTTP status are derived from the reason
 * (the single mapping every caller shares), so a reason can never be paired with
 * a contradictory status/HTTP code — aside from the sanctioned
 * `httpStatusOverride: 500` when a retained-capable rejection has no prior-good
 * response to serve.
 */
export function rankingsRefreshResult(params: {
  reason: RankingsRefreshReason;
  year: number;
  trigger: RankingsRefreshTrigger;
  observedAt: string;
  attemptedSeasonTypes?: RankingsSeasonType[];
  failedSeasonTypes?: RankingsSeasonType[];
  providerCallAttempted?: boolean;
  rowsReceived?: number;
  rowsCommitted?: number;
  dataChanged?: boolean;
  committedAt?: string | null;
  response?: RankingsResponse | null;
  httpStatusOverride?: number;
}): RankingsRefreshResult {
  return {
    status: STATUS_FOR_REASON[params.reason],
    reason: params.reason,
    httpStatus: params.httpStatusOverride ?? REASON_HTTP_STATUS[params.reason],
    year: params.year,
    trigger: params.trigger,
    attemptedSeasonTypes: params.attemptedSeasonTypes ?? [],
    failedSeasonTypes: params.failedSeasonTypes ?? [],
    providerCallAttempted: params.providerCallAttempted ?? false,
    rowsReceived: params.rowsReceived ?? 0,
    rowsCommitted: params.rowsCommitted ?? 0,
    dataChanged: params.dataChanged ?? false,
    observedAt: params.observedAt,
    committedAt: params.committedAt ?? null,
    response: params.response ?? null,
  };
}

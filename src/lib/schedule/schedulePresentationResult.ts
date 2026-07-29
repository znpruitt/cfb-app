/**
 * PLATFORM-086E1C1 — the typed shared schedule-presentation refresh-result
 * contract.
 *
 * The presentation authority (`refreshSchedulePresentation`) refreshes TWO
 * independent parts — the year-wide game-media cache and the global venue
 * catalog — and returns one aggregate built from their two typed part results.
 * Callers read outcome truth from this value; they never re-derive it from HTTP
 * responses or reparsed logs.
 *
 * The reason axis is a closed, stable, secret-free union: it never carries a
 * request/response object, provider payload, environment value, credential,
 * error stack, or arbitrary error message.
 */

export type SchedulePresentationRefreshTrigger = 'manual' | 'weekly' | 'season-transition';

export type SchedulePresentationRefreshReason =
  | 'refresh-in-progress' // a nonexpired durable lease already holds this part
  | 'canonical-context-unavailable' // a genuine durable read failure (schedule context or prior part state)
  | 'no-eligible-games' // canonical schedule absent/empty — nothing to attach, no provider call
  | 'fresh-cache' // venue catalog younger than the TTL — no attempt, no provider call
  | 'cfbd-api-key-missing' // CFBD_API_KEY absent (attempt begun, then resolved failed)
  | 'provider-fetch-failed' // the provider request threw (transport/HTTP)
  | 'invalid-payload' // non-array payload, or conflicting venue rows for one id
  | 'schema-drift' // a nonempty payload normalized to zero structurally usable rows
  | 'empty-response' // an empty target result with no prior-good rows — no write
  | 'empty-replacement-rejected' // an empty target result over populated prior-good — rejected
  | 'stale-observation' // this observation lost to a fresher committed one — no write
  | 'unchanged-clean' // content unchanged; only observation metadata committed
  | 'written-clean' // fresh rows durably committed
  | 'durable-commit-failed' // the lease/commit durable store operation failed
  | 'unexpected-error'; // an unclassified internal error

export type SchedulePresentationPartStatus = 'success' | 'no-op' | 'failure' | 'in-progress';

export type SchedulePresentationPartResult = {
  status: SchedulePresentationPartStatus;
  reason: SchedulePresentationRefreshReason;
  providerCallAttempted: boolean;
  /** Structurally usable rows received from the provider (pre-eligibility-filter). */
  rowsReceived: number;
  /** Rows durably committed — nonzero only on `written-clean`. */
  rowsCommitted: number;
  dataChanged: boolean;
  observedAt: string | null;
  committedAt: string | null;
};

export type SchedulePresentationAggregateStatus =
  | 'success'
  | 'partial'
  | 'no-op'
  | 'failure'
  | 'in-progress';

export type SchedulePresentationRefreshResult = {
  status: SchedulePresentationAggregateStatus;
  trigger: SchedulePresentationRefreshTrigger;
  year: number;
  media: SchedulePresentationPartResult;
  venues: SchedulePresentationPartResult;
};

const STATUS_FOR_REASON: Record<SchedulePresentationRefreshReason, SchedulePresentationPartStatus> =
  {
    'refresh-in-progress': 'in-progress',
    'canonical-context-unavailable': 'failure',
    'no-eligible-games': 'no-op',
    'fresh-cache': 'no-op',
    'cfbd-api-key-missing': 'failure',
    'provider-fetch-failed': 'failure',
    'invalid-payload': 'failure',
    'schema-drift': 'failure',
    'empty-response': 'no-op',
    'empty-replacement-rejected': 'failure',
    'stale-observation': 'no-op',
    'unchanged-clean': 'success',
    'written-clean': 'success',
    'durable-commit-failed': 'failure',
    'unexpected-error': 'failure',
  };

/**
 * Build a part result. Status derives from the reason through the single shared
 * mapping, so a reason can never pair with a contradictory status.
 */
export function schedulePresentationPartResult(params: {
  reason: SchedulePresentationRefreshReason;
  providerCallAttempted?: boolean;
  rowsReceived?: number;
  rowsCommitted?: number;
  dataChanged?: boolean;
  observedAt?: string | null;
  committedAt?: string | null;
}): SchedulePresentationPartResult {
  return {
    status: STATUS_FOR_REASON[params.reason],
    reason: params.reason,
    providerCallAttempted: params.providerCallAttempted ?? false,
    rowsReceived: params.rowsReceived ?? 0,
    rowsCommitted: params.rowsCommitted ?? 0,
    dataChanged: params.dataChanged ?? false,
    observedAt: params.observedAt ?? null,
    committedAt: params.committedAt ?? null,
  };
}

/**
 * The aggregate over the two part results — derived ONLY from the typed parts:
 *   1. any failure + any non-failure → `partial`;
 *   2. both failed → `failure`;
 *   3. no failure, ≥1 success → `success`;
 *   4. no failure/success, all in-progress → `in-progress`;
 *   5. otherwise → `no-op`.
 */
export function aggregateSchedulePresentationStatus(
  parts: readonly SchedulePresentationPartStatus[]
): SchedulePresentationAggregateStatus {
  const hasFailure = parts.includes('failure');
  const hasNonFailure = parts.some((part) => part !== 'failure');
  if (hasFailure && hasNonFailure) return 'partial';
  if (hasFailure) return 'failure';
  if (parts.includes('success')) return 'success';
  if (parts.length > 0 && parts.every((part) => part === 'in-progress')) return 'in-progress';
  return 'no-op';
}

export function schedulePresentationRefreshResult(params: {
  trigger: SchedulePresentationRefreshTrigger;
  year: number;
  media: SchedulePresentationPartResult;
  venues: SchedulePresentationPartResult;
}): SchedulePresentationRefreshResult {
  return {
    status: aggregateSchedulePresentationStatus([params.media.status, params.venues.status]),
    trigger: params.trigger,
    year: params.year,
    media: params.media,
    venues: params.venues,
  };
}

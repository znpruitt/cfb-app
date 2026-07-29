/**
 * PLATFORM-086E1C1 — the secret-safe, machine-readable runtime event emitted
 * exactly once per invocation of the schedule-presentation refresh authority.
 *
 * Mirrors the cron execution logs: this module owns the logging POLICY and
 * records ONLY the allowlisted operational primitives below — never a request
 * object, response body, thrown error, provider payload, URL, header,
 * credential, or environment value. The authority emits from ONE outer
 * `finally`, so every controlled outcome and unexpected exception produces one
 * line. Emission is best-effort: a serialization or console failure never
 * changes the authority result or HTTP behavior.
 */

import type {
  SchedulePresentationAggregateStatus,
  SchedulePresentationPartResult,
  SchedulePresentationPartStatus,
  SchedulePresentationRefreshReason,
  SchedulePresentationRefreshTrigger,
} from './schedulePresentationResult.ts';

type SchedulePresentationPartEvent = {
  result: SchedulePresentationPartStatus;
  reason: SchedulePresentationRefreshReason;
  providerCallAttempted: boolean;
  rowsReceived: number;
  rowsCommitted: number;
  dataChanged: boolean;
};

/** The exact allowlisted shape serialized to a single log line. */
export type SchedulePresentationRefreshEvent = {
  event: 'schedule-presentation-refresh';
  trigger: SchedulePresentationRefreshTrigger;
  year: number;
  result: SchedulePresentationAggregateStatus;
  media: SchedulePresentationPartEvent;
  venues: SchedulePresentationPartEvent;
  durationMs: number;
};

function toPartEvent(part: SchedulePresentationPartResult): SchedulePresentationPartEvent {
  // Explicit per-field copy so an accidentally attached extra property can
  // never leak into the serialized line.
  return {
    result: part.status,
    reason: part.reason,
    providerCallAttempted: part.providerCallAttempted,
    rowsReceived: part.rowsReceived,
    rowsCommitted: part.rowsCommitted,
    dataChanged: part.dataChanged,
  };
}

/**
 * Emit exactly one single-line structured event. Best-effort: any failure here
 * is swallowed so it can neither alter the authority result nor replace an
 * in-flight thrown error.
 */
export function emitSchedulePresentationRefreshEvent(params: {
  trigger: SchedulePresentationRefreshTrigger;
  year: number;
  result: SchedulePresentationAggregateStatus;
  media: SchedulePresentationPartResult;
  venues: SchedulePresentationPartResult;
  startedAtMs: number;
}): void {
  try {
    const event: SchedulePresentationRefreshEvent = {
      event: 'schedule-presentation-refresh',
      trigger: params.trigger,
      year: params.year,
      result: params.result,
      media: toPartEvent(params.media),
      venues: toPartEvent(params.venues),
      durationMs: Math.max(0, Math.round(Date.now() - params.startedAtMs)),
    };
    console.log(JSON.stringify(event));
  } catch {
    // Observability is best-effort — never surface a logging fault to the caller.
  }
}

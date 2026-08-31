import type { QuotaRefusalReason } from '../gameStats/quotaPolicy.ts';
import type { TeamRecordsRefreshReason } from './teamRecordsRefresh.ts';

/** Secret-safe execution vocabulary for the hourly team-records QStash job. */
export type TeamRecordsCronExecutionResult = 'skipped' | 'success' | 'no-op' | 'failure';

export type TeamRecordsCronExecutionReason =
  | 'cron-secret-not-configured'
  | 'cron-authorization-invalid'
  | `quota-${QuotaRefusalReason}`
  | TeamRecordsRefreshReason;

export type TeamRecordsCronExecutionEvent = {
  event: 'team-records-cron';
  result: TeamRecordsCronExecutionResult;
  reason: TeamRecordsCronExecutionReason;
  year: number;
  quotaChecked: boolean;
  providerCallAttempted: boolean;
  rowsReceived: number;
  rowsCommitted: number;
  durationMs: number;
};

export type TeamRecordsCronExecutionState = Omit<
  TeamRecordsCronExecutionEvent,
  'event' | 'durationMs'
>;

export function createTeamRecordsCronExecutionState(year: number): TeamRecordsCronExecutionState {
  return {
    result: 'failure',
    reason: 'unexpected-error',
    year,
    quotaChecked: false,
    providerCallAttempted: false,
    rowsReceived: 0,
    rowsCommitted: 0,
  };
}

export function emitTeamRecordsCronExecutionEvent(
  state: TeamRecordsCronExecutionState,
  startedAtMs: number
): void {
  try {
    const event: TeamRecordsCronExecutionEvent = {
      event: 'team-records-cron',
      result: state.result,
      reason: state.reason,
      year: state.year,
      quotaChecked: state.quotaChecked,
      providerCallAttempted: state.providerCallAttempted,
      rowsReceived: state.rowsReceived,
      rowsCommitted: state.rowsCommitted,
      durationMs: Math.max(0, Math.round(Date.now() - startedAtMs)),
    };
    console.log(JSON.stringify(event));
  } catch {
    // Observability is best-effort and can never change the cron response.
  }
}

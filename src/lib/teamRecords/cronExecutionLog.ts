import type { TeamRecordsRefreshReason } from './teamRecordsRefresh.ts';

/** Secret-safe runtime event for the independent hourly team-records job. */
export type TeamRecordsCronExecutionResult =
  | 'skipped'
  | 'success'
  | 'no-op'
  | 'failure'
  | 'in-progress';

export type TeamRecordsCronExecutionReason =
  | 'cron-secret-not-configured'
  | 'cron-authorization-invalid'
  | TeamRecordsRefreshReason;

export type TeamRecordsCronExecutionState = {
  result: TeamRecordsCronExecutionResult;
  reason: TeamRecordsCronExecutionReason;
  year: number;
  quotaChecked: boolean;
  quotaRemaining: number | null;
  providerCallAttempted: boolean;
  rowsCommitted: number;
};

export function createTeamRecordsCronExecutionState(year: number): TeamRecordsCronExecutionState {
  return {
    result: 'failure',
    reason: 'unexpected-error',
    year,
    quotaChecked: false,
    quotaRemaining: null,
    providerCallAttempted: false,
    rowsCommitted: 0,
  };
}

export function emitTeamRecordsCronExecutionEvent(
  state: TeamRecordsCronExecutionState,
  startedAtMs: number
): void {
  try {
    console.log(
      JSON.stringify({
        event: 'team-records-cron',
        result: state.result,
        reason: state.reason,
        year: state.year,
        quotaChecked: state.quotaChecked,
        quotaRemaining: state.quotaRemaining,
        providerCallAttempted: state.providerCallAttempted,
        rowsCommitted: state.rowsCommitted,
        durationMs: Math.max(0, Math.round(Date.now() - startedAtMs)),
      })
    );
  } catch {
    // Observability is best-effort and must never alter the route outcome.
  }
}

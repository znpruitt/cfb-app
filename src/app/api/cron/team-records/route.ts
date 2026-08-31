import { NextResponse } from 'next/server';

import { fetchCfbdUsage } from '@/lib/api/cfbdUsage';
import { evaluateAutomationQuota } from '@/lib/gameStats/quotaPolicy';
import { seasonYearForToday } from '@/lib/scores/normalizers';
import {
  createSchedulerInvocationId,
  scheduleSchedulerExecutionReceipt,
} from '@/lib/server/schedulerExecutionStatus';
import {
  createTeamRecordsCronExecutionState,
  emitTeamRecordsCronExecutionEvent,
  type TeamRecordsCronExecutionResult,
} from '@/lib/teamRecords/cronExecutionLog';
import {
  refreshTeamRecords,
  type TeamRecordsRefreshReason,
} from '@/lib/teamRecords/teamRecordsRefresh';

export const dynamic = 'force-dynamic';

const NO_OP_REASONS: ReadonlySet<TeamRecordsRefreshReason> = new Set([
  'fresh-cache',
  'provider-call-floor-active',
  'empty-response',
  'stale-observation',
  'unchanged-clean',
]);

function verifyCronSecret(req: Request): 'ok' | 'not-configured' | 'invalid' {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) return 'not-configured';
  return req.headers.get('authorization') === `Bearer ${cronSecret}` ? 'ok' : 'invalid';
}

function resultForReason(reason: TeamRecordsRefreshReason): TeamRecordsCronExecutionResult {
  if (reason === 'written-clean') return 'success';
  if (reason === 'automation-paused-or-disabled') return 'skipped';
  if (reason === 'refresh-in-progress') return 'in-progress';
  if (NO_OP_REASONS.has(reason)) return 'no-op';
  return 'failure';
}

function statusForReason(reason: TeamRecordsRefreshReason): number {
  if (reason.startsWith('quota-')) return 429;
  if (
    reason === 'provider-fetch-failed' ||
    reason === 'invalid-payload' ||
    reason === 'schema-drift' ||
    reason === 'empty-replacement-rejected'
  ) {
    return 502;
  }
  if (
    reason === 'settings-unavailable' ||
    reason === 'cache-read-failed' ||
    reason === 'durable-commit-failed'
  ) {
    return 503;
  }
  if (reason === 'cfbd-api-key-missing' || reason === 'unexpected-error') return 500;
  return 200;
}

/** Hourly heartbeat; the shared authority decides whether `/records` is due. */
export async function GET(req: Request): Promise<Response> {
  const startedAtMs = Date.now();
  const year = seasonYearForToday(new Date(startedAtMs));
  const exec = createTeamRecordsCronExecutionState(year);
  let receiptInvocationId: string | null = null;

  try {
    const auth = verifyCronSecret(req);
    if (auth !== 'ok') {
      exec.reason =
        auth === 'not-configured' ? 'cron-secret-not-configured' : 'cron-authorization-invalid';
      return NextResponse.json(
        {
          error:
            auth === 'not-configured'
              ? 'CRON_SECRET is not configured; scheduled team-record refresh is disabled'
              : 'invalid cron authorization',
        },
        { status: 401 }
      );
    }
    receiptInvocationId = createSchedulerInvocationId();

    const refresh = await refreshTeamRecords({
      year,
      finalizationObserved: false,
      beforeProviderCall: async () => {
        exec.quotaChecked = true;
        try {
          const usage = await fetchCfbdUsage({ fresh: true });
          const decision = evaluateAutomationQuota({
            remainingCalls: usage.remaining,
            monthlyLimit: usage.limit,
          });
          exec.quotaRemaining = decision.remaining;
          return decision;
        } catch {
          exec.quotaRemaining = null;
          return { kind: 'refused', reason: 'usage-unavailable', remaining: null };
        }
      },
    });

    exec.reason = refresh.reason;
    exec.result = resultForReason(refresh.reason);
    exec.providerCallAttempted = refresh.providerCallAttempted;
    exec.rowsCommitted = refresh.rowsCommitted;
    return NextResponse.json(
      {
        result: exec.result,
        reason: exec.reason,
        year: exec.year,
        quotaChecked: exec.quotaChecked,
        quotaRemaining: exec.quotaRemaining,
        providerCallAttempted: exec.providerCallAttempted,
        rowsCommitted: exec.rowsCommitted,
      },
      { status: statusForReason(refresh.reason) }
    );
  } catch {
    return NextResponse.json(
      { result: exec.result, reason: exec.reason, year: exec.year },
      { status: 500 }
    );
  } finally {
    emitTeamRecordsCronExecutionEvent(exec, startedAtMs);
    if (receiptInvocationId !== null) {
      scheduleSchedulerExecutionReceipt({
        job: 'team-records',
        invocationId: receiptInvocationId,
        startedAtMs,
        result: exec.result,
        reason: exec.reason,
        providerCallAttempted: exec.providerCallAttempted,
        target: { kind: 'team-records', year: exec.year },
      });
    }
  }
}

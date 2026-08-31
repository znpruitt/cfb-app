import { NextResponse } from 'next/server';

import { fetchCfbdUsage } from '@/lib/api/cfbdUsage';
import { evaluateAutomationQuota, type CfbdUsageSnapshot } from '@/lib/gameStats/quotaPolicy';
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

function verifyCronSecret(req: Request): 'ok' | 'not-configured' | 'invalid' {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) return 'not-configured';
  return req.headers.get('authorization') === `Bearer ${cronSecret}` ? 'ok' : 'invalid';
}

function resultForRefresh(reason: TeamRecordsRefreshReason): TeamRecordsCronExecutionResult {
  if (reason === 'automation-paused-or-disabled' || reason === 'refresh-in-progress') {
    return 'skipped';
  }
  if (
    reason === 'fresh-cache' ||
    reason === 'empty-response' ||
    reason === 'stale-observation' ||
    reason === 'unchanged-clean'
  ) {
    return 'no-op';
  }
  return reason === 'written-clean' ? 'success' : 'failure';
}

export async function GET(req: Request) {
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

    exec.quotaChecked = true;
    let usageSnapshot: CfbdUsageSnapshot;
    try {
      const usage = await fetchCfbdUsage({ fresh: true });
      usageSnapshot = { remainingCalls: usage.remaining, monthlyLimit: usage.limit };
    } catch {
      usageSnapshot = { remainingCalls: null };
    }
    const quota = evaluateAutomationQuota(usageSnapshot);
    if (quota.kind === 'refused') {
      exec.reason = `quota-${quota.reason}`;
      return NextResponse.json({
        result: exec.result,
        reason: exec.reason,
        year,
        providerCallAttempted: false,
        rowsReceived: 0,
        rowsCommitted: 0,
        remaining: quota.remaining,
      });
    }

    const refresh = await refreshTeamRecords({ year, finalizationObserved: false });
    exec.result = resultForRefresh(refresh.reason);
    exec.reason = refresh.reason;
    exec.providerCallAttempted = refresh.providerCallAttempted;
    exec.rowsReceived = refresh.rowsReceived;
    exec.rowsCommitted = refresh.rowsCommitted;
    return NextResponse.json({ result: exec.result, year, ...refresh });
  } catch {
    return NextResponse.json({
      result: exec.result,
      reason: exec.reason,
      year,
      providerCallAttempted: exec.providerCallAttempted,
      rowsReceived: exec.rowsReceived,
      rowsCommitted: exec.rowsCommitted,
    });
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

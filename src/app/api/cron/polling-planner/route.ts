import { NextResponse } from 'next/server';

import { seasonYearForToday } from '@/lib/scores/normalizers';
import { plannerWindows } from '@/lib/schedule/pollingPlanner';
import { resolvePlanningDayStartMs } from '@/lib/schedule/pollingPlanner';
import { plannedRunsPerDay } from '@/lib/schedule/pollingCron';
import {
  createPollingPlannerCronExecutionState,
  emitPollingPlannerCronExecutionEvent,
  type PollingPlannerCronExecutionState,
} from '@/lib/schedule/pollingPlannerCronLog';
import { loadCachedScheduleItems } from '@/lib/server/canonicalScheduleCache';
import { applySchedule, desiredJobState } from '@/lib/server/pollingPlannerApply';
import {
  buildPollingPlannerRun,
  recordPollingPlannerRun,
  type PlannerScheduleRun,
} from '@/lib/server/pollingPlannerRecord';
import {
  PLANNER_OWNED_JOBS,
  pollingCronPlanForJob,
  type PlannerOwnedJob,
} from '@/lib/server/schedulerDeliveryHealth';
import {
  createSchedulerInvocationId,
  scheduleSchedulerExecutionReceipt,
} from '@/lib/server/schedulerExecutionStatus';

import { PLANNER_JOB_CONTRACTS } from '../../../../../scripts/lib/plannerScheduleContracts.ts';

export const dynamic = 'force-dynamic';

/**
 * PLATFORM-102 slice 4 — the polling-window planner. THE SWITCH.
 *
 * Slices 1 to 3b built window derivation, cron synthesis, the durable record and
 * a delivery-health reader, and shipped every one of them dormant. This route is
 * the first thing that writes a planner record and the first thing that takes
 * ownership of a live QStash schedule. It is NOT dormant.
 *
 * Once a day, at 23:50 UTC:
 *   1. derive the windows for the UTC day about to begin, from the canonical
 *      schedule cache;
 *   2. synthesize each planner-owned job's dense and slow expressions;
 *   3. bring the four schedules to the state the plan requires — upsert, pause,
 *      or leave alone;
 *   4. record what it derived and what became of each schedule.
 *
 * WHY IT PLANS TOMORROW. `resolvePlanningDayStartMs`, in full: a cron has no date
 * field, so yesterday's hour set fires again today until rewritten, and a
 * Saturday-night cluster's dense phase lands in Sunday hours a Saturday
 * expression does not contain.
 *
 * WHY IT NEVER READS THE PLANNER RECORD. It derives its plan from the canonical
 * schedule and writes THAT. Reading its own last output to choose its next one is
 * a feedback loop where a fresh derivation belongs, and it would deadlock the
 * very first run, which has no record to read. `readRecordedIntent` is optional on
 * `RunDeps` precisely so this caller can decline it — and the operator CLI, which
 * has no plan, is the caller that supplies one.
 *
 * WHY THE HANDLER GUARDS ARE UNTOUCHED. The cron decides when the route WAKES;
 * the guards inside `live-scores` and `game-stats` decide whether a provider call
 * happens. This slice buys Active CPU, not correctness, and it must never become
 * the only quota or correctness protection — so a planner mistake costs wakeups
 * in the safe direction and nothing else.
 */

type PollingPlannerResult = {
  day: string | null;
  schedulesApplied: number;
  schedulesUnchanged: number;
  schedulesFailed: number;
  recordsNotWritten: number;
  error?: string;
};

function verifyCronSecret(req: Request): 'ok' | 'not-configured' | 'invalid' {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) return 'not-configured';
  const authHeader = req.headers.get('authorization') ?? '';
  return authHeader === `Bearer ${cronSecret}` ? 'ok' : 'invalid';
}

/** One job's two schedules, brought to their planned state and folded into one row. */
async function planOneJob(
  job: PlannerOwnedJob,
  input: { windows: ReturnType<typeof plannerWindows>; dayStartMs: number; at: Date },
  exec: PollingPlannerCronExecutionState,
  invocationId: string | null
): Promise<void> {
  const contracts = PLANNER_JOB_CONTRACTS[job];
  const plan = pollingCronPlanForJob(job, {
    windows: input.windows.windows,
    dayStartMs: input.dayStartMs,
  });
  const desired = desiredJobState(plan, input.windows.windows, input.dayStartMs);
  const deps = { env: process.env, fetchImpl: nativeFetch };

  // SEQUENTIAL, not `Promise.all`. Both schedules of a job hit the same QStash
  // management API with the same credential, and a planner that fires four
  // mutations at once has no ordering to reason about when one of them returns a
  // rate limit. Four requests once a day is not a latency problem.
  const dense = await applySchedule(contracts.dense, desired.dense, deps);
  const slow = await applySchedule(contracts.slow, desired.slow, deps);

  for (const applied of [dense, slow]) {
    if (applied.outcome === 'confirmed') exec.schedulesApplied += 1;
    else if (applied.outcome === 'unchanged') exec.schedulesUnchanged += 1;
    else exec.schedulesFailed += 1;
  }
  exec.plannedRuns += plannedRunsPerDay(plan).total;

  // The slow schedule is always armed, so its row always exists. A paused DENSE
  // schedule is recorded as `dense: null` — the store's one encoding of "not
  // expected to fire", which `installedState` reads as `silent`, which contributes
  // no required slot and so cannot raise a false alarm.
  const slowRun: PlannerScheduleRun | null = slow.run;
  if (slowRun === null) {
    // Unreachable while `desiredJobState` keeps slow armed on every day; if that
    // ever changes, the record cannot express it and the run must not be written
    // half-formed. Counted as a failure rather than silently skipped.
    exec.recordsNotWritten += 1;
    return;
  }

  const outcome = await recordPollingPlannerRun(
    job,
    buildPollingPlannerRun({
      at: input.at,
      invocationId,
      dayStartMs: input.dayStartMs,
      windows: input.windows.windows,
      dense: dense.run,
      slow: slowRun,
    })
  );
  // `recorded` is the only outcome that leaves delivery health able to judge these
  // schedules. Everything else — including `indeterminate`, which is not rounded
  // to either side — means the row may be missing, and the NEWEST row is the one
  // that says what is in force now.
  if (outcome !== 'recorded') exec.recordsNotWritten += 1;
}

const nativeFetch = async (
  url: string,
  init: { method: string; headers: Record<string, string> }
): Promise<{ status: number; json: () => Promise<unknown> }> => {
  const res = await fetch(url, { method: init.method, headers: init.headers, cache: 'no-store' });
  return { status: res.status, json: () => res.json() };
};

export async function GET(req: Request): Promise<NextResponse<PollingPlannerResult>> {
  const startedAtMs = Date.now();
  const exec = createPollingPlannerCronExecutionState();
  let receiptInvocationId: string | null = null;

  try {
    const authResult = verifyCronSecret(req);
    if (authResult !== 'ok') {
      exec.result = 'failure';
      exec.reason =
        authResult === 'not-configured'
          ? 'cron-secret-not-configured'
          : 'cron-authorization-invalid';
      return NextResponse.json(
        {
          day: null,
          schedulesApplied: 0,
          schedulesUnchanged: 0,
          schedulesFailed: 0,
          recordsNotWritten: 0,
          error:
            authResult === 'not-configured'
              ? 'CRON_SECRET is not configured on the server — set it in Vercel environment variables'
              : 'unauthorized: Bearer token did not match CRON_SECRET',
        },
        { status: 401 }
      );
    }
    // Identity is created ONLY after authentication — an unauthenticated request
    // must not create or advance a receipt.
    receiptInvocationId = createSchedulerInvocationId();

    const at = new Date(startedAtMs);
    const dayStartMs = resolvePlanningDayStartMs(startedAtMs);
    exec.day = new Date(dayStartMs).toISOString().slice(0, 10);

    // The season year of the DAY BEING PLANNED, not of `now`. They differ across
    // the New Year boundary, where a 31 December run plans 1 January and the bowl
    // games on it are filed under the previous season.
    const year = seasonYearForToday(new Date(dayStartMs));
    let rows;
    try {
      rows = await loadCachedScheduleItems(year);
    } catch {
      // FAIL CLOSED. An empty window list is a legitimate plan for a dead day, so
      // an unreadable schedule read as one would PAUSE dense polling on a live
      // game day. Leaving yesterday's schedules installed over-covers, which is
      // the safe direction, and tomorrow's run repairs it.
      exec.result = 'failure';
      exec.reason = 'schedule-unreadable';
      return NextResponse.json({
        day: exec.day,
        schedulesApplied: 0,
        schedulesUnchanged: 0,
        schedulesFailed: 0,
        recordsNotWritten: 0,
        error: 'the canonical schedule could not be read — no plan was derived, nothing was sent',
      });
    }

    const windows = plannerWindows(rows);
    exec.unconfirmedKickoffs = windows.unconfirmedKickoffs;

    for (const job of PLANNER_OWNED_JOBS) {
      await planOneJob(job, { windows, dayStartMs, at }, exec, receiptInvocationId);
    }

    const failed = exec.schedulesFailed + exec.recordsNotWritten;
    if (failed === 0) {
      exec.result = 'success';
      // A day where every schedule was ALREADY right is the modal outcome once the
      // season settles, and it is a success rather than a `no-op`: the planner
      // read live state and confirmed it, which is work whose absence matters.
      exec.reason = exec.schedulesApplied > 0 ? 'plan-applied' : 'plan-unchanged';
    } else if (exec.schedulesApplied + exec.schedulesUnchanged > 0) {
      exec.result = 'partial';
      exec.reason = 'plan-partially-applied';
    } else {
      exec.result = 'failure';
      exec.reason = 'plan-not-applied';
    }

    // 200 even on a partial. QStash retries a non-2xx, and a retried planner run
    // would re-derive the same day and re-send the same idempotent mutations —
    // useful only if the failure was transient, and indistinguishable from a
    // credential fault, which retrying cannot fix. The receipt carries the truth.
    return NextResponse.json({
      day: exec.day,
      schedulesApplied: exec.schedulesApplied,
      schedulesUnchanged: exec.schedulesUnchanged,
      schedulesFailed: exec.schedulesFailed,
      recordsNotWritten: exec.recordsNotWritten,
    });
  } finally {
    emitPollingPlannerCronExecutionEvent(exec, startedAtMs);
    if (receiptInvocationId !== null) {
      scheduleSchedulerExecutionReceipt({
        job: 'polling-planner',
        invocationId: receiptInvocationId,
        startedAtMs,
        result: exec.result,
        reason: exec.reason,
        // The planner talks to QStash management, never to a data provider. This
        // flag means a BILLED provider call, and this route makes none — ever.
        providerCallAttempted: false,
        target: {
          kind: 'polling-planner',
          day: exec.day,
          schedulesApplied: exec.schedulesApplied,
          schedulesUnchanged: exec.schedulesUnchanged,
          schedulesFailed: exec.schedulesFailed,
          recordsNotWritten: exec.recordsNotWritten,
        },
      });
    }
  }
}

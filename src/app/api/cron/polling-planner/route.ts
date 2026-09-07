import { NextResponse } from 'next/server';

import { seasonYearForToday } from '@/lib/scores/normalizers';
import { plannerWindows } from '@/lib/schedule/pollingPlanner';
import { resolvePlanningDayStartMs } from '@/lib/schedule/pollingPlanner';
import {
  createPollingPlannerCronExecutionState,
  emitPollingPlannerCronExecutionEvent,
  type PollingPlannerCronExecutionState,
} from '@/lib/schedule/pollingPlannerCronLog';
import { loadCachedScheduleItems } from '@/lib/server/canonicalScheduleCache';
import {
  applySchedule,
  denseDesiredForCutover,
  desiredJobState,
  plannedFiringsFor,
} from '@/lib/server/pollingPlannerApply';
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

/**
 * How many times the season read is retried inside one invocation.
 *
 * The planner runs once a day with `retries: 0` on its own QStash schedule, and
 * `AGENTS.md` forbids answering a controlled outcome with a non-200 on a
 * QStash-delivered route — so the delivery layer cannot retry this for us. A
 * transient store blip would therefore cost a whole day of planning. Retrying the
 * read here is the bounded, in-invocation equivalent; a persistent absence still
 * ends as a loud no-op rather than a guess.
 */
const SCHEDULE_READ_ATTEMPTS = 3;
const SCHEDULE_READ_BACKOFF_MS = 250;

type PlanningSchedule =
  | { kind: 'usable'; windows: ReturnType<typeof plannerWindows> }
  /** The read threw on every attempt. */
  | { kind: 'unreadable' }
  /** The read succeeded and the season record yields no usable kickoff at all. */
  | { kind: 'unestablished' };

async function readPlanningSchedule(year: number): Promise<PlanningSchedule> {
  let threw = false;
  for (let attempt = 0; attempt < SCHEDULE_READ_ATTEMPTS; attempt += 1) {
    try {
      const rows = await loadCachedScheduleItems(year);
      const windows = plannerWindows(rows);
      // A SEASON WITH NO USABLE KICKOFF IS NOT A DEAD SEASON. `AGENTS.md`: "a
      // schedule is never committed empty", so an empty or unparseable season
      // record means the cache was never populated — the one input this planner
      // may not treat as evidence, because acting on it turns polling off.
      if (windows.plannedKickoffs > 0) return { kind: 'usable', windows };
      return { kind: 'unestablished' };
    } catch {
      threw = true;
      if (attempt < SCHEDULE_READ_ATTEMPTS - 1) {
        await new Promise((resolve) => setTimeout(resolve, SCHEDULE_READ_BACKOFF_MS));
      }
    }
  }
  return threw ? { kind: 'unreadable' } : { kind: 'unestablished' };
}

/** One job's two schedules, brought to their planned state and folded into one row. */
async function planOneJob(
  job: PlannerOwnedJob,
  input: {
    windows: ReturnType<typeof plannerWindows>;
    dayStartMs: number;
    at: Date;
    nowMs: number;
  },
  exec: PollingPlannerCronExecutionState,
  invocationId: string | null
): Promise<void> {
  const contracts = PLANNER_JOB_CONTRACTS[job];
  const allWindows = input.windows.windows;
  const plan = pollingCronPlanForJob(job, { windows: allWindows, dayStartMs: input.dayStartMs });
  const desired = desiredJobState(plan, allWindows, input.dayStartMs);
  const deps = { env: process.env, fetchImpl: nativeFetch };

  // THE CUTOVER CARRY. This run installs the expression for a day that has not
  // started, and a cron has no date field — so between now and midnight the NEW
  // hour set governs the OLD day. Any of today's dense hours still ahead of us are
  // folded in, or the swap goes dark over the tail of a live game.
  const todayStartMs = input.dayStartMs - 24 * 60 * 60 * 1000;
  const todayPlan = pollingCronPlanForJob(job, { windows: allWindows, dayStartMs: todayStartMs });
  const denseDesired = denseDesiredForCutover({
    plan,
    todayPlan,
    desired: desired.dense,
    nowMs: input.nowMs,
    todayStartMs,
  });

  // SEQUENTIAL, not `Promise.all`. Both schedules of a job hit the same QStash
  // management API with the same credential, and a planner that fires four
  // mutations at once has no ordering to reason about when one of them returns a
  // rate limit. Four requests once a day is not a latency problem.
  const dense = await applySchedule(contracts.dense, denseDesired, deps);
  const slow = await applySchedule(contracts.slow, desired.slow, deps);

  for (const applied of [dense, slow]) {
    // COUNTED BY WHETHER THE SCHEDULE REACHED ITS PLANNED STATE, not by the
    // record's cron outcome: a confirmed upsert whose resume failed is a schedule
    // that delivers nothing, and it must not be counted as applied.
    if (!applied.healthy) exec.schedulesFailed += 1;
    else if (applied.outcome === 'unchanged') exec.schedulesUnchanged += 1;
    else exec.schedulesApplied += 1;
  }
  // Counted from the DESIRED state, not the raw plan: `desiredJobState` overrides
  // the slow expression on an unarmed day, where `plan.slow` still carries all 24
  // hours. Reporting the plan's figure over-stated a quiet day by 24 firings per
  // job — in the one number this whole item is justified in.
  exec.plannedRuns += plannedFiringsFor(plan, denseDesired, desired.slow);

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
      // ONLY THE PLANNING DAY'S WINDOWS. `plannerWindows` derives over the whole
      // season on purpose (a pre-filter would move cluster boundaries), but the
      // RECORD is a description of one day's plan. Storing all of them measured
      // 479 windows and 46,014 bytes per run, which at the store's 400-run bound
      // is ~18 MB per job key — rewritten in a transaction every day and
      // re-parsed on every System Health render, of a field no consumer reads.
      windows: allWindows.filter(
        (window) =>
          window.startMs < input.dayStartMs + 24 * 60 * 60 * 1000 &&
          window.slowEndMs > input.dayStartMs
      ),
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
    const read = await readPlanningSchedule(year);
    if (read.kind !== 'usable') {
      // FAIL CLOSED, AND ABSENCE COUNTS AS UNREADABLE.
      //
      // The first version guarded only a THROWN read, which is the failure that
      // does not happen: `loadCachedScheduleItems` returns `[]` for a missing key
      // and never throws. So an absent or empty season cache reached
      // `plannerWindows([])`, which is byte-identical to a genuinely dead day —
      // and the planner PAUSED both dense schedules on the strength of a record it
      // had never read. Measured 2026-09-07: `schedule/2027-all-all` does not
      // exist, so "the planned year's key is absent" is a live state, not a
      // hypothetical. `AGENTS.md` settles the reading — a schedule is never
      // committed empty, so zero usable kickoffs means the record was never
      // established, never that the season has no games.
      //
      // NOTHING IS SENT. Leaving the live schedules exactly as they are is neutral
      // in both directions: mid-season they hold yesterday's armed hours, and in
      // the pre-season gap they hold whatever the offseason left. What is NOT
      // neutral is the residual case this does not close — a cache lost on a dead
      // day that precedes a game day leaves dense paused through it. That is an
      // operator-visible outage (the receipt below fails and the planner row goes
      // yellow the same night), not a silent one, and closing it further means
      // arming on an absence, which in the measured July case would spend the
      // month's allowance on a month with no games.
      exec.result = 'failure';
      exec.reason = 'schedule-unreadable';
      return NextResponse.json({
        day: exec.day,
        schedulesApplied: 0,
        schedulesUnchanged: 0,
        schedulesFailed: 0,
        recordsNotWritten: 0,
        error: `the canonical schedule for ${year} is ${read.kind} — no plan was derived, nothing was sent`,
      });
    }

    const windows = read.windows;
    exec.unconfirmedKickoffs = windows.unconfirmedKickoffs;

    for (const job of PLANNER_OWNED_JOBS) {
      await planOneJob(
        job,
        { windows, dayStartMs, at, nowMs: startedAtMs },
        exec,
        receiptInvocationId
      );
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
  } catch {
    // THE 200-ONLY INVARIANT, MADE TRUE BY CONSTRUCTION. This route's own comment
    // says a controlled outcome always answers 200 — `AGENTS.md` requires it of a
    // QStash-delivered route, because an at-least-once delivery layer must not read
    // a controlled refusal as a transport fault. A bare try/finally left that a
    // claim rather than a property: any unexpected throw escaped as a 5xx.
    //
    // `exec` is pessimistic by construction, so it already reads
    // `failure / unexpected-error` unless a later stage overwrote it; only the
    // reason is narrowed here, to say that nothing is known to have been applied.
    // No thrown value is inspected, logged or returned — a message can carry
    // anything, including a credential.
    exec.result = 'failure';
    exec.reason = 'plan-not-applied';
    return NextResponse.json({
      day: exec.day,
      schedulesApplied: exec.schedulesApplied,
      schedulesUnchanged: exec.schedulesUnchanged,
      schedulesFailed: exec.schedulesFailed,
      recordsNotWritten: exec.recordsNotWritten,
      error: 'the planner run did not complete — see the polling-planner receipt',
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

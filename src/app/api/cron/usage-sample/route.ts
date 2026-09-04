import { NextResponse } from 'next/server';

import { fetchCfbdUsage, type CfbdUsage } from '@/lib/api/cfbdUsage';
import {
  createUsageSampleCronExecutionState,
  emitUsageSampleCronExecutionEvent,
} from '@/lib/providerUsage/cronExecutionLog';
import { recordProviderUsageSample, utcDayOf } from '@/lib/server/providerUsageSeries';
import {
  createSchedulerInvocationId,
  scheduleSchedulerExecutionReceipt,
} from '@/lib/server/schedulerExecutionStatus';

export const dynamic = 'force-dynamic';

/**
 * Item 127 — the unconditional CFBD usage sample.
 *
 * WHY A DEDICATED ROUTE. This job has exactly one responsibility, and that is
 * the point. The sample was first attached to `season-transition`, the only
 * existing cron that runs unconditionally every day — and reverted, because that
 * route holds a deliberate guarantee that a refused run makes ZERO outbound
 * provider requests (`convergence.test.ts:1427`, `run.providerCalls === 0`), and
 * `route.test.ts` pins the exact partition set of every fetch it makes. `/info`
 * is unbilled, but that guarantee is about outbound requests, not billing.
 * Weakening a lifecycle route to carry another concern's bookkeeping is the wrong
 * trade; a route whose only contract is "one unbilled probe per run" violates
 * nothing.
 *
 * WHY UNGATED. Every other observation point is conditional. The game-stats probe
 * sits behind an exact-target gate, so it produces nothing on a quiet Tuesday —
 * which is precisely the day the series needs, since the question the series
 * exists to answer is what a Saturday costs BY COMPARISON. A sampler that only
 * fires on expensive days cannot answer it.
 *
 * WHY MORE OFTEN THAN DAILY. `used` is cumulative within the monthly period and
 * CFBD exposes no history, so the reading that matters most is the last one
 * before a reset — and whatever is missed there is lost permanently. Daily
 * sampling bounds that tail loss at 24 hours; six-hourly bounds it at six. The
 * probe is unbilled, so resolution is nearly free.
 *
 * NOT A PROVIDER SPEND. `/info` does not count against the CFBD quota. This route
 * never touches canonical data and never makes a billed call.
 */

type UsageSampleResult = {
  recorded: boolean;
  day: string | null;
  usage: CfbdUsage | null;
  error?: string;
};

function verifyCronSecret(req: Request): 'ok' | 'not-configured' | 'invalid' {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) return 'not-configured';
  const authHeader = req.headers.get('authorization') ?? '';
  return authHeader === `Bearer ${cronSecret}` ? 'ok' : 'invalid';
}

export async function GET(req: Request): Promise<NextResponse<UsageSampleResult>> {
  const startedAtMs = Date.now();
  const exec = createUsageSampleCronExecutionState();
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
          recorded: false,
          day: null,
          usage: null,
          error:
            authResult === 'not-configured'
              ? 'CRON_SECRET is not configured on the server — set it in Vercel environment variables'
              : 'unauthorized: Bearer token did not match CRON_SECRET',
        },
        { status: 401 }
      );
    }
    // Identity is created ONLY after authentication, never before — an
    // unauthenticated request must not create or advance a receipt.
    receiptInvocationId = createSchedulerInvocationId();

    const now = new Date();
    exec.day = utcDayOf(now);

    // An unreachable or malformed `/info` is a truthful all-null observation, not
    // a failure: "we looked and got nothing" is a fact worth keeping, and
    // `preferSample` guarantees it can never displace a usable reading already
    // recorded for the same day.
    let usage: CfbdUsage;
    try {
      usage = await fetchCfbdUsage({ fresh: true });
    } catch {
      usage = { patronLevel: null, used: null, remaining: null, limit: null };
    }
    // COMPLETE, not merely non-null. `used` and `limit` derive from `patronLevel`,
    // so a response carrying `remainingCalls` with an unusable tier yields both as
    // null — and `used` is the field the burn question reads. Calling that
    // "available" would file a green success receipt over a sample that cannot
    // answer what a day cost. Same criterion the series itself ranks by.
    exec.usageAvailable = usage.remaining !== null && usage.used !== null && usage.limit !== null;

    exec.recorded = await recordProviderUsageSample(usage, now);
    if (!exec.recorded) {
      // The observation is lost, but the run did what it could. `no-op` rather
      // than `failure`: nothing downstream depends on this write, and a failure
      // here would make the noisiest System Health row the least important one.
      exec.result = 'no-op';
      exec.reason = 'sample-write-failed';
    } else {
      // An unavailable probe is recorded but is NOT a success. `schedulerExecutionIssues`
      // (`systemHealthIssues.ts:442`) raises an issue only for `failure` and `partial`,
      // so reporting success here would let a rotated-away CFBD_API_KEY or a multi-day
      // provider outage produce an unbroken run of all-null samples behind a green
      // System Health row, with nothing to notice it. `partial` is the honest label:
      // the run did its job, the observation is empty.
      exec.result = exec.usageAvailable ? 'success' : 'partial';
      exec.reason = exec.usageAvailable ? 'sample-recorded' : 'sample-recorded-unavailable';
    }

    // 200 even when the durable write failed. This route is observation-only, and
    // a non-200 would make QStash retry a sample whose value is its timing — a
    // retried probe is a DIFFERENT observation, not a repair of the missed one.
    return NextResponse.json({ recorded: exec.recorded, day: exec.day, usage });
  } finally {
    emitUsageSampleCronExecutionEvent(exec, startedAtMs);
    if (receiptInvocationId !== null) {
      scheduleSchedulerExecutionReceipt({
        job: 'usage-sample',
        invocationId: receiptInvocationId,
        startedAtMs,
        result: exec.result,
        reason: exec.reason,
        // `/info` is not a billed CFBD call, so this job NEVER attempts provider
        // work in the sense this flag means. Always false, deliberately.
        providerCallAttempted: false,
        target: { kind: 'usage-sample', day: exec.day, recorded: exec.recorded },
      });
    }
  }
}

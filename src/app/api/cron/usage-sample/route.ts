import { NextResponse } from 'next/server';

import { fetchCfbdUsage, type CfbdUsage } from '@/lib/api/cfbdUsage';
import {
  createUsageSampleCronExecutionState,
  recordedFromWriteOutcome,
  emitUsageSampleCronExecutionEvent,
} from '@/lib/providerUsage/cronExecutionLog';
import {
  buildProviderUsageObservation,
  recordProviderUsageObservation,
} from '@/lib/server/providerUsageSeries';
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
  /**
   * `null` when a COMMIT or ROLLBACK failed after the mutation was submitted, so
   * durability is genuinely unknown. Never rounded to `false`, which asserts the
   * observation is durably absent.
   */
  recorded: boolean | null;
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

    // An unreachable or malformed `/info` is a truthful all-null observation, not
    // a failure: "we looked and got nothing" is a fact worth keeping, and the log
    // is append-only, so recording it cannot displace an earlier usable reading.
    let usage: CfbdUsage;
    try {
      usage = await fetchCfbdUsage({ fresh: true });
    } catch {
      usage = { patronLevel: null, used: null, remaining: null, limit: null };
    }
    // Stamped AFTER the probe settles, not before it. Capturing `now` ahead of the
    // await dates the observation earlier than it was taken, and `at` is the log's
    // only ordering key — a reading stamped early can sort before one taken before
    // it, which is what makes a falling counter appear to rise.
    const now = new Date();
    // Receipt metadata: which UTC day this run happened on. The series itself is
    // no longer bucketed by day — it stores raw observations — so this is the
    // receipt's own field, not a key into anything.
    exec.day = now.toISOString().slice(0, 10);

    // Build the observation FIRST, then read availability off it, so the gate and
    // the stored value are the same object by construction. Note what is NOT
    // consulted: `used`, which is DERIVED (`limit − remaining`) and null whenever
    // the tier is unknown — gating on it filed `partial` over a perfectly usable
    // `remaining`. Nor `limit`, which is FABRICATED for an unrecognised tier and
    // caused the same failure a round later. Usable means the provider reported a
    // trustworthy count, and nothing else.
    const observation = buildProviderUsageObservation(usage, now);
    exec.usageAvailable = observation.remaining !== null;

    const outcome = await recordProviderUsageObservation(observation);
    // TRI-STATE, carried intact to the response and the receipt. `null` is not a
    // decorative distinction: `false` renders as "not recorded" on System Health,
    // and an uncertain COMMIT must not produce that claim.
    exec.recorded = recordedFromWriteOutcome(outcome);
    if (outcome === 'unreadable') {
      // The stored series was PRESENT but unreadable, so the write was refused
      // rather than allowed to overwrite it with a single fresh entry. `partial`
      // makes it visible: this needs an operator to inspect the row, and every
      // subsequent run will refuse identically until they do.
      exec.result = 'partial';
      exec.reason = 'series-unreadable';
    } else if (outcome === 'indeterminate') {
      exec.result = 'partial';
      exec.reason = 'sample-write-indeterminate';
    } else if (outcome === 'not-recorded') {
      // `partial`, for the SAME reason the unavailable case is partial:
      // `schedulerExecutionIssues` raises an issue only for `failure` and
      // `partial`, so `no-op` here would let a persistently broken durable write
      // produce an unbroken run of green rows while the series silently stops
      // growing. That reasoning holds for a transient failure and fails for a
      // persistent one, which is the case worth seeing.
      exec.result = 'partial';
      exec.reason = 'sample-write-failed';
    } else {
      // An unavailable probe is recorded but is NOT a success. Reporting success
      // would let a rotated-away CFBD_API_KEY or a multi-day provider outage
      // produce an unbroken run of all-null samples behind a green row.
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

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  __resetAppStateForTests,
  __setAppStateWriteFailureForTests,
  getAppState,
  setAppState,
} from '@/lib/server/appStateStore';
import {
  PROVIDER_USAGE_SERIES_KEY,
  PROVIDER_USAGE_SERIES_SCOPE,
  readProviderUsageSeries,
} from '@/lib/server/providerUsageSeries';
import {
  __setSchedulerReceiptDeferrerForTests,
  SCHEDULER_EXECUTION_STATUS_SCOPE,
  type SchedulerExecutionReceipt,
} from '@/lib/server/schedulerExecutionStatus';

import { GET } from '../route';

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_SECRET = process.env.CRON_SECRET;
const ORIGINAL_KEY = process.env.CFBD_API_KEY;

// `__resetAppStateForTests` clears pools and test seams but NOT the backing
// file, so durable rows survive between tests in this file. Clear the series
// explicitly or each test inherits the previous one's samples.
async function reset(): Promise<void> {
  globalThis.fetch = ORIGINAL_FETCH;
  process.env.CRON_SECRET = 'test-secret';
  process.env.CFBD_API_KEY = 'test-key';
  __resetAppStateForTests();
  await setAppState(PROVIDER_USAGE_SERIES_SCOPE, PROVIDER_USAGE_SERIES_KEY, { samples: [] });
  // The receipt key persists the same way; a stale one from the previous test
  // would make "an unauthenticated run files NO receipt" pass or fail for the
  // wrong reason.
  await setAppState(SCHEDULER_EXECUTION_STATUS_SCOPE, 'usage-sample', null);
}

// The receipt is persisted through Next.js `after`; the deferrer seam is how
// every other cron route's tests drive it synchronously.
function installReceiptDeferrer(): { flush: () => Promise<void>; restore: () => void } {
  const callbacks: Array<() => Promise<void>> = [];
  __setSchedulerReceiptDeferrerForTests((callback) => callbacks.push(callback));
  return {
    flush: async () => {
      while (callbacks.length > 0) await callbacks.shift()!();
    },
    restore: () => __setSchedulerReceiptDeferrerForTests(null),
  };
}

async function readUsageSampleReceipt(): Promise<SchedulerExecutionReceipt | null> {
  return (
    (await getAppState<SchedulerExecutionReceipt>(SCHEDULER_EXECUTION_STATUS_SCOPE, 'usage-sample'))
      ?.value ?? null
  );
}

function authed(): Request {
  return new Request('https://turfwar.games/api/cron/usage-sample', {
    headers: { authorization: 'Bearer test-secret' },
  });
}

function stubInfo(body: unknown, seen?: string[]): void {
  globalThis.fetch = (async (input: URL | string) => {
    seen?.push(typeof input === 'string' ? input : input.toString());
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

test('an authenticated run records one sample from /info', async () => {
  await reset();
  const seen: string[] = [];
  stubInfo({ patronLevel: 1, remainingCalls: 4600 }, seen);

  const res = await GET(authed());
  const body = (await res.json()) as { recorded: boolean; day: string | null };

  assert.equal(res.status, 200);
  assert.equal(body.recorded, true);
  assert.equal(seen.length, 1, 'exactly one outbound request — the unbilled /info probe');
  assert.match(seen[0]!, /\/info/, 'and it is the info endpoint, not a billed dataset call');

  const series = await readProviderUsageSeries();
  assert.equal(series.samples.length, 1);
  assert.equal(series.samples[0]?.remaining, 4600);
  assert.equal(series.samples[0]?.limit, 5000, 'Tier 1 resolves the canonical limit');
  assert.equal(series.samples[0]?.used, 400, 'used is derived as limit − remaining');
  assert.equal(series.samples[0]?.day, body.day);
});

test('it is UNGATED — no season, target, or league state can suppress the sample', async () => {
  // The whole reason this route exists rather than riding an existing cron. The
  // durable store is empty: no leagues, no schedule, no polling target, no
  // season context. Every other observation point in the app would produce
  // nothing here.
  await reset();
  stubInfo({ patronLevel: 1, remainingCalls: 123 });

  const res = await GET(authed());

  assert.equal(res.status, 200);
  assert.equal((await res.json()).recorded, true, 'a sample is taken with no app state at all');
  assert.equal((await readProviderUsageSeries()).samples[0]?.remaining, 123);
});

test('an unauthenticated request records nothing and never calls the provider', async () => {
  await reset();
  const seen: string[] = [];
  stubInfo({ patronLevel: 1, remainingCalls: 4600 }, seen);

  const res = await GET(new Request('https://turfwar.games/api/cron/usage-sample'));

  assert.equal(res.status, 401);
  assert.equal(seen.length, 0, 'no outbound request before authentication');
  assert.equal((await readProviderUsageSeries()).samples.length, 0);
});

test('an unavailable probe reports PARTIAL, so a silent outage is visible', async () => {
  // System Health raises issues only for failure and partial. Reporting success
  // here would let a rotated-away CFBD_API_KEY or a multi-day provider outage
  // produce an unbroken run of all-null samples behind a green row.
  await reset();
  globalThis.fetch = (async () => {
    throw new Error('network down');
  }) as typeof fetch;

  const receipts = installReceiptDeferrer();
  await GET(authed());
  await receipts.flush();
  receipts.restore();

  const receipt = await readUsageSampleReceipt();
  assert.equal(receipt?.result, 'partial', 'not success — the observation is empty');
  assert.equal(receipt?.reason, 'sample-recorded-unavailable');
});

test('an unreachable provider still records a truthful all-null observation', async () => {
  // "We looked and got nothing" is a fact worth keeping — a GAP and a NULL are
  // different claims, and only one of them says the sampler ran.
  await reset();
  globalThis.fetch = (async () => {
    throw new Error('network down');
  }) as typeof fetch;

  const res = await GET(authed());

  assert.equal(res.status, 200, 'observation-only: a provider outage is not a cron failure');
  const series = await readProviderUsageSeries();
  assert.equal(series.samples.length, 1, 'the attempt is still recorded');
  assert.equal(series.samples[0]?.remaining, null, 'and it is null, never coerced to 0');
});

test('a later failed probe cannot destroy an earlier usable reading for the same day', async () => {
  // The end-to-end form of preferSample: six-hourly sampling means several
  // observations land on one day, and one bad one must not erase a good one.
  await reset();
  stubInfo({ patronLevel: 1, remainingCalls: 4600 });
  await GET(authed());

  globalThis.fetch = (async () => {
    throw new Error('network down');
  }) as typeof fetch;
  await GET(authed());

  const series = await readProviderUsageSeries();
  assert.equal(series.samples.length, 1, 'still one entry for the day');
  assert.equal(series.samples[0]?.remaining, 4600, 'the usable reading survived');
});

test('an authenticated run files a scheduler receipt like every other cron', async () => {
  // Item 126's gap, closed at creation rather than filed as a follow-up: without
  // this, "did the sampler run" would be unanswerable from System Health after
  // Vercel's runtime logs expire.
  await reset();
  stubInfo({ patronLevel: 1, remainingCalls: 4600 });

  const receipts = installReceiptDeferrer();
  await GET(authed());
  await receipts.flush();
  receipts.restore();

  const receipt = await readUsageSampleReceipt();
  assert.ok(receipt, 'a receipt is filed for an authenticated run');
  assert.equal(receipt.result, 'success');
  assert.equal(receipt.reason, 'sample-recorded');
  assert.equal(
    receipt.providerCallAttempted,
    false,
    '/info is unbilled — this job never claims provider work'
  );
  assert.deepEqual(receipt.target, {
    kind: 'usage-sample',
    day: receipt.target.kind === 'usage-sample' ? receipt.target.day : null,
    recorded: true,
  });
});

test('an unauthenticated run files NO receipt', async () => {
  // Identity is created only after authentication, so a rejected caller cannot
  // create or advance a receipt.
  await reset();
  stubInfo({ patronLevel: 1, remainingCalls: 4600 });

  const receipts = installReceiptDeferrer();
  await GET(new Request('https://turfwar.games/api/cron/usage-sample'));
  await receipts.flush();
  receipts.restore();

  assert.equal(await readUsageSampleReceipt(), null);
});

test('a failed durable write is a no-op with a stable reason, not a failure', async () => {
  await reset();
  stubInfo({ patronLevel: 1, remainingCalls: 4600 });
  __setAppStateWriteFailureForTests(new Error('durable down'), PROVIDER_USAGE_SERIES_SCOPE);

  const receipts = installReceiptDeferrer();
  const res = await GET(authed());
  __setAppStateWriteFailureForTests(null);
  await receipts.flush();
  receipts.restore();

  assert.equal(res.status, 200, 'observation-only: a lost sample is not a cron failure');
  const receipt = await readUsageSampleReceipt();
  assert.equal(receipt?.result, 'no-op');
  assert.equal(receipt?.reason, 'sample-write-failed');
});

test('teardown restores globals', () => {
  globalThis.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_SECRET === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIGINAL_SECRET;
  if (ORIGINAL_KEY === undefined) delete process.env.CFBD_API_KEY;
  else process.env.CFBD_API_KEY = ORIGINAL_KEY;
  assert.ok(true);
});

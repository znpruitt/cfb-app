import assert from 'node:assert/strict';
import test from 'node:test';

import { GET as cronGet } from '../route';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateReadFailureForTests,
  __setAppStateWriteFailureForTests,
  setAppState,
} from '../../../../../lib/server/appStateStore.ts';
import {
  __setUsageSampleDeferrerForTests,
  readProviderUsageSeries,
} from '../../../../../lib/server/providerUsageSeries.ts';
import { getGameStatsKey } from '../../../../../lib/gameStats/cache.ts';
import { seedActiveWriterControl } from '../../../../../lib/gameStats/__tests__/writerControlSeed.ts';
import { wireGame } from '../../../../../lib/gameStats/__tests__/fixtures.ts';
import { setGlobalPause } from '../../../../../lib/server/providerRefreshSettings.ts';
import {
  buildSchedulerExecutionReceipt,
  recordSchedulerExecutionReceipt,
} from '../../../../../lib/server/schedulerExecutionStatus.ts';
import {
  installSchedulerReceiptDeferrer,
  readSchedulerReceipt,
  RECEIPT_KEYS,
} from '../../../../../lib/server/__tests__/schedulerReceiptTestHarness.ts';
import type { GameStatsCronExecutionEvent } from '../../../../../lib/gameStats/cronExecutionLog.ts';

// PLATFORM-086F2E1 — durable execution receipts for the game-stats cron. The
// runtime event, response bodies, and provider/attempt semantics stay pinned by
// execution-logging.test.ts / coverage.test.ts / pause.test.ts unchanged; this
// suite proves ONLY the receipt contract.

const MUTABLE_ENV = process.env as Record<string, string | undefined>;
const ORIGINAL = {
  CRON_SECRET: process.env.CRON_SECRET,
  CFBD_API_KEY: process.env.CFBD_API_KEY,
  NODE_ENV: process.env.NODE_ENV,
};
const ORIGINAL_FETCH = globalThis.fetch;
const CRON_SECRET = 'test-cron-secret';
const H = 60 * 60 * 1000;

const YEAR = (() => {
  const d = new Date();
  const m = d.getUTCMonth();
  const y = d.getUTCFullYear();
  return m >= 6 ? y : y - 1;
})();

let deferrer: ReturnType<typeof installSchedulerReceiptDeferrer>;

function cronRequest(secret = CRON_SECRET): Request {
  return new Request('https://example.com/api/cron/game-stats', {
    headers: { authorization: `Bearer ${secret}` },
  });
}

async function seedWindowGame(week: number, seasonType: 'regular' | 'postseason', ageHours = 5) {
  await setAppState('schedule', `${YEAR}-all-all`, {
    at: Date.now(),
    partialFailure: false,
    failedSeasonTypes: [],
    items: [
      {
        id: '9001',
        week,
        seasonType,
        startDate: new Date(Date.now() - ageHours * H).toISOString(),
        neutralSite: false,
        conferenceGame: false,
        homeTeam: 'Alpha',
        awayTeam: 'Beta',
        homeId: 90011,
        awayId: 90012,
        homeConference: 'SEC',
        awayConference: 'Big Ten',
        status: 'STATUS_FINAL',
      },
    ],
  });
}

async function seedEmptyPartitionRecord(week: number, seasonType: 'regular' | 'postseason') {
  await setAppState('game-stats', getGameStatsKey(YEAR, week, seasonType), {
    year: YEAR,
    week,
    seasonType,
    fetchedAt: new Date().toISOString(),
    games: [],
  });
}

function stubProvider(payload: unknown, remainingCalls = 4000): void {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = url.includes('/info') ? { patronLevel: 1, remainingCalls } : payload;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

const persistableRow = () =>
  wireGame({
    id: 9001,
    home: { school: 'Alpha', teamId: 90011 },
    away: { school: 'Beta', teamId: 90012 },
  });

function installLogCapture(): { raw: string[]; restore: () => void } {
  const raw: string[] = [];
  const original = console.log;
  console.log = ((...args: unknown[]) => {
    raw.push(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
  }) as typeof console.log;
  return { raw, restore: () => void (console.log = original) };
}

function parseCronEvents(raw: string[]): GameStatsCronExecutionEvent[] {
  const out: GameStatsCronExecutionEvent[] = [];
  for (const line of raw) {
    try {
      const parsed = JSON.parse(line) as { event?: string };
      if (parsed?.event === 'game-stats-cron') out.push(parsed as GameStatsCronExecutionEvent);
    } catch {
      // Non-JSON console output — ignored.
    }
  }
  return out;
}

/** Run the cron once, capturing exactly one runtime event and tolerating a throw. */
async function runCron(req = cronRequest()): Promise<{
  res: Response | null;
  event: GameStatsCronExecutionEvent;
  threw: unknown;
}> {
  const cap = installLogCapture();
  let res: Response | null = null;
  let threw: unknown = null;
  try {
    res = await cronGet(req);
  } catch (error) {
    threw = error;
  } finally {
    cap.restore();
  }
  const events = parseCronEvents(cap.raw);
  assert.equal(events.length, 1, `exactly one game-stats-cron event (got ${events.length})`);
  return { res, event: events[0]!, threw };
}

test.beforeEach(async () => {
  MUTABLE_ENV.NODE_ENV = 'development';
  MUTABLE_ENV.CRON_SECRET = CRON_SECRET;
  MUTABLE_ENV.CFBD_API_KEY = 'test-cfbd-token';
  globalThis.fetch = ORIGINAL_FETCH;
  __setAppStateReadFailureForTests(null);
  __setAppStateWriteFailureForTests(null);
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  await seedActiveWriterControl();
  deferrer = installSchedulerReceiptDeferrer();
});

test.afterEach(() => {
  deferrer.restore();
  globalThis.fetch = ORIGINAL_FETCH;
  __setAppStateReadFailureForTests(null);
  __setAppStateWriteFailureForTests(null);
});

test.after(() => {
  for (const [key, value] of Object.entries(ORIGINAL)) {
    if (value === undefined) delete MUTABLE_ENV[key];
    else MUTABLE_ENV[key] = value;
  }
  globalThis.fetch = ORIGINAL_FETCH;
});

async function seedPriorReceipt() {
  const receipt = buildSchedulerExecutionReceipt({
    job: 'game-stats',
    invocationId: '88888888-8888-4888-8888-888888888888',
    startedAtMs: Date.now() - 60_000,
    completedAtMs: Date.now() - 59_000,
    result: 'success',
    reason: 'written-clean',
    providerCallAttempted: true,
    target: { kind: 'game-stats', year: YEAR, week: 3, seasonType: 'regular' },
  });
  assert.ok(receipt);
  await recordSchedulerExecutionReceipt(receipt);
  const stored = await readSchedulerReceipt('game-stats');
  assert.ok(stored);
  return stored;
}

test('missing and invalid cron authorization never create or advance a receipt', async () => {
  const before = await seedPriorReceipt();

  delete MUTABLE_ENV.CRON_SECRET;
  const missing = await runCron(cronRequest('anything'));
  assert.equal(missing.res!.status, 401);

  MUTABLE_ENV.CRON_SECRET = CRON_SECRET;
  const invalid = await runCron(cronRequest('wrong'));
  assert.equal(invalid.res!.status, 401);

  assert.equal(deferrer.count(), 0, 'no receipt scheduled on auth failure');
  await deferrer.flush();
  const after = await readSchedulerReceipt('game-stats');
  assert.deepEqual(after, before, 'the seeded prior receipt is preserved byte-equivalent');
});

test('an authenticated paused invocation writes the exact provider-free skip receipt', async () => {
  await setGlobalPause(true);
  await seedWindowGame(3, 'regular');
  const { res, event } = await runCron();
  assert.equal(res!.status, 200);
  assert.equal(event.reason, 'automation-paused-or-disabled');

  assert.equal(deferrer.count(), 1);
  await deferrer.flush();
  const stored = await readSchedulerReceipt('game-stats');
  assert.ok(stored);
  assert.deepEqual(Object.keys(stored.value).slice().sort(), RECEIPT_KEYS);
  assert.equal(stored.value.result, 'skipped');
  assert.equal(stored.value.reason, 'automation-paused-or-disabled');
  assert.equal(stored.value.providerCallAttempted, false);
  assert.deepEqual(stored.value.target, {
    kind: 'game-stats',
    year: YEAR,
    week: null,
    seasonType: null,
  });
});

test('a no-target invocation writes a healthy provider-free skip receipt', async () => {
  await seedWindowGame(3, 'regular', 2); // too fresh (<3h) → no in-window target
  stubProvider([]);
  const { res, event } = await runCron();
  assert.equal(res!.status, 200);
  assert.equal(event.reason, 'no-polling-target');

  await deferrer.flush();
  const stored = await readSchedulerReceipt('game-stats');
  assert.equal(stored?.value.result, 'skipped');
  assert.equal(stored?.value.reason, 'no-polling-target');
  assert.equal(stored?.value.providerCallAttempted, false);
  assert.deepEqual(stored?.value.target, {
    kind: 'game-stats',
    year: YEAR,
    week: null,
    seasonType: null,
  });
});

test('the quota probe observation is deferred into the usage series (Item 127)', async () => {
  // Without an injectable deferrer this path was unreachable: `after()` throws
  // outside a request scope and the call site swallows it, so every test here
  // exercised only the "deferral unavailable" branch and DELETING the call left
  // the suite green.
  const deferred: Array<() => Promise<void>> = [];
  __setUsageSampleDeferrerForTests((persist) => deferred.push(persist));
  try {
    await seedWindowGame(3, 'regular');
    await seedEmptyPartitionRecord(3, 'regular');
    stubProvider([persistableRow()]);

    const { res } = await runCron();
    assert.equal(res!.status, 200);
    assert.equal(deferred.length, 1, 'the sample is deferred, not awaited on the quota path');

    assert.equal(
      (await readProviderUsageSeries()).samples.length,
      0,
      'and nothing is written before the deferred callback runs'
    );
    await deferred[0]!();

    const series = await readProviderUsageSeries();
    assert.equal(series.samples.length, 1, 'the observation the quota gate read is retained');
    assert.equal(series.samples[0]?.remaining, 4000, 'and it is the value /info returned');
  } finally {
    __setUsageSampleDeferrerForTests(null);
  }
});

test('a provider-attempted clean write records the success receipt with the exact target', async () => {
  await seedWindowGame(3, 'regular');
  await seedEmptyPartitionRecord(3, 'regular');
  stubProvider([persistableRow()]);
  const { res, event } = await runCron();
  assert.equal(res!.status, 200);
  assert.equal(event.reason, 'written-clean');

  await deferrer.flush();
  const stored = await readSchedulerReceipt('game-stats');
  assert.equal(stored?.value.result, 'success');
  assert.equal(stored?.value.reason, 'written-clean');
  assert.equal(stored?.value.providerCallAttempted, true);
  assert.deepEqual(stored?.value.target, {
    kind: 'game-stats',
    year: YEAR,
    week: 3,
    seasonType: 'regular',
  });
});

test('a provider-fetch failure records failure with providerCallAttempted true', async () => {
  await seedWindowGame(3, 'regular');
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/info')) {
      return new Response(JSON.stringify({ patronLevel: 1, remainingCalls: 4000 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error('transport boom');
  }) as typeof fetch;
  const { res, event } = await runCron();
  assert.equal(res!.status, 500);
  assert.equal(event.reason, 'provider-fetch-failed');

  await deferrer.flush();
  const stored = await readSchedulerReceipt('game-stats');
  assert.equal(stored?.value.result, 'failure');
  assert.equal(stored?.value.reason, 'provider-fetch-failed');
  assert.equal(stored?.value.providerCallAttempted, true);
  assert.equal(stored?.value.target.kind, 'game-stats');
});

test('a receipt-store failure leaves the route response and runtime event unchanged', async () => {
  await seedWindowGame(3, 'regular', 2);
  stubProvider([]);
  __setAppStateWriteFailureForTests(new Error('receipt write boom'), 'scheduler-execution-status');
  const { res, event } = await runCron();
  assert.equal(res!.status, 200);
  assert.equal(event.result, 'skipped');
  assert.equal(event.reason, 'no-polling-target');
  await deferrer.flush();
  __setAppStateWriteFailureForTests(null);
  assert.equal(await readSchedulerReceipt('game-stats'), null);
});

test('an authenticated unexpected exception schedules failure/unexpected-error and still throws', async () => {
  // A settings-scope read failure makes isAutoRefreshAllowed throw AFTER auth —
  // an unhandled path reaching the finally with the pessimistic tracker.
  await seedWindowGame(3, 'regular');
  __setAppStateReadFailureForTests(new Error('settings read boom'), 'provider-refresh-settings');
  const { threw, event } = await runCron();
  __setAppStateReadFailureForTests(null);
  assert.ok(
    threw instanceof Error && threw.message === 'settings read boom',
    'the original exception propagates unchanged'
  );
  assert.equal(event.result, 'failure');
  assert.equal(event.reason, 'unexpected-error');

  assert.equal(deferrer.count(), 1, 'the authenticated invocation still schedules a receipt');
  await deferrer.flush();
  const stored = await readSchedulerReceipt('game-stats');
  assert.equal(stored?.value.result, 'failure');
  assert.equal(stored?.value.reason, 'unexpected-error');
  assert.equal(stored?.value.providerCallAttempted, false);
});

test('no credential, payload, or provider-error marker leaks into the receipt', async () => {
  const CRON_MARKER = 'sekret-cron-MARKER';
  const CFBD_MARKER = 'sekret-cfbd-MARKER';
  const PAYLOAD_MARKER = 'payload-MARKER';
  MUTABLE_ENV.CRON_SECRET = CRON_MARKER;
  MUTABLE_ENV.CFBD_API_KEY = CFBD_MARKER;
  await seedWindowGame(3, 'regular');
  stubProvider([{ marker: PAYLOAD_MARKER }]); // non-persistable → interpreter failure
  await runCron(cronRequest(CRON_MARKER));

  await deferrer.flush();
  const stored = await readSchedulerReceipt('game-stats');
  assert.ok(stored);
  const serialized = JSON.stringify(stored.value);
  for (const marker of [CRON_MARKER, CFBD_MARKER, PAYLOAD_MARKER]) {
    assert.ok(!serialized.includes(marker), `receipt never leaks ${marker}`);
  }
});

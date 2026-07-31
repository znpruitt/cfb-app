import assert from 'node:assert/strict';
import test from 'node:test';

import {
  installSchedulerReceiptDeferrer,
  readSchedulerReceipt,
  RECEIPT_KEYS,
} from '@/lib/server/__tests__/schedulerReceiptTestHarness';
import {
  __setAppStateReadFailureForTests,
  __setAppStateWriteFailureForTests,
} from '@/lib/server/appStateStore';
import { setGlobalPause } from '@/lib/server/providerRefreshSettings';
import {
  buildSchedulerExecutionReceipt,
  recordSchedulerExecutionReceipt,
} from '@/lib/server/schedulerExecutionStatus';

import {
  CRON_SECRET,
  MUTABLE_ENV,
  YEAR,
  cronRequest,
  resetForTest,
  restoreEnv,
  runCron,
  seedSchedule,
  stubProvider,
} from './harness';

// PLATFORM-086F2E1 — durable execution receipts for the live-scores cron. Every
// existing response/event/provider assertion lives in control.test.ts and
// polling.test.ts unchanged; this suite proves ONLY the receipt contract:
// auth-gated creation, verbatim tracker truth, bounded target, best-effort
// persistence, and secret-safety.

let deferrer: ReturnType<typeof installSchedulerReceiptDeferrer>;

test.beforeEach(async () => {
  await resetForTest();
  deferrer = installSchedulerReceiptDeferrer();
});

test.afterEach(() => {
  deferrer.restore();
  __setAppStateReadFailureForTests(null);
  __setAppStateWriteFailureForTests(null);
});

test.after(restoreEnv);

/** Seed a healthy prior receipt directly through the authority. */
async function seedPriorReceipt() {
  const receipt = buildSchedulerExecutionReceipt({
    job: 'live-scores',
    invocationId: '99999999-9999-4999-8999-999999999999',
    startedAtMs: Date.now() - 60_000,
    completedAtMs: Date.now() - 59_000,
    result: 'no-op',
    reason: 'scoreboard-unchanged-clean',
    providerCallAttempted: true,
    target: {
      kind: 'live-scores',
      year: YEAR,
      mode: 'scoreboard',
      targetGames: 1,
      targetPartitions: 1,
    },
  });
  assert.ok(receipt);
  await recordSchedulerExecutionReceipt(receipt);
  const stored = await readSchedulerReceipt('live-scores');
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

  assert.equal(deferrer.count(), 0, 'no receipt is scheduled on an auth failure');
  await deferrer.flush();
  const after = await readSchedulerReceipt('live-scores');
  assert.deepEqual(after, before, 'the seeded prior receipt is preserved byte-equivalent');
});

test('an authenticated paused invocation writes the exact provider-free skip receipt', async () => {
  await setGlobalPause(true);
  const { res, event } = await runCron();
  assert.equal(res!.status, 200);
  assert.equal(event.reason, 'automation-paused-or-disabled');

  assert.equal(deferrer.count(), 1, 'exactly one receipt scheduled');
  await deferrer.flush();
  const stored = await readSchedulerReceipt('live-scores');
  assert.ok(stored);
  assert.deepEqual(Object.keys(stored.value).slice().sort(), RECEIPT_KEYS);
  assert.equal(stored.value.version, 1);
  assert.equal(stored.value.job, 'live-scores');
  assert.equal(stored.value.source, 'qstash');
  assert.equal(stored.value.result, 'skipped');
  assert.equal(stored.value.reason, 'automation-paused-or-disabled');
  assert.equal(stored.value.providerCallAttempted, false);
  assert.deepEqual(stored.value.target, {
    kind: 'live-scores',
    year: YEAR,
    mode: null,
    targetGames: 0,
    targetPartitions: 0,
  });
  assert.ok(/^[0-9a-f-]{36}$/.test(stored.value.invocationId), 'application-generated UUID');
  assert.ok(Number.isInteger(stored.value.durationMs) && stored.value.durationMs >= 0);
  assert.ok(Number.isFinite(Date.parse(stored.value.startedAt)));
  assert.ok(Number.isFinite(Date.parse(stored.value.completedAt)));
});

test('a provider-attempted scoreboard run writes the success receipt with the exact target', async () => {
  await seedSchedule([{ id: 401001, week: 3, ageHours: 1, homeId: 333, awayId: 61 }]);
  stubProvider({
    scoreboard: [
      {
        id: 401001,
        status: 'in_progress',
        period: 2,
        clock: '05:00',
        homeTeam: { id: 333, name: 'Alabama', points: 14 },
        awayTeam: { id: 61, name: 'Georgia', points: 7 },
      },
    ],
  });
  const { res, event } = await runCron();
  assert.equal(res!.status, 200);
  assert.equal(event.reason, 'scoreboard-written-clean');

  await deferrer.flush();
  const stored = await readSchedulerReceipt('live-scores');
  assert.ok(stored);
  assert.equal(stored.value.result, 'success');
  assert.equal(stored.value.reason, 'scoreboard-written-clean');
  assert.equal(stored.value.providerCallAttempted, true);
  assert.deepEqual(stored.value.target, {
    kind: 'live-scores',
    year: YEAR,
    mode: 'scoreboard',
    targetGames: 1,
    targetPartitions: 1,
  });
});

test('a receipt-store failure leaves the response and runtime event unchanged', async () => {
  await setGlobalPause(true);
  __setAppStateWriteFailureForTests(new Error('receipt write boom'), 'scheduler-execution-status');
  const { res, event } = await runCron();
  assert.equal(res!.status, 200, 'the response is unchanged');
  assert.equal(event.result, 'skipped');
  assert.equal(event.reason, 'automation-paused-or-disabled');
  await deferrer.flush(); // must resolve harmlessly
  __setAppStateWriteFailureForTests(null);
  assert.equal(await readSchedulerReceipt('live-scores'), null, 'nothing was stored');
});

test('an authenticated unexpected exception schedules failure/unexpected-error and still throws', async () => {
  __setAppStateReadFailureForTests(new Error('settings read boom'), 'provider-refresh-settings');
  const { res, event, threw } = await runCron();
  __setAppStateReadFailureForTests(null);
  assert.equal(res, null, 'the handler threw');
  assert.ok(
    threw instanceof Error && threw.message === 'settings read boom',
    'the original exception propagates unchanged'
  );
  assert.equal(event.result, 'failure');
  assert.equal(event.reason, 'unexpected-error');

  assert.equal(deferrer.count(), 1, 'the authenticated invocation still schedules a receipt');
  await deferrer.flush();
  const stored = await readSchedulerReceipt('live-scores');
  assert.equal(stored?.value.result, 'failure');
  assert.equal(stored?.value.reason, 'unexpected-error');
  assert.equal(stored?.value.providerCallAttempted, false);
});

test('no credential, header, payload, or provider-error marker leaks into the receipt', async () => {
  const CRON_MARKER = 'sekret-cron-MARKER';
  const CFBD_MARKER = 'sekret-cfbd-MARKER';
  const PAYLOAD_MARKER = 'payload-MARKER';
  const ERROR_MARKER = 'provider-error-MARKER';
  MUTABLE_ENV.CRON_SECRET = CRON_MARKER;
  MUTABLE_ENV.CFBD_API_KEY = CFBD_MARKER;
  await seedSchedule([{ id: 401001, week: 3, ageHours: 1, homeId: 333, awayId: 61 }]);

  // Run A: a payload carrying a marker (normalizes to zero rows → schema drift).
  stubProvider({ scoreboard: [{ marker: PAYLOAD_MARKER }] });
  await runCron(cronRequest(CRON_MARKER));
  // Run B: a provider transport error whose message carries a marker.
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/info')) {
      return new Response(JSON.stringify({ patronLevel: 1, remainingCalls: 4000 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(ERROR_MARKER);
  }) as typeof fetch;
  await runCron(cronRequest(CRON_MARKER));

  await deferrer.flush();
  const stored = await readSchedulerReceipt('live-scores');
  assert.ok(stored, 'a receipt persisted');
  assert.equal(stored.value.providerCallAttempted, true);
  assert.ok(
    ['scoreboard-schema-drift', 'provider-fetch-failed'].includes(stored.value.reason),
    'the stored reason is one of the two runs’ stable literals'
  );
  const serialized = JSON.stringify(stored.value);
  for (const marker of [CRON_MARKER, CFBD_MARKER, PAYLOAD_MARKER, ERROR_MARKER]) {
    assert.ok(!serialized.includes(marker), `receipt never leaks ${marker}`);
  }
});

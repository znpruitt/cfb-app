import assert from 'node:assert/strict';
import test from 'node:test';

import { GET as scoresGet } from '@/app/api/scores/route';
import { weekPartitionScope, yearScope } from '@/lib/providerRefreshScope';
import { __setAppStateReadFailureForTests, setAppState } from '@/lib/server/appStateStore';
import { getProviderRefreshStatus } from '@/lib/server/providerRefreshStatus';
import { setGlobalPause } from '@/lib/server/providerRefreshSettings';

import { GET } from '../route';
import {
  YEAR,
  cronRequest,
  resetForTest,
  restoreEnv,
  runCron,
  seedSchedule,
  stubProvider,
} from './harness';

test.beforeEach(resetForTest);
test.after(restoreEnv);

// ---- Authentication (prompt case 1) ---------------------------------------

test('a missing CRON_SECRET returns 401 with one failure event and no provider/status work', async () => {
  delete (process.env as Record<string, string | undefined>).CRON_SECRET;
  const { urls } = stubProvider({});
  const { res, event } = await runCron();
  assert.equal(res!.status, 401);
  assert.equal(event.result, 'failure');
  assert.equal(event.reason, 'cron-secret-not-configured');
  assert.equal(event.quotaChecked, false);
  assert.equal(event.providerCallAttempted, false);
  assert.equal(urls.length, 0);
});

test('an invalid cron authorization returns 401 with one failure event', async () => {
  const { urls } = stubProvider({});
  const { res, event } = await runCron(cronRequest('wrong-secret'));
  assert.equal(res!.status, 401);
  assert.equal(event.reason, 'cron-authorization-invalid');
  assert.equal(urls.length, 0);
});

// ---- Global pause (prompt case 2) -----------------------------------------

test('a global pause skips with no context, provider, or status work', async () => {
  await setGlobalPause(true);
  const { urls } = stubProvider({});
  const { res, event } = await runCron();
  assert.equal(res!.status, 200);
  assert.equal(event.result, 'skipped');
  assert.equal(event.reason, 'automation-paused-or-disabled');
  assert.equal(event.quotaChecked, false);
  assert.equal(urls.length, 0);
});

// ---- Canonical context unavailability vs genuine absence (prompt case 3) ---

test('a canonical-context read failure skips as canonical-context-unavailable', async () => {
  __setAppStateReadFailureForTests(new Error('durable read boom'), 'schedule');
  const { urls } = stubProvider({});
  const { event } = await runCron();
  assert.equal(event.result, 'skipped');
  assert.equal(event.reason, 'canonical-context-unavailable');
  assert.equal(urls.length, 0);
});

test('genuine absence (nothing scheduled) skips as no-polling-target, not context-unavailable', async () => {
  const { urls } = stubProvider({});
  const { event } = await runCron();
  assert.equal(event.result, 'skipped');
  assert.equal(event.reason, 'no-polling-target');
  assert.equal(event.quotaChecked, false);
  assert.equal(urls.length, 0);
});

// ---- No kickoff-window target (prompt case 4) -----------------------------

test('a game outside the kickoff window skips with no attempt or quota check', async () => {
  await seedSchedule([{ id: 401001, week: 3, ageHours: 48 }]); // well past +24h
  const { urls } = stubProvider({});
  const { event } = await runCron();
  assert.equal(event.reason, 'no-polling-target');
  assert.equal(event.quotaChecked, false);
  assert.equal(event.providerCallAttempted, false);
  assert.equal(urls.length, 0);
});

// ---- Quota refusal after exact scopes resolve (prompt case 7) --------------

test('a below-reserve quota refuses after scopes resolve: one /info, no /scoreboard, failed attempt', async () => {
  await seedSchedule([{ id: 401001, week: 3, ageHours: 1 }]);
  const { urls } = stubProvider({ remainingCalls: 500 }); // below the 1,002 reserve
  const { res, event } = await runCron();
  assert.equal(event.result, 'failure');
  assert.equal(event.reason, 'quota-below-reserve');
  assert.equal(event.quotaChecked, true);
  assert.equal(event.providerCallAttempted, false);
  assert.equal(urls.filter((u) => u.includes('/info')).length, 1);
  assert.equal(urls.filter((u) => u.includes('/scoreboard')).length, 0);
  assert.equal(res!.status, 200); // a quota refusal is a policy refusal, not a 5xx
  // The exact week partition records a failed attempt; no year rollup is written.
  const weekStatus = await getProviderRefreshStatus(
    'scores',
    weekPartitionScope(YEAR, 3, 'regular')
  );
  assert.equal(weekStatus.latestAttemptOutcome, 'failed');
  const yearStatus = await getProviderRefreshStatus('scores', yearScope(YEAR));
  assert.equal(yearStatus.latestAttemptOutcome, null);
});

// ---- Unexpected throw still emits exactly one event (prompt case 21) -------

test('an unexpected error still emits exactly one failure/unexpected-error event', async () => {
  // A read failure on the settings scope propagates out of isAutoRefreshAllowed.
  __setAppStateReadFailureForTests(new Error('settings read boom'), 'provider-refresh-settings');
  stubProvider({});
  const { event, threw } = await runCron();
  assert.notEqual(threw, null);
  assert.equal(event.result, 'failure');
  assert.equal(event.reason, 'unexpected-error');
});

// ---- Logger failure cannot change route behavior (prompt case 22) ----------

test('a logging failure is swallowed and cannot change the route response', async () => {
  await setAppState('schedule', `${YEAR}-all-all`, {
    at: Date.now(),
    partialFailure: false,
    failedSeasonTypes: [],
    items: [],
  });
  stubProvider({});
  const original = console.log;
  console.log = () => {
    throw new Error('log boom');
  };
  let res: Response | null = null;
  let threw: unknown = null;
  try {
    res = await GET(cronRequest());
  } catch (error) {
    threw = error;
  } finally {
    console.log = original;
  }
  assert.equal(threw, null); // the logging fault never surfaces
  assert.equal(res!.status, 200);
  const body = await res!.json();
  assert.equal(body.reason, 'no-polling-target');
});

// ---- Public/member score reads make no provider call (prompt case 24) ------

test('a public /api/scores read makes no upstream provider call', async () => {
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return new Response('[]', { status: 200 });
  }) as typeof fetch;
  const res = await scoresGet(
    new Request('http://localhost/api/scores?year=2025&seasonType=regular')
  );
  assert.equal(res.status, 200);
  assert.equal(fetchCalls, 0);
});

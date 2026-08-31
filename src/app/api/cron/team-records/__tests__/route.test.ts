import assert from 'node:assert/strict';
import test from 'node:test';

import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  setAppState,
} from '../../../../../lib/server/appStateStore.ts';
import {
  installSchedulerReceiptDeferrer,
  readSchedulerReceipt,
} from '../../../../../lib/server/__tests__/schedulerReceiptTestHarness.ts';
import { yearScope } from '../../../../../lib/providerRefreshScope.ts';
import { getProviderRefreshStatus } from '../../../../../lib/server/providerRefreshStatus.ts';
import { setDatasetAutoRefreshEnabled } from '../../../../../lib/server/providerRefreshSettings.ts';
import type { TeamRecordsCronExecutionEvent } from '../../../../../lib/teamRecords/cronExecutionLog.ts';
import { readTeamRecordsCache } from '../../../../../lib/teamRecords/teamRecordsCache.ts';
import { TEAM_RECORDS_MAX_REFRESH_INTERVAL_MS } from '../../../../../lib/teamRecords/teamRecordsRefresh.ts';

import { GET } from '../route.ts';

const CRON_SECRET = 'test-cron-secret';
const MUTABLE_ENV = process.env as Record<string, string | undefined>;
const ORIGINAL = {
  CRON_SECRET: process.env.CRON_SECRET,
  CFBD_API_KEY: process.env.CFBD_API_KEY,
  NODE_ENV: process.env.NODE_ENV,
  DATABASE_URL: process.env.DATABASE_URL,
};
const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_CONSOLE = console.log;
const YEAR = (() => {
  const now = new Date();
  return now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
})();

let deferrer: ReturnType<typeof installSchedulerReceiptDeferrer>;

function request(secret: string | null = CRON_SECRET): Request {
  return new Request('https://example.com/api/cron/team-records', {
    headers: secret === null ? {} : { authorization: `Bearer ${secret}` },
  });
}

function recordRow(games = 2) {
  return {
    year: YEAR,
    teamId: 333,
    team: 'Alabama',
    classification: 'fbs',
    conference: 'SEC',
    total: { games, wins: games, losses: 0, ties: 0 },
  };
}

async function seedCache(ageMs: number): Promise<void> {
  await setAppState('team-records', String(YEAR), {
    at: Date.now() - ageMs,
    year: YEAR,
    items: [recordRow()],
  });
}

function stubCfbd(records: unknown = [recordRow(3)], remainingCalls = 4000): string[] {
  const urls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    const body = url.endsWith('/info')
      ? { patronLevel: 1, remainingCalls }
      : url.includes('/records?year=')
        ? records
        : (() => {
            throw new Error(`unexpected url ${url}`);
          })();
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return urls;
}

async function runCron(req = request()): Promise<{
  response: Response;
  event: TeamRecordsCronExecutionEvent;
}> {
  const events: TeamRecordsCronExecutionEvent[] = [];
  console.log = ((line: unknown) => {
    try {
      const parsed = JSON.parse(String(line)) as { event?: string };
      if (parsed.event === 'team-records-cron') {
        events.push(parsed as TeamRecordsCronExecutionEvent);
      }
    } catch {
      // Ignore unrelated console output.
    }
  }) as typeof console.log;
  try {
    const response = await GET(req);
    assert.equal(events.length, 1, 'exactly one team-records event is emitted');
    return { response, event: events[0]! };
  } finally {
    console.log = ORIGINAL_CONSOLE;
  }
}

test.beforeEach(async () => {
  delete MUTABLE_ENV.DATABASE_URL;
  MUTABLE_ENV.NODE_ENV = 'development';
  MUTABLE_ENV.CRON_SECRET = CRON_SECRET;
  MUTABLE_ENV.CFBD_API_KEY = 'test-cfbd-key';
  globalThis.fetch = ORIGINAL_FETCH;
  console.log = ORIGINAL_CONSOLE;
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  deferrer = installSchedulerReceiptDeferrer();
});

test.afterEach(() => {
  deferrer.restore();
  globalThis.fetch = ORIGINAL_FETCH;
  console.log = ORIGINAL_CONSOLE;
});

test.after(() => {
  for (const [key, value] of Object.entries(ORIGINAL)) {
    if (value === undefined) delete MUTABLE_ENV[key];
    else MUTABLE_ENV[key] = value;
  }
});

test('cron authentication fails closed before quota, refresh, or receipt work', async () => {
  const urls = stubCfbd();
  delete MUTABLE_ENV.CRON_SECRET;
  const missing = await runCron(request('anything'));
  assert.equal(missing.response.status, 401);

  MUTABLE_ENV.CRON_SECRET = CRON_SECRET;
  const invalid = await runCron(request('wrong'));
  assert.equal(invalid.response.status, 401);
  assert.deepEqual(urls, []);
  assert.equal(deferrer.count(), 0);
});

test('quota refusal is a controlled provider-free run with a truthful receipt', async () => {
  const urls = stubCfbd([recordRow(3)], 1001);
  const { response, event } = await runCron();
  assert.equal(response.status, 200);
  assert.equal(event.result, 'failure');
  assert.equal(event.reason, 'quota-below-reserve');
  assert.equal(event.providerCallAttempted, false);
  assert.equal(urls.filter((url) => url.endsWith('/info')).length, 1);
  assert.equal(urls.filter((url) => url.includes('/records?year=')).length, 0);
  const status = await getProviderRefreshStatus('records', yearScope(YEAR));
  assert.equal(status.latestAttemptOutcome, 'failed');
  assert.equal(
    status.lastError?.code,
    'records-quota-below-reserve',
    'a refused due refresh resolves its year-scoped provider attempt'
  );

  await deferrer.flush();
  const receipt = await readSchedulerReceipt('team-records');
  assert.equal(receipt?.value.result, 'failure');
  assert.equal(receipt?.value.reason, 'quota-below-reserve');
  assert.deepEqual(receipt?.value.target, { kind: 'team-records', year: YEAR });
});

test('the hourly job does not turn the six-hour event floor into its cadence', async () => {
  await seedCache(7 * 60 * 60 * 1000);
  const urls = stubCfbd();
  const { response, event } = await runCron();
  assert.equal(response.status, 200);
  assert.equal(event.result, 'no-op');
  assert.equal(event.reason, 'fresh-cache');
  assert.equal(event.quotaChecked, false);
  assert.equal(urls.filter((url) => url.endsWith('/info')).length, 0);
  assert.equal(urls.filter((url) => url.includes('/records?year=')).length, 0);
});

test('a cache older than the ceiling makes exactly one records call and writes its receipt', async () => {
  await seedCache(TEAM_RECORDS_MAX_REFRESH_INTERVAL_MS + 60_000);
  const urls = stubCfbd([recordRow(3)]);
  const { response, event } = await runCron();
  assert.equal(response.status, 200);
  assert.equal(event.result, 'success');
  assert.equal(event.reason, 'written-clean');
  assert.equal(event.providerCallAttempted, true);
  assert.equal(urls.filter((url) => url.endsWith('/info')).length, 1);
  assert.equal(
    urls.filter((url) => url.includes(`/records?year=${YEAR}`)).length,
    1,
    'one invocation can spend at most one billed records request'
  );
  assert.equal((await readTeamRecordsCache(YEAR))?.items[0]?.total.games, 3);

  await deferrer.flush();
  const receipt = await readSchedulerReceipt('team-records');
  assert.equal(receipt?.value.result, 'success');
  assert.equal(receipt?.value.providerCallAttempted, true);
});

test('the records operator toggle remains authoritative inside the refresh authority', async () => {
  await setDatasetAutoRefreshEnabled('records', false);
  const urls = stubCfbd();
  const { response, event } = await runCron();
  assert.equal(response.status, 200);
  assert.equal(event.result, 'skipped');
  assert.equal(event.reason, 'automation-paused-or-disabled');
  assert.equal(event.quotaChecked, false);
  assert.deepEqual(urls, []);
});

test('a missing provider credential resolves the due attempt before any quota probe', async () => {
  delete MUTABLE_ENV.CFBD_API_KEY;
  const urls = stubCfbd();

  const { response, event } = await runCron();

  assert.equal(response.status, 200);
  assert.equal(event.result, 'failure');
  assert.equal(event.reason, 'cfbd-api-key-missing');
  assert.equal(event.quotaChecked, false);
  assert.deepEqual(urls, []);
  const status = await getProviderRefreshStatus('records', yearScope(YEAR));
  assert.equal(status.latestAttemptOutcome, 'failed');
  assert.equal(status.lastError?.code, 'records-cfbd-api-key-missing');
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  getAppState,
  setAppState,
} from '@/lib/server/appStateStore';
import {
  __setSchedulerReceiptDeferrerForTests,
  SCHEDULER_EXECUTION_STATUS_SCOPE,
  type SchedulerExecutionReceipt,
} from '@/lib/server/schedulerExecutionStatus';
import { TEAM_RECORDS_REFRESH_CONTROL_SCOPE } from '@/lib/teamRecords/teamRecordsRefresh';
import { GET } from '../route.ts';

const NOW = Date.parse('2026-09-06T18:00:00.000Z');
const YEAR = 2026;
const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_NOW = Date.now;
const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;
const ORIGINAL_CFBD_KEY = process.env.CFBD_API_KEY;

function installReceiptDeferrer(): {
  count: () => number;
  flush: () => Promise<void>;
  restore: () => void;
} {
  const callbacks: Array<() => Promise<void>> = [];
  __setSchedulerReceiptDeferrerForTests((callback) => callbacks.push(callback));
  return {
    count: () => callbacks.length,
    flush: async () => {
      while (callbacks.length > 0) await callbacks.shift()!();
    },
    restore: () => __setSchedulerReceiptDeferrerForTests(null),
  };
}

async function readTeamRecordsReceipt(): Promise<SchedulerExecutionReceipt | null> {
  return (
    (await getAppState<SchedulerExecutionReceipt>(SCHEDULER_EXECUTION_STATUS_SCOPE, 'team-records'))
      ?.value ?? null
  );
}

function request(token = 'test-cron-secret'): Request {
  return new Request('http://localhost/api/cron/team-records', {
    headers: { authorization: `Bearer ${token}` },
  });
}

function recordItem(total = { games: 2, wins: 2, losses: 0, ties: 0 }) {
  return {
    year: YEAR,
    teamId: 333,
    team: 'Alabama',
    classification: 'fbs',
    conference: 'SEC',
    total,
  };
}

async function seedCache(ageMs: number): Promise<void> {
  await setAppState('team-records', String(YEAR), {
    at: NOW - ageMs,
    year: YEAR,
    items: [recordItem()],
  });
}

test.beforeEach(async () => {
  Date.now = () => NOW;
  process.env.CRON_SECRET = 'test-cron-secret';
  process.env.CFBD_API_KEY = 'test-cfbd-key';
  globalThis.fetch = ORIGINAL_FETCH;
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

test.after(() => {
  Date.now = ORIGINAL_NOW;
  globalThis.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_CRON_SECRET === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIGINAL_CRON_SECRET;
  if (ORIGINAL_CFBD_KEY === undefined) delete process.env.CFBD_API_KEY;
  else process.env.CFBD_API_KEY = ORIGINAL_CFBD_KEY;
});

test('cron auth fails closed before quota, records, or receipt work', async () => {
  const receipts = installReceiptDeferrer();
  let fetches = 0;
  globalThis.fetch = (async () => {
    fetches += 1;
    throw new Error('auth failure reached provider work');
  }) as typeof fetch;
  try {
    const response = await GET(request('wrong-secret'));
    assert.equal(response.status, 401);
    assert.equal(fetches, 0);
    assert.equal(receipts.count(), 0);
  } finally {
    receipts.restore();
  }
});

test('a fresh cache is provider-free and persists the fresh-cache reason', async () => {
  await seedCache(60 * 60 * 1000);
  const receipts = installReceiptDeferrer();
  let fetches = 0;
  globalThis.fetch = (async () => {
    fetches += 1;
    throw new Error('fresh heartbeat reached provider work');
  }) as typeof fetch;
  try {
    const response = await GET(request());
    const body = (await response.json()) as Record<string, unknown>;
    assert.equal(response.status, 200);
    assert.equal(body.reason, 'fresh-cache');
    assert.equal(body.quotaChecked, false);
    assert.equal(fetches, 0);

    await receipts.flush();
    const receipt = await readTeamRecordsReceipt();
    assert.equal(receipt?.reason, 'fresh-cache');
    assert.equal(receipt?.providerCallAttempted, false);
    assert.deepEqual(receipt?.target, { kind: 'team-records', year: YEAR });
  } finally {
    receipts.restore();
  }
});

test('the hourly job refreshes a twelve-hour cache after one quota probe', async () => {
  await seedCache(12 * 60 * 60 * 1000);
  const urls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (url.endsWith('/info')) {
      return new Response(JSON.stringify({ patronLevel: 1, remainingCalls: 5000 }), {
        status: 200,
      });
    }
    return new Response(JSON.stringify([recordItem({ games: 3, wins: 3, losses: 0, ties: 0 })]), {
      status: 200,
    });
  }) as typeof fetch;

  const response = await GET(request());
  const body = (await response.json()) as Record<string, unknown>;
  assert.equal(response.status, 200);
  assert.equal(body.reason, 'written-clean');
  assert.equal(body.quotaChecked, true);
  assert.equal(body.providerCallAttempted, true);
  assert.deepEqual(urls, [
    'https://api.collegefootballdata.com/info',
    `https://api.collegefootballdata.com/records?year=${YEAR}`,
  ]);
});

test('a rejected empty replacement returns 502 while preserving prior-good records', async () => {
  await seedCache(12 * 60 * 60 * 1000);
  const urls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (url.endsWith('/info')) {
      return new Response(JSON.stringify({ patronLevel: 1, remainingCalls: 5000 }), {
        status: 200,
      });
    }
    return new Response(JSON.stringify([]), { status: 200 });
  }) as typeof fetch;

  const response = await GET(request());
  const body = (await response.json()) as Record<string, unknown>;
  assert.equal(response.status, 502);
  assert.equal(body.result, 'failure');
  assert.equal(body.reason, 'empty-replacement-rejected');
  assert.equal(body.providerCallAttempted, true);
  assert.deepEqual(urls, [
    'https://api.collegefootballdata.com/info',
    `https://api.collegefootballdata.com/records?year=${YEAR}`,
  ]);
  assert.deepEqual(
    (await getAppState<{ items: unknown[] }>('team-records', String(YEAR)))?.value.items,
    [recordItem()],
    'the failure response cannot overwrite the prior-good cache'
  );
});

test('quota refusal probes hourly without attempting the billed records call', async () => {
  await seedCache(12 * 60 * 60 * 1000);
  const urls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (!url.endsWith('/info')) throw new Error('quota refusal reached /records');
    return new Response(JSON.stringify({ patronLevel: 1, remainingCalls: 1000 }), { status: 200 });
  }) as typeof fetch;

  for (let delivery = 0; delivery < 2; delivery += 1) {
    const response = await GET(request());
    const body = (await response.json()) as Record<string, unknown>;
    assert.equal(response.status, 429);
    assert.equal(body.reason, 'quota-below-reserve');
    assert.equal(body.providerCallAttempted, false);
  }
  assert.deepEqual(urls, [
    'https://api.collegefootballdata.com/info',
    'https://api.collegefootballdata.com/info',
  ]);
});

test('the provider-call floor reason survives in the response, event, and receipt', async () => {
  await seedCache(13 * 60 * 60 * 1000);
  await setAppState(TEAM_RECORDS_REFRESH_CONTROL_SCOPE, String(YEAR), {
    lease: null,
    lastProviderCallAt: NOW - 60 * 60 * 1000,
  });
  const receipts = installReceiptDeferrer();
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (line?: unknown) => lines.push(String(line));
  globalThis.fetch = (async () => {
    throw new Error('provider floor reached quota or records I/O');
  }) as typeof fetch;
  try {
    const response = await GET(request());
    const body = (await response.json()) as Record<string, unknown>;
    assert.equal(body.reason, 'provider-call-floor-active');
    assert.equal(body.quotaChecked, false);

    const event = JSON.parse(lines.at(-1) ?? '{}') as Record<string, unknown>;
    assert.equal(event.reason, 'provider-call-floor-active');
    await receipts.flush();
    assert.equal((await readTeamRecordsReceipt())?.reason, 'provider-call-floor-active');
  } finally {
    console.log = originalLog;
    receipts.restore();
  }
});

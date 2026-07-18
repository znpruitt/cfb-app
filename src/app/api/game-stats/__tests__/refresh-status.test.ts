import assert from 'node:assert/strict';
import test from 'node:test';

import { GET } from '../route';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  setAppState,
} from '../../../../lib/server/appStateStore.ts';
import { getCachedGameStats } from '../../../../lib/gameStats/cache.ts';
import { wireGame } from '../../../../lib/gameStats/__tests__/fixtures.ts';
import { getProviderRefreshStatus } from '../../../../lib/server/providerRefreshStatus.ts';
import { weekPartitionScope } from '../../../../lib/providerRefreshScope.ts';

const MUTABLE_ENV = process.env as Record<string, string | undefined>;
const ORIGINAL = {
  NODE_ENV: process.env.NODE_ENV,
  ADMIN_API_TOKEN: process.env.ADMIN_API_TOKEN,
  CFBD_API_KEY: process.env.CFBD_API_KEY,
};
const ORIGINAL_FETCH = globalThis.fetch;
const ADMIN_TOKEN = 'test-admin-token';
const YEAR = 2026;

function adminRefresh(): Request {
  return new Request(
    `https://example.com/api/game-stats?year=${YEAR}&week=3&seasonType=regular&bypassCache=1`,
    { headers: { 'x-admin-token': ADMIN_TOKEN } }
  );
}

// The activated refresh attaches observations to canonical-schedule games, so
// the manual route requires a cached schedule for the target year.
async function seedSchedule() {
  await setAppState('schedule', `${YEAR}-all-all`, {
    at: Date.now(),
    partialFailure: false,
    failedSeasonTypes: [],
    items: [
      {
        id: '5001',
        week: 3,
        seasonType: 'regular',
        startDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
        neutralSite: false,
        conferenceGame: false,
        homeTeam: 'Alpha State',
        awayTeam: 'Beta Tech',
        homeConference: 'X',
        awayConference: 'Y',
        status: 'STATUS_FINAL',
      },
    ],
  });
}

function stubJson(body: unknown) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  MUTABLE_ENV.NODE_ENV = 'development';
  MUTABLE_ENV.ADMIN_API_TOKEN = ADMIN_TOKEN;
  globalThis.fetch = ORIGINAL_FETCH;
});

test.after(() => {
  MUTABLE_ENV.NODE_ENV = ORIGINAL.NODE_ENV;
  if (ORIGINAL.ADMIN_API_TOKEN === undefined) delete MUTABLE_ENV.ADMIN_API_TOKEN;
  else MUTABLE_ENV.ADMIN_API_TOKEN = ORIGINAL.ADMIN_API_TOKEN;
  if (ORIGINAL.CFBD_API_KEY === undefined) delete MUTABLE_ENV.CFBD_API_KEY;
  else MUTABLE_ENV.CFBD_API_KEY = ORIGINAL.CFBD_API_KEY;
  globalThis.fetch = ORIGINAL_FETCH;
});

test('manual game-stats refresh with a missing CFBD key records a failed attempt', async () => {
  await seedSchedule();
  delete MUTABLE_ENV.CFBD_API_KEY;

  const res = await GET(adminRefresh());
  assert.equal(res.status, 500);
  const body = (await res.json()) as { error: string };
  assert.equal(body.error, 'CFBD_API_KEY not configured');

  const status = await getProviderRefreshStatus(
    'game-stats',
    weekPartitionScope(YEAR, 3, 'regular')
  );
  assert.equal(
    status.latestAttemptOutcome,
    'failed',
    'the missing-key attempt is recorded as failed'
  );
  assert.equal(status.lastError?.code, 'cfbd-api-key-missing');
});

test('manual refresh: an unexpected empty provider response is a stable failure without a durable write', async () => {
  await seedSchedule();
  MUTABLE_ENV.CFBD_API_KEY = 'test-cfbd-token';
  stubJson([]);

  const res = await GET(adminRefresh());
  assert.equal(res.status, 502);
  const body = (await res.json()) as { code?: string };
  assert.equal(body.code, 'game-stats-empty-unexpected', 'never "no applicable data"');

  assert.equal(await getCachedGameStats(YEAR, 3, 'regular'), null, 'no empty record written');
  const status = await getProviderRefreshStatus(
    'game-stats',
    weekPartitionScope(YEAR, 3, 'regular')
  );
  assert.equal(status.latestAttemptOutcome, 'failed');
  assert.equal(status.lastError?.code, 'game-stats-empty-unexpected');
  assert.equal(status.lastSuccessAt, null);
});

test('manual refresh: a nonempty payload with zero parseable observations fails as schema drift', async () => {
  await seedSchedule();
  MUTABLE_ENV.CFBD_API_KEY = 'test-cfbd-token';
  // A row missing its away side fails observation parsing.
  stubJson([
    { id: 5001, teams: [{ teamId: 1, team: 'Alpha', homeAway: 'home', points: 21, stats: [] }] },
  ]);

  const res = await GET(adminRefresh());
  assert.equal(res.status, 502);
  const body = (await res.json()) as { code?: string };
  assert.equal(body.code, 'game-stats-schema-drift');

  assert.equal(await getCachedGameStats(YEAR, 3, 'regular'), null, 'no unusable record written');
  const status = await getProviderRefreshStatus(
    'game-stats',
    weekPartitionScope(YEAR, 3, 'regular')
  );
  assert.equal(status.latestAttemptOutcome, 'failed');
  assert.equal(status.lastError?.code, 'game-stats-schema-drift');
});

test('manual refresh: a valid payload merges durably and records success after commit', async () => {
  await seedSchedule();
  MUTABLE_ENV.CFBD_API_KEY = 'test-cfbd-token';
  stubJson([wireGame({ id: 5001 })]);

  const res = await GET(adminRefresh());
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    games: unknown[];
    meta: { cache: string; durable?: { outcome: string } };
  };
  assert.equal(body.games.length, 1);
  assert.equal(body.meta.cache, 'miss');
  assert.equal(body.meta.durable?.outcome, 'written');

  const stored = await getCachedGameStats(YEAR, 3, 'regular');
  assert.equal(stored?.games.length, 1, 'the record is committed');
  assert.equal(stored?.games[0]?.schemaVersion, 2, 'committed through the merge authority');
  const status = await getProviderRefreshStatus(
    'game-stats',
    weekPartitionScope(YEAR, 3, 'regular')
  );
  assert.equal(status.latestAttemptOutcome, 'succeeded');
  assert.equal(status.rowsCommitted, 1);
});

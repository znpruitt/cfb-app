import assert from 'node:assert/strict';
import test from 'node:test';

import { GET } from '../route';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
} from '../../../../lib/server/appStateStore.ts';
import { getCachedGameStats } from '../../../../lib/gameStats/cache.ts';
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

function adminRefresh(): Request {
  return new Request(
    'https://example.com/api/game-stats?year=2026&week=3&seasonType=regular&bypassCache=1',
    { headers: { 'x-admin-token': ADMIN_TOKEN } }
  );
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

test('manual game-stats refresh with a missing CFBD key records a failed attempt (finding #5)', async () => {
  delete MUTABLE_ENV.CFBD_API_KEY;

  const res = await GET(
    new Request(
      'https://example.com/api/game-stats?year=2026&week=3&seasonType=regular&bypassCache=1',
      {
        headers: { 'x-admin-token': ADMIN_TOKEN },
      }
    )
  );
  assert.equal(res.status, 500);
  const body = (await res.json()) as { error: string };
  assert.equal(body.error, 'CFBD_API_KEY not configured');

  const status = await getProviderRefreshStatus(
    'game-stats',
    weekPartitionScope(2026, 3, 'regular')
  );
  assert.equal(
    status.latestAttemptOutcome,
    'failed',
    'the missing-key attempt is recorded as failed'
  );
  assert.equal(status.lastError?.code, 'cfbd-api-key-missing');
});

// 5th-review finding #5 — manual route shares the cron's empty/nonempty-zero rules.
test('manual refresh: a genuinely empty provider response is a no-op without a durable write', async () => {
  MUTABLE_ENV.CFBD_API_KEY = 'test-cfbd-token';
  stubJson([]);

  const res = await GET(adminRefresh());
  assert.equal(res.status, 200);
  const body = (await res.json()) as { games: unknown[]; meta: { noApplicableData?: boolean } };
  assert.deepEqual(body.games, []);
  assert.equal(body.meta.noApplicableData, true);

  assert.equal(await getCachedGameStats(2026, 3, 'regular'), null, 'no empty record written');
  const status = await getProviderRefreshStatus(
    'game-stats',
    weekPartitionScope(2026, 3, 'regular')
  );
  assert.equal(status.latestAttemptOutcome, 'no-op');
  assert.equal(status.lastSuccessAt, null);
});

test('manual refresh: a nonempty payload with no usable rows resolves as failure (no write)', async () => {
  MUTABLE_ENV.CFBD_API_KEY = 'test-cfbd-token';
  // A row missing its away team is dropped by normalization → zero usable rows.
  stubJson([{ id: 5001, teams: [{ team: 'Alpha', homeAway: 'home', points: 21, stats: [] }] }]);

  const res = await GET(adminRefresh());
  assert.equal(res.status, 502);
  const body = (await res.json()) as { code?: string };
  assert.equal(body.code, 'game-stats-no-usable-rows');

  assert.equal(await getCachedGameStats(2026, 3, 'regular'), null, 'no unusable record written');
  const status = await getProviderRefreshStatus(
    'game-stats',
    weekPartitionScope(2026, 3, 'regular')
  );
  assert.equal(status.latestAttemptOutcome, 'failed');
  assert.equal(status.lastError?.code, 'game-stats-no-usable-rows');
});

test('manual refresh: a usable payload commits and records success', async () => {
  MUTABLE_ENV.CFBD_API_KEY = 'test-cfbd-token';
  stubJson([
    {
      id: 5001,
      teams: [
        { teamId: 1, team: 'Alpha', conference: 'X', homeAway: 'home', points: 21, stats: [] },
        { teamId: 2, team: 'Beta', conference: 'Y', homeAway: 'away', points: 14, stats: [] },
      ],
    },
  ]);

  const res = await GET(adminRefresh());
  assert.equal(res.status, 200);
  const body = (await res.json()) as { games: unknown[]; meta: { cache: string } };
  assert.equal(body.games.length, 1);
  assert.equal(body.meta.cache, 'miss');

  const stored = await getCachedGameStats(2026, 3, 'regular');
  assert.equal(stored?.games.length, 1, 'the usable record is committed');
  const status = await getProviderRefreshStatus(
    'game-stats',
    weekPartitionScope(2026, 3, 'regular')
  );
  assert.equal(status.latestAttemptOutcome, 'succeeded');
});

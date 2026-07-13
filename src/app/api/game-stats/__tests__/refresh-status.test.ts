import assert from 'node:assert/strict';
import test from 'node:test';

import { GET } from '../route';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
} from '../../../../lib/server/appStateStore.ts';
import { getProviderRefreshStatus } from '../../../../lib/server/providerRefreshStatus.ts';

const MUTABLE_ENV = process.env as Record<string, string | undefined>;
const ORIGINAL = {
  NODE_ENV: process.env.NODE_ENV,
  ADMIN_API_TOKEN: process.env.ADMIN_API_TOKEN,
  CFBD_API_KEY: process.env.CFBD_API_KEY,
};
const ADMIN_TOKEN = 'test-admin-token';

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  MUTABLE_ENV.NODE_ENV = 'development';
  MUTABLE_ENV.ADMIN_API_TOKEN = ADMIN_TOKEN;
});

test.after(() => {
  MUTABLE_ENV.NODE_ENV = ORIGINAL.NODE_ENV;
  if (ORIGINAL.ADMIN_API_TOKEN === undefined) delete MUTABLE_ENV.ADMIN_API_TOKEN;
  else MUTABLE_ENV.ADMIN_API_TOKEN = ORIGINAL.ADMIN_API_TOKEN;
  if (ORIGINAL.CFBD_API_KEY === undefined) delete MUTABLE_ENV.CFBD_API_KEY;
  else MUTABLE_ENV.CFBD_API_KEY = ORIGINAL.CFBD_API_KEY;
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

  const status = await getProviderRefreshStatus('game-stats');
  assert.equal(
    status.latestAttemptOutcome,
    'failed',
    'the missing-key attempt is recorded as failed'
  );
  assert.equal(status.lastError?.code, 'cfbd-api-key-missing');
});

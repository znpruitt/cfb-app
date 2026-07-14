import assert from 'node:assert/strict';
import test from 'node:test';

import { GET } from '../route';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
} from '../../../../lib/server/appStateStore.ts';
import {
  beginProviderRefreshAttempt,
  getProviderRefreshStatus,
  recordProviderRefreshSuccess,
} from '../../../../lib/server/providerRefreshStatus.ts';
import { oddsTargetScope } from '../../../../lib/providerRefreshScope.ts';
import { defaultOddsCacheKey } from '../routeInternals.ts';

// The default (unfiltered) 2026 odds refresh targets the CANONICAL odds cache
// key — the same scope the admin card reads and the route writes.
const ODDS_SCOPE = oddsTargetScope(2026, 'canonical', defaultOddsCacheKey(2026));

const MUTABLE_ENV = process.env as Record<string, string | undefined>;
const ORIGINAL = {
  NODE_ENV: process.env.NODE_ENV,
  ADMIN_API_TOKEN: process.env.ADMIN_API_TOKEN,
  ODDS_API_KEY: process.env.ODDS_API_KEY,
};
const ADMIN_TOKEN = 'test-admin-token';

function refreshRequest(): Request {
  return new Request('https://example.com/api/odds?year=2026&refresh=1', {
    headers: { 'x-admin-token': ADMIN_TOKEN },
  });
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  MUTABLE_ENV.NODE_ENV = 'development';
  MUTABLE_ENV.ADMIN_API_TOKEN = ADMIN_TOKEN;
  delete MUTABLE_ENV.ODDS_API_KEY; // the condition under test
});

test.after(() => {
  MUTABLE_ENV.NODE_ENV = ORIGINAL.NODE_ENV;
  if (ORIGINAL.ADMIN_API_TOKEN === undefined) delete MUTABLE_ENV.ADMIN_API_TOKEN;
  else MUTABLE_ENV.ADMIN_API_TOKEN = ORIGINAL.ADMIN_API_TOKEN;
  if (ORIGINAL.ODDS_API_KEY === undefined) delete MUTABLE_ENV.ODDS_API_KEY;
  else MUTABLE_ENV.ODDS_API_KEY = ORIGINAL.ODDS_API_KEY;
});

test('missing ODDS_API_KEY on an authorized refresh records a failure (not a silent attempt)', async () => {
  const res = await GET(refreshRequest());
  assert.equal(res.status, 503);

  const status = await getProviderRefreshStatus('odds', ODDS_SCOPE);
  assert.ok(status.lastAttemptAt, 'the attempt was recorded');
  assert.ok(status.lastError, 'a matching failure was recorded');
  assert.equal(status.lastError?.code, 'odds-api-key-missing');
  assert.equal(status.lastError?.status, 503);
});

test('missing-key failure preserves prior-good last-success', async () => {
  // Seed a prior successful odds refresh.
  const attempt = await beginProviderRefreshAttempt('odds', ODDS_SCOPE, { attemptId: 'seed' });
  await recordProviderRefreshSuccess('odds', ODDS_SCOPE, {
    attempt,
    source: 'odds-api',
    rowsCommitted: 20,
  });
  const priorSuccessAt = (await getProviderRefreshStatus('odds', ODDS_SCOPE)).lastSuccessAt;
  assert.ok(priorSuccessAt);

  const res = await GET(refreshRequest());
  assert.equal(res.status, 503);

  const status = await getProviderRefreshStatus('odds', ODDS_SCOPE);
  assert.equal(status.lastSuccessAt, priorSuccessAt, 'prior-good last-success preserved');
  assert.equal(status.source, 'odds-api', 'prior-good source preserved');
  assert.equal(status.rowsCommitted, 20, 'prior-good rows preserved');
  assert.ok(status.lastError, 'the missing-key failure is recorded');
});

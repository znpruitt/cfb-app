import assert from 'node:assert/strict';
import test from 'node:test';

import { loadSeasonRankings, __resetSeasonRankingsCacheForTests } from '../server/rankings.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateWriteFailureForTests,
  getAppState,
} from '../server/appStateStore.ts';
import { getProviderRefreshStatus } from '../server/providerRefreshStatus.ts';

// ---------------------------------------------------------------------------
// PLATFORM-085A — durable-first commit order for the rankings provider cache.
// An authorized rankings refresh must persist durably BEFORE publishing to the
// process-local CACHE, so a failed durable write never leaves this instance
// serving "fresh" rankings other instances can't reproduce.
// ---------------------------------------------------------------------------

const SEASON = 2026;
const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_CFBD_KEY = process.env.CFBD_API_KEY;

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  __resetSeasonRankingsCacheForTests();
  __setAppStateWriteFailureForTests(null);
  process.env.CFBD_API_KEY = 'test-cfbd-token';
  // CFBD rankings upstream returns an empty poll set — enough to build and
  // attempt to persist a response without needing fixture payloads.
  global.fetch = (async () =>
    new Response(JSON.stringify([]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
});

test.after(() => {
  global.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_CFBD_KEY === undefined) delete process.env.CFBD_API_KEY;
  else process.env.CFBD_API_KEY = ORIGINAL_CFBD_KEY;
  __setAppStateWriteFailureForTests(null);
  __resetSeasonRankingsCacheForTests();
});

test('rankings refresh: a durable write failure does not publish process-local fresh rankings', async () => {
  __setAppStateWriteFailureForTests(new Error('durable write unavailable'));
  try {
    await assert.rejects(() => loadSeasonRankings(SEASON, { allowRefresh: true }));
  } finally {
    __setAppStateWriteFailureForTests(null);
  }

  // Durable store never received the entry.
  assert.equal(await getAppState('rankings', String(SEASON)), null);

  // A subsequent non-refresh read must NOT serve fresh rankings from the
  // process cache (it was never populated) — with nothing cached it demands an
  // admin refresh instead of returning a poisoned hit.
  await assert.rejects(() => loadSeasonRankings(SEASON), /admin refresh required/);
});

test('rankings refresh: a successful durable write publishes to the process cache', async () => {
  const first = await loadSeasonRankings(SEASON, { allowRefresh: true });
  assert.equal(first.meta.cache, 'miss');

  // Durable persisted, and a non-refresh read is now served from the process
  // cache as a hit.
  assert.ok(await getAppState('rankings', String(SEASON)));
  const second = await loadSeasonRankings(SEASON);
  assert.equal(second.meta.cache, 'hit');
});

test('rankings refresh: a missing CFBD key records a failed attempt (rereview finding #5)', async () => {
  delete process.env.CFBD_API_KEY;
  await assert.rejects(
    () => loadSeasonRankings(SEASON, { allowRefresh: true }),
    /CFBD_API_KEY missing/
  );
  const status = await getProviderRefreshStatus('rankings');
  assert.equal(status.latestAttemptOutcome, 'failed');
  assert.equal(status.lastError?.code, 'cfbd-api-key-missing');
});

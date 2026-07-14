import assert from 'node:assert/strict';
import test from 'node:test';

import { GET as cronGet } from '../route';
import { GET as manualGet } from '../../../game-stats/route';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  setAppState,
} from '../../../../../lib/server/appStateStore.ts';
import { setCachedGameStats } from '../../../../../lib/gameStats/cache.ts';
import {
  setDatasetAutoRefreshEnabled,
  setGlobalPause,
} from '../../../../../lib/server/providerRefreshSettings.ts';
import { getProviderRefreshStatus } from '../../../../../lib/server/providerRefreshStatus.ts';
import { weekPartitionScope, yearScope } from '../../../../../lib/providerRefreshScope.ts';

const MUTABLE_ENV = process.env as Record<string, string | undefined>;
const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;
const CRON_SECRET = 'test-cron-secret';
const PAUSE_SKIP = 'automatic game-stats refresh is paused or disabled';
// Season year the cron computes (seasonYearForToday). The missing-key failure now
// records against the EXACT resolved week partition, never the year rollup.
const YEAR = (() => {
  const d = new Date();
  const m = d.getUTCMonth();
  const y = d.getUTCFullYear();
  return m >= 6 ? y : y - 1;
})();

function cronRequest(): Request {
  return new Request('https://example.com/api/cron/game-stats', {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
}

// Seed the cached schedule so `findLatestCompletedWeek` resolves the given week as
// the cron's target (a completed, stat-producing slate). Used to exercise the
// missing-key path WITH a resolved target.
async function seedCompletedWeek(week: number, seasonType: 'regular' | 'postseason') {
  await setAppState('schedule', `${YEAR}-all-all`, {
    at: Date.now(),
    partialFailure: false,
    failedSeasonTypes: [],
    items: [
      {
        id: `${week}-${seasonType}`,
        week,
        seasonType,
        startDate: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
        neutralSite: false,
        conferenceGame: false,
        homeTeam: 'Alpha',
        awayTeam: 'Beta',
        homeConference: 'X',
        awayConference: 'Y',
        status: 'STATUS_FINAL',
      },
    ],
  });
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  MUTABLE_ENV.CRON_SECRET = CRON_SECRET;
});

test.after(() => {
  if (ORIGINAL_CRON_SECRET === undefined) delete MUTABLE_ENV.CRON_SECRET;
  else MUTABLE_ENV.CRON_SECRET = ORIGINAL_CRON_SECRET;
});

test('global pause makes the game-stats cron skip before fetching', async () => {
  await setGlobalPause(true);
  const res = await cronGet(cronRequest());
  assert.equal(res.status, 200);
  const body = (await res.json()) as { skipped?: string };
  assert.equal(body.skipped, PAUSE_SKIP);
});

test('per-dataset disable makes the game-stats cron skip', async () => {
  await setDatasetAutoRefreshEnabled('game-stats', false);
  const res = await cronGet(cronRequest());
  const body = (await res.json()) as { skipped?: string };
  assert.equal(body.skipped, PAUSE_SKIP);
});

test('when not paused, the cron proceeds past the pause gate', async () => {
  // Not paused: the cron should NOT short-circuit with the pause skip. It will
  // fail later (no CFBD key / no completed weeks), which still proves the gate
  // let it through.
  const res = await cronGet(cronRequest());
  const body = (await res.json()) as { skipped?: string };
  assert.notEqual(body.skipped, PAUSE_SKIP);
});

test('missing CFBD key with a resolved target records a WEEK-partition failure, not the year rollup (v2 #1)', async () => {
  // CFBD_API_KEY is unset in this test file, so the unpaused cron takes the
  // missing-credential path. With a resolved target week, the failure must land on
  // the EXACT week partition (so a later successful run of the same week replaces
  // it) — never the year data rollup.
  await seedCompletedWeek(3, 'regular');
  const res = await cronGet(cronRequest());
  const body = (await res.json()) as { error?: string; week?: number; seasonType?: string };
  assert.equal(res.status, 500);
  assert.equal(body.error, 'CFBD_API_KEY not configured');
  assert.equal(body.week, 3, 'the response identifies the resolved target week');
  assert.equal(body.seasonType, 'regular');

  const week = await getProviderRefreshStatus('game-stats', weekPartitionScope(YEAR, 3, 'regular'));
  assert.equal(
    week.latestAttemptOutcome,
    'failed',
    'the week partition owns the missing-key failure'
  );
  assert.equal(week.lastError?.code, 'cfbd-api-key-missing');

  const yearRollup = await getProviderRefreshStatus('game-stats', yearScope(YEAR));
  assert.equal(
    yearRollup.latestAttemptOutcome,
    null,
    'a one-week cron never writes the year data rollup'
  );
});

test('missing CFBD key with a resolved POSTSEASON target records against that week, not regular (v2 #1)', async () => {
  await seedCompletedWeek(1, 'postseason');
  const res = await cronGet(cronRequest());
  assert.equal(res.status, 500);

  const post = await getProviderRefreshStatus(
    'game-stats',
    weekPartitionScope(YEAR, 1, 'postseason')
  );
  assert.equal(post.latestAttemptOutcome, 'failed');
  assert.equal(post.lastError?.code, 'cfbd-api-key-missing');

  const reg = await getProviderRefreshStatus('game-stats', weekPartitionScope(YEAR, 1, 'regular'));
  assert.equal(reg.latestAttemptOutcome, null, 'the sibling regular week is untouched');
});

test('missing CFBD key with NO applicable target week records no scoped failure and calls no provider (v2 #3)', async () => {
  // No schedule seeded → findLatestCompletedWeek returns null → no work. The cron
  // must return its established skipped response WITHOUT fabricating a year (or any)
  // provider-data failure, and WITHOUT spending a provider call.
  let fetchCalls = 0;
  const priorFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return new Response('[]', { status: 200 });
  }) as typeof fetch;
  try {
    const res = await cronGet(cronRequest());
    const body = (await res.json()) as { skipped?: string };
    assert.equal(res.status, 200);
    assert.match(String(body.skipped ?? ''), /no completed weeks/i);
    assert.equal(fetchCalls, 0, 'no provider call is made without a resolved target');
  } finally {
    globalThis.fetch = priorFetch;
  }

  const yearRollup = await getProviderRefreshStatus('game-stats', yearScope(YEAR));
  assert.equal(yearRollup.latestAttemptOutcome, null, 'no fabricated year failure');
});

test('manual game-stats refresh (cache read) remains available while automation is paused', async () => {
  await setGlobalPause(true);
  await setCachedGameStats({
    year: 2026,
    week: 3,
    seasonType: 'regular',
    fetchedAt: new Date().toISOString(),
    games: [],
  });

  const res = await manualGet(
    new Request('https://example.com/api/game-stats?year=2026&week=3&seasonType=regular')
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { week: number; meta: { cache: string } };
  assert.equal(body.week, 3);
  assert.equal(body.meta.cache, 'hit');
});

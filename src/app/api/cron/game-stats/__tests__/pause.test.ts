import assert from 'node:assert/strict';
import test from 'node:test';

import { GET as cronGet } from '../route';
import { GET as manualGet } from '../../../game-stats/route';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  setAppState,
} from '../../../../../lib/server/appStateStore.ts';
import { seedActiveWriterControl } from '../../../../../lib/gameStats/__tests__/writerControlSeed.ts';
import {
  setDatasetAutoRefreshEnabled,
  setGlobalPause,
} from '../../../../../lib/server/providerRefreshSettings.ts';
import { getProviderRefreshStatus } from '../../../../../lib/server/providerRefreshStatus.ts';
import { weekPartitionScope, yearScope } from '../../../../../lib/providerRefreshScope.ts';

// PLATFORM-086H3E3 — the activated 15-minute cron's gates, in order:
// CRON_SECRET → auto-refresh pause (before any attempt) → cache-only
// kickoff-window target resolution (no target = no attempt, no usage check,
// no provider call) → ONE scoped attempt → quota reserve → credentials.

const MUTABLE_ENV = process.env as Record<string, string | undefined>;
const ORIGINAL = {
  CRON_SECRET: process.env.CRON_SECRET,
  CFBD_API_KEY: process.env.CFBD_API_KEY,
  NODE_ENV: process.env.NODE_ENV,
  ADMIN_API_TOKEN: process.env.ADMIN_API_TOKEN,
};
const ORIGINAL_FETCH = globalThis.fetch;
const CRON_SECRET = 'test-cron-secret';
const ADMIN_TOKEN = 'test-admin-token';
const PAUSE_SKIP = 'automatic game-stats refresh is paused or disabled';
const NO_TARGET_SKIP = 'no partition inside the polling window';
// Season year the cron computes (seasonYearForToday).
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

/** Seed a stat-producing game inside the [3h, 24h) polling window. */
async function seedWindowGame(week: number, seasonType: 'regular' | 'postseason', ageHours = 5) {
  await setAppState('schedule', `${YEAR}-all-all`, {
    at: Date.now(),
    partialFailure: false,
    failedSeasonTypes: [],
    items: [
      {
        id: '9001',
        week,
        seasonType,
        startDate: new Date(Date.now() - ageHours * 60 * 60 * 1000).toISOString(),
        neutralSite: false,
        conferenceGame: false,
        homeTeam: 'Alpha',
        awayTeam: 'Beta',
        homeId: 90011,
        awayId: 90012,
        homeConference: 'SEC',
        awayConference: 'Big Ten',
        status: 'STATUS_FINAL',
      },
    ],
  });
}

test.beforeEach(async () => {
  MUTABLE_ENV.NODE_ENV = 'development';
  MUTABLE_ENV.CRON_SECRET = CRON_SECRET;
  MUTABLE_ENV.ADMIN_API_TOKEN = ADMIN_TOKEN;
  delete MUTABLE_ENV.CFBD_API_KEY;
  globalThis.fetch = ORIGINAL_FETCH;
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  await seedActiveWriterControl();
});

test.after(() => {
  for (const [key, value] of Object.entries(ORIGINAL)) {
    if (value === undefined) delete MUTABLE_ENV[key];
    else MUTABLE_ENV[key] = value;
  }
  globalThis.fetch = ORIGINAL_FETCH;
});

test('an invalid cron secret is rejected before anything else', async () => {
  const res = await cronGet(
    new Request('https://example.com/api/cron/game-stats', {
      headers: { authorization: 'Bearer wrong' },
    })
  );
  assert.equal(res.status, 401);
});

test('global pause makes the game-stats cron skip before any attempt', async () => {
  await setGlobalPause(true);
  await seedWindowGame(3, 'regular');
  const res = await cronGet(cronRequest());
  assert.equal(res.status, 200);
  const body = (await res.json()) as { skipped?: string };
  assert.equal(body.skipped, PAUSE_SKIP);
  const week = await getProviderRefreshStatus('game-stats', weekPartitionScope(YEAR, 3, 'regular'));
  assert.equal(week.latestAttemptOutcome, null, 'pause precedes attempt creation');
});

test('per-dataset disable makes the game-stats cron skip', async () => {
  await setDatasetAutoRefreshEnabled('game-stats', false);
  const res = await cronGet(cronRequest());
  const body = (await res.json()) as { skipped?: string };
  assert.equal(body.skipped, PAUSE_SKIP);
});

test('when not paused, the cron proceeds past the pause gate', async () => {
  const res = await cronGet(cronRequest());
  const body = (await res.json()) as { skipped?: string };
  assert.notEqual(body.skipped, PAUSE_SKIP);
});

test('no window partition → no scoped attempt, no usage check, no provider call', async () => {
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return new Response('[]', { status: 200 });
  }) as typeof fetch;

  const res = await cronGet(cronRequest());
  const body = (await res.json()) as { skipped?: string };
  assert.equal(res.status, 200);
  assert.equal(body.skipped, NO_TARGET_SKIP);
  assert.equal(fetchCalls, 0, 'no provider or usage call without a resolved target');

  const yearRollup = await getProviderRefreshStatus('game-stats', yearScope(YEAR));
  assert.equal(yearRollup.latestAttemptOutcome, null, 'no fabricated attempt anywhere');
});

test('with a target but no CFBD key, usage is unknowable → truthful quota failure on the WEEK partition', async () => {
  await seedWindowGame(3, 'regular');
  const res = await cronGet(cronRequest());
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    outcome?: string;
    reason?: string;
    week?: number;
    durable?: { status?: string };
  };
  assert.equal(body.outcome, 'failure');
  assert.equal(body.reason, 'quota-usage-unavailable');
  assert.equal(body.week, 3);
  // A missing credential manifests HERE: fetchCfbdUsage cannot read usage, so
  // the quota gate refuses first (the dedicated credential branch is defensive
  // — unreachable while the quota gate short-circuits an unreadable key). Even
  // so, this target-resolved failure carries the durable reread; with no prior
  // record the truthful projection is `absent`, never a missing block.
  assert.equal(body.durable?.status, 'absent');

  const week = await getProviderRefreshStatus('game-stats', weekPartitionScope(YEAR, 3, 'regular'));
  assert.equal(week.latestAttemptOutcome, 'failed');
  assert.equal(week.lastError?.code, 'game-stats-quota-usage-unavailable');
  const yearRollup = await getProviderRefreshStatus('game-stats', yearScope(YEAR));
  assert.equal(yearRollup.latestAttemptOutcome, null, 'never the year rollup');
});

test('a POSTSEASON target scopes its failure to that exact partition', async () => {
  await seedWindowGame(1, 'postseason');
  const res = await cronGet(cronRequest());
  assert.equal(res.status, 200);

  const post = await getProviderRefreshStatus(
    'game-stats',
    weekPartitionScope(YEAR, 1, 'postseason')
  );
  assert.equal(post.latestAttemptOutcome, 'failed');
  const reg = await getProviderRefreshStatus('game-stats', weekPartitionScope(YEAR, 1, 'regular'));
  assert.equal(reg.latestAttemptOutcome, null, 'the sibling regular week is untouched');
});

test('the ordinary game-stats READ stays available (and provider-free) while automation is paused', async () => {
  await setGlobalPause(true);
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return new Response('[]', { status: 200 });
  }) as typeof fetch;

  const res = await manualGet(
    new Request('https://example.com/api/game-stats?year=2026&week=3&seasonType=regular', {
      headers: { 'x-admin-token': ADMIN_TOKEN },
    })
  );
  // Absence is the truthful cache-only outcome; the surface itself is serving.
  assert.equal(res.status, 404);
  assert.equal(fetchCalls, 0, 'ordinary reads never touch the provider, paused or not');
});

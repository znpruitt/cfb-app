import assert from 'node:assert/strict';
import test from 'node:test';

import { GET as cronGet } from '../route';
import { GET as manualGet } from '../../../game-stats/route';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
} from '../../../../../lib/server/appStateStore.ts';
import { setCachedGameStats } from '../../../../../lib/gameStats/cache.ts';
import {
  setDatasetAutoRefreshEnabled,
  setGlobalPause,
} from '../../../../../lib/server/providerRefreshSettings.ts';

const MUTABLE_ENV = process.env as Record<string, string | undefined>;
const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;
const CRON_SECRET = 'test-cron-secret';
const PAUSE_SKIP = 'automatic game-stats refresh is paused or disabled';

function cronRequest(): Request {
  return new Request('https://example.com/api/cron/game-stats', {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
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

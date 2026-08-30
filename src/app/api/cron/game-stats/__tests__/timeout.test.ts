import assert from 'node:assert/strict';
import test from 'node:test';

import { wireGame, legacyRowFromWire } from '@/lib/gameStats/__tests__/fixtures';
import { seedActiveWriterControl } from '@/lib/gameStats/__tests__/writerControlSeed';
import { getCachedGameStats, getGameStatsKey } from '@/lib/gameStats/cache';
import { weekPartitionScope } from '@/lib/providerRefreshScope';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  setAppState,
} from '@/lib/server/appStateStore';
import { getProviderRefreshStatus } from '@/lib/server/providerRefreshStatus';
import { installDelayedCfbdProvider, withCompressedTimeouts } from '@/test/compressedTimeout';

import { GET } from '../route';

const MUTABLE_ENV = process.env as Record<string, string | undefined>;
const ORIGINAL = {
  CRON_SECRET: process.env.CRON_SECRET,
  CFBD_API_KEY: process.env.CFBD_API_KEY,
  NODE_ENV: process.env.NODE_ENV,
};
const ORIGINAL_FETCH = globalThis.fetch;
const CRON_SECRET = 'test-cron-secret';
const HOUR_MS = 60 * 60 * 1_000;
const YEAR = (() => {
  const now = new Date();
  return now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
})();

function cronRequest() {
  return new Request('https://example.com/api/cron/game-stats', {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
}

function scheduleItem(args: { id: number; home: string; away: string; ageHours: number }) {
  return {
    id: String(args.id),
    week: 3,
    seasonType: 'regular',
    startDate: new Date(Date.now() - args.ageHours * HOUR_MS).toISOString(),
    neutralSite: false,
    conferenceGame: false,
    homeTeam: args.home,
    awayTeam: args.away,
    homeId: args.id * 10 + 1,
    awayId: args.id * 10 + 2,
    homeConference: 'SEC',
    awayConference: 'Big Ten',
    status: 'STATUS_FINAL',
  };
}

async function seedSchedule(items: ReturnType<typeof scheduleItem>[]) {
  await setAppState('schedule', `${YEAR}-all-all`, {
    at: Date.now(),
    partialFailure: false,
    failedSeasonTypes: [],
    items,
  });
}

function gameStatsRow(id: number, home: string, away: string) {
  return wireGame({
    id,
    home: { school: home, teamId: id * 10 + 1 },
    away: { school: away, teamId: id * 10 + 2 },
  });
}

function billedPaths(provider: ReturnType<typeof installDelayedCfbdProvider>) {
  return provider.billedUrls().map((url) => new URL(url).pathname);
}

test.beforeEach(async () => {
  MUTABLE_ENV.NODE_ENV = 'development';
  MUTABLE_ENV.CRON_SECRET = CRON_SECRET;
  MUTABLE_ENV.CFBD_API_KEY = 'test-cfbd-token';
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

test('game stats accepts 25s-equivalent provider latency with one billed request', async () => {
  await seedSchedule([scheduleItem({ id: 9001, home: 'Alpha', away: 'Beta', ageHours: 5 })]);

  await withCompressedTimeouts(async (nativeSetTimeout) => {
    const provider = installDelayedCfbdProvider({
      payload: [gameStatsRow(9001, 'Alpha', 'Beta')],
      providerDelayMs: 25_000,
      nativeSetTimeout,
    });
    const res = await GET(cronRequest());
    const body = (await res.json()) as { outcome?: string; reason?: string };

    assert.equal(res.status, 200);
    assert.equal(body.outcome, 'success');
    assert.equal(body.reason, 'written-clean');
    assert.deepEqual(billedPaths(provider), ['/games/teams']);
    assert.equal((await getCachedGameStats(YEAR, 3, 'regular'))?.games[0]?.providerGameId, 9001);
  });
});

test('game-stats timeout retains prior-good data and bills exactly one request', async () => {
  const covered = scheduleItem({ id: 9001, home: 'Alpha', away: 'Beta', ageHours: 5 });
  const uncovered = scheduleItem({ id: 9002, home: 'Gamma', away: 'Delta', ageHours: 6 });
  await seedSchedule([covered, uncovered]);
  await setAppState('game-stats', getGameStatsKey(YEAR, 3, 'regular'), {
    year: YEAR,
    week: 3,
    seasonType: 'regular',
    fetchedAt: new Date().toISOString(),
    games: [legacyRowFromWire(gameStatsRow(9001, 'Alpha', 'Beta'), 3)],
  });

  await withCompressedTimeouts(async (nativeSetTimeout) => {
    const provider = installDelayedCfbdProvider({
      payload: [gameStatsRow(9002, 'Gamma', 'Delta')],
      providerDelayMs: 50_000,
      nativeSetTimeout,
    });
    const res = await GET(cronRequest());
    const body = (await res.json()) as { outcome?: string; reason?: string };

    assert.equal(res.status, 500);
    assert.equal(body.outcome, 'failure');
    assert.equal(body.reason, 'provider-fetch-failed');
    assert.deepEqual(billedPaths(provider), ['/games/teams']);
    const status = await getProviderRefreshStatus(
      'game-stats',
      weekPartitionScope(YEAR, 3, 'regular')
    );
    assert.match(status.lastError?.message ?? '', /timed out after 40000ms/);
  });

  const stored = await getCachedGameStats(YEAR, 3, 'regular');
  assert.equal(stored?.games.length, 1);
  assert.equal(stored?.games[0]?.providerGameId, 9001);
});

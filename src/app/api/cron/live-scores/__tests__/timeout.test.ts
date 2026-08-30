import assert from 'node:assert/strict';
import test from 'node:test';

import { weekPartitionScope } from '@/lib/providerRefreshScope';
import type { CacheEntry } from '@/lib/scores/cache';
import { getAppState } from '@/lib/server/appStateStore';
import { getProviderRefreshStatus } from '@/lib/server/providerRefreshStatus';
import { installDelayedCfbdProvider, withCompressedTimeouts } from '@/test/compressedTimeout';

import { YEAR, resetForTest, restoreEnv, runCron, seedSchedule, seedScoreEntry } from './harness';

test.beforeEach(resetForTest);
test.after(restoreEnv);

function scoreboardRow() {
  return {
    id: 401001,
    status: 'in_progress',
    period: 2,
    clock: '05:00',
    homeTeam: { id: 333, name: 'Alabama', points: 14 },
    awayTeam: { id: 61, name: 'Georgia', points: 7 },
  };
}

function gamesRow() {
  return {
    id: 401001,
    home_team: 'Alabama',
    away_team: 'Georgia',
    home_points: 27,
    away_points: 24,
    status: 'final',
  };
}

async function seedPendingFinal() {
  await seedSchedule([
    { id: 401001, week: 3, ageHours: 4, status: 'STATUS_FINAL', homeId: 333, awayId: 61 },
  ]);
  await seedScoreEntry(3, 'regular', {
    at: 1_000,
    items: [
      {
        id: '401001',
        seasonType: 'regular',
        startDate: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
        week: 3,
        status: 'final',
        home: { team: 'Alabama', score: 27 },
        away: { team: 'Georgia', score: 24 },
        time: null,
      },
    ],
    itemUpdatedAtById: { '401001': 1_000 },
    pendingFinalConfirmationIds: ['401001'],
  });
}

async function readScores(): Promise<CacheEntry | null> {
  return (await getAppState<CacheEntry>('scores', `${YEAR}-3-regular`))?.value ?? null;
}

test('scoreboard accepts 25s-equivalent provider latency with one billed request', async () => {
  await seedSchedule([{ id: 401001, week: 3, ageHours: 1, homeId: 333, awayId: 61 }]);

  await withCompressedTimeouts(async (nativeSetTimeout) => {
    const provider = installDelayedCfbdProvider({
      payload: [scoreboardRow()],
      providerDelayMs: 25_000,
      nativeSetTimeout,
    });
    const { res, event } = await runCron();

    assert.equal(res?.status, 200);
    assert.equal(event.reason, 'scoreboard-written-clean');
    assert.deepEqual(provider.billedPaths(), ['/scoreboard']);
    assert.equal((await readScores())?.items[0]?.home.score, 14);
  });
});

test('scoreboard timeout fails cleanly, retains prior-good data, and bills one request', async () => {
  await seedSchedule([{ id: 401001, week: 3, ageHours: 1, homeId: 333, awayId: 61 }]);
  await seedScoreEntry(3, 'regular', {
    at: 1_000,
    items: [
      {
        id: '401001',
        week: 3,
        status: 'Q1 10:00',
        startDate: null,
        home: { team: 'Alabama', score: 3 },
        away: { team: 'Georgia', score: 0 },
        time: null,
      },
    ],
  });

  await withCompressedTimeouts(async (nativeSetTimeout) => {
    const provider = installDelayedCfbdProvider({
      payload: [scoreboardRow()],
      providerDelayMs: 50_000,
      nativeSetTimeout,
    });
    const { res, event } = await runCron();

    assert.equal(res?.status, 500);
    assert.equal(event.reason, 'provider-fetch-failed');
    assert.deepEqual(provider.billedPaths(), ['/scoreboard']);
    const status = await getProviderRefreshStatus('scores', weekPartitionScope(YEAR, 3, 'regular'));
    assert.match(status.lastError?.message ?? '', /timed out after 40000ms/);
  });

  const stored = await readScores();
  assert.equal(stored?.at, 1_000);
  assert.equal(stored?.items[0]?.home.score, 3);
});

test('final reconciliation accepts 25s-equivalent provider latency with one billed request', async () => {
  await seedPendingFinal();

  await withCompressedTimeouts(async (nativeSetTimeout) => {
    const provider = installDelayedCfbdProvider({
      payload: [gamesRow()],
      providerDelayMs: 25_000,
      nativeSetTimeout,
    });
    const { res, event } = await runCron();

    assert.equal(res?.status, 200);
    assert.equal(event.reason, 'final-reconciliation-confirmed');
    assert.deepEqual(provider.billedPaths(), ['/games']);
    assert.equal((await readScores())?.pendingFinalConfirmationIds, undefined);
  });
});

test('final-reconciliation timeout retains the pending final and bills one request', async () => {
  await seedPendingFinal();

  await withCompressedTimeouts(async (nativeSetTimeout) => {
    const provider = installDelayedCfbdProvider({
      payload: [gamesRow()],
      providerDelayMs: 50_000,
      nativeSetTimeout,
    });
    const { res, event } = await runCron();

    assert.equal(res?.status, 500);
    assert.equal(event.reason, 'provider-fetch-failed');
    assert.deepEqual(provider.billedPaths(), ['/games']);
    const status = await getProviderRefreshStatus('scores', weekPartitionScope(YEAR, 3, 'regular'));
    assert.match(status.lastError?.message ?? '', /timed out after 40000ms/);
  });

  const stored = await readScores();
  assert.deepEqual(stored?.pendingFinalConfirmationIds, ['401001']);
  assert.equal(stored?.items[0]?.home.score, 27);
});

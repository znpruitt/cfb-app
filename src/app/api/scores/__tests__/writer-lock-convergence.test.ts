import assert from 'node:assert/strict';
import test from 'node:test';

import { mergeScoresIntoPartition } from '../../../../lib/liveScores/scoreMerge.ts';
import { weekPartitionScope } from '../../../../lib/providerRefreshScope.ts';
import type { CacheEntry } from '../../../../lib/scores/cache.ts';
import type { ScorePack } from '../../../../lib/scores/types.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateWriteFailureForTests,
  getAppState,
  setAppState,
} from '../../../../lib/server/appStateStore.ts';
import { getProviderRefreshStatus } from '../../../../lib/server/providerRefreshStatus.ts';
import { GET } from '../route';

// PLATFORM-086B2A — the authorized manual `/api/scores?refresh=1` write now commits
// under the SAME per-key advisory transaction the live-score engine uses, so a
// manual repair and a concurrent live merge on a shared `scores/<year>-<week>-
// <seasonType>` key can no longer clobber each other.

function setMockFetch(impl: (input: URL | string) => Promise<Response>): void {
  global.fetch = impl as typeof fetch;
}

/** Stub CFBD `/games` with a fixed payload; other origins throw (never contacted). */
function stubGames(payload: unknown): void {
  setMockFetch(async (input) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    if (url.origin === 'https://api.collegefootballdata.com') {
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected URL: ${url.toString()}`);
  });
}

function livePack(id: string, status: string, hs: number, as: number): ScorePack {
  return {
    id,
    seasonType: 'regular',
    startDate: '2026-09-01T18:00:00.000Z',
    week: 3,
    status,
    home: { team: 'Alabama', score: hs },
    away: { team: 'Georgia', score: as },
    time: null,
  };
}

async function readPartition(): Promise<CacheEntry | null> {
  return (await getAppState<CacheEntry>('scores', '2026-3-regular'))?.value ?? null;
}

function refreshRequest(): Request {
  return new Request('http://localhost/api/scores?year=2026&week=3&seasonType=regular&refresh=1');
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  __setAppStateWriteFailureForTests(null);
  process.env.CFBD_API_KEY = 'test-cfbd-token';
});

test.after(() => {
  __setAppStateWriteFailureForTests(null);
});

// ---- Ordering A: manual starts → live commits → manual resumes ----------------

test('a manual refresh PRESERVES a live row committed after the manual request began', async () => {
  // A live merge already committed 401001 with an effective timestamp far ahead of
  // this (real-clock) manual request's observation, standing in for a live update
  // that landed while the manual request was in flight.
  const future = Date.now() + 1_000_000_000;
  await setAppState('scores', '2026-3-regular', {
    at: future,
    source: 'cfbd',
    cfbdFallbackReason: 'none',
    items: [livePack('401001', 'Q4 2:00', 28, 21)],
    itemUpdatedAtById: { '401001': future },
  } satisfies CacheEntry);

  // Stale manual /games view of the same game.
  stubGames([
    {
      id: 401001,
      week: 3,
      home_team: 'Alabama',
      away_team: 'Georgia',
      home_points: 0,
      away_points: 0,
      status: 'scheduled',
    },
  ]);

  const res = await GET(refreshRequest());
  assert.equal(res.status, 200);

  const entry = await readPartition();
  const row = entry!.items.find((i) => i.id === '401001')!;
  assert.equal(row.status, 'Q4 2:00'); // the newer live row survived
  assert.equal(row.home.score, 28);
  assert.equal(entry!.itemUpdatedAtById!['401001'], future);
});

// ---- Ordering B: live starts → manual commits → older live resumes ------------

test('an older live merge after a manual commit is rejected by the observation-order guard', async () => {
  const before = Date.now();
  stubGames([
    {
      id: 401001,
      week: 3,
      home_team: 'Alabama',
      away_team: 'Georgia',
      home_points: 24,
      away_points: 17,
      status: 'final',
    },
  ]);
  const res = await GET(refreshRequest());
  assert.equal(res.status, 200);

  const afterManual = await readPartition();
  assert.equal(afterManual!.items[0]!.status, 'final');
  assert.equal(afterManual!.items[0]!.home.score, 24);

  // An OLDER live run (its observation predates the manual commit) tries to write a
  // stale in-progress score; the live merge's observation-order guard skips it.
  const result = await mergeScoresIntoPartition({
    year: 2026,
    week: 3,
    seasonType: 'regular',
    updates: [{ pack: livePack('401001', 'Q3 5:00', 14, 10), provisionalFinal: false }],
    now: before - 100_000,
  });
  assert.equal(result.wrote, false);
  const final = await readPartition();
  assert.equal(final!.items[0]!.status, 'final'); // manual commit preserved
  assert.equal(final!.items[0]!.home.score, 24);
});

// ---- Ordinary replacement -----------------------------------------------------

test('an ordinary manual refresh replaces the partition and returns the committed rows', async () => {
  stubGames([
    {
      id: 401001,
      week: 3,
      home_team: 'Alabama',
      away_team: 'Georgia',
      home_points: 31,
      away_points: 28,
      status: 'final',
    },
    {
      id: 401002,
      week: 3,
      home_team: 'Ohio State',
      away_team: 'Michigan',
      home_points: 30,
      away_points: 27,
      status: 'final',
    },
  ]);
  const res = await GET(refreshRequest());
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.items.length, 2);

  const entry = await readPartition();
  assert.equal(entry!.items.length, 2);
  assert.equal(entry!.itemUpdatedAtById!['401001'] > 0, true);
});

// ---- Final-confirmation cleanup ----------------------------------------------

test('a manual /games final clears prior pending-final confirmation metadata it authoritatively covers', async () => {
  await setAppState('scores', '2026-3-regular', {
    at: 1000,
    source: 'cfbd',
    cfbdFallbackReason: 'none',
    items: [livePack('401001', 'final', 27, 24)],
    itemUpdatedAtById: { '401001': 1000 }, // older than the manual observation
    pendingFinalConfirmationIds: ['401001'],
  } satisfies CacheEntry);

  stubGames([
    {
      id: 401001,
      week: 3,
      home_team: 'Alabama',
      away_team: 'Georgia',
      home_points: 27,
      away_points: 24,
      status: 'final',
    },
  ]);
  const res = await GET(refreshRequest());
  assert.equal(res.status, 200);

  const entry = await readPartition();
  assert.equal(entry!.pendingFinalConfirmationIds, undefined); // authoritatively confirmed → cleared
});

// ---- Transaction failure has no side effects ----------------------------------

test('a durable transaction failure preserves prior-good data and records a failed attempt (no success)', async () => {
  await setAppState('scores', '2026-3-regular', {
    at: 1000,
    source: 'cfbd',
    cfbdFallbackReason: 'none',
    items: [livePack('401001', 'Q1 10:00', 3, 0)],
    itemUpdatedAtById: { '401001': 1000 },
  } satisfies CacheEntry);

  stubGames([
    {
      id: 401001,
      week: 3,
      home_team: 'Alabama',
      away_team: 'Georgia',
      home_points: 24,
      away_points: 17,
      status: 'final',
    },
  ]);
  __setAppStateWriteFailureForTests(new Error('durable write boom'), 'scores');

  const res = await GET(refreshRequest());
  __setAppStateWriteFailureForTests(null);

  assert.notEqual(res.status, 200); // failure, not a silent 200
  const entry = await readPartition();
  assert.equal(entry!.items[0]!.status, 'Q1 10:00'); // prior-good untouched
  assert.equal(entry!.items[0]!.home.score, 3);
  assert.equal(entry!.at, 1000);
  const status = await getProviderRefreshStatus('scores', weekPartitionScope(2026, 3, 'regular'));
  assert.equal(status.latestAttemptOutcome, 'failed'); // success was never recorded
});

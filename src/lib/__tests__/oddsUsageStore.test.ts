import assert from 'node:assert/strict';
import test from 'node:test';

import {
  __deleteOddsUsageStoreFileForTests,
  __resetOddsUsageStoreForTests,
  captureOddsUsageSnapshot,
  getLatestKnownOddsUsage,
  readLatestKnownOddsUsageState,
  setLatestKnownOddsUsage,
} from '../server/oddsUsageStore.ts';
import {
  __corruptAppStateFileForTests,
  __deleteAppStateFileForTests,
  __setAppStateReadFailureForTests,
  __setAppStateWriteFailureForTests,
} from '../server/appStateStore.ts';

test.beforeEach(async () => {
  __setAppStateWriteFailureForTests(null);
  await __deleteOddsUsageStoreFileForTests();
});

test('valid snapshot is persisted and readable after simulated restart', async () => {
  const first = await captureOddsUsageSnapshot(
    new Headers({
      'x-requests-used': '101',
      'x-requests-remaining': '399',
      'x-requests-last': '2',
    }),
    {
      sportKey: 'americanfootball_ncaaf',
      markets: ['h2h', 'spreads'],
      regions: ['us'],
      endpointType: 'odds',
      cacheStatus: 'miss',
    }
  );

  assert.ok(first?.capturedAt);

  __resetOddsUsageStoreForTests();
  const afterRestart = await getLatestKnownOddsUsage();

  assert.equal(afterRestart?.used, 101);
  assert.equal(afterRestart?.remaining, 399);
  assert.equal(afterRestart?.capturedAt, first?.capturedAt);
});

test('invalid later headers do not overwrite a valid persisted snapshot', async () => {
  await captureOddsUsageSnapshot(
    new Headers({
      'x-requests-used': '9',
      'x-requests-remaining': '491',
      'x-requests-last': '2',
    })
  );

  const second = await captureOddsUsageSnapshot(new Headers({ 'x-requests-used': '10' }));
  assert.equal(second?.remaining, 491);

  __resetOddsUsageStoreForTests();
  const persisted = await getLatestKnownOddsUsage();
  assert.equal(persisted?.remaining, 491);
});

test('later valid header snapshot overwrites fallback snapshot', async () => {
  await captureOddsUsageSnapshot(
    new Headers({
      'x-requests-used': '500',
      'x-requests-remaining': '0',
      'x-requests-last': '0',
    })
  );

  await setLatestKnownOddsUsage({
    used: 500,
    remaining: 0,
    lastCost: 0,
    limit: 500,
    capturedAt: new Date().toISOString(),
    source: 'quota-error-fallback',
    sportKey: 'americanfootball_ncaaf',
    markets: ['h2h'],
    regions: ['us'],
    endpointType: 'odds',
    cacheStatus: 'miss',
  });

  const replaced = await captureOddsUsageSnapshot(
    new Headers({
      'x-requests-used': '122',
      'x-requests-remaining': '378',
      'x-requests-last': '1',
    }),
    { sportKey: 'americanfootball_ncaaf', markets: ['h2h'], regions: ['us'], endpointType: 'odds' }
  );

  assert.equal(replaced?.source, 'odds-response-headers');
  assert.equal(replaced?.remaining, 378);
});

test('setLatestKnownOddsUsage: a durable write failure does not advance the process memo (PLATFORM-085A)', async () => {
  await setLatestKnownOddsUsage({
    used: 100,
    remaining: 400,
    lastCost: 1,
    limit: 500,
    capturedAt: '2026-09-01T00:00:00.000Z',
    source: 'odds-response-headers',
    sportKey: 'americanfootball_ncaaf',
    markets: ['h2h'],
    regions: ['us'],
    endpointType: 'odds',
    cacheStatus: 'miss',
  });

  __setAppStateWriteFailureForTests(new Error('durable write unavailable'));
  try {
    await assert.rejects(() =>
      setLatestKnownOddsUsage({
        used: 200,
        remaining: 300,
        lastCost: 1,
        limit: 500,
        capturedAt: '2026-09-02T00:00:00.000Z',
        source: 'odds-response-headers',
        sportKey: 'americanfootball_ncaaf',
        markets: ['h2h'],
        regions: ['us'],
        endpointType: 'odds',
        cacheStatus: 'miss',
      })
    );
  } finally {
    __setAppStateWriteFailureForTests(null);
  }

  // Process memo still reflects the last durable value, not the unpersisted one.
  const memo = await getLatestKnownOddsUsage();
  assert.equal(memo?.remaining, 400);

  // Durable store also unchanged.
  __resetOddsUsageStoreForTests();
  const durable = await getLatestKnownOddsUsage({ forceRefresh: true });
  assert.equal(durable?.remaining, 400);
});

// ---------------------------------------------------------------------------
// PLATFORM-086G2 deferred finding #3 — a durable-read failure is DISTINCT from
// a genuinely absent snapshot; the state-carrying read never throws and never
// fabricates usage values.
// ---------------------------------------------------------------------------

test('read state: available when a snapshot is stored', async () => {
  await setLatestKnownOddsUsage({
    used: 100,
    remaining: 400,
    lastCost: 3,
    limit: 500,
    capturedAt: '2026-07-01T00:00:00.000Z',
    source: 'odds-response-headers',
  });

  const state = await readLatestKnownOddsUsageState({ forceRefresh: true });
  assert.equal(state.state, 'available');
  assert.equal(state.state === 'available' && state.snapshot.remaining, 400);
});

test('read state: genuinely absent when nothing has ever been stored', async () => {
  const state = await readLatestKnownOddsUsageState({ forceRefresh: true });
  assert.deepEqual(state, { state: 'absent' });
});

test('read state: a durable-read failure is unavailable, never collapsed into absent', async () => {
  await setLatestKnownOddsUsage({
    used: 100,
    remaining: 400,
    lastCost: 3,
    limit: 500,
    capturedAt: '2026-07-01T00:00:00.000Z',
    source: 'odds-response-headers',
  });

  __setAppStateReadFailureForTests(new Error('durable odds-usage read boom'), 'odds-usage');
  try {
    const state = await readLatestKnownOddsUsageState({ forceRefresh: true });
    assert.equal(state.state, 'unavailable', 'a read failure must not report absence');
    assert.match(
      (state.state === 'unavailable' && state.error) || '',
      /durable odds-usage read boom/
    );
  } finally {
    __setAppStateReadFailureForTests(null);
  }

  // The failed read does not poison the memo — a later read recovers.
  const recovered = await readLatestKnownOddsUsageState({ forceRefresh: true });
  assert.equal(recovered.state, 'available');
  assert.equal(recovered.state === 'available' && recovered.snapshot.remaining, 400);
});

test('read state: a CORRUPT app-state file reports unavailable through the real file backend', async () => {
  // Not the throw-injecting seam — this exercises the genuine file-fallback
  // read path (086G2 P2 remediation #3): corrupt JSON must not read as absence.
  await __corruptAppStateFileForTests();
  try {
    const state = await readLatestKnownOddsUsageState({ forceRefresh: true });
    assert.equal(state.state, 'unavailable', 'a corrupt store is not snapshot absence');
  } finally {
    await __deleteAppStateFileForTests();
  }
});

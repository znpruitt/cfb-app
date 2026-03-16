import assert from 'node:assert/strict';
import test from 'node:test';

import {
  __deleteOddsUsageStoreFileForTests,
  __resetOddsUsageStoreForTests,
  captureOddsUsageSnapshot,
  getLatestKnownOddsUsage,
} from '../server/oddsUsageStore';

test.beforeEach(async () => {
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

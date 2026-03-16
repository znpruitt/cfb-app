import assert from 'node:assert/strict';
import test from 'node:test';

import {
  __deleteOddsUsageStoreFileForTests,
  __resetOddsUsageStoreForTests,
  captureOddsUsageSnapshot,
} from '@/lib/server/oddsUsageStore';

import { GET } from './route';

test.beforeEach(async () => {
  await __deleteOddsUsageStoreFileForTests();
  __resetOddsUsageStoreForTests();
});

test('admin odds-usage route returns null before first odds request', async () => {
  const res = await GET();
  const payload = (await res.json()) as { usage: null };
  assert.equal(payload.usage, null);
});

test('admin odds-usage route returns latest known snapshot', async () => {
  await captureOddsUsageSnapshot(
    new Headers({
      'x-requests-used': '55',
      'x-requests-remaining': '445',
      'x-requests-last': '3',
    }),
    { sportKey: 'americanfootball_ncaaf', markets: ['h2h'], regions: ['us'], endpointType: 'odds' }
  );

  const res = await GET();
  const payload = (await res.json()) as { usage: { used: number; lastCost: number } };

  assert.equal(payload.usage.used, 55);
  assert.equal(payload.usage.lastCost, 3);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import type { DurableOddsRecord } from '../odds.ts';
import {
  __deleteDurableOddsStoreFileForTests,
  __resetDurableOddsStoreForTests,
  getDurableOddsRecord,
  getDurableOddsStore,
  setDurableOddsStore,
} from '../server/durableOddsStore.ts';

const SEASON = 2026;

test.beforeEach(async () => {
  __resetDurableOddsStoreForTests();
  await __deleteDurableOddsStoreFileForTests(SEASON);
});

test('persists and reloads durable odds records by canonical game id', async () => {
  const record: DurableOddsRecord = {
    canonicalGameId: '12-georgia-clemson-H',
    latestSnapshot: {
      capturedAt: '2026-09-01T12:00:00.000Z',
      bookmakerKey: 'draftkings',
      favorite: 'Georgia',
      source: 'DraftKings',
      spread: -3.5,
      homeSpread: -3.5,
      awaySpread: 3.5,
      spreadPriceHome: -110,
      spreadPriceAway: -110,
      moneylineHome: -165,
      moneylineAway: 145,
      total: 51.5,
      overPrice: -108,
      underPrice: -112,
    },
    closingSnapshot: null,
    closingFrozenAt: null,
  };

  await setDurableOddsStore(SEASON, {
    [record.canonicalGameId]: record,
  });

  __resetDurableOddsStoreForTests();

  const loaded = await getDurableOddsRecord(SEASON, record.canonicalGameId);
  assert.deepEqual(loaded, record);

  const store = await getDurableOddsStore(SEASON);
  assert.equal(store[record.canonicalGameId]?.latestSnapshot?.bookmakerKey, 'draftkings');
});

import assert from 'node:assert/strict';
import test from 'node:test';

import type { DurableOddsRecord } from '../odds.ts';
import {
  __deleteDurableOddsStoreFileForTests,
  __resetDurableOddsStoreForTests,
  getDurableOddsRecord,
  getDurableOddsStore,
  setDurableOddsStore,
  updateDurableOddsStore,
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

test('season-scoped updates serialize and merge against refreshed state', async () => {
  const freezeRecord: DurableOddsRecord = {
    canonicalGameId: '1-georgia-clemson-H',
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
    [freezeRecord.canonicalGameId]: freezeRecord,
  });

  const first = updateDurableOddsStore(SEASON, async (current) => {
    await new Promise((resolve) => setTimeout(resolve, 25));
    return {
      ...current,
      [freezeRecord.canonicalGameId]: {
        ...current[freezeRecord.canonicalGameId]!,
        closingSnapshot: current[freezeRecord.canonicalGameId]!.latestSnapshot,
        closingFrozenAt: '2026-09-01T19:30:00.000Z',
      },
    };
  });

  const second = updateDurableOddsStore(SEASON, (current) => ({
    ...current,
    '2-texas-ou-H': {
      canonicalGameId: '2-texas-ou-H',
      latestSnapshot: {
        capturedAt: '2026-10-10T12:00:00.000Z',
        bookmakerKey: 'draftkings',
        favorite: 'Texas',
        source: 'DraftKings',
        spread: -2.5,
        homeSpread: -2.5,
        awaySpread: 2.5,
        spreadPriceHome: -110,
        spreadPriceAway: -110,
        moneylineHome: -140,
        moneylineAway: 120,
        total: 55.5,
        overPrice: -108,
        underPrice: -112,
      },
      closingSnapshot: null,
      closingFrozenAt: null,
    },
  }));

  await Promise.all([first, second]);

  const store = await getDurableOddsStore(SEASON);
  assert.equal(store['1-georgia-clemson-H']?.closingFrozenAt, '2026-09-01T19:30:00.000Z');
  assert.equal(store['1-georgia-clemson-H']?.closingSnapshot?.spread, -3.5);
  assert.equal(store['2-texas-ou-H']?.latestSnapshot?.spread, -2.5);
});

test('reload preserves null numeric fields instead of coercing them to zero', async () => {
  const record: DurableOddsRecord = {
    canonicalGameId: '3-georgia-clemson-H',
    latestSnapshot: {
      capturedAt: '2026-09-01T12:00:00.000Z',
      bookmakerKey: 'draftkings',
      favorite: null,
      source: 'DraftKings',
      spread: null,
      homeSpread: null,
      awaySpread: null,
      spreadPriceHome: null,
      spreadPriceAway: null,
      moneylineHome: -165,
      moneylineAway: 145,
      total: null,
      overPrice: null,
      underPrice: null,
    },
    closingSnapshot: null,
    closingFrozenAt: null,
  };

  await setDurableOddsStore(SEASON, {
    [record.canonicalGameId]: record,
  });

  __resetDurableOddsStoreForTests();

  const loaded = await getDurableOddsRecord(SEASON, record.canonicalGameId);
  assert.equal(loaded?.latestSnapshot?.spread, null);
  assert.equal(loaded?.latestSnapshot?.homeSpread, null);
  assert.equal(loaded?.latestSnapshot?.total, null);
  assert.equal(loaded?.latestSnapshot?.moneylineHome, -165);
});

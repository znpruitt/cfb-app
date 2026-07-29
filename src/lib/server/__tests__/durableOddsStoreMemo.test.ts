import assert from 'node:assert/strict';
import test from 'node:test';

import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateReadFailureForTests,
  setAppState,
} from '../appStateStore.ts';
import {
  __deleteDurableOddsStoreFileForTests,
  __resetDurableOddsStoreForTests,
  getDurableOddsStore,
  ODDS_MEMO_TTL_MS,
  primeDurableOddsStoreMemory,
} from '../durableOddsStore.ts';
import type { DurableOddsRecord } from '../../odds.ts';

const SEASON = 2026;

function rec(id: string, spread: number): DurableOddsRecord {
  return {
    canonicalGameId: id,
    latestSnapshot: {
      capturedAt: '2026-09-01T00:00:00.000Z',
      bookmakerKey: 'draftkings',
      favorite: 'Georgia',
      source: 'DraftKings',
      spread,
      homeSpread: spread,
      awaySpread: -spread,
      spreadPriceHome: -110,
      spreadPriceAway: -110,
      moneylineHome: null,
      moneylineAway: null,
      total: null,
      overPrice: null,
      underPrice: null,
    },
    closingSnapshot: null,
    closingFrozenAt: null,
  };
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  await __deleteDurableOddsStoreFileForTests(SEASON);
  __resetDurableOddsStoreForTests();
  __setAppStateReadFailureForTests(null);
});

test('#51/#52: a fresh memo is the fast path; an expired memo re-reads a cross-instance commit', async () => {
  const t0 = 1_000_000;
  // This instance's memo holds store A.
  primeDurableOddsStoreMemory(SEASON, { a: rec('a', -3.5) }, t0);
  // Another instance commits store B directly to durable (bypasses this memo).
  await setAppState('durable-odds:2026', 'store', { b: rec('b', -7) });

  // Before the TTL, the memo is the fast path (still store A).
  const fresh = await getDurableOddsStore(SEASON, { now: t0 + 60_000 });
  assert.deepEqual(Object.keys(fresh), ['a']);

  // After the TTL, the durable re-read surfaces the cross-instance store B.
  const expired = await getDurableOddsStore(SEASON, { now: t0 + ODDS_MEMO_TTL_MS + 1 });
  assert.deepEqual(Object.keys(expired), ['b']);
});

test('#53: a forced durable read bypasses even a fresh memo', async () => {
  const t0 = 2_000_000;
  primeDurableOddsStoreMemory(SEASON, { a: rec('a', -3.5) }, t0);
  await setAppState('durable-odds:2026', 'store', { b: rec('b', -7) });
  const forced = await getDurableOddsStore(SEASON, { now: t0 + 1_000, forceDurableRead: true });
  assert.deepEqual(Object.keys(forced), ['b']);
});

test('#54: a durable read failure propagates (never treated as absence)', async () => {
  __setAppStateReadFailureForTests(new Error('durable-odds down'), 'durable-odds:2026');
  await assert.rejects(getDurableOddsStore(SEASON, { forceDurableRead: true }));
  __setAppStateReadFailureForTests(null);
});

test('#55: prime updates the memo (used as the fast path within the TTL)', async () => {
  const t0 = 3_000_000;
  primeDurableOddsStoreMemory(SEASON, { p: rec('p', -1.5) }, t0);
  const store = await getDurableOddsStore(SEASON, { now: t0 + 1_000 });
  assert.equal(store.p?.latestSnapshot?.homeSpread, -1.5);
});

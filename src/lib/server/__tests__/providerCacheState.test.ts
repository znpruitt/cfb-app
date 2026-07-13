import assert from 'node:assert/strict';
import test from 'node:test';

import { getProviderCacheStates, unknownProviderCacheStates } from '../providerCacheState.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateReadFailureForTests,
  setAppState,
} from '../appStateStore.ts';
import { defaultOddsCacheKey } from '../../../app/api/odds/routeInternals.ts';

const YEAR = 2026;

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

test.afterEach(() => {
  __setAppStateReadFailureForTests(null);
});

test('unseeded year → every dataset is absent (read succeeded, no content)', async () => {
  const states = await getProviderCacheStates(YEAR);
  assert.deepEqual(states, {
    scores: 'absent',
    schedule: 'absent',
    odds: 'absent',
    rankings: 'absent',
    conferences: 'absent',
    'game-stats': 'absent',
  });
});

test('seeded caches with content → available', async () => {
  await setAppState('schedule', `${YEAR}-all-all`, {
    at: 1,
    items: [{ id: '1', week: 1, seasonType: 'regular', startDate: '2026-09-01T00:00:00.000Z' }],
  });
  await setAppState('scores', `${YEAR}-all-regular`, {
    at: 1,
    items: [{ week: 1 }],
    source: 'cfbd',
    cfbdFallbackReason: null,
  });
  await setAppState('odds-cache', defaultOddsCacheKey(YEAR), { lastFetch: 1 });
  await setAppState('rankings', String(YEAR), { at: 1, response: { weeks: [{ season: YEAR }] } });
  await setAppState('conferences', 'snapshot', { at: 1, items: [{ id: 1 }] });

  const states = await getProviderCacheStates(YEAR);
  assert.equal(states.schedule, 'available');
  assert.equal(states.scores, 'available');
  assert.equal(states.odds, 'available');
  assert.equal(states.rankings, 'available');
  assert.equal(states.conferences, 'available');
});

test('empty content is absent, not available (measure content, not bare key)', async () => {
  await setAppState('schedule', `${YEAR}-all-all`, { at: 1, items: [] });
  await setAppState('scores', `${YEAR}-all-regular`, {
    at: 1,
    items: [],
    source: 'cfbd',
    cfbdFallbackReason: null,
  });
  await setAppState('rankings', String(YEAR), { at: 1, response: { weeks: [] } });
  await setAppState('conferences', 'snapshot', { at: 1, items: [] });

  const states = await getProviderCacheStates(YEAR);
  assert.equal(states.schedule, 'absent');
  assert.equal(states.scores, 'absent');
  assert.equal(states.rankings, 'absent');
  assert.equal(states.conferences, 'absent');
});

test('a durable read failure degrades to unknown, never a false absent', async () => {
  // The single-key read-failure seam covers the getAppState-backed probes; a real
  // durable outage rejects every reader, so the catch → 'unknown' path is what
  // prevents an operator being told data is gone because a read hiccupped.
  __setAppStateReadFailureForTests(new Error('durable read boom'));
  const states = await getProviderCacheStates(YEAR);
  assert.equal(states.schedule, 'unknown');
  assert.equal(states.odds, 'unknown');
  assert.equal(states.rankings, 'unknown');
  assert.equal(states.conferences, 'unknown');
});

test('unknownProviderCacheStates is an all-unknown map for every dataset', () => {
  const states = unknownProviderCacheStates();
  assert.equal(Object.keys(states).length, 6);
  assert.equal(
    Object.values(states).every((s) => s === 'unknown'),
    true
  );
});

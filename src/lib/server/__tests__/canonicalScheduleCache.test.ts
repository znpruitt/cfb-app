import assert from 'node:assert/strict';
import test from 'node:test';

import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  setAppState,
} from '../appStateStore.ts';
import {
  canonicalScheduleAggregateKey,
  canonicalScheduleAggregateServes,
  canonicalSchedulePartitionKeys,
  loadCachedScheduleItems,
  loadCanonicalScheduleEntry,
} from '../canonicalScheduleCache.ts';

/**
 * PLATFORM-663 — this module is now the SINGLE implementation of the canonical
 * schedule precedence. It previously existed in three places
 * (`loadCachedScheduleItems`, an inline copy in `assembleSeasonScoredBuild`, and
 * the partition keys again in `loadScheduleDisappearanceFallback`), and the route
 * resolved keys a fourth way. These tests pin the precedence and the two
 * projections over it, because every whole-season reader in the app now depends on
 * exactly this behaviour.
 */

const YEAR = 2031;

function row(id: string, week: number) {
  return { id, week, homeTeam: `Home ${id}`, awayTeam: `Away ${id}` };
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

test('the aggregate key and partition keys are the canonical spellings', () => {
  assert.equal(canonicalScheduleAggregateKey(YEAR), '2031-all-all');
  assert.deepEqual(canonicalSchedulePartitionKeys(YEAR), [
    '2031-all-regular',
    '2031-all-postseason',
  ]);
});

test('aggregate-serves is true only for a record carrying rows', () => {
  assert.equal(canonicalScheduleAggregateServes({ items: [row('a', 1)] }), true);
  assert.equal(canonicalScheduleAggregateServes({ items: [] }), false);
  assert.equal(canonicalScheduleAggregateServes({}), false);
  assert.equal(canonicalScheduleAggregateServes(null), false);
  assert.equal(canonicalScheduleAggregateServes(undefined), false);
  // An array is not a record — a stored bare array must not read as "serves".
  assert.equal(canonicalScheduleAggregateServes([row('a', 1)]), false);
});

test('a populated aggregate wins and the partition pair is never consulted', async () => {
  await setAppState('schedule', '2031-all-all', {
    at: 500,
    items: [row('agg', 1)],
    partialFailure: false,
    failedSeasonTypes: [],
  });
  await setAppState('schedule', '2031-all-regular', {
    at: 900,
    items: [row('pair', 1)],
    partialFailure: false,
    failedSeasonTypes: [],
  });

  const entry = await loadCanonicalScheduleEntry(YEAR);
  assert.equal(entry?.source, 'aggregate');
  assert.equal(entry?.at, 500, 'the aggregate keeps its own stamp even when a pair looks newer');
  assert.deepEqual(
    entry?.items.map((i) => (i as { id: string }).id),
    ['agg']
  );
});

test('an EMPTY aggregate falls through to a populated partition pair', async () => {
  await setAppState('schedule', '2031-all-all', {
    at: 900,
    items: [],
    partialFailure: false,
    failedSeasonTypes: [],
  });
  await setAppState('schedule', '2031-all-regular', {
    at: 400,
    items: [row('reg', 1)],
    partialFailure: false,
    failedSeasonTypes: [],
  });
  await setAppState('schedule', '2031-all-postseason', {
    at: 700,
    items: [row('post', 15)],
    partialFailure: false,
    failedSeasonTypes: [],
  });

  const entry = await loadCanonicalScheduleEntry(YEAR);
  assert.equal(entry?.source, 'partition-pair');
  assert.deepEqual(
    entry?.items.map((i) => (i as { id: string }).id),
    ['reg', 'post']
  );
  // The OLDEST contributing partition owns the stamp, so a freshly written half
  // cannot make its stale sibling read as current.
  assert.equal(entry?.at, 400);
});

test('a partition contributing no rows contributes no stamp', async () => {
  await setAppState('schedule', '2031-all-regular', {
    at: 800,
    items: [row('reg', 1)],
    partialFailure: false,
    failedSeasonTypes: [],
  });
  // Present but empty — normal before bowls are published. It must not drag the
  // composed stamp back to its own older value.
  await setAppState('schedule', '2031-all-postseason', {
    at: 1,
    items: [],
    partialFailure: false,
    failedSeasonTypes: [],
  });

  const entry = await loadCanonicalScheduleEntry(YEAR);
  assert.equal(entry?.at, 800, 'an empty postseason partition cannot make the view stale');
  assert.deepEqual(
    entry?.items.map((i) => (i as { id: string }).id),
    ['reg']
  );
});

test('"cached and empty" and "never cached" are different results', async () => {
  assert.equal(await loadCanonicalScheduleEntry(YEAR), null, 'no record at all is null');

  await setAppState('schedule', '2031-all-all', {
    at: 123,
    items: [],
    partialFailure: false,
    failedSeasonTypes: [],
  });
  const entry = await loadCanonicalScheduleEntry(YEAR);
  assert.notEqual(entry, null, 'a record that exists but is empty is NOT a miss');
  assert.deepEqual(entry?.items, []);
  assert.equal(entry?.at, 123);
});

test('partialFailure and failedSeasonTypes survive both precedence paths', async () => {
  await setAppState('schedule', '2031-all-all', {
    at: 10,
    items: [row('agg', 1)],
    partialFailure: true,
    failedSeasonTypes: ['postseason'],
  });
  const fromAggregate = await loadCanonicalScheduleEntry(YEAR);
  assert.equal(fromAggregate?.partialFailure, true);
  assert.deepEqual(fromAggregate?.failedSeasonTypes, ['postseason']);

  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  await setAppState('schedule', '2031-all-regular', {
    at: 10,
    items: [row('reg', 1)],
    partialFailure: true,
    failedSeasonTypes: ['regular'],
  });
  const fromPair = await loadCanonicalScheduleEntry(YEAR);
  assert.equal(fromPair?.partialFailure, true);
  assert.deepEqual(fromPair?.failedSeasonTypes, ['regular']);
});

test('a malformed at is normalized rather than propagated as NaN', async () => {
  await setAppState('schedule', '2031-all-all', {
    at: 'not-a-number',
    items: [row('agg', 1)],
    partialFailure: false,
    failedSeasonTypes: [],
  });
  const entry = await loadCanonicalScheduleEntry(YEAR);
  // A NaN stamp would make every freshness comparison false and silently force a
  // permanent refresh; 0 is stale-but-comparable, which is the honest answer.
  assert.equal(entry?.at, 0);
});

test('loadCachedScheduleItems is the item-only projection of the same precedence', async () => {
  assert.deepEqual(await loadCachedScheduleItems(YEAR), [], 'a full miss is an empty list');

  await setAppState('schedule', '2031-all-regular', {
    at: 5,
    items: [row('reg', 1)],
    partialFailure: false,
    failedSeasonTypes: [],
  });
  assert.deepEqual(
    (await loadCachedScheduleItems(YEAR)).map((i) => (i as unknown as { id: string }).id),
    ['reg'],
    'it serves the pair fallback exactly as the entry reader does'
  );
});

test('week-partition keys are NOT part of the canonical precedence', async () => {
  // PLATFORM-663's whole point: a per-week record is not a key any canonical
  // reader consults. Before the slice, `/api/schedule` could commit this and no
  // whole-season reader would ever see it.
  await setAppState('schedule', '2031-5-regular', {
    at: Date.now(),
    items: [row('week5', 5)],
    partialFailure: false,
    failedSeasonTypes: [],
  });

  assert.equal(
    await loadCanonicalScheduleEntry(YEAR),
    null,
    'a week partition alone is still a canonical miss'
  );
  assert.deepEqual(await loadCachedScheduleItems(YEAR), []);
});

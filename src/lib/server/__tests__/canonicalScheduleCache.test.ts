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
  loadCanonicalScheduleForBuild,
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

// ---------------------------------------------------------------------------
// PLATFORM-663 review round 1 — two findings on this module, both about a state
// that reads as more trustworthy than it is.
// ---------------------------------------------------------------------------

test('an UNKNOWN partition age is stale, not absent', async () => {
  // A populated legacy partition with NO `at` (the store may hold older records —
  // `StoredScheduleEntry.at` is optional for exactly that reason) paired with a
  // freshly stamped sibling. Skipping the unknown stamp would let the fresh half
  // report the combined view fresh while half of it had unknown age.
  await setAppState('schedule', '2031-all-regular', {
    items: [row('no-stamp', 1)],
    partialFailure: false,
    failedSeasonTypes: [],
  });
  await setAppState('schedule', '2031-all-postseason', {
    at: Date.now(),
    items: [row('fresh', 15)],
    partialFailure: false,
    failedSeasonTypes: [],
  });

  const entry = await loadCanonicalScheduleEntry(YEAR);
  assert.equal(entry?.source, 'partition-pair');
  assert.equal(entry?.at, 0, 'an unknown contributing age normalizes to 0, not dropped');
  assert.deepEqual(
    entry?.items.map((i) => (i as { id: string }).id),
    ['no-stamp', 'fresh'],
    'both partitions still contribute their rows'
  );
});

test('an EMPTY partition record is a miss, so it cannot become a 200 with zero rows', async () => {
  // Only the AGGREGATE may establish "cached and empty". The route turns an entry
  // into HTTP 200, and `fetchSeasonSchedule` throws only on a non-OK status — so a
  // 200 carrying zero rows is accepted by the client and rendered as an empty
  // season. Before #663 this store shape returned 503, a visible failure.
  await setAppState('schedule', '2031-all-regular', {
    at: Date.now(),
    items: [],
    partialFailure: false,
    failedSeasonTypes: [],
  });

  assert.equal(
    await loadCanonicalScheduleEntry(YEAR),
    null,
    'an empty partition record has no rows to serve, so it stays a miss'
  );

  // The aggregate keeps its own empty-vs-absent distinction, which the route needs.
  await setAppState('schedule', '2031-all-all', {
    at: 77,
    items: [],
    partialFailure: false,
    failedSeasonTypes: [],
  });
  const entry = await loadCanonicalScheduleEntry(YEAR);
  assert.notEqual(entry, null, 'an empty AGGREGATE is still "cached and empty"');
  assert.equal(entry?.source, 'aggregate');
  assert.equal(entry?.at, 77);
});

// ---------------------------------------------------------------------------
// PLATFORM-813 — the boundary validates, and reports what it destroyed. Which files read
// around it is enumerated in `scheduleReadEnumeration.test.ts`, not listed here.
// ---------------------------------------------------------------------------

test('the boundary returns COERCED rows and reports the ones that change the season', async () => {
  await setAppState('schedule', '2031-all-all', {
    at: 500,
    // Every REQUIRED field is present on both rows, so the count below is exactly the
    // four deliberately-malformed values and nothing incidental. An earlier version of
    // this fixture omitted homeConference/awayConference and the count read 8 — correct
    // under the required-field rule, but unreadable as a claim about this test.
    items: [
      {
        id: 401,
        week: 1,
        homeTeam: 7,
        awayTeam: 'Rice',
        homeConference: 'SEC',
        awayConference: 'Big 12',
        status: true,
        eventKey: { a: 1 },
      },
      {
        id: 'ok',
        week: 2,
        homeTeam: 'Texas',
        awayTeam: 'Baylor',
        homeConference: 'SEC',
        awayConference: 'Big 12',
        status: 'final',
      },
    ],
    partialFailure: false,
    failedSeasonTypes: [],
  });

  const entry = await loadCanonicalScheduleEntry(YEAR);
  const first = entry!.items[0] as unknown as Record<string, unknown>;
  assert.equal(first.id, '', 'a numeric id is coerced at the boundary');
  assert.equal(first.homeTeam, '');
  assert.equal(first.status, '');
  assert.equal(first.eventKey, '');
  // Coercion is asserted by the VALUES above. What the boundary REPORTS is asserted by
  // content: all four coerced fields are in `LOSSY_COERCIONS`, so all four are reported,
  // each naming the row by position because its id is one of the broken fields.
  assert.deepEqual(entry!.boundaryIssues, [
    "invalid-schedule-row: durable row #0 field id held number, coerced to '' at the read boundary",
    "invalid-schedule-row: durable row #0 field homeTeam held number, coerced to '' at the read boundary",
    "invalid-schedule-row: durable row #0 field status held boolean, coerced to '' at the read boundary",
    "invalid-schedule-row: durable row #0 field eventKey held object, coerced to '' at the read boundary",
  ]);

  // The well-formed row is untouched.
  const second = entry!.items[1] as unknown as Record<string, unknown>;
  assert.equal(second.homeTeam, 'Texas');
});

test('the item-only projection inherits the validation', async () => {
  // `loadCachedScheduleItems` is what the rendering consumers call. If it bypassed the
  // entry reader, every one of them would see raw rows while the route saw validated ones.
  await setAppState('schedule', '2031-all-all', {
    at: 500,
    items: [
      {
        id: 'g1',
        week: 1,
        homeTeam: 99,
        awayTeam: 'Rice',
        homeConference: 'SEC',
        awayConference: 'Big 12',
        status: 'final',
      },
    ],
    partialFailure: false,
    failedSeasonTypes: [],
  });
  const items = await loadCachedScheduleItems(YEAR);
  assert.equal((items[0] as unknown as Record<string, unknown>).homeTeam, '');
});

test('the partition-pair path validates too', async () => {
  // Two construction sites, so two chances to miss one. The pair path builds its
  // entry inline rather than through `normalizeEntry`.
  await setAppState('schedule', '2031-all-regular', {
    at: 400,
    items: [
      {
        id: 'p1',
        week: 1,
        homeTeam: 5,
        awayTeam: 'Rice',
        homeConference: 'SEC',
        awayConference: 'Big 12',
        status: 'final',
      },
    ],
    partialFailure: false,
    failedSeasonTypes: [],
  });
  const entry = await loadCanonicalScheduleEntry(YEAR);
  assert.equal(entry!.source, 'partition-pair');
  assert.equal((entry!.items[0] as unknown as Record<string, unknown>).homeTeam, '');
  // The pair path builds its entry inline, so it is the second place `boundaryIssues`
  // could be forgotten — which would make a legacy store's losses invisible to every
  // durable writer while the aggregate path reported them.
  assert.deepEqual(entry!.boundaryIssues, [
    "invalid-schedule-row: durable row 'p1' field homeTeam held number, coerced to '' at the read boundary",
  ]);
});

test('the durable-writer projection carries the rows AND what the boundary destroyed', async () => {
  // F1: a non-object row beside real ones. It never reaches `buildScheduleFromApi`, so
  // this projection is the only way a durable writer can learn it existed.
  await setAppState('schedule', '2031-all-all', {
    at: 500,
    items: [
      {
        id: 'g1',
        week: 1,
        homeTeam: 'Texas',
        awayTeam: 'Rice',
        homeConference: 'SEC',
        awayConference: 'AAC',
        status: 'final',
      },
      null,
    ],
    partialFailure: false,
    failedSeasonTypes: [],
  });
  const { items, boundaryIssues } = await loadCanonicalScheduleForBuild(YEAR);
  assert.equal(items.length, 1, 'the surviving row is served');
  assert.deepEqual(boundaryIssues, [
    'invalid-schedule-row: durable row #1 is null, not an object — dropped at the read boundary',
  ]);
  // The rendering projection serves the same survivor and says nothing, by design.
  assert.equal((await loadCachedScheduleItems(YEAR)).length, 1);
});

test('a clean read reports nothing — the control for both reports above', async () => {
  await setAppState('schedule', '2031-all-all', {
    at: 500,
    items: [
      {
        id: 'g1',
        week: 1,
        homeTeam: 'Texas',
        awayTeam: 'Rice',
        homeConference: 'SEC',
        awayConference: 'AAC',
        status: 'final',
        label: 99,
      },
    ],
    partialFailure: false,
    failedSeasonTypes: [],
  });
  const { items, boundaryIssues } = await loadCanonicalScheduleForBuild(YEAR);
  assert.equal((items[0] as unknown as Record<string, unknown>).label, '', 'label IS coerced');
  assert.deepEqual(
    boundaryIssues,
    [],
    'a coercion outside LOSSY_COERCIONS changes only what a game displays, so it is not reported'
  );
});

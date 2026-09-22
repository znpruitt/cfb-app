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
import { conformingScheduleRow } from '../../../test/conformingScheduleRow.ts';
import { getAppState } from '../appStateStore.ts';
import { buildScheduleFromApi, type ScheduleWireItem } from '../../schedule.ts';

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

/** A CONFORMING row (PLATFORM-813 v4): the reader rejects one missing a required field. */
function row(id: string, week: number) {
  return conformingScheduleRow({ id, week, homeTeam: `Home ${id}`, awayTeam: `Away ${id}` });
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
// PLATFORM-813 v4, ACCEPTANCE 2 — a well-typed season produces EXACTLY main's output.
//
// "Nothing else changes" is a claim about every well-typed season, so it is checked by
// building the same season through both paths: `main`'s (the raw stored items, straight
// into the build) and the new canonical reader (validated). The fixture covers every row
// kind the build branches on — regular, conference championship, bowl, and a playoff
// national championship — plus optional fields, nested venue and media.
// ---------------------------------------------------------------------------

const TEAMS = [
  { school: 'Alpha U', conference: 'SEC' },
  { school: 'Beta U', conference: 'SEC' },
  { school: 'Gamma U', conference: 'Big Ten' },
  { school: 'Delta U', conference: 'Big Ten' },
];

function wellTypedSeason(): ScheduleWireItem[] {
  return [
    conformingScheduleRow({
      id: 'r1',
      week: 1,
      startDate: '2031-09-01T18:00:00.000Z',
      homeTeam: 'Alpha U',
      awayTeam: 'Gamma U',
      homeConference: 'SEC',
      awayConference: 'Big Ten',
      homeClassification: 'fbs',
      awayClassification: 'fbs',
      status: 'final',
      seasonType: 'regular',
      venue: { stadium: 'Alpha Field', city: 'Alpha', state: 'TX', country: 'USA' },
      media: [{ gameId: 'r1', mediaType: 'tv', outlet: 'ESPN' }],
    }),
    conformingScheduleRow({
      id: 'c1',
      week: 14,
      startDate: '2031-12-06T18:00:00.000Z',
      neutralSite: true,
      conferenceGame: true,
      homeTeam: 'Alpha U',
      awayTeam: 'Beta U',
      homeConference: 'SEC',
      awayConference: 'SEC',
      status: 'final',
      seasonType: 'regular',
      gamePhase: 'conference_championship',
      regularSubtype: 'conference_championship',
      conferenceChampionshipConference: 'SEC',
      eventKey: 'sec-championship',
      slotOrder: 1,
    }),
    conformingScheduleRow({
      id: 'p1',
      week: 1,
      startDate: '2031-12-28T18:00:00.000Z',
      neutralSite: true,
      homeTeam: 'Beta U',
      awayTeam: 'Delta U',
      homeConference: 'SEC',
      awayConference: 'Big Ten',
      status: 'scheduled',
      seasonType: 'postseason',
      gamePhase: 'postseason',
      postseasonSubtype: 'bowl',
      bowlName: 'Orange Bowl',
      label: 'Orange Bowl',
      eventKey: 'orange-bowl',
      venue: 'Hard Rock Stadium',
    }),
    conformingScheduleRow({
      id: 'p2',
      week: 1,
      startDate: '2032-01-10T00:00:00.000Z',
      neutralSite: true,
      homeTeam: 'Alpha U',
      awayTeam: 'Gamma U',
      homeConference: 'SEC',
      awayConference: 'Big Ten',
      status: 'scheduled',
      seasonType: 'postseason',
      gamePhase: 'postseason',
      postseasonSubtype: 'playoff',
      playoffRound: 'national_championship',
      playoffCompetition: 'College Football Playoff',
      playoffRoundSource: 'cfbd-structured',
      startTimeTBD: false,
      completed: false,
    }),
  ];
}

function build(items: ScheduleWireItem[]) {
  return buildScheduleFromApi({ scheduleItems: items, teams: TEAMS, aliasMap: {}, season: YEAR });
}

test("ACCEPTANCE 2: a well-typed season builds EXACTLY main's games, on both reader paths", async () => {
  const season = wellTypedSeason();
  const layouts: Array<{ name: string; seed: () => Promise<void>; raw: () => Promise<unknown[]> }> =
    [
      {
        name: 'aggregate',
        seed: async () => {
          await setAppState('schedule', '2031-all-all', { at: 1, items: season });
        },
        raw: async () =>
          (await getAppState<{ items: unknown[] }>('schedule', '2031-all-all'))!.value!.items,
      },
      {
        name: 'partition pair',
        seed: async () => {
          await setAppState('schedule', '2031-all-regular', { at: 1, items: season.slice(0, 2) });
          await setAppState('schedule', '2031-all-postseason', { at: 1, items: season.slice(2) });
        },
        raw: async () => [
          ...(await getAppState<{ items: unknown[] }>('schedule', '2031-all-regular'))!.value!
            .items,
          ...(await getAppState<{ items: unknown[] }>('schedule', '2031-all-postseason'))!.value!
            .items,
        ],
      },
    ];

  for (const layout of layouts) {
    await __deleteAppStateFileForTests();
    __resetAppStateForTests();
    await layout.seed();

    const mainItems = (await layout.raw()) as ScheduleWireItem[];
    const readerItems = await loadCachedScheduleItems(YEAR);

    assert.deepEqual(
      readerItems,
      mainItems,
      `${layout.name}: the reader returns the stored rows unchanged`
    );
    const mainBuild = build(mainItems);
    assert.equal(mainBuild.games.length, season.length, `${layout.name}: every row is a game`);
    assert.deepEqual(build(readerItems), mainBuild, `${layout.name}: identical build output`);

    // THE COMPARISON CAN FAIL: one well-typed field changed in ONE path only must be seen.
    const mutated = readerItems.map((item, i) => (i === 3 ? { ...item, eventKey: 'cfp-x' } : item));
    assert.notDeepEqual(build(mutated), mainBuild, `${layout.name}: the comparison is sensitive`);
  }
});

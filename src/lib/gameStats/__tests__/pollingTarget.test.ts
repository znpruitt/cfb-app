import assert from 'node:assert/strict';
import test from 'node:test';

import type { CanonicalGame } from '../canonicalSlate.ts';
import {
  POLLING_MAX_KICKOFF_AGE_MS,
  POLLING_MIN_KICKOFF_AGE_MS,
  listKickoffWindowPartitions,
  pollingPartitionKey,
  selectPollingTarget,
  type PollingTargetInput,
} from '../pollingTarget.ts';
import type { WeeklyGameStats } from '../types.ts';
import { canonicalGame, slateOf, v2Row, weeklyRecord } from './c1Fixtures.ts';

// Fixed clock. Kickoff ages are expressed relative to NOW so the 3h–24h
// window arithmetic is explicit in every fixture.
const NOW = new Date('2025-09-07T00:00:00Z');

function kickoffAgedMs(ageMs: number): string {
  return new Date(NOW.getTime() - ageMs).toISOString();
}

const H = 60 * 60 * 1000;

function windowGame(params: {
  id: number;
  ageMs: number | null;
  week?: number;
  seasonType?: 'regular' | 'postseason';
  home?: string;
  away?: string;
  applicability?: CanonicalGame['applicability'];
  notExpectedReason?: 'placeholder' | 'disrupted';
  rawKickoff?: string | null;
}): CanonicalGame {
  const base = canonicalGame({
    providerGameId: params.id,
    home: params.home ?? 'Alpha State',
    away: params.away ?? 'Beta Tech',
    week: params.week ?? 3,
    seasonType: params.seasonType ?? 'regular',
    ...(params.applicability ? { applicability: params.applicability } : {}),
    ...(params.notExpectedReason ? { notExpectedReason: params.notExpectedReason } : {}),
  });
  return {
    ...base,
    kickoff:
      params.rawKickoff !== undefined
        ? params.rawKickoff
        : params.ageMs === null
          ? null
          : kickoffAgedMs(params.ageMs),
  };
}

function inputOf(
  games: CanonicalGame[],
  records: Array<
    [{ year: number; week: number; seasonType: 'regular' | 'postseason' }, WeeklyGameStats | null]
  > = []
): PollingTargetInput {
  const recordsByPartition = new Map<string, WeeklyGameStats | null>();
  for (const [ref, record] of records) {
    recordsByPartition.set(pollingPartitionKey(ref), record);
  }
  return { slate: slateOf(games), now: NOW, seasonRelation: 'current', recordsByPartition };
}

/** A complete, participant-verified row that satisfies the fixture game. */
function satisfyingRow(id: number, home = 'Alpha State', away = 'Beta Tech') {
  return v2Row({
    id,
    home: { school: home, schoolId: schoolIdOf(home) },
    away: { school: away, schoolId: schoolIdOf(away) },
  });
}

function schoolIdOf(school: string): number {
  // Mirrors c1Fixtures SCHOOL_IDS for the schools used here.
  return { 'Alpha State': 101, 'Beta Tech': 202, 'Gamma A&M': 303, 'Delta University': 404 }[
    school
  ]!;
}

// === kickoff window (phase 1) ===

test('window: entry is inclusive at exactly +3h, exit exclusive at exactly +24h', () => {
  const partitions = listKickoffWindowPartitions(
    slateOf([
      windowGame({ id: 1, ageMs: POLLING_MIN_KICKOFF_AGE_MS - 60_000 }), // 2h59m — too fresh
      windowGame({ id: 2, ageMs: POLLING_MIN_KICKOFF_AGE_MS, week: 4 }), // exactly 3h — eligible
      windowGame({ id: 3, ageMs: POLLING_MAX_KICKOFF_AGE_MS - 60_000, week: 5 }), // 23h59m — eligible
      windowGame({ id: 4, ageMs: POLLING_MAX_KICKOFF_AGE_MS, week: 6 }), // exactly 24h — left
    ]),
    NOW
  );
  assert.deepEqual(
    partitions.map((p) => p.week),
    [5, 4] // earliest kickoff first: the 23h59m game kicked off before the 3h game
  );
});

test('window: an invalid injected clock proves nothing — nothing polls', () => {
  const slate = slateOf([windowGame({ id: 1, ageMs: 4 * H })]);
  const invalidNow = new Date('not-a-clock');
  assert.deepEqual(listKickoffWindowPartitions(slate, invalidNow), []);
  assert.equal(
    selectPollingTarget({
      slate,
      now: invalidNow,
      seasonRelation: 'current',
      recordsByPartition: new Map(),
    }),
    null
  );
});

test('window: disrupted, placeholder, and unprovable kickoffs never poll', () => {
  const partitions = listKickoffWindowPartitions(
    slateOf([
      windowGame({
        id: 1,
        ageMs: 4 * H,
        applicability: 'not-expected',
        notExpectedReason: 'disrupted',
      }),
      windowGame({
        id: 2,
        ageMs: 4 * H,
        week: 4,
        applicability: 'not-expected',
        notExpectedReason: 'placeholder',
      }),
      windowGame({ id: 3, ageMs: null, week: 5 }), // kickoff null
      windowGame({ id: 4, ageMs: 0, week: 6, rawKickoff: 'not-a-date' }),
    ]),
    NOW
  );
  assert.deepEqual(partitions, []);
});

test('window: pending applicability still polls (the 6h slate threshold is not a polling gate)', () => {
  // A game 4h after kickoff is `pending` in slate terms (< 6h) but inside the
  // approved 3h–24h polling window.
  const partitions = listKickoffWindowPartitions(
    slateOf([windowGame({ id: 1, ageMs: 4 * H, applicability: 'pending' })]),
    NOW
  );
  assert.equal(partitions.length, 1);
  assert.deepEqual(partitions[0], { year: 2025, week: 3, seasonType: 'regular' });
});

// === target selection (phase 2) ===

test('select: an absent record leaves every window game unresolved → target returned', () => {
  const target = selectPollingTarget(inputOf([windowGame({ id: 1, ageMs: 4 * H })]));
  assert.deepEqual(target, {
    year: 2025,
    week: 3,
    seasonType: 'regular',
    earliestUnresolvedKickoff: kickoffAgedMs(4 * H),
  });
});

test('select: a missing map entry is treated exactly like an absent record', () => {
  // recordsByPartition deliberately empty even though phase 1 listed the partition.
  const target = selectPollingTarget(inputOf([windowGame({ id: 1, ageMs: 4 * H })], []));
  assert.notEqual(target, null);
});

test('select: satisfied evidence resolves the game; a fully resolved partition stops polling', () => {
  const game = windowGame({ id: 101, ageMs: 4 * H });
  const target = selectPollingTarget(
    inputOf(
      [game],
      [
        [
          { year: 2025, week: 3, seasonType: 'regular' },
          weeklyRecord(3, 'regular', [satisfyingRow(101)]),
        ],
      ]
    )
  );
  assert.equal(target, null);
});

test('select: a malformed envelope resolves nothing — it polls and never throws', () => {
  const game = windowGame({ id: 101, ageMs: 4 * H });
  const malformed = new Map<string, unknown>([
    // games is not an array — groupRowsById would throw if this were trusted.
    [
      pollingPartitionKey({ year: 2025, week: 3, seasonType: 'regular' }),
      {
        year: 2025,
        week: 3,
        seasonType: 'regular',
        fetchedAt: '2025-09-07T00:00:00.000Z',
        games: {},
      },
    ],
  ]);
  const target = selectPollingTarget({
    slate: slateOf([game]),
    now: NOW,
    seasonRelation: 'current',
    recordsByPartition: malformed,
  });
  assert.notEqual(target, null);
});

test('select: a partition-mismatched envelope never resolves another partition', () => {
  // A week-4 record (carrying satisfying evidence for the game id) stored
  // under the week-3 key must not suppress week-3 polling.
  const game = windowGame({ id: 101, ageMs: 4 * H });
  const mispaired = new Map<string, unknown>([
    [
      pollingPartitionKey({ year: 2025, week: 3, seasonType: 'regular' }),
      weeklyRecord(4, 'regular', [satisfyingRow(101)]),
    ],
  ]);
  const target = selectPollingTarget({
    slate: slateOf([game]),
    now: NOW,
    seasonRelation: 'current',
    recordsByPartition: mispaired,
  });
  assert.notEqual(target, null);
});

test('select: an invalid fetchedAt envelope resolves nothing', () => {
  const game = windowGame({ id: 101, ageMs: 4 * H });
  const record = { ...weeklyRecord(3, 'regular', [satisfyingRow(101)]), fetchedAt: 'not-a-time' };
  const target = selectPollingTarget({
    slate: slateOf([game]),
    now: NOW,
    seasonRelation: 'current',
    recordsByPartition: new Map<string, unknown>([
      [pollingPartitionKey({ year: 2025, week: 3, seasonType: 'regular' }), record],
    ]),
  });
  assert.notEqual(target, null);
});

test('select: sparse (unsatisfied) evidence keeps the game unresolved within the window', () => {
  const game = windowGame({ id: 101, ageMs: 4 * H });
  const sparse = v2Row({
    id: 101,
    home: { school: 'Alpha State', schoolId: 101, raw: { totalYards: '412' } },
    away: { school: 'Beta Tech', schoolId: 202, raw: { totalYards: '188' } },
  });
  const target = selectPollingTarget(
    inputOf(
      [game],
      [[{ year: 2025, week: 3, seasonType: 'regular' }, weeklyRecord(3, 'regular', [sparse])]]
    )
  );
  assert.notEqual(target, null);
});

test('select: orders by earliest UNRESOLVED kickoff, not earliest window kickoff', () => {
  // Partition week 3: earliest game (15h old) is satisfied; its unresolved
  // game is only 6h old. Partition week 4: unresolved game 10h old. Week 4's
  // unresolved kickoff is earlier → week 4 wins even though week 3 contains
  // the earliest window game overall.
  const satisfied = windowGame({ id: 201, ageMs: 15 * H, week: 3 });
  const laterUnresolved = windowGame({
    id: 202,
    ageMs: 6 * H,
    week: 3,
    home: 'Gamma A&M',
    away: 'Delta University',
  });
  const otherPartition = windowGame({ id: 301, ageMs: 10 * H, week: 4 });
  const target = selectPollingTarget(
    inputOf(
      [satisfied, laterUnresolved, otherPartition],
      [
        [
          { year: 2025, week: 3, seasonType: 'regular' },
          weeklyRecord(3, 'regular', [satisfyingRow(201)]),
        ],
      ]
    )
  );
  assert.equal(target?.week, 4);
  assert.equal(target?.earliestUnresolvedKickoff, kickoffAgedMs(10 * H));
});

test('select: identical kickoffs tie-break regular before postseason, then lower week', () => {
  const regular = windowGame({ id: 1, ageMs: 5 * H, week: 14, seasonType: 'regular' });
  const postseason = windowGame({
    id: 2,
    ageMs: 5 * H,
    week: 1,
    seasonType: 'postseason',
    home: 'Gamma A&M',
    away: 'Delta University',
  });
  assert.equal(selectPollingTarget(inputOf([regular, postseason]))?.seasonType, 'regular');

  const weekEight = windowGame({ id: 3, ageMs: 5 * H, week: 8 });
  const weekNine = windowGame({
    id: 4,
    ageMs: 5 * H,
    week: 9,
    home: 'Gamma A&M',
    away: 'Delta University',
  });
  assert.equal(selectPollingTarget(inputOf([weekEight, weekNine]))?.week, 8);
});

test('select: returns AT MOST one partition no matter how many are unresolved', () => {
  const target = selectPollingTarget(
    inputOf([
      windowGame({ id: 1, ageMs: 4 * H, week: 3 }),
      windowGame({ id: 2, ageMs: 5 * H, week: 4, home: 'Gamma A&M', away: 'Delta University' }),
      windowGame({ id: 3, ageMs: 6 * H, week: 1, seasonType: 'postseason' }),
    ])
  );
  // A single target — the earliest unresolved kickoff (6h old postseason game).
  assert.deepEqual(target, {
    year: 2025,
    week: 1,
    seasonType: 'postseason',
    earliestUnresolvedKickoff: kickoffAgedMs(6 * H),
  });
});

test('select: empty slate and out-of-window slates yield no target and no candidate list', () => {
  assert.equal(selectPollingTarget(inputOf([])), null);
  assert.deepEqual(listKickoffWindowPartitions(slateOf([]), NOW), []);
  assert.equal(selectPollingTarget(inputOf([windowGame({ id: 1, ageMs: 30 * H })])), null);
});

test('pollingPartitionKey: stable year:week:seasonType format', () => {
  assert.equal(
    pollingPartitionKey({ year: 2025, week: 3, seasonType: 'regular' }),
    '2025:3:regular'
  );
  assert.equal(
    pollingPartitionKey({ year: 2025, week: 1, seasonType: 'postseason' }),
    '2025:1:postseason'
  );
});

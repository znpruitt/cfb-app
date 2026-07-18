import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyGameStatsRow,
  isAnalyticsEligible,
  parseV2GameObservation,
  type ParsedV2Observation,
} from '../contract.ts';
import { getCachedGameStats } from '../cache.ts';
import {
  computeWeeklyGameStatsMerge,
  mergeGameStatsPartitionDurable,
  type DurableMergeInput,
} from '../durableMerge.ts';
import type { WeeklyGameStats } from '../types.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateKeyLockFailureForTests,
  __setAppStateReadFailureForTests,
  __setAppStateWriteFailureForTests,
} from '../../server/appStateStore.ts';
import { legacyRowFromWire, wireGame } from './fixtures.ts';

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

const T0 = '2024-10-06T00:00:00.000Z';
const T1 = '2024-10-07T00:00:00.000Z';
const T2 = '2024-10-08T00:00:00.000Z';
const T3 = '2024-10-09T00:00:00.000Z';

const BASE = { year: 2024, week: 6, seasonType: 'regular' as const };

function input(fetchStartedAt: string, observations: ParsedV2Observation[]): DurableMergeInput {
  return { ...BASE, fetchStartedAt, observations };
}

/** Full-stat observation from the shared wire fixture. */
function fullObs(id: number, overrides: Parameters<typeof wireGame>[0] = {}): ParsedV2Observation {
  const parsed = parseV2GameObservation(wireGame({ ...overrides, id }));
  assert.ok(parsed.ok, `fixture observation ${id} parses`);
  return parsed.ok ? parsed.observation : (null as never);
}

/** Observation with EXACTLY the given raw categories per side. */
function customObs(
  id: number,
  sides: {
    home: Record<string, string>;
    away: Record<string, string>;
    homePoints?: number | null;
    awayPoints?: number | null;
    homeTeamId?: number;
  }
): ParsedV2Observation {
  const team = (
    side: 'home' | 'away',
    stats: Record<string, string>,
    points: number | null | undefined,
    teamId?: number
  ) => ({
    teamId: teamId ?? (side === 'home' ? 101 : 202),
    team: side === 'home' ? 'Alpha State' : 'Beta Tech',
    conference: 'Fixture Conference',
    homeAway: side,
    points: points === undefined ? (side === 'home' ? 31 : 17) : points,
    stats: Object.entries(stats).map(([category, stat]) => ({ category, stat })),
  });
  const parsed = parseV2GameObservation({
    id,
    teams: [
      team('home', sides.home, sides.homePoints, sides.homeTeamId),
      team('away', sides.away, sides.awayPoints),
    ],
  });
  assert.ok(parsed.ok, `custom observation ${id} parses`);
  return parsed.ok ? parsed.observation : (null as never);
}

/** Self-hosted v2 partition: built by the merge itself (no hand-rolled rows). */
function v2Partition(fence: string, observations: ParsedV2Observation[]): WeeklyGameStats {
  const computation = computeWeeklyGameStatsMerge(null, input(fence, observations));
  assert.ok(computation.partition, 'seed partition created');
  return computation.partition!;
}

// === Pure decision table ===

test('no partition + no persistable observations → no write, nothing fabricated', () => {
  const empty = computeWeeklyGameStatsMerge(null, input(T1, []));
  assert.equal(empty.changed, false);
  assert.equal(empty.partition, null);

  const unknownOnly = customObs(1, { home: { sacks: '3' }, away: { sacks: '2' } });
  const nonPersistable = computeWeeklyGameStatsMerge(null, input(T1, [unknownOnly]));
  assert.equal(nonPersistable.changed, false);
  assert.equal(nonPersistable.partition, null);
  assert.equal(nonPersistable.skippedNonPersistable, 1);
});

test('no partition + persistable observations → partition created with fenced v2 rows', () => {
  const computation = computeWeeklyGameStatsMerge(null, input(T1, [fullObs(2), fullObs(1)]));
  assert.equal(computation.changed, true);
  assert.deepEqual(computation.inserted, [1, 2]);
  const partition = computation.partition!;
  assert.equal(partition.fetchedAt, T1);
  assert.deepEqual(
    partition.games.map((g) => [g.providerGameId, g.schemaVersion, g.fetchStartedAt]),
    [
      [1, 2, T1],
      [2, 2, T1],
    ]
  );
});

test('legacy row + valid v2 observation → safe field-merge upgrade', () => {
  const legacy = legacyRowFromWire(wireGame({ id: 10 }), 6);
  const existing: WeeklyGameStats = { ...BASE, fetchedAt: T0, games: [legacy] };
  // Sparse newer observation: only totalYards + turnovers, NO points evidence.
  const incoming = customObs(10, {
    home: { totalYards: '450', turnovers: '2' },
    away: { totalYards: '300', turnovers: '0' },
    homePoints: null,
    awayPoints: null,
  });
  const computation = computeWeeklyGameStatsMerge(existing, input(T1, [incoming]));
  assert.deepEqual(computation.updated, [10]);
  const merged = computation.partition!.games[0]!;
  assert.equal(merged.schemaVersion, 2);
  assert.equal(merged.fetchStartedAt, T1);
  // Positively observed fields replaced; strict rebuild reflects them.
  assert.equal(merged.home.raw.totalYards, '450');
  assert.equal(merged.home.totalYards, 450);
  assert.equal(merged.away.turnovers, 0); // explicit zero is evidence
  // Categories the newer observation omitted are preserved as raw evidence.
  assert.equal(merged.home.raw.totalPenaltiesYards, legacy.home.raw.totalPenaltiesYards);
  assert.equal(merged.home.raw.possessionTime, legacy.home.raw.possessionTime);
  // No incoming points evidence: prior number preserved WITHOUT fabricating it.
  assert.equal(merged.home.points, legacy.home.points);
  assert.equal(merged.home.pointsProvided, false);
});

test('newer partial observation preserves prior v2 fields and explicit evidence updates them', () => {
  const existing = v2Partition(T1, [fullObs(20)]);
  const sparse = customObs(20, {
    home: { turnovers: '3', rushingYards: '-12' },
    away: { turnovers: '0' },
    homePoints: 45,
    awayPoints: null,
  });
  const computation = computeWeeklyGameStatsMerge(existing, input(T2, [sparse]));
  assert.deepEqual(computation.updated, [20]);
  const merged = computation.partition!.games[0]!;
  const prior = existing.games[0]!;
  // Preserved prior evidence.
  assert.equal(merged.home.raw.totalYards, prior.home.raw.totalYards);
  assert.equal(merged.home.possessionSeconds, prior.home.possessionSeconds);
  // Explicit newer evidence, including permitted negative yardage and zero.
  assert.equal(merged.home.turnovers, 3);
  assert.equal(merged.home.rushingYards, -12);
  assert.equal(merged.away.turnovers, 0);
  // Explicit points replace on the side with evidence; the side without keeps
  // prior evidence-backed points.
  assert.equal(merged.home.points, 45);
  assert.equal(merged.home.pointsProvided, true);
  assert.equal(merged.away.points, prior.away.points);
  assert.equal(merged.away.pointsProvided, true);
  assert.equal(merged.fetchStartedAt, T2);
});

test('malformed incoming values never clobber prior valid evidence', () => {
  const existing = v2Partition(T1, [fullObs(30)]);
  const incoming = customObs(30, {
    home: { totalYards: 'garbage', turnovers: '2' },
    away: { turnovers: '1' },
  });
  const computation = computeWeeklyGameStatsMerge(existing, input(T2, [incoming]));
  const merged = computation.partition!.games[0]!;
  assert.equal(merged.home.raw.totalYards, existing.games[0]!.home.raw.totalYards);
  assert.equal(merged.home.turnovers, 2);
});

test('games absent from a partial batch are always retained', () => {
  const existing = v2Partition(T1, [fullObs(40), fullObs(41)]);
  const computation = computeWeeklyGameStatsMerge(
    existing,
    input(T2, [customObs(40, { home: { turnovers: '4' }, away: { turnovers: '4' } })])
  );
  assert.deepEqual(computation.retainedExisting, [41]);
  assert.deepEqual(
    computation.partition!.games.map((g) => g.providerGameId),
    [40, 41]
  );
  assert.deepEqual(computation.partition!.games[1], existing.games[1]);
});

test('in-batch duplicates: identical count once, divergent conflict without array-order bias', () => {
  const identical = computeWeeklyGameStatsMerge(null, input(T1, [fullObs(50), fullObs(50)]));
  assert.deepEqual(identical.inserted, [50]);
  assert.deepEqual(identical.conflicts, []);

  const a = fullObs(51);
  const b = fullObs(51, { home: { points: 20 } });
  for (const batch of [
    [a, b],
    [b, a],
  ]) {
    const divergent = computeWeeklyGameStatsMerge(null, input(T1, batch));
    assert.deepEqual(divergent.inserted, []);
    assert.deepEqual(divergent.conflicts, [
      { providerGameId: 51, reason: 'duplicate-incoming-divergent' },
    ]);
    assert.equal(divergent.changed, false);
  }
});

test('observation fencing: stale never overwrites, equal fences never last-writer-win', () => {
  const existing = v2Partition(T2, [fullObs(60)]);

  const stale = computeWeeklyGameStatsMerge(
    existing,
    input(T1, [customObs(60, { home: { turnovers: '9' }, away: { turnovers: '9' } })])
  );
  assert.deepEqual(stale.stale, [60]);
  assert.equal(stale.changed, false);

  const idempotent = computeWeeklyGameStatsMerge(existing, input(T2, [fullObs(60)]));
  assert.deepEqual(idempotent.unchanged, [60]);
  assert.equal(idempotent.changed, false);

  const divergent = computeWeeklyGameStatsMerge(
    existing,
    input(T2, [customObs(60, { home: { turnovers: '9' }, away: { turnovers: '9' } })])
  );
  assert.deepEqual(divergent.conflicts, [{ providerGameId: 60, reason: 'same-fence-divergent' }]);
  assert.equal(divergent.changed, false);
});

test('a strictly newer identical observation is a fence-only durable refresh', () => {
  const existing = v2Partition(T1, [fullObs(70)]);
  const computation = computeWeeklyGameStatsMerge(existing, input(T2, [fullObs(70)]));
  // Freshness evidence is durable evidence: the fence advances via a write.
  assert.deepEqual(computation.refreshed, [70]);
  assert.deepEqual(computation.unchanged, []);
  assert.equal(computation.changed, true);
  const refreshedRow = computation.partition!.games[0]!;
  assert.equal(refreshedRow.fetchStartedAt, T2);
  // Content is byte-preserved apart from the fence.
  assert.deepEqual({ ...refreshedRow, fetchStartedAt: T1 }, existing.games[0]);
});

test('regression: divergent T2 arriving after an identical T3 refresh is stale', async () => {
  // T1: durable state A. T3: identical re-observation. T2 (T1 < T2 < T3):
  // divergent content B. The T3 refresh must have advanced the fence, so the
  // reordered older T2 observation can never roll durable content backward.
  const stateA = customObs(75, { home: { turnovers: '1' }, away: { turnovers: '1' } });
  await mergeGameStatsPartitionDurable(input(T1, [stateA]));
  const refresh = await mergeGameStatsPartitionDurable(input(T3, [stateA]));
  assert.equal(refresh.outcome, 'written');
  assert.deepEqual(refresh.refreshed, [75]);

  const lateDivergent = await mergeGameStatsPartitionDurable(
    input(T2, [customObs(75, { home: { turnovers: '9' }, away: { turnovers: '9' } })])
  );
  assert.equal(lateDivergent.outcome, 'stale');
  assert.deepEqual(lateDivergent.stale, [75]);

  const stored = await getCachedGameStats(2024, 6, 'regular');
  assert.equal(stored!.games[0]!.home.turnovers, 1);
  assert.equal(stored!.games[0]!.fetchStartedAt, T3);
});

test('partial-fence policy: an older disjoint-field observation is rejected wholesale', async () => {
  // Per-game snapshot fencing, explicitly: T3 updates field A (turnovers);
  // the older T2 batch carries a DISJOINT valid field B (firstDowns) — it is
  // still rejected as stale to avoid synthesizing a row from two provider
  // states, at the accepted cost of losing B until a >= T3 observation.
  await mergeGameStatsPartitionDurable(input(T1, [fullObs(76)]));
  await mergeGameStatsPartitionDurable(
    input(T3, [customObs(76, { home: { turnovers: '4' }, away: { turnovers: '4' } })])
  );
  const before = await getCachedGameStats(2024, 6, 'regular');

  const disjoint = await mergeGameStatsPartitionDurable(
    input(T2, [customObs(76, { home: { firstDowns: '30' }, away: { firstDowns: '2' } })])
  );
  assert.equal(disjoint.outcome, 'stale');
  assert.deepEqual(await getCachedGameStats(2024, 6, 'regular'), before);
});

test('strict RFC 3339 fences: acceptance, rejection, and UTC canonicalization', () => {
  for (const bad of [
    '2024-10-06', // date-only
    '2024-10-06 00:00:00Z', // space separator
    '2024-10-06T00:00:00', // no timezone
    '2024-10-06T00:00Z', // no seconds
    'Oct 6 2024 00:00:00 GMT', // locale/month-name form
    '1728172800000', // numeric-looking string
    '2024-13-01T00:00:00Z', // invalid month
    '2024-02-30T00:00:00Z', // invalid calendar date
    '2024-10-06T00:00:00+99:00', // invalid offset
  ]) {
    assert.throws(
      () => computeWeeklyGameStatsMerge(null, input(bad, [fullObs(1)])),
      `fence ${JSON.stringify(bad)} must be rejected`
    );
  }

  // Valid offsets are accepted and canonicalized to UTC ISO before persistence.
  const offsetFence = '2024-10-08T02:00:00+02:00';
  const computation = computeWeeklyGameStatsMerge(null, input(offsetFence, [fullObs(77)]));
  assert.equal(computation.partition!.games[0]!.fetchStartedAt, '2024-10-08T00:00:00.000Z');
  assert.equal(computation.partition!.fetchedAt, '2024-10-08T00:00:00.000Z');
  const fractional = computeWeeklyGameStatsMerge(
    null,
    input('2024-10-08T00:00:00.250Z', [fullObs(78)])
  );
  assert.equal(fractional.partition!.games[0]!.fetchStartedAt, '2024-10-08T00:00:00.250Z');
});

test('legacy normalized evidence survives partial upgrades for every field family', () => {
  // A legacy row whose RAW evidence is gone (or malformed) but whose stored
  // normalized values remain — the pre-086H production reality for fields
  // like passingYards when a category went missing upstream.
  const legacy = legacyRowFromWire(wireGame({ id: 79 }), 6);
  const strippedLegacy = {
    ...legacy,
    home: { ...legacy.home, raw: {} },
    away: { ...legacy.away, raw: { totalYards: 'garbage' } },
  };
  const existing: WeeklyGameStats = { ...BASE, fetchedAt: T0, games: [strippedLegacy] };

  const incoming = customObs(79, {
    home: { turnovers: '5' },
    away: { turnovers: '2' },
    homePoints: null,
    awayPoints: null,
  });
  const computation = computeWeeklyGameStatsMerge(existing, input(T1, [incoming]));
  assert.deepEqual(computation.updated, [79]);
  const merged = computation.partition!.games[0]!;

  // The positively observed field updates…
  assert.equal(merged.home.turnovers, 5);
  // …and EVERY other normalized family keeps its prior stored value instead
  // of collapsing to strict-rebuild zeroes.
  const preservedFields = [
    'totalYards',
    'rushingYards',
    'passingYards',
    'rushingAttempts',
    'passingAttempts',
    'passingCompletions',
    'rushingTDs',
    'passingTDs',
    'firstDowns',
    'fumblesLost',
    'interceptionsThrown',
    'passesIntercepted',
    'fumblesRecovered',
    'thirdDownConversions',
    'thirdDownAttempts',
    'thirdDownPct',
    'fourthDownConversions',
    'fourthDownAttempts',
    'penaltyCount',
    'penaltyYards',
    'possessionSeconds',
    'interceptionReturnYards',
    'interceptionReturnTDs',
    'kickReturnYards',
    'kickReturnTDs',
    'puntReturnYards',
    'puntReturnTDs',
  ] as const;
  for (const field of preservedFields) {
    assert.equal(merged.home[field], legacy.home[field], `home ${field} preserved`);
  }
  // Malformed retained raw (away totalYards) also preserves the stored value.
  assert.equal(merged.away.totalYards, legacy.away.totalYards);
  // Points preserved without fabricated evidence.
  assert.equal(merged.home.points, legacy.home.points);
  assert.equal(merged.home.pointsProvided, false);

  // Compatibility preservation establishes NO strict authority: the merged
  // row lacks required raw evidence, so it is sparse and analytics-ineligible.
  assert.equal(classifyGameStatsRow(merged).state, 'v2-sparse');
  assert.equal(isAnalyticsEligible(merged), false);
});

test('existing durable duplicates: identical collapse on update, divergent conflict — order-free', () => {
  const legacyA = legacyRowFromWire(wireGame({ id: 85 }), 6);
  const otherGame = legacyRowFromWire(wireGame({ id: 86 }), 6);
  const update85 = customObs(85, { home: { turnovers: '3' }, away: { turnovers: '3' } });
  const update86 = customObs(86, { home: { turnovers: '2' }, away: { turnovers: '2' } });

  // Identical duplicates: an accepted update rewrites the game ONCE.
  for (const games of [
    [legacyA, { ...legacyA }, otherGame],
    [otherGame, { ...legacyA }, legacyA],
  ]) {
    const existing: WeeklyGameStats = { ...BASE, fetchedAt: T0, games };
    const computation = computeWeeklyGameStatsMerge(existing, input(T1, [update85]));
    assert.deepEqual(computation.updated, [85]);
    assert.deepEqual(
      computation.partition!.games.map((g) => g.providerGameId).sort((a, b) => a - b),
      [85, 86]
    );
    assert.equal(
      computation.partition!.games.find((g) => g.providerGameId === 85)!.home.turnovers,
      3
    );
  }

  // Identical duplicates NOT addressed by the batch pass through untouched.
  const untouched = computeWeeklyGameStatsMerge(
    { ...BASE, fetchedAt: T0, games: [legacyA, { ...legacyA }, otherGame] },
    input(T1, [update86])
  );
  assert.deepEqual(untouched.retainedExisting, [85]);
  assert.equal(
    untouched.partition!.games.filter((g) => g.providerGameId === 85).length,
    2,
    'unaddressed identical duplicates are preserved as stored'
  );

  // Divergent duplicates: typed conflict, every stored row preserved, and the
  // unrelated game still updates — identically for reversed stored order.
  const divergentTwin = {
    ...legacyA,
    home: { ...legacyA.home, totalYards: 999, raw: { ...legacyA.home.raw, totalYards: '999' } },
  };
  const canonicalRows = (games: readonly { providerGameId: number }[]) =>
    [...games].sort(
      (a, b) =>
        a.providerGameId - b.providerGameId || JSON.stringify(a).localeCompare(JSON.stringify(b))
    );
  const results = [
    [legacyA, divergentTwin, otherGame],
    [otherGame, divergentTwin, legacyA],
  ].map((games) =>
    computeWeeklyGameStatsMerge({ ...BASE, fetchedAt: T0, games }, input(T1, [update85, update86]))
  );
  for (const computation of results) {
    assert.deepEqual(computation.conflicts, [
      { providerGameId: 85, reason: 'duplicate-existing-divergent' },
    ]);
    assert.deepEqual(computation.updated, [86]);
    assert.equal(
      computation.partition!.games.filter((g) => g.providerGameId === 85).length,
      2,
      'both divergent stored rows preserved unchanged'
    );
  }
  assert.deepEqual(
    canonicalRows(results[0]!.partition!.games),
    canonicalRows(results[1]!.partition!.games)
  );
});

test('unsupported and malformed schema versions are preserved untouched as typed conflicts', () => {
  const seed = v2Partition(T1, [fullObs(87), fullObs(88)]);
  const futureRow = { ...seed.games[0]!, schemaVersion: 3 as unknown as 2 };
  const malformedRows = [
    { ...seed.games[0]!, schemaVersion: '2' as unknown as 2 },
    { ...seed.games[0]!, schemaVersion: null as unknown as 2 },
  ];

  const futureExisting: WeeklyGameStats = {
    ...BASE,
    fetchedAt: T0,
    games: [futureRow, seed.games[1]!],
  };
  const computation = computeWeeklyGameStatsMerge(
    futureExisting,
    input(T2, [
      customObs(87, { home: { turnovers: '7' }, away: { turnovers: '7' } }),
      customObs(88, { home: { turnovers: '6' }, away: { turnovers: '6' } }),
    ])
  );
  assert.deepEqual(computation.conflicts, [
    { providerGameId: 87, reason: 'unsupported-schema-version' },
  ]);
  // The unrelated game still updates; the unsupported row is bit-identical.
  assert.deepEqual(computation.updated, [88]);
  assert.deepEqual(
    computation.partition!.games.find((g) => g.providerGameId === 87),
    futureRow
  );

  for (const malformedRow of malformedRows) {
    const badExisting: WeeklyGameStats = { ...BASE, fetchedAt: T0, games: [malformedRow] };
    const badComputation = computeWeeklyGameStatsMerge(
      badExisting,
      input(T2, [customObs(87, { home: { turnovers: '7' }, away: { turnovers: '7' } })])
    );
    assert.deepEqual(badComputation.conflicts, [
      { providerGameId: 87, reason: 'malformed-schema-version' },
    ]);
    assert.equal(badComputation.changed, false);
  }
});

test('identity contradiction preserves durable state as a conflict', () => {
  const existing = v2Partition(T1, [fullObs(80)]);
  const contradicting = customObs(80, {
    home: { turnovers: '1' },
    away: { turnovers: '1' },
    homeTeamId: 999,
  });
  const computation = computeWeeklyGameStatsMerge(existing, input(T2, [contradicting]));
  assert.deepEqual(computation.conflicts, [
    { providerGameId: 80, reason: 'identity-contradiction' },
  ]);
  assert.equal(computation.changed, false);
});

test('an unparsable stored fence blocks the overwrite instead of defeating fencing', () => {
  const seed = v2Partition(T1, [fullObs(90)]);
  const corrupted: WeeklyGameStats = {
    ...seed,
    games: [{ ...seed.games[0]!, fetchStartedAt: 'not-a-time' }],
  };
  const computation = computeWeeklyGameStatsMerge(
    corrupted,
    input(T2, [customObs(90, { home: { turnovers: '5' }, away: { turnovers: '5' } })])
  );
  assert.deepEqual(computation.conflicts, [
    { providerGameId: 90, reason: 'existing-fence-unparsable' },
  ]);
  assert.equal(computation.changed, false);
});

test('merge output is independent of incoming array order', () => {
  const existing = v2Partition(T1, [fullObs(100)]);
  const batch = [
    fullObs(102),
    customObs(100, { home: { turnovers: '7' }, away: { turnovers: '7' } }),
    fullObs(101),
  ];
  const forward = computeWeeklyGameStatsMerge(existing, input(T2, batch));
  const backward = computeWeeklyGameStatsMerge(existing, input(T2, [...batch].reverse()));
  assert.deepEqual(forward, backward);
  assert.deepEqual(forward.inserted, [101, 102]);
  assert.deepEqual(forward.updated, [100]);
});

test('pure merge rejects an unparsable input fence outright', () => {
  assert.throws(() => computeWeeklyGameStatsMerge(null, input('garbage', [fullObs(1)])));
});

// === Durable service ===

test('durable merge creates, then retries idempotently without writing', async () => {
  const first = await mergeGameStatsPartitionDurable(input(T1, [fullObs(200)]));
  assert.equal(first.outcome, 'written');
  assert.deepEqual(first.inserted, [200]);

  const stored = await getCachedGameStats(2024, 6, 'regular');
  assert.equal(stored!.games[0]!.providerGameId, 200);
  assert.equal(stored!.games[0]!.schemaVersion, 2);

  // Retry with a write-failure seam armed: an unchanged merge must not even
  // attempt a durable write, so this succeeds as a no-op.
  __setAppStateWriteFailureForTests(new Error('no writes expected'), 'game-stats');
  const retry = await mergeGameStatsPartitionDurable(input(T1, [fullObs(200)]));
  assert.equal(retry.outcome, 'unchanged');
  __setAppStateWriteFailureForTests(null);
});

test('durable write failure leaves prior state intact and reports unavailable', async () => {
  await mergeGameStatsPartitionDurable(input(T1, [fullObs(210)]));
  const before = await getCachedGameStats(2024, 6, 'regular');

  __setAppStateWriteFailureForTests(new Error('write down'), 'game-stats');
  const result = await mergeGameStatsPartitionDurable(
    input(T2, [customObs(210, { home: { turnovers: '8' }, away: { turnovers: '8' } })])
  );
  __setAppStateWriteFailureForTests(null);
  assert.equal(result.outcome, 'unavailable');
  assert.equal(result.unavailableReason, 'durable-write-failed');
  assert.deepEqual(await getCachedGameStats(2024, 6, 'regular'), before);
});

test('durable read failure is unavailable and never reaches a write', async () => {
  __setAppStateReadFailureForTests(new Error('read down'), 'game-stats');
  __setAppStateWriteFailureForTests(new Error('no writes expected'), 'game-stats');
  const result = await mergeGameStatsPartitionDurable(input(T1, [fullObs(220)]));
  __setAppStateReadFailureForTests(null);
  __setAppStateWriteFailureForTests(null);
  assert.equal(result.outcome, 'unavailable');
  assert.equal(result.unavailableReason, 'durable-read-failed');
});

test('lock acquisition failure is unavailable with durable state untouched', async () => {
  await mergeGameStatsPartitionDurable(input(T1, [fullObs(230)]));
  const before = await getCachedGameStats(2024, 6, 'regular');

  __setAppStateKeyLockFailureForTests(new Error('lock down'), 'game-stats');
  const result = await mergeGameStatsPartitionDurable(
    input(T2, [customObs(230, { home: { turnovers: '6' }, away: { turnovers: '6' } })])
  );
  __setAppStateKeyLockFailureForTests(null);
  assert.equal(result.outcome, 'unavailable');
  assert.equal(result.unavailableReason, 'lock-unavailable');
  assert.deepEqual(await getCachedGameStats(2024, 6, 'regular'), before);
});

test('an invalid input fence is rejected before locking or reading', async () => {
  __setAppStateKeyLockFailureForTests(new Error('lock down'), 'game-stats');
  __setAppStateReadFailureForTests(new Error('read down'), 'game-stats');
  const result = await mergeGameStatsPartitionDurable(input('not-a-time', [fullObs(240)]));
  __setAppStateKeyLockFailureForTests(null);
  __setAppStateReadFailureForTests(null);
  assert.equal(result.outcome, 'unavailable');
  assert.equal(result.unavailableReason, 'invalid-fetch-started-at');
});

test('overlapping writers preserve disjoint updates', async () => {
  await mergeGameStatsPartitionDurable(input(T1, [fullObs(250)]));

  const [a, b] = await Promise.all([
    mergeGameStatsPartitionDurable(
      input(T2, [customObs(250, { home: { turnovers: '5' }, away: { turnovers: '5' } })])
    ),
    mergeGameStatsPartitionDurable(input(T2, [fullObs(251)])),
  ]);
  assert.equal(a.outcome, 'written');
  assert.equal(b.outcome, 'written');

  const stored = await getCachedGameStats(2024, 6, 'regular');
  const ids = stored!.games.map((g) => g.providerGameId).sort((x, y) => x - y);
  assert.deepEqual(ids, [250, 251]);
  const updated = stored!.games.find((g) => g.providerGameId === 250)!;
  assert.equal(updated.home.turnovers, 5);
});

test('a stale writer completing late cannot roll durable state backward', async () => {
  await mergeGameStatsPartitionDurable(
    input(T3, [
      customObs(260, { home: { turnovers: '2', totalYards: '400' }, away: { turnovers: '1' } }),
    ])
  );
  const late = await mergeGameStatsPartitionDurable(
    input(T1, [
      customObs(260, { home: { turnovers: '9', totalYards: '100' }, away: { turnovers: '9' } }),
    ])
  );
  assert.equal(late.outcome, 'stale');
  assert.deepEqual(late.stale, [260]);

  const stored = await getCachedGameStats(2024, 6, 'regular');
  assert.equal(stored!.games[0]!.home.turnovers, 2);
  assert.equal(stored!.games[0]!.home.totalYards, 400);
  assert.equal(stored!.games[0]!.fetchStartedAt, T3);
});

test('mixed batches report partially-merged; pure no-change batches report their cause', async () => {
  // Seed: game 270 fenced at T2, game 271 fenced at T1.
  await mergeGameStatsPartitionDurable(input(T2, [fullObs(270)]));
  await mergeGameStatsPartitionDurable(
    input(T1, [customObs(271, { home: { turnovers: '1' }, away: { turnovers: '1' } })])
  );

  // A T1<mid<T2 batch updates 271, is stale for 270, and inserts 272.
  const mid = '2024-10-07T12:00:00.000Z';
  const mixed = await mergeGameStatsPartitionDurable(
    input(mid, [
      customObs(270, { home: { turnovers: '9' }, away: { turnovers: '9' } }),
      customObs(271, { home: { turnovers: '4' }, away: { turnovers: '4' } }),
      fullObs(272),
    ])
  );
  assert.equal(mixed.outcome, 'partially-merged');
  assert.deepEqual(mixed.updated, [271]);
  assert.deepEqual(mixed.stale, [270]);
  assert.deepEqual(mixed.inserted, [272]);

  // Stale-only → 'stale'; same-fence-divergent-only → 'conflict'.
  const staleOnly = await mergeGameStatsPartitionDurable(
    input(T0, [customObs(270, { home: { turnovers: '8' }, away: { turnovers: '8' } })])
  );
  assert.equal(staleOnly.outcome, 'stale');
  const conflictOnly = await mergeGameStatsPartitionDurable(
    input(T2, [customObs(270, { home: { turnovers: '3' }, away: { turnovers: '3' } })])
  );
  assert.equal(conflictOnly.outcome, 'conflict');
});

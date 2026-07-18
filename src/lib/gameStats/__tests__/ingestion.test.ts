import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deriveSlateExpectation,
  ingestGameStatsObservations,
  providerAddressableId,
  validateGameStatsPayload,
  type ScheduleSlateItem,
} from '../ingestion.ts';
import { getCachedGameStats } from '../cache.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
} from '../../server/appStateStore.ts';
import { legacyRowFromWire, seedGameStatsPartitionForTests, wireGame } from './fixtures.ts';

const NOW = Date.parse('2026-10-15T12:00:00.000Z');
const COMPLETED = '2026-10-11T20:00:00.000Z'; // days before NOW
const RECENT = new Date(NOW - 60 * 60 * 1000).toISOString(); // 1h ago (< 6h threshold)
const FUTURE = '2026-10-18T20:00:00.000Z';
const FENCE = '2026-10-15T12:00:00.000Z';

function item(overrides: Partial<ScheduleSlateItem> & { id: string }): ScheduleSlateItem {
  return {
    week: 3,
    seasonType: 'regular',
    startDate: COMPLETED,
    status: 'STATUS_FINAL',
    ...overrides,
  };
}

function expectationFor(
  items: ScheduleSlateItem[],
  week = 3,
  seasonType: 'regular' | 'postseason' = 'regular'
) {
  return deriveSlateExpectation({ scheduleItems: items, year: 2026, week, seasonType, now: NOW });
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

// === providerAddressableId ===

test('providerAddressableId accepts only positive safe-integer id strings', () => {
  assert.equal(providerAddressableId('401123456'), 401123456);
  assert.equal(providerAddressableId(' 42 '), 42);
  for (const bad of ['', '0', '-5', '4.2', 'tbd-cfp-semi-1', 'abc', null, undefined]) {
    assert.equal(providerAddressableId(bad as string | null | undefined), null, String(bad));
  }
});

// === deriveSlateExpectation ===

test('expectation: completed addressable stat-producing games are expected', () => {
  const expectation = expectationFor([item({ id: '101' }), item({ id: '102' })]);
  assert.deepEqual([...expectation.expectedIds].sort(), [101, 102]);
  assert.equal(expectation.scheduleAvailable, true);
  assert.equal(expectation.deferredPlaceholders, 0);
});

test('expectation: disrupted games are excluded by classification, never expected', () => {
  const expectation = expectationFor([
    item({ id: '101' }),
    item({ id: '102', status: 'Canceled' }),
    item({ id: '103', status: 'Postponed' }),
  ]);
  assert.deepEqual([...expectation.expectedIds], [101]);
  assert.equal(expectation.disrupted, 2);
});

test('expectation: placeholders without a provider-addressable id are deferred, not expected', () => {
  const expectation = expectationFor([
    item({ id: 'cfp-semi-placeholder' }),
    item({ id: '' }),
    item({ id: '104' }),
  ]);
  assert.deepEqual([...expectation.expectedIds], [104]);
  assert.equal(expectation.deferredPlaceholders, 2);
});

test('expectation: games inside the completion threshold (or future/undated) are pending', () => {
  const expectation = expectationFor([
    item({ id: '101' }),
    item({ id: '105', startDate: RECENT }),
    item({ id: '106', startDate: FUTURE }),
    item({ id: '107', startDate: null }),
  ]);
  assert.deepEqual([...expectation.expectedIds], [101]);
  assert.deepEqual([...expectation.pendingIds].sort(), [105, 106, 107]);
});

test('expectation: only the requested slate (week + season type) contributes', () => {
  const expectation = expectationFor([
    item({ id: '101' }),
    item({ id: '201', week: 4 }),
    item({ id: '301', seasonType: 'postseason' }),
  ]);
  assert.deepEqual([...expectation.expectedIds], [101]);
});

test('expectation: an empty schedule reports scheduleAvailable false', () => {
  const expectation = expectationFor([]);
  assert.equal(expectation.scheduleAvailable, false);
  assert.equal(expectation.expectedIds.size, 0);
});

// === validateGameStatsPayload ===

test('validation: a non-array payload is invalid', () => {
  for (const bad of [null, undefined, {}, 'x', 42]) {
    assert.deepEqual(validateGameStatsPayload(bad), { kind: 'invalid-payload' }, String(bad));
  }
});

test('validation: an empty array is a valid empty response', () => {
  assert.deepEqual(validateGameStatsPayload([]), { kind: 'empty' });
});

test('validation: a nonempty payload with zero parseable entries is schema drift', () => {
  const result = validateGameStatsPayload([{ nonsense: true }, 17, null]);
  assert.equal(result.kind, 'schema-drift');
  assert.equal(result.kind === 'schema-drift' && result.entryCount, 3);
});

test('validation: unresolved team identity is counted distinctly', () => {
  const blankIdentity = {
    id: 5002,
    teams: [
      { teamId: 1, team: '   ', conference: 'X', homeAway: 'home', points: 3, stats: [] },
      { teamId: 2, team: 'Beta', conference: 'Y', homeAway: 'away', points: 7, stats: [] },
    ],
  };
  const result = validateGameStatsPayload([wireGame({ id: 5001 }), blankIdentity]);
  assert.equal(result.kind, 'observations');
  if (result.kind === 'observations') {
    assert.equal(result.observations.length, 1);
    assert.equal(result.unresolvedIdentity, 1);
    assert.equal(result.parseFailures['unusable-identity'], 1);
  }
});

// === ingestGameStatsObservations ===

const SLATE = [item({ id: '5001' }), item({ id: '5002' })];

function baseInput(payload: unknown, expectation = expectationFor(SLATE)) {
  return {
    year: 2026,
    week: 3,
    seasonType: 'regular' as const,
    fetchStartedAt: FENCE,
    payload,
    expectation,
  };
}

test('ingest: an empty payload is expected-empty when nothing is expected yet', async () => {
  const expectation = expectationFor([item({ id: '5001', startDate: FUTURE })]);
  const result = await ingestGameStatsObservations(baseInput([], expectation));
  assert.deepEqual(result, { kind: 'valid-empty', emptyContext: 'expected' });
});

test('ingest: an empty payload is UNEXPECTED-empty when completed games expect stats', async () => {
  const result = await ingestGameStatsObservations(baseInput([]));
  assert.deepEqual(result, { kind: 'valid-empty', emptyContext: 'unexpected' });
});

test('ingest: observations outside the canonical schedule never merge (no game creation)', async () => {
  const result = await ingestGameStatsObservations(baseInput([wireGame({ id: 999_999 })]));
  assert.equal(result.kind, 'unmatched-only');
  assert.equal(result.kind === 'unmatched-only' && result.unmatched, 1);
  assert.equal(await getCachedGameStats(2026, 3, 'regular'), null, 'nothing persisted');
});

test('ingest: matched observations with no valid categories are a content failure, not a write', async () => {
  const statless = {
    id: 5001,
    teams: [
      { teamId: 1, team: 'Alpha', conference: 'X', homeAway: 'home', points: 21, stats: [] },
      { teamId: 2, team: 'Beta', conference: 'Y', homeAway: 'away', points: 14, stats: [] },
    ],
  };
  const result = await ingestGameStatsObservations(baseInput([statless]));
  assert.equal(result.kind, 'no-persistable-observations');
  assert.equal(await getCachedGameStats(2026, 3, 'regular'), null, 'nothing persisted');
});

test('ingest: matched observations merge into v2 durable rows; unmatched are dropped', async () => {
  const result = await ingestGameStatsObservations(
    baseInput([wireGame({ id: 5001 }), wireGame({ id: 999_999 })])
  );
  assert.equal(result.kind, 'merged');
  if (result.kind === 'merged') {
    assert.equal(result.merge.outcome, 'written');
    assert.deepEqual(result.merge.inserted, [5001]);
    assert.equal(result.matched, 1);
    assert.equal(result.unmatched, 1);
  }
  const stored = await getCachedGameStats(2026, 3, 'regular');
  assert.equal(stored?.games.length, 1);
  const row = stored!.games[0]!;
  assert.equal(row.providerGameId, 5001);
  assert.equal(row.schemaVersion, 2);
  assert.equal(row.fetchStartedAt, FENCE);
});

test('ingest: a pending (recently kicked off) schedule game may still merge', async () => {
  const expectation = expectationFor([item({ id: '5001', startDate: RECENT })]);
  const result = await ingestGameStatsObservations(
    baseInput([wireGame({ id: 5001 })], expectation)
  );
  assert.equal(result.kind, 'merged');
  const stored = await getCachedGameStats(2026, 3, 'regular');
  assert.equal(stored?.games.length, 1);
});

test('ingest: a partial batch preserves prior durable games (no partition replacement)', async () => {
  await ingestGameStatsObservations(baseInput([wireGame({ id: 5001 }), wireGame({ id: 5002 })]));
  const later = new Date(Date.parse(FENCE) + 60_000).toISOString();
  const result = await ingestGameStatsObservations({
    ...baseInput([wireGame({ id: 5002, home: { points: 45 } })]),
    fetchStartedAt: later,
  });
  assert.equal(result.kind, 'merged');
  if (result.kind === 'merged') {
    assert.deepEqual(result.merge.updated, [5002]);
    assert.deepEqual(result.merge.retainedExisting, [5001], 'the absent game is retained');
  }
  const stored = await getCachedGameStats(2026, 3, 'regular');
  assert.deepEqual(stored!.games.map((g) => g.providerGameId).sort(), [5001, 5002]);
});

test('ingest: an older late-arriving observation is fenced out (stale, no rollback)', async () => {
  await ingestGameStatsObservations(baseInput([wireGame({ id: 5001, home: { points: 31 } })]));
  const older = new Date(Date.parse(FENCE) - 60_000).toISOString();
  const result = await ingestGameStatsObservations({
    ...baseInput([wireGame({ id: 5001, home: { points: 3 } })]),
    fetchStartedAt: older,
  });
  assert.equal(result.kind, 'merged');
  if (result.kind === 'merged') {
    assert.equal(result.merge.outcome, 'stale');
    assert.deepEqual(result.merge.stale, [5001]);
  }
  const stored = await getCachedGameStats(2026, 3, 'regular');
  assert.equal(stored!.games[0]!.home.points, 31, 'newer durable evidence not rolled back');
});

test('ingest: prior LEGACY durable rows upgrade conservatively instead of being replaced', async () => {
  const legacy = legacyRowFromWire(wireGame({ id: 5001 }), 3);
  await seedGameStatsPartitionForTests({
    year: 2026,
    week: 3,
    seasonType: 'regular',
    fetchedAt: '2026-10-12T00:00:00.000Z',
    games: [legacy],
  });
  const result = await ingestGameStatsObservations(baseInput([wireGame({ id: 5001 })]));
  assert.equal(result.kind, 'merged');
  if (result.kind === 'merged') assert.deepEqual(result.merge.updated, [5001]);
  const stored = await getCachedGameStats(2026, 3, 'regular');
  assert.equal(stored!.games[0]!.schemaVersion, 2, 'the row upgraded through the merge');
});

test('ingest: an invalid fence surfaces as a typed unavailable merge, durable untouched', async () => {
  const result = await ingestGameStatsObservations({
    ...baseInput([wireGame({ id: 5001 })]),
    fetchStartedAt: 'not-a-timestamp',
  });
  assert.equal(result.kind, 'merged');
  if (result.kind === 'merged') {
    assert.equal(result.merge.outcome, 'unavailable');
    assert.equal(result.merge.unavailableReason, 'invalid-fetch-started-at');
  }
  assert.equal(await getCachedGameStats(2026, 3, 'regular'), null);
});

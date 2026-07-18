import assert from 'node:assert/strict';
import test from 'node:test';

import { toPublicGameStats, toPublicWeeklyGameStats } from '../publicProjection.ts';
import { mergeGameStatsPartitionDurable } from '../durableMerge.ts';
import { parseV2GameObservation } from '../contract.ts';
import { getCachedGameStats } from '../cache.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
} from '../../server/appStateStore.ts';
import type { WeeklyGameStats } from '../types.ts';
import { completeLegacyRow, wireGame } from './fixtures.ts';

test('legacy rows pass through by reference — public output stays byte-equivalent', () => {
  const row = completeLegacyRow(101);
  assert.equal(toPublicGameStats(row), row, 'same reference, not a reshaped copy');

  const record: WeeklyGameStats = {
    year: 2024,
    week: 5,
    seasonType: 'regular',
    fetchedAt: '2024-10-06T00:00:00.000Z',
    games: [completeLegacyRow(101), completeLegacyRow(102)],
  };
  const projected = toPublicWeeklyGameStats(record);
  assert.equal(projected, record, 'an all-legacy partition is the identical object');
  assert.equal(JSON.stringify(projected), JSON.stringify(record));
});

test('v2 persistence metadata is stripped from the public wire', async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  // Build a REAL v2 row through the production write path (merge authority).
  const parsed = parseV2GameObservation(wireGame({ id: 5001 }));
  assert.ok(parsed.ok);
  const merge = await mergeGameStatsPartitionDurable({
    year: 2026,
    week: 3,
    seasonType: 'regular',
    fetchStartedAt: '2026-10-15T12:00:00.000Z',
    observations: [parsed.ok ? parsed.observation : (null as never)],
  });
  assert.equal(merge.outcome, 'written');
  const stored = await getCachedGameStats(2026, 3, 'regular');
  assert.ok(stored);
  const storedRow = stored!.games[0]!;
  assert.equal(storedRow.schemaVersion, 2, 'precondition: durable row carries v2 metadata');
  assert.ok(storedRow.fetchStartedAt);
  assert.equal(storedRow.home.pointsProvided, true);

  const projected = toPublicWeeklyGameStats(stored!);
  const serialized = JSON.stringify(projected);
  assert.ok(!serialized.includes('schemaVersion'));
  assert.ok(!serialized.includes('fetchStartedAt'));
  assert.ok(!serialized.includes('pointsProvided'));

  // Everything that was always public survives untouched.
  const publicRow = projected.games[0]!;
  assert.equal(publicRow.providerGameId, 5001);
  assert.equal(publicRow.home.points, storedRow.home.points);
  assert.equal(publicRow.home.totalYards, storedRow.home.totalYards);
  assert.deepEqual(publicRow.home.raw, storedRow.home.raw);

  // The projection never mutates the stored record.
  assert.equal(storedRow.schemaVersion, 2);
  assert.equal(storedRow.home.pointsProvided, true);
});

test('a mixed partition strips only the rows that carry metadata', () => {
  const legacy = completeLegacyRow(101);
  const v2ish = {
    ...completeLegacyRow(102),
    schemaVersion: 2 as const,
    fetchStartedAt: '2026-10-15T12:00:00.000Z',
  };
  const record: WeeklyGameStats = {
    year: 2026,
    week: 3,
    seasonType: 'regular',
    fetchedAt: '2026-10-15T12:00:00.000Z',
    games: [legacy, v2ish],
  };
  const projected = toPublicWeeklyGameStats(record);
  assert.notEqual(projected, record);
  assert.equal(projected.games[0], legacy, 'legacy row is the identical object');
  assert.ok(!('schemaVersion' in projected.games[1]!));
  assert.ok(!('fetchStartedAt' in projected.games[1]!));
  assert.equal(projected.games[1]!.providerGameId, 102);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveSlateExpectation, type ScheduleSlateItem } from '../ingestion.ts';
import {
  evaluateGameStatsPartitionCoverage,
  isPartitionRecoverySatisfied,
} from '../partitionCoverage.ts';
import type { GameStats, WeeklyGameStats } from '../types.ts';
import {
  completeLegacyRow,
  legacyRowFromWire,
  statlessLegacyRow,
  v2RowLike,
  wireGame,
} from './fixtures.ts';

const NOW = Date.parse('2026-10-15T12:00:00.000Z');
const COMPLETED = '2026-10-11T20:00:00.000Z';
const FUTURE = '2026-10-18T20:00:00.000Z';

function slate(ids: Array<string | { id: string; startDate?: string; status?: string }>) {
  const items: ScheduleSlateItem[] = ids.map((entry) => {
    const spec = typeof entry === 'string' ? { id: entry } : entry;
    return {
      id: spec.id,
      week: 3,
      seasonType: 'regular',
      startDate: spec.startDate ?? COMPLETED,
      status: spec.status ?? 'STATUS_FINAL',
    };
  });
  return deriveSlateExpectation({
    scheduleItems: items,
    year: 2026,
    week: 3,
    seasonType: 'regular',
    now: NOW,
  });
}

function record(games: GameStats[]): WeeklyGameStats {
  return { year: 2026, week: 3, seasonType: 'regular', fetchedAt: COMPLETED, games };
}

function eligibleLegacy(id: number): GameStats {
  return legacyRowFromWire(wireGame({ id }), 3);
}

const CURRENT = { seasonRelation: 'current' as const };
const HISTORICAL = { seasonRelation: 'historical' as const };

test('coverage: no expected games → not-applicable', () => {
  const coverage = evaluateGameStatsPartitionCoverage(slate([]), null, CURRENT);
  assert.equal(coverage.state, 'not-applicable');
  assert.equal(isPartitionRecoverySatisfied(coverage), true);
});

test('coverage: a missing partition with expected games is absent (all recoverable)', () => {
  const coverage = evaluateGameStatsPartitionCoverage(slate(['101', '102']), null, CURRENT);
  assert.equal(coverage.state, 'absent');
  assert.deepEqual(coverage.absent, [101, 102]);
  assert.equal(isPartitionRecoverySatisfied(coverage), false);
});

test('coverage: analytics-eligible legacy rows satisfy expectations (no forced migration)', () => {
  const coverage = evaluateGameStatsPartitionCoverage(
    slate(['101', '102']),
    record([eligibleLegacy(101), eligibleLegacy(102)]),
    CURRENT
  );
  assert.equal(coverage.state, 'complete');
  assert.deepEqual(coverage.satisfied, [101, 102]);
  assert.equal(isPartitionRecoverySatisfied(coverage), true);
});

test('coverage: complete v2 rows satisfy expectations', () => {
  const coverage = evaluateGameStatsPartitionCoverage(
    slate(['401000020']),
    record([v2RowLike({ id: 401_000_020 }) as unknown as GameStats]),
    CURRENT
  );
  assert.equal(coverage.state, 'complete');
});

test('coverage: partially covered slates report the exact absent games', () => {
  const coverage = evaluateGameStatsPartitionCoverage(
    slate(['101', '102', '103']),
    record([eligibleLegacy(101)]),
    CURRENT
  );
  assert.equal(coverage.state, 'partial');
  assert.deepEqual(coverage.satisfied, [101]);
  assert.deepEqual(coverage.absent, [102, 103]);
});

test('coverage: ineligible durable evidence is recoverable now, manual-only historically', () => {
  const stored = record([statlessLegacyRow(101)]);
  const current = evaluateGameStatsPartitionCoverage(slate(['101']), stored, CURRENT);
  assert.deepEqual(current.recoverable, [101]);
  assert.equal(isPartitionRecoverySatisfied(current), false);

  const historical = evaluateGameStatsPartitionCoverage(slate(['101']), stored, HISTORICAL);
  assert.deepEqual(historical.manualOnly, [101]);
  assert.deepEqual(historical.recoverable, []);
  assert.equal(
    isPartitionRecoverySatisfied(historical),
    true,
    'manual-only gaps are not auto-recovery candidates'
  );
});

test('coverage: unsupported schema versions are blocked, never auto-recovery candidates', () => {
  const blockedRow = { ...completeLegacyRow(101), schemaVersion: 3 } as unknown as GameStats;
  const coverage = evaluateGameStatsPartitionCoverage(
    slate(['101']),
    record([blockedRow]),
    CURRENT
  );
  assert.deepEqual(coverage.blocked, [101]);
  assert.deepEqual(coverage.recoverable, []);
  assert.equal(
    isPartitionRecoverySatisfied(coverage),
    true,
    'a blocked-only gap must not trigger repeated refetch loops'
  );
  assert.notEqual(coverage.state, 'complete', 'blocked evidence is never reported covered');
});

test('coverage: stored rows outside the schedule slate are unmatched, not coverage', () => {
  const coverage = evaluateGameStatsPartitionCoverage(
    slate(['101']),
    record([eligibleLegacy(101), eligibleLegacy(999)]),
    CURRENT
  );
  assert.equal(coverage.state, 'complete');
  assert.deepEqual(coverage.unmatchedStored, [999]);
});

test('coverage: identical duplicates satisfy; divergent duplicates do not', () => {
  const identical = evaluateGameStatsPartitionCoverage(
    slate(['101']),
    record([eligibleLegacy(101), eligibleLegacy(101)]),
    CURRENT
  );
  assert.equal(identical.state, 'complete');

  const divergent = evaluateGameStatsPartitionCoverage(
    slate(['101']),
    record([
      eligibleLegacy(101),
      legacyRowFromWire(wireGame({ id: 101, home: { points: 99 } }), 3),
    ]),
    CURRENT
  );
  assert.equal(divergent.state, 'absent');
  assert.deepEqual(divergent.recoverable, [101]);
});

test('coverage: placeholders and pending games never count absent', () => {
  const expectation = slate(['101', { id: 'cfp-placeholder' }, { id: '102', startDate: FUTURE }]);
  const coverage = evaluateGameStatsPartitionCoverage(
    expectation,
    record([eligibleLegacy(101)]),
    CURRENT
  );
  assert.equal(coverage.state, 'complete');
  assert.equal(coverage.deferredPlaceholders, 1);
  assert.deepEqual(coverage.pending, [102]);
});

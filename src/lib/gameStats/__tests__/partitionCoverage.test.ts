import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluatePartitionCoverage,
  evaluatePartitionCoverageFromResult,
  type GameCoverage,
} from '../partitionCoverage.ts';
import { canonicalGame, legacyRow, slateOf, v2Row, weeklyRecord } from './c1Fixtures.ts';
import { legacyRowFromWire, wireGame } from './fixtures.ts';
import type { SeasonRelation } from '../contract.ts';
import type { GameStats } from '../types.ts';

const G1 = canonicalGame({ providerGameId: 100, home: 'Alpha State', away: 'Beta Tech', week: 3 });
const G2 = canonicalGame({
  providerGameId: 200,
  home: 'Gamma A&M',
  away: 'Delta University',
  week: 3,
});

function completeFor(game: typeof G1, home: [string, number], away: [string, number]): GameStats {
  return v2Row({
    id: game.providerGameId,
    home: { school: home[0], schoolId: home[1] },
    away: { school: away[0], schoolId: away[1] },
    week: 3,
  });
}

const G1_COMPLETE = completeFor(G1, ['Alpha State', 101], ['Beta Tech', 202]);
const G2_COMPLETE = completeFor(G2, ['Gamma A&M', 303], ['Delta University', 404]);

function coverageOf(
  games: (typeof G1)[],
  rows: GameStats[],
  seasonRelation: SeasonRelation = 'current'
) {
  return evaluatePartitionCoverage(
    slateOf(games),
    3,
    'regular',
    weeklyRecord(3, 'regular', rows),
    seasonRelation
  );
}

function gameState(coverage: { games: GameCoverage[] }, id: number): string | undefined {
  return coverage.games.find((g) => g.game.providerGameId === id)?.decision.state;
}

test('coverage: all expected games satisfied → complete', () => {
  const coverage = coverageOf([G1, G2], [G1_COMPLETE, G2_COMPLETE]);
  assert.equal(coverage.state, 'complete');
  assert.equal(gameState(coverage, 100), 'satisfied');
  assert.equal(gameState(coverage, 200), 'satisfied');
});

test('coverage: mixed satisfied + missing → partial with an absent gap', () => {
  const coverage = coverageOf([G1, G2], [G1_COMPLETE]);
  assert.equal(coverage.state, 'partial');
  assert.equal(gameState(coverage, 100), 'satisfied');
  assert.equal(gameState(coverage, 200), 'absent');
});

test('coverage: no rows → absent', () => {
  assert.equal(coverageOf([G1, G2], []).state, 'absent');
});

test('coverage: a sparse-only partition is partial (published-but-incomplete), never absent', () => {
  const sparse = v2Row({
    id: 100,
    home: { school: 'Alpha State', schoolId: 101, points: null },
    away: { school: 'Beta Tech', schoolId: 202 },
    week: 3,
  });
  const coverage = coverageOf([G1], [sparse]);
  assert.equal(gameState(coverage, 100), 'incomplete');
  // Sparse rows publish (visibly incomplete), so the partition must not read as
  // `absent` while a public row exists — it is `partial`.
  assert.equal(coverage.state, 'partial');
});

test('coverage: no expected games → not-applicable', () => {
  const pending = canonicalGame({
    providerGameId: 300,
    home: 'Alpha State',
    away: 'Beta Tech',
    week: 3,
    applicability: 'pending',
  });
  const coverage = coverageOf([pending], []);
  assert.equal(coverage.state, 'not-applicable');
  assert.equal(coverage.games.length, 0);
  // Pending games are reported, never gaps.
  assert.deepEqual(
    coverage.pending.map((g) => g.providerGameId),
    [300]
  );
});

test('coverage: contradicted-participant evidence → identity-mismatch gap; quarantined, never coverage', () => {
  const wrong = completeFor(G1, ['Gamma A&M', 303], ['Beta Tech', 202]); // fully-resolved wrong pair
  const coverage = coverageOf([G1], [wrong]);
  assert.equal(gameState(coverage, 100), 'identity-mismatch');
  assert.equal(coverage.state, 'absent'); // 0 satisfied
  assert.ok(coverage.quarantined.some((m) => m.providerGameId === 100));
});

test('coverage: an unresolved-participant row still satisfies (id authority), flagged unverified', () => {
  const unverified = completeFor(G1, ['Totally Unknown', 501], ['Beta Tech', 202]);
  const coverage = coverageOf([G1], [unverified]);
  assert.equal(gameState(coverage, 100), 'satisfied');
  assert.equal(coverage.state, 'complete');
  assert.deepEqual(
    coverage.integrityWarnings.map((w) => [w.providerGameId, w.integrity]),
    [[100, 'unverified']]
  );
  assert.deepEqual(coverage.quarantined, []);
});

test('coverage: a canonical participant change invalidates a previously-satisfying stored row', () => {
  // The stored row satisfied the OLD pair (Alpha vs Beta); the schedule now pairs
  // Alpha vs Gamma, so the same bytes no longer match → identity-mismatch.
  const rescheduled = canonicalGame({
    providerGameId: 100,
    home: 'Alpha State',
    away: 'Gamma A&M',
    week: 3,
  });
  const coverage = coverageOf([rescheduled], [G1_COMPLETE]);
  assert.equal(gameState(coverage, 100), 'identity-mismatch');
});

test('coverage: divergent authoritative duplicates → duplicate-conflict gap', () => {
  const a = legacyRow({
    id: 100,
    home: { school: 'Alpha State', teamId: 101 },
    away: { school: 'Beta Tech', teamId: 202 },
    week: 3,
  });
  const b = legacyRowFromWire(
    wireGame({ id: 100, home: { statOverrides: { firstDowns: '77' } } }),
    3
  );
  const coverage = coverageOf([G1], [a, b]);
  assert.equal(gameState(coverage, 100), 'duplicate-conflict');
  assert.deepEqual(coverage.duplicateConflicts, [100]);
});

test('coverage: participant-matching unsupported schema → blocked gap → partition blocked', () => {
  const unsupported = { ...G1_COMPLETE, schemaVersion: 5 } as unknown as GameStats;
  const coverage = coverageOf([G1], [unsupported]);
  assert.equal(gameState(coverage, 100), 'blocked-unsupported-schema');
  assert.equal(coverage.state, 'blocked');
});

test('coverage: only defective evidence → season-relative (historical manual-only, current absent)', () => {
  const defective = legacyRowFromWire(
    wireGame({ id: 100, home: { statOverrides: { totalYards: 'xx' } } }),
    3
  );
  // Historical: terminal manual-only gap → partition manual-only.
  const historical = coverageOf([G1], [defective], 'historical');
  assert.equal(gameState(historical, 100), 'manual-only');
  assert.equal(historical.state, 'manual-only');
  // Current: recoverable → plain absent gap → partition absent.
  const current = coverageOf([G1], [defective], 'current');
  assert.equal(gameState(current, 100), 'absent');
  assert.equal(current.state, 'absent');
});

test('coverage: unscheduled stored rows are reported unmatched, never coverage', () => {
  const stray = completeFor(
    canonicalGame({ providerGameId: 999, home: 'Alpha State', away: 'Beta Tech', week: 3 }),
    ['Alpha State', 101],
    ['Beta Tech', 202]
  );
  const coverage = coverageOf([G1], [G1_COMPLETE, stray]);
  assert.equal(coverage.state, 'complete'); // the one expected game is satisfied
  assert.deepEqual(coverage.unmatchedStoredIds, [999]);
});

test('coverage: a partition-disagreeing row for a NON-expected scheduled game is reported unassociated', () => {
  // A pending (non-expected) scheduled game in this partition.
  const pending = canonicalGame({
    providerGameId: 300,
    home: 'Gamma A&M',
    away: 'Delta University',
    week: 3,
    applicability: 'pending',
  });
  // Its stored row's OWN partition week disagrees (week 9, not the requested 3).
  const strayPartition = v2Row({
    id: 300,
    home: { school: 'Gamma A&M', schoolId: 303 },
    away: { school: 'Delta University', schoolId: 404 },
    week: 9,
  });
  const coverage = coverageOf([G1, pending], [G1_COMPLETE, strayPartition]);
  // The pending game is never a coverage gap…
  assert.equal(
    coverage.games.some((g) => g.game.providerGameId === 300),
    false
  );
  // …and its id is scheduled, so the row is NOT "unmatched"…
  assert.equal(coverage.unmatchedStoredIds.includes(300), false);
  // …but the partition disagreement is still surfaced (no longer vanishes).
  assert.ok(
    coverage.unassociated.some((u) => u.providerGameId === 300 && u.reason === 'partition-mismatch')
  );
});

test('coverage: a shadowed lower-precedence candidate is reported separately', () => {
  const legacy = legacyRow({
    id: 100,
    home: { school: 'Alpha State', teamId: 101 },
    away: { school: 'Beta Tech', teamId: 202 },
    week: 3,
  });
  const coverage = coverageOf([G1], [legacy, G1_COMPLETE]);
  assert.equal(gameState(coverage, 100), 'satisfied');
  assert.deepEqual(
    coverage.shadowed.map((s) => s.source),
    ['legacy-compatible']
  );
});

test('coverage: placeholder games are reported deferred, never expected', () => {
  const placeholder = canonicalGame({
    providerGameId: 400,
    home: 'Alpha State',
    away: 'Beta Tech',
    week: 3,
    applicability: 'not-expected',
    notExpectedReason: 'placeholder',
  });
  const coverage = coverageOf([G1, placeholder], [G1_COMPLETE]);
  assert.equal(coverage.state, 'complete');
  assert.deepEqual(
    coverage.deferredPlaceholders.map((g) => g.providerGameId),
    [400]
  );
});

test('coverage: unavailable slate context → coverage unavailable (never fabricated absence)', () => {
  const result = evaluatePartitionCoverageFromResult(
    { status: 'unavailable', reason: 'catalog-load-failed' },
    3,
    'regular',
    weeklyRecord(3, 'regular', []),
    'current'
  );
  assert.equal(result.status, 'unavailable');
  if (result.status === 'unavailable') assert.equal(result.reason, 'catalog-load-failed');
});

test('coverage: a null durable record leaves every expected game absent', () => {
  const coverage = evaluatePartitionCoverage(slateOf([G1, G2]), 3, 'regular', null, 'current');
  assert.equal(coverage.state, 'absent');
  assert.equal(coverage.games.length, 2);
});

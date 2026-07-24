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

test('coverage: an id-associated row with a wrong numeric participant is identity-mismatch (PLATFORM-086H3C5)', () => {
  // The CFBD game id + partition still associate the row, but the C1-era
  // "satisfies regardless of stored participant labels" deferral is superseded:
  // the schedule's numeric ids (101/202) are known, the stored home side proves
  // a different school id (303), so the game is a fail-closed identity mismatch
  // — never satisfied coverage.
  const usable = completeFor(G1, ['Gamma A&M', 303], ['Beta Tech', 202]);
  const coverage = coverageOf([G1], [usable]);
  assert.equal(gameState(coverage, 100), 'identity-mismatch');
  // A partition whose only evidence is a nonpublishable validation gap keeps
  // the existing coarse vocabulary (no new partition state).
  assert.equal(coverage.state, 'absent');
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

// === PLATFORM-086H3C5: participant-validation coverage states ===

test('coverage: missing schedule participant ids → per-game participant-validation-unavailable (never mismatch, never absence)', () => {
  // Models an old durable schedule cache written before participant-id
  // persistence: the canonical game carries null ids, so its otherwise
  // satisfied-quality row fails CLOSED as validation-unavailable.
  const oldCacheGame = canonicalGame({
    providerGameId: 100,
    home: 'Alpha State',
    away: 'Beta Tech',
    week: 3,
    homeId: null,
    awayId: null,
  });
  const coverage = coverageOf([oldCacheGame], [G1_COMPLETE]);
  assert.equal(gameState(coverage, 100), 'participant-validation-unavailable');
  const decision = coverage.games[0]?.decision;
  assert.equal(decision?.participantValidation, 'schedule-ids-unavailable');
  assert.equal(decision?.selected, null);
});

test('coverage: mixed verified + validation-gap coverage is partial', () => {
  const gapGame = canonicalGame({
    providerGameId: 200,
    home: 'Gamma A&M',
    away: 'Delta University',
    week: 3,
    homeId: null,
    awayId: null,
  });
  const coverage = coverageOf([G1, gapGame], [G1_COMPLETE, G2_COMPLETE]);
  assert.equal(coverage.state, 'partial');
  assert.equal(gameState(coverage, 100), 'satisfied');
  assert.equal(gameState(coverage, 200), 'participant-validation-unavailable');
});

test('coverage: verified rows still satisfy through the shared decision (validation is invisible to satisfied coverage)', () => {
  const coverage = coverageOf([G1, G2], [G1_COMPLETE, G2_COMPLETE]);
  assert.equal(coverage.state, 'complete');
  for (const g of coverage.games) {
    assert.equal(g.decision.state, 'satisfied');
    assert.equal(g.decision.participantValidation, 'verified');
  }
});

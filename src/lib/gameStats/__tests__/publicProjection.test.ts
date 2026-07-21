import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluatePartitionCoverage } from '../partitionCoverage.ts';
import {
  projectAnalyticsPartition,
  projectPublicPartition,
  type PublicProjectionResult,
} from '../publicProjection.ts';
import { canonicalGame, slateOf, v2Row, weeklyRecord } from './c1Fixtures.ts';
import type { CanonicalSlateResult } from '../canonicalSlate.ts';
import type { GameStats } from '../types.ts';

const G1 = canonicalGame({ providerGameId: 100, home: 'Alpha State', away: 'Beta Tech', week: 3 });
const G2 = canonicalGame({
  providerGameId: 200,
  home: 'Gamma A&M',
  away: 'Delta University',
  week: 3,
});

const SLATE: CanonicalSlateResult = { status: 'available', slate: slateOf([G1, G2]) };

const G1_COMPLETE = v2Row({
  id: 100,
  home: {
    school: 'Alpha State',
    schoolId: 101,
    raw: {
      totalYards: '412',
      rushingYards: '187',
      netPassingYards: '225',
      turnovers: '1',
      thirdDownEff: '6-14',
      possessionTime: '31:24',
      sacks: '3',
    },
  },
  away: { school: 'Beta Tech', schoolId: 202 },
  week: 3,
});
const G2_SPARSE = v2Row({
  id: 200,
  home: { school: 'Gamma A&M', schoolId: 303, points: null },
  away: { school: 'Delta University', schoolId: 404 },
  week: 3,
});

function project(read: Parameters<typeof projectPublicPartition>[3]): PublicProjectionResult {
  return projectPublicPartition(SLATE, 3, 'regular', read);
}

// === Envelope validation (distinct outcomes) ===

test('envelope: durable-read failure is distinct from absence', () => {
  assert.equal(project({ status: 'read-failed' }).status, 'read-failure');
  assert.equal(project({ status: 'ok', value: null }).status, 'absent');
});

test('envelope: malformed envelope is distinct from a non-array games payload', () => {
  assert.equal(project({ status: 'ok', value: 42 }).status, 'malformed-envelope');
  assert.equal(project({ status: 'ok', value: [] }).status, 'malformed-envelope');
  assert.equal(
    project({ status: 'ok', value: { year: 2025, week: 3 } }).status,
    'malformed-envelope'
  );
  assert.equal(
    project({
      status: 'ok',
      value: {
        year: 2025,
        week: 3,
        seasonType: 'regular',
        fetchedAt: '2025-09-08T00:00:00.000Z',
        games: 'nope',
      },
    }).status,
    'non-array-games'
  );
});

test('envelope: partition mismatch and invalid fetchedAt are their own outcomes', () => {
  assert.equal(
    project({ status: 'ok', value: weeklyRecord(9, 'regular', []) }).status,
    'partition-mismatch'
  );
  assert.equal(
    project({
      status: 'ok',
      value: { year: 2025, week: 3, seasonType: 'regular', fetchedAt: 'not-a-time', games: [] },
    }).status,
    'invalid-fetched-at'
  );
});

test('envelope: an unavailable slate context is distinct from every envelope outcome', () => {
  const result = projectPublicPartition(
    { status: 'unavailable', reason: 'schedule-load-failed' },
    3,
    'regular',
    { status: 'ok', value: weeklyRecord(3, 'regular', []) }
  );
  assert.equal(result.status, 'context-unavailable');
});

// === Public wire ===

test('public wire: every satisfied game publishes; sparse rows publish visibly incomplete', () => {
  const result = project({
    status: 'ok',
    value: weeklyRecord(3, 'regular', [G1_COMPLETE, G2_SPARSE]),
  });
  assert.equal(result.status, 'available');
  if (result.status !== 'available') return;

  const byId = new Map(result.wire.games.map((g) => [g.providerGameId, g]));
  assert.equal(byId.get(100)?.complete, true); // satisfied
  assert.equal(byId.get(200)?.complete, false); // sparse → incomplete

  assert.equal(result.wire.availability.satisfied, 1);
  assert.equal(result.wire.availability.incomplete, 1);
  assert.equal(result.wire.availability.published, 2);
  assert.equal(result.wire.availability.partitionState, 'partial');
});

test('public wire: allowlisted only — no internal metadata, unrecognized raw stripped', () => {
  const result = project({ status: 'ok', value: weeklyRecord(3, 'regular', [G1_COMPLETE]) });
  assert.equal(result.status, 'available');
  if (result.status !== 'available') return;

  const game = result.wire.games[0]!;
  // Internal persistence metadata never reaches the wire.
  assert.equal('schemaVersion' in game, false);
  assert.equal('fetchStartedAt' in game, false);
  assert.equal('pointsProvided' in game.home, false);
  // Explicit public fields ARE present.
  assert.equal(game.home.school, 'Alpha State');
  assert.equal(game.home.totalYards, 412);
  assert.equal(game.home.points, 31);
  // Recognized raw is kept; the unrecognized `sacks` category is stripped.
  assert.equal(game.home.raw.totalYards, '412');
  assert.equal('sacks' in game.home.raw, false);
});

test('public wire: a coverage-satisfied game always yields a public row', () => {
  const result = project({ status: 'ok', value: weeklyRecord(3, 'regular', [G1_COMPLETE]) });
  assert.equal(result.status, 'available');
  if (result.status !== 'available') return;
  assert.equal(result.wire.availability.satisfied, 1);
  assert.ok(result.wire.games.some((g) => g.providerGameId === 100));
});

// === Analytics projection ===

test('analytics projection: only complete/legacy satisfied rows; sparse excluded', () => {
  const coverage = evaluatePartitionCoverage(
    slateOf([G1, G2]),
    3,
    'regular',
    weeklyRecord(3, 'regular', [G1_COMPLETE, G2_SPARSE])
  );
  const analytics = projectAnalyticsPartition(coverage);
  assert.equal(analytics.length, 1);
  assert.equal(analytics[0]?.providerGameId, 100);
  assert.equal(analytics[0]?.source, 'v2');
  // Strictly reparsed evidence (not stored fallbacks).
  assert.equal(analytics[0]?.home.totalYards, 412);
});

test('analytics projection: an absent-coverage partition projects nothing', () => {
  const coverage = evaluatePartitionCoverage(
    slateOf([G1, G2]),
    3,
    'regular',
    weeklyRecord(3, 'regular', [])
  );
  assert.deepEqual(projectAnalyticsPartition(coverage), []);
});

// Sanity: the sparse fixture really is sparse (guards the tests above).
test('fixture sanity: the sparse row is v2-sparse, the complete row is v2-complete', () => {
  const complete: GameStats = G1_COMPLETE;
  assert.equal(complete.schemaVersion, 2);
  assert.equal(complete.home.pointsProvided, true);
  assert.equal(G2_SPARSE.home.pointsProvided, false);
});

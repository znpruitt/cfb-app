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
import type { CanonicalGame } from '../canonicalSlate.ts';
import type { ScorePack } from '../../scores.ts';

/** A minimal ScorePack carrying only the status the finality gate reads. */
function scorePack(status: string): ScorePack {
  return { status, home: { team: 'H', score: null }, away: { team: 'A', score: null }, time: null };
}

/** Coverage for the fixed week-3 regular partition over the given games + rows. */
function coverageFor(games: CanonicalGame[], rows: GameStats[]) {
  return evaluatePartitionCoverage(
    slateOf(games),
    3,
    'regular',
    weeklyRecord(3, 'regular', rows),
    'current'
  );
}

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
const G2_COMPLETE = v2Row({
  id: 200,
  home: {
    school: 'Gamma A&M',
    schoolId: 303,
    raw: {
      totalYards: '350',
      rushingYards: '150',
      netPassingYards: '200',
      turnovers: '2',
      thirdDownEff: '5-12',
      possessionTime: '28:00',
    },
  },
  away: { school: 'Delta University', schoolId: 404 },
  week: 3,
});

// Score maps are keyed by canonical `AppGame.eventId` (the fixture uses `evt-<id>`).
const FINAL_100: Record<string, ScorePack> = { 'evt-100': scorePack('final') };
const BOTH_FINAL: Record<string, ScorePack> = {
  'evt-100': scorePack('final'),
  'evt-200': scorePack('final'),
};

function project(read: Parameters<typeof projectPublicPartition>[3]): PublicProjectionResult {
  return projectPublicPartition(SLATE, 3, 'regular', read, 'current');
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
    { status: 'ok', value: weeklyRecord(3, 'regular', []) },
    'current'
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

// === Analytics projection (finality-gated: PLATFORM-086H3C3) ===

test('analytics projection: only complete satisfied rows WITH a final score; sparse excluded', () => {
  const coverage = coverageFor([G1, G2], [G1_COMPLETE, G2_SPARSE]);
  const analytics = projectAnalyticsPartition(coverage, BOTH_FINAL);
  assert.equal(analytics.length, 1);
  assert.equal(analytics[0]?.providerGameId, 100);
  assert.equal(analytics[0]?.source, 'v2');
  // Strictly reparsed evidence (not stored fallbacks).
  assert.equal(analytics[0]?.home.totalYards, 412);
});

test('analytics projection: an absent-coverage partition projects nothing (even with final scores)', () => {
  const coverage = coverageFor([G1, G2], []);
  assert.deepEqual(projectAnalyticsPartition(coverage, BOTH_FINAL), []);
});

// --- Approved finality × completeness matrix ---

test('matrix: FINAL score + COMPLETE evidence → included', () => {
  const coverage = coverageFor([G1], [G1_COMPLETE]);
  assert.deepEqual(
    projectAnalyticsPartition(coverage, FINAL_100).map((a) => a.providerGameId),
    [100]
  );
});

test('matrix: FINAL score + INCOMPLETE (sparse) evidence → excluded', () => {
  const coverage = coverageFor([G2], [G2_SPARSE]);
  assert.deepEqual(projectAnalyticsPartition(coverage, { 'evt-200': scorePack('final') }), []);
});

test('matrix: IN-PROGRESS score + COMPLETE evidence → excluded', () => {
  const coverage = coverageFor([G1], [G1_COMPLETE]);
  assert.deepEqual(
    projectAnalyticsPartition(coverage, { 'evt-100': scorePack('in_progress') }),
    []
  );
});

test('matrix: SCHEDULED score + COMPLETE evidence → excluded', () => {
  const coverage = coverageFor([G1], [G1_COMPLETE]);
  assert.deepEqual(projectAnalyticsPartition(coverage, { 'evt-100': scorePack('scheduled') }), []);
});

test('matrix: MISSING score + COMPLETE evidence → excluded', () => {
  const coverage = coverageFor([G1], [G1_COMPLETE]);
  // No key for evt-100: classifyScorePackStatus(undefined) === 'scheduled' → excluded.
  assert.deepEqual(projectAnalyticsPartition(coverage, {}), []);
});

test('matrix: FINAL score + BLOCKED (unsupported schema) evidence → excluded', () => {
  const blocked = { ...G1_COMPLETE, schemaVersion: 5 } as unknown as GameStats;
  const coverage = coverageFor([G1], [blocked]);
  // Sanity: the game is genuinely non-satisfied (blocked), not merely sparse.
  assert.equal(coverage.games[0]?.decision.state, 'blocked-unsupported-schema');
  assert.deepEqual(projectAnalyticsPartition(coverage, FINAL_100), []);
});

test('matrix: only one FINAL among several complete games → only the final game included', () => {
  const coverage = coverageFor([G1, G2], [G1_COMPLETE, G2_COMPLETE]);
  // Both satisfied; only G1 has a final score.
  assert.equal(
    coverage.games.every((g) => g.decision.state === 'satisfied'),
    true
  );
  const out = projectAnalyticsPartition(coverage, {
    'evt-100': scorePack('final'),
    'evt-200': scorePack('scheduled'),
  });
  assert.deepEqual(
    out.map((a) => a.providerGameId),
    [100]
  );
});

// --- Shared status-classifier consistency ---

test('separator/case variants of a final status all gate to included; live/disrupted do not', () => {
  const coverage = coverageFor([G1], [G1_COMPLETE]);
  for (const finalLabel of ['final', 'FINAL', 'Final', 'STATUS_FINAL', 'status final']) {
    assert.deepEqual(
      projectAnalyticsPartition(coverage, { 'evt-100': scorePack(finalLabel) }).map(
        (a) => a.providerGameId
      ),
      [100],
      finalLabel
    );
  }
  for (const nonFinal of [
    'STATUS_IN_PROGRESS',
    'in_progress',
    'STATUS_CANCELED',
    'postponed',
    '',
  ]) {
    assert.deepEqual(
      projectAnalyticsPartition(coverage, { 'evt-100': scorePack(nonFinal) }),
      [],
      nonFinal
    );
  }
});

test('no raw schedule status can make a game eligible without an attached final score', () => {
  // The canonical game itself reports rawStatus 'final' (schedule authority), but
  // finality for analytics comes ONLY from the attached score map.
  assert.equal(G1.rawStatus, 'final');
  const coverage = coverageFor([G1], [G1_COMPLETE]);
  // No attached score → excluded despite the schedule saying 'final'.
  assert.deepEqual(projectAnalyticsPartition(coverage, {}), []);
  // An attached non-final score overrides the schedule's 'final' rawStatus.
  assert.deepEqual(
    projectAnalyticsPartition(coverage, { 'evt-100': scorePack('in_progress') }),
    []
  );
});

test('the score-map argument is mandatory (compile-time required, runtime-guarded)', () => {
  const coverage = coverageFor([G1], [G1_COMPLETE]);
  // @ts-expect-error scoresByKey is a REQUIRED parameter — omitting it must not typecheck.
  assert.throws(() => projectAnalyticsPartition(coverage));
});

// Sanity: the sparse fixture really is sparse (guards the tests above).
test('fixture sanity: the sparse row is v2-sparse, the complete row is v2-complete', () => {
  const complete: GameStats = G1_COMPLETE;
  assert.equal(complete.schemaVersion, 2);
  assert.equal(complete.home.pointsProvided, true);
  assert.equal(G2_SPARSE.home.pointsProvided, false);
});

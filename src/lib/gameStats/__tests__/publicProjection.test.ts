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
import type { GameStats, WeeklyGameStats } from '../types.ts';
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

// Score maps are keyed by the canonical ATTACHMENT key `AppGame.key` (the fixture
// uses `key-<id>`, deliberately distinct from `eventId` `evt-<id>`).
const FINAL_100: Record<string, ScorePack> = { 'key-100': scorePack('final') };
const BOTH_FINAL: Record<string, ScorePack> = {
  'key-100': scorePack('final'),
  'key-200': scorePack('final'),
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

// === Analytics projection (finality-gated C3, readiness-corrected C4) ===

/**
 * Project analytics for the fixed week-3 regular partition through the C4
 * paired-input signature. `rows === null` models a caller-established ABSENT
 * partition (never a read failure).
 */
function analyticsFor(
  games: CanonicalGame[],
  rows: GameStats[] | null,
  scoresByKey: Record<string, ScorePack>
) {
  return projectAnalyticsPartition(
    { slate: slateOf(games), scoresByKey },
    3,
    'regular',
    rows === null ? null : weeklyRecord(3, 'regular', rows),
    'current'
  );
}

test('analytics projection: only complete satisfied rows WITH a final score; sparse excluded', () => {
  const analytics = analyticsFor([G1, G2], [G1_COMPLETE, G2_SPARSE], BOTH_FINAL);
  assert.equal(analytics.length, 1);
  assert.equal(analytics[0]?.providerGameId, 100);
  assert.equal(analytics[0]?.source, 'v2');
  // Strictly reparsed evidence (not stored fallbacks).
  assert.equal(analytics[0]?.home.totalYards, 412);
});

test('analytics projection: committedRecord null (absent partition) projects nothing, even with final scores', () => {
  assert.deepEqual(analyticsFor([G1, G2], null, BOTH_FINAL), []);
  // An empty committed record is equally evidence-free.
  assert.deepEqual(analyticsFor([G1, G2], [], BOTH_FINAL), []);
});

test('analytics projection: a mismatched committed envelope fails closed', () => {
  const input = { slate: slateOf([G1]), scoresByKey: FINAL_100 };
  // Right rows, wrong envelope identity — every disagreement yields NO evidence.
  const wrongWeek = weeklyRecord(9, 'regular', [G1_COMPLETE]);
  const wrongType = weeklyRecord(3, 'postseason', [G1_COMPLETE]);
  const wrongYear = weeklyRecord(3, 'regular', [G1_COMPLETE], 2024);
  assert.deepEqual(projectAnalyticsPartition(input, 3, 'regular', wrongWeek, 'current'), []);
  assert.deepEqual(projectAnalyticsPartition(input, 3, 'regular', wrongType, 'current'), []);
  assert.deepEqual(projectAnalyticsPartition(input, 3, 'regular', wrongYear, 'current'), []);
  // Sanity: the agreeing envelope DOES project.
  assert.equal(
    projectAnalyticsPartition(
      input,
      3,
      'regular',
      weeklyRecord(3, 'regular', [G1_COMPLETE]),
      'current'
    ).length,
    1
  );
});

test('analytics projection: a MATCHING but malformed envelope fails closed — never throws, never publishes', () => {
  // The durable store never validates stored values, so a record whose
  // year/week/seasonType AGREE can still be corrupt. The projection runs the
  // full `validateEnvelope` authority (the same one the public path uses) and
  // fails closed on every malformed shape — including ones that would otherwise
  // throw (non-iterable `games`) or silently pass (string `games`).
  const input = { slate: slateOf([G1]), scoresByKey: FINAL_100 };
  const base = { year: 2025, week: 3, seasonType: 'regular' as const };
  const malformed: unknown[] = [
    // Matching identity, invalid fetchedAt.
    { ...base, fetchedAt: 'not-a-time', games: [G1_COMPLETE] },
    // Matching identity, missing fetchedAt entirely.
    { ...base, games: [G1_COMPLETE] },
    // Matching identity, non-array games (string — iterable, would have
    // silently yielded characters).
    { ...base, fetchedAt: '2025-09-08T00:00:00.000Z', games: 'nope' },
    // Matching identity, non-iterable games (would have thrown in grouping).
    { ...base, fetchedAt: '2025-09-08T00:00:00.000Z', games: 42 },
    // Matching identity, games missing entirely.
    { ...base, fetchedAt: '2025-09-08T00:00:00.000Z' },
    // Malformed envelope fields.
    { ...base, year: '2025', fetchedAt: '2025-09-08T00:00:00.000Z', games: [G1_COMPLETE] },
    { ...base, seasonType: 'spring', fetchedAt: '2025-09-08T00:00:00.000Z', games: [] },
    // Not a record at all.
    [G1_COMPLETE],
    42,
  ];
  for (const record of malformed) {
    let out: unknown;
    assert.doesNotThrow(
      () => {
        out = projectAnalyticsPartition(input, 3, 'regular', record as WeeklyGameStats, 'current');
      },
      JSON.stringify(record)?.slice(0, 60)
    );
    assert.deepEqual(out, [], JSON.stringify(record)?.slice(0, 60));
  }
  // Sanity: the equivalent VALID matching record still projects unchanged.
  assert.equal(
    projectAnalyticsPartition(
      input,
      3,
      'regular',
      weeklyRecord(3, 'regular', [G1_COMPLETE]),
      'current'
    ).length,
    1
  );
});

// --- Approved finality × completeness matrix (retained from C3) ---

test('matrix: FINAL score + COMPLETE evidence → included', () => {
  assert.deepEqual(
    analyticsFor([G1], [G1_COMPLETE], FINAL_100).map((a) => a.providerGameId),
    [100]
  );
});

test('matrix: FINAL score + INCOMPLETE (sparse) evidence → excluded', () => {
  assert.deepEqual(analyticsFor([G2], [G2_SPARSE], { 'key-200': scorePack('final') }), []);
});

test('matrix: IN-PROGRESS score + COMPLETE evidence → excluded', () => {
  assert.deepEqual(analyticsFor([G1], [G1_COMPLETE], { 'key-100': scorePack('in_progress') }), []);
});

test('matrix: SCHEDULED or MISSING score + COMPLETE evidence → excluded, including after six hours', () => {
  // G1 is applicability `expected` — its kickoff is more than six hours old — so
  // this proves the six-hour threshold never substitutes for score finality.
  assert.equal(G1.applicability, 'expected');
  assert.deepEqual(analyticsFor([G1], [G1_COMPLETE], { 'key-100': scorePack('scheduled') }), []);
  // No key for key-100: classifyScorePackStatus(undefined) === 'scheduled' → excluded.
  assert.deepEqual(analyticsFor([G1], [G1_COMPLETE], {}), []);
});

test('matrix: FINAL score + BLOCKED (unsupported schema) evidence → excluded', () => {
  const blocked = { ...G1_COMPLETE, schemaVersion: 5 } as unknown as GameStats;
  // Sanity via the UNCHANGED coverage authority: genuinely blocked, not sparse.
  const coverage = coverageFor([G1], [blocked]);
  assert.equal(coverage.games[0]?.decision.state, 'blocked-unsupported-schema');
  assert.deepEqual(analyticsFor([G1], [blocked], FINAL_100), []);
});

test('matrix: FINAL score + CONFLICTING (divergent duplicate) evidence → excluded', () => {
  // Two same-id, same-fence rows with divergent content: the shared evidence
  // authority classifies a duplicate conflict, which is never analytics evidence.
  const divergentTwin = v2Row({
    id: 100,
    home: {
      school: 'Alpha State',
      schoolId: 101,
      raw: {
        totalYards: '999',
        rushingYards: '187',
        netPassingYards: '225',
        turnovers: '1',
        thirdDownEff: '6-14',
        possessionTime: '31:24',
      },
    },
    away: { school: 'Beta Tech', schoolId: 202 },
    week: 3,
  });
  const coverage = coverageFor([G1], [G1_COMPLETE, divergentTwin]);
  assert.equal(coverage.games[0]?.decision.state, 'duplicate-conflict');
  assert.deepEqual(analyticsFor([G1], [G1_COMPLETE, divergentTwin], FINAL_100), []);
});

test('matrix: only one FINAL among several complete games → only the final game included', () => {
  const out = analyticsFor([G1, G2], [G1_COMPLETE, G2_COMPLETE], {
    'key-100': scorePack('final'),
    'key-200': scorePack('scheduled'),
  });
  assert.deepEqual(
    out.map((a) => a.providerGameId),
    [100]
  );
});

// --- PLATFORM-086H3C4: readiness is independent of the six-hour threshold ---

/** G1 as a PENDING game — kickoff less than six hours old for C1's classifier. */
const G1_PENDING = canonicalGame({
  providerGameId: 100,
  home: 'Alpha State',
  away: 'Beta Tech',
  week: 3,
  applicability: 'pending',
});

test('readiness: FINAL + COMPLETE less than six hours after kickoff is included', () => {
  assert.deepEqual(
    analyticsFor([G1_PENDING], [G1_COMPLETE], FINAL_100).map((a) => a.providerGameId),
    [100]
  );
});

test('readiness: the same pending game remains PENDING for C1 coverage/recovery (unchanged)', () => {
  // The identical slate + record that just projected analytics: coverage still
  // classifies the game `pending` — never an evaluated/expected gap — so the
  // six-hour missing-data/recovery semantics are untouched by C4.
  const coverage = coverageFor([G1_PENDING], [G1_COMPLETE]);
  assert.deepEqual(coverage.games, []);
  assert.deepEqual(
    coverage.pending.map((g) => g.providerGameId),
    [100]
  );
  assert.equal(coverage.state, 'not-applicable');
});

test('readiness: IN-PROGRESS + COMPLETE is excluded without altering its committed evidence', () => {
  const record = weeklyRecord(3, 'regular', [G1_COMPLETE]);
  const before = structuredClone(record);
  const input = {
    slate: slateOf([G1_PENDING]),
    scoresByKey: { 'key-100': scorePack('in_progress') },
  };
  assert.deepEqual(projectAnalyticsPartition(input, 3, 'regular', record, 'current'), []);
  // The committed evidence is untouched (never discarded or rewritten)…
  assert.deepEqual(record, before);
  // …and the SAME record projects the moment the score turns final.
  const final = { slate: slateOf([G1_PENDING]), scoresByKey: FINAL_100 };
  assert.equal(projectAnalyticsPartition(final, 3, 'regular', record, 'current').length, 1);
});

test('readiness: one final-and-complete game is included while later slate games are scheduled or in progress', () => {
  const g2Pending = canonicalGame({
    providerGameId: 200,
    home: 'Gamma A&M',
    away: 'Delta University',
    week: 3,
    applicability: 'pending',
  });
  const g3Pending = canonicalGame({
    providerGameId: 300,
    home: 'Epsilon College',
    away: 'Zeta State',
    week: 3,
    applicability: 'pending',
  });
  // G1 finished early (final + complete); G2 has not kicked off (no score, no
  // rows); G3 is mid-game with complete-so-far stats.
  const out = analyticsFor([G1_PENDING, g2Pending, g3Pending], [G1_COMPLETE, G2_COMPLETE], {
    'key-100': scorePack('final'),
    'key-300': scorePack('in_progress'),
  });
  assert.deepEqual(
    out.map((a) => a.providerGameId),
    [100]
  );
});

test('readiness: placeholders and disrupted games remain excluded even with a final score', () => {
  const placeholder = canonicalGame({
    providerGameId: 400,
    home: 'Alpha State',
    away: 'Beta Tech',
    week: 3,
    applicability: 'not-expected',
    notExpectedReason: 'placeholder',
    key: 'key-400',
  });
  const disrupted = canonicalGame({
    providerGameId: 500,
    home: 'Gamma A&M',
    away: 'Delta University',
    week: 3,
    applicability: 'not-expected',
    notExpectedReason: 'disrupted',
    key: 'key-500',
  });
  const rows = [
    v2Row({
      id: 400,
      home: { school: 'Alpha State', schoolId: 101 },
      away: { school: 'Beta Tech', schoolId: 202 },
      week: 3,
    }),
  ];
  const out = analyticsFor([placeholder, disrupted], rows, {
    'key-400': scorePack('final'),
    'key-500': scorePack('final'),
  });
  assert.deepEqual(out, []);
});

// --- Paired-input contract: live-shaped and archive-shaped inputs behave identically ---

test('paired input: live-shaped and archive-shaped key namespaces obey the same contract', () => {
  // The SAME canonical content under two key namespaces — a live canonical build
  // (`key-*`) and an archived snapshot's preserved keys (`arch-*`). Each slate is
  // paired with ITS OWN score map; both project identically.
  const liveGame = canonicalGame({
    providerGameId: 100,
    home: 'Alpha State',
    away: 'Beta Tech',
    week: 3,
    key: 'key-100',
  });
  const archiveGame = canonicalGame({
    providerGameId: 100,
    home: 'Alpha State',
    away: 'Beta Tech',
    week: 3,
    key: 'arch-100',
  });
  const live = analyticsFor([liveGame], [G1_COMPLETE], { 'key-100': scorePack('final') });
  const archived = analyticsFor([archiveGame], [G1_COMPLETE], { 'arch-100': scorePack('final') });
  assert.deepEqual(live, archived);
  assert.equal(live.length, 1);

  // MIXING the namespaces (a slate paired with the OTHER build's map) finds no
  // score under `game.key` and fails closed — keys must come from the same
  // canonical build or persisted snapshot.
  assert.deepEqual(analyticsFor([liveGame], [G1_COMPLETE], { 'arch-100': scorePack('final') }), []);
});

test('key disambiguation: two games sharing an eventId are gated by their DISTINCT attachment keys', () => {
  // Supported path (buildAuthoritativeGameCollection): key disambiguation rewrites
  // AppGame.key while leaving eventId shared, and attachScoresToSchedule stores
  // each score under the disambiguated key. The gate must read game.key, never
  // game.eventId — otherwise both games would resolve to the same (or a missing)
  // score, admitting a non-final game or dropping a final one.
  const A = canonicalGame({
    providerGameId: 100,
    home: 'Alpha State',
    away: 'Beta Tech',
    week: 3,
    key: 'dup-a',
    eventId: 'shared-evt',
  });
  const B = canonicalGame({
    providerGameId: 200,
    home: 'Gamma A&M',
    away: 'Delta University',
    week: 3,
    key: 'dup-b',
    eventId: 'shared-evt',
  });
  // Scores attached under the DISAMBIGUATED keys: A final, B scheduled.
  const out = analyticsFor([A, B], [G1_COMPLETE, G2_COMPLETE], {
    'dup-a': scorePack('final'),
    'dup-b': scorePack('scheduled'),
  });
  // Only A is final → only A included. Keying by the shared eventId would have
  // missed both scores (→ []) and dropped the genuinely-final game.
  assert.deepEqual(
    out.map((a) => a.providerGameId),
    [100]
  );
});

// --- Shared status-classifier consistency ---

test('separator/case variants of a final status all gate to included; live/disrupted do not', () => {
  for (const finalLabel of ['final', 'FINAL', 'Final', 'STATUS_FINAL', 'status final']) {
    assert.deepEqual(
      analyticsFor([G1], [G1_COMPLETE], { 'key-100': scorePack(finalLabel) }).map(
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
      analyticsFor([G1], [G1_COMPLETE], { 'key-100': scorePack(nonFinal) }),
      [],
      nonFinal
    );
  }
});

test('no raw schedule status can make a game eligible without an attached final score', () => {
  // The canonical game itself reports rawStatus 'final' (schedule authority), but
  // finality for analytics comes ONLY from the attached score map.
  assert.equal(G1.rawStatus, 'final');
  // No attached score → excluded despite the schedule saying 'final'.
  assert.deepEqual(analyticsFor([G1], [G1_COMPLETE], {}), []);
  // An attached non-final score overrides the schedule's 'final' rawStatus.
  assert.deepEqual(analyticsFor([G1], [G1_COMPLETE], { 'key-100': scorePack('in_progress') }), []);
});

// --- Signature contract (compile-time required) ---

test('the paired input and committed record are mandatory; the old coverage signature is gone', () => {
  const coverage = coverageFor([G1], [G1_COMPLETE]);
  // @ts-expect-error the old (PartitionCoverage, scoresByKey) signature must not typecheck.
  assert.throws(() => projectAnalyticsPartition(coverage, FINAL_100));
  // Omitting the committed record must not typecheck; at runtime the envelope
  // validation fails closed (an undefined record is not a valid envelope).
  // @ts-expect-error the committed record (and season relation) are REQUIRED parameters.
  assert.deepEqual(projectAnalyticsPartition({ slate: slateOf([G1]), scoresByKey: FINAL_100 }), []);
});

// Sanity: the sparse fixture really is sparse (guards the tests above).
test('fixture sanity: the sparse row is v2-sparse, the complete row is v2-complete', () => {
  const complete: GameStats = G1_COMPLETE;
  assert.equal(complete.schemaVersion, 2);
  assert.equal(complete.home.pointsProvided, true);
  assert.equal(G2_SPARSE.home.pointsProvided, false);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { toAnalyticsGameStats, type SeasonRelation } from '../contract.ts';
import { evidenceEquivalent, selectGameEvidence } from '../evidenceAuthority.ts';
import type { GameStats } from '../types.ts';
import { canonicalGame, v2Row } from './c1Fixtures.ts';
import { legacyRowFromWire, wireGame } from './fixtures.ts';

const GAME = canonicalGame({ providerGameId: 100, home: 'Alpha State', away: 'Beta Tech' });

const HOME = { school: 'Alpha State', schoolId: 101 };
const AWAY = { school: 'Beta Tech', schoolId: 202 };

/** Complete legacy row with the default Alpha/Beta identities in provider week 3. */
function legacyBase(id = 100): GameStats {
  return legacyRowFromWire(wireGame({ id }), 3);
}

function decide(game: typeof GAME, rows: GameStats[], seasonRelation: SeasonRelation = 'current') {
  return selectGameEvidence(game, rows, seasonRelation);
}

// === Association (id + partition) ===

test('association: matching id + usable row → satisfied, selected as-stored', () => {
  const row = v2Row({ id: 100, home: HOME, away: AWAY, week: 3 });
  const d = decide(GAME, [row]);
  assert.equal(d.state, 'satisfied');
  assert.equal(d.provenance, 'v2-complete');
  assert.equal(d.selected?.home.schoolId, 101); // never swapped
  assert.equal(d.selected?.away.schoolId, 202);
});

test('association: row-level partition disagreement is not evidence → absent', () => {
  const row = v2Row({ id: 100, home: HOME, away: AWAY, week: 9 }); // wrong week
  const d = decide(GAME, [row]);
  assert.equal(d.state, 'absent');
});

test('association: no candidate rows at all → absent', () => {
  assert.equal(decide(GAME, []).state, 'absent');
});

test('no reorientation helper is exported (sides are never swapped)', async () => {
  const mod = (await import('../evidenceAuthority.ts')) as Record<string, unknown>;
  assert.equal('reorientRow' in mod, false);
});

test('trusted orientation: duplicates disagreeing only on a side’s stored homeAway conflict', () => {
  // Same fence + content, but one row's home side is mislabeled `away` — a trusted
  // orientation disagreement, never a silent collapse.
  const base = v2Row({
    id: 100,
    home: HOME,
    away: AWAY,
    week: 3,
    fetchStartedAt: '2025-09-08T00:00:00Z',
  });
  const flipped: GameStats = { ...base, home: { ...base.home, homeAway: 'away' } };
  const d = decide(GAME, [base, flipped]);
  assert.equal(d.state, 'duplicate-conflict');
  assert.equal(d.provenance, 'v2-complete');
  assert.equal(d.selected, null);

  // Sanity: rows that AGREE on homeAway collapse to one satisfied winner.
  const twin = v2Row({
    id: 100,
    home: HOME,
    away: AWAY,
    week: 3,
    fetchStartedAt: '2025-09-08T00:00:00Z',
  });
  assert.equal(decide(GAME, [base, twin]).state, 'satisfied');
});

// === Evidence precedence + freshness ===

test('precedence: complete v2 outranks compatible legacy', () => {
  const legacy = legacyBase(100);
  const v2 = v2Row({ id: 100, home: HOME, away: AWAY, week: 3 });
  const d = decide(GAME, [legacy, v2]);
  assert.equal(d.state, 'satisfied');
  assert.equal(d.provenance, 'v2-complete');
  assert.equal(d.selected?.schemaVersion, 2);
});

test('precedence: compatible legacy outranks sparse v2', () => {
  const sparse = v2Row({ id: 100, home: { ...HOME, points: null }, away: AWAY, week: 3 });
  const legacy = legacyBase(100);
  const d = decide(GAME, [sparse, legacy]);
  assert.equal(d.state, 'satisfied');
  assert.equal(d.provenance, 'legacy-compatible');
});

test('precedence: newer sparse v2 cannot displace complete v2', () => {
  const complete = v2Row({
    id: 100,
    home: HOME,
    away: AWAY,
    week: 3,
    fetchStartedAt: '2025-09-07T00:00:00Z',
  });
  const newerSparse = v2Row({
    id: 100,
    home: { ...HOME, points: null },
    away: AWAY,
    week: 3,
    fetchStartedAt: '2025-09-09T00:00:00Z',
  });
  const d = decide(GAME, [complete, newerSparse]);
  assert.equal(d.state, 'satisfied');
  assert.equal(d.provenance, 'v2-complete');
  assert.equal(d.selected?.home.pointsProvided, true);
});

test('freshness: same-class newer v2 wins over older', () => {
  const older = v2Row({
    id: 100,
    home: { ...HOME, points: 20 },
    away: AWAY,
    week: 3,
    fetchStartedAt: '2025-09-07T00:00:00Z',
  });
  const newer = v2Row({
    id: 100,
    home: { ...HOME, points: 31 },
    away: AWAY,
    week: 3,
    fetchStartedAt: '2025-09-08T00:00:00Z',
  });
  const d = decide(GAME, [older, newer]);
  assert.equal(d.state, 'satisfied');
  assert.equal(d.selected?.home.points, 31);
});

test('freshness: equal-fence equivalent v2 collapse to one winner', () => {
  const a = v2Row({
    id: 100,
    home: HOME,
    away: AWAY,
    week: 3,
    fetchStartedAt: '2025-09-08T00:00:00Z',
  });
  const b = v2Row({
    id: 100,
    home: HOME,
    away: AWAY,
    week: 3,
    fetchStartedAt: '2025-09-08T00:00:00Z',
  });
  assert.equal(decide(GAME, [a, b]).state, 'satisfied');
});

test('freshness: equivalent equal-fence contenders pick a stable representative regardless of order', () => {
  // Same instant, different fetchStartedAt encoding (excluded from equivalence).
  const zulu = v2Row({
    id: 100,
    home: HOME,
    away: AWAY,
    week: 3,
    fetchStartedAt: '2025-09-08T00:00:00Z',
  });
  const offset = v2Row({
    id: 100,
    home: HOME,
    away: AWAY,
    week: 3,
    fetchStartedAt: '2025-09-08T00:00:00+00:00',
  });
  const forward = decide(GAME, [zulu, offset]);
  const backward = decide(GAME, [offset, zulu]);
  assert.equal(forward.state, 'satisfied');
  assert.equal(backward.state, 'satisfied');
  assert.ok(forward.selected?.fetchStartedAt);
  assert.equal(forward.selected?.fetchStartedAt, backward.selected?.fetchStartedAt);
});

test('freshness: equal-fence divergent v2 conflict', () => {
  const a = v2Row({
    id: 100,
    home: { ...HOME, points: 31 },
    away: AWAY,
    week: 3,
    fetchStartedAt: '2025-09-08T00:00:00Z',
  });
  const b = v2Row({
    id: 100,
    home: { ...HOME, points: 14 },
    away: AWAY,
    week: 3,
    fetchStartedAt: '2025-09-08T00:00:00Z',
  });
  const d = decide(GAME, [a, b]);
  assert.equal(d.state, 'duplicate-conflict');
  assert.equal(d.provenance, 'v2-complete');
  assert.equal(d.selected, null);
});

test('freshness: a missing or malformed v2 fence blocks', () => {
  const noFence = v2Row({ id: 100, home: HOME, away: AWAY, week: 3, fetchStartedAt: null });
  assert.equal(decide(GAME, [noFence]).state, 'blocked-unsupported-schema');

  const badFence = {
    ...v2Row({ id: 100, home: HOME, away: AWAY, week: 3 }),
    fetchStartedAt: 'not-a-date',
  };
  const d = decide(GAME, [badFence]);
  assert.equal(d.state, 'blocked-unsupported-schema');
  assert.deepEqual(d.blockers, ['v2-fence-missing-or-invalid']);
});

test('legacy: equivalent duplicates collapse; divergent duplicates conflict', () => {
  const a = legacyBase(100);
  const twin = legacyBase(100);
  assert.equal(decide(GAME, [a, twin]).state, 'satisfied');

  const divergent = legacyRowFromWire(
    wireGame({ id: 100, home: { statOverrides: { firstDowns: '99' } } }),
    3
  );
  const conflict = decide(GAME, [a, divergent]);
  assert.equal(conflict.state, 'duplicate-conflict');
  assert.equal(conflict.provenance, 'legacy-compatible');
});

test('selection is invariant to candidate order', () => {
  const legacy = legacyBase(100);
  const v2 = v2Row({ id: 100, home: HOME, away: AWAY, week: 3 });
  const sparse = v2Row({
    id: 100,
    home: { ...HOME, points: null },
    away: AWAY,
    week: 3,
    fetchStartedAt: '2025-09-06T00:00:00Z',
  });
  const forward = decide(GAME, [legacy, v2, sparse]);
  const backward = decide(GAME, [sparse, v2, legacy]);
  assert.equal(forward.state, backward.state);
  assert.equal(forward.provenance, backward.provenance);
  assert.equal(forward.selected?.home.points, backward.selected?.home.points);
});

test('a difference in an analytics-ignored public field is NOT hidden by analytics equivalence', () => {
  const base = legacyBase(100);
  const firstDownsDiff = legacyRowFromWire(
    wireGame({ id: 100, home: { statOverrides: { firstDowns: '99' } } }),
    3
  );
  // Analytics projection ignores firstDowns → the two rows project identically…
  assert.deepEqual(toAnalyticsGameStats(base), toAnalyticsGameStats(firstDownsDiff));
  // …but the broader publishable equivalence sees the difference…
  assert.equal(evidenceEquivalent(base, firstDownsDiff), false);
  // …so the authority reports a conflict rather than silently collapsing them.
  assert.equal(decide(GAME, [base, firstDownsDiff]).state, 'duplicate-conflict');
});

// === Unsupported / malformed schema blocking (by id) ===

test('unsupported schema: a same-id unsupported row blocks a valid supported sibling', () => {
  const valid = v2Row({ id: 100, home: HOME, away: AWAY, week: 3 });
  const unsupported = {
    ...v2Row({ id: 100, home: HOME, away: AWAY, week: 3 }),
    schemaVersion: 5,
  } as unknown as GameStats;
  const d = decide(GAME, [valid, unsupported]);
  assert.equal(d.state, 'blocked-unsupported-schema');
  assert.deepEqual(d.blockers, ['unsupported-schema-version']);
  assert.equal(d.selected, null); // never falls back to the valid sibling
});

test('unsupported schema: an unsupported row in the WRONG partition does not block', () => {
  const valid = v2Row({ id: 100, home: HOME, away: AWAY, week: 3 });
  const unsupportedOtherPartition = {
    ...v2Row({ id: 100, home: HOME, away: AWAY, week: 9 }),
    schemaVersion: 5,
  } as unknown as GameStats;
  const d = decide(GAME, [valid, unsupportedOtherPartition]);
  // Association requires partition agreement; the mis-partitioned row never blocks.
  assert.equal(d.state, 'satisfied');
});

test('defective-only evidence: recoverable (absent) for current season, manual-only for historical', () => {
  // A legacy row whose required category is malformed → legacy-malformed → defective.
  const defective = legacyRowFromWire(
    wireGame({ id: 100, home: { statOverrides: { totalYards: 'not-a-number' } } }),
    3
  );
  // Current season: a refetch can still fill the gap → recoverable `absent`.
  const current = decide(GAME, [defective], 'current');
  assert.equal(current.state, 'absent');
  assert.equal(current.selected, null);
  // Historical season: not auto-recoverable → terminal `manual-only`.
  const historical = decide(GAME, [defective], 'historical');
  assert.equal(historical.state, 'manual-only');
  assert.equal(historical.selected, null);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { toAnalyticsGameStats, type SeasonRelation } from '../contract.ts';
import { evidenceEquivalent, reorientRow, selectGameEvidence } from '../evidenceAuthority.ts';
import type { GameStats } from '../types.ts';
import { IDENTITY_KEYS, canonicalGame, legacyRow, mapResolveKey, v2Row } from './c1Fixtures.ts';
import { legacyRowFromWire, wireGame } from './fixtures.ts';

const RESOLVE = mapResolveKey({ ...IDENTITY_KEYS, 'Alpha St': IDENTITY_KEYS['Alpha State']! });

const GAME = canonicalGame({ providerGameId: 100, home: 'Alpha State', away: 'Beta Tech' });
const NEUTRAL_GAME = canonicalGame({
  providerGameId: 200,
  home: 'Alpha State',
  away: 'Beta Tech',
  neutral: true,
});

const HOME = { school: 'Alpha State', schoolId: 101 };
const AWAY = { school: 'Beta Tech', schoolId: 202 };

/** Complete legacy row with the default Alpha/Beta identities in provider week 3. */
function legacyBase(id = 100): GameStats {
  return legacyRowFromWire(wireGame({ id }), 3);
}

function decide(game: typeof GAME, rows: GameStats[], seasonRelation: SeasonRelation = 'current') {
  return selectGameEvidence(game, rows, RESOLVE, seasonRelation);
}

// === Attachment + orientation ===

test('attachment: matching id + canonical participants attach (direct)', () => {
  const row = v2Row({ id: 100, home: HOME, away: AWAY, week: 3 });
  const d = decide(GAME, [row]);
  assert.equal(d.state, 'satisfied');
  assert.equal(d.provenance, 'v2-complete');
  assert.equal(d.selected?.home.school, 'Alpha State');
  assert.deepEqual(d.rejected, []);
});

test('attachment: alias-resolved participant attaches through the resolver', () => {
  const row = v2Row({ id: 100, home: { school: 'Alpha St', schoolId: 101 }, away: AWAY, week: 3 });
  const d = decide(GAME, [row]);
  assert.equal(d.state, 'satisfied');
});

test('attachment: correct id with wrong participants does NOT attach → identity-mismatch', () => {
  const row = v2Row({
    id: 100,
    home: { school: 'Gamma A&M', schoolId: 303 },
    away: AWAY,
    week: 3,
  });
  const d = decide(GAME, [row]);
  assert.equal(d.state, 'identity-mismatch');
  assert.equal(d.selected, null);
  assert.equal(d.rejected[0]?.reason, 'participant-mismatch');
});

test('attachment: unresolved participant does NOT attach', () => {
  const row = v2Row({
    id: 100,
    home: { school: 'Not In Catalog', schoolId: 999 },
    away: AWAY,
    week: 3,
  });
  const d = decide(GAME, [row]);
  assert.equal(d.state, 'identity-mismatch');
  assert.equal(d.rejected[0]?.reason, 'participant-unresolved');
});

test('attachment: row-level partition mismatch is not identity-mismatch, just absent', () => {
  const row = v2Row({ id: 100, home: HOME, away: AWAY, week: 9 }); // wrong week
  const d = decide(GAME, [row]);
  assert.equal(d.state, 'absent');
  assert.equal(d.rejected[0]?.reason, 'partition-mismatch');
});

test('attachment: no candidate rows at all → absent', () => {
  assert.equal(decide(GAME, []).state, 'absent');
});

test('orientation: reversed observation on a NON-neutral game is rejected', () => {
  const reversed = v2Row({ id: 100, home: AWAY, away: HOME, week: 3 });
  const d = decide(GAME, [reversed]);
  assert.equal(d.state, 'identity-mismatch');
  assert.equal(d.rejected[0]?.reason, 'reversed-non-neutral');
});

test('orientation: reversed neutral observation attaches only after reorientation', () => {
  const reversed = v2Row({ id: 200, home: AWAY, away: HOME, week: 3 });
  const d = decide(NEUTRAL_GAME, [reversed]);
  assert.equal(d.state, 'satisfied');
  // Selected row is canonically oriented: canonical home is Alpha State.
  assert.equal(d.selected?.home.school, 'Alpha State');
  assert.equal(d.selected?.home.homeAway, 'home');
  assert.equal(d.selected?.away.school, 'Beta Tech');
  assert.equal(d.selected?.away.homeAway, 'away');
});

test('reorientRow: every team-side field travels; every game-level field is unchanged; input not mutated', () => {
  const row = v2Row({ id: 100, home: HOME, away: AWAY, week: 4, seasonType: 'regular' });
  const snapshot = JSON.parse(JSON.stringify(row));
  const oriented = reorientRow(row);

  // Whole team-side objects moved atomically (only the marker rewritten).
  assert.deepEqual(oriented.home, { ...snapshot.away, homeAway: 'home' });
  assert.deepEqual(oriented.away, { ...snapshot.home, homeAway: 'away' });
  // Game-level fields unchanged.
  assert.equal(oriented.providerGameId, row.providerGameId);
  assert.equal(oriented.week, row.week);
  assert.equal(oriented.seasonType, row.seasonType);
  assert.equal(oriented.schemaVersion, row.schemaVersion);
  assert.equal(oriented.fetchStartedAt, row.fetchStartedAt);
  // Input row is never mutated.
  assert.deepEqual(row, snapshot);
});

test('reorientRow: an existing reversed legacy row gets a non-mutating oriented read view', () => {
  const reversed = legacyRowFromWire(
    wireGame({
      id: 100,
      home: { school: 'Beta Tech', teamId: 202 },
      away: { school: 'Alpha State', teamId: 101 },
    }),
    3
  );
  const snapshot = JSON.parse(JSON.stringify(reversed));
  const oriented = reorientRow(reversed);
  assert.equal(oriented.home.school, 'Alpha State');
  assert.equal(oriented.away.school, 'Beta Tech');
  assert.deepEqual(reversed, snapshot); // durable bytes untouched
});

// === Evidence precedence + freshness ===

test('precedence: complete v2 outranks compatible legacy', () => {
  const legacy = legacyRow({
    id: 100,
    home: { school: 'Alpha State', teamId: 101 },
    away: { school: 'Beta Tech', teamId: 202 },
    week: 3,
  });
  const v2 = v2Row({ id: 100, home: HOME, away: AWAY, week: 3 });
  const d = decide(GAME, [legacy, v2]);
  assert.equal(d.state, 'satisfied');
  assert.equal(d.provenance, 'v2-complete');
  assert.equal(d.selected?.schemaVersion, 2);
  assert.deepEqual(
    d.shadowed.map((s) => s.source),
    ['legacy-compatible']
  );
});

test('precedence: compatible legacy outranks sparse v2', () => {
  const sparse = v2Row({ id: 100, home: { ...HOME, points: null }, away: AWAY, week: 3 });
  const legacy = legacyRow({
    id: 100,
    home: { school: 'Alpha State', teamId: 101 },
    away: { school: 'Beta Tech', teamId: 202 },
    week: 3,
  });
  const d = decide(GAME, [sparse, legacy]);
  assert.equal(d.state, 'satisfied');
  assert.equal(d.provenance, 'legacy-compatible');
  assert.deepEqual(
    d.shadowed.map((s) => s.source),
    ['v2-sparse']
  );
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

test('freshness: same-class newer v2 wins; older is shadowed', () => {
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
  assert.equal(d.shadowed.length, 1);
  assert.equal(d.shadowed[0]?.fence, '2025-09-07T00:00:00.000Z');
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
  const d = decide(GAME, [a, b]);
  assert.equal(d.state, 'satisfied');
  assert.deepEqual(d.shadowed, []);
});

test('freshness: equivalent equal-fence contenders pick a stable representative regardless of order', () => {
  // Same instant + identical publishable content, but different fetchStartedAt
  // encoding (excluded from equivalence) — candidate order must not change the
  // selected row.
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

test('legacy: equivalent duplicates collapse; divergent duplicates conflict; partition fetchedAt never orders them', () => {
  const a = legacyBase(100);
  const twin = legacyBase(100);
  const collapsed = decide(GAME, [a, twin]);
  assert.equal(collapsed.state, 'satisfied');
  assert.deepEqual(collapsed.shadowed, []);

  const divergent = legacyRowFromWire(
    wireGame({ id: 100, home: { statOverrides: { firstDowns: '99' } } }),
    3
  );
  const conflict = decide(GAME, [a, divergent]);
  assert.equal(conflict.state, 'duplicate-conflict');
  assert.equal(conflict.provenance, 'legacy-compatible');
});

test('selection is invariant to candidate order', () => {
  const legacy = legacyRow({
    id: 100,
    home: { school: 'Alpha State', teamId: 101 },
    away: { school: 'Beta Tech', teamId: 202 },
    week: 3,
  });
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
  assert.deepEqual(
    forward.shadowed.map((s) => s.source).sort(),
    backward.shadowed.map((s) => s.source).sort()
  );
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

// === Unsupported / malformed schema blocking ===

test('unsupported schema: a participant-matching unsupported row blocks a valid supported sibling', () => {
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

test('unsupported schema: same id with mismatched participants does NOT block', () => {
  const valid = v2Row({ id: 100, home: HOME, away: AWAY, week: 3 });
  const unsupportedWrong = {
    ...v2Row({ id: 100, home: { school: 'Gamma A&M', schoolId: 303 }, away: AWAY, week: 3 }),
    schemaVersion: 5,
  } as unknown as GameStats;
  const d = decide(GAME, [valid, unsupportedWrong]);
  assert.equal(d.state, 'satisfied'); // valid sibling wins; unsupported did not attach
  assert.equal(d.rejected[0]?.reason, 'participant-mismatch');
});

test('unsupported schema: unresolved participants keep an unsupported row quarantined (no block)', () => {
  const valid = v2Row({ id: 100, home: HOME, away: AWAY, week: 3 });
  const unsupportedUnresolved = {
    ...v2Row({ id: 100, home: { school: 'Ghost Team', schoolId: 777 }, away: AWAY, week: 3 }),
    schemaVersion: 5,
  } as unknown as GameStats;
  const d = decide(GAME, [valid, unsupportedUnresolved]);
  assert.equal(d.state, 'satisfied');
  assert.equal(d.rejected[0]?.reason, 'participant-unresolved');
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

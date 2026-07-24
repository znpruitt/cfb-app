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

// === PLATFORM-086H3C5: numeric participant validation ===

test('participant validation: direct numeric match selects the row as stored and satisfies', () => {
  const row = v2Row({ id: 100, home: HOME, away: AWAY, week: 3 });
  const d = decide(GAME, [row]);
  assert.equal(d.state, 'satisfied');
  assert.equal(d.participantValidation, 'verified');
  assert.equal(d.selected?.home.schoolId, 101);
  assert.equal(d.selected?.away.schoolId, 202);
});

test('participant validation: names may disagree while matching numeric ids still verify', () => {
  // Numeric identity is the whole validation authority — provider names never
  // verify or contradict it.
  const row = v2Row({
    id: 100,
    home: { school: 'Totally Different Label', schoolId: 101 },
    away: { school: 'Another Label', schoolId: 202 },
    week: 3,
  });
  const d = decide(GAME, [row]);
  assert.equal(d.state, 'satisfied');
  assert.equal(d.participantValidation, 'verified');
});

test('participant validation: matching names with a wrong numeric id mismatch', () => {
  const row = v2Row({
    id: 100,
    home: { school: 'Alpha State', schoolId: 999 }, // right name, wrong id
    away: { school: 'Beta Tech', schoolId: 202 },
    week: 3,
  });
  const d = decide(GAME, [row]);
  assert.equal(d.state, 'identity-mismatch');
  assert.equal(d.participantValidation, 'mismatch');
  assert.equal(d.selected, null);
  assert.equal(d.provenance, null);
});

test('participant validation: an exact reversal is a mismatch (non-neutral and neutral)', () => {
  const reversed = v2Row({
    id: 100,
    home: { school: 'Beta Tech', schoolId: 202 }, // schedule says 101 is home
    away: { school: 'Alpha State', schoolId: 101 },
    week: 3,
  });
  const nonNeutral = decide(GAME, [reversed]);
  assert.equal(nonNeutral.state, 'identity-mismatch');
  assert.equal(nonNeutral.selected, null); // never swapped back into evidence

  const neutralGame = canonicalGame({
    providerGameId: 100,
    home: 'Alpha State',
    away: 'Beta Tech',
    neutral: true,
  });
  const neutral = decide(neutralGame, [reversed]);
  assert.equal(neutral.state, 'identity-mismatch'); // neutral-site changes nothing
});

test('participant validation: missing one or both schedule ids → participant-validation-unavailable', () => {
  const row = v2Row({ id: 100, home: HOME, away: AWAY, week: 3 });

  const missingBoth = canonicalGame({
    providerGameId: 100,
    home: 'Alpha State',
    away: 'Beta Tech',
    homeId: null,
    awayId: null,
  });
  const both = decide(missingBoth, [row]);
  assert.equal(both.state, 'participant-validation-unavailable');
  assert.equal(both.participantValidation, 'schedule-ids-unavailable');
  assert.equal(both.selected, null);

  const missingOne = canonicalGame({
    providerGameId: 100,
    home: 'Alpha State',
    away: 'Beta Tech',
    awayId: null,
  });
  const one = decide(missingOne, [row]);
  assert.equal(one.state, 'participant-validation-unavailable');
  assert.equal(one.participantValidation, 'schedule-ids-unavailable');
});

test('participant validation: missing/invalid stored school ids → separately reasoned validation-unavailable', () => {
  // Legacy identity is bounded to nonblank schools, so a legacy-compatible row
  // can carry an unusable stored id — it stays usable evidence but cannot be
  // numerically validated.
  const base = legacyBase(100);
  const noStoredId: GameStats = {
    ...base,
    home: { ...base.home, schoolId: undefined as unknown as number },
  };
  const d = decide(GAME, [noStoredId]);
  assert.equal(d.state, 'participant-validation-unavailable');
  assert.equal(d.participantValidation, 'stored-ids-unavailable');
  assert.equal(d.selected, null);
});

test('participant validation: schedule-unavailable, stored-unavailable, mismatch, and absence are four distinct outcomes', () => {
  const verifiedRow = v2Row({ id: 100, home: HOME, away: AWAY, week: 3 });
  const scheduleGap = canonicalGame({
    providerGameId: 100,
    home: 'Alpha State',
    away: 'Beta Tech',
    homeId: null,
    awayId: null,
  });
  assert.equal(
    decide(scheduleGap, [verifiedRow]).participantValidation,
    'schedule-ids-unavailable'
  );

  const base = legacyBase(100);
  const storedGap: GameStats = {
    ...base,
    away: { ...base.away, schoolId: Number.NaN },
  };
  assert.equal(decide(GAME, [storedGap]).participantValidation, 'stored-ids-unavailable');

  const wrong = v2Row({
    id: 100,
    home: { school: 'Alpha State', schoolId: 777 },
    away: AWAY,
    week: 3,
  });
  assert.equal(decide(GAME, [wrong]).state, 'identity-mismatch');

  // No candidate rows at all stays ordinary absence — never a validation state.
  const absent = decide(GAME, []);
  assert.equal(absent.state, 'absent');
  assert.equal(absent.participantValidation, null);
});

test('participant validation: a mismatched higher-sufficiency candidate cannot displace a verified lower-sufficiency candidate', () => {
  const verifiedLegacy = legacyBase(100); // legacy-compatible, ids 101/202
  const mismatchedV2 = v2Row({
    id: 100,
    home: { school: 'Alpha State', schoolId: 999 },
    away: AWAY,
    week: 3,
  });
  for (const rows of [
    [verifiedLegacy, mismatchedV2],
    [mismatchedV2, verifiedLegacy],
  ]) {
    const d = decide(GAME, rows);
    assert.equal(d.state, 'satisfied');
    assert.equal(d.provenance, 'legacy-compatible'); // v2 mismatch excluded from ranking
    assert.equal(d.participantValidation, 'verified');
    assert.equal(d.selected?.home.schoolId, 101);
  }
});

test('participant validation: a validation-unavailable candidate cannot displace a verified candidate', () => {
  const verifiedLegacy = legacyBase(100);
  const base = legacyBase(100);
  const unverifiableV2Shape: GameStats = {
    ...v2Row({ id: 100, home: HOME, away: AWAY, week: 3 }),
  };
  (unverifiableV2Shape.home as { schoolId: unknown }).schoolId = undefined;
  for (const rows of [
    [verifiedLegacy, unverifiableV2Shape],
    [unverifiableV2Shape, verifiedLegacy],
  ]) {
    const d = decide(GAME, rows);
    assert.equal(d.state, 'satisfied');
    assert.equal(d.participantValidation, 'verified');
    assert.equal(d.selected?.home.schoolId, base.home.schoolId);
  }
});

test('participant validation: a mismatch-only candidate set is identity-mismatch (mismatch outranks unavailable)', () => {
  const mismatch = v2Row({
    id: 100,
    home: { school: 'Alpha State', schoolId: 999 },
    away: AWAY,
    week: 3,
  });
  const base = legacyBase(100);
  const unverifiable: GameStats = {
    ...base,
    home: { ...base.home, schoolId: undefined as unknown as number },
  };
  for (const rows of [
    [mismatch, unverifiable],
    [unverifiable, mismatch],
  ]) {
    const d = decide(GAME, rows);
    assert.equal(d.state, 'identity-mismatch');
    assert.equal(d.participantValidation, 'mismatch');
  }
});

test('participant validation: same-id unsupported/malformed/bad-fence schema still blocks BEFORE participant validation', () => {
  const unsupported: GameStats = {
    ...v2Row({ id: 100, home: HOME, away: AWAY, week: 3 }),
    schemaVersion: 99,
  } as unknown as GameStats;
  const mismatched = v2Row({
    id: 100,
    home: { school: 'Alpha State', schoolId: 999 },
    away: AWAY,
    week: 3,
  });
  const d = decide(GAME, [unsupported, mismatched]);
  assert.equal(d.state, 'blocked-unsupported-schema');
  assert.equal(d.participantValidation, null); // validation never reached
  assert.deepEqual(d.blockers, ['unsupported-schema-version']);
});

test('participant validation: partition disagreement remains non-evidence, never a mismatch', () => {
  // A wrong-partition row with contradictory ids is skipped by association —
  // it cannot prove a mismatch for a game it is not evidence for.
  const wrongWeek = v2Row({
    id: 100,
    home: { school: 'Alpha State', schoolId: 999 },
    away: AWAY,
    week: 9,
  });
  const d = decide(GAME, [wrongWeek]);
  assert.equal(d.state, 'absent');
  assert.equal(d.participantValidation, null);
});

test('participant validation: verified duplicate/freshness/conflict matrices are order-invariant and unchanged', () => {
  // Two verified equal-fence v2 rows with divergent publishable content still
  // conflict; validation does not alter the duplicate authority among verified
  // candidates.
  const divergentRaw = {
    totalYards: '999',
    rushingYards: '187',
    netPassingYards: '225',
    turnovers: '1',
    thirdDownEff: '6-14',
    possessionTime: '31:24',
  };
  const a = v2Row({
    id: 100,
    home: HOME,
    away: AWAY,
    week: 3,
    fetchStartedAt: '2025-09-08T00:00:00Z',
  });
  const b = v2Row({
    id: 100,
    home: { ...HOME, raw: divergentRaw },
    away: AWAY,
    week: 3,
    fetchStartedAt: '2025-09-08T00:00:00Z',
  });
  for (const rows of [
    [a, b],
    [b, a],
  ]) {
    const d = decide(GAME, rows);
    assert.equal(d.state, 'duplicate-conflict');
    assert.equal(d.participantValidation, 'verified');
  }
});

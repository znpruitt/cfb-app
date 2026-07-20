import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACTIVATION_CONTROL_KEY,
  ACTIVATION_CONTROL_SCOPE,
  REVISIONED_EVIDENCE_WITNESS_KEY,
  classifyActivationTransition,
  classifyLegacyWrite,
  classifyRevisionedWrite,
  readActivationState,
  setActivationState,
  toControlRead,
  type ActivationControlRecord,
  type ActivationState,
  type ControlRead,
} from '../activationControl.ts';
import {
  GameStatsFenceError,
  getCachedGameStats,
  setCachedGameStats,
  writeLegacyGameStatsPartition,
} from '../cache.ts';
import type { WeeklyGameStats } from '../types.ts';
import {
  getAppState,
  setAppState,
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
} from '../../server/appStateStore.ts';
import { legacyRowFromWire, wireGame } from './fixtures.ts';

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

const BASE = { year: 2024, week: 6, seasonType: 'regular' as const };
const REVISION_LEDGER_SCOPE = 'game-stats-revision';
const LEDGER_KEY = `${BASE.year}:${BASE.week}:${BASE.seasonType}`;
function legacyPartition(): WeeklyGameStats {
  return {
    ...BASE,
    fetchedAt: '2024-10-06T00:00:00.000Z',
    games: [legacyRowFromWire(wireGame({ id: 1 }))],
  };
}
const rec = (state: ActivationState, evidence: boolean): ActivationControlRecord => ({
  schemaVersion: 1,
  state,
  updatedAt: '',
  revisionedEvidenceEverExisted: evidence,
});
/** A present control read carrying `value`. */
const present = (value: unknown): ControlRead => ({ present: true, value });
/** A genuinely absent control read. */
const ABSENT: ControlRead = { present: false, value: undefined };

// === Presence-aware read helper ===

test('toControlRead keeps row presence separate from a present JSON-null value', () => {
  assert.deepEqual(toControlRead(null), { present: false, value: undefined });
  assert.deepEqual(toControlRead({ value: null }), { present: true, value: null });
  assert.deepEqual(toControlRead({ value: { schemaVersion: 1 } }), {
    present: true,
    value: { schemaVersion: 1 },
  });
});

// === Pure transition state machine (forward-only) ===

test('classifyActivationTransition: exactly the four forward transitions + safe idempotent', () => {
  assert.ok(classifyActivationTransition(rec('legacy', false), 'armed', false).ok);
  assert.ok(classifyActivationTransition(rec('armed', false), 'active', false).ok);
  assert.ok(classifyActivationTransition(rec('armed', false), 'read-only-safe', false).ok);
  assert.ok(classifyActivationTransition(rec('active', false), 'read-only-safe', false).ok);
  // Idempotent same-state (safe).
  for (const s of ['armed', 'active', 'read-only-safe'] as const) {
    assert.ok(classifyActivationTransition(rec(s, false), s, false).ok, s);
  }
  assert.ok(classifyActivationTransition(rec('legacy', false), 'legacy', false).ok);
});

test('classifyActivationTransition: no path back to legacy, and read-only-safe is terminal', () => {
  // Every backward-to-legacy transition is removed (regardless of history).
  for (const from of ['armed', 'active', 'read-only-safe'] as const) {
    assert.deepEqual(classifyActivationTransition(rec(from, false), 'legacy', false), {
      ok: false,
      reason: 'invalid-transition',
    });
  }
  // read-only-safe is terminal — no transition out.
  for (const to of ['legacy', 'armed', 'active'] as const) {
    assert.deepEqual(classifyActivationTransition(rec('read-only-safe', false), to, false), {
      ok: false,
      reason: 'invalid-transition',
    });
  }
  // active only reaches read-only-safe; armed→legacy / legacy→active are invalid.
  assert.equal(classifyActivationTransition(rec('legacy', false), 'active', false).ok, false);
  assert.equal(classifyActivationTransition(rec('active', false), 'armed', false).ok, false);
});

test('classifyActivationTransition: idempotent legacy refuses when history survives', () => {
  assert.deepEqual(classifyActivationTransition(rec('legacy', true), 'legacy', true), {
    ok: false,
    reason: 'legacy-forbidden-after-evidence',
  });
  // history via the witness argument (record flag false) still refuses.
  assert.deepEqual(classifyActivationTransition(rec('legacy', false), 'legacy', true), {
    ok: false,
    reason: 'legacy-forbidden-after-evidence',
  });
});

// === Pure legacy write gate (presence-aware) ===

test('classifyLegacyWrite: allows legacy-only, fails safe on malformed/present-null', () => {
  assert.deepEqual(classifyLegacyWrite(ABSENT, false, false), { allow: true });
  assert.deepEqual(classifyLegacyWrite(present(rec('legacy', false)), false, false), {
    allow: true,
  });
  // Absent record but surviving history → refuse.
  assert.equal(classifyLegacyWrite(ABSENT, true, false).allow, false);
  assert.equal(classifyLegacyWrite(ABSENT, false, true).allow, false);
  // Non-legacy states → fenced-non-legacy.
  for (const state of ['armed', 'active', 'read-only-safe'] as const) {
    const gate = classifyLegacyWrite(present(rec(state, false)), false, false);
    assert.equal(gate.allow, false);
    if (!gate.allow) assert.equal(gate.reason, 'fenced-non-legacy');
  }
  // PRESENT-but-invalid (JSON null, primitive, array, bad object) → fenced-malformed,
  // NEVER treated as absence/legacy.
  for (const bad of [null, 7, 'x', [], { schemaVersion: 9 }, { schemaVersion: 1, state: 'nope' }]) {
    const gate = classifyLegacyWrite(present(bad), false, false);
    assert.equal(gate.allow, false, JSON.stringify(bad));
    if (!gate.allow) assert.equal(gate.reason, 'fenced-malformed', JSON.stringify(bad));
  }
  // Legacy state but evidence flag / witness / partition history → refuse.
  assert.equal(classifyLegacyWrite(present(rec('legacy', true)), false, false).allow, false);
  assert.equal(classifyLegacyWrite(present(rec('legacy', false)), true, false).allow, false);
  assert.equal(classifyLegacyWrite(present(rec('legacy', false)), false, true).allow, false);
});

test('classifyRevisionedWrite: only a present valid active record allows', () => {
  assert.deepEqual(classifyRevisionedWrite(present(rec('active', false))), { allow: true });
  assert.deepEqual(classifyRevisionedWrite(ABSENT), { allow: false, state: 'absent' });
  for (const bad of [null, 7, [], { schemaVersion: 9 }]) {
    assert.deepEqual(classifyRevisionedWrite(present(bad)), { allow: false, state: 'malformed' });
  }
  for (const state of ['legacy', 'armed', 'read-only-safe'] as const) {
    assert.deepEqual(classifyRevisionedWrite(present(rec(state, false))), { allow: false, state });
  }
});

// === Durable reads ===

test('absent → legacy; absent + (valid OR null) witness → read-only-safe; malformed → read-only-safe', async () => {
  assert.equal(await readActivationState(), 'legacy');
  // A valid witness survives an absent record.
  await setAppState(ACTIVATION_CONTROL_SCOPE, REVISIONED_EVIDENCE_WITNESS_KEY, {
    everExisted: true,
    firstAt: '2024-10-06T00:00:00.000Z',
  });
  assert.equal(await readActivationState(), 'read-only-safe');
  // A present JSON-null witness ALSO fails safe (never "no history").
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  await setAppState(ACTIVATION_CONTROL_SCOPE, REVISIONED_EVIDENCE_WITNESS_KEY, null);
  assert.equal(await readActivationState(), 'read-only-safe');
  // Malformed activation record → read-only-safe.
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  await setAppState(ACTIVATION_CONTROL_SCOPE, ACTIVATION_CONTROL_KEY, { schemaVersion: 9 });
  assert.equal(await readActivationState(), 'read-only-safe');
});

// === Durable transitions ===

test('durable transition matrix: forward succeeds, backward/terminal refuses', async () => {
  const set = (s: ActivationState) => setActivationState(s);
  // legacy → armed → active succeeds.
  assert.ok((await set('armed')).ok);
  assert.ok((await set('active')).ok);
  // active → read-only-safe succeeds; then read-only-safe is terminal.
  assert.ok((await set('read-only-safe')).ok);
  for (const to of ['legacy', 'armed', 'active'] as const) {
    const r = await set(to);
    assert.equal(r.ok, false, `read-only-safe → ${to}`);
    if (!r.ok) assert.equal(r.reason, 'invalid-transition');
  }

  // Fresh: legacy → armed is irreversible even with NO evidence.
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  assert.ok((await set('armed')).ok);
  const backToLegacy = await set('legacy');
  assert.equal(backToLegacy.ok, false);
  if (!backToLegacy.ok) assert.equal(backToLegacy.reason, 'invalid-transition');
  assert.equal(await readActivationState(), 'armed');
  // armed → read-only-safe still works.
  assert.ok((await set('read-only-safe')).ok);
});

test('a present-malformed activation record refuses ALL transitions and is not normalized', async () => {
  const corrupt = { schemaVersion: 9, junk: true };
  await setAppState(ACTIVATION_CONTROL_SCOPE, ACTIVATION_CONTROL_KEY, corrupt);
  for (const to of ['legacy', 'armed', 'active', 'read-only-safe'] as const) {
    const r = await setActivationState(to);
    assert.equal(r.ok, false, to);
    if (!r.ok) assert.equal(r.reason, 'activation-state-malformed', to);
  }
  // Byte-identical — never replaced with a default legacy record.
  assert.deepEqual(
    (await getAppState(ACTIVATION_CONTROL_SCOPE, ACTIVATION_CONTROL_KEY))?.value,
    corrupt
  );
});

test('a present JSON-null activation record fails safe (transitions refuse, unchanged)', async () => {
  await setAppState(ACTIVATION_CONTROL_SCOPE, ACTIVATION_CONTROL_KEY, null);
  const r = await setActivationState('armed');
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'activation-state-malformed');
  const stored = await getAppState(ACTIVATION_CONTROL_SCOPE, ACTIVATION_CONTROL_KEY);
  assert.equal(stored !== null, true); // row still present
  assert.equal(stored?.value, null); // still JSON null, not normalized
});

test('same-state legacy refuses when a surviving witness proves history', async () => {
  await setAppState(ACTIVATION_CONTROL_SCOPE, REVISIONED_EVIDENCE_WITNESS_KEY, {
    everExisted: true,
    firstAt: '2024-10-06T00:00:00.000Z',
  });
  // Activation record absent but the witness survives → inconsistent → refuse.
  const r = await setActivationState('legacy');
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'activation-state-malformed');
});

// === The LIVE fenced legacy writer (cache.setCachedGameStats) ===

test('the live legacy writer persists ONLY while the fence is legacy', async () => {
  const stats = legacyPartition();
  assert.deepEqual(await writeLegacyGameStatsPartition(stats), { ok: true });
  assert.ok(await getCachedGameStats(BASE.year, BASE.week, BASE.seasonType));

  const reach: Record<'armed' | 'active' | 'read-only-safe', ActivationState[]> = {
    armed: ['armed'],
    active: ['armed', 'active'],
    'read-only-safe': ['armed', 'read-only-safe'],
  };
  for (const state of ['armed', 'active', 'read-only-safe'] as const) {
    await __deleteAppStateFileForTests();
    __resetAppStateForTests();
    for (const step of reach[state])
      assert.ok((await setActivationState(step)).ok, `${state}:${step}`);
    const refused = await writeLegacyGameStatsPartition(stats);
    assert.equal(refused.ok, false, state);
    if (!refused.ok) assert.equal(refused.reason, 'fenced-non-legacy');
    assert.equal(await getCachedGameStats(BASE.year, BASE.week, BASE.seasonType), null, state);
  }
});

test('setCachedGameStats throws GameStatsFenceError when fenced', async () => {
  await setActivationState('armed');
  await assert.rejects(() => setCachedGameStats(legacyPartition()), GameStatsFenceError);
  assert.equal(await getCachedGameStats(BASE.year, BASE.week, BASE.seasonType), null);
});

test('the legacy writer fails safe on present-null / malformed control rows (nothing mutated)', async () => {
  const controlCases: Array<[string, string, string, unknown]> = [
    ['null activation', ACTIVATION_CONTROL_SCOPE, ACTIVATION_CONTROL_KEY, null],
    [
      'malformed activation',
      ACTIVATION_CONTROL_SCOPE,
      ACTIVATION_CONTROL_KEY,
      { schemaVersion: 9 },
    ],
    ['null witness', ACTIVATION_CONTROL_SCOPE, REVISIONED_EVIDENCE_WITNESS_KEY, null],
    ['null ledger', REVISION_LEDGER_SCOPE, LEDGER_KEY, null],
  ];
  for (const [name, scope, key, value] of controlCases) {
    await __deleteAppStateFileForTests();
    __resetAppStateForTests();
    await setAppState(scope, key, value);
    const refused = await writeLegacyGameStatsPartition(legacyPartition());
    assert.equal(refused.ok, false, name);
    // No partition was written, and the control row is byte-identical.
    assert.equal(await getCachedGameStats(BASE.year, BASE.week, BASE.seasonType), null, name);
    assert.deepEqual((await getAppState(scope, key))?.value, value, name);
  }
});

test('absent activation with provably no revision history bootstraps safely', async () => {
  assert.deepEqual(await writeLegacyGameStatsPartition(legacyPartition()), { ok: true });
});

test('restart-style: a persisted malformed activation still refuses after process reset', async () => {
  await setAppState(ACTIVATION_CONTROL_SCOPE, ACTIVATION_CONTROL_KEY, { schemaVersion: 9 });
  // Drop process-local state (locks/pool) but keep the durable file.
  __resetAppStateForTests();
  const refused = await writeLegacyGameStatsPartition(legacyPartition());
  assert.equal(refused.ok, false);
  if (!refused.ok && refused.reason === 'fenced-malformed') {
    assert.equal(refused.state, 'read-only-safe');
  } else {
    assert.fail('expected fenced-malformed after restart');
  }
});

test('behavior-equivalence: the fenced legacy write matches a raw write in legacy', async () => {
  const stats = legacyPartition();
  await writeLegacyGameStatsPartition(stats);
  const viaFence = await getCachedGameStats(BASE.year, BASE.week, BASE.seasonType);

  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  await setAppState('game-stats', LEDGER_KEY, stats);
  const viaRaw = await getCachedGameStats(BASE.year, BASE.week, BASE.seasonType);

  assert.deepEqual(viaFence, viaRaw);
});

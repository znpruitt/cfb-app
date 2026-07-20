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
  type ActivationControlRecord,
  type ActivationState,
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

// === Pure transition state machine ===

test('classifyActivationTransition: only the four forward transitions + safe idempotent', () => {
  assert.ok(classifyActivationTransition(rec('legacy', false), 'armed', false).ok);
  assert.ok(classifyActivationTransition(rec('armed', false), 'active', false).ok);
  assert.ok(classifyActivationTransition(rec('armed', false), 'read-only-safe', false).ok);
  assert.ok(classifyActivationTransition(rec('active', false), 'read-only-safe', false).ok);
  assert.ok(classifyActivationTransition(rec('active', true), 'active', true).ok); // idempotent
  // active never straight from legacy.
  assert.deepEqual(classifyActivationTransition(rec('legacy', false), 'active', false), {
    ok: false,
    reason: 'invalid-transition',
  });
  // active never returns to legacy.
  assert.deepEqual(classifyActivationTransition(rec('active', false), 'legacy', false), {
    ok: false,
    reason: 'invalid-transition',
  });
});

test('classifyActivationTransition: return to legacy forbidden once history exists', () => {
  // No history → aborting arming/safe-stop back to legacy is allowed.
  assert.ok(classifyActivationTransition(rec('armed', false), 'legacy', false).ok);
  assert.ok(classifyActivationTransition(rec('read-only-safe', false), 'legacy', false).ok);
  // History (witness or record flag) → permanently forbidden.
  assert.deepEqual(classifyActivationTransition(rec('armed', false), 'legacy', true), {
    ok: false,
    reason: 'legacy-forbidden-after-evidence',
  });
});

// === Pure legacy write gate ===

test('classifyLegacyWrite: allows legacy-only, fails safe otherwise', () => {
  assert.deepEqual(classifyLegacyWrite(null, false, false), { allow: true }); // absent, no history
  assert.deepEqual(classifyLegacyWrite(rec('legacy', false), false, false), { allow: true });
  // Absent record but surviving history → refuse.
  assert.equal(classifyLegacyWrite(null, true, false).allow, false);
  assert.equal(classifyLegacyWrite(null, false, true).allow, false);
  // Non-legacy states → fenced-non-legacy.
  for (const state of ['armed', 'active', 'read-only-safe'] as const) {
    const gate = classifyLegacyWrite(rec(state, false), false, false);
    assert.equal(gate.allow, false);
    if (!gate.allow) assert.equal(gate.reason, 'fenced-non-legacy');
  }
  // Malformed → fenced-malformed (never treated as legacy).
  const malformed = classifyLegacyWrite({ schemaVersion: 9 }, false, false);
  assert.equal(malformed.allow, false);
  if (!malformed.allow) assert.equal(malformed.reason, 'fenced-malformed');
  // Legacy state but evidence flag / witness / partition history → refuse.
  assert.equal(classifyLegacyWrite(rec('legacy', true), false, false).allow, false);
  assert.equal(classifyLegacyWrite(rec('legacy', false), true, false).allow, false);
  assert.equal(classifyLegacyWrite(rec('legacy', false), false, true).allow, false);
});

test('classifyRevisionedWrite: only a valid active record allows', () => {
  assert.deepEqual(classifyRevisionedWrite(rec('active', false)), { allow: true });
  assert.deepEqual(classifyRevisionedWrite(null), { allow: false, state: 'absent' });
  assert.deepEqual(classifyRevisionedWrite({ schemaVersion: 9 }), {
    allow: false,
    state: 'malformed',
  });
  for (const state of ['legacy', 'armed', 'read-only-safe'] as const) {
    assert.deepEqual(classifyRevisionedWrite(rec(state, false)), { allow: false, state });
  }
});

// === Durable reads ===

test('absent → legacy; absent + witness → read-only-safe; malformed → read-only-safe', async () => {
  assert.equal(await readActivationState(), 'legacy');
  await setAppState(ACTIVATION_CONTROL_SCOPE, REVISIONED_EVIDENCE_WITNESS_KEY, {
    everExisted: true,
    firstAt: '2024-10-06T00:00:00.000Z',
  });
  assert.equal(await readActivationState(), 'read-only-safe'); // witness survives an absent record
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  await setAppState(ACTIVATION_CONTROL_SCOPE, ACTIVATION_CONTROL_KEY, { schemaVersion: 9 });
  assert.equal(await readActivationState(), 'read-only-safe');
});

// === Durable transitions ===

test('setActivationState persists the fence and forbids legacy once witness exists', async () => {
  assert.ok((await setActivationState('armed')).ok);
  assert.ok((await setActivationState('active')).ok);
  assert.equal(await readActivationState(), 'active');

  // Simulate a durable evidence witness surviving; a return to legacy is refused.
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  await setActivationState('armed');
  await setAppState(ACTIVATION_CONTROL_SCOPE, REVISIONED_EVIDENCE_WITNESS_KEY, {
    everExisted: true,
    firstAt: '2024-10-06T00:00:00.000Z',
  });
  const back = await setActivationState('legacy');
  assert.equal(back.ok, false);
  if (!back.ok) assert.equal(back.reason, 'legacy-forbidden-after-evidence');
  assert.equal(await readActivationState(), 'armed');
});

// === The LIVE fenced legacy writer (cache.setCachedGameStats) ===

test('the live legacy writer persists ONLY while the fence is legacy', async () => {
  const stats = legacyPartition();
  assert.deepEqual(await writeLegacyGameStatsPartition(stats), { ok: true });
  assert.ok(await getCachedGameStats(BASE.year, BASE.week, BASE.seasonType));

  // Reach each non-legacy state via the permitted forward transitions.
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

test('malformed activation record fails safe and is not overwritten', async () => {
  const corrupt = { schemaVersion: 9, junk: true };
  await setAppState(ACTIVATION_CONTROL_SCOPE, ACTIVATION_CONTROL_KEY, corrupt);
  const refused = await writeLegacyGameStatsPartition(legacyPartition());
  assert.equal(refused.ok, false);
  if (!refused.ok && refused.reason === 'fenced-malformed') {
    assert.equal(refused.state, 'read-only-safe');
  } else {
    assert.fail('expected fenced-malformed');
  }
  // The corrupt record was NOT auto-normalized to legacy.
  assert.deepEqual(
    (await getAppState(ACTIVATION_CONTROL_SCOPE, ACTIVATION_CONTROL_KEY))?.value,
    corrupt
  );
});

test('absent activation + surviving revision history refuses legacy', async () => {
  // A revision ledger for this partition proves revision history survives.
  await setAppState(REVISION_LEDGER_SCOPE, LEDGER_KEY, {
    schemaVersion: 1,
    ...BASE,
    lineage: 'L',
    revision: 3,
    initializedFrom: 'new',
    initializedAt: '2024-10-06T00:00:00.000Z',
  });
  const refused = await writeLegacyGameStatsPartition(legacyPartition());
  assert.equal(refused.ok, false);
  if (!refused.ok && refused.reason === 'fenced-revision-history') {
    assert.equal(refused.state, 'read-only-safe');
  } else {
    assert.fail('expected fenced-revision-history');
  }
});

test('absent activation with provably no revision history bootstraps safely', async () => {
  // Clean store, no witness, no ledger → legacy write permitted.
  assert.deepEqual(await writeLegacyGameStatsPartition(legacyPartition()), { ok: true });
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

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyActivationTransition,
  defaultActivationRecord,
  readActivationControl,
  readActivationState,
  setActivationState,
  writeLegacyGameStatsPartition,
  type ActivationState,
} from '../activationControl.ts';
import { getCachedGameStats, setCachedGameStats } from '../cache.ts';
import type { WeeklyGameStats } from '../types.ts';
import {
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
function legacyPartition(): WeeklyGameStats {
  return {
    ...BASE,
    fetchedAt: '2024-10-06T00:00:00.000Z',
    games: [legacyRowFromWire(wireGame({ id: 1 }))],
  };
}

// === Pure transition state machine ===

test('classifyActivationTransition: enforces the durable invariants', () => {
  const rec = (state: ActivationState, evidence: boolean) => ({
    schemaVersion: 1 as const,
    state,
    updatedAt: '',
    revisionedEvidenceEverExisted: evidence,
  });
  // legacy → armed → active (arming precedes activation; active sets evidence).
  assert.deepEqual(classifyActivationTransition(rec('legacy', false), 'armed'), {
    ok: true,
    revisionedEvidenceEverExisted: false,
  });
  assert.deepEqual(classifyActivationTransition(rec('armed', false), 'active'), {
    ok: true,
    revisionedEvidenceEverExisted: true,
  });
  // active cannot go straight from legacy.
  assert.deepEqual(classifyActivationTransition(rec('legacy', false), 'active'), {
    ok: false,
    reason: 'invalid-transition',
  });
  // Return to legacy is forbidden once evidence has existed / from active.
  assert.deepEqual(classifyActivationTransition(rec('active', true), 'legacy'), {
    ok: false,
    reason: 'legacy-forbidden-after-evidence',
  });
  assert.deepEqual(classifyActivationTransition(rec('read-only-safe', true), 'legacy'), {
    ok: false,
    reason: 'legacy-forbidden-after-evidence',
  });
  // read-only-safe is always reachable.
  assert.ok(classifyActivationTransition(rec('active', true), 'read-only-safe').ok);
});

// === Durable read defaults ===

test('absent activation record resolves to legacy; malformed resolves to read-only-safe', async () => {
  assert.equal(await readActivationState(), 'legacy');
  assert.deepEqual(await readActivationControl(), defaultActivationRecord(''));
  // A corrupt record must never re-enable the legacy writer.
  await setAppState('game-stats-activation-control', 'global', { schemaVersion: 9, junk: true });
  assert.equal(await readActivationState(), 'read-only-safe');
});

// === Durable transitions ===

test('setActivationState persists the fence and forbids returning to legacy after active', async () => {
  assert.ok((await setActivationState('armed')).ok);
  assert.equal(await readActivationState(), 'armed');
  assert.ok((await setActivationState('active')).ok);
  assert.equal(await readActivationState(), 'active');
  const back = await setActivationState('legacy');
  assert.equal(back.ok, false);
  if (!back.ok) assert.equal(back.reason, 'legacy-forbidden-after-evidence');
  // The fence stayed active — the failed transition wrote nothing.
  assert.equal(await readActivationState(), 'active');
});

// === Fenced legacy setter ===

test('writeLegacyGameStatsPartition persists ONLY while the fence is legacy', async () => {
  const stats = legacyPartition();
  // legacy (default) → writes.
  const ok = await writeLegacyGameStatsPartition(stats);
  assert.deepEqual(ok, { ok: true });
  assert.ok(await getCachedGameStats(BASE.year, BASE.week, BASE.seasonType));

  // armed / active / read-only-safe → refuses (writing nothing new).
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  for (const state of ['armed', 'active'] as const) {
    if (state === 'armed') await setActivationState('armed');
    else {
      await setActivationState('armed');
      await setActivationState('active');
    }
    const refused = await writeLegacyGameStatsPartition(stats);
    assert.equal(refused.ok, false);
    if (!refused.ok && refused.reason === 'fenced-non-legacy') {
      assert.equal(refused.state, state);
    } else {
      assert.fail(`expected fenced-non-legacy for ${state}`);
    }
    assert.equal(await getCachedGameStats(BASE.year, BASE.week, BASE.seasonType), null);
    await __deleteAppStateFileForTests();
    __resetAppStateForTests();
  }
});

test('behavior-equivalence: the fenced legacy write matches setCachedGameStats in legacy', async () => {
  const stats = legacyPartition();
  await writeLegacyGameStatsPartition(stats);
  const viaFence = await getCachedGameStats(BASE.year, BASE.week, BASE.seasonType);

  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  await setCachedGameStats(stats);
  const viaLegacy = await getCachedGameStats(BASE.year, BASE.week, BASE.seasonType);

  assert.deepEqual(viaFence, viaLegacy);
});

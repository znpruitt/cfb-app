import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  setAppState,
} from '../../server/appStateStore.ts';
import {
  OBSERVATION_RECORD_TTL_DAYS,
  isObservationExpired,
  loadObservations,
  nextObservation,
  observationKey,
  saveObservation,
  type InsightObservation,
} from '../observationStore.ts';

// ---------------------------------------------------------------------------
// INSIGHTS-018 — the store records what the league SAW and when it CHANGED.
// Nothing here hides an insight; that is the whole difference from the
// suppression store it replaces.
//
// Rotation deliberately reads NONE of this. Ordering by a timestamp the write
// path advanced was the defect behind two failed attempts at rotation: showing
// an insight changed the input to the next selection.
// ---------------------------------------------------------------------------

const SLUG = 'obs-league';
const YEAR = 2026;
const NOW = new Date('2026-08-15T12:00:00.000Z');

const next = (
  prior: InsightObservation | undefined,
  over: Partial<Parameters<typeof nextObservation>[1]> = {}
) =>
  nextObservation(prior, {
    key: 'k',
    signature: 'sig-1',
    identity: 'id-1',
    statValue: 100,
    changed: true,
    now: NOW,
    ...over,
  });

beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

test('a first observation starts every clock together', () => {
  const o = next(undefined);
  assert.equal(o.firstSeenAt, NOW.toISOString());
  assert.equal(o.lastChangedAt, NOW.toISOString());
  assert.equal(o.lastObservedAt, NOW.toISOString());
});

test('an UNCHANGED observation holds the baseline and the change clock', () => {
  // The contract, and the fix for a defect both reviewers found: the baseline was
  // rewritten on every observation, so a threshold compared each request against
  // the PREVIOUS REQUEST rather than against what the league was last told. A
  // value drifting 2% a week never crossed a 5% threshold however far it moved.
  const first = next(undefined, { now: new Date('2026-08-01T00:00:00.000Z') });
  const again = next(first, {
    signature: 'sig-2',
    identity: 'id-2',
    statValue: 104,
    changed: false,
  });

  assert.equal(again.statValue, 100, 'the baseline is held, so drift can accumulate');
  assert.equal(again.identity, 'id-1', 'and so is the identity it was measured against');
  assert.equal(again.lastChangedAt, '2026-08-01T00:00:00.000Z', 'the change clock does not move');
  assert.equal(again.signature, 'sig-2', 'but the signature records what was actually seen');
  assert.equal(again.lastObservedAt, NOW.toISOString());
});

test('a CHANGED observation moves the baseline and the change clock', () => {
  const first = next(undefined, { now: new Date('2026-08-01T00:00:00.000Z') });
  const changed = next(first, { signature: 'sig-2', identity: 'id-2', statValue: 200 });
  assert.equal(changed.statValue, 200);
  assert.equal(changed.identity, 'id-2');
  assert.equal(changed.lastChangedAt, NOW.toISOString());
  assert.equal(changed.firstSeenAt, '2026-08-01T00:00:00.000Z', 'first-seen never moves');
});

test('an observation round-trips through the store', async () => {
  const o = next(undefined, { key: observationKey('drought-ballard') });
  await saveObservation(o, SLUG, YEAR);
  assert.deepEqual((await loadObservations(SLUG, YEAR, NOW.getTime())).get(o.key), o);
});

test('observations do not leak between leagues or seasons', async () => {
  await saveObservation(next(undefined), SLUG, YEAR);
  assert.equal((await loadObservations('other-league', YEAR, NOW.getTime())).size, 0);
  assert.equal((await loadObservations(SLUG, YEAR - 1, NOW.getTime())).size, 0);
});

test('expiry runs from the last OBSERVATION, not from first sight', () => {
  // Measuring from `firstSeenAt` — which is never rewritten — expired every record
  // 180 days after its first appearance however recently it had been seen, and at
  // that boundary spent EVENTS became fresh candidates again, re-serving a
  // season-wrap card months later.
  const old = new Date('2025-01-01T00:00:00.000Z').toISOString();
  const active: InsightObservation = {
    key: 'k',
    signature: 's',
    identity: 'i',
    statValue: 1,
    firstSeenAt: old,
    lastChangedAt: old,
    lastObservedAt: new Date(NOW.getTime() - 24 * 60 * 60 * 1000).toISOString(),
  };
  assert.equal(isObservationExpired(active, NOW.getTime()), false, 'seen yesterday, still alive');
  assert.equal(
    isObservationExpired({ ...active, lastObservedAt: old }, NOW.getTime()),
    true,
    'untouched for a year, expired'
  );
});

test('an expired record reads as absent, a fresh one does not', async () => {
  await saveObservation(next(undefined, { now: new Date('2025-01-01T00:00:00.000Z') }), SLUG, YEAR);
  assert.equal((await loadObservations(SLUG, YEAR, NOW.getTime())).size, 0);

  const withinWindow = new Date(
    NOW.getTime() - (OBSERVATION_RECORD_TTL_DAYS - 1) * 24 * 60 * 60 * 1000
  );
  await saveObservation(next(undefined, { key: 'k2', now: withinWindow }), SLUG, YEAR);
  assert.equal((await loadObservations(SLUG, YEAR, NOW.getTime())).size, 1);
});

test('a malformed stored row reads as absent rather than crashing', async () => {
  await setAppState(`insights-observation:${SLUG}:${YEAR}`, 'junk', { nope: true });
  await setAppState(`insights-observation:${SLUG}:${YEAR}`, 'alsojunk', 'a string');
  assert.equal((await loadObservations(SLUG, YEAR, NOW.getTime())).size, 0);
});

test('a corrupt timestamp is rejected by the GUARD, not made immortal', async () => {
  // `isObservationExpired` returned false on an unparsable date, so a corrupt
  // record was accepted and then never expired — pinning a stale baseline forever
  // while this guard\'s own doc said malformed records read as absent.
  await setAppState(`insights-observation:${SLUG}:${YEAR}`, 'k', {
    key: 'k',
    signature: 's',
    identity: 'i',
    statValue: 1,
    firstSeenAt: 'corrupt',
    lastChangedAt: NOW.toISOString(),
    lastObservedAt: NOW.toISOString(),
  });
  assert.equal((await loadObservations(SLUG, YEAR, NOW.getTime())).size, 0);
});

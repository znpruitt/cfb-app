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
// ---------------------------------------------------------------------------

const SLUG = 'obs-league';
const YEAR = 2026;
const NOW = new Date('2026-08-15T12:00:00.000Z');

beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

test('a first observation is new, and its clocks all start together', () => {
  const o = nextObservation(undefined, 'drought-ballard', 'sig-1', 1, true, NOW, 'w1');
  assert.equal(o.firstSeenAt, NOW.toISOString());
  assert.equal(o.lastChangedAt, NOW.toISOString());
  assert.equal(o.lastShownAt, NOW.toISOString());
});

test('RESURFACING an unchanged insight does not reset its change clock', () => {
  // The core contract, and the owner's decision: NEW means CHANGED. A standing
  // fact that rotates back into view did not change — it merely reappeared — and
  // re-badging it would train a reader to distrust the badge.
  const first = nextObservation(
    undefined,
    'k',
    'sig-1',
    1,
    true,
    new Date('2026-08-01T00:00:00.000Z'),
    'w1'
  );
  const again = nextObservation(first, 'k', 'sig-1', 1, false, NOW, 'w2');

  assert.equal(again.lastChangedAt, '2026-08-01T00:00:00.000Z', 'change clock is untouched');
  assert.equal(again.lastShownAt, NOW.toISOString(), 'but it was shown again');
  assert.equal(again.firstSeenAt, '2026-08-01T00:00:00.000Z', 'and first-seen never moves');
});

test('a CHANGED insight moves the change clock', () => {
  const first = nextObservation(
    undefined,
    'k',
    'sig-1',
    1,
    true,
    new Date('2026-08-01T00:00:00.000Z'),
    'w1'
  );
  const changed = nextObservation(first, 'k', 'sig-2', 2, true, NOW, 'w2');
  assert.equal(changed.lastChangedAt, NOW.toISOString());
  assert.equal(changed.firstSeenAt, '2026-08-01T00:00:00.000Z');
});

test('an observation round-trips through the store', async () => {
  const o = nextObservation(undefined, observationKey('drought-ballard'), 's', 1, true, NOW, 'w1');
  await saveObservation(o, SLUG, YEAR);
  const loaded = await loadObservations(SLUG, YEAR, NOW.getTime());
  assert.deepEqual(loaded.get(o.key), o);
});

test('observations do not leak between leagues or seasons', async () => {
  const o = nextObservation(undefined, 'k', 's', 1, true, NOW, 'w1');
  await saveObservation(o, SLUG, YEAR);
  assert.equal((await loadObservations('other-league', YEAR, NOW.getTime())).size, 0);
  assert.equal((await loadObservations(SLUG, YEAR - 1, NOW.getTime())).size, 0);
});

test('an expired observation reads as absent', async () => {
  // The rollover clear is best-effort and never fails a rollover, so a league can
  // enter a season with stale records. Without the TTL those would keep a months
  // -old change clock alive and suppress NEW forever.
  const old = nextObservation(
    undefined,
    'k',
    's',
    1,
    true,
    new Date('2025-01-01T00:00:00.000Z'),
    'w0'
  );
  await saveObservation(old, SLUG, YEAR);
  const loaded = await loadObservations(SLUG, YEAR, NOW.getTime());
  assert.equal(loaded.size, 0);

  // ...and one inside the window is still there.
  const fresh = nextObservation(
    undefined,
    'k2',
    's',
    1,
    true,
    new Date(NOW.getTime() - (OBSERVATION_RECORD_TTL_DAYS - 1) * 24 * 60 * 60 * 1000),
    'w0'
  );
  await saveObservation(fresh, SLUG, YEAR);
  assert.equal((await loadObservations(SLUG, YEAR, NOW.getTime())).size, 1);
});

test('a malformed stored row reads as absent rather than crashing', async () => {
  // `getAppState` performs no runtime validation. A record that survived the
  // guard would be worse than one that fails it: it would carry a garbage change
  // clock into the NEW decision.
  await setAppState(`insights-observation:${SLUG}:${YEAR}`, 'junk', { nope: true });
  await setAppState(`insights-observation:${SLUG}:${YEAR}`, 'alsojunk', 'a string');
  const loaded = await loadObservations(SLUG, YEAR, NOW.getTime());
  assert.equal(loaded.size, 0);
});

test('a record with lastShownAt null survives the guard', async () => {
  // Reachable by design: INSIGHTS-026's pulse writes an observation when it
  // PRODUCES an item, before any reader has seen it. A guard that rejected null
  // would drop exactly the records the pulse depends on.
  const produced: InsightObservation = {
    key: 'pulse-week-8',
    signature: 'sig',
    statValue: 1,
    firstSeenAt: NOW.toISOString(),
    lastChangedAt: NOW.toISOString(),
    lastShownAt: null,
    lastShownBucket: null,
  };
  await setAppState(`insights-observation:${SLUG}:${YEAR}`, produced.key, produced);
  const loaded = await loadObservations(SLUG, YEAR, NOW.getTime());
  assert.deepEqual(loaded.get(produced.key), produced);
});

test('lastShownAt advances only on a NEW BUCKET', () => {
  // THE defect both reviewers reproduced. `lastShownAt` was rewritten every
  // request, so after the first load every record held a distinct timestamp, the
  // bucket tiebreak never fired, and the served set flipped on every page load —
  // the exact failure the design claims to avoid. Navigating Overview → All
  // Insights → back advanced it three times.
  const first = nextObservation(
    undefined,
    'k',
    's',
    1,
    true,
    new Date('2026-08-01T00:00:00.000Z'),
    'w1'
  );
  assert.equal(first.lastShownBucket, 'w1');

  const sameBucket = nextObservation(first, 'k', 's', 1, false, NOW, 'w1');
  assert.equal(
    sameBucket.lastShownAt,
    '2026-08-01T00:00:00.000Z',
    'a second load in the same bucket does not move the rotation position'
  );

  const nextBucket = nextObservation(sameBucket, 'k', 's', 1, false, NOW, 'w2');
  assert.equal(nextBucket.lastShownAt, NOW.toISOString(), 'a new bucket does');
  assert.equal(nextBucket.lastShownBucket, 'w2');
});

test('expiry runs from ACTIVITY, so a live record does not die at 180 days', () => {
  // Measuring from firstSeenAt expired every record 180 days after its first
  // appearance however recently it had changed or been shown — and at that
  // boundary spent EVENTS became fresh candidates again, re-serving a season-wrap
  // card months later, which is what the event classification exists to prevent.
  const old = new Date('2025-01-01T00:00:00.000Z');
  const active: InsightObservation = {
    key: 'k',
    signature: 's',
    statValue: 1,
    firstSeenAt: old.toISOString(),
    lastChangedAt: old.toISOString(),
    lastShownAt: new Date(NOW.getTime() - 24 * 60 * 60 * 1000).toISOString(),
    lastShownBucket: 'w1',
  };
  assert.equal(isObservationExpired(active, NOW.getTime()), false, 'shown yesterday, still alive');

  const dormant: InsightObservation = { ...active, lastShownAt: old.toISOString() };
  assert.equal(isObservationExpired(dormant, NOW.getTime()), true, 'untouched for a year, expired');
});

test('a corrupt timestamp is rejected by the GUARD, not made immortal', () => {
  // `isObservationExpired` returned false on an unparsable date, so a record with
  // a corrupt timestamp was accepted and never expired — pinning a stale
  // signature and rotation position forever, while the guard's own doc said a
  // malformed record must read as absent.
  const bad = {
    key: 'k',
    signature: 's',
    statValue: 1,
    firstSeenAt: 'corrupt',
    lastChangedAt: NOW.toISOString(),
    lastShownAt: null,
    lastShownBucket: null,
  };
  return setAppState(`insights-observation:${SLUG}:${YEAR}`, 'k', bad)
    .then(() => loadObservations(SLUG, YEAR, NOW.getTime()))
    .then((loaded) => assert.equal(loaded.size, 0));
});

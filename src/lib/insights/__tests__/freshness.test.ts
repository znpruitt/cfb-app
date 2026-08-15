import assert from 'node:assert/strict';
import test from 'node:test';

import type { Insight } from '../../selectors/insights.ts';
import {
  INSIGHT_KIND,
  NEW_WINDOW_IN_SEASON_MS,
  NEW_WINDOW_OUT_OF_SEASON_MS,
  insightSignature,
  isNewInsight,
  newWindowMs,
} from '../freshness.ts';

// ---------------------------------------------------------------------------
// INSIGHTS-018 — the pure half: what an insight IS over time, and what makes it
// NEW. Storage and selection are tested separately; nothing here touches a store.
// ---------------------------------------------------------------------------

function insightWith(overrides: Partial<Insight> = {}): Insight {
  return {
    id: 'drought-ballard',
    type: 'drought',
    title: 'Title drought',
    description: 'Ballard has not won since 2019.',
    owner: 'Ballard',
    priorityScore: 50,
    newsHook: 'streak_extended',
    statValue: 6,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

test('the single-season toilet bowl is an EVENT, not a standing fact', () => {
  // The owner's rule, and its worked example: "toilet bowl" is the league's name
  // for the weekly last-place finisher, and this type counts how many times an
  // owner won it in ONE season. News at season wrap, history afterwards. The
  // cumulative all-time version is the tier worth repeating — and does not exist
  // yet (INSIGHTS-027).
  assert.equal(INSIGHT_KIND.toilet_bowl, 'event');
  // Its inverse IS cumulative, and therefore rotates.
  assert.equal(INSIGHT_KIND.never_last, 'standing');
});

test('a single-season record is an event; its cumulative cousin is not', () => {
  assert.equal(INSIGHT_KIND.greatest_season, 'event');
  assert.equal(INSIGHT_KIND.career_points_leader, 'standing-moving');
});

test('facts whose value drifts are separated from facts that do not', () => {
  // The distinction earns its keep: `standing-moving` keeps the existing
  // abs/pct thresholds and can re-earn NEW; `standing` never changes without
  // league history changing, so it rotates and is never badged.
  assert.equal(INSIGHT_KIND.drought, 'standing');
  assert.equal(INSIGHT_KIND.perfect_against, 'standing');
  assert.equal(INSIGHT_KIND.race, 'standing-moving');
  assert.equal(INSIGHT_KIND.ball_security, 'standing-moving');
});

test('no insight type is left unclassified', () => {
  // `Record<InsightType, InsightKind>` makes the compiler enforce this, so the
  // value here is catching a WRONG value rather than a missing one — and proving
  // the table is reachable at runtime rather than erased.
  const kinds = new Set(Object.values(INSIGHT_KIND));
  for (const [type, kind] of Object.entries(INSIGHT_KIND)) {
    assert.ok(
      kind === 'event' || kind === 'standing' || kind === 'standing-moving',
      `${type} has an unrecognised kind: ${kind}`
    );
  }
  assert.deepEqual([...kinds].sort(), ['event', 'standing', 'standing-moving']);
});

// ---------------------------------------------------------------------------
// Signature — what has to change for NEW
// ---------------------------------------------------------------------------

test('rewording an insight does NOT make it new', () => {
  // Copy variation rewrites descriptions without the underlying fact moving. If
  // wording fed the signature, editing a template would light up a league's
  // entire feed as new — the badge would mean "we deployed", not "this changed".
  const a = insightWith({ description: 'Ballard has not won since 2019.' });
  const b = insightWith({
    description: 'Still no title for Ballard since 2019.',
    title: 'Drought',
  });
  assert.equal(insightSignature(a), insightSignature(b));
});

test('the stat moving DOES make it new', () => {
  assert.notEqual(insightSignature(insightWith()), insightSignature(insightWith({ statValue: 7 })));
});

test('a different owner is a different insight', () => {
  assert.notEqual(
    insightSignature(insightWith()),
    insightSignature(insightWith({ owner: 'Ciprys' }))
  );
});

test('related owners are part of the identity, and order-independent', () => {
  // A rivalry insight naming two owners must change when one of them changes.
  // Order must NOT matter: generators build these lists from maps and sets, and a
  // reordering is not a change to the fact.
  const ab = insightWith({ owner: 'Ballard', relatedOwners: ['Ciprys', 'Maleski'] });
  const ba = insightWith({ owner: 'Ballard', relatedOwners: ['Maleski', 'Ciprys'] });
  assert.equal(insightSignature(ab), insightSignature(ba));

  const different = insightWith({ owner: 'Ballard', relatedOwners: ['Ciprys', 'Gladney'] });
  assert.notEqual(insightSignature(ab), insightSignature(different));
});

test('the signature cannot collide across distinct owner sets', () => {
  // PLATFORM-094 shipped a 32-bit digest whose comment called it "practically
  // collision-free", and review produced two collisions on real catalog data
  // within a day. This encoding is injective by construction; the test exists so
  // that nobody swaps it for a hash without the failure being visible.
  const seen = new Map<string, string>();
  const owners = ['Ballard', 'Ciprys', 'Maleski', 'Gladney', 'Jackson', 'BHooper'];
  for (const a of owners) {
    for (const b of owners) {
      if (a === b) continue;
      const sig = insightSignature(insightWith({ owner: a, relatedOwners: [b] }));
      const label = `${a}+${b}`;
      const prior = seen.get(sig);
      // `a+b` and `b+a` are the same unordered pair and SHOULD share a signature.
      if (prior) assert.equal(prior.split('+').sort().join('+'), label.split('+').sort().join('+'));
      seen.set(sig, label);
    }
  }
  // 6 owners → 15 unordered pairs.
  assert.equal(seen.size, 15);
});

// ---------------------------------------------------------------------------
// NEW windows
// ---------------------------------------------------------------------------

test('the NEW window is short in season and long outside it', () => {
  // In season the data moves weekly and a stale badge is worse than none.
  // Outside it nothing changes for months, so a 48-hour window would mean no
  // reader ever sees a badge at all.
  assert.equal(newWindowMs('mid_season'), NEW_WINDOW_IN_SEASON_MS);
  assert.equal(newWindowMs('postseason'), NEW_WINDOW_IN_SEASON_MS);
  assert.equal(newWindowMs('preseason'), NEW_WINDOW_OUT_OF_SEASON_MS);
  assert.equal(newWindowMs('offseason'), NEW_WINDOW_OUT_OF_SEASON_MS);
  assert.equal(newWindowMs('fresh_offseason'), NEW_WINDOW_OUT_OF_SEASON_MS);
});

test('an insight the league has never seen is new', () => {
  assert.equal(isNewInsight(null, 'preseason', new Date('2026-08-15T00:00:00.000Z')), true);
});

test('NEW expires at the window boundary, not before', () => {
  const changed = '2026-08-15T00:00:00.000Z';
  const at = (ms: number) => new Date(new Date(changed).getTime() + ms);
  assert.equal(isNewInsight(changed, 'mid_season', at(NEW_WINDOW_IN_SEASON_MS - 1)), true);
  assert.equal(isNewInsight(changed, 'mid_season', at(NEW_WINDOW_IN_SEASON_MS)), true, 'inclusive');
  assert.equal(isNewInsight(changed, 'mid_season', at(NEW_WINDOW_IN_SEASON_MS + 1)), false);

  // The same timestamp is still new in preseason, where the window is longer.
  assert.equal(isNewInsight(changed, 'preseason', at(NEW_WINDOW_IN_SEASON_MS + 1)), true);
});

test('a malformed timestamp does not mint a permanent NEW badge', () => {
  // `getAppState` performs no runtime validation. The conservative direction is
  // "not new": the failure is a missing badge rather than a feed insisting
  // everything is fresh forever.
  assert.equal(isNewInsight('not-a-date', 'preseason', new Date()), false);
});

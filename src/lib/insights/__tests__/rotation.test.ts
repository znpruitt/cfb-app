import assert from 'node:assert/strict';
import test from 'node:test';

import type { Insight, InsightType } from '../../selectors/insights.ts';
import { insightSignature } from '../freshness.ts';
import { observationKey, type InsightObservation } from '../observationStore.ts';
import { rotationBucket, selectRotatedInsights } from '../rotation.ts';

// ---------------------------------------------------------------------------
// INSIGHTS-018 — selection. The defect this replaces: "drop anything already
// fired" drained a preseason feed to nothing, because almost every type
// suppressed on an UNCHANGED stat value and no stat value can move when no games
// are played.
// ---------------------------------------------------------------------------

function insight(id: string, type: InsightType, priorityScore = 50): Insight {
  return {
    id,
    type,
    title: id,
    description: `${id} description`,
    owner: 'Ballard',
    priorityScore,
    newsHook: 'streak_extended',
    statValue: 1,
  };
}

/** An observation saying "seen at this time, unchanged since". */
function seen(i: Insight, at: string, bucket = 'w0'): [string, InsightObservation] {
  const key = observationKey(i.id);
  return [
    key,
    {
      key,
      signature: insightSignature(i),
      statValue: i.statValue,
      firstSeenAt: at,
      lastChangedAt: at,
      lastShownAt: at,
      lastShownBucket: bucket,
    },
  ];
}

const NOW = new Date('2026-08-15T12:00:00.000Z');

function select(insights: Insight[], observations: Array<[string, InsightObservation]>, limit = 5) {
  return selectRotatedInsights({
    insights,
    observations: new Map(observations),
    lifecycleState: 'preseason',
    now: NOW,
    limit,
  }).selected.map((i) => i.id);
}

test('a standing fact already seen still appears — it is not suppressed', () => {
  // THE defect. Under the old model this returned nothing: the stat had not
  // changed, so the insight was dropped, forever, because in preseason it never
  // will change.
  const drought = insight('drought-1', 'drought');
  assert.deepEqual(select([drought], [seen(drought, '2026-08-01T00:00:00.000Z')]), ['drought-1']);
});

test('an EVENT already seen does not come back', () => {
  // The other half of the rule: "Ballard won the toilet bowl 7 times in 2025" is
  // news at season wrap and noise in March.
  const bowl = insight('toilet-1', 'toilet_bowl');
  assert.deepEqual(select([bowl], [seen(bowl, '2026-08-01T00:00:00.000Z')]), []);
});

test('an unseen event DOES appear — it is spent by being seen, not by being an event', () => {
  const bowl = insight('toilet-1', 'toilet_bowl');
  assert.deepEqual(select([bowl], []), ['toilet-1']);
});

test('changed insights come before rotated ones, regardless of priority', () => {
  // A reader should meet what they have not been told first. A high-priority
  // standing fact they have already seen must not outrank actual news.
  const changed = insight('changed', 'drought', 10);
  const seenHigh = insight('seen-high', 'dynasty', 99);
  const stale = seen(seenHigh, '2026-08-01T00:00:00.000Z');
  assert.deepEqual(select([seenHigh, changed], [stale]), ['changed', 'seen-high']);
});

test('rotation surfaces the least-recently-shown first', () => {
  const a = insight('a', 'drought');
  const b = insight('b', 'dynasty');
  const c = insight('c', 'consistency');
  const observations = [
    seen(a, '2026-08-10T00:00:00.000Z'),
    seen(b, '2026-08-01T00:00:00.000Z'),
    seen(c, '2026-08-05T00:00:00.000Z'),
  ];
  assert.deepEqual(select([a, b, c], observations), ['b', 'c', 'a']);
});

test('a produced-but-never-shown insight outranks everything already seen', () => {
  // Reachable by design: INSIGHTS-026's pulse writes an observation when it
  // PRODUCES an item, before any reader has seen it.
  const pulseItem = insight('pulse-week-8', 'drought');
  const key = observationKey(pulseItem.id);
  const produced: [string, InsightObservation] = [
    key,
    {
      key,
      signature: insightSignature(pulseItem),
      statValue: pulseItem.statValue,
      firstSeenAt: '2026-08-14T00:00:00.000Z',
      lastChangedAt: '2026-08-14T00:00:00.000Z',
      lastShownAt: null,
      lastShownBucket: null,
    },
  ];
  const old = insight('old', 'dynasty');
  assert.deepEqual(select([old, pulseItem], [seen(old, '2026-08-01T00:00:00.000Z'), produced]), [
    'pulse-week-8',
    'old',
  ]);
});

test('the order is STABLE within a bucket and does not depend on input order', () => {
  // Raw insights are cached while selection runs per request, so anything
  // stochastic would reshuffle the feed on every page load and a reader could
  // never find the same card twice.
  const items = ['a', 'b', 'c', 'd'].map((id) => insight(id, 'drought'));
  const observations = items.map((i) => seen(i, '2026-08-01T00:00:00.000Z'));
  const forward = select(items, observations, 4);
  const reversed = select([...items].reverse(), observations, 4);
  assert.deepEqual(forward, reversed);
  assert.deepEqual(forward, select(items, observations, 4), 'and repeatable');
});

test('the order CHANGES between buckets, so the feed actually rotates', () => {
  // The positive control for stability: identical within a bucket must not mean
  // identical forever, or nothing rotates and the fix does nothing.
  const items = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => insight(id, 'drought'));
  const observations = new Map(items.map((i) => seen(i, '2026-08-01T00:00:00.000Z')));
  const orderAt = (now: Date) =>
    selectRotatedInsights({
      insights: items,
      observations,
      lifecycleState: 'preseason',
      now,
      limit: 3,
    }).selected.map((i) => i.id);

  const thisWeek = orderAt(NOW);
  const nextWeek = orderAt(new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000));
  assert.notDeepEqual(thisWeek, nextWeek, 'a later bucket surfaces a different slice');
});

test('buckets are daily in season and weekly outside it', () => {
  const day2 = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
  assert.notEqual(rotationBucket(NOW, 'mid_season'), rotationBucket(day2, 'mid_season'));
  assert.equal(rotationBucket(NOW, 'preseason'), rotationBucket(day2, 'preseason'));
});

// ---------------------------------------------------------------------------
// The serving half, end to end against a real store. THIS is the acceptance
// test for the campaign: the old model returned nothing on a repeat call in
// preseason, and the full suite never noticed — nothing exercised the serving
// path twice.
// ---------------------------------------------------------------------------

test('a preseason feed SURVIVES repeated loads, and the badge decays', async () => {
  const { applyRotation } = await import('../engine.ts');
  const { __deleteAppStateFileForTests, __resetAppStateForTests } = await import(
    '../../server/appStateStore.ts'
  );
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();

  const raw = [
    insight('drought-1', 'drought', 90),
    insight('dynasty-1', 'dynasty', 80),
    insight('perfect-1', 'perfect_against', 70),
  ];

  // First load: nothing has been seen, so everything is new.
  const first = await applyRotation(raw, 'rot-league', 2026, 'preseason', NOW);
  assert.equal(first.length, 3, 'all three served');
  assert.ok(
    first.every((i) => i.isNew === true),
    'a league that has never seen an insight is being told something new'
  );

  // Second load, same data, moments later. **Under SUPPRESSION this returned
  // NOTHING** — the stat values were unchanged and in preseason they never move,
  // so every one of them was hidden for the rest of the preseason. This is the
  // defect the campaign exists for.
  const second = await applyRotation(raw, 'rot-league', 2026, 'preseason', NOW);
  assert.equal(second.length, 3, 'the feed does not drain');
  assert.ok(
    second.every((i) => i.isNew === true),
    'still badged, correctly: they entered the feed moments ago and the preseason window is 7 days'
  );

  // A load AFTER that window: still served — and no longer badged, because
  // nothing changed, it merely persisted.
  const later = new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1000);
  const third = await applyRotation(raw, 'rot-league', 2026, 'preseason', later);
  assert.equal(third.length, 3, 'still served a month on');
  assert.ok(
    third.every((i) => i.isNew === false),
    'and the badge has decayed'
  );
});

test('a CHANGED insight is re-badged on the next load', async () => {
  const { applyRotation } = await import('../engine.ts');
  const { __deleteAppStateFileForTests, __resetAppStateForTests } = await import(
    '../../server/appStateStore.ts'
  );
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();

  const before = [insight('drought-1', 'drought')];
  await applyRotation(before, 'chg-league', 2026, 'preseason', NOW);

  // Let the badge decay so the re-badge below cannot be an artefact of the
  // window still being open.
  const later = new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1000);
  const settled = await applyRotation(before, 'chg-league', 2026, 'preseason', later);
  assert.equal(settled[0]?.isNew, false, 'precondition: settled and unbadged');

  // The stat moves — a drought lengthening by a season.
  const after = [{ ...before[0]!, statValue: 7 }];
  const changed = await applyRotation(after, 'chg-league', 2026, 'preseason', later);
  assert.equal(changed[0]?.isNew, true, 'a moved stat is news again');
});

test('the served SET is stable across repeated loads in one bucket', async () => {
  // THE defect both reviewers reproduced, and the one my own stability test
  // could not see: it held the observation map FIXED across buckets, so it
  // asserted stability under conditions where instability was unreachable.
  //
  // `nextObservation` advanced `lastShownAt` on every request, so after the first
  // load every record held a distinct timestamp, the bucket tiebreak never fired,
  // and the served set flipped on each page load. Navigating Overview → All
  // Insights → back advanced it three times.
  const { applyRotation } = await import('../engine.ts');
  const { __deleteAppStateFileForTests, __resetAppStateForTests } = await import(
    '../../server/appStateStore.ts'
  );
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();

  // More candidates than the feed holds — the condition that exposes it.
  const raw = Array.from({ length: 14 }, (_, i) => insight(`drought-${i}`, 'drought', 50));

  const load = async (at: Date) =>
    (await applyRotation(raw, 'stable-league', 2026, 'preseason', at)).map((i) => i.id);

  // WARM UP first. An insight the league has never seen is genuinely news and
  // outranks anything merely rotating, so with 14 candidates and 5 slots the feed
  // legitimately churns until everything has been seen once. That is a transient
  // property of a COLD store, not the defect — the defect was that it never
  // settled at all, because `lastShownAt` advanced on every request and handed
  // the sort a total order it should not have had.
  for (let i = 0; i < 3; i++) await load(new Date(NOW.getTime() + i * 1000));

  const settled = await load(new Date(NOW.getTime() + 3000));
  const again = await load(new Date(NOW.getTime() + 4000));
  const third = await load(new Date(NOW.getTime() + 5000));

  assert.deepEqual(again, settled, 'once warm, a second load in the same bucket is identical');
  assert.deepEqual(third, settled, 'and a third — a reader can find a card twice');
});

test('a LATER bucket serves a different set — rotation still rotates', async () => {
  // The positive control. Stability within a bucket must not be achieved by
  // never advancing at all, which would freeze the feed permanently — a
  // different failure with the same symptom on a single page load.
  const { applyRotation } = await import('../engine.ts');
  const { __deleteAppStateFileForTests, __resetAppStateForTests } = await import(
    '../../server/appStateStore.ts'
  );
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();

  const raw = Array.from({ length: 14 }, (_, i) => insight(`drought-${i}`, 'drought', 50));
  // Warm the store, so this compares rotation against rotation rather than
  // against "never seen".
  for (let i = 0; i < 3; i++) {
    await applyRotation(
      raw,
      'rotate-league',
      2026,
      'preseason',
      new Date(NOW.getTime() + i * 1000)
    );
  }
  const first = (
    await applyRotation(raw, 'rotate-league', 2026, 'preseason', new Date(NOW.getTime() + 3000))
  ).map((i) => i.id);
  const nextWeek = new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000);
  const later = (await applyRotation(raw, 'rotate-league', 2026, 'preseason', nextWeek)).map(
    (i) => i.id
  );

  assert.notDeepEqual(later, first, 'the next bucket brings different facts forward');
});

test('a standing-moving insight needs a MEANINGFUL move to be news again', async () => {
  // Review: the signature embeds an exact statValue, so a one-unit drift marked
  // these changed, put them at the head of the feed and badged them. In season
  // these move weekly, so all nine such types sat permanently in the changed
  // bucket and squeezed static standing facts out of rotation entirely.
  // `career_points_leader` carries a 5% tolerance in `suppression.ts`.
  const { applyRotation } = await import('../engine.ts');
  const { __deleteAppStateFileForTests, __resetAppStateForTests } = await import(
    '../../server/appStateStore.ts'
  );
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();

  const base = { ...insight('points-leader', 'career_points_leader'), statValue: 10_000 };
  await applyRotation([base], 'thr-league', 2026, 'mid_season', NOW);

  const later = new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1000);
  const nudged = await applyRotation(
    [{ ...base, statValue: 10_100 }],
    'thr-league',
    2026,
    'mid_season',
    later
  );
  assert.equal(nudged[0]?.isNew, false, '1% is inside the 5% tolerance — not news');

  const moved = await applyRotation(
    [{ ...base, statValue: 12_000 }],
    'thr-league',
    2026,
    'mid_season',
    later
  );
  assert.equal(moved[0]?.isNew, true, '20% is a real move');
});

test('milestone_watch survives being seen — it is not an event', async () => {
  // Review, HIGH: it was on NEVER_SUPPRESS_TYPES, and classifying it as an event
  // dropped it from candidacy once seen. Its statValue is the milestone TARGET,
  // not the running total, so its signature cannot change while an owner closes
  // on the mark — "Alice is 40 points from 5,000" would have shown once and died
  // for the season.
  const { applyRotation } = await import('../engine.ts');
  const { __deleteAppStateFileForTests, __resetAppStateForTests } = await import(
    '../../server/appStateStore.ts'
  );
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();

  const watch = [insight('milestone-approaching-alice', 'milestone_watch')];
  assert.equal((await applyRotation(watch, 'ms-league', 2026, 'preseason', NOW)).length, 1);
  const nextWeek = new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000);
  assert.equal(
    (await applyRotation(watch, 'ms-league', 2026, 'preseason', nextWeek)).length,
    1,
    'still served after being seen'
  );
});

test('the weekly bucket turns over on MONDAY, not on an epoch artifact', () => {
  // `floor(days / 7)` counts weeks from 1 Jan 1970, a Thursday, so the boundary
  // landed on Thursday 00:00 UTC — about ten hours before the Thursday pulse
  // INSIGHTS-026 plans. Two mechanisms moving the feed within half a day of each
  // other, neither deliberately.
  const at = (iso: string) => rotationBucket(new Date(iso), 'preseason');

  // 2026-08-17 is a Monday.
  assert.equal(at('2026-08-16T23:59:59.000Z'), at('2026-08-13T00:00:00.000Z'), 'Sun sits with Thu');
  assert.notEqual(at('2026-08-17T00:00:00.000Z'), at('2026-08-16T23:59:59.000Z'), 'Mon turns over');
  assert.equal(
    at('2026-08-17T00:00:00.000Z'),
    at('2026-08-23T23:59:59.000Z'),
    'Mon-Sun is one bucket'
  );
});

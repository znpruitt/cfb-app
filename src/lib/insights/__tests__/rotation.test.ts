import assert from 'node:assert/strict';
import test from 'node:test';

import type { Insight, InsightType } from '../../selectors/insights.ts';
import { insightIdentity, insightSignature } from '../freshness.ts';
import { observationKey, type InsightObservation } from '../observationStore.ts';
import { rotationBucketIndex, selectRotatedInsights } from '../rotation.ts';

// ---------------------------------------------------------------------------
// INSIGHTS-018 — selection.
//
// Rewritten with the algorithm. Two earlier attempts ordered by "least recently
// shown" and BOTH failed, because selection advanced the timestamp it ordered by:
// showing an insight changed the next selection\'s input, so the feed churned
// within a bucket and then pinned the same five forever. Rotation is now
// bucket-indexed and reads nothing the write path touches.
//
// The set-vs-order distinction matters here: an earlier positive control used
// `notDeepEqual` on arrays, so it passed when a later bucket served the IDENTICAL
// SET in a different order — which is exactly what was happening.
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

/** An observation saying "seen, unchanged since". */
function seen(i: Insight): [string, InsightObservation] {
  const key = observationKey(i.id);
  return [
    key,
    {
      key,
      signature: insightSignature(i),
      identity: insightIdentity(i),
      statValue: i.statValue,
      firstSeenAt: '2026-08-01T00:00:00.000Z',
      lastChangedAt: '2026-08-01T00:00:00.000Z',
      lastObservedAt: '2026-08-01T00:00:00.000Z',
    },
  ];
}

const NOW = new Date('2026-08-17T12:00:00.000Z'); // a Monday

/** The real change rule, so selection cannot drift from the badge. */
const hasChanged = (i: Insight, prior: InsightObservation) =>
  prior.signature !== insightSignature(i);

function select(
  insights: Insight[],
  observations: Array<[string, InsightObservation]>,
  limit = 5,
  now: Date = NOW
): string[] {
  return selectRotatedInsights({
    insights,
    observations: new Map(observations),
    lifecycleState: 'preseason',
    now,
    limit,
    hasChanged,
  }).selected.map((i) => i.id);
}

const asSet = (ids: string[]) => [...ids].sort();

test('a standing fact already seen still appears — it is not suppressed', () => {
  // THE defect the campaign exists for. Under suppression this returned nothing:
  // the stat had not changed, and in preseason it never will.
  const drought = insight('drought-1', 'drought');
  assert.deepEqual(select([drought], [seen(drought)]), ['drought-1']);
});

test('an EVENT already seen does not come back', () => {
  const bowl = insight('toilet-1', 'toilet_bowl');
  assert.deepEqual(select([bowl], [seen(bowl)]), []);
});

test('an unseen event DOES appear — it is spent by being seen, not by being an event', () => {
  assert.deepEqual(select([insight('toilet-1', 'toilet_bowl')], []), ['toilet-1']);
});

test('changed insights come before rotated ones, regardless of priority', () => {
  const changed = insight('changed', 'drought', 10);
  const seenHigh = insight('seen-high', 'dynasty', 99);
  assert.deepEqual(select([seenHigh, changed], [seen(seenHigh)]), ['changed', 'seen-high']);
});

test('the served SET is identical for every load within a bucket', () => {
  // Selection is a pure function of (candidates, observations, bucket), so this
  // holds no matter how many times the page is loaded — the property is
  // structural rather than something the write path must preserve. Both earlier
  // attempts failed exactly here.
  const items = Array.from({ length: 14 }, (_, i) => insight(`d-${i}`, 'drought'));
  const observations = items.map(seen);
  const first = select(items, observations);
  for (let i = 1; i < 8; i++) {
    assert.deepEqual(select(items, observations), first, `load ${i + 1} serves the same set`);
  }
});

test('a later bucket serves a DIFFERENT SET, not merely a different order', () => {
  // The positive control, and it compares SETS. The version this replaces used
  // `notDeepEqual` on arrays and passed while the same five were served in a
  // different order every bucket — a control that could not fail in the way that
  // mattered.
  const items = Array.from({ length: 14 }, (_, i) => insight(`d-${i}`, 'drought'));
  const observations = items.map(seen);
  const thisWeek = asSet(select(items, observations, 5, NOW));
  const nextWeek = asSet(
    select(items, observations, 5, new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000))
  );
  assert.notDeepEqual(nextWeek, thisWeek);
  assert.equal(nextWeek.filter((id) => thisWeek.includes(id)).length, 0, 'and they are disjoint');
});

test('every insight gets a turn within one full cycle', () => {
  // 14 candidates, 5 slots -> 3 buckets covers the pool. Without this a rotation
  // could look like it works while permanently starving the tail.
  const items = Array.from({ length: 14 }, (_, i) => insight(`d-${i}`, 'drought'));
  const observations = items.map(seen);
  const seenIds = new Set<string>();
  for (let bucket = 0; bucket < 3; bucket++) {
    const at = new Date(NOW.getTime() + bucket * 7 * 24 * 60 * 60 * 1000);
    for (const id of select(items, observations, 5, at)) seenIds.add(id);
  }
  assert.equal(seenIds.size, 14, 'the whole pool appears within ceil(14/5) buckets');
});

test('a pool smaller than the feed shows everything, every bucket', () => {
  // TSC today: four insights, five slots. Rotation is a no-op and must not
  // manufacture churn by dropping one to make room for nothing.
  const items = Array.from({ length: 4 }, (_, i) => insight(`d-${i}`, 'drought'));
  const observations = items.map(seen);
  const week = 7 * 24 * 60 * 60 * 1000;
  for (let b = 0; b < 4; b++) {
    assert.equal(select(items, observations, 5, new Date(NOW.getTime() + b * week)).length, 4);
  }
});

test('buckets are daily in season and weekly outside it', () => {
  const day2 = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
  assert.notEqual(rotationBucketIndex(NOW, 'mid_season'), rotationBucketIndex(day2, 'mid_season'));
  assert.equal(rotationBucketIndex(NOW, 'preseason'), rotationBucketIndex(day2, 'preseason'));
});

test('the weekly bucket turns over on MONDAY, not on an epoch artifact', () => {
  // Counting weeks from the epoch put the boundary on Thursday, because 1 Jan
  // 1970 was one — ten hours before the Thursday pulse INSIGHTS-026 plans.
  const at = (iso: string) => rotationBucketIndex(new Date(iso), 'preseason');
  assert.equal(at('2026-08-16T23:59:59.000Z'), at('2026-08-13T00:00:00.000Z'), 'Sun sits with Thu');
  assert.notEqual(at('2026-08-17T00:00:00.000Z'), at('2026-08-16T23:59:59.000Z'), 'Mon turns over');
  assert.equal(at('2026-08-17T00:00:00.000Z'), at('2026-08-23T23:59:59.000Z'), 'Mon-Sun is one');
});

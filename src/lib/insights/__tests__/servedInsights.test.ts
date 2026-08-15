import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import type { Insight, InsightType } from '../../selectors/insights.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
} from '../../server/appStateStore.ts';
import { applySuppression, selectServedInsights } from '../engine.ts';

// ---------------------------------------------------------------------------
// INSIGHTS-029 — the feed must survive being looked at.
//
// **These are UNIT tests, and they are NOT the regression guard.** The guard is
// `INSIGHTS-029: the feed survives repeated loads through the real loader` in
// `src/lib/__tests__/loadInsights.test.ts` — it is the only test that runs the
// actual serving seam, and it is mutation-proven to fail when that seam is
// reverted. If that test is ever weakened or moved, the coverage goes with it;
// nothing in THIS file would notice.
//
// What lives here: the purity/ordering/cap properties of `selectServedInsights`
// (which cannot fail for any correct sort-and-slice, and are not meant to), plus
// a control that pins the retired suppression behaviour so the drain stays
// observable.
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

beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

test('the feed is identical on every load', () => {
  const raw = [
    insight('drought-1', 'drought', 90),
    insight('dynasty-1', 'dynasty', 80),
    insight('perfect-1', 'perfect_against', 70),
  ];
  const first = selectServedInsights(raw).map((i) => i.id);
  for (let i = 1; i < 5; i++) {
    assert.deepEqual(
      selectServedInsights(raw).map((x) => x.id),
      first,
      `load ${i + 1} serves the same feed`
    );
  }
  assert.deepEqual(first, ['drought-1', 'dynasty-1', 'perfect-1']);
});

test('SUPPRESSION drained the same feed to its never-suppress types — the defect, pinned', async () => {
  // The positive control, and the reason this change exists. `applySuppression`
  // is still exported and still backs the debug endpoint, so the old behaviour
  // stays observable.
  //
  // `drought` and `dynasty` carry `{ kind: 'unchanged' }` — suppress while the
  // stat value is identical — and out of season no stat value can move, so the
  // gate never releases. `perfect_against` is on `NEVER_SUPPRESS_TYPES` and
  // survives.
  //
  // That list is NOT the whole set of survivors, and this fixture is chosen to
  // isolate the thresholded case. 8 further types appear in neither table and
  // are never suppressed either (`isSuppressed` returns false with no rule) —
  // see `selectServedInsights` in engine.ts for the full accounting.
  const raw = [
    insight('drought-1', 'drought', 90),
    insight('dynasty-1', 'dynasty', 80),
    insight('perfect-1', 'perfect_against', 70),
  ];

  const firstPass = await applySuppression([...raw], 'drain-league', 2026);
  assert.equal(firstPass.length, 3, 'the first load looks fine');

  const secondPass = await applySuppression([...raw], 'drain-league', 2026);
  assert.deepEqual(
    secondPass.map((i) => i.id),
    ['perfect-1'],
    'and the second keeps ONLY the never-suppress type — exactly what a live league saw'
  );
});

test('the served set is ordered by priority and capped', () => {
  const raw = Array.from({ length: 14 }, (_, i) => insight(`d-${i}`, 'drought', i));
  const served = selectServedInsights(raw);
  assert.equal(served.length, 10, 'capped at MAX_INSIGHTS');
  assert.deepEqual(
    served.map((i) => i.priorityScore),
    [...served.map((i) => i.priorityScore)].sort((a, b) => b - a),
    'highest priority first'
  );
  assert.equal(served[0]?.id, 'd-13', 'and the most interesting leads');
});

test('selection does not mutate its input', () => {
  // `sort` is in-place and the raw set is CACHED, so sorting it would reorder the
  // cached array for every later reader of that cache entry.
  const raw = [insight('low', 'drought', 1), insight('high', 'dynasty', 99)];
  selectServedInsights(raw);
  assert.deepEqual(
    raw.map((i) => i.id),
    ['low', 'high'],
    'the caller keeps its own order'
  );
});

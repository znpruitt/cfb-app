import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MULTI_SEASON_INSIGHT_TYPES,
  selectMultiSeasonStorylines,
} from '../history/StorylinesPanel.tsx';
import type { Insight, InsightType } from '../../lib/selectors/insights';

function makeInsight(overrides: Partial<Insight> & Pick<Insight, 'id' | 'type'>): Insight {
  return {
    title: 'Test',
    description: 'Test description',
    priorityScore: 50,
    newsHook: 'snapshot',
    statValue: 0,
    category: 'historical',
    ...overrides,
  } as Insight;
}

test('selectMultiSeasonStorylines: includes dynasty/drought/consistency/volatility/title_chaser/never_last/lopsided_rivalry/dominance_streak/improvement/greatest_season', () => {
  const expected: InsightType[] = [
    'dynasty',
    'drought',
    'consistency',
    'volatility',
    'title_chaser',
    'never_last',
    'lopsided_rivalry',
    'dominance_streak',
    'improvement',
    'greatest_season',
  ];
  for (const type of expected) {
    assert.ok(
      MULTI_SEASON_INSIGHT_TYPES.has(type),
      `${type} should be in MULTI_SEASON_INSIGHT_TYPES`
    );
  }
});

test('selectMultiSeasonStorylines: filters out single-event insight types', () => {
  const insights: Insight[] = [
    makeInsight({ id: '1', type: 'milestone_watch', priorityScore: 99 }),
    makeInsight({ id: '2', type: 'rookie_benchmark', priorityScore: 98 }),
    makeInsight({ id: '3', type: 'trending_up', priorityScore: 97 }),
    makeInsight({ id: '4', type: 'trending_down', priorityScore: 96 }),
    makeInsight({ id: '5', type: 'champion_margin', priorityScore: 95 }),
    makeInsight({ id: '6', type: 'failed_chase', priorityScore: 94 }),
    makeInsight({ id: '7', type: 'dynasty', priorityScore: 50 }),
  ];

  const result = selectMultiSeasonStorylines(insights);

  assert.equal(result.length, 1);
  assert.equal(result[0]!.type, 'dynasty');
});

test('selectMultiSeasonStorylines: sorts by priorityScore descending', () => {
  const insights: Insight[] = [
    makeInsight({ id: '1', type: 'dynasty', priorityScore: 30 }),
    makeInsight({ id: '2', type: 'drought', priorityScore: 80 }),
    makeInsight({ id: '3', type: 'lopsided_rivalry', priorityScore: 60 }),
  ];

  const result = selectMultiSeasonStorylines(insights);

  assert.deepEqual(
    result.map((i) => i.id),
    ['2', '3', '1']
  );
});

test('selectMultiSeasonStorylines: limits to top 5 by default', () => {
  const insights: Insight[] = Array.from({ length: 10 }, (_, idx) =>
    makeInsight({ id: `i-${idx}`, type: 'consistency', priorityScore: 100 - idx })
  );

  const result = selectMultiSeasonStorylines(insights);

  assert.equal(result.length, 5);
  assert.deepEqual(
    result.map((i) => i.id),
    ['i-0', 'i-1', 'i-2', 'i-3', 'i-4']
  );
});

test('selectMultiSeasonStorylines: returns fewer than limit when not enough multi-season insights', () => {
  const insights: Insight[] = [
    makeInsight({ id: '1', type: 'milestone_watch', priorityScore: 99 }),
    makeInsight({ id: '2', type: 'milestone_watch', priorityScore: 98 }),
    makeInsight({ id: '3', type: 'dynasty', priorityScore: 50 }),
    makeInsight({ id: '4', type: 'drought', priorityScore: 40 }),
  ];

  const result = selectMultiSeasonStorylines(insights);

  assert.equal(result.length, 2);
  assert.deepEqual(
    result.map((i) => i.type),
    ['dynasty', 'drought']
  );
});

test('selectMultiSeasonStorylines: returns empty when input is empty', () => {
  assert.deepEqual(selectMultiSeasonStorylines([]), []);
});

test('selectMultiSeasonStorylines: returns empty when no insights match multi-season types', () => {
  const insights: Insight[] = [
    makeInsight({ id: '1', type: 'milestone_watch', priorityScore: 99 }),
    makeInsight({ id: '2', type: 'rookie_benchmark', priorityScore: 98 }),
    makeInsight({ id: '3', type: 'champion_margin', priorityScore: 95 }),
  ];

  assert.deepEqual(selectMultiSeasonStorylines(insights), []);
});

test('selectMultiSeasonStorylines: respects custom limit parameter', () => {
  const insights: Insight[] = Array.from({ length: 10 }, (_, idx) =>
    makeInsight({ id: `i-${idx}`, type: 'volatility', priorityScore: 100 - idx })
  );

  const result = selectMultiSeasonStorylines(insights, 3);

  assert.equal(result.length, 3);
});

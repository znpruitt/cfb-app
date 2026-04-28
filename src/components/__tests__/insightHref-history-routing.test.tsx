import assert from 'node:assert/strict';
import test from 'node:test';

import { insightHref } from '../OverviewPanel.tsx';
import type { Insight } from '../../lib/selectors/insights.ts';

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

test('insightHref routes career_points_leader to owner page #career-points anchor', () => {
  const insight = makeInsight({
    id: 'career-points-leader-pruitt',
    type: 'career_points_leader',
    owner: 'Pruitt',
  });
  const href = insightHref(undefined, 'tsc', insight);
  assert.equal(href, '/league/tsc/history/owner/Pruitt#career-points');
});

test('insightHref routes career_turnover_margin to owner page #turnover-margin anchor', () => {
  const insight = makeInsight({
    id: 'career-turnover-margin-pruitt',
    type: 'career_turnover_margin',
    owner: 'Pruitt',
  });
  const href = insightHref(undefined, 'tsc', insight);
  assert.equal(href, '/league/tsc/history/owner/Pruitt#turnover-margin');
});

test('insightHref routes milestone_watch points subkind to owner page #career-points anchor', () => {
  const insight = makeInsight({
    id: 'milestone-points-5000-pruitt-just_crossed',
    type: 'milestone_watch',
    owner: 'Pruitt',
  });
  const href = insightHref(undefined, 'tsc', insight);
  assert.equal(href, '/league/tsc/history/owner/Pruitt#career-points');
});

test('insightHref still routes milestone_watch wins subkind to plain owner page', () => {
  const insight = makeInsight({
    id: 'milestone-wins-100-pruitt-approaching',
    type: 'milestone_watch',
    owner: 'Pruitt',
  });
  const href = insightHref(undefined, 'tsc', insight);
  assert.equal(href, '/league/tsc/history/owner/Pruitt');
});

test('insightHref returns null when career_points_leader has no owner', () => {
  const insight = makeInsight({
    id: 'career-points-leader-tied',
    type: 'career_points_leader',
  });
  const href = insightHref(undefined, 'tsc', insight);
  assert.equal(href, null);
});

test('insightHref encodes owner names with spaces in tier-2 anchors', () => {
  const insight = makeInsight({
    id: 'career-points-leader-john-smith',
    type: 'career_points_leader',
    owner: 'John Smith',
  });
  const href = insightHref(undefined, 'tsc', insight);
  assert.equal(href, '/league/tsc/history/owner/John%20Smith#career-points');
});

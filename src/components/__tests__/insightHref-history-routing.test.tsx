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

// ---------------------------------------------------------------------------
// Overview-anchor routing for drought/dynasty/rivalry insights
//
// These insights deep-link to Overview anchors rather than the /history/stats
// and /history/rivalries subtabs because those subtabs currently render
// "Coming in Phase 3" placeholders. Update these tests when Phase 3 ships
// real subtab content.
// ---------------------------------------------------------------------------

test('insightHref routes drought insight to /history#dynasty-drought', () => {
  const insight = makeInsight({
    id: 'drought-pruitt',
    type: 'drought',
    owner: 'Pruitt',
  });
  const href = insightHref(undefined, 'tsc', insight);
  assert.equal(href, '/league/tsc/history#dynasty-drought');
});

test('insightHref routes dynasty insight to /history#championships', () => {
  const insight = makeInsight({
    id: 'dynasty-pruitt',
    type: 'dynasty',
    owner: 'Pruitt',
  });
  const href = insightHref(undefined, 'tsc', insight);
  assert.equal(href, '/league/tsc/history#championships');
});

test('insightHref routes rivalry insights to /history#rivalries', () => {
  for (const type of [
    'perfect_against',
    'lopsided_rivalry',
    'even_rivalry',
    'dominance_streak',
  ] as const) {
    const insight = makeInsight({
      id: `${type}-pruitt-whited`,
      type,
      category: 'rivalry',
      owners: ['Pruitt', 'Whited'],
    });
    const href = insightHref(undefined, 'tsc', insight);
    assert.equal(href, '/league/tsc/history#rivalries', `type=${type}`);
  }
});

// ---------------------------------------------------------------------------
// INSIGHTS-032 — an archived recap navigates to the season it DESCRIBES.
//
// The recap survives rollover by reading the prior season's archive, so a card
// titled "How 2025 finished" renders on the 2026 page. Routing that followed the
// PAGE sent the champion card to 2026's history and the chase, collapse and
// throne cards to a 2026 trends view where nobody has played.
// ---------------------------------------------------------------------------

test('INSIGHTS-032: an archived recap routes to its own season, not the page year', () => {
  const insight = makeInsight({
    id: 'champion-margin-zoe-yuri',
    type: 'champion_margin',
    category: 'season_wrap',
    season: 2025,
    navigationTarget: 'standings',
  });
  assert.equal(insightHref('standings', 'tsc', insight, 2026), '/league/tsc/history/2025');
});

test('INSIGHTS-032: every archived recap target follows the card, including trends', () => {
  // `trends` resolves to the CURRENT standings view, so these are the cards that
  // landed readers on a season nobody had played.
  for (const type of ['failed_chase', 'collapse', 'toilet_bowl'] as const) {
    const insight = makeInsight({
      id: `${type}-yuri`,
      type,
      category: 'season_wrap',
      season: 2025,
      navigationTarget: 'trends',
    });
    const href = insightHref('trends', 'tsc', insight, 2026);
    assert.equal(href, '/league/tsc/history/2025', `${type} must follow the card's season`);
    assert.doesNotMatch(String(href), /2026/, `${type} must not route to the viewed season`);
  }
});

test('INSIGHTS-032: a recap describing the CURRENT season keeps existing routing', () => {
  // `season` is set only when the card describes a season other than the one on
  // screen. This control proves the branch is scoped, not a blanket redirect.
  const live = makeInsight({
    id: 'toilet-bowl-xavier',
    type: 'toilet_bowl',
    category: 'season_wrap',
    navigationTarget: 'trends',
  });
  assert.equal(
    insightHref('trends', 'tsc', live, 2026),
    '/league/tsc/standings?view=trends#trends'
  );
});

import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import type { Insight, InsightType } from '../../selectors/insights.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
} from '../../server/appStateStore.ts';
import { applyRotation } from '../engine.ts';

// ---------------------------------------------------------------------------
// INSIGHTS-018 — the serving half, end to end against a real store.
//
// This file exists because NOTHING had ever exercised the serving path twice.
// The behaviour the whole campaign is about — fire once, then fade — had no
// end-to-end test, and both P1s in this work were found by reviewers driving
// exactly this loop.
// ---------------------------------------------------------------------------

function insight(id: string, type: InsightType, over: Partial<Insight> = {}): Insight {
  return {
    id,
    type,
    title: id,
    description: `${id} description`,
    owner: 'Ballard',
    priorityScore: 50,
    newsHook: 'streak_extended',
    statValue: 1,
    ...over,
  };
}

const NOW = new Date('2026-08-17T12:00:00.000Z'); // a Monday
const WEEK = 7 * 24 * 60 * 60 * 1000;

beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

test('a preseason feed SURVIVES repeated loads', async () => {
  // Under suppression the second load returned nothing: stat values were
  // unchanged and in preseason they never move.
  const raw = [
    insight('drought-1', 'drought'),
    insight('dynasty-1', 'dynasty'),
    insight('perfect-1', 'perfect_against'),
  ];
  for (let i = 0; i < 5; i++) {
    const served = await applyRotation(raw, 'rot-league', 2026, 'preseason', NOW);
    assert.equal(served.length, 3, `load ${i + 1} still serves the feed`);
  }
});

test('a COLD store badges nothing', async () => {
  // A league with no observation history cannot know what changed, and a season
  // rollover clears the scope — badging the whole feed there is precisely the
  // "train a reader to distrust the badge" outcome the design argues against.
  const raw = [insight('drought-1', 'drought')];
  const first = await applyRotation(raw, 'cold-league', 2026, 'preseason', NOW);
  assert.equal(first[0]?.isNew, false, 'nothing to compare against, so nothing is claimed');
});

test('a CHANGED insight earns the badge, and it decays', async () => {
  const before = [insight('drought-1', 'drought', { statValue: 6 })];
  await applyRotation(before, 'chg-league', 2026, 'preseason', NOW);

  const after = [insight('drought-1', 'drought', { statValue: 7 })];
  const changed = await applyRotation(after, 'chg-league', 2026, 'preseason', NOW);
  assert.equal(changed[0]?.isNew, true, 'a moved stat is news');

  // Past the 7-day out-of-season window, with nothing further changing.
  const later = new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1000);
  const settled = await applyRotation(after, 'chg-league', 2026, 'preseason', later);
  assert.equal(settled[0]?.isNew, false, 'and the badge decays');
});

test('sub-threshold drift ACCUMULATES toward the threshold', async () => {
  // Review, HIGH: the baseline was rewritten on every observation, so the
  // comparison was "since the last request" rather than "since the league was
  // told". A career-points leader growing 2% a week never crossed its 5%
  // tolerance however far it actually moved.
  const at = (statValue: number) => [
    insight('points-leader', 'career_points_leader', { statValue }),
  ];
  // A WEEK apart, matching the scenario. The steps must be separated in time or
  // the 48-hour in-season badge window from the first observation is still open
  // and the assertion measures the window rather than the threshold.
  const week = (n: number) => new Date(NOW.getTime() + n * WEEK);
  await applyRotation(at(10_000), 'drift-league', 2026, 'mid_season', week(0));

  let served = await applyRotation(at(10_200), 'drift-league', 2026, 'mid_season', week(1));
  assert.equal(served[0]?.isNew, false, '2% is inside the 5% tolerance');

  served = await applyRotation(at(10_400), 'drift-league', 2026, 'mid_season', week(2));
  assert.equal(served[0]?.isNew, false, '4% cumulative, still inside');

  served = await applyRotation(at(10_600), 'drift-league', 2026, 'mid_season', week(3));
  assert.equal(served[0]?.isNew, true, '6% cumulative CROSSES it — the baseline was held');
});

test('a hook transition is news even when the stat barely moves', async () => {
  // Review: `standing-moving` short-circuited to the numeric tolerance and never
  // compared identity, so "Alice crosses 5,000 career points" — the most
  // newsworthy transition these types produce, and by nature a tiny delta — was
  // classified unchanged.
  const before = [insight('points-leader', 'career_points_leader', { statValue: 10_000 })];
  await applyRotation(before, 'hook-league', 2026, 'mid_season', NOW);

  // A WEEK later, past the 48-hour in-season window. Without the gap the badge
  // could come from the first observation's window still being open, and the
  // assertion would pass whether or not the hook was consulted — which is exactly
  // what the mutation run caught.
  const after = [
    insight('points-leader', 'career_points_leader', {
      statValue: 10_050,
      newsHook: 'milestone_crossed',
    }),
  ];
  const served = await applyRotation(
    after,
    'hook-league',
    2026,
    'mid_season',
    new Date(NOW.getTime() + WEEK)
  );
  assert.equal(served[0]?.isNew, true, '0.5% move, but a different hook');
});

test('an APPROACHING milestone rotates; a CROSSED one fires once', async () => {
  // The type carries both, so no per-TYPE classification is right. Making it an
  // event killed the watch; making it standing let a crossing rotate for months.
  const watch = [insight('milestone-points-5000-alice-approaching', 'milestone_watch')];
  const crossed = [insight('milestone-points-5000-alice-just_crossed', 'milestone_watch')];

  await applyRotation(watch, 'ms-league', 2026, 'preseason', NOW);
  assert.equal(
    (await applyRotation(watch, 'ms-league', 2026, 'preseason', new Date(NOW.getTime() + WEEK)))
      .length,
    1,
    'the watch keeps coming back while it is still true'
  );

  await applyRotation(crossed, 'ms2-league', 2026, 'preseason', NOW);
  assert.equal(
    (await applyRotation(crossed, 'ms2-league', 2026, 'preseason', new Date(NOW.getTime() + WEEK)))
      .length,
    0,
    'the crossing is spent'
  );
});

test('the caller decides how many it gets', async () => {
  // Review: the feed default silently truncated the "See all" page to the same
  // five rows the reader had just left on the Overview.
  const raw = Array.from({ length: 9 }, (_, i) => insight(`d-${i}`, 'drought'));
  assert.equal((await applyRotation(raw, 'lim-league', 2026, 'preseason', NOW)).length, 5);
  assert.equal((await applyRotation(raw, 'lim2-league', 2026, 'preseason', NOW, 10)).length, 9);
});

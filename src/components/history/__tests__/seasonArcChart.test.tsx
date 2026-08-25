import assert from 'node:assert/strict';
import test from 'node:test';

import { dom } from '../../../test/domEnvironment.ts';
import React from 'react';
import { cleanup, render } from '@testing-library/react';

import SeasonArcChart from '../SeasonArcChart';
import type { StandingsHistory } from '../../../lib/standingsHistory';
import { TREND_EMPTY_MESSAGE } from '../../../lib/trendEmptyState';

// ---------------------------------------------------------------------------
// POLISH-012 — the guard here must agree with what MiniTrendsGrid will render.
//
// It used to ask `standingsHistory.weeks.length === 0`. Once games-back began
// discarding point-less series, "weeks exist" stopped predicting "there is
// something to draw": an archived season whose cumulative coverage never
// completed has weeks but no RESOLVED weeks, so the grid returned null while
// this section still drew its heading and subtitle over an empty body — and its
// own fallback was skipped. A parent predicting a child's output from a
// different input than the child uses is the defect class, not the symptom.
// ---------------------------------------------------------------------------

const OWNERS = ['Alpha', 'Beta', 'Gamma'];

function archive(resolvedWeeks: number[]): StandingsHistory {
  const weeks = [1, 2, 3];
  const standings = OWNERS.map((owner, index) => ({
    owner,
    wins: index,
    losses: 0,
    ties: 0,
    winPct: index === 0 ? 0 : 1,
    pointsFor: 0,
    pointsAgainst: 0,
    pointDifferential: 0,
    gamesBack: index,
    finalGames: index,
  }));
  const byWeek: StandingsHistory['byWeek'] = {};
  for (const week of weeks) {
    byWeek[week] = {
      week,
      standings,
      // Resolution requires BOTH played and complete coverage.
      coverage: resolvedWeeks.includes(week)
        ? { state: 'complete', message: null }
        : { state: 'partial', message: 'Waiting on complete results' },
      played: resolvedWeeks.includes(week),
      pending: [],
    };
  }
  const byOwner: StandingsHistory['byOwner'] = {};
  for (const [index, owner] of OWNERS.entries()) {
    byOwner[owner] = weeks.map((week) => ({
      week,
      wins: index,
      losses: 0,
      ties: 0,
      winPct: index === 0 ? 0 : 1,
      pointsFor: 0,
      pointsAgainst: 0,
      pointDifferential: 0,
      gamesBack: index,
    }));
  }
  return { weeks, byWeek, byOwner };
}

test('season arc shows its fallback when weeks exist but none resolved', () => {
  assert.ok(dom);
  const { container } = render(<SeasonArcChart standingsHistory={archive([])} year={2024} />);

  // The regression: weeks.length !== 0, so the old guard rendered the grid,
  // which returned null — heading and subtitle over nothing.
  assert.ok((container.textContent ?? '').includes(TREND_EMPTY_MESSAGE));
  assert.equal(container.querySelector('svg'), null, 'nothing should be drawn');
  cleanup();
});

test('season arc draws the chart once a week resolves', () => {
  assert.ok(dom);
  const { container } = render(<SeasonArcChart standingsHistory={archive([1, 2])} year={2024} />);

  // Positive control: the same fixture shape MUST be able to draw, or the test
  // above would pass against a component that can only ever show the fallback.
  assert.ok(!(container.textContent ?? '').includes(TREND_EMPTY_MESSAGE));
  assert.ok(container.querySelector('svg'), 'the resolved case must draw');
  cleanup();
});

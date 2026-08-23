import assert from 'node:assert/strict';
import test from 'node:test';

import { dom } from '../../test/domEnvironment.ts';
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';

import TrendsDetailSurface, { SharedTrendChart } from '../TrendsDetailSurface';
import { selectGamesBackTrend, selectWinPctTrend } from '../../lib/selectors/trends';
import type { StandingsHistory } from '../../lib/standingsHistory';

// ---------------------------------------------------------------------------
// POLISH-012 — the live crash a member hit on 2026-08-23.
//
// Clicking "Win %" on the standings page threw "Rendered fewer hooks than
// expected" and dropped the whole page to the error boundary. `SharedTrendChart`
// ran five hooks, took an early return for `rows.length === 0`, then ran three
// more; both metric charts share one fiber via a ternary, and the two selectors
// disagreed about the empty case, so switching tabs changed the hook count.
//
// Reachable only after PLATFORM-105 made preseason correctly have zero resolved
// weeks. Before that every week counted as resolved and both metrics always had
// points, so the counts happened to match.
// ---------------------------------------------------------------------------

const OWNERS = ['Ballard', 'BHooper', 'Chamness', 'Ciprys', 'Gladney'];

/** Owners and weeks exist; nothing has been played, so nothing is resolved. */
function preseasonHistory(): StandingsHistory {
  const standings = OWNERS.map((owner) => ({
    owner,
    wins: 0,
    losses: 0,
    ties: 0,
    winPct: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    pointDifferential: 0,
    gamesBack: 0,
    finalGames: 0,
  }));
  const weeks = [1, 2, 3];
  const byWeek: StandingsHistory['byWeek'] = {};
  for (const week of weeks) {
    byWeek[week] = {
      week,
      standings,
      coverage: { state: 'complete', message: null },
      played: false,
      pending: [],
    };
  }
  const byOwner: StandingsHistory['byOwner'] = {};
  for (const owner of OWNERS) {
    byOwner[owner] = weeks.map((week) => ({
      week,
      wins: 0,
      losses: 0,
      ties: 0,
      winPct: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      pointDifferential: 0,
      gamesBack: 0,
    }));
  }
  return { weeks, byWeek, byOwner };
}

test('both trend selectors agree there is nothing to chart before any week resolves', () => {
  const standingsHistory = preseasonHistory();

  // The divergence that made the crash reachable: games-back used to return one
  // point-less series PER OWNER while win% returned none.
  assert.deepEqual(selectGamesBackTrend({ standingsHistory }), []);
  assert.deepEqual(selectWinPctTrend({ standingsHistory }), []);

  // Positive control: once a week resolves, BOTH produce series — so a selector
  // that could only ever return [] would fail here.
  const resolved = preseasonHistory();
  resolved.byWeek[1] = {
    ...resolved.byWeek[1]!,
    played: true,
    standings: resolved.byWeek[1]!.standings.map((row, index) => ({
      ...row,
      wins: index === 0 ? 1 : 0,
      winPct: index === 0 ? 1 : 0,
    })),
  };
  assert.ok(selectGamesBackTrend({ standingsHistory: resolved }).length > 0);
  assert.ok(selectWinPctTrend({ standingsHistory: resolved }).length > 0);
});

test('switching to the Win % tab in preseason does not crash', () => {
  assert.ok(dom, 'JSDOM must be installed before react-dom is evaluated');

  const { getByText } = render(
    <TrendsDetailSurface
      standingsHistory={preseasonHistory()}
      season={2026}
      ownerColorMap={{}}
      seasonContext={null}
    />
  );

  // The click itself threw before POLISH-012 — React unwound the tree and the
  // page fell to the error boundary.
  fireEvent.click(getByText('Win %'));

  cleanup();
});

// ---------------------------------------------------------------------------
// Both reviewers found the tests above cover the SELECTOR alignment and give the
// hook extraction nothing. Proven in a worktree: revert `TrendsDetailSurface`
// to the old hooks-then-early-return shape, keep the `trends.ts` filter, and
// both stay green — because the filter makes the two row sets always agree, so
// the surface never crosses the empty boundary and `TrendChartBody` never mounts.
//
// The extraction is what survives a FUTURE divergence, so it needs its own
// guard. Driving the wrapper directly across empty → non-empty at the same
// position is the shape that would have crashed before the split, and it also
// exercises the non-empty render, which nothing else here does.
// ---------------------------------------------------------------------------

const NON_EMPTY_ROWS = [
  {
    ownerId: 'Ballard',
    ownerName: 'Ballard',
    points: [
      { week: 1, value: 0 },
      { week: 2, value: 1 },
    ],
    latest: 1,
  },
  {
    ownerId: 'BHooper',
    ownerName: 'BHooper',
    points: [
      { week: 1, value: 1 },
      { week: 2, value: 0 },
    ],
    latest: 0,
  },
];

test('the trend chart survives crossing the empty boundary at one position', () => {
  assert.ok(dom);

  const chart = (rows: typeof NON_EMPTY_ROWS) => (
    <SharedTrendChart
      title="Games Back"
      metric="games-back"
      seasonIsFinal={false}
      rows={rows}
      focusedOwnerIds={new Set<string>()}
      selectedOwnerId={null}
      viewportWidth={1024}
      onSelectOwner={() => {}}
      getOwnerTrendColor={() => '#888'}
    />
  );

  // Empty first: the wrapper's own branch, no hooks.
  const { rerender, container } = render(chart([]));
  assert.match(container.textContent ?? '', /No trend data available yet\./);

  // Then non-empty AT THE SAME POSITION. Before the split this transition ran a
  // different number of hooks on one fiber and threw.
  rerender(chart(NON_EMPTY_ROWS));
  assert.doesNotMatch(container.textContent ?? '', /No trend data available yet\./);
  assert.ok(container.querySelector('svg'), 'the non-empty case must actually draw');

  // And back, which is the direction the production crash took.
  rerender(chart([]));
  assert.match(container.textContent ?? '', /No trend data available yet\./);

  cleanup();
});

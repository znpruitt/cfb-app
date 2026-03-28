import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import StandingsPanel from '../StandingsPanel';
import type { StandingsHistory } from '../../lib/standingsHistory';

const history: StandingsHistory = {
  weeks: [1, 2],
  byWeek: {
    1: {
      week: 1,
      standings: [
        {
          owner: 'Alex',
          wins: 2,
          losses: 1,
          ties: 0,
          winPct: 0.667,
          pointsFor: 120,
          pointsAgainst: 99,
          pointDifferential: 21,
          gamesBack: 0,
          finalGames: 3,
        },
      ],
      coverage: { state: 'complete', message: null },
    },
    2: {
      week: 2,
      standings: [
        {
          owner: 'Alex',
          wins: 3,
          losses: 1,
          ties: 0,
          winPct: 0.75,
          pointsFor: 130,
          pointsAgainst: 100,
          pointDifferential: 30,
          gamesBack: 0,
          finalGames: 4,
        },
      ],
      coverage: { state: 'complete', message: null },
    },
  },
  byOwner: {
    Alex: [
      {
        week: 1,
        wins: 2,
        losses: 1,
        ties: 0,
        winPct: 0.667,
        pointsFor: 120,
        pointsAgainst: 99,
        pointDifferential: 21,
        gamesBack: 0,
      },
      {
        week: 2,
        wins: 3,
        losses: 1,
        ties: 0,
        winPct: 0.75,
        pointsFor: 130,
        pointsAgainst: 100,
        pointDifferential: 30,
        gamesBack: 0,
      },
    ],
  },
};

test('standings panel renders expected columns and metrics', () => {
  const html = renderToStaticMarkup(
    <StandingsPanel
      season={2025}
      coverage={{ state: 'complete', message: null }}
      rows={[
        {
          owner: 'Alex',
          wins: 3,
          losses: 1,
          winPct: 0.75,
          pointsFor: 120,
          pointsAgainst: 99,
          pointDifferential: 21,
          gamesBack: 0,
          finalGames: 4,
        },
      ]}
    />
  );

  for (const label of ['Rank', 'Team', 'Record', 'Win %', 'PF', 'PA', 'Diff', 'GB']) {
    assert.match(html, new RegExp(label.replace('%', '%')));
  }
  assert.match(html, /Alex/);
  assert.match(html, /3–1/);
  assert.match(html, /0.750/);
  assert.match(html, /\+21/);
  assert.match(html, /2025 Standings/);
  assert.match(html, /Standings views/);
  assert.match(html, /Table/);
  assert.match(html, /Trends/);
});

test('standings panel renders secondary coverage warning when standings are partial', () => {
  const html = renderToStaticMarkup(
    <StandingsPanel
      season={2025}
      coverage={{
        state: 'partial',
        message: 'Standings may be incomplete — some completed game scores are still loading.',
      }}
      rows={[
        {
          owner: 'Alex',
          wins: 3,
          losses: 1,
          winPct: 0.75,
          pointsFor: 120,
          pointsAgainst: 99,
          pointDifferential: 21,
          gamesBack: 0,
          finalGames: 4,
        },
      ]}
    />
  );

  assert.match(
    html,
    /Standings may be incomplete — some completed game scores are still loading\./
  );
});

test('standings trends subview can render shared trend charts and win bars', () => {
  const html = renderToStaticMarkup(
    <StandingsPanel
      season={2025}
      coverage={{ state: 'complete', message: null }}
      rows={[]}
      standingsHistory={history}
      seasonContext="in-season"
      trendIssues={[]}
      initialSubview="trends"
    />
  );

  assert.match(html, /data-standings-subview="trends"/);
  assert.match(html, /Games Back shared trend chart/);
  assert.match(html, /Win % shared trend chart/);
  assert.match(html, /Win Bars/);
});

import assert from 'node:assert/strict';
import React from 'react';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { TrendsDetailSurface, formatHoverSummary, toggleSelectedOwner } from './page';
import type { StandingsHistory } from '../../lib/standingsHistory';

const history: StandingsHistory = {
  weeks: [1, 2],
  byWeek: {
    1: {
      week: 1,
      standings: [
        {
          owner: 'Alice',
          wins: 2,
          losses: 1,
          ties: 0,
          winPct: 0.667,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 0,
          gamesBack: 0,
          finalGames: 3,
        },
        {
          owner: 'Bob',
          wins: 1,
          losses: 2,
          ties: 0,
          winPct: 0.333,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 0,
          gamesBack: 1,
          finalGames: 3,
        },
      ],
      coverage: { state: 'complete', message: null },
    },
    2: {
      week: 2,
      standings: [
        {
          owner: 'Alice',
          wins: 3,
          losses: 1,
          ties: 0,
          winPct: 0.75,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 0,
          gamesBack: 0,
          finalGames: 4,
        },
        {
          owner: 'Bob',
          wins: 2,
          losses: 2,
          ties: 0,
          winPct: 0.5,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 0,
          gamesBack: 1,
          finalGames: 4,
        },
      ],
      coverage: { state: 'complete', message: null },
    },
  },
  byOwner: {
    Alice: [
      {
        week: 1,
        wins: 2,
        losses: 1,
        ties: 0,
        winPct: 0.667,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 0,
        gamesBack: 0,
      },
      {
        week: 2,
        wins: 3,
        losses: 1,
        ties: 0,
        winPct: 0.75,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 0,
        gamesBack: 0,
      },
    ],
    Bob: [
      {
        week: 1,
        wins: 1,
        losses: 2,
        ties: 0,
        winPct: 0.333,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 0,
        gamesBack: 1,
      },
      {
        week: 2,
        wins: 2,
        losses: 2,
        ties: 0,
        winPct: 0.5,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 0,
        gamesBack: 1,
      },
    ],
  },
};

test('trends detail surface renders key sections without crashing', () => {
  const html = renderToStaticMarkup(
    <TrendsDetailSurface
      standingsHistory={null}
      season={2026}
      seasonContext="in-season"
      issues={[]}
    />
  );

  assert.match(html, /Games Back/);
  assert.match(html, /Win %/);
  assert.match(html, /Win Bars/);
});

test('trends detail surface shows owner data and context hints when standings history exists', () => {
  const html = renderToStaticMarkup(
    <TrendsDetailSurface
      standingsHistory={history}
      season={2026}
      seasonContext="final"
      issues={[]}
    />
  );

  assert.match(html, /Alice/);
  assert.match(html, /Bob/);
  assert.match(html, /Latest snapshot/);
  assert.match(html, /W1 → W2/);
  assert.match(html, /data-selected="false"/);
});

test('selection helper toggles selected owner deterministically', () => {
  assert.equal(toggleSelectedOwner(null, 'Alice'), 'Alice');
  assert.equal(toggleSelectedOwner('Alice', 'Alice'), null);
  assert.equal(toggleSelectedOwner('Alice', 'Bob'), 'Bob');
});

test('hover summary helper returns expected value payload text', () => {
  assert.equal(
    formatHoverSummary({ ownerName: 'Alice', metric: 'games-back', week: 2, value: 1 }),
    'Alice · Week 2 · 1.0'
  );
  assert.equal(
    formatHoverSummary({ ownerName: 'Bob', metric: 'win-pct', week: 4, value: 0.625 }),
    'Bob · Week 4 · 62.5%'
  );
  assert.equal(formatHoverSummary(null), null);
});

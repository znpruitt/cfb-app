import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import StandingsPanel from '../StandingsPanel';

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
  assert.doesNotMatch(html, /Season-to-date standings/);
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

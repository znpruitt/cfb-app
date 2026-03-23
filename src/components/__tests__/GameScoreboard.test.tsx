import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import GameScoreboard from '../GameScoreboard.tsx';

const awayTeam = {
  displayName: 'Texas Tech',
  shortDisplayName: 'Texas Tech',
  scoreboardName: 'Texas Tech',
};

const homeTeam = {
  displayName: 'Baylor',
  shortDisplayName: 'Baylor',
  scoreboardName: 'Baylor',
};

function renderScoreboard(
  overrides: Partial<React.ComponentProps<typeof GameScoreboard>> = {}
): string {
  return renderToStaticMarkup(
    <GameScoreboard
      awayTeam={awayTeam}
      homeTeam={homeTeam}
      score={{
        status: 'scheduled',
        time: null,
        home: { team: 'Baylor', score: 21 },
        away: { team: 'Texas Tech', score: 17 },
      }}
      {...overrides}
    />
  );
}

test('scoreboard body does not render a duplicate matchup heading', () => {
  const html = renderScoreboard();

  assert.doesNotMatch(html, /Texas Tech @ Baylor/);
  assert.match(html, /Texas Tech/);
  assert.match(html, /Baylor/);
});

test('winner row receives accent styling and loser stays neutral', () => {
  const html = renderScoreboard({
    score: {
      status: 'Final',
      time: null,
      away: { team: 'Texas Tech', score: 34 },
      home: { team: 'Baylor', score: 17 },
    },
  });

  assert.match(
    html,
    /border-l-2[^"]*border-l-emerald-600[^>]*data-scoreboard-row="away" data-scoreboard-winner="true"/
  );
  assert.match(html, /data-scoreboard-score="away">34<\/span>/);
  assert.match(html, /font-extrabold text-emerald-700/);
  assert.match(
    html,
    /border-l-2[^"]*border-l-transparent[^>]*data-scoreboard-row="home" data-scoreboard-winner="false"/
  );
});

test('conference and owner render under the correct team rows', () => {
  const html = renderScoreboard({
    awayConference: 'Big 12',
    awayOwner: 'Pruitt',
    homeConference: 'SEC',
    homeOwner: 'Morgan',
  });

  assert.ok(
    html.indexOf('data-scoreboard-row="away"') <
      html.indexOf('data-scoreboard-team-context="away">Big 12 · Pruitt</div>')
  );
  assert.ok(
    html.indexOf('data-scoreboard-row="home"') <
      html.indexOf('data-scoreboard-team-context="home">SEC · Morgan</div>')
  );
});

test('status stays subtle inside the expanded scoreboard', () => {
  const html = renderScoreboard({
    score: {
      status: 'Q3 8:14',
      time: null,
      away: { team: 'Texas Tech', score: 24 },
      home: { team: 'Baylor', score: 21 },
    },
  });

  assert.match(html, /data-scoreboard-status[^>]*>Q3 8:14<\/div>/);
});

test('team rows handle missing owner and conference without extra placeholders', () => {
  const html = renderScoreboard({
    awayConference: null,
    awayOwner: undefined,
    homeConference: 'SEC',
  });

  assert.doesNotMatch(html, /data-scoreboard-team-context="away"/);
  assert.match(html, /data-scoreboard-team-context="home">SEC<\//);
});

test('odds row stays hidden only when no displayable odds markets exist', () => {
  const html = renderScoreboard({
    odds: {
      favorite: null,
      spread: null,
      homeSpread: null,
      awaySpread: null,
      spreadPriceHome: null,
      spreadPriceAway: null,
      total: null,
      mlHome: null,
      mlAway: null,
      overPrice: null,
      underPrice: null,
      source: null,
      bookmakerKey: null,
      capturedAt: null,
      lineSourceStatus: 'latest',
    },
  });

  assert.doesNotMatch(html, /ML:/);
  assert.doesNotMatch(html, /Spread:/);
  assert.doesNotMatch(html, /O\/U:/);
  assert.doesNotMatch(html, /No odds/i);
  assert.doesNotMatch(html, /border-t border-gray-200\/60/);
});

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

const awayColorTreatment = {
  source: 'primary' as const,
  baseColor: '#A32638',
  subtleAccent: 'rgba(163, 38, 56, 0.52)',
  strongAccent: 'rgba(163, 38, 56, 0.92)',
  borderAccent: 'rgba(163, 38, 56, 0.28)',
  rowAccentColor: 'rgba(163, 38, 56, 0.45)',
  winnerAccentColor: 'rgba(163, 38, 56, 0.92)',
  winnerScoreColor: '#A32638',
};

const homeColorTreatment = {
  source: 'alt' as const,
  baseColor: '#1B6F3A',
  subtleAccent: 'rgba(27, 111, 58, 0.52)',
  strongAccent: 'rgba(27, 111, 58, 0.92)',
  borderAccent: 'rgba(27, 111, 58, 0.28)',
  rowAccentColor: 'rgba(27, 111, 58, 0.45)',
  winnerAccentColor: 'rgba(27, 111, 58, 0.92)',
  winnerScoreColor: '#1B6F3A',
};

function renderScoreboard(
  overrides: Partial<React.ComponentProps<typeof GameScoreboard>> = {}
): string {
  return renderToStaticMarkup(
    <GameScoreboard
      awayTeam={awayTeam}
      homeTeam={homeTeam}
      awayColorTreatment={awayColorTreatment}
      homeColorTreatment={homeColorTreatment}
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

test('both team rows receive team-color identity accents and winner treatment stays stronger', () => {
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
    /style="border-left-color:rgba\(163, 38, 56, 0.92\)" data-scoreboard-row="away" data-scoreboard-winner="true" data-scoreboard-accent-source="primary"/
  );
  assert.match(
    html,
    /style="border-left-color:rgba\(27, 111, 58, 0.45\)" data-scoreboard-row="home" data-scoreboard-winner="false" data-scoreboard-accent-source="alt"/
  );
  assert.match(html, /font-extrabold" style="color:#A32638" data-scoreboard-score="away"/);
  assert.match(
    html,
    /font-semibold text-gray-800 dark:text-zinc-200" data-scoreboard-score="home">17<\/span>/
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

test('expanded scoreboard status uses chip-only state color treatment', () => {
  const html = renderScoreboard({
    score: {
      status: 'Final',
      time: null,
      away: { team: 'Texas Tech', score: 34 },
      home: { team: 'Baylor', score: 17 },
    },
  });

  assert.match(html, /border-emerald-200[^>]*data-scoreboard-status=\"true\">FINAL<\/div>/);
  assert.doesNotMatch(html, /bg-emerald-50[^>]*aria-label="Game scoreboard"/);
});

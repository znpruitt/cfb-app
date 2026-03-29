import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { cleanup, render } from '@testing-library/react';

import StandingsPanel from '../StandingsPanel';
import type { StandingsHistory } from '../../lib/standingsHistory';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'https://example.test/',
});
(globalThis as { window: Window }).window = dom.window as unknown as Window;
(globalThis as { document: Document }).document = dom.window.document;
(globalThis as { self: Window }).self = dom.window as unknown as Window;
Object.defineProperty(globalThis, 'navigator', {
  value: dom.window.navigator,
  writable: true,
  configurable: true,
});

afterEach(() => cleanup());

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

  for (const label of ['Rank', 'Move', 'Team', 'Record', 'Win %', 'PF', 'PA', 'Diff', 'GB']) {
    assert.match(html, new RegExp(label.replace('%', '%')));
  }
  assert.match(html, /Alex/);
  assert.match(html, /3–1/);
  assert.match(html, /0.750/);
  assert.match(html, /\+21/);
  assert.match(html, /2025 Standings/);
  assert.match(html, /Trends/);
  assert.match(html, /data-standings-subview="trends"/);
  assert.match(html, /data-layout="standings-trends-split"/);
  assert.match(html, /lg:grid-cols-\[minmax\(0,1.3fr\)_minmax\(0,1.7fr\)\]/);
  assert.match(html, /data-standings-layout="tight"/);
  assert.match(html, /data-standings-column="rank"/);
  assert.match(html, /data-standings-column="move"/);
  assert.match(html, /data-standings-column="pf"/);
  assert.match(html, /text-right tabular-nums/);
  assert.match(html, /data-winbar-background="75.0%"/);
  assert.doesNotMatch(html, /Swipe\/scroll for full standings detail on small screens\./);
  assert.doesNotMatch(
    html,
    /PF, PA, Diff, and GB stay available without changing standings logic\./
  );
});

test('standings panel renders compact rank movement indicators from standings history', () => {
  const movementHistory: StandingsHistory = {
    weeks: [1, 2],
    byWeek: {
      1: {
        week: 1,
        standings: [
          {
            owner: 'Alex',
            wins: 3,
            losses: 1,
            ties: 0,
            winPct: 0.75,
            pointsFor: 120,
            pointsAgainst: 100,
            pointDifferential: 20,
            gamesBack: 0,
            finalGames: 4,
          },
          {
            owner: 'Blake',
            wins: 3,
            losses: 1,
            ties: 0,
            winPct: 0.75,
            pointsFor: 115,
            pointsAgainst: 101,
            pointDifferential: 14,
            gamesBack: 0,
            finalGames: 4,
          },
          {
            owner: 'Casey',
            wins: 2,
            losses: 2,
            ties: 0,
            winPct: 0.5,
            pointsFor: 100,
            pointsAgainst: 102,
            pointDifferential: -2,
            gamesBack: 1,
            finalGames: 4,
          },
        ],
        coverage: { state: 'complete', message: null },
      },
      2: {
        week: 2,
        standings: [
          {
            owner: 'Blake',
            wins: 4,
            losses: 1,
            ties: 0,
            winPct: 0.8,
            pointsFor: 145,
            pointsAgainst: 118,
            pointDifferential: 27,
            gamesBack: 0,
            finalGames: 5,
          },
          {
            owner: 'Alex',
            wins: 4,
            losses: 1,
            ties: 0,
            winPct: 0.8,
            pointsFor: 142,
            pointsAgainst: 120,
            pointDifferential: 22,
            gamesBack: 0,
            finalGames: 5,
          },
          {
            owner: 'Casey',
            wins: 2,
            losses: 3,
            ties: 0,
            winPct: 0.4,
            pointsFor: 109,
            pointsAgainst: 122,
            pointDifferential: -13,
            gamesBack: 2,
            finalGames: 5,
          },
          {
            owner: 'Drew',
            wins: 1,
            losses: 4,
            ties: 0,
            winPct: 0.2,
            pointsFor: 90,
            pointsAgainst: 130,
            pointDifferential: -40,
            gamesBack: 3,
            finalGames: 5,
          },
        ],
        coverage: { state: 'complete', message: null },
      },
    },
    byOwner: {},
  };

  const html = renderToStaticMarkup(
    <StandingsPanel
      season={2025}
      coverage={{ state: 'complete', message: null }}
      standingsHistory={movementHistory}
      rows={[
        {
          owner: 'Blake',
          wins: 4,
          losses: 1,
          winPct: 0.8,
          pointsFor: 145,
          pointsAgainst: 118,
          pointDifferential: 27,
          gamesBack: 0,
          finalGames: 5,
        },
        {
          owner: 'Alex',
          wins: 4,
          losses: 1,
          winPct: 0.8,
          pointsFor: 142,
          pointsAgainst: 120,
          pointDifferential: 22,
          gamesBack: 0,
          finalGames: 5,
        },
        {
          owner: 'Casey',
          wins: 2,
          losses: 3,
          winPct: 0.4,
          pointsFor: 109,
          pointsAgainst: 122,
          pointDifferential: -13,
          gamesBack: 2,
          finalGames: 5,
        },
        {
          owner: 'Drew',
          wins: 1,
          losses: 4,
          winPct: 0.2,
          pointsFor: 90,
          pointsAgainst: 130,
          pointDifferential: -40,
          gamesBack: 3,
          finalGames: 5,
        },
      ]}
    />
  );

  assert.match(html, /data-standings-move="↑1"/);
  assert.match(html, /Moved up 1 spot from last week/);
  assert.match(html, /data-standings-move="↓1"/);
  assert.match(html, /Moved down 1 spot from last week/);
  assert.match(html, /data-standings-move="→0"/);
  assert.match(html, /No change from last week/);
  assert.match(html, /No prior week comparison available/);
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

test('standings panel embeds shared trend charts alongside table', () => {
  const html = renderToStaticMarkup(
    <StandingsPanel
      season={2025}
      coverage={{ state: 'complete', message: null }}
      rows={[]}
      standingsHistory={history}
      seasonContext="in-season"
      trendIssues={[]}
      initialSubview="table"
    />
  );

  assert.match(html, /data-standings-subview="trends"/);
  assert.match(html, /Games Back shared trend chart/);
  assert.match(html, /Win % shared trend chart/);
  assert.doesNotMatch(html, /Win Bars/);
  assert.match(html, /data-standings-section="contextual-insights"/);
  assert.doesNotMatch(html, /data-standings-subview="trends"[\s\S]*Recent Momentum/);
});

test('standings panel renders contextual insights below table in left column', () => {
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
      standingsHistory={history}
      seasonContext="in-season"
      trendIssues={[]}
    />
  );

  const tableIndex = html.indexOf('</table>');
  const insightsIndex = html.indexOf('data-standings-section="contextual-insights"');
  const trendsIndex = html.indexOf('data-standings-subview="trends"');
  assert.ok(tableIndex >= 0);
  assert.ok(insightsIndex > tableIndex);
  assert.ok(trendsIndex > insightsIndex);
});

test('standings panel renders at most two standings-relevant shared insights and excludes movement insights', () => {
  const richHistory: StandingsHistory = {
    weeks: [1, 2, 3],
    byWeek: {
      1: {
        week: 1,
        standings: [
          {
            owner: 'Alex',
            wins: 1,
            losses: 0,
            ties: 0,
            winPct: 1,
            pointsFor: 100,
            pointsAgainst: 80,
            pointDifferential: 20,
            gamesBack: 0,
            finalGames: 1,
          },
          {
            owner: 'Blake',
            wins: 0,
            losses: 1,
            ties: 0,
            winPct: 0,
            pointsFor: 82,
            pointsAgainst: 99,
            pointDifferential: -17,
            gamesBack: 1,
            finalGames: 1,
          },
          {
            owner: 'Casey',
            wins: 0,
            losses: 1,
            ties: 0,
            winPct: 0,
            pointsFor: 75,
            pointsAgainst: 96,
            pointDifferential: -21,
            gamesBack: 1,
            finalGames: 1,
          },
        ],
        coverage: { state: 'complete', message: null },
      },
      2: {
        week: 2,
        standings: [
          {
            owner: 'Blake',
            wins: 2,
            losses: 0,
            ties: 0,
            winPct: 1,
            pointsFor: 190,
            pointsAgainst: 160,
            pointDifferential: 30,
            gamesBack: 0,
            finalGames: 2,
          },
          {
            owner: 'Alex',
            wins: 1,
            losses: 1,
            ties: 0,
            winPct: 0.5,
            pointsFor: 170,
            pointsAgainst: 169,
            pointDifferential: 1,
            gamesBack: 1,
            finalGames: 2,
          },
          {
            owner: 'Casey',
            wins: 0,
            losses: 2,
            ties: 0,
            winPct: 0,
            pointsFor: 154,
            pointsAgainst: 197,
            pointDifferential: -43,
            gamesBack: 2,
            finalGames: 2,
          },
        ],
        coverage: { state: 'complete', message: null },
      },
      3: {
        week: 3,
        standings: [
          {
            owner: 'Blake',
            wins: 3,
            losses: 0,
            ties: 0,
            winPct: 1,
            pointsFor: 290,
            pointsAgainst: 220,
            pointDifferential: 70,
            gamesBack: 0,
            finalGames: 3,
          },
          {
            owner: 'Alex',
            wins: 1,
            losses: 2,
            ties: 0,
            winPct: 0.333,
            pointsFor: 241,
            pointsAgainst: 267,
            pointDifferential: -26,
            gamesBack: 2,
            finalGames: 3,
          },
          {
            owner: 'Casey',
            wins: 0,
            losses: 3,
            ties: 0,
            winPct: 0,
            pointsFor: 209,
            pointsAgainst: 298,
            pointDifferential: -89,
            gamesBack: 3,
            finalGames: 3,
          },
        ],
        coverage: { state: 'complete', message: null },
      },
    },
    byOwner: {
      Alex: [
        {
          week: 1,
          wins: 1,
          losses: 0,
          ties: 0,
          winPct: 1,
          pointsFor: 100,
          pointsAgainst: 80,
          pointDifferential: 20,
          gamesBack: 0,
        },
        {
          week: 2,
          wins: 1,
          losses: 1,
          ties: 0,
          winPct: 0.5,
          pointsFor: 170,
          pointsAgainst: 169,
          pointDifferential: 1,
          gamesBack: 1,
        },
        {
          week: 3,
          wins: 1,
          losses: 2,
          ties: 0,
          winPct: 0.333,
          pointsFor: 241,
          pointsAgainst: 267,
          pointDifferential: -26,
          gamesBack: 2,
        },
      ],
      Blake: [
        {
          week: 1,
          wins: 0,
          losses: 1,
          ties: 0,
          winPct: 0,
          pointsFor: 82,
          pointsAgainst: 99,
          pointDifferential: -17,
          gamesBack: 1,
        },
        {
          week: 2,
          wins: 2,
          losses: 0,
          ties: 0,
          winPct: 1,
          pointsFor: 190,
          pointsAgainst: 160,
          pointDifferential: 30,
          gamesBack: 0,
        },
        {
          week: 3,
          wins: 3,
          losses: 0,
          ties: 0,
          winPct: 1,
          pointsFor: 290,
          pointsAgainst: 220,
          pointDifferential: 70,
          gamesBack: 0,
        },
      ],
      Casey: [
        {
          week: 1,
          wins: 0,
          losses: 1,
          ties: 0,
          winPct: 0,
          pointsFor: 75,
          pointsAgainst: 96,
          pointDifferential: -21,
          gamesBack: 1,
        },
        {
          week: 2,
          wins: 0,
          losses: 2,
          ties: 0,
          winPct: 0,
          pointsFor: 154,
          pointsAgainst: 197,
          pointDifferential: -43,
          gamesBack: 2,
        },
        {
          week: 3,
          wins: 0,
          losses: 3,
          ties: 0,
          winPct: 0,
          pointsFor: 209,
          pointsAgainst: 298,
          pointDifferential: -89,
          gamesBack: 3,
        },
      ],
    },
  };

  const html = renderToStaticMarkup(
    <StandingsPanel
      season={2025}
      coverage={{ state: 'complete', message: null }}
      rows={richHistory.byWeek[3]!.standings}
      standingsHistory={richHistory}
      seasonContext="in-season"
      trendIssues={[]}
    />
  );

  const renderedInsightCount = (html.match(/data-standings-insight-type="/g) ?? []).length;
  assert.ok(renderedInsightCount <= 2);
  assert.match(
    html,
    /data-standings-insight-type="collapse"|data-standings-insight-type="toilet_bowl"|data-standings-insight-type="surge"|data-standings-insight-type="race"/
  );
  assert.doesNotMatch(html, /data-standings-insight-type="movement"/);
  assert.doesNotMatch(html, /Recent Momentum/);
  assert.doesNotMatch(html, /data-standings-section="recent-momentum"/);
});

test('standings panel renders trends section regardless of deep-link initial subview', () => {
  const tableHtml = renderToStaticMarkup(
    <StandingsPanel
      season={2025}
      coverage={{ state: 'complete', message: null }}
      rows={[]}
      initialSubview="table"
    />
  );
  const trendsHtml = renderToStaticMarkup(
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

  assert.match(tableHtml, /data-standings-subview="trends"/);
  assert.match(trendsHtml, /data-standings-subview="trends"/);
});

test('standings panel keeps embedded trends rendered when initialSubview prop changes on rerender', () => {
  const rendered = render(
    <StandingsPanel
      season={2025}
      coverage={{ state: 'complete', message: null }}
      rows={[]}
      initialSubview="table"
      standingsHistory={history}
      seasonContext="in-season"
      trendIssues={[]}
    />
  );

  assert.ok(rendered.container.querySelector('[data-standings-subview="trends"]'));

  rendered.rerender(
    <StandingsPanel
      season={2025}
      coverage={{ state: 'complete', message: null }}
      rows={[]}
      initialSubview="trends"
      standingsHistory={history}
      seasonContext="in-season"
      trendIssues={[]}
    />
  );

  assert.ok(rendered.container.querySelector('[aria-label="Games Back shared trend chart"]'));
});

test('deep-link trends initial subview highlights and anchors embedded trends panel', async () => {
  const originalScrollIntoView = window.HTMLElement.prototype.scrollIntoView;
  let scrollCalls = 0;
  window.HTMLElement.prototype.scrollIntoView = () => {
    scrollCalls += 1;
  };
  window.location.hash = '#trends';

  const rendered = render(
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
      initialSubview="trends"
      standingsHistory={history}
      seasonContext="in-season"
      trendIssues={[]}
    />
  );

  const trendsPanel = rendered.container.querySelector('[data-standings-subview="trends"]');
  assert.ok(trendsPanel);
  assert.equal((trendsPanel as HTMLElement).id, 'trends');
  assert.ok(scrollCalls > 0);
  assert.ok(!rendered.container.querySelector('[data-standings-section="recent-momentum"]'));
  assert.equal(rendered.container.querySelectorAll('[data-owner-focus="true"]').length, 0);

  window.HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
  window.location.hash = '';
});

test('query param view=trends deep link highlights and scrolls to embedded trends panel', () => {
  const originalScrollIntoView = window.HTMLElement.prototype.scrollIntoView;
  let scrollCalls = 0;
  window.HTMLElement.prototype.scrollIntoView = () => {
    scrollCalls += 1;
  };
  window.history.replaceState({}, '', 'https://example.test/standings?view=trends');

  const rendered = render(
    <StandingsPanel
      season={2025}
      coverage={{ state: 'complete', message: null }}
      rows={[]}
      initialSubview="table"
      standingsHistory={history}
      seasonContext="in-season"
      trendIssues={[]}
    />
  );

  const trendsPanel = rendered.container.querySelector('[data-standings-subview="trends"]');
  assert.ok(trendsPanel);
  assert.ok(scrollCalls > 0);

  window.HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
  window.history.replaceState({}, '', 'https://example.test/');
});

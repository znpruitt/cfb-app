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

  for (const label of ['Rank', 'Team', 'Record', 'Win %', 'PF', 'PA', 'Diff', 'GB']) {
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
  assert.match(html, /data-winbar-background="75.0%"/);
  assert.doesNotMatch(html, /Swipe\/scroll for full standings detail on small screens\./);
  assert.doesNotMatch(
    html,
    /PF, PA, Diff, and GB stay available without changing standings logic\./
  );
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
  assert.match(html, /data-standings-section="recent-momentum"/);
  assert.doesNotMatch(html, /data-standings-subview="trends"[\s\S]*Recent Momentum/);
});

test('standings panel renders recent momentum below table in left column', () => {
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
  const momentumIndex = html.indexOf('data-standings-section="recent-momentum"');
  const trendsIndex = html.indexOf('data-standings-subview="trends"');
  assert.ok(tableIndex >= 0);
  assert.ok(momentumIndex > tableIndex);
  assert.ok(trendsIndex > momentumIndex);
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
  assert.ok(rendered.container.querySelector('[data-standings-section="recent-momentum"]'));
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

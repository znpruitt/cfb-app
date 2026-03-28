import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { cleanup, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import StandingsPanel from '../StandingsPanel';
import type { StandingsHistory } from '../../lib/standingsHistory';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
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
  assert.match(html, /Standings views/);
  assert.match(html, /Table/);
  assert.match(html, /Trends/);
  assert.match(html, /data-standings-subview="table"/);
  assert.match(html, /aria-selected="true"[^>]*data-standings-subview="table"/);
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
  assert.match(html, /aria-selected="true"[^>]*data-standings-subview="trends"/);
  assert.match(html, /aria-selected="false"[^>]*data-standings-subview="table"/);
  assert.match(html, /Games Back shared trend chart/);
  assert.match(html, /Win % shared trend chart/);
  assert.match(html, /Win Bars/);
});

test('standings panel honors initialSubview table and trends', () => {
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

  assert.match(tableHtml, /aria-selected="true"[^>]*data-standings-subview="table"/);
  assert.match(trendsHtml, /aria-selected="true"[^>]*data-standings-subview="trends"/);
});

test('standings panel syncs active subview when initialSubview prop changes on rerender', () => {
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

  assert.equal(
    rendered.container
      .querySelector('[data-standings-subview="table"]')
      ?.getAttribute('aria-selected'),
    'true'
  );

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

  assert.equal(
    rendered.container
      .querySelector('[data-standings-subview="trends"]')
      ?.getAttribute('aria-selected'),
    'true'
  );
  assert.ok(rendered.container.querySelector('[aria-label="Games Back shared trend chart"]'));
});

test('local tab switching still works after prop-sync effect', async () => {
  const user = userEvent.setup({ document: dom.window.document });
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

  const trendsTab = rendered.container.querySelector('[data-standings-subview="trends"]');
  const tableTab = rendered.container.querySelector('[data-standings-subview="table"]');
  assert.ok(trendsTab);
  assert.ok(tableTab);

  await user.click(trendsTab);
  assert.equal(trendsTab.getAttribute('aria-selected'), 'true');
  assert.ok(rendered.container.querySelector('[aria-label="Win % shared trend chart"]'));

  await user.click(tableTab);
  assert.equal(tableTab.getAttribute('aria-selected'), 'true');
  assert.equal(rendered.container.querySelector('[aria-label="Win % shared trend chart"]'), null);
});

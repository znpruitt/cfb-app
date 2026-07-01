import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { cleanup, render } from '@testing-library/react';

import StandingsPanel from '../StandingsPanel';
import type { CanonicalStandings } from '../../lib/selectors/leagueStandings';
import type { LiveDelta } from '../../lib/selectors/liveDelta';
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
      ownerColorMap={{}}
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

  // The rank column header renders no visible text (rank shown per-row only),
  // so it is asserted via its data-standings-column attribute below rather than a label.
  for (const label of ['Move', 'Team', 'Record', 'Win %', 'PF', 'PA', 'Diff', 'GB']) {
    assert.match(html, new RegExp(label.replace('%', '%')));
  }
  assert.match(html, /Alex/);
  assert.match(html, /3–1/);
  // Win % renders with the leading zero stripped (e.g. ".750").
  assert.match(html, /\.750/);
  assert.match(html, /\+21/);
  // The Trends surface is embedded as a subview alongside the table; the season
  // heading and standalone "Trends" label now live outside this panel.
  assert.match(html, /data-standings-subview="trends"/);
  assert.match(html, /data-layout="standings-trends-split"/);
  assert.match(html, /lg:grid-cols-\[minmax\(0,1.3fr\)_minmax\(0,1.7fr\)\]/);
  assert.match(html, /data-standings-layout="tight"/);
  assert.match(html, /data-standings-column="rank"/);
  assert.match(html, /data-standings-column="move"/);
  assert.match(html, /data-standings-column="pf"/);
  assert.match(html, /text-right tabular-nums/);
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
      ownerColorMap={{}}
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
      ownerColorMap={{}}
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
      ownerColorMap={{}}
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
  // Trends render as a tabbed chart: the active metric's SVG is emitted, and the
  // other metric is reachable via its chart tab. Games Back is the default tab.
  assert.match(html, /aria-label="Games Back shared trend chart"/);
  assert.match(html, /data-chart-tab="games-back"/);
  assert.match(html, /data-chart-tab="win-pct"/);
  assert.doesNotMatch(html, /Win Bars/);
  // Contextual insights require populated rows; this empty-rows case exercises the
  // embedded trend charts only. Insight rendering is covered by the dedicated
  // "renders contextual insights below table" test.
  assert.doesNotMatch(html, /data-standings-subview="trends"[\s\S]*Recent Momentum/);
});

test('standings panel renders contextual insights below table in left column', () => {
  const html = renderToStaticMarkup(
    <StandingsPanel
      ownerColorMap={{}}
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
      ownerColorMap={{}}
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
      ownerColorMap={{}}
      season={2025}
      coverage={{ state: 'complete', message: null }}
      rows={[]}
      initialSubview="table"
    />
  );
  const trendsHtml = renderToStaticMarkup(
    <StandingsPanel
      ownerColorMap={{}}
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
      ownerColorMap={{}}
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
      ownerColorMap={{}}
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
      ownerColorMap={{}}
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
      ownerColorMap={{}}
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

const canonicalArchiveSnapshot: CanonicalStandings = {
  slug: 'tsc',
  year: 2025,
  source: 'archive',
  lifecycle: 'offseason',
  rows: [
    {
      owner: 'Casey',
      wins: 8,
      losses: 2,
      winPct: 0.8,
      pointsFor: 320,
      pointsAgainst: 220,
      pointDifferential: 100,
      gamesBack: 0,
      finalGames: 10,
    },
    {
      owner: 'Drew',
      wins: 5,
      losses: 5,
      winPct: 0.5,
      pointsFor: 250,
      pointsAgainst: 260,
      pointDifferential: -10,
      gamesBack: 3,
      finalGames: 10,
    },
  ],
  noClaimRow: null,
  ownerColorOrder: ['Casey', 'Drew'],
  standingsHistory: history,
  coverage: { state: 'complete', message: null },
  ownersRosterSource: 'archive',
  archiveYearResolved: 2025,
  inferredSeasonStart: null,
  generatedAt: '2026-04-26T00:00:00.000Z',
};

function makeLiveDelta(byOwner: Record<string, number[]>, isStale = false): LiveDelta {
  const ownerEntries = Object.entries(byOwner);
  return {
    weekKey: '2025:8',
    generatedAt: '2026-04-26T00:00:00.000Z',
    byGame: {},
    byOwner: Object.fromEntries(
      ownerEntries.map(([owner, [wins, losses]]) => [
        owner,
        {
          owner,
          pendingWins: wins ?? 0,
          pendingLosses: losses ?? 0,
          pendingPointsFor: 0,
          pendingPointsAgainst: 0,
        },
      ])
    ),
    isStale,
  };
}

test('standings panel prefers canonical rows over fallback rows when canonical is provided', () => {
  const html = renderToStaticMarkup(
    <StandingsPanel
      ownerColorMap={{}}
      season={2025}
      coverage={{ state: 'complete', message: null }}
      rows={[
        {
          owner: 'Stale Fallback',
          wins: 1,
          losses: 0,
          winPct: 1,
          pointsFor: 50,
          pointsAgainst: 30,
          pointDifferential: 20,
          gamesBack: 0,
          finalGames: 1,
        },
      ]}
      canonicalStandings={canonicalArchiveSnapshot}
    />
  );

  assert.match(html, /data-standings-owner="Casey"/);
  assert.match(html, /data-standings-owner="Drew"/);
  assert.doesNotMatch(html, /data-standings-owner="Stale Fallback"/);
});

test('standings panel falls back to client rows when canonical is absent', () => {
  const html = renderToStaticMarkup(
    <StandingsPanel
      ownerColorMap={{}}
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

  assert.match(html, /data-standings-owner="Alex"/);
});

test('standings panel renders live pending badges from fresh liveDelta on canonical rows', () => {
  const html = renderToStaticMarkup(
    <StandingsPanel
      ownerColorMap={{}}
      season={2025}
      coverage={{ state: 'complete', message: null }}
      rows={[]}
      canonicalStandings={canonicalArchiveSnapshot}
      liveDelta={makeLiveDelta({ Casey: [1, 0], Drew: [0, 1] })}
    />
  );

  assert.match(html, /data-standings-live-pending="1-0"/);
  assert.match(html, /data-standings-live-pending="0-1"/);
  assert.match(html, /Live this week: 1–0/);
  assert.match(html, /Live this week: 0–1/);
});

test('standings panel suppresses live badges when liveDelta is stale', () => {
  const html = renderToStaticMarkup(
    <StandingsPanel
      ownerColorMap={{}}
      season={2025}
      coverage={{ state: 'complete', message: null }}
      rows={[]}
      canonicalStandings={canonicalArchiveSnapshot}
      liveDelta={makeLiveDelta({ Casey: [1, 0] }, true)}
    />
  );

  assert.doesNotMatch(html, /data-standings-live-pending/);
  assert.doesNotMatch(html, /Live this week/);
});

test('standings panel omits live badge when owner has no pending stats', () => {
  const html = renderToStaticMarkup(
    <StandingsPanel
      ownerColorMap={{}}
      season={2025}
      coverage={{ state: 'complete', message: null }}
      rows={[]}
      canonicalStandings={canonicalArchiveSnapshot}
      liveDelta={makeLiveDelta({ Casey: [1, 0] })}
    />
  );

  assert.match(html, /data-standings-owner="Casey"[^>]*>[\s\S]*?data-standings-live-pending="1-0"/);
  // Drew has no entry in liveDelta.byOwner, so no badge should render on his row.
  const drewRowMatch = html.match(/data-standings-owner="Drew"[\s\S]*?<\/tr>/);
  assert.ok(drewRowMatch);
  assert.doesNotMatch(drewRowMatch![0], /data-standings-live-pending/);
});

test('standings panel uses canonical history for movement column when canonical is provided', () => {
  const movementHistory: StandingsHistory = {
    weeks: [1, 2],
    byWeek: {
      1: {
        week: 1,
        standings: [
          {
            owner: 'Drew',
            wins: 1,
            losses: 0,
            ties: 0,
            winPct: 1,
            pointsFor: 30,
            pointsAgainst: 20,
            pointDifferential: 10,
            gamesBack: 0,
            finalGames: 1,
          },
          {
            owner: 'Casey',
            wins: 0,
            losses: 1,
            ties: 0,
            winPct: 0,
            pointsFor: 18,
            pointsAgainst: 24,
            pointDifferential: -6,
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
            owner: 'Casey',
            wins: 1,
            losses: 1,
            ties: 0,
            winPct: 0.5,
            pointsFor: 36,
            pointsAgainst: 35,
            pointDifferential: 1,
            gamesBack: 0,
            finalGames: 2,
          },
          {
            owner: 'Drew',
            wins: 1,
            losses: 1,
            ties: 0,
            winPct: 0.5,
            pointsFor: 47,
            pointsAgainst: 50,
            pointDifferential: -3,
            gamesBack: 0,
            finalGames: 2,
          },
        ],
        coverage: { state: 'complete', message: null },
      },
    },
    byOwner: {},
  };

  const canonicalWithMovement: CanonicalStandings = {
    ...canonicalArchiveSnapshot,
    standingsHistory: movementHistory,
    rows: [
      {
        owner: 'Casey',
        wins: 1,
        losses: 1,
        winPct: 0.5,
        pointsFor: 36,
        pointsAgainst: 35,
        pointDifferential: 1,
        gamesBack: 0,
        finalGames: 2,
      },
      {
        owner: 'Drew',
        wins: 1,
        losses: 1,
        winPct: 0.5,
        pointsFor: 47,
        pointsAgainst: 50,
        pointDifferential: -3,
        gamesBack: 0,
        finalGames: 2,
      },
    ],
  };

  // No fallback `standingsHistory` prop passed — movement should still derive
  // from canonical's history alone.
  const html = renderToStaticMarkup(
    <StandingsPanel
      ownerColorMap={{}}
      season={2025}
      coverage={{ state: 'complete', message: null }}
      rows={[]}
      canonicalStandings={canonicalWithMovement}
      seasonContext="in-season"
    />
  );

  assert.match(html, /data-standings-move="↑1"/);
  assert.match(html, /data-standings-move="↓1"/);
});

// ---------------------------------------------------------------------------
// PLATFORM-049 — Standings coverage is canonical-preferred: rows/history/
// coverage all come from the same canonical snapshot when supplied.
// ---------------------------------------------------------------------------

const LOCAL_PARTIAL_MESSAGE =
  'Standings may be incomplete — some completed game scores are still loading.';

test('canonical partial coverage overrides contradictory local complete coverage', () => {
  const html = renderToStaticMarkup(
    <StandingsPanel
      ownerColorMap={{}}
      season={2025}
      coverage={{ state: 'complete', message: null }}
      rows={[]}
      canonicalStandings={{
        ...canonicalArchiveSnapshot,
        coverage: { state: 'partial', message: 'Canonical partial coverage.' },
      }}
    />
  );

  assert.match(html, /Canonical partial coverage\./);
});

test('archive canonical complete coverage suppresses a stale local partial warning', () => {
  const html = renderToStaticMarkup(
    <StandingsPanel
      ownerColorMap={{}}
      season={2025}
      coverage={{ state: 'partial', message: LOCAL_PARTIAL_MESSAGE }}
      rows={[]}
      canonicalStandings={canonicalArchiveSnapshot}
    />
  );

  // Canonical archive coverage is complete/no-message → no warning at all,
  // and the contradictory local partial message must not render.
  assert.doesNotMatch(html, new RegExp(LOCAL_PARTIAL_MESSAGE.replace(/[—.]/g, '.')));
  // Canonical rows still render (coverage resolution never changes rows).
  assert.match(html, /Casey/);
  assert.match(html, /Drew/);
});

test('canonical snapshot with missing/null coverage shows conservative error, not local coverage', () => {
  const malformed = { ...canonicalArchiveSnapshot };
  (malformed as { coverage: unknown }).coverage = null;

  const html = renderToStaticMarkup(
    <StandingsPanel
      ownerColorMap={{}}
      season={2025}
      coverage={{ state: 'complete', message: 'Local complete — must not appear.' }}
      rows={[]}
      canonicalStandings={malformed as typeof canonicalArchiveSnapshot}
    />
  );

  assert.match(html, /Standings coverage is unavailable\./);
  assert.doesNotMatch(html, /Local complete — must not appear\./);
});

test('no canonical snapshot preserves the local partial coverage warning', () => {
  const html = renderToStaticMarkup(
    <StandingsPanel
      ownerColorMap={{}}
      season={2025}
      coverage={{ state: 'partial', message: LOCAL_PARTIAL_MESSAGE }}
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

  assert.match(html, new RegExp(LOCAL_PARTIAL_MESSAGE.replace(/[—.]/g, '.')));
});

test('liveDelta badges are unaffected by contradictory coverage fixtures', () => {
  const html = renderToStaticMarkup(
    <StandingsPanel
      ownerColorMap={{}}
      season={2025}
      coverage={{ state: 'error', message: 'Local error — should be overridden.' }}
      rows={[]}
      canonicalStandings={canonicalArchiveSnapshot}
      liveDelta={makeLiveDelta({ Casey: [1, 0], Drew: [0, 1] })}
    />
  );

  // Canonical complete coverage suppresses the local error message…
  assert.doesNotMatch(html, /Local error — should be overridden\./);
  // …while liveDelta badges render exactly as before.
  assert.match(html, /data-standings-live-pending="1-0"/);
  assert.match(html, /data-standings-live-pending="0-1"/);
});

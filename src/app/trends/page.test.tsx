import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { cleanup, fireEvent, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import TrendsDetailSurface, {
  formatHoverSummary,
  toggleSelectedOwner,
} from './TrendsDetailSurface';
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

const dom = new JSDOM('<!doctype html><html><body></body></html>');
(globalThis as { window: Window }).window = dom.window as unknown as Window;
(globalThis as { document: Document }).document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', {
  value: dom.window.navigator,
  writable: true,
  configurable: true,
});

afterEach(() => cleanup());

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
  assert.match(html, /Recent Momentum/);
});

test('owner selection propagates emphasis across charts, labels, momentum, win bars, and owner focus summary', async () => {
  const user = userEvent.setup({ document: dom.window.document });
  const rendered = render(
    <TrendsDetailSurface
      standingsHistory={history}
      season={2026}
      seasonContext="final"
      issues={[]}
    />
  );

  const legendBob = rendered.container.querySelector('[data-legend-owner="Bob"]');
  assert.ok(legendBob);
  await user.click(legendBob);

  const bobGamesBackLine = rendered.container.querySelector(
    '[aria-label="Games Back shared trend chart"] [data-owner-id="Bob"][data-selected="true"]'
  );
  const aliceGamesBackLine = rendered.container.querySelector(
    '[aria-label="Games Back shared trend chart"] [data-owner-id="Alice"][data-muted="true"]'
  );
  assert.ok(bobGamesBackLine);
  assert.ok(aliceGamesBackLine);

  const bobWinPctLine = rendered.container.querySelector(
    '[aria-label="Win % shared trend chart"] [data-owner-id="Bob"][data-selected="true"]'
  );
  assert.ok(bobWinPctLine);

  const bobLabel = rendered.container.querySelector(
    '[aria-label="Win % shared trend chart"] [data-right-edge-label="Bob"]'
  );
  assert.ok(bobLabel);

  const bobWinBar = rendered.container.querySelector(
    '[data-winbar-owner="Bob"][data-selected="true"]'
  );
  const bobMomentum = rendered.container.querySelector(
    '[data-momentum-owner="Bob"][data-selected="true"]'
  );
  assert.ok(bobWinBar);
  assert.ok(bobMomentum);

  const ownerFocus = rendered.container.querySelector('[data-owner-focus="true"]');
  assert.ok(ownerFocus);
  assert.match(ownerFocus.textContent ?? '', /Owner Focus/);
  assert.match(ownerFocus.textContent ?? '', /Bob/);
  assert.match(ownerFocus.textContent ?? '', /Rank: 2nd/);
});

test('clicking same owner toggles selection off and removes owner focus summary', async () => {
  const user = userEvent.setup({ document: dom.window.document });
  const rendered = render(
    <TrendsDetailSurface
      standingsHistory={history}
      season={2026}
      seasonContext="final"
      issues={[]}
    />
  );

  const legendAlice = rendered.container.querySelector('[data-legend-owner="Alice"]');
  assert.ok(legendAlice);

  await user.click(legendAlice);
  assert.ok(rendered.container.querySelector('[data-owner-focus="true"]'));

  await user.click(legendAlice);
  assert.equal(rendered.container.querySelector('[data-owner-focus="true"]'), null);
  assert.ok(
    rendered.container.querySelector(
      '[aria-label="Games Back shared trend chart"] [data-owner-id="Bob"][data-muted="false"]'
    )
  );
});

test('hover summary still updates when selection is active', async () => {
  const user = userEvent.setup({ document: dom.window.document });
  const rendered = render(
    <TrendsDetailSurface
      standingsHistory={history}
      season={2026}
      seasonContext="final"
      issues={[]}
    />
  );

  const legendAlice = rendered.container.querySelector('[data-legend-owner="Alice"]');
  assert.ok(legendAlice);
  await user.click(legendAlice);

  const firstCircle = rendered.container.querySelector(
    '[aria-label="Games Back shared trend chart"] circle'
  );
  assert.ok(firstCircle);
  fireEvent.mouseEnter(firstCircle);

  const hoverSummary = rendered.container.querySelector('[data-hover-summary]');
  assert.ok(hoverSummary);
  assert.match(hoverSummary.textContent ?? '', /Week/);
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

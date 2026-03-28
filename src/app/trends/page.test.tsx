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
import TrendsPage from './page';
import type { StandingsHistory } from '../../lib/standingsHistory';

const history: StandingsHistory = {
  weeks: [1, 2],
  byWeek: {
    1: {
      week: 1,
      standings: [
        {
          owner: 'Alice',
          wins: 3,
          losses: 0,
          ties: 0,
          winPct: 1,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 0,
          gamesBack: 0,
          finalGames: 3,
        },
        {
          owner: 'Bob',
          wins: 2,
          losses: 1,
          ties: 0,
          winPct: 0.667,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 0,
          gamesBack: 1,
          finalGames: 3,
        },
        {
          owner: 'Carol',
          wins: 2,
          losses: 1,
          ties: 0,
          winPct: 0.667,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 0,
          gamesBack: 1,
          finalGames: 3,
        },
        {
          owner: 'Dave',
          wins: 1,
          losses: 2,
          ties: 0,
          winPct: 0.333,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 0,
          gamesBack: 2,
          finalGames: 3,
        },
        {
          owner: 'Eve',
          wins: 1,
          losses: 2,
          ties: 0,
          winPct: 0.333,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 0,
          gamesBack: 2,
          finalGames: 3,
        },
        {
          owner: 'Frank',
          wins: 1,
          losses: 2,
          ties: 0,
          winPct: 0.333,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 0,
          gamesBack: 2,
          finalGames: 3,
        },
        {
          owner: 'Grace',
          wins: 0,
          losses: 3,
          ties: 0,
          winPct: 0,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 0,
          gamesBack: 3,
          finalGames: 3,
        },
        {
          owner: 'VeryLongOwnerDisplayName',
          wins: 0,
          losses: 3,
          ties: 0,
          winPct: 0,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 0,
          gamesBack: 3,
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
          wins: 4,
          losses: 0,
          ties: 0,
          winPct: 1,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 0,
          gamesBack: 0,
          finalGames: 4,
        },
        {
          owner: 'Bob',
          wins: 3,
          losses: 1,
          ties: 0,
          winPct: 0.75,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 0,
          gamesBack: 1,
          finalGames: 4,
        },
        {
          owner: 'Carol',
          wins: 3,
          losses: 1,
          ties: 0,
          winPct: 0.75,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 0,
          gamesBack: 1,
          finalGames: 4,
        },
        {
          owner: 'Dave',
          wins: 2,
          losses: 2,
          ties: 0,
          winPct: 0.5,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 0,
          gamesBack: 2,
          finalGames: 4,
        },
        {
          owner: 'Eve',
          wins: 2,
          losses: 2,
          ties: 0,
          winPct: 0.5,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 0,
          gamesBack: 2,
          finalGames: 4,
        },
        {
          owner: 'Frank',
          wins: 1,
          losses: 3,
          ties: 0,
          winPct: 0.25,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 0,
          gamesBack: 3,
          finalGames: 4,
        },
        {
          owner: 'Grace',
          wins: 0,
          losses: 4,
          ties: 0,
          winPct: 0,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 0,
          gamesBack: 4,
          finalGames: 4,
        },
        {
          owner: 'VeryLongOwnerDisplayName',
          wins: 0,
          losses: 4,
          ties: 0,
          winPct: 0,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 0,
          gamesBack: 4,
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
        wins: 3,
        losses: 0,
        ties: 0,
        winPct: 1,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 0,
        gamesBack: 0,
      },
      {
        week: 2,
        wins: 4,
        losses: 0,
        ties: 0,
        winPct: 1,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 0,
        gamesBack: 0,
      },
    ],
    Bob: [
      {
        week: 1,
        wins: 2,
        losses: 1,
        ties: 0,
        winPct: 0.667,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 0,
        gamesBack: 1,
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
        gamesBack: 1,
      },
    ],
    Carol: [
      {
        week: 1,
        wins: 2,
        losses: 1,
        ties: 0,
        winPct: 0.667,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 0,
        gamesBack: 1,
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
        gamesBack: 1,
      },
    ],
    Dave: [
      {
        week: 1,
        wins: 1,
        losses: 2,
        ties: 0,
        winPct: 0.333,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 0,
        gamesBack: 2,
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
        gamesBack: 2,
      },
    ],
    Eve: [
      {
        week: 1,
        wins: 1,
        losses: 2,
        ties: 0,
        winPct: 0.333,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 0,
        gamesBack: 2,
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
        gamesBack: 2,
      },
    ],
    Frank: [
      {
        week: 1,
        wins: 1,
        losses: 2,
        ties: 0,
        winPct: 0.333,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 0,
        gamesBack: 2,
      },
      {
        week: 2,
        wins: 1,
        losses: 3,
        ties: 0,
        winPct: 0.25,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 0,
        gamesBack: 3,
      },
    ],
    Grace: [
      {
        week: 1,
        wins: 0,
        losses: 3,
        ties: 0,
        winPct: 0,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 0,
        gamesBack: 3,
      },
      {
        week: 2,
        wins: 0,
        losses: 4,
        ties: 0,
        winPct: 0,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 0,
        gamesBack: 4,
      },
    ],
    VeryLongOwnerDisplayName: [
      {
        week: 1,
        wins: 0,
        losses: 3,
        ties: 0,
        winPct: 0,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 0,
        gamesBack: 3,
      },
      {
        week: 2,
        wins: 0,
        losses: 4,
        ties: 0,
        winPct: 0,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 0,
        gamesBack: 4,
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

  const rightEdgeLabels = Array.from(
    rendered.container.querySelectorAll<SVGTextElement>(
      '[aria-label="Games Back shared trend chart"] text[data-right-edge-label]'
    )
  );
  assert.ok(rightEdgeLabels.length > 0);
  for (const label of rightEdgeLabels) {
    const y = Number.parseFloat(label.getAttribute('y') ?? '0');
    assert.ok(y >= 12 && y <= 224);
  }

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

  const momentumOwners = Array.from(
    rendered.container.querySelectorAll<HTMLElement>('[data-momentum-owner]')
  ).map((node) => node.getAttribute('data-momentum-owner'));
  assert.equal(momentumOwners.length, new Set(momentumOwners).size);

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

test('focus mode controls switch between all, top 5, and selected rendering states', async () => {
  const user = userEvent.setup({ document: dom.window.document });
  const rendered = render(
    <TrendsDetailSurface
      standingsHistory={history}
      season={2026}
      seasonContext="final"
      issues={[]}
    />
  );

  const allControl = rendered.container.querySelector('[data-focus-mode-control="all"]');
  const topControl = rendered.container.querySelector('[data-focus-mode-control="top"]');
  const selectedControl = rendered.container.querySelector('[data-focus-mode-control="selected"]');
  assert.ok(allControl);
  assert.ok(topControl);
  assert.ok(selectedControl);
  assert.equal(allControl.getAttribute('aria-pressed'), 'true');

  await user.click(topControl);
  assert.equal(topControl.getAttribute('aria-pressed'), 'true');
  assert.ok(
    rendered.container.querySelector(
      '[aria-label="Games Back shared trend chart"] [data-owner-id="Frank"][data-muted="true"]'
    )
  );
  assert.ok(
    rendered.container.querySelector(
      '[aria-label="Games Back shared trend chart"] [data-owner-id="Eve"][data-muted="false"]'
    )
  );

  await user.click(selectedControl);
  assert.equal(selectedControl.getAttribute('aria-pressed'), 'true');
  assert.ok(
    rendered.container.querySelector(
      '[aria-label="Games Back shared trend chart"] [data-owner-id="Frank"][data-muted="false"]'
    )
  );
});

test('selected mode emphasizes selected owner and mutes all others across chart, labels, win bars, and momentum', async () => {
  const user = userEvent.setup({ document: dom.window.document });
  const rendered = render(
    <TrendsDetailSurface
      standingsHistory={history}
      season={2026}
      seasonContext="final"
      issues={[]}
    />
  );

  const selectedControl = rendered.container.querySelector('[data-focus-mode-control="selected"]');
  const legendBob = rendered.container.querySelector('[data-legend-owner="Bob"]');
  assert.ok(selectedControl);
  assert.ok(legendBob);

  await user.click(selectedControl);
  await user.click(legendBob);

  assert.ok(
    rendered.container.querySelector(
      '[aria-label="Games Back shared trend chart"] [data-owner-id="Bob"][data-selected="true"][data-muted="false"]'
    )
  );
  assert.ok(
    rendered.container.querySelector(
      '[aria-label="Games Back shared trend chart"] [data-owner-id="Alice"][data-muted="true"]'
    )
  );
  assert.ok(
    rendered.container
      .querySelector('[aria-label="Games Back shared trend chart"] [data-right-edge-label="Alice"]')
      ?.closest('[data-muted="true"]')
  );
  assert.ok(rendered.container.querySelector('[data-winbar-owner="Alice"][data-muted="true"]'));
  assert.ok(rendered.container.querySelector('[data-momentum-owner="Bob"][data-selected="true"]'));
});

test('top mode keeps selected owner emphasized even when owner is outside top 5', async () => {
  const user = userEvent.setup({ document: dom.window.document });
  const rendered = render(
    <TrendsDetailSurface
      standingsHistory={history}
      season={2026}
      seasonContext="final"
      issues={[]}
    />
  );

  const topControl = rendered.container.querySelector('[data-focus-mode-control="top"]');
  const legendFrank = rendered.container.querySelector('[data-legend-owner="Frank"]');
  assert.ok(topControl);
  assert.ok(legendFrank);

  await user.click(topControl);
  assert.ok(
    rendered.container.querySelector(
      '[aria-label="Win % shared trend chart"] [data-owner-id="Frank"][data-muted="true"]'
    )
  );

  await user.click(legendFrank);

  assert.ok(
    rendered.container.querySelector(
      '[aria-label="Win % shared trend chart"] [data-owner-id="Frank"][data-selected="true"][data-muted="false"]'
    )
  );
  assert.ok(
    rendered.container.querySelector(
      '[aria-label="Win % shared trend chart"] [data-owner-id="Grace"][data-muted="true"]'
    )
  );
  assert.ok(rendered.container.querySelector('[data-owner-focus="true"]'));
  assert.match(rendered.container.textContent ?? '', /Recent Momentum/);
});

test('right-edge labels include truncated owner names, formatted values, and connectors', () => {
  const rendered = render(
    <TrendsDetailSurface
      standingsHistory={history}
      season={2026}
      seasonContext="final"
      issues={[]}
    />
  );

  const gamesBackLabel = rendered.container.querySelector(
    '[aria-label="Games Back shared trend chart"] [data-right-edge-label="VeryLongOwnerDisplayName"]'
  );
  const winPctLabel = rendered.container.querySelector(
    '[aria-label="Win % shared trend chart"] [data-right-edge-label="VeryLongOwnerDisplayName"]'
  );
  assert.ok(gamesBackLabel);
  assert.ok(winPctLabel);
  assert.match(gamesBackLabel.textContent ?? '', /VeryLongOwn… 4\.0/);
  assert.match(winPctLabel.textContent ?? '', /VeryLongOwn… 0\.0%/);

  assert.ok(
    rendered.container.querySelector(
      '[aria-label="Games Back shared trend chart"] [data-label-connector="VeryLongOwnerDisplayName"]'
    )
  );
  assert.ok(
    rendered.container.querySelector(
      '[aria-label="Win % shared trend chart"] [data-label-anchor-dot="VeryLongOwnerDisplayName"]'
    )
  );
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

test('legacy trends page redirects to standings trends subview', () => {
  try {
    TrendsPage();
    assert.fail('Expected redirect to throw');
  } catch (error) {
    assert.match(String(error), /NEXT_REDIRECT/);
    const digest = (error as { digest?: string }).digest ?? '';
    assert.match(digest, /\/standings\?view=trends/);
  }
});

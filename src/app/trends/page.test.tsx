import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { cleanup, fireEvent, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import TrendsDetailSurface, {
  deriveAdaptiveWeekTicks,
  deriveDynamicPlotWidth,
  deriveResponsiveTrendLayout,
  toggleSelectedOwner,
} from './TrendsDetailSurface';
import TrendsPage from './page';
import type { StandingsHistory } from '../../lib/standingsHistory';
import { deriveWeekTicks } from '../../lib/trendsFocus';

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
class ResizeObserverMock {
  callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }
  observe(target: Element): void {
    this.callback(
      [{ contentRect: { width: 900 } as DOMRectReadOnly, target } as ResizeObserverEntry],
      this as unknown as ResizeObserver
    );
  }
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver =
  ResizeObserverMock as unknown as typeof ResizeObserver;
Object.defineProperty(window, 'innerWidth', {
  value: 1024,
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

  const rightEdgeLabels: SVGTextElement[] = Array.from(
    rendered.container.querySelectorAll<SVGTextElement>(
      '[aria-label="Games Back shared trend chart"] text[data-right-edge-label]'
    )
  );
  assert.ok(rightEdgeLabels.length > 0);
  for (const label of rightEdgeLabels) {
    const y = Number.parseFloat(label.getAttribute('y') ?? '0');
    assert.ok(y >= 10 && y <= 325);
  }

  const legendBob = rendered.container.querySelector('[data-legend-owner="Bob"]');
  assert.ok(legendBob);
  await user.click(legendBob);

  const bobGamesBackLine = rendered.container.querySelector(
    '[aria-label="Games Back shared trend chart"] [data-owner-id="Bob"][data-selected="true"]'
  );
  const frankGamesBackLine = rendered.container.querySelector(
    '[aria-label="Games Back shared trend chart"] [data-owner-id="Frank"]'
  );
  assert.ok(bobGamesBackLine);
  assert.equal(frankGamesBackLine, null);

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

  const momentumNodes = rendered.container.querySelectorAll<HTMLElement>('[data-momentum-owner]');
  const momentumOwners = [...momentumNodes].map((node) => node.getAttribute('data-momentum-owner'));
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
      '[aria-label="Games Back shared trend chart"] [data-owner-id="Bob"]'
    )
  );
});

test('point hover shows compact chart tooltip content', async () => {
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
    '[aria-label="Games Back shared trend chart"] circle[data-owner-id], [aria-label="Games Back shared trend chart"] circle'
  );
  assert.ok(firstCircle);
  fireEvent.mouseEnter(firstCircle);

  const tooltip = rendered.container.querySelector('[data-trend-tooltip="games-back"]');
  assert.ok(tooltip);
  assert.match(tooltip.textContent ?? '', /W\d+/);
  assert.match(tooltip.textContent ?? '', /Alice|Bob|Carol|Dave|Eve/);
  assert.match(tooltip.textContent ?? '', /GB: \d+\.\d/);
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
  assert.equal(topControl.getAttribute('aria-pressed'), 'true');
  assert.equal(
    rendered.container.querySelector(
      '[aria-label="Games Back shared trend chart"] [data-owner-id="Frank"]'
    ),
    null
  );

  await user.click(allControl);
  assert.equal(allControl.getAttribute('aria-pressed'), 'true');
  assert.ok(
    rendered.container.querySelector(
      '[aria-label="Games Back shared trend chart"] [data-owner-id="Frank"]'
    )
  );

  await user.click(selectedControl);
  assert.equal(selectedControl.getAttribute('aria-pressed'), 'true');
  assert.equal(
    rendered.container.querySelector(
      '[aria-label="Games Back shared trend chart"] [data-owner-id="Frank"]'
    ),
    null
  );
});

test('default focus renders only top 5 series and excludes non-focused owners from DOM', () => {
  const rendered = render(
    <TrendsDetailSurface
      standingsHistory={history}
      season={2026}
      seasonContext="final"
      issues={[]}
    />
  );

  const gamesBackSeries = rendered.container.querySelectorAll(
    '[aria-label="Games Back shared trend chart"] path[data-owner-id]'
  );
  assert.equal(gamesBackSeries.length, 5);
  assert.equal(
    rendered.container.querySelector(
      '[aria-label="Games Back shared trend chart"] [data-owner-id="Frank"]'
    ),
    null
  );
});

test('clicking win bars toggles selected mode and falls back to top 5 when empty', async () => {
  const user = userEvent.setup({ document: dom.window.document });
  const rendered = render(
    <TrendsDetailSurface
      standingsHistory={history}
      season={2026}
      seasonContext="final"
      issues={[]}
    />
  );

  const bobWinBar = rendered.container.querySelector('[data-winbar-owner="Bob"] button');
  assert.ok(bobWinBar);

  await user.click(bobWinBar);
  const selectedControl = rendered.container.querySelector('[data-focus-mode-control="selected"]');
  assert.ok(selectedControl);
  assert.equal(selectedControl.getAttribute('aria-pressed'), 'true');

  assert.ok(
    rendered.container.querySelector(
      '[aria-label="Games Back shared trend chart"] [data-owner-id="Bob"][data-selected="true"]'
    )
  );
  assert.equal(
    rendered.container.querySelectorAll(
      '[aria-label="Games Back shared trend chart"] path[data-owner-id]'
    ).length,
    1
  );
  await user.click(bobWinBar);
  assert.equal(
    rendered.container.querySelector(
      '[aria-label="Games Back shared trend chart"] [data-owner-id="Frank"]'
    ),
    null
  );
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
  const allControl = rendered.container.querySelector('[data-focus-mode-control="all"]');
  assert.ok(allControl);
  fireEvent.click(allControl);

  const gamesBackLabel = rendered.container.querySelector(
    '[aria-label="Games Back shared trend chart"] [data-right-edge-label="VeryLongOwnerDisplayName"]'
  );
  const winPctLabel = rendered.container.querySelector(
    '[aria-label="Win % shared trend chart"] [data-right-edge-label="VeryLongOwnerDisplayName"]'
  );
  assert.ok(gamesBackLabel);
  assert.ok(winPctLabel);
  assert.match(gamesBackLabel.textContent ?? '', /VeryLongO… 4\.0/);
  assert.match(winPctLabel.textContent ?? '', /VeryLongO… 0\.0%/);

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

test('win bars render value-encoded fills using win percentage width', () => {
  const rendered = render(
    <TrendsDetailSurface
      standingsHistory={history}
      season={2026}
      seasonContext="final"
      issues={[]}
    />
  );

  const aliceFill = rendered.container.querySelector<HTMLElement>('[data-winbar-fill="Alice"]');
  const bobFill = rendered.container.querySelector<HTMLElement>('[data-winbar-fill="Bob"]');
  assert.ok(aliceFill);
  assert.ok(bobFill);
  assert.equal(aliceFill.style.width, '100%');
  assert.equal(bobFill.style.width, '75%');
});

test('selection helper toggles selected owner deterministically', () => {
  assert.equal(toggleSelectedOwner(null, 'Alice'), 'Alice');
  assert.equal(toggleSelectedOwner('Alice', 'Alice'), null);
  assert.equal(toggleSelectedOwner('Alice', 'Bob'), 'Bob');
});

test('games back chart includes inverted axis domain marker and week ticks', () => {
  const rendered = render(
    <TrendsDetailSurface
      standingsHistory={history}
      season={2026}
      seasonContext="final"
      issues={[]}
    />
  );
  const gamesBackChart = rendered.container.querySelector(
    '[aria-label="Games Back shared trend chart"]'
  );
  assert.ok(gamesBackChart);
  assert.equal(gamesBackChart.getAttribute('data-y-domain'), '[4,0]');
  assert.equal(gamesBackChart.getAttribute('data-label-lane-width'), '120');
  const gamesBackPlotWrapper = rendered.container.querySelector<HTMLElement>(
    '[aria-label="Games Back shared trend chart"]'
  )?.parentElement;
  assert.ok(gamesBackPlotWrapper);
  const dynamicWidth = Number.parseFloat(
    gamesBackPlotWrapper.getAttribute('data-plot-width') ?? '0'
  );
  const containerWidth = Number.parseFloat(
    gamesBackPlotWrapper.getAttribute('data-container-width') ?? '0'
  );
  assert.ok(dynamicWidth >= 320);
  assert.ok(dynamicWidth >= containerWidth);
  assert.notEqual(dynamicWidth, 760);
  assert.ok(
    rendered.container.querySelector(
      '[aria-label="Games Back shared trend chart"] [data-week-tick="W1"]'
    )
  );
  assert.ok(
    rendered.container.querySelector(
      '[aria-label="Games Back shared trend chart"] [data-week-tick="W2"]'
    )
  );
});

test('deriveWeekTicks increases density for long seasons and preserves first/last weeks', () => {
  const weeks = Array.from({ length: 15 }, (_, i) => i + 1);
  const ticks = deriveWeekTicks(weeks);
  assert.equal(ticks[0]?.value, 1);
  assert.equal(ticks[ticks.length - 1]?.value, 15);
  assert.ok(ticks.some((tick) => tick.value === 3));
  assert.ok(!ticks.some((tick) => tick.value === 4));
});

test('win pct chart tooltip formats percentage values on hover', () => {
  const rendered = render(
    <TrendsDetailSurface
      standingsHistory={history}
      season={2026}
      seasonContext="final"
      issues={[]}
    />
  );
  const firstWinPctCircle = rendered.container.querySelector(
    '[aria-label="Win % shared trend chart"] circle'
  );
  assert.ok(firstWinPctCircle);
  fireEvent.mouseEnter(firstWinPctCircle);
  const tooltip = rendered.container.querySelector('[data-trend-tooltip="win-pct"]');
  assert.ok(tooltip);
  assert.match(tooltip.textContent ?? '', /Win %: \d+\.\d%/);
});

test('deriveDynamicPlotWidth uses container width baseline and expands for long seasons', () => {
  assert.equal(deriveDynamicPlotWidth({ containerWidth: 900, weekCount: 2, pxPerWeek: 48 }), 900);
  assert.equal(deriveDynamicPlotWidth({ containerWidth: 500, weekCount: 20, pxPerWeek: 48 }), 960);
});

test('deriveResponsiveTrendLayout adapts chart settings by breakpoint', () => {
  const mobile = deriveResponsiveTrendLayout({ viewportWidth: 375, weekCount: 14 });
  assert.equal(mobile.isMobile, true);
  assert.equal(mobile.chartHeight, 308);
  assert.equal(mobile.pxPerWeek, 56);
  assert.equal(mobile.tickStep, 4);
  assert.equal(mobile.showRightEdgeLabels, false);
  assert.equal(mobile.compactWinBars, true);

  const desktop = deriveResponsiveTrendLayout({ viewportWidth: 1024, weekCount: 14 });
  assert.equal(desktop.isMobile, false);
  assert.equal(desktop.chartHeight, 420);
  assert.equal(desktop.pxPerWeek, 48);
  assert.equal(desktop.tickStep, 2);
  assert.equal(desktop.showRightEdgeLabels, true);
  assert.equal(desktop.compactWinBars, false);
});

test('deriveAdaptiveWeekTicks always keeps first/last and uses adaptive spacing', () => {
  const weeks = Array.from({ length: 14 }, (_, i) => i + 1);
  const mobileTicks = deriveAdaptiveWeekTicks(weeks, 4);
  assert.equal(mobileTicks[0]?.value, 1);
  assert.equal(mobileTicks[mobileTicks.length - 1]?.value, 14);
  assert.ok(mobileTicks.some((tick) => tick.value === 5));
  assert.ok(!mobileTicks.some((tick) => tick.value === 6));
});

test('mobile layout suppresses right-edge labels, tightens win bars, and adapts chart height', () => {
  window.innerWidth = 375;
  fireEvent(window, new window.Event('resize'));

  const rendered = render(
    <TrendsDetailSurface
      standingsHistory={history}
      season={2026}
      seasonContext="final"
      issues={[]}
    />
  );

  const gamesBackChart = rendered.container.querySelector(
    '[aria-label="Games Back shared trend chart"]'
  );
  assert.ok(gamesBackChart);
  const plotWrapper = gamesBackChart.parentElement;
  assert.ok(plotWrapper);
  assert.equal(plotWrapper.getAttribute('data-chart-height'), '308');
  assert.equal(plotWrapper.getAttribute('data-show-right-labels'), 'false');
  assert.equal(
    rendered.container.querySelector(
      '[aria-label="Games Back shared trend chart"] [data-right-edge-label]'
    ),
    null
  );
  assert.ok(rendered.container.querySelector('[data-winbar-owner="Alice"][data-compact="true"]'));

  window.innerWidth = 1024;
  fireEvent(window, new window.Event('resize'));
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

import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { cleanup, fireEvent, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import TrendsDetailSurface, {
  deriveEndpointLabelLayout,
  deriveAllWeekTicks,
  deriveAdaptiveWeekTicks,
  deriveDynamicPlotWidth,
  deriveResponsiveTrendLayout,
  estimateEndpointLabelWidth,
  toggleSelectedOwner,
} from './TrendsDetailSurface';
import TrendsPage from './page';
import type { StandingsHistory } from '../../lib/standingsHistory';
import { deriveWeekTicks } from '../../lib/trendsFocus';
import { buildOwnerColorMap, getOwnerColor } from '../../lib/ownerColors';

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

function buildHistoryWithWeekCount(weekCount: number): StandingsHistory {
  const weeks = Array.from({ length: weekCount }, (_, index) => index + 1);
  const owners = ['Alpha', 'Bravo'];
  return {
    weeks,
    byWeek: Object.fromEntries(
      weeks.map((week) => [
        week,
        {
          week,
          standings: owners.map((owner, ownerIndex) => ({
            owner,
            wins: Math.max(0, week - ownerIndex),
            losses: ownerIndex + 1,
            ties: 0,
            winPct: Math.max(0, (week - ownerIndex) / (week + ownerIndex + 1)),
            pointsFor: 0,
            pointsAgainst: 0,
            pointDifferential: 0,
            gamesBack: ownerIndex,
            finalGames: week + ownerIndex + 1,
          })),
          coverage: { state: 'complete', message: null },
        },
      ])
    ),
    byOwner: Object.fromEntries(
      owners.map((owner, ownerIndex) => [
        owner,
        weeks.map((week) => ({
          week,
          wins: Math.max(0, week - ownerIndex),
          losses: ownerIndex + 1,
          ties: 0,
          winPct: Math.max(0, (week - ownerIndex) / (week + ownerIndex + 1)),
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 0,
          gamesBack: ownerIndex,
        })),
      ])
    ),
  };
}

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
  assert.match(html, /Recent Momentum/);
});

test('owner selection propagates emphasis across charts, labels, momentum, and owner focus summary', async () => {
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
  const aliceGamesBackLine = rendered.container.querySelector(
    '[aria-label="Games Back shared trend chart"] [data-owner-id="Alice"]'
  );
  assert.ok(bobGamesBackLine);
  assert.ok(aliceGamesBackLine);
  assert.equal(aliceGamesBackLine.getAttribute('data-muted'), 'true');
  assert.equal(bobGamesBackLine.getAttribute('stroke-width'), '5.2');
  assert.equal(aliceGamesBackLine.getAttribute('stroke-width'), '1.6');

  const bobWinPctLine = rendered.container.querySelector(
    '[aria-label="Win % shared trend chart"] [data-owner-id="Bob"][data-selected="true"]'
  );
  assert.ok(bobWinPctLine);

  const bobLabel = rendered.container.querySelector(
    '[aria-label="Win % shared trend chart"] [data-right-edge-label="Bob"]'
  );
  assert.ok(bobLabel);

  const bobMomentum = rendered.container.querySelector(
    '[data-momentum-owner="Bob"][data-selected="true"]'
  );
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

  const hoverTarget = rendered.container.querySelector(
    '[aria-label="Games Back shared trend chart"] [data-hover-target="games-back-Alice-1"]'
  );
  assert.ok(hoverTarget);
  assert.equal(hoverTarget.getAttribute('r'), '10');
  fireEvent.mouseEnter(hoverTarget);

  const tooltip = rendered.container.querySelector('[data-trend-tooltip="games-back"]');
  assert.ok(tooltip);
  assert.match(tooltip.textContent ?? '', /W\d+/);
  assert.match(tooltip.textContent ?? '', /Alice|Bob|Carol|Dave|Eve/);
  assert.match(tooltip.textContent ?? '', /GB: \d+\.\d/);

  const activeDot = rendered.container.querySelector(
    '[aria-label="Games Back shared trend chart"] circle[fill^="hsl("]'
  );
  assert.ok(activeDot);
  assert.ok(Number.parseFloat(activeDot.getAttribute('r') ?? '0') >= 6);
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

test('selected focus mode follows active owner selection from chart interactions', async () => {
  const user = userEvent.setup({ document: dom.window.document });
  const rendered = render(
    <TrendsDetailSurface
      standingsHistory={history}
      season={2026}
      seasonContext="final"
      issues={[]}
    />
  );

  const bobLegend = rendered.container.querySelector('[data-legend-owner="Bob"]');
  assert.ok(bobLegend);

  await user.click(bobLegend);
  const selectedControl = rendered.container.querySelector('[data-focus-mode-control="selected"]');
  assert.ok(selectedControl);
  await user.click(selectedControl);

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

  await user.click(bobLegend);
  await user.click(selectedControl);
  assert.equal(selectedControl.getAttribute('aria-pressed'), 'true');
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

  const laneZeroLabels = rendered.container.querySelectorAll(
    '[aria-label="Games Back shared trend chart"] [data-endpoint-label-lane="0"]'
  );
  const laneOneLabels = rendered.container.querySelectorAll(
    '[aria-label="Games Back shared trend chart"] [data-endpoint-label-lane="1"]'
  );
  assert.ok(laneZeroLabels.length > 0);
  assert.ok(laneOneLabels.length > 0);

  for (const labelGroup of rendered.container.querySelectorAll(
    '[aria-label="Games Back shared trend chart"] [data-endpoint-label-lane]'
  )) {
    const labelX = Number.parseFloat(labelGroup.getAttribute('data-endpoint-label-x') ?? '0');
    const labelY = Number.parseFloat(labelGroup.getAttribute('data-endpoint-label-y') ?? '0');
    assert.ok(labelX > 0);
    assert.ok(labelY >= 10);
  }

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
  const connector = rendered.container.querySelector(
    '[aria-label="Games Back shared trend chart"] [data-label-connector="VeryLongOwnerDisplayName"]'
  );
  assert.ok(connector);
  assert.match(connector.getAttribute('d') ?? '', /M .* L .* L /);
});

test('estimateEndpointLabelWidth scales with text length deterministically', () => {
  assert.equal(estimateEndpointLabelWidth('A 1.0'), 51);
  assert.equal(estimateEndpointLabelWidth('VeryLongOwner 100.0%'), 156);
  assert.ok(estimateEndpointLabelWidth('Long text') > estimateEndpointLabelWidth('Short'));
});

test('deriveEndpointLabelLayout distributes clustered endpoints across lanes without overlap', () => {
  const layout = deriveEndpointLabelLayout({
    entries: [
      { owner: 'A', text: 'A 1.0', endpointX: 280, endpointY: 40, color: '#111' },
      { owner: 'B', text: 'B 1.0', endpointX: 280, endpointY: 42, color: '#222' },
      { owner: 'C', text: 'C 1.0', endpointX: 280, endpointY: 44, color: '#333' },
      { owner: 'D', text: 'D 1.0', endpointX: 280, endpointY: 46, color: '#444' },
    ],
    chartWidth: 280,
    chartHeight: 320,
    labelAreaWidth: 180,
    laneCount: 2,
    minVerticalSpacing: 14,
  });
  assert.equal(layout.length, 4);
  assert.ok(layout.some((entry) => entry.lane === 0));
  assert.ok(layout.some((entry) => entry.lane === 1));

  const byLane = new Map<number, number[]>();
  for (const entry of layout) {
    const current = byLane.get(entry.lane) ?? [];
    current.push(entry.labelY);
    byLane.set(entry.lane, current);
    assert.equal(entry.connectorPoints.length, 3);
    assert.ok(entry.connectorPoints[1]!.x > entry.connectorPoints[0]!.x);
    assert.ok(entry.connectorPoints[2]!.x > entry.connectorPoints[1]!.x);
  }
  for (const yValues of byLane.values()) {
    const sorted = [...yValues].sort((a, b) => a - b);
    for (let index = 1; index < sorted.length; index += 1) {
      assert.ok(sorted[index] - sorted[index - 1] >= 13.9);
    }
  }
});

test('deriveEndpointLabelLayout is deterministic and supports three-lane width-aware placement', () => {
  const entries = [
    { owner: 'Short', text: 'Short 0.4', endpointX: 300, endpointY: 80, color: '#111' },
    { owner: 'MediumOwner', text: 'MediumOwner 0.5', endpointX: 300, endpointY: 82, color: '#222' },
    {
      owner: 'VeryLongOwnerDisplayName',
      text: 'VeryLongO… 0.6',
      endpointX: 300,
      endpointY: 84,
      color: '#333',
    },
    { owner: 'Tiny', text: 'Tiny 0.7', endpointX: 300, endpointY: 86, color: '#444' },
  ];
  const first = deriveEndpointLabelLayout({
    entries,
    chartWidth: 300,
    chartHeight: 320,
    labelAreaWidth: 260,
    laneCount: 3,
    minVerticalSpacing: 14,
  });
  const second = deriveEndpointLabelLayout({
    entries,
    chartWidth: 300,
    chartHeight: 320,
    labelAreaWidth: 260,
    laneCount: 3,
    minVerticalSpacing: 14,
  });
  assert.deepEqual(first, second);
  assert.ok(first.some((entry) => entry.lane === 2));
});

test('selected owner summary still uses standings-derived rank and win metrics', async () => {
  const user = userEvent.setup({ document: dom.window.document });
  const rendered = render(
    <TrendsDetailSurface
      standingsHistory={history}
      season={2026}
      seasonContext="final"
      issues={[]}
    />
  );

  const aliceLegend = rendered.container.querySelector('[data-legend-owner="Alice"]');
  assert.ok(aliceLegend);
  await user.click(aliceLegend);
  const ownerFocus = rendered.container.querySelector('[data-owner-focus="true"]');
  assert.ok(ownerFocus);
  assert.match(ownerFocus.textContent ?? '', /Rank: 1st/);
  assert.match(ownerFocus.textContent ?? '', /Win %: 100.0%/);
});

test('selection helper toggles selected owner deterministically', () => {
  assert.equal(toggleSelectedOwner(null, 'Alice'), 'Alice');
  assert.equal(toggleSelectedOwner('Alice', 'Alice'), null);
  assert.equal(toggleSelectedOwner('Alice', 'Bob'), 'Bob');
});

test('games back chart includes inverted axis domain marker and week ticks', () => {
  const longHistory = buildHistoryWithWeekCount(8);
  const rendered = render(
    <TrendsDetailSurface
      standingsHistory={longHistory}
      season={2026}
      seasonContext="final"
      issues={[]}
    />
  );
  const gamesBackChart = rendered.container.querySelector(
    '[aria-label="Games Back shared trend chart"]'
  );
  assert.ok(gamesBackChart);
  assert.equal(gamesBackChart.getAttribute('data-y-domain'), '[1,0]');
  assert.equal(gamesBackChart.getAttribute('data-label-lane-width'), '176');
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
  for (let week = 1; week <= 8; week += 1) {
    assert.ok(
      rendered.container.querySelector(
        `[aria-label="Games Back shared trend chart"] [data-week-tick="W${week}"]`
      )
    );
    assert.ok(
      rendered.container.querySelector(
        `[aria-label="Games Back shared trend chart"] [data-week-grid-line="W${week}"]`
      )
    );
  }
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

test('deriveAllWeekTicks returns every week label in order', () => {
  const weeks = [1, 2, 3, 4, 5];
  const ticks = deriveAllWeekTicks(weeks);
  assert.deepEqual(
    ticks.map((tick) => tick.value),
    weeks
  );
  assert.deepEqual(
    ticks.map((tick) => tick.label),
    ['W1', 'W2', 'W3', 'W4', 'W5']
  );
});

test('chart auto-scrolls to the most recent week only once on initial mount', () => {
  const longHistory = buildHistoryWithWeekCount(12);
  let gamesBackSetCount = 0;
  let gamesBackScrollLeft = -1;
  const elementPrototype = window.HTMLElement.prototype;
  const originalScrollLeft = Object.getOwnPropertyDescriptor(elementPrototype, 'scrollLeft');
  const originalScrollWidth = Object.getOwnPropertyDescriptor(elementPrototype, 'scrollWidth');
  const originalClientWidth = Object.getOwnPropertyDescriptor(elementPrototype, 'clientWidth');

  Object.defineProperty(elementPrototype, 'scrollWidth', {
    configurable: true,
    get() {
      return 1400;
    },
  });
  Object.defineProperty(elementPrototype, 'clientWidth', {
    configurable: true,
    get() {
      return 600;
    },
  });
  Object.defineProperty(elementPrototype, 'scrollLeft', {
    configurable: true,
    get() {
      return gamesBackScrollLeft;
    },
    set(value: number) {
      if (
        this instanceof window.HTMLElement &&
        this.getAttribute('data-trend-scroll-container') === 'games-back'
      ) {
        gamesBackSetCount += 1;
        gamesBackScrollLeft = value;
      }
    },
  });

  try {
    const rendered = render(
      <TrendsDetailSurface
        standingsHistory={longHistory}
        season={2026}
        seasonContext="final"
        issues={[]}
      />
    );
    assert.equal(gamesBackScrollLeft, 800);
    assert.equal(gamesBackSetCount, 1);

    rendered.rerender(
      <TrendsDetailSurface
        standingsHistory={longHistory}
        season={2026}
        seasonContext="final"
        issues={['non-blocking note']}
      />
    );

    assert.equal(gamesBackSetCount, 1);
  } finally {
    if (originalScrollLeft) {
      Object.defineProperty(elementPrototype, 'scrollLeft', originalScrollLeft);
    }
    if (originalScrollWidth) {
      Object.defineProperty(elementPrototype, 'scrollWidth', originalScrollWidth);
    }
    if (originalClientWidth) {
      Object.defineProperty(elementPrototype, 'clientWidth', originalClientWidth);
    }
  }
});

test('owner color map is deterministic for ordered owners', () => {
  const orderedOwners = ['Alice', 'Bob', 'Carol', 'Dave', 'Eve'];
  const firstMap = buildOwnerColorMap(orderedOwners);
  const secondMap = buildOwnerColorMap(orderedOwners);

  for (const owner of orderedOwners) {
    assert.equal(firstMap.get(owner), secondMap.get(owner));
  }
});

test('owner color map provides distinct colors for top 5 owners', () => {
  const orderedOwners = ['Alice', 'Bob', 'Carol', 'Dave', 'Eve'];
  const colorMap = buildOwnerColorMap(orderedOwners);
  const topFiveColors = orderedOwners.map((owner) => colorMap.get(owner));
  const uniqueColors = new Set(topFiveColors);

  assert.equal(uniqueColors.size, orderedOwners.length);
});

test('getOwnerColor is stable for same owner name', () => {
  assert.equal(getOwnerColor('Alice'), getOwnerColor('Alice'));
});

test('getOwnerColor returns different colors for different owners', () => {
  const colors = ['Alice', 'Bob', 'Carol', 'Dave', 'Eve'].map((n) => getOwnerColor(n));
  const unique = new Set(colors);
  assert.equal(unique.size, 5);
});

test('mobile layout suppresses right-edge labels and adapts chart height', () => {
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
  window.innerWidth = 1024;
  fireEvent(window, new window.Event('resize'));
});

test('compact mode reduces wrapper padding while preserving shared chart interactions', async () => {
  const user = userEvent.setup({ document: dom.window.document });
  const rendered = render(
    <TrendsDetailSurface
      standingsHistory={history}
      season={2026}
      seasonContext="final"
      issues={[]}
      compact
    />
  );

  assert.match(rendered.container.firstElementChild?.getAttribute('class') ?? '', /p-3 sm:p-4/);
  const bobLegend = rendered.container.querySelector('[data-legend-owner="Bob"]');
  assert.ok(bobLegend);
  await user.click(bobLegend);
  assert.ok(rendered.container.querySelector('[data-owner-focus="true"]'));
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

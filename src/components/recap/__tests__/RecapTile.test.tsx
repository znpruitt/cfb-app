import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import React from 'react';
import { JSDOM } from 'jsdom';
import { cleanup, fireEvent, render, within } from '@testing-library/react';

import type { AvailableWeeklyRecapViewModel } from '@/lib/recap/composeWeeklyRecap';
import RecapTile from '../RecapTile';

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

const recap: AvailableWeeklyRecapViewModel = {
  status: 'available',
  week: 1,
  weekLabel: 'Week 1',
  latestGameDate: '2026-09-05',
  headline: 'Alice takes the week at 2–0',
  isIncomplete: false,
  ownerLines: [
    { owner: 'Alice', recordLabel: '2–0', pointsLabel: '55 PF · 38 PA' },
    { owner: 'Bob', recordLabel: '0–1', pointsLabel: '10 PF · 24 PA' },
  ],
  leaderLines: [
    {
      id: 'best-record',
      label: 'Best record',
      value: '2–0',
      context: 'Alice · 55 PF',
    },
    {
      id: 'high-score',
      label: 'High score',
      value: '55',
      context: 'Alice · 2–0 on the week',
    },
    {
      id: 'closest-game',
      label: 'Closest game',
      value: '24–10',
      context: 'Alice over Bob · 14-point margin',
    },
  ],
  tileLeaderLines: [
    {
      id: 'best-record',
      label: 'Best record',
      value: '2–0',
      context: 'Alice · 55 PF',
    },
    {
      id: 'high-score',
      label: 'High score',
      value: '55',
      context: 'Alice · 2–0 on the week',
    },
    {
      id: 'closest-game',
      label: 'Closest game',
      value: '24–10',
      context: 'Alice over Bob · 14-point margin',
    },
    {
      id: 'biggest-riser',
      label: 'Alice',
      value: '▲ 1',
      context: 'Biggest riser · #2 → #1',
      tone: 'positive',
    },
  ],
  movementLines: [
    { owner: 'Alice', direction: 'up', deltaLabel: '▲ 1', shiftLabel: '#2 → #1' },
    { owner: 'Bob', direction: 'down', deltaLabel: '▼ 1', shiftLabel: '#1 → #2' },
  ],
  recordChangeLines: [],
  headToHeadLines: [],
  notableResultLines: [],
  tileHighlights: [
    {
      kind: 'record-change',
      id: 'record-single-season-high-score',
      label: 'Highest Single-Week Score',
      value: '55 pts (2026 Wk 1)',
      context: 'Alice · Through Week 1 · New league record',
    },
    {
      kind: 'game',
      id: 'game-upset',
      label: 'Odds upset',
      detail: 'Won as a +7.5-point underdog',
      winner: { team: 'Texas', owner: 'Alice', score: '31' },
      loser: { team: 'Georgia', owner: 'Bob', score: '17' },
    },
  ],
};

test('recap tile expands its compact week-record grid in normal flow and collapses again', () => {
  const rendered = render(<RecapTile recap={recap} />);

  const tile = rendered.container.querySelector('section');
  assert.ok(tile);
  assert.match(tile.className, /rounded-lg/);
  assert.match(tile.className, /bg-zinc-900/);
  assert.match(rendered.getByText('Week 1').className, /text-zinc-400/);
  assert.equal(rendered.getByText('Weekly recap').getAttribute('aria-hidden'), null);
  assert.equal(rendered.queryByRole('heading', { name: 'Week leaders' }), null);
  assert.equal(rendered.queryByRole('heading', { name: 'Week records' }), null);
  assert.equal(rendered.queryByRole('heading', { name: 'Movement' }), null);
  assert.equal(rendered.queryByRole('heading', { name: 'Week highlights' }), null);

  const expand = rendered.getByRole('button', { name: 'View full recap' });
  assert.equal(expand.getAttribute('aria-expanded'), 'false');
  const panelId = expand.getAttribute('aria-controls');
  assert.ok(panelId);
  const panel = document.getElementById(panelId);
  assert.ok(panel);
  assert.equal(panel.hidden, true);

  fireEvent.click(expand);

  assert.ok(rendered.getByRole('heading', { name: 'Week leaders' }));
  assert.ok(rendered.getByText('Biggest riser · #2 → #1'));
  assert.ok(rendered.getByRole('heading', { name: 'Week records' }));
  assert.ok(rendered.getByRole('heading', { name: 'Week 1 movement' }));
  assert.ok(rendered.getByText('#2 → #1'));
  assert.ok(rendered.getByLabelText('Moved up in standings'));
  assert.ok(rendered.getByRole('heading', { name: 'Week highlights' }));
  assert.ok(rendered.getByText('Highest Single-Week Score'));
  assert.ok(rendered.getByText('Won as a +7.5-point underdog'));
  assert.match(rendered.getByText('55 PF · 38 PA').className, /text-zinc-400/);
  assert.equal(panel.hidden, false);
  const collapse = rendered.getByRole('button', { name: 'Collapse' });
  assert.equal(collapse.getAttribute('aria-expanded'), 'true');
  assert.match(rendered.container.innerHTML, /grid-cols-2/);
  assert.match(rendered.container.innerHTML, /min-\[821px\]:grid-cols-4/);
  assert.doesNotMatch(rendered.container.innerHTML, /sm:grid-cols-4/);
  assert.match(rendered.container.innerHTML, /text-\[13\.5px\]/);
  assert.match(rendered.container.innerHTML, /py-\[6px\]/);
  const recordsSection = rendered.getByRole('heading', { name: 'Week records' }).closest('section');
  assert.ok(recordsSection);
  assert.match(within(recordsSection).getByText('2–0').className, /shrink-0/);
  assert.equal(rendered.queryByText('Notable results'), null);
  assert.equal(rendered.queryByText('Head-to-head'), null);

  const leadersHeading = rendered.getByRole('heading', { name: 'Week leaders' });
  const movementHeading = rendered.getByRole('heading', { name: 'Week 1 movement' });
  assert.notEqual(leadersHeading.id, movementHeading.id);

  fireEvent.click(collapse);
  assert.equal(panel.hidden, true);
});

test('zero-results tile shows only the factual empty line below its header', () => {
  const rendered = render(<RecapTile recap={{ ...recap, headline: null, ownerLines: [] }} />);

  assert.ok(rendered.getByText('No completed results were recorded for this week.'));
  assert.equal(rendered.getByText('Weekly recap').getAttribute('aria-hidden'), 'true');
  assert.equal(rendered.queryByRole('button'), null);
  assert.equal(rendered.queryByRole('heading', { name: 'Week records' }), null);
  assert.equal(rendered.queryByRole('list'), null);
});

test('record dividers stop at the final responsive grid row', () => {
  const ownerLines = Array.from({ length: 7 }, (_, index) => ({
    owner: `Owner ${index + 1}`,
    recordLabel: '1–0',
    pointsLabel: '24 PF · 17 PA',
  }));
  const rendered = render(<RecapTile recap={{ ...recap, ownerLines }} />);
  fireEvent.click(rendered.getByRole('button', { name: 'View full recap' }));

  const recordsSection = rendered.getByRole('heading', { name: 'Week records' }).closest('section');
  assert.ok(recordsSection);
  const rows = within(recordsSection).getAllByRole('listitem');
  assert.match(rows[3]!.className, /border-b-\[0\.5px\]/);
  assert.match(rows[3]!.className, /min-\[821px\]:border-b-\[0\.5px\]/);
  assert.match(rows[4]!.className, /border-b-\[0\.5px\]/);
  assert.match(rows[4]!.className, /min-\[821px\]:border-b-0/);
  assert.match(rows[6]!.className, /border-b-0/);
  assert.match(rows[6]!.className, /min-\[821px\]:border-b-0/);
});

test('a populated incomplete recap keeps a visible factual headline', () => {
  const rendered = render(
    <RecapTile recap={{ ...recap, headline: 'Week 1 results', isIncomplete: true }} />
  );

  assert.ok(rendered.getByRole('heading', { name: 'Week 1 results' }));
  assert.ok(rendered.getByRole('button', { name: 'View full recap' }));
  const notice = rendered.getByText(
    'This recap reflects the completed results currently available.'
  );
  const panel = notice.closest('div[id]') as HTMLDivElement | null;
  assert.ok(panel);
  assert.equal(panel.hidden, true);

  fireEvent.click(rendered.getByRole('button', { name: 'View full recap' }));
  assert.equal(panel.hidden, false);
  fireEvent.click(rendered.getByRole('button', { name: 'Collapse' }));
});

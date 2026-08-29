import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import React from 'react';
import { JSDOM } from 'jsdom';
import { cleanup, fireEvent, render } from '@testing-library/react';

import type { AvailableWeeklyRecapViewModel } from '@/lib/recap/composeWeeklyRecap';
import type { OverviewContext, OwnerMatchupMatrix } from '@/lib/overview';
import type { StandingsCoverage } from '@/lib/standings';

import OverviewPanel from '../../OverviewPanel';
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
};

const overviewContext: OverviewContext = {
  scopeLabel: 'League',
  scopeDetail: 'Week 1',
  emphasis: 'upcoming',
  highlightsTitle: 'What matters next',
  highlightsDescription: 'Upcoming league games.',
  liveDescription: 'Live games move first.',
  sectionOrder: ['highlights', 'standings', 'matrix', 'live'],
};

const matchupMatrix: OwnerMatchupMatrix = { owners: [], rows: [] };
const standingsCoverage: StandingsCoverage = { state: 'complete', message: null };

test('recap tile expands its compact week-record grid in normal flow and collapses again', () => {
  const rendered = render(<RecapTile recap={recap} />);

  const tile = rendered.container.querySelector('section');
  assert.ok(tile);
  assert.match(tile.className, /rounded-lg/);
  assert.match(tile.className, /bg-zinc-900/);
  assert.match(rendered.getByText('Week 1').className, /text-zinc-400/);
  assert.equal(rendered.getByText('Weekly recap').getAttribute('aria-hidden'), null);
  assert.equal(rendered.queryByRole('heading', { name: 'Week records' }), null);

  const expand = rendered.getByRole('button', { name: 'View full recap' });
  assert.equal(expand.getAttribute('aria-expanded'), 'false');
  const panelId = expand.getAttribute('aria-controls');
  assert.ok(panelId);
  const panel = document.getElementById(panelId);
  assert.ok(panel);
  assert.equal(panel.hidden, true);

  fireEvent.click(expand);

  assert.ok(rendered.getByRole('heading', { name: 'Week records' }));
  assert.match(rendered.getByText('55 PF · 38 PA').className, /text-zinc-400/);
  assert.equal(panel.hidden, false);
  const collapse = rendered.getByRole('button', { name: 'Collapse' });
  assert.equal(collapse.getAttribute('aria-expanded'), 'true');
  assert.match(rendered.container.innerHTML, /grid-cols-2/);
  assert.match(rendered.container.innerHTML, /min-\[821px\]:grid-cols-4/);
  assert.doesNotMatch(rendered.container.innerHTML, /sm:grid-cols-4/);
  assert.match(rendered.container.innerHTML, /text-\[13\.5px\]/);
  assert.match(rendered.container.innerHTML, /py-\[6px\]/);
  assert.match(rendered.getByText('2–0').className, /shrink-0/);

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

test('a populated incomplete recap keeps a visible factual headline', () => {
  const rendered = render(
    <RecapTile recap={{ ...recap, headline: 'Week 1 results', isIncomplete: true }} />
  );

  assert.ok(rendered.getByRole('heading', { name: 'Week 1 results' }));
  assert.ok(rendered.getByRole('button', { name: 'View full recap' }));
});

test('Overview mounts the recap tile as the first item in the podium flow', () => {
  const rendered = render(
    <OverviewPanel
      standingsLeaders={[]}
      standingsCoverage={standingsCoverage}
      matchupMatrix={matchupMatrix}
      liveItems={[]}
      keyMatchups={[]}
      context={overviewContext}
      weeklyRecap={recap}
    />
  );

  const root = rendered.container.firstElementChild;
  const tile = rendered.getByText('Weekly recap').closest('section');
  assert.ok(root);
  assert.ok(tile);
  assert.equal(root.firstElementChild, tile);
});

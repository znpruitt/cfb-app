import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import React from 'react';
import { JSDOM } from 'jsdom';
import { cleanup, fireEvent, render } from '@testing-library/react';

import AllTimeStandingsTable from '../history/AllTimeStandingsTable';
import type { AllTimeStandingRow } from '../../lib/selectors/historySelectors';

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

const rows: AllTimeStandingRow[] = [
  {
    owner: 'Whited',
    totalWins: 30,
    totalLosses: 6,
    winPct: 30 / 36,
    championships: 2,
    seasonsPlayed: 3,
    avgFinish: 1.0,
    totalPointDifferential: 240,
  },
  {
    owner: 'Pruitt',
    totalWins: 28,
    totalLosses: 8,
    winPct: 28 / 36,
    championships: 1,
    seasonsPlayed: 3,
    avgFinish: 2.0,
    totalPointDifferential: 180,
  },
  {
    owner: 'Hardiman',
    totalWins: 5,
    totalLosses: 31,
    winPct: 5 / 36,
    championships: 0,
    seasonsPlayed: 3,
    avgFinish: 13.0,
    totalPointDifferential: -260,
  },
];

const activeOwners = ['Whited', 'Pruitt'];

function rankCellsInOrder(container: HTMLElement): string[] {
  const cells = container.querySelectorAll('tbody tr td:first-child');
  return Array.from(cells).map((cell) => cell.textContent?.trim() ?? '');
}

test('AllTimeStandingsTable preserves true rank in default All filter', () => {
  const rendered = render(
    <AllTimeStandingsTable rows={rows} slug="tsc" activeOwners={activeOwners} />
  );
  assert.deepEqual(rankCellsInOrder(rendered.container), ['1', '2', '3']);
});

test('AllTimeStandingsTable preserves rank when filtered to Active only (no renumbering)', () => {
  const rendered = render(
    <AllTimeStandingsTable rows={rows} slug="tsc" activeOwners={activeOwners} />
  );

  const activeButton = Array.from(rendered.container.querySelectorAll('button')).find(
    (b) => b.textContent === 'Active'
  );
  assert.ok(activeButton, 'Active filter button should exist');
  fireEvent.click(activeButton);

  // Hardiman (rank 3, former) is hidden; Whited and Pruitt keep ranks 1 and 2.
  assert.deepEqual(rankCellsInOrder(rendered.container), ['1', '2']);
});

test('AllTimeStandingsTable preserves rank when filtered to Former only (true rank shown)', () => {
  const rendered = render(
    <AllTimeStandingsTable rows={rows} slug="tsc" activeOwners={activeOwners} />
  );

  const formerButton = Array.from(rendered.container.querySelectorAll('button')).find(
    (b) => b.textContent === 'Former'
  );
  assert.ok(formerButton, 'Former filter button should exist');
  fireEvent.click(formerButton);

  // Only Hardiman shown — at rank 3 (their true all-time position), not renumbered to 1.
  assert.deepEqual(rankCellsInOrder(rendered.container), ['3']);
});

test('AllTimeStandingsTable does not render filter UI when activeOwners undefined', () => {
  const rendered = render(<AllTimeStandingsTable rows={rows} slug="tsc" />);
  const filterButtons = Array.from(rendered.container.querySelectorAll('button')).filter((b) => {
    const text = b.textContent?.trim();
    return text === 'All' || text === 'Active' || text === 'Former';
  });
  assert.equal(filterButtons.length, 0);
});

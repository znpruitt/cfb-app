import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import React from 'react';
import { JSDOM } from 'jsdom';
import { cleanup, fireEvent, render } from '@testing-library/react';

import { RecordEventList } from '../RecordEventList';
import type { RankedRecord } from '@/lib/selectors/leagueRecords';

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

function makeEventRecord(): RankedRecord {
  return {
    id: 'closest_title_race',
    label: 'Closest Title Race',
    category: 'event',
    rows: [
      {
        rank: 1,
        owners: ['Alice', 'Bob'],
        value: 0.5,
        formattedValue: '0.5 GB',
        contextString: '2024 season',
        isFormer: false,
        champion: 'Alice',
        runnerUp: 'Bob',
      },
      {
        rank: 2,
        owners: ['Charlie', 'Dave'],
        value: 1.2,
        formattedValue: '1.2 GB',
        contextString: '2023 season',
        isFormer: false,
        champion: 'Charlie',
        runnerUp: 'Dave',
      },
      {
        rank: 3,
        owners: ['Eve', 'Frank'],
        value: 2.0,
        formattedValue: '2.0 GB',
        contextString: '2022 season',
        isFormer: false,
        champion: 'Eve',
        runnerUp: 'Frank',
      },
      {
        rank: 4,
        owners: ['Grace', 'Henry'],
        value: 4.0,
        formattedValue: '4.0 GB',
        contextString: '2021 season',
        isFormer: false,
        champion: 'Grace',
        runnerUp: 'Henry',
      },
    ],
  };
}

function podiumCells(container: HTMLElement): NodeListOf<Element> {
  return container.querySelectorAll('[data-testid="podium-cell"]');
}

function overflowList(container: HTMLElement): Element | null {
  return container.querySelector('[data-testid="record-overflow"]');
}

test('RecordEventList: renders 3 podium cells by default', () => {
  const { container } = render(<RecordEventList record={makeEventRecord()} />);
  const cells = podiumCells(container);
  assert.equal(cells.length, 3);
});

test('RecordEventList: no Active-only toggle is rendered', () => {
  const { queryByRole } = render(<RecordEventList record={makeEventRecord()} />);
  assert.equal(queryByRole('switch'), null);
});

test('RecordEventList: Show all reveals the overflow list (single-column)', () => {
  const { container, getByRole } = render(<RecordEventList record={makeEventRecord()} />);
  fireEvent.click(getByRole('button', { name: /Show all/ }));
  const overflow = overflowList(container);
  assert.ok(overflow);
  const items = overflow!.querySelectorAll('li');
  assert.equal(items.length, 1);
  assert.match(items[0]!.textContent ?? '', /Grace/);
});

test('RecordEventList: emits article with id matching record.id and scroll-mt class', () => {
  const { container } = render(<RecordEventList record={makeEventRecord()} />);
  const article = container.querySelector('article');
  assert.ok(article);
  assert.equal(article!.getAttribute('id'), 'closest_title_race');
  assert.match(article!.getAttribute('class') ?? '', /scroll-mt-/);
});

test('RecordEventList: empty record renders the placeholder spanning podium columns', () => {
  const empty: RankedRecord = {
    id: 'biggest_collapse',
    label: 'Biggest Season Collapse',
    category: 'event',
    rows: [],
  };
  const { container, queryByRole } = render(<RecordEventList record={empty} />);
  const placeholder = container.querySelector('[data-testid="record-empty"]');
  assert.ok(placeholder);
  assert.match(placeholder!.textContent ?? '', /No events yet/);
  assert.equal(queryByRole('button'), null);
});

test('RecordEventList: closest_title_race renders "{champion} over {runnerUp}"', () => {
  const record: RankedRecord = {
    id: 'closest_title_race',
    label: 'Closest Title Race',
    category: 'event',
    rows: [
      {
        rank: 1,
        owners: ['Pruitt', 'Whited'],
        value: 0.5,
        formattedValue: '0.5 GB',
        contextString: '2024 season',
        isFormer: false,
        champion: 'Whited',
        runnerUp: 'Pruitt',
      },
    ],
  };
  const { container } = render(<RecordEventList record={record} />);
  assert.match(container.textContent ?? '', /Whited over Pruitt/);
});

test('RecordEventList: biggest_collapse renders "{owner} finished Xth, then Yth"', () => {
  const record: RankedRecord = {
    id: 'biggest_collapse',
    label: 'Biggest Season Collapse',
    category: 'event',
    rows: [
      {
        rank: 1,
        owners: ['Alice'],
        value: 8,
        formattedValue: '8 spots',
        contextString: '2024→2025',
        isFormer: false,
        fromRank: 3,
        toRank: 11,
      },
    ],
  };
  const { container } = render(<RecordEventList record={record} />);
  assert.match(container.textContent ?? '', /Alice finished 3rd, then 11th/);
});

test('RecordEventList: biggest_climb renders "{owner} finished Xth, then Yth" with reversed direction', () => {
  const record: RankedRecord = {
    id: 'biggest_climb',
    label: 'Biggest Season Climb',
    category: 'event',
    rows: [
      {
        rank: 1,
        owners: ['Bob'],
        value: 8,
        formattedValue: '8 spots',
        contextString: '2022→2023',
        isFormer: false,
        fromRank: 9,
        toRank: 1,
      },
    ],
  };
  const { container } = render(<RecordEventList record={record} />);
  assert.match(container.textContent ?? '', /Bob finished 9th, then 1st/);
});

test('RecordEventList: tied event rows with identical rank+contextString but different owners render distinctly', () => {
  const record: RankedRecord = {
    id: 'biggest_collapse',
    label: 'Biggest Season Collapse',
    category: 'event',
    rows: [
      {
        rank: 1,
        owners: ['Alice'],
        value: 2,
        formattedValue: '2 spots',
        contextString: '2023→2024',
        isFormer: false,
        fromRank: 1,
        toRank: 3,
      },
      {
        rank: 1,
        owners: ['Bob'],
        value: 2,
        formattedValue: '2 spots',
        contextString: '2023→2024',
        isFormer: false,
        fromRank: 4,
        toRank: 6,
      },
    ],
  };
  const { container } = render(<RecordEventList record={record} />);
  const cells = podiumCells(container);
  assert.equal(cells.length, 2, 'both tied rows must render — pre-fix collapsed to one');
  assert.match(cells[0]!.textContent ?? '', /Alice/);
  assert.match(cells[1]!.textContent ?? '', /Bob/);
});

test('RecordEventList: podium tint persists on rank 1/2/3 when Show all is expanded', () => {
  const { container, getByRole } = render(<RecordEventList record={makeEventRecord()} />);
  fireEvent.click(getByRole('button', { name: /Show all/ }));
  const years = container.querySelectorAll('[data-testid="event-year"]');
  assert.equal(years.length, 3, 'podium years still rendered when expanded');
  assert.match(years[0]!.className, /yellow-600|amber-300/);
  assert.match(years[1]!.className, /slate-500|slate-200/);
  assert.match(years[2]!.className, /orange-900|d4915c/);
});

test('RecordEventList: podium event-year cell holds only the contextString — no holders leakage', () => {
  // Structural assertion that the year cell and holders cell are separate DOM
  // nodes; year text doesn't appear inside the holders span.
  const record: RankedRecord = {
    id: 'biggest_collapse',
    label: 'Biggest Season Collapse',
    category: 'event',
    rows: [
      {
        rank: 1,
        owners: ['Jordan'],
        value: 8,
        formattedValue: '8 spots',
        contextString: '2024→2025',
        isFormer: false,
        fromRank: 4,
        toRank: 12,
      },
    ],
  };
  const { container } = render(<RecordEventList record={record} />);
  const yearCell = container.querySelector('[data-testid="event-year"]');
  assert.ok(yearCell);
  assert.equal(yearCell!.textContent, '2024→2025');
  // Holders text appears in the cell but in a separate span, not concatenated
  const cell = container.querySelector('[data-testid="podium-cell"]');
  assert.ok(cell);
  assert.match(cell!.textContent ?? '', /Jordan finished 4th, then 12th/);
});

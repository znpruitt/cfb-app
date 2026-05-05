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
      },
      {
        rank: 2,
        owners: ['Charlie', 'Dave'],
        value: 1.2,
        formattedValue: '1.2 GB',
        contextString: '2023 season',
        isFormer: false,
      },
      {
        rank: 3,
        owners: ['Eve', 'Frank'],
        value: 2.0,
        formattedValue: '2.0 GB',
        contextString: '2022 season',
        isFormer: false,
      },
      {
        rank: 4,
        owners: ['Grace', 'Henry'],
        value: 4.0,
        formattedValue: '4.0 GB',
        contextString: '2021 season',
        isFormer: false,
      },
    ],
  };
}

test('RecordEventList: renders top 3 (podium) by default', () => {
  const { container } = render(<RecordEventList record={makeEventRecord()} />);
  const items = container.querySelectorAll('li');
  assert.equal(items.length, 3);
});

test('RecordEventList: no toggle is rendered', () => {
  const { queryByRole } = render(<RecordEventList record={makeEventRecord()} />);
  assert.equal(queryByRole('switch'), null);
});

test('RecordEventList: Show all expands to full event list', () => {
  const { container, getByRole } = render(<RecordEventList record={makeEventRecord()} />);
  fireEvent.click(getByRole('button', { name: /Show all 4/ }));
  const items = container.querySelectorAll('li');
  assert.equal(items.length, 4);
});

test('RecordEventList: emits article with id matching record.id (hash anchor target)', () => {
  const { container } = render(<RecordEventList record={makeEventRecord()} />);
  const article = container.querySelector('article');
  assert.ok(article);
  assert.equal(article!.getAttribute('id'), 'closest_title_race');
});

test('RecordEventList: empty rows renders "No events yet" message', () => {
  const empty: RankedRecord = {
    id: 'biggest_collapse',
    label: 'Biggest Season Collapse',
    category: 'event',
    rows: [],
  };
  const { container, queryByRole } = render(<RecordEventList record={empty} />);
  assert.match(container.textContent ?? '', /No events yet/);
  // No Show all button when there are no rows
  assert.equal(queryByRole('button'), null);
});

import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import React from 'react';
import { JSDOM } from 'jsdom';
import { cleanup, fireEvent, render } from '@testing-library/react';

import { RecordRanking } from '../RecordRanking';
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

function makeRecord(overrides: Partial<RankedRecord> = {}): RankedRecord {
  return {
    id: 'career_points',
    label: 'Career Points',
    category: 'career',
    rows: [
      { rank: 1, owners: ['Alice'], value: 3000, formattedValue: '3,000 pts', isFormer: false },
      { rank: 2, owners: ['Bob'], value: 2500, formattedValue: '2,500 pts', isFormer: false },
      { rank: 3, owners: ['Charlie'], value: 2000, formattedValue: '2,000 pts', isFormer: true },
      { rank: 4, owners: ['Dave'], value: 1500, formattedValue: '1,500 pts', isFormer: false },
    ],
    ...overrides,
  };
}

test('RecordRanking: renders podium (top 3) by default', () => {
  const { container } = render(<RecordRanking record={makeRecord()} />);
  const items = container.querySelectorAll('li');
  assert.equal(items.length, 3);
  assert.match(items[0]!.textContent ?? '', /Alice/);
  assert.match(items[2]!.textContent ?? '', /Charlie/);
});

test('RecordRanking: Show all expands to full ranking', () => {
  const { container, getByRole } = render(<RecordRanking record={makeRecord()} />);
  const button = getByRole('button', { name: /Show all 4/ });
  fireEvent.click(button);
  const items = container.querySelectorAll('li');
  assert.equal(items.length, 4);
  assert.match(items[3]!.textContent ?? '', /Dave/);
});

test('RecordRanking: ActiveOnlyToggle filters out former owners', () => {
  const { container, getByRole } = render(<RecordRanking record={makeRecord()} />);
  const toggle = getByRole('switch');
  fireEvent.click(toggle);
  // Former Charlie removed; podium becomes [Alice, Bob, Dave]
  const items = container.querySelectorAll('li');
  assert.equal(items.length, 3);
  assert.equal(
    [...items].some((el) => /Charlie/.test(el.textContent ?? '')),
    false
  );
});

test('RecordRanking: lockedActiveOnly hides toggle and pre-filters formers', () => {
  const { container, queryByRole } = render(
    <RecordRanking record={makeRecord()} lockedActiveOnly />
  );
  // No toggle rendered
  assert.equal(queryByRole('switch'), null);
  // Formers pre-filtered
  const items = container.querySelectorAll('li');
  assert.equal(items.length, 3);
  assert.equal(
    [...items].some((el) => /Charlie/.test(el.textContent ?? '')),
    false
  );
});

test('RecordRanking: qualifierNote renders when provided', () => {
  const { container } = render(
    <RecordRanking record={makeRecord()} qualifierNote="Min. 3 seasons — Hardiman excluded" />
  );
  assert.match(container.textContent ?? '', /Min\. 3 seasons — Hardiman excluded/);
});

test('RecordRanking: tied rank renders T-N prefix', () => {
  const tiedRecord = makeRecord({
    rows: [
      { rank: 1, owners: ['Alice'], value: 100, formattedValue: '100', isFormer: false },
      { rank: 1, owners: ['Bob'], value: 100, formattedValue: '100', isFormer: false },
      { rank: 3, owners: ['Charlie'], value: 90, formattedValue: '90', isFormer: false },
    ],
  });
  const { container } = render(<RecordRanking record={tiedRecord} />);
  const items = container.querySelectorAll('li');
  assert.match(items[0]!.textContent ?? '', /T-1/);
  assert.match(items[1]!.textContent ?? '', /T-1/);
  // Rank 3 (untied) renders as plain "3"
  assert.match(items[2]!.textContent ?? '', /^3/);
});

test('RecordRanking: emits article with id matching record.id (hash anchor target)', () => {
  const { container } = render(<RecordRanking record={makeRecord({ id: 'career_titles' })} />);
  const article = container.querySelector('article');
  assert.ok(article);
  assert.equal(article!.getAttribute('id'), 'career_titles');
  assert.match(article!.getAttribute('class') ?? '', /scroll-mt-/);
});

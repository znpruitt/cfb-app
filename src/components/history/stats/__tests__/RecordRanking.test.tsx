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

function podiumCells(container: HTMLElement): NodeListOf<Element> {
  return container.querySelectorAll('[data-testid="podium-cell"]');
}

function overflowList(container: HTMLElement): Element | null {
  return container.querySelector('[data-testid="record-overflow"]');
}

test('RecordRanking: renders 3 podium cells by default (no overflow visible)', () => {
  const { container } = render(<RecordRanking record={makeRecord()} />);
  const cells = podiumCells(container);
  assert.equal(cells.length, 3);
  assert.match(cells[0]!.textContent ?? '', /Alice/);
  assert.match(cells[2]!.textContent ?? '', /Charlie/);
  // No overflow rendered while collapsed
  assert.equal(overflowList(container), null);
});

test('RecordRanking: Show all reveals the overflow list (single column, top-to-bottom)', () => {
  const { container, getByRole } = render(<RecordRanking record={makeRecord()} />);
  fireEvent.click(getByRole('button', { name: /Show all/ }));
  const overflow = overflowList(container);
  assert.ok(overflow, 'overflow list should be rendered after Show all');
  const items = overflow!.querySelectorAll('li');
  assert.equal(items.length, 1, 'rank 4+ rendered in single-column list');
  assert.match(items[0]!.textContent ?? '', /Dave/);
});

test('RecordRanking: Show all toggles button label between "Show all" and "Hide"', () => {
  const { getByRole, container } = render(<RecordRanking record={makeRecord()} />);
  const button = getByRole('button', { name: /Show all/ });
  fireEvent.click(button);
  assert.match(container.textContent ?? '', /Hide/);
  fireEvent.click(getByRole('button', { name: /Hide/ }));
  assert.match(container.textContent ?? '', /Show all/);
});

test('RecordRanking: ActiveOnlyToggle filters out former owners from the podium', () => {
  const { container, getByRole } = render(<RecordRanking record={makeRecord()} />);
  fireEvent.click(getByRole('switch'));
  // Former Charlie removed; new podium becomes [Alice, Bob, Dave]
  const cells = podiumCells(container);
  assert.equal(cells.length, 3);
  assert.equal(
    [...cells].some((el) => /Charlie/.test(el.textContent ?? '')),
    false
  );
});

test('RecordRanking: lockedActiveOnly hides toggle and pre-filters formers', () => {
  const { container, queryByRole } = render(
    <RecordRanking record={makeRecord()} lockedActiveOnly />
  );
  // No toggle rendered
  assert.equal(queryByRole('switch'), null);
  // Italic "Active only" label appears in the actions cell
  assert.match(container.textContent ?? '', /Active only/);
  // Formers pre-filtered
  const cells = podiumCells(container);
  assert.equal(
    [...cells].some((el) => /Charlie/.test(el.textContent ?? '')),
    false
  );
});

test('RecordRanking: qualifierNote prop renders verbatim below the label', () => {
  // qualifierNote is a generic prop the component renders inside
  // [data-testid="record-qualifier"]. No production records currently set
  // this prop — the test uses a synthetic fixture string to verify the prop
  // pathway stays intact for any future records that opt in.
  const SYNTHETIC = 'Test qualifier — eligibility note';
  const { container } = render(<RecordRanking record={makeRecord()} qualifierNote={SYNTHETIC} />);
  const qualifier = container.querySelector('[data-testid="record-qualifier"]');
  assert.ok(qualifier);
  assert.equal(qualifier!.textContent, SYNTHETIC);
});

test('RecordRanking: tied podium ranks render T-N prefix', () => {
  const tiedRecord = makeRecord({
    rows: [
      { rank: 1, owners: ['Alice'], value: 100, formattedValue: '100', isFormer: false },
      { rank: 1, owners: ['Bob'], value: 100, formattedValue: '100', isFormer: false },
      { rank: 3, owners: ['Charlie'], value: 90, formattedValue: '90', isFormer: false },
    ],
  });
  const { container } = render(<RecordRanking record={tiedRecord} />);
  const ranks = container.querySelectorAll('[data-testid="podium-rank"]');
  assert.match(ranks[0]!.textContent ?? '', /T-1/);
  assert.match(ranks[1]!.textContent ?? '', /T-1/);
  assert.match(ranks[2]!.textContent ?? '', /^3$/); // untied rank renders bare
});

test('RecordRanking: emits article with id matching record.id and scroll-mt class', () => {
  const { container } = render(<RecordRanking record={makeRecord({ id: 'career_titles' })} />);
  const article = container.querySelector('article');
  assert.ok(article);
  assert.equal(article!.getAttribute('id'), 'career_titles');
  assert.match(article!.getAttribute('class') ?? '', /scroll-mt-/);
});

test('RecordRanking: podium tint persists on rank 1/2/3 when Show all is expanded', () => {
  const fiveRow = makeRecord({
    rows: [
      { rank: 1, owners: ['A'], value: 50, formattedValue: '50', isFormer: false },
      { rank: 2, owners: ['B'], value: 40, formattedValue: '40', isFormer: false },
      { rank: 3, owners: ['C'], value: 30, formattedValue: '30', isFormer: false },
      { rank: 4, owners: ['D'], value: 20, formattedValue: '20', isFormer: false },
      { rank: 5, owners: ['E'], value: 10, formattedValue: '10', isFormer: false },
    ],
  });
  const { container, getByRole } = render(<RecordRanking record={fiveRow} />);
  fireEvent.click(getByRole('button', { name: /Show all/ }));
  // Rank tints in the (still-rendered) podium cells
  const ranks = container.querySelectorAll('[data-testid="podium-rank"]');
  assert.equal(ranks.length, 3);
  assert.match(ranks[0]!.className, /yellow-600|amber-300/, 'rank 1 keeps gold');
  assert.match(ranks[1]!.className, /slate-500|slate-200/, 'rank 2 keeps silver');
  assert.match(ranks[2]!.className, /orange-900|d4915c/, 'rank 3 keeps bronze');
});

test('RecordRanking: tied podium ranks all receive their rank-tint', () => {
  const tied = makeRecord({
    rows: [
      { rank: 1, owners: ['Alice'], value: 100, formattedValue: '100', isFormer: false },
      { rank: 1, owners: ['Bob'], value: 100, formattedValue: '100', isFormer: false },
      { rank: 3, owners: ['Charlie'], value: 80, formattedValue: '80', isFormer: false },
    ],
  });
  const { container } = render(<RecordRanking record={tied} />);
  const ranks = container.querySelectorAll('[data-testid="podium-rank"]');
  // T-1 / T-1 / 3 — both T-1 rows get gold; rank 3 row gets bronze
  assert.match(ranks[0]!.className, /yellow-600|amber-300/);
  assert.match(ranks[1]!.className, /yellow-600|amber-300/);
  assert.match(ranks[2]!.className, /orange-900|d4915c/);
});

test('RecordRanking: empty record renders the placeholder line spanning podium columns', () => {
  const empty = makeRecord({ rows: [] });
  const { container } = render(<RecordRanking record={empty} />);
  const placeholder = container.querySelector('[data-testid="record-empty"]');
  assert.ok(placeholder);
  assert.match(placeholder!.textContent ?? '', /No qualifying entries/);
  // No podium cells when empty
  assert.equal(podiumCells(container).length, 0);
});

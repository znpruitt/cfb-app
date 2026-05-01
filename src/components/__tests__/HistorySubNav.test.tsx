import assert from 'node:assert/strict';
import test from 'node:test';

import { getActiveSubtab } from '../history/HistorySubNav.tsx';

const BASE = '/league/tsc/history';

test('getActiveSubtab: returns overview for exact base path', () => {
  assert.equal(getActiveSubtab(BASE, BASE), 'overview');
});

test('getActiveSubtab: returns overview for base path with trailing slash', () => {
  assert.equal(getActiveSubtab(`${BASE}/`, BASE), 'overview');
});

test('getActiveSubtab: returns stats for /history/stats', () => {
  assert.equal(getActiveSubtab(`${BASE}/stats`, BASE), 'stats');
});

test('getActiveSubtab: returns stats for /history/stats/ with trailing slash', () => {
  assert.equal(getActiveSubtab(`${BASE}/stats/`, BASE), 'stats');
});

test('getActiveSubtab: returns rivalries for /history/rivalries', () => {
  assert.equal(getActiveSubtab(`${BASE}/rivalries`, BASE), 'rivalries');
});

test('getActiveSubtab: returns archive for /history/archive', () => {
  assert.equal(getActiveSubtab(`${BASE}/archive`, BASE), 'archive');
});

test('getActiveSubtab: returns overview for year sub-page /history/2025', () => {
  assert.equal(getActiveSubtab(`${BASE}/2025`, BASE), 'overview');
});

test('getActiveSubtab: returns overview for owner sub-page /history/owner/Pruitt', () => {
  assert.equal(getActiveSubtab(`${BASE}/owner/Pruitt`, BASE), 'overview');
});

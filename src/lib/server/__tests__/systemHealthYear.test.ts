/**
 * PLATFORM-086F2G — operational-season resolution. System Health is not a
 * historical browser: the year is resolved server-side from league lifecycle
 * state and is never caller-selected (the function takes no requested year).
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveOperationalSeasonYear } from '../systemHealthYear.ts';
import type { League } from '../../league.ts';

const NOW = Date.parse('2026-10-15T12:00:00.000Z'); // current UTC year 2026 → max 2027

function league(overrides: Partial<League>): League {
  return {
    slug: overrides.slug ?? 'l',
    name: 'League',
    year: 2020,
    createdAt: '2020-01-01T00:00:00.000Z',
    ...overrides,
  } as League;
}

test('an active season league selects its status.year', () => {
  const leagues = [league({ slug: 'a', year: 2020, status: { state: 'season', year: 2026 } })];
  assert.equal(resolveOperationalSeasonYear({ leagues, nowMs: NOW }), 2026);
});

test('a preseason league selects its status.year', () => {
  const leagues = [league({ slug: 'a', year: 2020, status: { state: 'preseason', year: 2027 } })];
  assert.equal(resolveOperationalSeasonYear({ leagues, nowMs: NOW }), 2027);
});

test('status.year wins over a conflicting top-level league.year', () => {
  const leagues = [league({ slug: 'a', year: 2019, status: { state: 'season', year: 2026 } })];
  assert.equal(resolveOperationalSeasonYear({ leagues, nowMs: NOW }), 2026);
});

test('multiple operational years → highest status.year', () => {
  const leagues = [
    league({ slug: 'a', status: { state: 'season', year: 2025 } }),
    league({ slug: 'b', status: { state: 'preseason', year: 2026 } }),
  ];
  assert.equal(resolveOperationalSeasonYear({ leagues, nowMs: NOW }), 2026);
});

test('no active/preseason league → highest stored league.year', () => {
  const leagues = [
    league({ slug: 'a', year: 2024, status: { state: 'offseason' } }),
    league({ slug: 'b', year: 2023 }),
  ];
  assert.equal(resolveOperationalSeasonYear({ leagues, nowMs: NOW }), 2024);
});

test('no leagues → calendar season-for-today fallback', () => {
  // 2026-10-15 (month ≥ July) → 2026.
  assert.equal(resolveOperationalSeasonYear({ leagues: [], nowMs: NOW }), 2026);
});

test('result is clamped to current UTC year + 1', () => {
  const leagues = [league({ slug: 'a', status: { state: 'season', year: 3000 } })];
  assert.equal(resolveOperationalSeasonYear({ leagues, nowMs: NOW }), 2027);
});

test('resolution is independent of any caller input (no requested-year parameter exists)', () => {
  // The function signature accepts only { leagues, nowMs }; a would-be ?year= has
  // nowhere to enter. Same leagues + clock always yield the same operational year.
  const leagues = [league({ slug: 'a', status: { state: 'season', year: 2026 } })];
  const a = resolveOperationalSeasonYear({ leagues, nowMs: NOW });
  const b = resolveOperationalSeasonYear({ leagues, nowMs: NOW });
  assert.equal(a, 2026);
  assert.equal(b, 2026);
});

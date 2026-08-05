/**
 * PLATFORM-086F2G — operational-season resolution. System Health is not a
 * historical browser: the year is resolved server-side from league lifecycle
 * state and is never caller-selected (the function takes no requested year).
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveOperationalSeasonYear } from '../systemHealthYear.ts';
import { TEST_LEAGUE_SLUG, type League } from '../../league.ts';

const NOW = Date.parse('2026-10-15T12:00:00.000Z'); // current UTC year 2026 → max 2027
// A MARCH clock separates the two calendar rules: `seasonYearForToday` returns
// 2025 (month < July), while `getUTCFullYear()` returns 2026. The default NOW
// cannot tell them apart, so the fallback case below must use this one.
const MARCH = Date.parse('2026-03-15T12:00:00.000Z');

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

// ---------------------------------------------------------------------------
// PLATFORM-086F2H1T5 — PRODUCTION leagues alone select the operational year.
//
// The exclusion is UNCONDITIONAL, deliberately unlike the F2H1T3/F2H1T4 shape:
// both branches below read the registry, and the second reads the top-level
// `league.year`, which stays synchronized to the demo's lifecycle and is
// RETAINED when the demo moves to `offseason`.
// ---------------------------------------------------------------------------

// REGRESSION — the demo cannot outrank an active production league. Both years
// sit below the 2027 clamp ceiling so the clamp cannot mask the mutation.
test('T5 regression: an active demo cannot outrank an active production league', () => {
  const leagues = [
    league({ slug: 'a', year: 2026, status: { state: 'season', year: 2026 } }),
    league({ slug: TEST_LEAGUE_SLUG, year: 2027, status: { state: 'season', year: 2027 } }),
  ];
  assert.equal(resolveOperationalSeasonYear({ leagues, nowMs: NOW }), 2026);
});

// REGRESSION — a demo-only registry falls through BOTH branches to the calendar
// season. The March clock also kills a `getUTCFullYear()` substitution, which
// the existing empty-registry test at NOW cannot distinguish.
test('T5 regression: a demo-only active registry resolves through the calendar season', () => {
  const leagues = [
    league({ slug: TEST_LEAGUE_SLUG, year: 2027, status: { state: 'season', year: 2027 } }),
  ];
  assert.equal(resolveOperationalSeasonYear({ leagues, nowMs: MARCH }), 2025);
});

// REGRESSION — the load-bearing case. An `offseason` demo is still excluded, so
// its retained `league.year` cannot win the stored-year fallback. This is the
// test that fails if the F2H1T3/F2H1T4 `isActive &&` shape is copied here.
test('T5 regression: an offseason demo cannot win the stored-year fallback', () => {
  const leagues = [
    league({ slug: 'a', year: 2024, status: { state: 'offseason' } }),
    league({ slug: TEST_LEAGUE_SLUG, year: 2027, status: { state: 'offseason' } }),
  ];
  assert.equal(resolveOperationalSeasonYear({ leagues, nowMs: NOW }), 2024);
});

// REGRESSION — branch isolation. An ACTIVE demo must not suppress the production
// stored-year fallback: with the demo removed the active pool is empty, so
// resolution must fall to production's stored year rather than the demo's.
test('T5 regression: an active demo cannot suppress the production stored-year fallback', () => {
  const leagues = [
    league({ slug: 'a', year: 2024, status: { state: 'offseason' } }),
    league({ slug: TEST_LEAGUE_SLUG, year: 2025, status: { state: 'season', year: 2027 } }),
  ];
  assert.equal(resolveOperationalSeasonYear({ leagues, nowMs: NOW }), 2024);
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

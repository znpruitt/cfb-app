import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveLifecycleState } from '../insights/lifecycle';
import { computeRosterFallback } from '../insights/context';
import type { SeasonArchive } from '../seasonArchive';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function utcDate(year: number, month: number, day: number, hour = 0, minute = 0): Date {
  return new Date(Date.UTC(year, month - 1, day, hour, minute));
}

function makeArchive(year: number, csvText: string): SeasonArchive {
  return {
    leagueSlug: 'test',
    year,
    archivedAt: new Date().toISOString(),
    ownerRosterSnapshot: csvText,
    standingsHistory: { weeks: [], byWeek: {}, byOwner: {} },
    finalStandings: [],
    games: [],
    scoresByKey: {},
  };
}

const OFFSEASON_STATUS = { state: 'offseason' } as const;
const SEASON_STATUS = { state: 'season', year: 2025 } as const;
const PRESEASON_STATUS = { state: 'preseason', year: 2025 } as const;

// ---------------------------------------------------------------------------
// deriveLifecycleState — determinism
// ---------------------------------------------------------------------------

test('deriveLifecycleState: same inputs produce identical output (determinism)', () => {
  const fixedDate = utcDate(2026, 6, 15); // mid-June, well into offseason
  const result1 = deriveLifecycleState(OFFSEASON_STATUS, 'in-season', null, null, fixedDate);
  const result2 = deriveLifecycleState(OFFSEASON_STATUS, 'in-season', null, null, fixedDate);
  assert.equal(result1, result2);
  assert.equal(result1, 'offseason');
});

// ---------------------------------------------------------------------------
// deriveLifecycleState — fresh_offseason ↔ offseason boundary (March 1 UTC)
// ---------------------------------------------------------------------------

test('deriveLifecycleState: Feb 28 23:59 UTC → fresh_offseason', () => {
  const justBefore = utcDate(2026, 2, 28, 23, 59);
  const result = deriveLifecycleState(OFFSEASON_STATUS, 'in-season', null, null, justBefore);
  assert.equal(result, 'fresh_offseason');
});

test('deriveLifecycleState: Mar 1 00:00 UTC → offseason (boundary is exclusive)', () => {
  const atBoundary = utcDate(2026, 3, 1, 0, 0);
  const result = deriveLifecycleState(OFFSEASON_STATUS, 'in-season', null, null, atBoundary);
  assert.equal(result, 'offseason');
});

test('deriveLifecycleState: Mar 1 00:01 UTC → offseason', () => {
  const justAfter = utcDate(2026, 3, 1, 0, 1);
  const result = deriveLifecycleState(OFFSEASON_STATUS, 'in-season', null, null, justAfter);
  assert.equal(result, 'offseason');
});

test('deriveLifecycleState: Jan 15 → fresh_offseason (well before March 1)', () => {
  const midJan = utcDate(2026, 1, 15);
  const result = deriveLifecycleState(OFFSEASON_STATUS, 'in-season', null, null, midJan);
  assert.equal(result, 'fresh_offseason');
});

// ---------------------------------------------------------------------------
// deriveLifecycleState — other states unaffected by currentDate
// ---------------------------------------------------------------------------

test('deriveLifecycleState: preseason status → preseason regardless of date', () => {
  const anyDate = utcDate(2026, 6, 1);
  const result = deriveLifecycleState(PRESEASON_STATUS, 'in-season', null, null, anyDate);
  assert.equal(result, 'preseason');
});

test('deriveLifecycleState: in-season with postseason context → postseason', () => {
  const anyDate = utcDate(2025, 12, 15);
  const result = deriveLifecycleState(SEASON_STATUS, 'postseason', 16, 15, anyDate);
  assert.equal(result, 'postseason');
});

test('deriveLifecycleState: early season (week 3 of 15) → early_season', () => {
  const anyDate = utcDate(2025, 9, 10);
  // week 3 <= floor(15 * 0.25) = 3 → early_season
  const result = deriveLifecycleState(SEASON_STATUS, 'in-season', 3, 15, anyDate);
  assert.equal(result, 'early_season');
});

test('deriveLifecycleState: mid season (week 8 of 15) → mid_season', () => {
  const anyDate = utcDate(2025, 10, 15);
  // week 8 > floor(15*0.25)=3, week 8 <= floor(15*0.75)=11 → mid_season
  const result = deriveLifecycleState(SEASON_STATUS, 'in-season', 8, 15, anyDate);
  assert.equal(result, 'mid_season');
});

test('deriveLifecycleState: late season (week 13 of 15) → late_season', () => {
  const anyDate = utcDate(2025, 11, 20);
  // week 13 > floor(15*0.75)=11 → late_season
  const result = deriveLifecycleState(SEASON_STATUS, 'in-season', 13, 15, anyDate);
  assert.equal(result, 'late_season');
});

// ---------------------------------------------------------------------------
// computeRosterFallback — usingArchivedRoster flag
// ---------------------------------------------------------------------------

const ARCHIVE_CSV = 'team,owner\nAlabama,Alice\nGeorgia,Bob';

test('computeRosterFallback: non-empty currentRoster → usingArchivedRoster false', () => {
  const roster = new Map([['Alabama', 'Alice']]);
  const archives = [makeArchive(2025, ARCHIVE_CSV)];
  const { usingArchivedRoster, resolvedRoster } = computeRosterFallback(roster, archives);
  assert.equal(usingArchivedRoster, false);
  assert.equal(resolvedRoster, roster); // same reference
});

test('computeRosterFallback: empty currentRoster + no archives → usingArchivedRoster false', () => {
  const roster = new Map<string, string>();
  const { usingArchivedRoster, resolvedRoster } = computeRosterFallback(roster, []);
  assert.equal(usingArchivedRoster, false);
  assert.equal(resolvedRoster, roster);
});

test('computeRosterFallback: empty currentRoster + archive present → usingArchivedRoster true', () => {
  const roster = new Map<string, string>();
  const archives = [makeArchive(2025, ARCHIVE_CSV)];
  const { usingArchivedRoster, resolvedRoster } = computeRosterFallback(roster, archives);
  assert.equal(usingArchivedRoster, true);
  assert.equal(resolvedRoster.get('Alabama'), 'Alice');
  assert.equal(resolvedRoster.get('Georgia'), 'Bob');
});

test('computeRosterFallback: picks most recent archive when multiple exist', () => {
  const roster = new Map<string, string>();
  const archives = [
    makeArchive(2023, 'team,owner\nAlabama,OldAlice'),
    makeArchive(2025, 'team,owner\nAlabama,NewAlice'),
    makeArchive(2024, 'team,owner\nAlabama,MidAlice'),
  ];
  const { usingArchivedRoster, resolvedRoster } = computeRosterFallback(roster, archives);
  assert.equal(usingArchivedRoster, true);
  assert.equal(resolvedRoster.get('Alabama'), 'NewAlice'); // 2025 is most recent
});

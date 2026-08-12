import assert from 'node:assert/strict';
import test from 'node:test';

import { seasonYearForNewLeague } from '../league.ts';

// ---------------------------------------------------------------------------
// PLATFORM-093 — which season a NEWLY CREATED league is for.
//
// There is only ever one season in play: either it is under way or it is about
// to be. The rule is the calendar year, and the ABSENCE of an adjustment is what
// these pin — a reader who compares this to `seasonYearForToday`
// (`month >= 6 ? year : year - 1`) and "fixes" the January-through-June gap
// would break it, because that helper answers a different question.
//
// A fixed clock is passed rather than read, so these cannot drift or depend on
// when the suite runs.
// ---------------------------------------------------------------------------

function at(iso: string): number {
  return seasonYearForNewLeague(new Date(iso));
}

test('a league created before kickoff is for the season about to start', () => {
  // February through July: the season has not started, and it is this calendar
  // year. `seasonYearForToday` returns 2025 for all of these.
  assert.equal(at('2026-02-01T12:00:00Z'), 2026);
  assert.equal(at('2026-04-15T12:00:00Z'), 2026);
  assert.equal(at('2026-06-30T23:59:59Z'), 2026);
});

test('a league created during the season is for that season', () => {
  assert.equal(at('2026-08-12T12:00:00Z'), 2026);
  assert.equal(at('2026-10-01T12:00:00Z'), 2026);
  assert.equal(at('2026-12-31T23:59:59Z'), 2026);
});

test('January belongs to the UPCOMING season, not the one finishing', () => {
  // The 2026 season's bowls and playoff run into January 2027, but a league
  // created then is being set up for the following autumn — nobody joins a
  // season that ends within days.
  assert.equal(at('2027-01-01T00:00:00Z'), 2027);
  assert.equal(at('2027-01-20T12:00:00Z'), 2027);
});

test('the year changes exactly at the calendar boundary', () => {
  // The whole rule, stated as its only transition. If an adjustment is ever
  // added, this is what fails.
  assert.equal(at('2026-12-31T23:59:59Z'), 2026);
  assert.equal(at('2027-01-01T00:00:00Z'), 2027);
});

test('the derivation is UTC, matching the rest of the registry', () => {
  // `maxCreatableSeasonYear` and the founding-year derivation both read UTC, so
  // a local-time reading here could file a league one season out for callers
  // either side of midnight UTC on New Year's Eve.
  assert.equal(at('2026-12-31T23:30:00Z'), 2026);
  assert.equal(at('2027-01-01T00:30:00Z'), 2027);
});

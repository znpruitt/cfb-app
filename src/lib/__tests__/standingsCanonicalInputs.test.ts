import assert from 'node:assert/strict';
import test from 'node:test';

import {
  STANDINGS_COVERAGE_UNAVAILABLE,
  resolveStandingsCanonicalInputs,
} from '../selectors/standingsCanonicalInputs';
import type { CanonicalStandings } from '../selectors/leagueStandings';
import type { OwnerStandingsRow, StandingsCoverage } from '../standings';
import type { StandingsHistory } from '../standingsHistory';

// ===========================================================================
// PLATFORM-049 — Standings canonical input resolution. Rows, history, and
// coverage all come from the same canonical snapshot when supplied; local
// fallback only when NO snapshot is supplied; missing/null canonical coverage →
// conservative error (never local). Standings-specific — decoupled from Overview.
// ===========================================================================

function row(overrides: Partial<OwnerStandingsRow> & { owner: string }): OwnerStandingsRow {
  return {
    owner: overrides.owner,
    wins: overrides.wins ?? 0,
    losses: overrides.losses ?? 0,
    winPct: overrides.winPct ?? 0,
    pointsFor: overrides.pointsFor ?? 0,
    pointsAgainst: overrides.pointsAgainst ?? 0,
    pointDifferential: overrides.pointDifferential ?? 0,
    gamesBack: overrides.gamesBack ?? 0,
    finalGames: overrides.finalGames ?? 0,
  };
}

function coverage(
  state: StandingsCoverage['state'],
  message: string | null = null
): StandingsCoverage {
  return { state, message };
}

function history(weeks: number[]): StandingsHistory {
  return {
    weeks,
    byWeek: Object.fromEntries(
      weeks.map((week) => [week, { week, standings: [], coverage: coverage('complete') }])
    ),
    byOwner: {},
  };
}

function canonical(overrides: Partial<CanonicalStandings>): CanonicalStandings {
  return {
    slug: 'tsc',
    year: 2026,
    source: 'live',
    lifecycle: 'mid_season',
    rows: overrides.rows ?? [],
    noClaimRow: overrides.noClaimRow ?? null,
    ownerColorOrder: overrides.ownerColorOrder ?? [],
    standingsHistory: overrides.standingsHistory ?? null,
    coverage: overrides.coverage ?? coverage('complete'),
    ownersRosterSource: 'csv',
    archiveYearResolved: null,
    inferredSeasonStart: null,
    generatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

const LOCAL_COVERAGE = coverage('complete', 'local coverage');

test('rows/history/coverage all come from canonical when a snapshot is supplied', () => {
  const canonicalRows = [row({ owner: 'Alice', wins: 6 })];
  const canonicalHistory = history([1, 2]);
  const resolved = resolveStandingsCanonicalInputs({
    canonicalStandings: canonical({
      rows: canonicalRows,
      standingsHistory: canonicalHistory,
      coverage: coverage('partial', 'canonical partial'),
    }),
    rows: [row({ owner: 'Alice', wins: 1 })],
    standingsHistory: history([9]),
    coverage: coverage('complete', 'local complete'),
  });

  assert.deepEqual(resolved.rows, canonicalRows);
  assert.deepEqual(resolved.history?.weeks, [1, 2]);
  assert.deepEqual(resolved.coverage, coverage('partial', 'canonical partial'));
});

test('canonical complete coverage overrides contradictory local partial/error', () => {
  const resolved = resolveStandingsCanonicalInputs({
    canonicalStandings: canonical({ coverage: coverage('complete', null) }),
    rows: [],
    coverage: coverage('error', 'local error'),
  });
  assert.deepEqual(resolved.coverage, coverage('complete', null));
});

test('local rows/history/coverage are used only when NO canonical snapshot is supplied', () => {
  const localRows = [row({ owner: 'Alice', wins: 3 })];
  const localHistory = history([1, 2, 3]);
  const resolvedNull = resolveStandingsCanonicalInputs({
    canonicalStandings: null,
    rows: localRows,
    standingsHistory: localHistory,
    coverage: coverage('partial', 'local partial'),
  });
  assert.deepEqual(resolvedNull.rows, localRows);
  assert.deepEqual(resolvedNull.history?.weeks, [1, 2, 3]);
  assert.deepEqual(resolvedNull.coverage, coverage('partial', 'local partial'));

  const resolvedUndefined = resolveStandingsCanonicalInputs({
    rows: localRows,
    coverage: coverage('error', 'local error'),
  });
  assert.deepEqual(resolvedUndefined.coverage, coverage('error', 'local error'));
});

test('a canonical snapshot with missing/null coverage returns conservative error (NOT local)', () => {
  const malformed = canonical({ rows: [row({ owner: 'Alice' })] });
  (malformed as { coverage: StandingsCoverage | null }).coverage = null;

  const resolved = resolveStandingsCanonicalInputs({
    canonicalStandings: malformed,
    rows: [],
    coverage: coverage('complete', 'local must NOT be used'),
  });

  assert.deepEqual(resolved.coverage, STANDINGS_COVERAGE_UNAVAILABLE);
  assert.equal(resolved.coverage.state, 'error');
  assert.equal(resolved.coverage.message, 'Standings coverage is unavailable.');
});

test('coverage resolution does not change canonical rows or history', () => {
  const canonicalRows = [row({ owner: 'Alice' }), row({ owner: 'Bob' })];
  const canonicalHistory = history([1, 2, 3]);
  const resolved = resolveStandingsCanonicalInputs({
    canonicalStandings: canonical({
      rows: canonicalRows,
      standingsHistory: canonicalHistory,
      coverage: coverage('error', 'canonical error'),
    }),
    rows: [row({ owner: 'Zoe' })],
    standingsHistory: history([9]),
    coverage: LOCAL_COVERAGE,
  });

  assert.deepEqual(resolved.rows, canonicalRows);
  assert.equal(resolved.history, canonicalHistory);
});

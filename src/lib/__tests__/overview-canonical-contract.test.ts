import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CANONICAL_COVERAGE_UNAVAILABLE,
  resolveOverviewCanonicalInputs,
} from '../selectors/overview';
import type { CanonicalStandings } from '../selectors/leagueStandings';
import type { OwnerStandingsRow, StandingsCoverage } from '../standings';
import type { StandingsHistory } from '../standingsHistory';

// ===========================================================================
// PLATFORM-047 (characterization) + PLATFORM-048 (coverage now canonical).
//
// Pinned Overview source-of-truth contract via resolveOverviewCanonicalInputs
// (used by OverviewPanel and CFBScheduleApp):
//   • rows     — canonical when supplied (empty stays empty; omit ≠ resurrect), else local.
//   • history  — canonical when supplied (null stays null), else local.
//   • coverage — canonical when supplied; missing/null canonical coverage →
//                conservative error coverage (NOT local); local only when no
//                canonical snapshot is supplied.
//   • liveDelta — not an input; not merged into Overview rows.
//   • NoClaim  — excluded from canonical rows (held in noClaimRow).
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

const LOCAL_COVERAGE = coverage('complete', 'local coverage');

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

// --- rows resolution -------------------------------------------------------

test('rows: canonical rows are preferred over contradictory local rows', () => {
  const localRows = [row({ owner: 'Alice', wins: 1, losses: 5 })];
  const canonicalRows = [row({ owner: 'Alice', wins: 6, losses: 0 })];

  const { rows } = resolveOverviewCanonicalInputs({
    canonicalStandings: canonical({ rows: canonicalRows }),
    standingsLeaders: localRows,
    standingsCoverage: LOCAL_COVERAGE,
  });

  assert.deepEqual(rows, canonicalRows);
});

test('rows: a supplied-but-empty canonical snapshot yields empty rows (NOT local fallback)', () => {
  const { rows } = resolveOverviewCanonicalInputs({
    canonicalStandings: canonical({ rows: [] }),
    standingsLeaders: [row({ owner: 'Alice', wins: 4 })],
    standingsCoverage: LOCAL_COVERAGE,
  });

  assert.deepEqual(rows, []);
});

test('rows: canonical rows that omit an owner present locally do NOT resurrect the local owner', () => {
  const { rows } = resolveOverviewCanonicalInputs({
    canonicalStandings: canonical({ rows: [row({ owner: 'Zoe' })] }),
    standingsLeaders: [row({ owner: 'Alice' }), row({ owner: 'Zoe' })],
    standingsCoverage: LOCAL_COVERAGE,
  });

  assert.deepEqual(
    rows.map((r) => r.owner),
    ['Zoe']
  );
});

test('rows: local rows are used only when NO canonical snapshot is supplied', () => {
  const localRows = [row({ owner: 'Alice', wins: 3, losses: 2 })];

  assert.deepEqual(
    resolveOverviewCanonicalInputs({
      canonicalStandings: null,
      standingsLeaders: localRows,
      standingsCoverage: LOCAL_COVERAGE,
    }).rows,
    localRows
  );
  assert.deepEqual(
    resolveOverviewCanonicalInputs({
      standingsLeaders: localRows,
      standingsCoverage: LOCAL_COVERAGE,
    }).rows,
    localRows
  );
});

// --- history resolution ----------------------------------------------------

test('history: canonical history is preferred over contradictory local history', () => {
  const { history: resolved } = resolveOverviewCanonicalInputs({
    canonicalStandings: canonical({ standingsHistory: history([1, 2]) }),
    standingsLeaders: [],
    standingsHistory: history([1, 2, 3]),
    standingsCoverage: LOCAL_COVERAGE,
  });

  assert.deepEqual(resolved?.weeks, [1, 2]);
});

test('history: a supplied canonical snapshot with null history yields null (NOT local history)', () => {
  const { history: resolved } = resolveOverviewCanonicalInputs({
    canonicalStandings: canonical({ standingsHistory: null }),
    standingsLeaders: [],
    standingsHistory: history([1, 2, 3]),
    standingsCoverage: LOCAL_COVERAGE,
  });

  assert.equal(resolved, null);
});

test('history: local history is used only when NO canonical snapshot is supplied', () => {
  assert.deepEqual(
    resolveOverviewCanonicalInputs({
      standingsLeaders: [],
      standingsHistory: history([1, 2, 3]),
      standingsCoverage: LOCAL_COVERAGE,
    }).history?.weeks,
    [1, 2, 3]
  );
});

// --- coverage resolution (PLATFORM-048: now canonical-preferred) ------------

test('coverage: canonical coverage is preferred (canonical partial beats local complete)', () => {
  const { coverage: resolved } = resolveOverviewCanonicalInputs({
    canonicalStandings: canonical({ coverage: coverage('partial', 'canonical partial') }),
    standingsLeaders: [],
    standingsCoverage: coverage('complete', 'local complete'),
  });

  assert.deepEqual(resolved, coverage('partial', 'canonical partial'));
});

test('coverage: canonical coverage is preferred (canonical complete beats local partial)', () => {
  const { coverage: resolved } = resolveOverviewCanonicalInputs({
    canonicalStandings: canonical({ coverage: coverage('complete', 'canonical complete') }),
    standingsLeaders: [],
    standingsCoverage: coverage('partial', 'local partial'),
  });

  assert.deepEqual(resolved, coverage('complete', 'canonical complete'));
});

test('coverage: local coverage is used only when NO canonical snapshot is supplied', () => {
  const local = coverage('partial', 'local partial');
  assert.deepEqual(
    resolveOverviewCanonicalInputs({ standingsLeaders: [], standingsCoverage: local }).coverage,
    local
  );
  assert.deepEqual(
    resolveOverviewCanonicalInputs({
      canonicalStandings: null,
      standingsLeaders: [],
      standingsCoverage: local,
    }).coverage,
    local
  );
});

test('coverage: a canonical snapshot with missing/null coverage returns conservative error (NOT local)', () => {
  // Defensive runtime handling — `coverage` stays required at the type level.
  const malformed = canonical({ rows: [row({ owner: 'Alice' })] });
  (malformed as { coverage: StandingsCoverage | null }).coverage = null;

  const { coverage: resolved } = resolveOverviewCanonicalInputs({
    canonicalStandings: malformed,
    standingsLeaders: [],
    standingsCoverage: coverage('complete', 'local must NOT be used'),
  });

  assert.deepEqual(resolved, CANONICAL_COVERAGE_UNAVAILABLE);
  assert.equal(resolved.state, 'error');
  assert.equal(resolved.message, 'Standings coverage is unavailable.');
});

// --- NoClaim ---------------------------------------------------------------

test('NoClaim: canonical rows exclude NoClaim (held separately in noClaimRow)', () => {
  const { rows } = resolveOverviewCanonicalInputs({
    canonicalStandings: canonical({
      rows: [row({ owner: 'Alice' }), row({ owner: 'Bob' })],
      noClaimRow: row({ owner: 'NoClaim', wins: 2, losses: 2 }),
    }),
    standingsLeaders: [],
    standingsCoverage: LOCAL_COVERAGE,
  });

  assert.ok(!rows.some((r) => r.owner === 'NoClaim'));
});

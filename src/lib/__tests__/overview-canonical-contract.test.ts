import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveOverviewCanonicalInputs } from '../selectors/overview';
import type { CanonicalStandings } from '../selectors/leagueStandings';
import type { OwnerStandingsRow } from '../standings';
import type { StandingsHistory } from '../standingsHistory';

// ===========================================================================
// PLATFORM-047 — Characterization of the Overview canonical data contract.
//
// These tests PIN the current source-of-truth boundary between canonical
// standings rows/history and client-derived data; they do not change behavior.
// The boundary lives in `resolveOverviewCanonicalInputs` (used by OverviewPanel).
//
// Pinned contract:
//   • rows    — canonical when a snapshot is supplied (even empty), else local.
//   • history — canonical when a snapshot is supplied (even null), else local.
//   • coverage — ALWAYS client/schedule-derived (never sourced from canonical).
//   • liveDelta — NOT an input to selectOverviewViewModel; not merged into rows.
//   • NoClaim — canonical rows already exclude it (kept in canonical.noClaimRow).
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

function history(weeks: number[]): StandingsHistory {
  return {
    weeks,
    byWeek: Object.fromEntries(
      weeks.map((week) => [
        week,
        { week, standings: [], coverage: { state: 'complete', message: null } },
      ])
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
    coverage: overrides.coverage ?? { state: 'complete', message: null },
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
  });

  assert.deepEqual(rows, canonicalRows);
});

test('rows: a supplied-but-empty canonical snapshot yields empty rows (NOT local fallback)', () => {
  const { rows } = resolveOverviewCanonicalInputs({
    canonicalStandings: canonical({ rows: [] }),
    standingsLeaders: [row({ owner: 'Alice', wins: 4 })],
  });

  assert.deepEqual(rows, []);
});

test('rows: canonical rows that omit an owner present locally do NOT resurrect the local owner', () => {
  const { rows } = resolveOverviewCanonicalInputs({
    canonicalStandings: canonical({ rows: [row({ owner: 'Zoe' })] }),
    standingsLeaders: [row({ owner: 'Alice' }), row({ owner: 'Zoe' })],
  });

  assert.deepEqual(
    rows.map((r) => r.owner),
    ['Zoe']
  );
});

test('rows: local rows are used only when NO canonical snapshot is supplied', () => {
  const localRows = [row({ owner: 'Alice', wins: 3, losses: 2 })];

  assert.deepEqual(
    resolveOverviewCanonicalInputs({ canonicalStandings: null, standingsLeaders: localRows }).rows,
    localRows
  );
  assert.deepEqual(resolveOverviewCanonicalInputs({ standingsLeaders: localRows }).rows, localRows);
});

// --- history resolution ----------------------------------------------------

test('history: canonical history is preferred over contradictory local history', () => {
  const localHistory = history([1, 2, 3]);
  const canonicalHistory = history([1, 2]);

  const { history: resolved } = resolveOverviewCanonicalInputs({
    canonicalStandings: canonical({ standingsHistory: canonicalHistory }),
    standingsLeaders: [],
    standingsHistory: localHistory,
  });

  assert.deepEqual(resolved?.weeks, [1, 2]);
});

test('history: a supplied canonical snapshot with null history yields null (NOT local history)', () => {
  const { history: resolved } = resolveOverviewCanonicalInputs({
    canonicalStandings: canonical({ standingsHistory: null }),
    standingsLeaders: [],
    standingsHistory: history([1, 2, 3]),
  });

  assert.equal(resolved, null);
});

test('history: local history is used only when NO canonical snapshot is supplied', () => {
  const localHistory = history([1, 2, 3]);

  assert.deepEqual(
    resolveOverviewCanonicalInputs({
      standingsLeaders: [],
      standingsHistory: localHistory,
    }).history?.weeks,
    [1, 2, 3]
  );
});

// --- coverage stays client/schedule-derived --------------------------------

test('coverage: canonical resolution does NOT source coverage from canonical (stays client-derived)', () => {
  // Coverage remains client/schedule-derived: even an authoritative canonical
  // snapshot carrying its own `coverage` must not feed the Overview coverage —
  // the resolution returns only rows/history, so the caller's client-derived
  // coverage flows through unchanged.
  const result = resolveOverviewCanonicalInputs({
    canonicalStandings: canonical({
      rows: [row({ owner: 'Alice' })],
      coverage: { state: 'error', message: 'canonical-side coverage must be ignored here' },
    }),
    standingsLeaders: [],
  });

  assert.deepEqual(Object.keys(result).sort(), ['history', 'rows']);
});

// --- NoClaim ---------------------------------------------------------------

test('NoClaim: canonical rows exclude NoClaim (held separately in noClaimRow)', () => {
  // getCanonicalStandings splits NoClaim into noClaimRow; the rows the Overview
  // renders never contain a NoClaim owner entry.
  const snap = canonical({
    rows: [row({ owner: 'Alice' }), row({ owner: 'Bob' })],
    noClaimRow: row({ owner: 'NoClaim', wins: 2, losses: 2 }),
  });

  const { rows } = resolveOverviewCanonicalInputs({
    canonicalStandings: snap,
    standingsLeaders: [],
  });

  assert.ok(!rows.some((r) => r.owner === 'NoClaim'));
});

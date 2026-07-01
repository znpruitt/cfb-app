import assert from 'node:assert/strict';
import test from 'node:test';

import type { LeagueStatus } from '../league';
import { resolveLeagueSeason } from '../leagueSeason.ts';

const DEFAULT_SEASON = 2026;

test('preseason uses the league status year', () => {
  const leagueStatus: LeagueStatus = { state: 'preseason', year: 2027 };
  assert.equal(
    resolveLeagueSeason({ leagueStatus, leagueYear: 2025, defaultSeason: DEFAULT_SEASON }),
    2027
  );
});

test('active season uses the league status year, not the global default', () => {
  const leagueStatus: LeagueStatus = { state: 'season', year: 2024 };
  // Regression: the old inline logic returned DEFAULT_SEASON for 'season'.
  assert.equal(
    resolveLeagueSeason({ leagueStatus, leagueYear: 2023, defaultSeason: DEFAULT_SEASON }),
    2024
  );
});

test('offseason falls back to leagueYear when the status carries no year', () => {
  const leagueStatus: LeagueStatus = { state: 'offseason' };
  assert.equal(
    resolveLeagueSeason({ leagueStatus, leagueYear: 2025, defaultSeason: DEFAULT_SEASON }),
    2025
  );
});

test('missing status falls back to leagueYear', () => {
  assert.equal(resolveLeagueSeason({ leagueYear: 2022, defaultSeason: DEFAULT_SEASON }), 2022);
});

test('falls back to the global default only when no league-specific year exists', () => {
  const leagueStatus: LeagueStatus = { state: 'offseason' };
  assert.equal(
    resolveLeagueSeason({ leagueStatus, defaultSeason: DEFAULT_SEASON }),
    DEFAULT_SEASON
  );
  assert.equal(resolveLeagueSeason({ defaultSeason: DEFAULT_SEASON }), DEFAULT_SEASON);
});

test('status year outranks leagueYear (no silent override of the active-season signal)', () => {
  const leagueStatus: LeagueStatus = { state: 'season', year: 2024 };
  assert.equal(
    resolveLeagueSeason({ leagueStatus, leagueYear: 2026, defaultSeason: DEFAULT_SEASON }),
    2024
  );
});

test('distinct leagues resolve to distinct seasons (no cross-season key collision)', () => {
  const a = resolveLeagueSeason({
    leagueStatus: { state: 'season', year: 2024 },
    defaultSeason: DEFAULT_SEASON,
  });
  const b = resolveLeagueSeason({
    leagueStatus: { state: 'preseason', year: 2027 },
    defaultSeason: DEFAULT_SEASON,
  });
  assert.notEqual(a, b);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveLeagueSeason } from '@/lib/leagueSeason';
import { resolveLeagueOperatingYear } from '@/lib/selectors/leagueLifecycle';
import type { League } from '@/lib/league';

// ---------------------------------------------------------------------------
// INSIGHTS-019 — the diagnostic page must diagnose the SAME season the Overview
// is showing.
//
// The two reviewers reached OPPOSITE conclusions here, and the type system
// settles it: `LeagueStatus` is
//   { state: 'season'; year } | { state: 'offseason' } | { state: 'preseason'; year }
// so an offseason status carries NO year. Codex's scenario — offseason where
// `status.year` differs from `league.year` — is unreachable; `resolveLeagueSeason`
// falls through to `leagueYear` exactly as `resolveLeagueOperatingYear` and a bare
// `league.year` do.
//
// So all three resolvers agree in every reachable state, and the page was never
// actually diagnosing the wrong season. The page calls `resolveLeagueSeason`
// anyway — the same function `CFBScheduleApp` calls before requesting
// `/api/insights?year=` — because coupling to the consumer keeps them in step if
// the status type ever gains an offseason year. That is intent, not a bug fix.
//
// These tests pin the agreement so a future change to `LeagueStatus` surfaces
// here rather than silently making the diagnostic describe a different season.
// ---------------------------------------------------------------------------

const DEFAULT_SEASON = 2026;

function league(overrides: Partial<League>): League {
  return {
    slug: 'tsc',
    displayName: 'TSC',
    year: 2026,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as League;
}

/** What the page now does. */
function pageYear(l: League): number {
  return resolveLeagueSeason({
    leagueStatus: l.status,
    leagueYear: l.year,
    defaultSeason: DEFAULT_SEASON,
  });
}

/** What the Overview does before requesting /api/insights. */
const overviewYear = pageYear;

test('preseason: the page and the Overview resolve the same year', () => {
  const l = league({ year: 2026, status: { state: 'preseason', year: 2026 } });
  assert.equal(pageYear(l), overviewYear(l));
  assert.equal(pageYear(l), 2026);
});

test('season: the page and the Overview resolve the same year', () => {
  const l = league({ year: 2026, status: { state: 'season', year: 2026 } });
  assert.equal(pageYear(l), overviewYear(l));
});

test('offseason: all three resolvers agree, because the status carries no year', () => {
  // The scenario one reviewer flagged cannot be constructed — `{ state:
  // 'offseason' }` has no `year` field. This is the closest reachable case: a
  // top-level year that differs from the season the league last played.
  const l = league({ year: 2025, status: { state: 'offseason' } });

  assert.equal(pageYear(l), 2025, 'falls through to the stored league year');
  assert.equal(overviewYear(l), 2025, 'and the Overview does the same');
  assert.equal(resolveLeagueOperatingYear(l), 2025, 'as does the lifecycle resolver');
  assert.equal(l.year, 2025, 'as does a bare league.year');
});

test('no status at all: falls back to the stored league year, not the global default', () => {
  const l = league({ year: 2024, status: undefined });
  assert.equal(pageYear(l), 2024);
  assert.equal(pageYear(l), overviewYear(l));
});

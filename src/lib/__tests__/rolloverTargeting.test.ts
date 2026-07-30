import assert from 'node:assert/strict';
import test from 'node:test';

import { groupRolloverTargets } from '../rolloverTargeting.ts';
import type { League } from '../league.ts';

// ---------------------------------------------------------------------------
// PLATFORM-086F2B — the ONE rollover target-selection policy shared by the
// automatic cron and the manual admin route. Pure: reads only the supplied
// records; groups exclusively by status.year; excludes test/offseason/
// preseason/missing-status; deterministic ascending year order.
// ---------------------------------------------------------------------------

function makeLeague(slug: string, year: number, status: League['status']): League {
  return {
    slug,
    displayName: `League ${slug}`,
    year,
    createdAt: '2022-01-01T00:00:00.000Z',
    ...(status !== undefined ? { status } : {}),
  };
}

test('groups exclusively by status.year in ascending order regardless of registration order', () => {
  const groups = groupRolloverTargets([
    makeLeague('gamma', 2025, { state: 'season', year: 2025 }),
    makeLeague('alpha', 2023, { state: 'season', year: 2023 }),
    makeLeague('beta', 2025, { state: 'season', year: 2025 }),
  ]);
  assert.deepEqual(
    groups.map((g) => ({ year: g.year, slugs: g.leagues.map((l) => l.slug) })),
    [
      { year: 2023, slugs: ['alpha'] },
      { year: 2025, slugs: ['gamma', 'beta'] },
    ]
  );
});

test('a deliberately wrong top-level league.year never changes the target group', () => {
  const groups = groupRolloverTargets([
    // Top-level year desynchronized (1999) — status.year is the only authority.
    makeLeague('alpha', 1999, { state: 'season', year: 2024 }),
  ]);
  assert.deepEqual(
    groups.map((g) => ({ year: g.year, slugs: g.leagues.map((l) => l.slug) })),
    [{ year: 2024, slugs: ['alpha'] }]
  );
});

test('offseason, preseason, missing-status, and test leagues are excluded', () => {
  const groups = groupRolloverTargets([
    makeLeague('off', 2024, { state: 'offseason' }),
    makeLeague('pre', 2024, { state: 'preseason', year: 2025 }),
    makeLeague('legacy', 2024, undefined),
    makeLeague('test', 2024, { state: 'season', year: 2024 }),
    makeLeague('alpha', 2024, { state: 'season', year: 2024 }),
  ]);
  assert.deepEqual(
    groups.map((g) => ({ year: g.year, slugs: g.leagues.map((l) => l.slug) })),
    [{ year: 2024, slugs: ['alpha'] }]
  );
});

test('no season leagues → no groups', () => {
  assert.deepEqual(groupRolloverTargets([]), []);
  assert.deepEqual(groupRolloverTargets([makeLeague('off', 2024, { state: 'offseason' })]), []);
});

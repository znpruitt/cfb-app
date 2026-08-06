import assert from 'node:assert/strict';
import test from 'node:test';

import { groupRolloverTargets, type RolloverYearGroup } from '../rolloverTargeting.ts';
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

/**
 * PLATFORM-086F2H1R4 — the policy publishes refusals into a SINK as it counts
 * them (so a mid-loop throw cannot discard one). These cases compare groups
 * only, so supply a throwaway sink; the refusal cases below use it directly.
 */
function group(leagues: League[]): RolloverYearGroup[] {
  return groupRolloverTargets(leagues, { invalidLifecycleTargets: 0 });
}

test('groups exclusively by status.year in ascending order regardless of registration order', () => {
  const groups = group([
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
  const groups = group([
    // Top-level year desynchronized (1999) — status.year is the only authority.
    makeLeague('alpha', 1999, { state: 'season', year: 2024 }),
  ]);
  assert.deepEqual(
    groups.map((g) => ({ year: g.year, slugs: g.leagues.map((l) => l.slug) })),
    [{ year: 2024, slugs: ['alpha'] }]
  );
});

test('offseason, preseason, missing-status, and test leagues are excluded', () => {
  const groups = group([
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
  assert.deepEqual(group([]), []);
  assert.deepEqual(group([makeLeague('off', 2024, { state: 'offseason' })]), []);
});

// ---------------------------------------------------------------------------
// PLATFORM-086F2H1R4 — structural lifecycle-year validity.
//
// Rollover is the slice where this matters most: it is the only one of the four
// registry consumers that WRITES durable data derived from the year.
// `saveSeasonArchive` keys on `String(archive.year)`, so an unusable year would
// mint a permanent, TTL-less archive under a key like `2026.5` or `undefined`.
// ---------------------------------------------------------------------------

const UNUSABLE_YEARS: Array<[string, unknown]> = [
  ['missing', undefined],
  ['string', '2024'],
  ['fractional', 2024.5],
  ['unsafe integer', 2 ** 53],
  ['pre-football', 1800],
  ['null', null],
];

/** Group with a caller-visible sink, for the refusal-accounting cases. */
function groupWithSink(leagues: League[]): {
  groups: RolloverYearGroup[];
  invalidLifecycleTargets: number;
} {
  const sink = { invalidLifecycleTargets: 0 };
  const groups = groupRolloverTargets(leagues, sink);
  return { groups, invalidLifecycleTargets: sink.invalidLifecycleTargets };
}

// REGRESSION TEST — every unusable shape is refused. Before R4 each became a
// `byYear` key and therefore a rollover target with an archive key derived
// from it.
test('R4 regression: an unusable production season year is refused, never grouped', () => {
  for (const [label, year] of UNUSABLE_YEARS) {
    const result = groupWithSink([
      makeLeague('alpha', 2024, { state: 'season', year } as unknown as League['status']),
    ]);
    assert.deepEqual(result.groups, [], label);
    assert.equal(result.invalidLifecycleTargets, 1, label);
  }
});

// CONTRACT PIN — non-`season` records were never targets, so they are never
// refusals either. Without this, every offseason/legacy record would inflate
// the count and make a healthy registry report refusals it never declined.
test('R4 contract pin: offseason and status-less records are not refusals', () => {
  const result = groupWithSink([
    makeLeague('a', 2024, { state: 'offseason' }),
    makeLeague('b', 2024, undefined),
    makeLeague('c', 2024, { state: 'offseason', year: 2024.5 } as unknown as League['status']),
    makeLeague('d', 2024, { state: 'preseason', year: 2024.5 } as unknown as League['status']),
  ]);
  assert.deepEqual(result.groups, []);
  assert.equal(result.invalidLifecycleTargets, 0);
});

// REGRESSION TEST — ordering. A demo record with an unusable year stays a demo
// exclusion and is never counted as an invalid production target. Kills
// validate-before-demo.
test('R4 regression: a demo league with an unusable year is excluded, not refused', () => {
  for (const [label, year] of UNUSABLE_YEARS) {
    const result = groupWithSink([
      makeLeague('test', 2024, { state: 'season', year } as unknown as League['status']),
    ]);
    assert.deepEqual(result.groups, [], label);
    assert.equal(result.invalidLifecycleTargets, 0, `${label}: a demo record is never a REFUSAL`);
  }
});

// REGRESSION TEST — counted per league RECORD, not per distinct unusable value.
// Three records sharing one bad year are three repairs, not one.
test('R4 regression: refusals are counted per league record', () => {
  const result = groupWithSink([
    makeLeague('a', 2024, { state: 'season', year: 2024.5 } as unknown as League['status']),
    makeLeague('b', 2024, { state: 'season', year: 2024.5 } as unknown as League['status']),
    makeLeague('c', 2024, { state: 'season', year: '2025' } as unknown as League['status']),
  ]);
  assert.deepEqual(result.groups, []);
  assert.equal(result.invalidLifecycleTargets, 3);
});

// REGRESSION TEST — a valid year still groups alongside a refusal, in BOTH
// registry orders. The order matters: a `break` on the first invalid record
// would drop the valid league only when the invalid one comes first.
test('R4 regression: a valid year still groups alongside a refusal, in either order', () => {
  const valid = makeLeague('alpha', 2024, { state: 'season', year: 2024 });
  const invalid = makeLeague('bravo', 2025, {
    state: 'season',
    year: '2025',
  } as unknown as League['status']);
  for (const [label, leagues] of [
    ['valid first', [valid, invalid]],
    ['invalid first', [invalid, valid]],
  ] as Array<[string, League[]]>) {
    const result = groupWithSink(leagues);
    assert.deepEqual(
      result.groups.map((g) => ({ year: g.year, slugs: g.leagues.map((l) => l.slug) })),
      [{ year: 2024, slugs: ['alpha'] }],
      label
    );
    assert.equal(result.invalidLifecycleTargets, 1, label);
  }
});

// REGRESSION TEST — refusal DURABILITY across a mid-loop throw.
//
// The grouping loop both counts refusals and can throw: `leagues` is typed
// `League[]`, but nothing validates each element, so a non-object member throws
// on property access. A count returned after the loop is discarded, and the
// caller reports zero refusals on a run that observed one — the shape AGENTS.md
// forbids. The fixture order is load-bearing: the refusable record must come
// FIRST, or nothing has been counted when the throw happens.
test('R4 regression: a refusal counted before a mid-loop throw survives on the sink', () => {
  const sink = { invalidLifecycleTargets: 0 };
  const leagues = [
    makeLeague('alpha', 2024, { state: 'season', year: '2024' } as unknown as League['status']),
    // A corrupt RECORD (not a corrupt container): reading `.slug` throws.
    null,
  ] as unknown as League[];

  // POSITIVE CONTROL — the throw really happens, so "the sink survived it" is a
  // real observation rather than a vacuous one on a function that returned.
  assert.throws(() => groupRolloverTargets(leagues, sink), TypeError);
  assert.equal(sink.invalidLifecycleTargets, 1, 'the refusal observed before the throw survives');
});

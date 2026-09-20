import assert from 'node:assert/strict';
import test from 'node:test';

import {
  describeProviderRefreshScope,
  globalScope,
  normalizeCanonicalSeasonType,
  oddsTargetScope,
  providerRefreshScopeKey,
  scopeMatchesKey,
  scoresAggregateScope,
  scoresPartitionScope,
  seasonPartitionScope,
  weekPartitionScope,
  yearScope,
} from '../providerRefreshScope.ts';

// --- Scope construction: same canonical target → same key -----------------------

test('the same canonical target produces the same scope key', () => {
  assert.equal(
    providerRefreshScopeKey('schedule', yearScope(2026)),
    providerRefreshScopeKey('schedule', yearScope(2026))
  );
  assert.equal(providerRefreshScopeKey('schedule', yearScope(2026)), 'schedule:year:2026');
});

test('different years produce different scope keys', () => {
  assert.notEqual(
    providerRefreshScopeKey('schedule', yearScope(2025)),
    providerRefreshScopeKey('schedule', yearScope(2026))
  );
});

test('regular vs postseason produce different partition keys', () => {
  assert.notEqual(
    providerRefreshScopeKey('scores', seasonPartitionScope(2026, 'regular')),
    providerRefreshScopeKey('scores', seasonPartitionScope(2026, 'postseason'))
  );
  assert.equal(
    providerRefreshScopeKey('scores', seasonPartitionScope(2026, 'regular')),
    'scores:season:2026:regular'
  );
});

test('different game-stats weeks produce different keys', () => {
  assert.notEqual(
    providerRefreshScopeKey('game-stats', weekPartitionScope(2026, 1, 'regular')),
    providerRefreshScopeKey('game-stats', weekPartitionScope(2026, 2, 'regular'))
  );
  assert.equal(
    providerRefreshScopeKey('game-stats', weekPartitionScope(2026, 3, 'postseason')),
    'game-stats:week:2026:3:postseason'
  );
});

test('season-type aliases/casing normalize to one key (no target split)', () => {
  assert.equal(normalizeCanonicalSeasonType('POSTSEASON'), 'postseason');
  assert.equal(normalizeCanonicalSeasonType('Regular'), 'regular');
  assert.equal(normalizeCanonicalSeasonType('anything-else'), 'regular');
  assert.equal(
    providerRefreshScopeKey('scores', seasonPartitionScope(2026, 'POSTSEASON')),
    providerRefreshScopeKey('scores', seasonPartitionScope(2026, 'postseason'))
  );
});

test('equivalent normalized Odds targets share one key; distinct variants differ', () => {
  // Same canonical cache key + variant → same scope key (the Odds cache-key builder
  // already sorts filters, so query-param order cannot split the target).
  assert.equal(
    providerRefreshScopeKey(
      'odds',
      oddsTargetScope(2026, 'canonical', '2026:bookmakers=a,b|markets=h2h|regions=us')
    ),
    providerRefreshScopeKey(
      'odds',
      oddsTargetScope(2026, 'canonical', '2026:bookmakers=a,b|markets=h2h|regions=us')
    )
  );
  // Canonical vs filtered variant → different keys even at the same year.
  assert.notEqual(
    providerRefreshScopeKey('odds', oddsTargetScope(2026, 'canonical', '2026:canonical-key')),
    providerRefreshScopeKey('odds', oddsTargetScope(2026, 'filtered', '2026:filtered-key'))
  );
});

test('global conferences produce one stable global key', () => {
  assert.equal(providerRefreshScopeKey('conferences', globalScope()), 'conferences:global');
  assert.equal(
    providerRefreshScopeKey('conferences', globalScope()),
    providerRefreshScopeKey('conferences', globalScope())
  );
});

test('legacy-unscoped keys map to the bare dataset (no migration needed)', () => {
  assert.equal(providerRefreshScopeKey('schedule', { kind: 'legacy-unscoped' }), 'schedule');
});

test('scopeMatchesKey validates self-describing agreement', () => {
  assert.equal(scopeMatchesKey('schedule', yearScope(2026), 'schedule:year:2026'), true);
  assert.equal(scopeMatchesKey('schedule', yearScope(2026), 'schedule:year:2025'), false);
});

// --- Operation → scope selection (review remediation findings 1–3) --------------

/**
 * PLATFORM-833: the `scheduleRefreshScope` tests were removed with the function.
 * They asserted per-target schedule status scoping — `season-partition` for a
 * targeted season type, `week-partition` for a targeted week, and a THROW for a
 * week with `seasonType: 'all'` — and every one of those targets was removed by
 * PLATFORM-663. Schedule now records the `year` scope and nothing else, which
 * `scopeMatchesKey` above and the schedule route's own suite cover. Keeping them
 * would have pinned a vocabulary no caller can reach.
 */

test('scoresPartitionScope uses a week scope only when a week is present', () => {
  assert.deepEqual(scoresPartitionScope(2026, null, 'regular'), {
    kind: 'season-partition',
    year: 2026,
    seasonType: 'regular',
  });
  assert.deepEqual(scoresPartitionScope(2026, 3, 'regular'), {
    kind: 'week-partition',
    year: 2026,
    week: 3,
    seasonType: 'regular',
  });
  assert.deepEqual(scoresPartitionScope(2026, 1, 'postseason'), {
    kind: 'week-partition',
    year: 2026,
    week: 1,
    seasonType: 'postseason',
  });
});

test('scoresAggregateScope writes the year rollup only for a complete applicable target', () => {
  // Derived complete set (attempted == applicable) → year rollup.
  assert.deepEqual(
    scoresAggregateScope(2026, ['regular', 'postseason'], ['regular', 'postseason']),
    {
      kind: 'year',
      year: 2026,
    }
  );
  // Only regular applicable, operation attempts regular → still a complete year.
  assert.deepEqual(scoresAggregateScope(2026, ['regular'], ['regular']), {
    kind: 'year',
    year: 2026,
  });
  // Targeted subset that omits an applicable sibling → its own partition, not year.
  assert.deepEqual(scoresAggregateScope(2026, ['postseason'], ['regular', 'postseason']), {
    kind: 'season-partition',
    year: 2026,
    seasonType: 'postseason',
  });
  // A forced partition when nothing is applicable is still targeted, never year.
  assert.deepEqual(scoresAggregateScope(2026, ['postseason'], []), {
    kind: 'season-partition',
    year: 2026,
    seasonType: 'postseason',
  });
});

test('describeProviderRefreshScope is human-readable per kind', () => {
  assert.equal(describeProviderRefreshScope(globalScope()), 'global');
  assert.equal(describeProviderRefreshScope(yearScope(2026)), 'year 2026');
  assert.equal(
    describeProviderRefreshScope(seasonPartitionScope(2026, 'postseason')),
    '2026 postseason'
  );
  assert.equal(
    describeProviderRefreshScope(weekPartitionScope(2026, 3, 'regular')),
    '2026 week 3 regular'
  );
  assert.equal(
    describeProviderRefreshScope(oddsTargetScope(2026, 'filtered', '2026:k')),
    '2026 odds (filtered)'
  );
  assert.equal(describeProviderRefreshScope({ kind: 'legacy-unscoped' }), 'legacy (unscoped)');
});

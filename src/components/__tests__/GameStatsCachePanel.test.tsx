import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyBackfillResponse,
  describeBackfillSummary,
  describeGameStatsRefreshResult,
} from '../admin/GameStatsCachePanel.tsx';

// PLATFORM-086H finding #1 — the panel reports the server's explicit refresh
// outcome; a valid no-op must never be worded as a successful "Cached 0 games".
// No-op wording stays NEUTRAL (review remediation): the response carries no
// schedule-relative completeness evidence, so it never claims the week is
// complete/up to date, and "nothing cached" is claimed only at rowsCached 0.

function result(overrides: Partial<Parameters<typeof describeGameStatsRefreshResult>[0]> = {}) {
  return {
    year: 2026,
    week: 5,
    seasonType: 'regular',
    fetchedAt: '2026-10-05T00:00:00.000Z',
    games: [],
    ...overrides,
  };
}

test('a committed refresh reports the rows actually added or updated', () => {
  const text = describeGameStatsRefreshResult(
    result({
      games: [{}, {}, {}],
      meta: { outcome: 'committed', rowsCommitted: 2, rowsCached: 3 },
    })
  );
  assert.equal(text, 'Committed 2 new or updated games for week 5 (regular) — 3 total cached');
});

test('a single committed row uses singular wording', () => {
  const text = describeGameStatsRefreshResult(
    result({ games: [{}], meta: { outcome: 'committed', rowsCommitted: 1, rowsCached: 1 } })
  );
  assert.equal(text, 'Committed 1 new or updated game for week 5 (regular) — 1 total cached');
});

test('a valid provider no-op with nothing cached never renders as "Cached 0 games"', () => {
  const text = describeGameStatsRefreshResult(
    result({
      meta: { outcome: 'noop', noopReason: 'no-provider-rows', rowsCommitted: 0, rowsCached: 0 },
    })
  );
  assert.doesNotMatch(text, /cached 0 games/i);
  assert.equal(
    text,
    'Provider returned no game stats for week 5 (regular) — nothing is cached yet'
  );
});

test('a provider no-op with retained rows never claims no stats exist', () => {
  const text = describeGameStatsRefreshResult(
    result({
      meta: { outcome: 'noop', noopReason: 'no-provider-rows', rowsCommitted: 0, rowsCached: 3 },
    })
  );
  assert.equal(
    text,
    'Provider returned no game stats for week 5 (regular) — 3 cached games retained'
  );
  assert.doesNotMatch(text, /no game stats available|nothing is cached/i);
});

test('a no-new-rows no-op uses neutral wording — never "up to date" or complete', () => {
  const text = describeGameStatsRefreshResult(
    result({
      games: [{}],
      meta: { outcome: 'noop', noopReason: 'no-new-rows', rowsCommitted: 0, rowsCached: 12 },
    })
  );
  assert.equal(
    text,
    'No new game stats were added for week 5 (regular) — 12 cached games retained'
  );
  assert.doesNotMatch(text, /up to date|complete/i);
});

test('a response without the outcome contract falls back to the legacy count wording', () => {
  const text = describeGameStatsRefreshResult(result({ games: [{}, {}] }));
  assert.equal(text, 'Cached 2 games for week 5 (regular)');
});

// Review remediation — backfill accounting separates unchanged weeks from
// genuine provider-empty weeks.

test('classifyBackfillResponse buckets by the explicit noop reason', () => {
  assert.equal(
    classifyBackfillResponse(
      result({ meta: { outcome: 'noop', noopReason: 'no-new-rows', rowsCached: 12 } })
    ),
    'unchanged'
  );
  assert.equal(
    classifyBackfillResponse(
      result({ meta: { outcome: 'noop', noopReason: 'no-provider-rows', rowsCached: 0 } })
    ),
    'provider-empty'
  );
  assert.equal(
    classifyBackfillResponse(result({ meta: { outcome: 'committed', rowsCommitted: 4 } })),
    'updated'
  );
  assert.equal(classifyBackfillResponse(result()), 'updated', 'legacy response counts as updated');
  assert.equal(classifyBackfillResponse(null), 'updated', 'unparseable body keeps legacy behavior');
});

test('the backfill summary reports unchanged weeks separately from no-data weeks', () => {
  assert.equal(
    describeBackfillSummary({ updated: 10, unchanged: 3, providerEmpty: 5, failed: 1 }),
    'Backfill complete — 10 weeks updated, 3 unchanged, 5 with no provider stats, 1 failed'
  );
});

test('the backfill summary omits empty categories', () => {
  assert.equal(
    describeBackfillSummary({ updated: 1, unchanged: 0, providerEmpty: 0, failed: 0 }),
    'Backfill complete — 1 week updated'
  );
});

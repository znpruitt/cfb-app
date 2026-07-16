import assert from 'node:assert/strict';
import test from 'node:test';

import { describeGameStatsRefreshResult } from '../admin/GameStatsCachePanel.tsx';

// PLATFORM-086H finding #1 — the panel reports the server's explicit refresh
// outcome; a valid no-op must never be worded as a successful "Cached 0 games".

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

test('a valid provider no-op never renders as "Cached 0 games"', () => {
  const text = describeGameStatsRefreshResult(
    result({ meta: { outcome: 'noop', noopReason: 'no-provider-rows', rowsCommitted: 0 } })
  );
  assert.doesNotMatch(text, /cached 0 games/i);
  assert.equal(
    text,
    'No game stats available yet for week 5 (regular) — nothing was cached or overwritten'
  );
});

test('a no-new-rows no-op says the week is already up to date', () => {
  const text = describeGameStatsRefreshResult(
    result({
      games: [{}],
      meta: { outcome: 'noop', noopReason: 'no-new-rows', rowsCommitted: 0, rowsCached: 12 },
    })
  );
  assert.equal(
    text,
    'week 5 (regular) is already up to date — the provider returned no new stats (12 cached)'
  );
});

test('a response without the outcome contract falls back to the legacy count wording', () => {
  const text = describeGameStatsRefreshResult(result({ games: [{}, {}] }));
  assert.equal(text, 'Cached 2 games for week 5 (regular)');
});

import assert from 'node:assert/strict';
import test from 'node:test';

import type { CacheEntry } from '../cache.ts';
import { mergeManualPartition } from '../manualPartitionMerge.ts';
import type { ScorePack } from '../types.ts';

// PLATFORM-086B2A — the manual `/games` refresh is AUTHORITATIVE partition
// replacement, with one concurrency exception: a prior row whose effective per-row
// timestamp POST-DATES the manual observation is a later live update and is
// preserved. Committed under the shared per-key advisory lock (route test proves
// the transaction wiring); this suite proves the pure merge policy.

function pack(id: string, status: string, hs: number | null, as: number | null): ScorePack {
  return {
    id,
    seasonType: 'regular',
    startDate: '2025-09-01T18:00:00.000Z',
    week: 3,
    status,
    home: { team: 'Alabama', score: hs },
    away: { team: 'Georgia', score: as },
    time: null,
  };
}

function entry(overrides: Partial<CacheEntry> & { items: ScorePack[] }): CacheEntry {
  return { at: 1000, source: 'cfbd', cfbdFallbackReason: 'none', ...overrides };
}

test('with no prior, the manual response is written verbatim, stamped at the observation time', () => {
  const merged = mergeManualPartition({
    manualItems: [pack('a', 'final', 21, 17)],
    prior: null,
    now: 5000,
  });
  assert.equal(merged.items.length, 1);
  assert.equal(merged.items[0]!.status, 'final');
  assert.equal(merged.at, 5000);
  assert.equal(merged.itemUpdatedAtById!['a'], 5000);
  assert.equal(merged.pendingFinalConfirmationIds, undefined);
});

test('manual AUTHORITATIVELY replaces older prior rows and drops rows the response omits', () => {
  const prior = entry({
    at: 1000,
    items: [pack('a', 'Q2 5:00', 7, 3), pack('b', 'final', 10, 3)],
    itemUpdatedAtById: { a: 1000, b: 1000 },
  });
  const merged = mergeManualPartition({
    manualItems: [pack('a', 'final', 24, 17)], // response omits `b`
    prior,
    now: 5000,
  });
  const byId = new Map(merged.items.map((i) => [i.id, i]));
  assert.equal(byId.get('a')!.status, 'final');
  assert.equal(byId.get('a')!.home.score, 24);
  assert.equal(byId.has('b'), false, 'authoritative replacement drops the omitted row');
  assert.equal(merged.itemUpdatedAtById!['a'], 5000);
});

test('a prior row NEWER than the observation is a live update and is PRESERVED over the manual row', () => {
  const prior = entry({
    at: 9000,
    items: [pack('a', 'Q4 2:00', 28, 21)],
    itemUpdatedAtById: { a: 9000 }, // effective 9000 > manual observation 5000
  });
  const merged = mergeManualPartition({
    manualItems: [pack('a', 'scheduled', null, null)], // stale manual view of the same game
    prior,
    now: 5000,
  });
  assert.equal(merged.items[0]!.status, 'Q4 2:00'); // the live row survived
  assert.equal(merged.items[0]!.home.score, 28);
  assert.equal(merged.itemUpdatedAtById!['a'], 9000); // keeps its effective timestamp
});

test('the merged entry `at` is monotonic — never older than the prior entry it merged over (Codex round 1, P1)', () => {
  // A live merge already advanced this key to at=5000; a slow manual request whose
  // observation is 3000 must NOT reset `at` backward (the week-scoped reader selects
  // by `at` and would otherwise keep serving a cached newer live entry indefinitely).
  const prior = entry({
    at: 5000,
    items: [pack('a', 'Q4 2:00', 28, 21)],
    itemUpdatedAtById: { a: 5000 },
  });
  const merged = mergeManualPartition({
    manualItems: [pack('a', 'scheduled', null, null)],
    prior,
    now: 3000,
  });
  assert.equal(merged.at, 5001); // strictly newer than the prior entry
  assert.equal(merged.itemUpdatedAtById!['a'], 5000); // the preserved live row keeps its own stamp
});

test('a pure manual refresh over an older prior stamps `at` at the observation time', () => {
  const prior = entry({
    at: 1000,
    items: [pack('a', 'Q1 10:00', 3, 0)],
    itemUpdatedAtById: { a: 1000 },
  });
  const merged = mergeManualPartition({
    manualItems: [pack('a', 'final', 24, 17)],
    prior,
    now: 5000,
  });
  assert.equal(merged.at, 5000); // prior (1000) is older, so no version bump is needed
});

test('pending metadata: a protected newer live final keeps pending; a manual-covered id is cleared', () => {
  const prior = entry({
    at: 1000,
    items: [pack('a', 'final', 30, 20), pack('c', 'final', 14, 7)],
    itemUpdatedAtById: { a: 9000, c: 1000 }, // `a` newer than obs, `c` older
    pendingFinalConfirmationIds: ['a', 'c'],
  });
  const merged = mergeManualPartition({
    manualItems: [pack('a', 'scheduled', null, null), pack('c', 'final', 14, 7)],
    prior,
    now: 5000,
  });
  // `a` protected (live-newer) → pending retained; `c` manual-covered → cleared.
  assert.deepEqual(merged.pendingFinalConfirmationIds, ['a']);
});

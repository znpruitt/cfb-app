/**
 * PLATFORM-086F2F — safe provider-refresh health reader tests. The single scope
 * read is injected, so no durable store is touched; records are rebuilt
 * field-by-field and malformed/ineligible ones are isolated.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { readProviderRefreshHealth } from '../providerRefreshHealth.ts';
import { PROVIDER_DATASETS, type ProviderDataset } from '../../providerDatasets.ts';
import {
  globalScope,
  legacyUnscopedScope,
  oddsTargetScope,
  providerRefreshScopeKey,
  scheduleMediaScope,
  seasonPartitionScope,
  venueCatalogScope,
  weekPartitionScope,
  yearScope,
  type ProviderRefreshScope,
} from '../../providerRefreshScope.ts';
import { defaultOddsCacheKey } from '../../../app/api/odds/routeInternals.ts';

const YEAR = 2026;
const NOW = Date.parse('2026-10-15T12:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

type Entry = { key: string; value: unknown; updatedAt: string };

function statusValue(
  dataset: ProviderDataset,
  scope: ProviderRefreshScope,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    dataset,
    scope,
    scopeKey: providerRefreshScopeKey(dataset, scope),
    lastAttemptAt: null,
    lastAttemptId: null,
    latestAttemptOutcome: null,
    latestAttemptResolvedAt: null,
    lastSuccessAt: null,
    lastError: null,
    source: null,
    rowsCommitted: null,
    partialFailure: false,
    ...overrides,
  };
}

function entry(
  dataset: ProviderDataset,
  scope: ProviderRefreshScope,
  overrides: Record<string, unknown> = {},
  keyOverride?: string
): Entry {
  const value = statusValue(dataset, scope, overrides);
  return { key: keyOverride ?? (value.scopeKey as string), value, updatedAt: iso(NOW) };
}

function loaderOf(entries: Entry[]) {
  return () => Promise.resolve(entries);
}

async function read(entries: Entry[]) {
  return readProviderRefreshHealth({ year: YEAR, loadEntries: loaderOf(entries) });
}

function rowFor(snapshot: Awaited<ReturnType<typeof read>>, dataset: ProviderDataset) {
  const row = snapshot.rows.find((r) => r.dataset === dataset);
  assert.ok(row, `expected a row for ${dataset}`);
  return row!;
}

test('returns exactly six rows in canonical order', async () => {
  const snapshot = await read([]);
  assert.equal(snapshot.subsystem, 'available');
  assert.deepEqual(
    snapshot.rows.map((r) => r.dataset),
    [...PROVIDER_DATASETS]
  );
});

test('canonical scopes: conferences=global, odds=canonical odds-target, others=year', async () => {
  const snapshot = await read([]);
  assert.equal(
    rowFor(snapshot, 'conferences').canonicalScopeKey,
    providerRefreshScopeKey('conferences', globalScope())
  );
  assert.equal(
    rowFor(snapshot, 'odds').canonicalScopeKey,
    providerRefreshScopeKey('odds', oddsTargetScope(YEAR, 'canonical', defaultOddsCacheKey(YEAR)))
  );
  assert.equal(
    rowFor(snapshot, 'scores').canonicalScopeKey,
    providerRefreshScopeKey('scores', yearScope(YEAR))
  );
});

// Case 8 — canonical year absent while a newer week-partition success is latest activity.
test('absent canonical year status + a newer week-partition success as latest activity', async () => {
  const snapshot = await read([
    entry('scores', weekPartitionScope(YEAR, 3, 'regular'), {
      latestAttemptOutcome: 'succeeded',
      lastAttemptAt: iso(NOW - 1000),
    }),
  ]);
  const scores = rowFor(snapshot, 'scores');
  assert.equal(scores.canonicalStatus.state, 'absent');
  assert.equal(scores.latestScopedActivity.state, 'available');
  assert.equal(
    scores.latestScopedActivity.state === 'available'
      ? scores.latestScopedActivity.status.scopeKey
      : null,
    providerRefreshScopeKey('scores', weekPartitionScope(YEAR, 3, 'regular'))
  );
});

// Case 9 — canonical and latest activity are both retained when they differ.
test('canonical year status and a newer week-partition activity are both retained', async () => {
  const snapshot = await read([
    entry('scores', yearScope(YEAR), {
      latestAttemptOutcome: 'succeeded',
      lastAttemptAt: iso(NOW - 100_000),
    }),
    entry('scores', weekPartitionScope(YEAR, 3, 'regular'), {
      latestAttemptOutcome: 'succeeded',
      lastAttemptAt: iso(NOW - 1000),
    }),
  ]);
  const scores = rowFor(snapshot, 'scores');
  assert.equal(
    scores.canonicalStatus.state === 'available' ? scores.canonicalStatus.status.scopeKey : null,
    providerRefreshScopeKey('scores', yearScope(YEAR))
  );
  assert.equal(
    scores.latestScopedActivity.state === 'available'
      ? scores.latestScopedActivity.status.scopeKey
      : null,
    providerRefreshScopeKey('scores', weekPartitionScope(YEAR, 3, 'regular'))
  );
});

// Latest-activity selection is by lastAttemptAt with a deterministic scopeKey tie-break.
test('latest activity selects the max lastAttemptAt (season vs week partition)', async () => {
  const snapshot = await read([
    entry('scores', seasonPartitionScope(YEAR, 'regular'), {
      latestAttemptOutcome: 'succeeded',
      lastAttemptAt: iso(NOW - 5000),
    }),
    entry('scores', weekPartitionScope(YEAR, 7, 'regular'), {
      latestAttemptOutcome: 'partial',
      lastAttemptAt: iso(NOW - 500),
    }),
  ]);
  const scores = rowFor(snapshot, 'scores');
  assert.equal(
    scores.latestScopedActivity.state === 'available'
      ? scores.latestScopedActivity.status.scopeKey
      : null,
    providerRefreshScopeKey('scores', weekPartitionScope(YEAR, 7, 'regular'))
  );
});

// Case 10 — other-year / legacy-unscoped / mismatched-key / malformed cannot be selected-year activity.
test('ineligible or malformed records never become selected-year activity', async () => {
  const snapshot = await read([
    // Different year — excluded.
    entry('scores', yearScope(2025), {
      latestAttemptOutcome: 'succeeded',
      lastAttemptAt: iso(NOW),
    }),
    // Legacy-unscoped — excluded.
    entry('scores', legacyUnscopedScope(), {
      latestAttemptOutcome: 'succeeded',
      lastAttemptAt: iso(NOW),
    }),
    // Mismatched durable key (stored under a key that is not its own scopeKey) — rejected.
    entry(
      'scores',
      weekPartitionScope(YEAR, 3, 'regular'),
      { latestAttemptOutcome: 'succeeded', lastAttemptAt: iso(NOW) },
      'scores:week:2026:9:regular'
    ),
    // Malformed value at a non-canonical key — rejected, isolated.
    { key: 'scores:season:2026:regular', value: { nonsense: true }, updatedAt: iso(NOW) },
  ]);
  const scores = rowFor(snapshot, 'scores');
  assert.equal(scores.canonicalStatus.state, 'absent');
  assert.equal(scores.latestScopedActivity.state, 'absent');
});

// Case 11 — one malformed row does not contaminate valid siblings; canonical malformed → invalid.
test('a malformed canonical record is invalid and does not contaminate a valid sibling', async () => {
  const oddsCanonicalKey = providerRefreshScopeKey(
    'odds',
    oddsTargetScope(YEAR, 'canonical', defaultOddsCacheKey(YEAR))
  );
  const snapshot = await read([
    entry('schedule', yearScope(YEAR), {
      latestAttemptOutcome: 'succeeded',
      lastAttemptAt: iso(NOW - 1000),
    }),
    { key: oddsCanonicalKey, value: { dataset: 'odds', garbage: true }, updatedAt: iso(NOW) },
  ]);
  const schedule = rowFor(snapshot, 'schedule');
  const odds = rowFor(snapshot, 'odds');
  assert.equal(schedule.canonicalStatus.state, 'available');
  assert.equal(odds.canonicalStatus.state, 'invalid');
});

// A dataset/scope-key disagreement (via authority) is rejected, not trusted.
test('a record whose scopeKey disagrees with the authority is rejected', async () => {
  const snapshot = await read([
    {
      key: 'scores:year:2026',
      value: {
        dataset: 'scores',
        scope: { kind: 'year', year: 2026 },
        scopeKey: 'scores:year:9999', // disagrees with authority + key
        lastAttemptAt: iso(NOW),
        latestAttemptOutcome: 'succeeded',
        lastError: null,
      },
      updatedAt: iso(NOW),
    },
  ]);
  // Raw present at the canonical key but unparseable → invalid, not available.
  assert.equal(rowFor(snapshot, 'scores').canonicalStatus.state, 'invalid');
});

// Eligibility: global counts only for conferences; venue-catalog only for schedule; odds filtered variant counts.
test('scope eligibility is dataset-specific (global→conferences, venue-catalog→schedule, filtered odds counts)', async () => {
  const snapshot = await read([
    entry('conferences', globalScope(), {
      latestAttemptOutcome: 'succeeded',
      lastAttemptAt: iso(NOW - 1000),
    }),
    entry('schedule', venueCatalogScope(), {
      latestAttemptOutcome: 'succeeded',
      lastAttemptAt: iso(NOW - 1000),
    }),
    entry('schedule', scheduleMediaScope(YEAR), {
      latestAttemptOutcome: 'succeeded',
      lastAttemptAt: iso(NOW - 500),
    }),
    entry('odds', oddsTargetScope(YEAR, 'filtered', 'k'), {
      latestAttemptOutcome: 'succeeded',
      lastAttemptAt: iso(NOW - 1000),
    }),
  ]);
  // Conferences: canonical is global, and it is also the latest activity (same record).
  const conferences = rowFor(snapshot, 'conferences');
  assert.equal(conferences.canonicalStatus.state, 'available');
  assert.equal(conferences.latestScopedActivity.state, 'available');
  // Schedule: latest activity is the newer schedule-media record; venue-catalog is also eligible.
  const schedule = rowFor(snapshot, 'schedule');
  assert.equal(
    schedule.latestScopedActivity.state === 'available'
      ? schedule.latestScopedActivity.status.scopeKey
      : null,
    providerRefreshScopeKey('schedule', scheduleMediaScope(YEAR))
  );
  // Odds: a filtered-variant refresh counts as scoped activity even though canonical is absent.
  const odds = rowFor(snapshot, 'odds');
  assert.equal(odds.canonicalStatus.state, 'absent');
  assert.equal(odds.latestScopedActivity.state, 'available');
});

// A structurally-valid record under a scope kind the dataset never owns is excluded.
test('a scope kind the dataset never owns (rankings week partition) is not eligible activity', async () => {
  const snapshot = await read([
    entry('rankings', weekPartitionScope(YEAR, 3, 'regular'), {
      latestAttemptOutcome: 'succeeded',
      lastAttemptAt: iso(NOW),
    }),
  ]);
  const rankings = rowFor(snapshot, 'rankings');
  // Rankings only writes year-scoped status; a week-partition record is misrouted
  // and must never become its latest activity.
  assert.equal(rankings.latestScopedActivity.state, 'absent');
});

// A record with no valid lastAttemptAt is not selectable as latest activity.
test('a record without a valid lastAttemptAt is not selectable as latest activity', async () => {
  const snapshot = await read([
    entry('rankings', yearScope(YEAR), { latestAttemptOutcome: 'succeeded', lastAttemptAt: null }),
  ]);
  const rankings = rowFor(snapshot, 'rankings');
  // Present at the canonical key → canonical available; but no timestamp → not latest activity.
  assert.equal(rankings.canonicalStatus.state, 'available');
  assert.equal(rankings.latestScopedActivity.state, 'absent');
});

// r4 Finding — a lenient-but-non-canonical timestamp string is rejected, never serialized.
test('a malformed non-ISO timestamp is dropped (not serialized) and not usable for ordering', async () => {
  const snapshot = await read([
    entry('scores', yearScope(YEAR), {
      latestAttemptOutcome: 'succeeded',
      lastAttemptAt: '2026-10-15 (/private/tmp)', // Date.parse accepts this, ISO round-trip does not
    }),
  ]);
  const scores = rowFor(snapshot, 'scores');
  assert.equal(scores.canonicalStatus.state, 'available');
  if (scores.canonicalStatus.state === 'available') {
    assert.equal(scores.canonicalStatus.status.lastAttemptAt, null);
  }
  // Without a valid lastAttemptAt the record is not selectable as latest activity.
  assert.equal(scores.latestScopedActivity.state, 'absent');
  assert.ok(
    !JSON.stringify(snapshot).includes('/private/tmp'),
    'malformed timestamp never serialized'
  );
});

// Case 12 (reader) — a failed scope read → subsystem unavailable, six unavailable rows.
test('a failed scope read → subsystem unavailable with six unavailable rows', async () => {
  const snapshot = await readProviderRefreshHealth({
    year: YEAR,
    loadEntries: () => Promise.reject(new Error('scope boom')),
  });
  assert.equal(snapshot.subsystem, 'unavailable');
  assert.equal(snapshot.rows.length, 6);
  assert.ok(snapshot.rows.every((r) => r.canonicalStatus.state === 'unavailable'));
  assert.ok(snapshot.rows.every((r) => r.latestScopedActivity.state === 'unavailable'));
});

// Sanitization: lastError.message and source never survive the rebuild.
test('rebuild drops lastError.message and source, keeping only validated error code/status', async () => {
  const snapshot = await read([
    entry('scores', yearScope(YEAR), {
      latestAttemptOutcome: 'failed',
      lastAttemptAt: iso(NOW - 1000),
      lastError: { message: 'raw secret text', code: 'RATE_LIMIT', status: 429 },
      source: 'raw source text',
    }),
  ]);
  const scores = rowFor(snapshot, 'scores');
  assert.equal(scores.canonicalStatus.state, 'available');
  if (scores.canonicalStatus.state === 'available') {
    const status = scores.canonicalStatus.status;
    assert.equal(status.errorCode, 'RATE_LIMIT');
    assert.equal(status.errorStatus, 429);
    assert.ok(!('source' in status));
    assert.ok(!JSON.stringify(status).includes('raw secret text'));
    assert.ok(!JSON.stringify(status).includes('raw source text'));
  }
});

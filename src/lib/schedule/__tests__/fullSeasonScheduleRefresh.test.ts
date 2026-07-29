import assert from 'node:assert/strict';
import test from 'node:test';

// Install the global AsyncLocalStorage before the Next storage module loads so the
// authority's `revalidateTag` (via invalidateStandings) runs under node:test.
import '../../../app/api/draft/[slug]/[year]/__tests__/_setup/installAsyncLocalStorage';
import { workAsyncStorage } from 'next/dist/server/app-render/work-async-storage.external';

import { refreshFullSeasonSchedule } from '../fullSeasonScheduleRefresh.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateWriteFailureForTests,
  getAppState,
  setAppState,
} from '../../server/appStateStore.ts';
import { getProviderRefreshStatus } from '../../server/providerRefreshStatus.ts';
import { yearScope } from '../../providerRefreshScope.ts';
import {
  SCHEDULE_ROUTE_CACHE,
  resetScheduleRouteCacheForTests,
} from '../../../app/api/schedule/cache.ts';
import type { CacheEntry } from '../../../app/api/schedule/cache.ts';

const YEAR = 2031;
const T0 = Date.parse('2031-08-01T12:00:00.000Z');
const MUTABLE_ENV = process.env as Record<string, string | undefined>;
const ORIGINAL_CFBD_API_KEY = process.env.CFBD_API_KEY;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_FETCH = globalThis.fetch;

type PartitionResponse = string | 'throw' | { status: number; body?: string };

function stubFetchBySeasonType(regular: PartitionResponse, postseason: PartitionResponse): void {
  globalThis.fetch = (async (input: URL | string) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const cfg = url.searchParams.get('seasonType') === 'postseason' ? postseason : regular;
    if (cfg === 'throw') throw new Error('network down');
    if (typeof cfg === 'object') {
      return new Response(cfg.body ?? 'err', {
        status: cfg.status,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(cfg, { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

function game(week: number, home: string, away: string, startDate: string, id: number): string {
  return JSON.stringify([
    {
      id,
      week,
      home_team: home,
      away_team: away,
      start_date: startDate,
      home_conference: 'Big 12',
      away_conference: 'American',
    },
  ]);
}

async function registerLeague(): Promise<void> {
  await setAppState('leagues', 'registry', [
    { slug: 'alpha', displayName: 'Alpha', year: YEAR, createdAt: '2031-01-01T00:00:00.000Z' },
  ]);
}

async function runCapturingTags<T>(fn: () => Promise<T>): Promise<{ result: T; tags: string[] }> {
  const store = {
    route: '/test',
    incrementalCache: {},
    pendingRevalidatedTags: [] as string[],
    pathWasRevalidated: false,
  };
  return workAsyncStorage.run(store as never, async () => {
    const result = await fn();
    return { result, tags: store.pendingRevalidatedTags };
  });
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  resetScheduleRouteCacheForTests();
  MUTABLE_ENV.NODE_ENV = 'development';
  MUTABLE_ENV.CFBD_API_KEY = 'test-cfbd-token';
});

test.after(() => {
  MUTABLE_ENV.NODE_ENV = ORIGINAL_NODE_ENV;
  if (ORIGINAL_CFBD_API_KEY === undefined) delete MUTABLE_ENV.CFBD_API_KEY;
  else MUTABLE_ENV.CFBD_API_KEY = ORIGINAL_CFBD_API_KEY;
  globalThis.fetch = ORIGINAL_FETCH;
});

// 1 — regular + postseason success commits one complete aggregate.
test('regular and postseason success commits one complete aggregate', async () => {
  await registerLeague();
  stubFetchBySeasonType(
    game(1, 'Texas', 'Rice', '2031-09-01T00:00:00Z', 1),
    game(16, 'Georgia', 'Ohio State', '2032-01-08T00:00:00Z', 2)
  );

  const { result } = await runCapturingTags(() =>
    refreshFullSeasonSchedule({ year: YEAR, now: T0 })
  );
  assert.equal(result.status, 'success');
  assert.equal(result.reason, 'written-clean');
  assert.equal(result.dataChanged, true);
  assert.equal(result.rowsCommitted, 2);

  const stored = await getAppState<CacheEntry>('schedule', `${YEAR}-all-all`);
  assert.equal(stored?.value?.items?.length, 2, 'one aggregate holds both partitions');

  const status = await getProviderRefreshStatus('schedule', yearScope(YEAR));
  assert.equal(status.latestAttemptOutcome, 'succeeded');
  assert.equal(status.rowsCommitted, 2);
});

// 2 — a thrown partition preserves prior-good and records failure.
test('a thrown partition preserves prior-good and records failure', async () => {
  await setAppState('schedule', `${YEAR}-all-all`, {
    at: T0 - 100_000,
    items: [{ id: 'prior', week: 1, homeTeam: 'Texas', awayTeam: 'Rice', status: 'scheduled' }],
    partialFailure: false,
    failedSeasonTypes: [],
  });
  // Regular succeeds, postseason network-throws.
  stubFetchBySeasonType(game(1, 'Texas', 'Rice', '2031-09-01T00:00:00Z', 1), 'throw');

  const result = await refreshFullSeasonSchedule({ year: YEAR, now: T0 });
  assert.equal(result.status, 'failure');
  assert.equal(result.reason, 'partition-fetch-failed');
  assert.deepEqual(result.failedSeasonTypes, ['postseason']);

  const stored = await getAppState<CacheEntry>('schedule', `${YEAR}-all-all`);
  assert.equal(stored?.value?.items?.[0]?.id, 'prior', 'prior-good retained');

  const status = await getProviderRefreshStatus('schedule', yearScope(YEAR));
  assert.equal(status.latestAttemptOutcome, 'failed');
  assert.equal(status.lastError?.code, 'schedule-partition-fetch-failed');
});

// 3 — a non-array partition preserves prior-good.
test('a non-array partition is invalid payload and preserves prior-good', async () => {
  await setAppState('schedule', `${YEAR}-all-all`, {
    at: T0 - 100_000,
    items: [{ id: 'prior', week: 1, homeTeam: 'Texas', awayTeam: 'Rice', status: 'scheduled' }],
    partialFailure: false,
    failedSeasonTypes: [],
  });
  // Regular returns a non-array JSON object; postseason valid empty.
  stubFetchBySeasonType('{}', JSON.stringify([]));

  const result = await refreshFullSeasonSchedule({ year: YEAR, now: T0 });
  assert.equal(result.status, 'failure');
  assert.equal(result.reason, 'partition-invalid-payload');
  assert.deepEqual(result.failedSeasonTypes, ['regular']);

  const stored = await getAppState<CacheEntry>('schedule', `${YEAR}-all-all`);
  assert.equal(stored?.value?.items?.[0]?.id, 'prior', 'prior-good retained');
});

// 4 — a nonempty-to-zero partition is schema drift.
test('a nonempty payload normalizing to zero rows is schema drift', async () => {
  stubFetchBySeasonType(
    JSON.stringify([{ week: 1, away_team: 'Rice' }]), // missing home_team → drops → 0 mapped
    JSON.stringify([])
  );

  const result = await refreshFullSeasonSchedule({ year: YEAR, now: T0 });
  assert.equal(result.status, 'failure');
  assert.equal(result.reason, 'partition-schema-drift');
  assert.deepEqual(result.failedSeasonTypes, ['regular']);
  assert.equal(await getAppState('schedule', `${YEAR}-all-all`), null, 'nothing committed');
});

// 5 — empty postseason plus valid regular season succeeds.
test('an empty postseason partition plus a valid regular season commits (valid absence)', async () => {
  stubFetchBySeasonType(game(1, 'Texas', 'Rice', '2031-09-01T00:00:00Z', 1), JSON.stringify([]));

  const { result } = await runCapturingTags(() =>
    refreshFullSeasonSchedule({ year: YEAR, now: T0 })
  );
  assert.equal(result.status, 'success');
  assert.equal(result.rowsCommitted, 1);
  const stored = await getAppState<CacheEntry>('schedule', `${YEAR}-all-all`);
  assert.equal(stored?.value?.items?.length, 1);
});

// 6 — all-empty over prior-good is rejected.
test('an all-empty result over populated prior-good is rejected', async () => {
  await setAppState('schedule', `${YEAR}-all-all`, {
    at: T0 - 100_000,
    items: [{ id: 'prior', week: 1, homeTeam: 'Texas', awayTeam: 'Rice', status: 'scheduled' }],
    partialFailure: false,
    failedSeasonTypes: [],
  });
  stubFetchBySeasonType(JSON.stringify([]), JSON.stringify([]));

  const result = await refreshFullSeasonSchedule({ year: YEAR, now: T0 });
  assert.equal(result.status, 'failure');
  assert.equal(result.reason, 'empty-replacement-rejected');

  const stored = await getAppState<CacheEntry>('schedule', `${YEAR}-all-all`);
  assert.equal(stored?.value?.items?.[0]?.id, 'prior', 'prior-good retained');
  const status = await getProviderRefreshStatus('schedule', yearScope(YEAR));
  assert.equal(status.latestAttemptOutcome, 'failed');
  assert.equal(status.lastError?.code, 'schedule-empty-replacement-rejected');
});

// 7 — genuinely unpublished all-empty is a no-op without a write.
test('a genuinely unpublished all-empty result is a no-op without a write', async () => {
  stubFetchBySeasonType(JSON.stringify([]), JSON.stringify([]));

  const result = await refreshFullSeasonSchedule({ year: YEAR, now: T0 });
  assert.equal(result.status, 'no-op');
  assert.equal(result.reason, 'empty-response');
  assert.equal(await getAppState('schedule', `${YEAR}-all-all`), null, 'no durable write');
  const status = await getProviderRefreshStatus('schedule', yearScope(YEAR));
  assert.equal(status.latestAttemptOutcome, 'no-op');
});

// 8 — older observation cannot overwrite newer state.
test('an older observation cannot overwrite newer durable state', async () => {
  // Prior durable observed AFTER this refresh's `now`.
  await setAppState('schedule', `${YEAR}-all-all`, {
    at: T0 + 100_000,
    items: [{ id: 'newer', week: 1, homeTeam: 'Texas', awayTeam: 'Rice', status: 'scheduled' }],
    partialFailure: false,
    failedSeasonTypes: [],
  });
  stubFetchBySeasonType(game(1, 'Texas', 'Rice', '2031-09-01T00:00:00Z', 1), JSON.stringify([]));

  const result = await refreshFullSeasonSchedule({ year: YEAR, now: T0 });
  assert.equal(result.status, 'no-op');
  assert.equal(result.reason, 'stale-observation');
  const stored = await getAppState<CacheEntry>('schedule', `${YEAR}-all-all`);
  assert.equal(stored?.value?.items?.[0]?.id, 'newer', 'newer durable state preserved');
});

// 9 — equal observation preserves the prior winner.
test('an equal observation preserves the prior winner', async () => {
  await setAppState('schedule', `${YEAR}-all-all`, {
    at: T0,
    items: [{ id: 'prior', week: 1, homeTeam: 'Texas', awayTeam: 'Rice', status: 'scheduled' }],
    partialFailure: false,
    failedSeasonTypes: [],
  });
  stubFetchBySeasonType(game(1, 'Texas', 'Rice', '2031-09-01T00:00:00Z', 9), JSON.stringify([]));

  const result = await refreshFullSeasonSchedule({ year: YEAR, now: T0 });
  assert.equal(result.reason, 'stale-observation', 'equal observation loses to prior winner');
  const stored = await getAppState<CacheEntry>('schedule', `${YEAR}-all-all`);
  assert.equal(stored?.value?.items?.[0]?.id, 'prior');
});

// 13 — a transaction failure publishes no cache / status success / invalidation.
test('a transaction failure publishes no cache, no status success, and no invalidation', async () => {
  await registerLeague();
  stubFetchBySeasonType(game(1, 'Texas', 'Rice', '2031-09-01T00:00:00Z', 1), JSON.stringify([]));

  __setAppStateWriteFailureForTests(new Error('durable write down'), 'schedule');
  const { result, tags } = await runCapturingTags(() =>
    refreshFullSeasonSchedule({ year: YEAR, now: T0 })
  );
  __setAppStateWriteFailureForTests(null);

  assert.equal(result.status, 'failure');
  assert.equal(result.reason, 'durable-commit-failed');
  assert.equal(SCHEDULE_ROUTE_CACHE[`${YEAR}-all-all`], undefined, 'no process-cache publication');
  assert.deepEqual(
    tags.filter((t) => t.startsWith('standings:')),
    [],
    'no standings invalidation on a failed commit'
  );
  const status = await getProviderRefreshStatus('schedule', yearScope(YEAR));
  assert.equal(status.latestAttemptOutcome, 'failed');
  assert.equal(status.lastSuccessAt, null, 'no success recorded');
  assert.equal(status.lastError?.code, 'schedule-durable-commit-failed');
});

// 14 — unchanged data commits observation metadata without invalidating standings.
test('unchanged data commits observation metadata without invalidating standings', async () => {
  await registerLeague();
  const body = game(1, 'Texas', 'Rice', '2031-09-01T00:00:00Z', 1);
  stubFetchBySeasonType(body, JSON.stringify([]));

  // First run commits the rows (and invalidates once).
  await runCapturingTags(() => refreshFullSeasonSchedule({ year: YEAR, now: T0 }));

  // Second run, LATER observation, SAME payload → unchanged-clean.
  const { result, tags } = await runCapturingTags(() =>
    refreshFullSeasonSchedule({ year: YEAR, now: T0 + 50_000 })
  );
  assert.equal(result.status, 'success');
  assert.equal(result.reason, 'unchanged-clean');
  assert.equal(result.rowsCommitted, 0);
  assert.equal(result.dataChanged, false);
  assert.deepEqual(
    tags.filter((t) => t.startsWith('standings:')),
    [],
    'unchanged content does not invalidate standings'
  );

  // The observation metadata (at) advanced even though content did not.
  const stored = await getAppState<CacheEntry>('schedule', `${YEAR}-all-all`);
  assert.equal(stored?.value?.at, T0 + 50_000, 'newer observation metadata committed');
});

// 15 — changed data commits durable-first and invalidates once.
test('changed data commits durable-first and invalidates standings once', async () => {
  await registerLeague();
  stubFetchBySeasonType(game(1, 'Texas', 'Rice', '2031-09-01T00:00:00Z', 1), JSON.stringify([]));
  await runCapturingTags(() => refreshFullSeasonSchedule({ year: YEAR, now: T0 }));

  // Second run: a DIFFERENT game → content changes → written-clean + invalidate once.
  stubFetchBySeasonType(
    game(2, 'Ohio State', 'Michigan', '2031-10-01T00:00:00Z', 2),
    JSON.stringify([])
  );
  const { result, tags } = await runCapturingTags(() =>
    refreshFullSeasonSchedule({ year: YEAR, now: T0 + 50_000 })
  );
  assert.equal(result.reason, 'written-clean');
  assert.equal(result.dataChanged, true);
  const yearTags = tags.filter((t) => t === `standings:alpha:${YEAR}`);
  assert.equal(yearTags.length, 1, 'invalidated exactly once');

  const stored = await getAppState<CacheEntry>('schedule', `${YEAR}-all-all`);
  assert.equal(stored?.value?.items?.[0]?.homeTeam, 'Ohio State', 'durable updated to new content');
});

// 16 — missing credentials begin and resolve the exact year-scoped attempt.
test('missing credentials begin and resolve the exact year-scoped attempt', async () => {
  delete MUTABLE_ENV.CFBD_API_KEY;
  stubFetchBySeasonType(JSON.stringify([]), JSON.stringify([]));

  const result = await refreshFullSeasonSchedule({ year: YEAR, now: T0 });
  assert.equal(result.status, 'failure');
  assert.equal(result.reason, 'cfbd-api-key-missing');

  const status = await getProviderRefreshStatus('schedule', yearScope(YEAR));
  assert.equal(
    status.latestAttemptOutcome,
    'failed',
    'the exact year attempt is resolved, not dangling'
  );
  assert.equal(status.lastError?.code, 'schedule-cfbd-api-key-missing');
});

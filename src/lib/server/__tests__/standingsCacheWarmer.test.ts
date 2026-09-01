import assert from 'node:assert/strict';
import test from 'node:test';

import '../../../test/installAsyncLocalStorage';
import { workAsyncStorage } from 'next/dist/server/app-render/work-async-storage.external';

import { getCanonicalStandings } from '../../selectors/leagueStandings.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateKeyLockFailureForTests,
  setAppState,
} from '../appStateStore.ts';
import {
  __setCanonicalStandingsInvalidatorForTests,
  __setCanonicalStandingsWarmerForTests,
  __setStandingsDurableLockAttemptObserverForTests,
  invalidateAndWarmStandingsForYear,
} from '../standingsCacheWarmer.ts';

type CacheRecord = { value: unknown; isStale: false };

function fakeIncrementalCache(events: string[], beforeSet?: () => Promise<void>) {
  const records = new Map<string, CacheRecord>();
  const tagsByKey = new Map<string, string[]>();
  return {
    isOnDemandRevalidate: false,
    async generateSimpleCacheKey(key: string) {
      return key;
    },
    async get(key: string) {
      events.push(`get:${key}`);
      return records.get(key) ?? null;
    },
    async set(key: string, value: unknown, context: { tags?: string[] }) {
      events.push(`set:${key}`);
      await beforeSet?.();
      records.set(key, { value, isStale: false });
      tagsByKey.set(key, context.tags ?? []);
    },
    async revalidateTag(tags: string | string[]) {
      const requested = Array.isArray(tags) ? tags : [tags];
      events.push(`revalidate:${requested.join(',')}`);
      for (const [key, entryTags] of tagsByKey) {
        if (entryTags.some((tag) => requested.includes(tag))) {
          records.delete(key);
          tagsByKey.delete(key);
        }
      }
    },
  };
}

function nextStore(incrementalCache: ReturnType<typeof fakeIncrementalCache>) {
  return {
    route: '/api/test-standings-warm',
    incrementalCache,
    pendingRevalidatedTags: [] as string[],
    pendingRevalidates: {} as Record<string, Promise<unknown>>,
    pendingRevalidateWrites: [] as Promise<unknown>[],
    pathWasRevalidated: false,
    nextFetchId: 1,
  };
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  __setCanonicalStandingsInvalidatorForTests(null);
  __setCanonicalStandingsWarmerForTests(null);
  __setStandingsDurableLockAttemptObserverForTests(null);
});

test.afterEach(() => {
  __setCanonicalStandingsInvalidatorForTests(null);
  __setCanonicalStandingsWarmerForTests(null);
  __setStandingsDurableLockAttemptObserverForTests(null);
  __setAppStateKeyLockFailureForTests(null);
});

test('the real canonical cache is expired before warming and the next request hits it', async () => {
  const year = 2026;
  const slug = 'cache-proof';
  await setAppState('leagues', 'registry', [
    {
      slug,
      displayName: 'Cache Proof',
      year,
      status: { state: 'preseason', year },
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ]);

  const events: string[] = [];
  let releaseSet!: () => void;
  const setBlocked = new Promise<void>((resolve) => {
    releaseSet = resolve;
  });
  let markSetStarted!: () => void;
  const setStarted = new Promise<void>((resolve) => {
    markSetStarted = resolve;
  });
  const cache = fakeIncrementalCache(events, async () => {
    markSetStarted();
    await setBlocked;
  });
  let maintenanceResolved = false;
  const maintenance = workAsyncStorage
    .run(nextStore(cache) as never, () => invalidateAndWarmStandingsForYear(year))
    .then(() => {
      maintenanceResolved = true;
    });
  await setStarted;
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  assert.equal(maintenanceResolved, false, 'maintenance waits for the real cache publication');
  releaseSet();
  await maintenance;

  const revalidateIndex = events.findIndex((event) => event.startsWith('revalidate:'));
  const firstSetIndex = events.findIndex((event) => event.startsWith('set:'));
  assert.ok(revalidateIndex >= 0, 'the observer saw the immediate tag expiration');
  assert.ok(firstSetIndex > revalidateIndex, 'the real canonical cache write follows expiration');
  const setCountAfterWarm = events.filter((event) => event.startsWith('set:')).length;
  const getCountAfterWarm = events.filter((event) => event.startsWith('get:')).length;

  await workAsyncStorage.run(nextStore(cache) as never, () =>
    getCanonicalStandings({ slug, year, currentDate: new Date('2026-08-31T12:00:00Z') })
  );

  assert.equal(
    events.filter((event) => event.startsWith('get:')).length,
    getCountAfterWarm + 1,
    'the next request consulted the shared data cache'
  );
  assert.equal(
    events.filter((event) => event.startsWith('set:')).length,
    setCountAfterWarm,
    'the next request hit the warm snapshot instead of recomputing it'
  );
});

test('different-year maintenance is serialized before either operation borrows a pool client', async () => {
  const olderYear = 2026;
  const newerYear = 2025;
  await setAppState('leagues', 'registry', [
    {
      slug: 'serialized',
      displayName: 'Serialized',
      year: olderYear,
      status: { state: 'season', year: olderYear },
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ]);
  let invalidations = 0;
  const durableLockAttempts: number[] = [];
  __setStandingsDurableLockAttemptObserverForTests((year) => {
    durableLockAttempts.push(year);
  });
  __setCanonicalStandingsInvalidatorForTests(async () => {
    invalidations += 1;
    return true;
  });

  let releaseFirst!: () => void;
  const firstBlocked = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let firstStarted!: () => void;
  const sawFirst = new Promise<void>((resolve) => {
    firstStarted = resolve;
  });
  const order: string[] = [];
  let attempts = 0;
  __setCanonicalStandingsWarmerForTests(async (_slug, year) => {
    attempts += 1;
    order.push(`start-${year}`);
    if (year === olderYear) {
      firstStarted();
      await firstBlocked;
    }
    order.push(`end-${year}`);
  });

  const older = invalidateAndWarmStandingsForYear(olderYear);
  await sawFirst;
  const newer = invalidateAndWarmStandingsForYear(newerYear);
  await new Promise<void>((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(
    durableLockAttempts,
    [olderYear],
    'a different-year waiter does not consume another database-pool client'
  );
  assert.equal(invalidations, 1, 'the later invalidation also waits behind process maintenance');
  assert.equal(attempts, 1, 'the later writer cannot enter while the older warm is pending');
  releaseFirst();
  await Promise.all([older, newer]);

  assert.deepEqual(order, [
    `start-${olderYear}`,
    `end-${olderYear}`,
    `start-${newerYear}`,
    `end-${newerYear}`,
  ]);
  assert.equal(invalidations, 2, 'the observer detects the later invalidation after release');
  assert.deepEqual(
    durableLockAttempts,
    [olderYear, newerYear],
    'the positive control observes the waiter borrowing a client after release'
  );
});

test('a durable warm-lock failure still attempts post-commit invalidation', async () => {
  const year = 2026;
  await setAppState('leagues', 'registry', [
    {
      slug: 'fallback',
      displayName: 'Fallback',
      year,
      status: { state: 'season', year },
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ]);
  let invalidations = 0;
  let warmAttempts = 0;
  __setCanonicalStandingsInvalidatorForTests(async () => {
    invalidations += 1;
    return true;
  });
  __setCanonicalStandingsWarmerForTests(async () => {
    warmAttempts += 1;
  });
  __setAppStateKeyLockFailureForTests(
    new Error('database pool unavailable'),
    'standings-cache-warm'
  );

  await invalidateAndWarmStandingsForYear(year);

  assert.equal(invalidations, 1, 'the fallback preserves mandatory invalidation');
  assert.equal(warmAttempts, 0, 'warming is skipped when it cannot be serialized safely');
});

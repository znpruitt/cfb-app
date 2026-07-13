import assert from 'node:assert/strict';
import test from 'node:test';

// Install the global AsyncLocalStorage before the Next storage module loads so
// the route's `revalidateTag` (via invalidateStandings) runs under node:test.
import '../../../draft/[slug]/[year]/__tests__/_setup/installAsyncLocalStorage';
import { workAsyncStorage } from 'next/dist/server/app-render/work-async-storage.external';

import { GET } from '../route';
import type { League } from '../../../../../lib/league.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateWriteFailureForTests,
  getAppState,
  setAppState,
} from '../../../../../lib/server/appStateStore.ts';
import { getProviderRefreshStatus } from '../../../../../lib/server/providerRefreshStatus.ts';

// ---------------------------------------------------------------------------
// PLATFORM-071 — cron season-transition must invalidate standings for each
// league it flips preseason → season (preseason owner list → live standings).
// Previously it wrote status/year but left warm standings snapshots stale
// (documented gap).
//
// The success path drives the transition from a seeded schedule-probe with a
// past firstGameDate; the upstream CFBD fetch is stubbed (empty schedule) so the
// test is deterministic regardless of whether a real CFBD_API_KEY is present,
// and the seeded probe alone satisfies the transition time gate.
// ---------------------------------------------------------------------------

const CRON_SECRET = 'test-cron-secret';
const YEAR = 2023;
const MUTABLE_ENV = process.env as Record<string, string | undefined>;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;
const ORIGINAL_CFBD_API_KEY = process.env.CFBD_API_KEY;
const ORIGINAL_FETCH = globalThis.fetch;

// Neutralize the upstream CFBD fetch so the test is deterministic (no real
// network, no quota use). Returning an empty schedule leaves the seeded
// past-firstGameDate probe as the sole driver of the transition. `beforeEach`
// sets CFBD_API_KEY so the route (which reads the key at call time) actually
// invokes this stub.
function stubFetchEmptySchedule(): void {
  globalThis.fetch = (async () =>
    new Response('[]', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
}

// Mock CFBD so `regular` and `postseason` partitions can be controlled
// independently by `?seasonType=`. Each arg is either a JSON body string or the
// literal 'throw' to simulate a fetch failure for that partition.
function stubFetchBySeasonType(regular: string | 'throw', postseason: string | 'throw'): void {
  globalThis.fetch = (async (input: URL | string) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const seasonType = url.searchParams.get('seasonType');
    const body = seasonType === 'postseason' ? postseason : regular;
    if (body === 'throw') {
      return new Response('upstream unavailable', { status: 503 });
    }
    return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

function game(
  week: number,
  home: string,
  away: string,
  startDate: string
): Record<string, unknown> {
  return {
    id: `${week}-${home}-${away}`,
    week,
    home_team: home,
    away_team: away,
    start_date: startDate,
    completed: false,
  };
}

function makeLeague(slug: string, status: League['status']): League {
  return {
    slug,
    displayName: `League ${slug}`,
    year: YEAR,
    createdAt: '2022-01-01T00:00:00.000Z',
    status,
  };
}

async function seedPastProbe(): Promise<void> {
  // baseCachedAt set + firstGameDate in the past → the transition time gate
  // (now >= firstGame − 1 day) is satisfied.
  await setAppState('schedule-probe', String(YEAR), {
    year: YEAR,
    baseCachedAt: '2023-01-01T00:00:00.000Z',
    firstGameDate: '2023-08-26T00:00:00.000Z',
  });
}

function cronRequest(secret: string | null = CRON_SECRET): Request {
  const headers: Record<string, string> = {};
  if (secret) headers['authorization'] = `Bearer ${secret}`;
  return new Request('https://example.com/api/cron/season-transition', { headers });
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
  MUTABLE_ENV.NODE_ENV = 'development';
  MUTABLE_ENV.CRON_SECRET = CRON_SECRET;
  // The route now reads CFBD_API_KEY at call time, so a set key lets the mocked
  // fetch actually run (partial/complete completeness tests depend on this).
  MUTABLE_ENV.CFBD_API_KEY = 'test-cfbd-token';
  stubFetchEmptySchedule();
});

test.after(() => {
  MUTABLE_ENV.NODE_ENV = ORIGINAL_NODE_ENV;
  if (ORIGINAL_CRON_SECRET === undefined) delete MUTABLE_ENV.CRON_SECRET;
  else MUTABLE_ENV.CRON_SECRET = ORIGINAL_CRON_SECRET;
  if (ORIGINAL_CFBD_API_KEY === undefined) delete MUTABLE_ENV.CFBD_API_KEY;
  else MUTABLE_ENV.CFBD_API_KEY = ORIGINAL_CFBD_API_KEY;
  globalThis.fetch = ORIGINAL_FETCH;
});

test('a completed transition invalidates standings for each transitioned league', async () => {
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', { state: 'preseason', year: YEAR }),
  ]);
  await seedPastProbe();

  const { result: res, tags } = await runCapturingTags(() => GET(cronRequest()));
  const body = (await res.json()) as { years: Array<{ transitioned: boolean; leagues: string[] }> };
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.years[0]?.transitioned, true, 'alpha transitioned');
  assert.deepEqual(body.years[0]?.leagues, ['alpha']);
  assert.ok(tags.includes('standings:alpha'), 'transitioned league standings invalidated');

  // The transition actually happened (status is now season).
  const leagues = await getAppState<League[]>('leagues', 'registry');
  assert.equal(leagues?.value?.[0]?.status?.state, 'season');
});

test('an all-empty schedule probe resolves the attempt as a no-op, not dangling in-progress (rereview finding #2)', async () => {
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', { state: 'preseason', year: YEAR }),
  ]);
  // No probe seeded → shouldFetch is true; the stubbed fetch returns empty for
  // both partitions (valid absence — a future season not yet published).
  stubFetchEmptySchedule();

  const res = await GET(cronRequest());
  assert.equal(res.status, 200);

  const status = await getProviderRefreshStatus('schedule');
  assert.equal(status.latestAttemptOutcome, 'no-op', 'all-empty probe resolves as a no-op');
  assert.notEqual(status.latestAttemptOutcome, 'in-progress', 'the attempt does not dangle');
  assert.equal(status.lastSuccessAt, null, 'a no-op does not advance last-success');
});

test('a schedule persistence failure resolves the attempt as failed, not dangling (rereview finding #2)', async () => {
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', { state: 'preseason', year: YEAR }),
  ]);
  // Regular returns a real game (postseason empty) so the commit path runs.
  stubFetchBySeasonType(
    JSON.stringify([game(1, 'Texas', 'Rice', '2023-08-26T00:00:00.000Z')]),
    '[]'
  );

  // Fail only the durable 'schedule' write, so the best-effort status write (a
  // different scope) still persists the resolved failure.
  __setAppStateWriteFailureForTests(new Error('durable write unavailable'), 'schedule');
  let res: Response;
  try {
    res = await GET(cronRequest());
  } finally {
    __setAppStateWriteFailureForTests(null);
  }
  assert.equal(res.status, 500, 'a persistence failure surfaces as a 500');

  const status = await getProviderRefreshStatus('schedule');
  assert.equal(status.latestAttemptOutcome, 'failed', 'the open attempt is resolved as failed');
  assert.equal(status.lastError?.code, 'schedule-durable-commit-failed');
});

test('an unauthorized request invalidates nothing', async () => {
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', { state: 'preseason', year: YEAR }),
  ]);
  await seedPastProbe();

  const { result: res, tags } = await runCapturingTags(() => GET(cronRequest('wrong-secret')));
  assert.equal(res.status, 401);
  assert.deepEqual(
    tags.filter((t) => t.startsWith('standings:')),
    []
  );
});

test('no preseason leagues → invalidates nothing', async () => {
  await setAppState('leagues', 'registry', [makeLeague('alpha', { state: 'season', year: YEAR })]);

  const { result: res, tags } = await runCapturingTags(() => GET(cronRequest()));
  assert.equal(res.status, 200);
  assert.deepEqual(
    tags.filter((t) => t.startsWith('standings:')),
    []
  );
});

// ---------------------------------------------------------------------------
// PLATFORM-085B — a transition schedule refresh must not commit partial or
// uncertain provider results as a complete fresh schedule.
// ---------------------------------------------------------------------------

test('a partial transition fetch (postseason fails) does not commit partial schedule as complete', async () => {
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', { state: 'preseason', year: YEAR }),
  ]);
  // No prior probe/schedule. Regular succeeds; postseason request fails.
  stubFetchBySeasonType(
    JSON.stringify([game(1, 'Texas', 'Rice', '2099-09-01T00:00:00Z')]),
    'throw'
  );

  const { result: res, tags } = await runCapturingTags(() => GET(cronRequest()));
  const body = (await res.json()) as {
    years: Array<{
      probed: boolean;
      cached: boolean;
      transitioned: boolean;
      partialFailure?: boolean;
      failedSeasonTypes?: string[];
    }>;
  };
  assert.equal(res.status, 200, JSON.stringify(body));

  const yr = body.years[0]!;
  assert.equal(yr.probed, true);
  assert.equal(yr.cached, false, 'partial data not committed');
  assert.equal(yr.partialFailure, true);
  assert.deepEqual(yr.failedSeasonTypes, ['postseason']);
  assert.equal(yr.transitioned, false);

  // Neither the durable schedule nor the probe were written from partial data.
  assert.equal(await getAppState('schedule', `${YEAR}-all-all`), null);
  assert.equal(await getAppState('schedule-probe', String(YEAR)), null);

  // No standings invalidation from an incomplete refresh.
  assert.deepEqual(
    tags.filter((t) => t.startsWith('standings:')),
    []
  );
});

test('a partial transition fetch retains prior-good durable schedule', async () => {
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', { state: 'preseason', year: YEAR }),
  ]);
  // Prior-good COMPLETE schedule already cached.
  await setAppState('schedule', `${YEAR}-all-all`, {
    at: 1,
    items: [
      {
        id: 'prior',
        week: 1,
        startDate: '2099-09-01T00:00:00.000Z',
        homeTeam: 'Texas',
        awayTeam: 'Rice',
        status: 'scheduled',
        seasonType: 'regular',
      },
    ],
    partialFailure: false,
    failedSeasonTypes: [],
  });
  // Probe with firstGameDate=null → shouldFetch=true but the transition gate
  // (needs a firstGameDate) does not fire, isolating the retain-on-partial path.
  await setAppState('schedule-probe', String(YEAR), {
    year: YEAR,
    baseCachedAt: '2023-01-01T00:00:00.000Z',
    firstGameDate: null,
  });

  // Regular succeeds with a DIFFERENT game; postseason fails → incomplete.
  stubFetchBySeasonType(
    JSON.stringify([game(2, 'Ohio State', 'Michigan', '2099-10-01T00:00:00Z')]),
    'throw'
  );

  const { result: res } = await runCapturingTags(() => GET(cronRequest()));
  assert.equal(res.status, 200);

  // Prior-good schedule is intact — NOT overwritten with the partial regular-only fetch.
  const stored = await getAppState<{ items: Array<{ id: string }> }>('schedule', `${YEAR}-all-all`);
  assert.equal(stored?.value?.items?.length, 1);
  assert.equal(stored?.value?.items?.[0]?.id, 'prior', 'prior-good schedule retained');
});

test('a nonempty payload that normalizes to zero rows is treated as uncertainty (schema drift)', async () => {
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', { state: 'preseason', year: YEAR }),
  ]);
  // Regular returns a NONEMPTY payload whose rows all fail to map (missing
  // home_team) → schema drift; postseason returns a valid EMPTY payload.
  stubFetchBySeasonType(JSON.stringify([{ week: 1, away_team: 'Rice' }]), JSON.stringify([]));

  const { result: res } = await runCapturingTags(() => GET(cronRequest()));
  const body = (await res.json()) as {
    years: Array<{ cached: boolean; partialFailure?: boolean; failedSeasonTypes?: string[] }>;
  };
  assert.equal(res.status, 200);
  assert.equal(body.years[0]?.cached, false);
  assert.equal(body.years[0]?.partialFailure, true);
  assert.deepEqual(body.years[0]?.failedSeasonTypes, ['regular']);
  assert.equal(await getAppState('schedule', `${YEAR}-all-all`), null);
});

test('a complete transition fetch commits durable schedule and probe', async () => {
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', { state: 'preseason', year: YEAR }),
  ]);
  // Both partitions succeed: regular has a future game; postseason is legitimately
  // empty (valid absence before bowl season).
  stubFetchBySeasonType(
    JSON.stringify([game(1, 'Texas', 'Rice', '2099-09-01T00:00:00Z')]),
    JSON.stringify([])
  );

  const { result: res, tags } = await runCapturingTags(() => GET(cronRequest()));
  const body = (await res.json()) as {
    years: Array<{ cached: boolean; partialFailure?: boolean; transitioned: boolean }>;
  };
  assert.equal(res.status, 200);
  assert.equal(body.years[0]?.cached, true, 'complete schedule committed');
  assert.notEqual(body.years[0]?.partialFailure, true);

  // Durable schedule + probe written from the complete fetch.
  const stored = await getAppState<{ items: unknown[] }>('schedule', `${YEAR}-all-all`);
  assert.equal(stored?.value?.items?.length, 1);
  const probe = await getAppState<{ firstGameDate: string | null }>('schedule-probe', String(YEAR));
  assert.equal(probe?.value?.firstGameDate, '2099-09-01T00:00:00.000Z');

  // Future first game → no transition yet, so no standings invalidation.
  assert.equal(body.years[0]?.transitioned, false);
  assert.deepEqual(
    tags.filter((t) => t.startsWith('standings:')),
    []
  );
});

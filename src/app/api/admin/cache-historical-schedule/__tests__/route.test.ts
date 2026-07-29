import assert from 'node:assert/strict';
import test from 'node:test';

// Install the global AsyncLocalStorage before Next's storage module loads so the
// shared authority's `revalidateTag` (via invalidateStandings) runs under node:test.
import '../../../draft/[slug]/[year]/__tests__/_setup/installAsyncLocalStorage';
import { workAsyncStorage } from 'next/dist/server/app-render/work-async-storage.external';

import { POST } from '../route';
import { seasonYearForToday } from '../../../../../lib/scores/normalizers.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  getAppState,
  setAppState,
} from '../../../../../lib/server/appStateStore.ts';

const MUTABLE_ENV = process.env as Record<string, string | undefined>;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_ADMIN_TOKEN = process.env.ADMIN_API_TOKEN;
const ORIGINAL_CFBD_API_KEY = process.env.CFBD_API_KEY;
const ORIGINAL_FETCH = globalThis.fetch;

function post(body: unknown): Request {
  return new Request('http://localhost/api/admin/cache-historical-schedule', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

type PartitionResponse = string | 'throw';
function stubFetchBySeasonType(regular: PartitionResponse, postseason: PartitionResponse): void {
  globalThis.fetch = (async (input: URL | string) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const cfg = url.searchParams.get('seasonType') === 'postseason' ? postseason : regular;
    if (cfg === 'throw') throw new Error('network down');
    return new Response(cfg, { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

async function runCapturingTags<T>(fn: () => Promise<T>): Promise<T> {
  const store = {
    route: '/test',
    incrementalCache: {},
    pendingRevalidatedTags: [] as string[],
    pathWasRevalidated: false,
  };
  return workAsyncStorage.run(store as never, fn);
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  MUTABLE_ENV.NODE_ENV = 'development';
  delete MUTABLE_ENV.ADMIN_API_TOKEN; // dev + no token → every request is admin
  MUTABLE_ENV.CFBD_API_KEY = 'test-cfbd-token';
});

test.after(() => {
  MUTABLE_ENV.NODE_ENV = ORIGINAL_NODE_ENV;
  if (ORIGINAL_ADMIN_TOKEN === undefined) delete MUTABLE_ENV.ADMIN_API_TOKEN;
  else MUTABLE_ENV.ADMIN_API_TOKEN = ORIGINAL_ADMIN_TOKEN;
  if (ORIGINAL_CFBD_API_KEY === undefined) delete MUTABLE_ENV.CFBD_API_KEY;
  else MUTABLE_ENV.CFBD_API_KEY = ORIGINAL_CFBD_API_KEY;
  globalThis.fetch = ORIGINAL_FETCH;
});

// 21 — historical repair rejects the inferred current season.
test('historical repair rejects the app-inferred current season', async () => {
  const res = await runCapturingTags(() => POST(post({ year: seasonYearForToday() })));
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.match(String(json.error ?? ''), /active season/i);
});

// 22 — historical repair rejects every preseason/season league year despite force.
test('historical repair rejects a preseason/season league year even with force=1', async () => {
  const leagueYear = seasonYearForToday() + 3; // not the inferred current year
  await setAppState('leagues', 'registry', [
    {
      slug: 'alpha',
      displayName: 'Alpha',
      year: leagueYear,
      createdAt: '2031-01-01T00:00:00.000Z',
      status: { state: 'season', year: leagueYear },
    },
  ]);

  const res = await runCapturingTags(() => POST(post({ year: leagueYear, force: true })));
  assert.equal(res.status, 400, 'force must NOT bypass active-year protection');
  const json = await res.json();
  assert.match(String(json.error ?? ''), /active season/i);

  // Nothing was written for the protected year.
  assert.equal(await getAppState('schedule', `${leagueYear}-all-all`), null);
});

// 23 — a valid historical repair receives full completeness protection.
test('a valid historical year gets completeness protection (schema drift is rejected, not committed)', async () => {
  const historicalYear = 2005; // < inferred current year, no league
  // Regular normalizes a NONEMPTY payload to zero rows (schema drift); postseason empty.
  stubFetchBySeasonType(JSON.stringify([{ week: 1, away_team: 'Rice' }]), JSON.stringify([]));

  const res = await runCapturingTags(() => POST(post({ year: historicalYear })));
  assert.equal(res.status, 502);
  const json = await res.json();
  assert.equal(json.code, 'partition-schema-drift');
  assert.equal(
    await getAppState('schedule', `${historicalYear}-all-all`),
    null,
    'no commit on drift'
  );
});

// 23b — a clean valid historical repair commits via the shared authority.
test('a clean valid historical repair commits via the shared authority', async () => {
  const historicalYear = 2005;
  stubFetchBySeasonType(
    JSON.stringify([
      {
        id: 1,
        week: 1,
        home_team: 'Texas',
        away_team: 'Rice',
        start_date: '2005-09-01T00:00:00Z',
        home_conference: 'Big 12',
        away_conference: 'American',
      },
    ]),
    JSON.stringify([])
  );

  const res = await runCapturingTags(() => POST(post({ year: historicalYear })));
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.success, true);
  assert.equal(json.gameCount, 1);

  const stored = await getAppState<{ items: unknown[] }>('schedule', `${historicalYear}-all-all`);
  assert.equal(stored?.value?.items?.length, 1);
});

// 23c — without force, an already-cached historical year short-circuits (no fetch).
test('an already-cached historical year short-circuits without force (no provider call)', async () => {
  const historicalYear = 2005;
  await setAppState('schedule', `${historicalYear}-all-all`, {
    at: 1,
    items: [{ id: 'prior', week: 1, homeTeam: 'Texas', awayTeam: 'Rice', status: 'final' }],
    partialFailure: false,
    failedSeasonTypes: [],
  });
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return new Response('[]', { status: 200 });
  }) as typeof fetch;

  const res = await runCapturingTags(() => POST(post({ year: historicalYear })));
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.alreadyCached, true);
  assert.equal(fetchCalls, 0, 'no provider call when already cached and not forced');
});

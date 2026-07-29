import test from 'node:test';
import assert from 'node:assert/strict';

// Install the global AsyncLocalStorage before the Next storage module loads so
// the route's `revalidateTag` (via invalidateStandings) runs under node:test.
import '../../draft/[slug]/[year]/__tests__/_setup/installAsyncLocalStorage';

import { GET } from '../route';
import { resetScheduleRouteCacheForTests, type CacheEntry } from '../cache';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateReadFailureForTests,
  getAppState,
  setAppState,
} from '../../../../lib/server/appStateStore.ts';
import {
  scheduleMediaStateKey,
  SCHEDULE_MEDIA_STATE_SCOPE,
  VENUE_CATALOG_STATE_KEY,
  VENUE_CATALOG_STATE_SCOPE,
  type ScheduleMediaCacheEntry,
  type VenueCatalogCacheEntry,
} from '../../../../lib/schedule/schedulePresentation.ts';
import { __resetSchedulePresentationMemoForTests } from '../../../../lib/schedule/schedulePresentationJoin.ts';
import { acquireScheduleRefreshLease } from '../../../../lib/schedule/scheduleRefreshLease.ts';

const YEAR = 2027;

type MockFetch = typeof fetch;

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const GAMES_REGULAR = [
  {
    id: 101,
    week: 1,
    home_team: 'Texas',
    away_team: 'Rice',
    start_date: '2027-08-28T23:00:00Z',
    venue: 'DKR',
    venue_id: 3504,
    broadcasts: [{ network: 'ESPN' }], // raw provider field — must never persist
  },
  {
    id: 102,
    week: 2,
    home_team: 'Georgia',
    away_team: 'UT Martin',
    start_date: '2027-09-04T23:00:00Z',
  },
];
const MEDIA_PAYLOAD = [
  { id: 101, mediaType: 'tv', outlet: 'ESPN' },
  { id: 101, mediaType: 'radio', outlet: 'ESPN Radio' },
  { id: 999, mediaType: 'tv', outlet: 'FOX' }, // schedule-absent — filtered out
];
const VENUES_PAYLOAD = [
  {
    id: 3504,
    name: 'Darrell K Royal–Texas Memorial Stadium',
    city: 'Austin',
    state: 'TX',
    country_code: 'US',
  },
];

/** Fetch mock dispatching CFBD /games, /games/media, and /venues; counts calls. */
function installProviderMock(): {
  calls: { games: number; media: number; venues: number };
} {
  const calls = { games: 0, media: 0, venues: 0 };
  global.fetch = (async (input: URL | string) => {
    const url = typeof input === 'string' ? input : input.toString();
    const parsed = new URL(url);
    if (parsed.pathname === '/games/media') {
      calls.media += 1;
      return jsonResponse(MEDIA_PAYLOAD);
    }
    if (parsed.pathname === '/venues') {
      calls.venues += 1;
      return jsonResponse(VENUES_PAYLOAD);
    }
    if (parsed.pathname === '/games') {
      calls.games += 1;
      return jsonResponse(parsed.searchParams.get('seasonType') === 'regular' ? GAMES_REGULAR : []);
    }
    throw new Error(`unexpected provider call: ${url}`);
  }) as MockFetch;
  return { calls };
}

function forbidProviderCalls(): void {
  global.fetch = (async (input: URL | string) => {
    throw new Error(`provider call not allowed: ${String(input)}`);
  }) as MockFetch;
}

async function seedDurableCanonicalSchedule(at: number): Promise<void> {
  const entry: CacheEntry = {
    at,
    items: [
      {
        id: '101',
        week: 1,
        startDate: '2027-08-28T23:00:00Z',
        neutralSite: false,
        conferenceGame: false,
        homeTeam: 'Texas',
        awayTeam: 'Rice',
        homeId: 251,
        awayId: 242,
        homeConference: 'SEC',
        awayConference: 'American',
        status: 'scheduled',
        venue: 'DKR',
        venueId: 3504,
        seasonType: 'regular',
      },
    ],
    partialFailure: false,
    failedSeasonTypes: [],
  };
  await setAppState('schedule', `${YEAR}-all-all`, entry);
}

async function seedPresentationCaches(at: number): Promise<void> {
  await setAppState(SCHEDULE_MEDIA_STATE_SCOPE, scheduleMediaStateKey(YEAR), {
    at,
    items: [{ gameId: '101', mediaType: 'tv', outlet: 'ESPN' }],
  } satisfies ScheduleMediaCacheEntry);
  await setAppState(VENUE_CATALOG_STATE_SCOPE, VENUE_CATALOG_STATE_KEY, {
    at,
    items: [
      {
        id: 3504,
        name: 'Darrell K Royal–Texas Memorial Stadium',
        city: 'Austin',
        state: 'TX',
        countryCode: 'US',
        timezone: null,
        capacity: null,
        grass: null,
        dome: null,
      },
    ],
  } satisfies VenueCatalogCacheEntry);
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  resetScheduleRouteCacheForTests();
  __resetSchedulePresentationMemoForTests();
  delete process.env.ADMIN_API_TOKEN;
  process.env.CFBD_API_KEY = 'test-cfbd-token';
});

test('an authorized full-year bypassCache=1 success seeds the presentation caches and serves enriched items', async () => {
  const { calls } = installProviderMock();
  const res = await GET(
    new Request(`http://localhost/api/schedule?year=${YEAR}&seasonType=all&bypassCache=1`)
  );
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(calls.games, 2, 'one regular + one postseason canonical fetch');
  assert.equal(calls.media, 1, 'exactly one /games/media seed');
  assert.equal(calls.venues, 1, 'exactly one /venues seed');

  // The response serves whatever presentation cache won after the attempt.
  const texasRice = json.items.find((item: { id: string }) => item.id === '101');
  assert.ok(texasRice);
  assert.deepEqual(texasRice.media, [
    { gameId: '101', mediaType: 'tv', outlet: 'ESPN' },
    { gameId: '101', mediaType: 'radio', outlet: 'ESPN Radio' },
  ]);
  assert.deepEqual(texasRice.venue, {
    stadium: 'Darrell K Royal–Texas Memorial Stadium',
    city: 'Austin',
    state: 'TX',
    country: 'US',
  });
  const noMediaGame = json.items.find((item: { id: string }) => item.id === '102');
  assert.equal(noMediaGame.media, undefined, 'a game with no media rows gets no media key');

  // Durable presentation caches exist...
  const mediaEntry = await getAppState<ScheduleMediaCacheEntry>(
    SCHEDULE_MEDIA_STATE_SCOPE,
    scheduleMediaStateKey(YEAR)
  );
  assert.equal(mediaEntry?.value.items.length, 2, 'schedule-absent media rows were filtered');
  const venueEntry = await getAppState<VenueCatalogCacheEntry>(
    VENUE_CATALOG_STATE_SCOPE,
    VENUE_CATALOG_STATE_KEY
  );
  assert.equal(venueEntry?.value.items.length, 1);

  // ...while the canonical durable schedule records stay presentation-free:
  // no joined media overlay and no raw provider broadcasts.
  const canonical = await getAppState<CacheEntry>('schedule', `${YEAR}-all-all`);
  for (const item of canonical!.value.items) {
    assert.ok(!('media' in item), 'canonical durable rows never carry the media overlay');
    assert.ok(!('broadcasts' in item), 'raw provider broadcasts never persist');
  }
});

test('public cache-only schedule reads perform zero provider calls and still serve enrichment', async () => {
  const now = Date.now();
  await seedDurableCanonicalSchedule(now);
  await seedPresentationCaches(now);
  forbidProviderCalls();

  const res = await GET(new Request(`http://localhost/api/schedule?year=${YEAR}&seasonType=all`));
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.meta.cache, 'hit');
  assert.equal(json.items[0].media[0].outlet, 'ESPN');
  assert.equal(json.items[0].venue.city, 'Austin');
});

test('the stale prior-good non-admin branch applies the same cache-only join', async () => {
  // Configure an admin token and send NO credential, so this request is a
  // genuine non-admin read and takes the stale prior-good branch.
  process.env.ADMIN_API_TOKEN = 'admin-token';
  const staleAt = Date.now() - 2 * 3600 * 1000;
  await seedDurableCanonicalSchedule(staleAt);
  await seedPresentationCaches(Date.now());
  forbidProviderCalls();

  const res = await GET(new Request(`http://localhost/api/schedule?year=${YEAR}&seasonType=all`));
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.meta.stale, true);
  assert.equal(json.items[0].media[0].outlet, 'ESPN', 'stale prior-good rows are still enriched');
});

test('the composed week+all read applies the same cache-only join', async () => {
  const now = Date.now();
  const child: CacheEntry = {
    at: now,
    items: [
      {
        id: '101',
        week: 1,
        startDate: '2027-08-28T23:00:00Z',
        neutralSite: false,
        conferenceGame: false,
        homeTeam: 'Texas',
        awayTeam: 'Rice',
        homeId: 251,
        awayId: 242,
        homeConference: 'SEC',
        awayConference: 'American',
        status: 'scheduled',
        venueId: 3504,
        seasonType: 'regular',
      },
    ],
    partialFailure: false,
    failedSeasonTypes: [],
  };
  await setAppState('schedule', `${YEAR}-1-regular`, child);
  await seedPresentationCaches(now);
  forbidProviderCalls();

  const res = await GET(new Request(`http://localhost/api/schedule?year=${YEAR}&week=1`));
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.items[0].media[0].outlet, 'ESPN');
  assert.equal(json.items[0].venue.stadium, 'Darrell K Royal–Texas Memorial Stadium');
});

test('a broken presentation cache never breaks the canonical schedule response', async () => {
  const now = Date.now();
  await seedDurableCanonicalSchedule(now);
  await seedPresentationCaches(now);
  forbidProviderCalls();
  __setAppStateReadFailureForTests(
    new Error('presentation store down'),
    SCHEDULE_MEDIA_STATE_SCOPE
  );
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const res = await GET(new Request(`http://localhost/api/schedule?year=${YEAR}&seasonType=all`));
    const json = await res.json();
    assert.equal(res.status, 200, 'canonical schedule response unaffected');
    assert.equal(json.items[0].media, undefined, 'media overlay simply absent');
    assert.equal(json.items[0].venue.city, 'Austin', 'the healthy venue join still applies');
  } finally {
    console.warn = originalWarn;
    __setAppStateReadFailureForTests(null);
  }
});

test('targeted season-type and week repairs never invoke the presentation authority', async () => {
  const { calls } = installProviderMock();
  const regular = await GET(
    new Request(`http://localhost/api/schedule?year=${YEAR}&seasonType=regular&bypassCache=1`)
  );
  assert.equal(regular.status, 200);
  const week = await GET(
    new Request(`http://localhost/api/schedule?year=${YEAR}&week=1&bypassCache=1`)
  );
  assert.equal(week.status, 200);
  assert.equal(calls.media, 0, 'no /games/media on targeted repairs');
  assert.equal(calls.venues, 0, 'no /venues on targeted repairs');
});

test('an unsuccessful E1A outcome never seeds presentation data', async () => {
  // Lease contention → E1A in-progress (409) → no presentation work.
  const lease = await acquireScheduleRefreshLease({ year: YEAR, now: Date.now() });
  assert.ok(lease.acquired);
  const { calls } = installProviderMock();
  const contended = await GET(
    new Request(`http://localhost/api/schedule?year=${YEAR}&seasonType=all&bypassCache=1`)
  );
  assert.equal(contended.status, 409);
  assert.equal(calls.games + calls.media + calls.venues, 0);

  // A valid all-empty year (E1A no-op) → no presentation work either.
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  resetScheduleRouteCacheForTests();
  __resetSchedulePresentationMemoForTests();
  global.fetch = (async (input: URL | string) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    if (url.pathname === '/games') return jsonResponse([]);
    throw new Error(`unexpected provider call: ${url.pathname}`);
  }) as MockFetch;
  const empty = await GET(
    new Request(`http://localhost/api/schedule?year=${YEAR}&seasonType=all&bypassCache=1`)
  );
  const emptyJson = await empty.json();
  assert.equal(empty.status, 200);
  assert.deepEqual(emptyJson.items, []);
  const mediaEntry = await getAppState<ScheduleMediaCacheEntry>(
    SCHEDULE_MEDIA_STATE_SCOPE,
    scheduleMediaStateKey(YEAR)
  );
  assert.equal(mediaEntry, null, 'no presentation seed on an E1A no-op');
});

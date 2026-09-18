import assert from 'node:assert/strict';
import test from 'node:test';

import '../../../../../test/installAsyncLocalStorage';
import { workAsyncStorage } from 'next/dist/server/app-render/work-async-storage.external';

import type { League } from '../../../../../lib/league.ts';
import type { SeasonArchive } from '../../../../../lib/seasonArchive.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateWriteFailureForTests,
  setAppState,
} from '../../../../../lib/server/appStateStore.ts';
import { computeCanonicalStandingsUncached } from '../../../../../lib/selectors/leagueStandings.ts';
import type { OwnerStandingsRow } from '../../../../../lib/standings.ts';
import type {
  StandingsHistory,
  StandingsHistoryStandingRow,
} from '../../../../../lib/standingsHistory.ts';
import * as routeModule from '../route.ts';

const { GET } = routeModule;

// ---------------------------------------------------------------------------
// PLATFORM-816 — the standings cache-versus-fresh diagnostic.
//
// WHAT THIS HARNESS IS, AND WHERE IT STOPS. These tests drive the REAL
// `unstable_cache` — the same code path production takes — against a FAKE
// incremental cache, using the seam `standingsCacheWarmer.test.ts` established.
// One difference from production is load-bearing and is not worked around here:
//
//   In an App Route, `unstable_cache`'s miss path assigns its write to
//   `workStore.pendingRevalidates[key]` WITHOUT awaiting it, and Next drains
//   that map through `pendingWaitUntil` AFTER the response is sent. The fake's
//   `set` resolves inline instead. So these tests publish a warm snapshot only
//   because `warmThrough` explicitly awaits the store's `pendingRevalidates`
//   after the request — a step production performs for itself, at a different
//   time, outside the request.
//
// Consequence: the suite proves the DETECTOR, the COMPARISON, and the
// STALE-DETECTION. It does not and cannot prove production's write TIMING, and
// no `node:test` can. The practical exposure is that a second cached read
// inside one request is not reliably a hit in production, which is exactly why
// the route reads the work store for its `unavailable` verdict instead of
// probing the cache twice.
// ---------------------------------------------------------------------------

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN;
const MUTABLE_ENV = process.env as Record<string, string | undefined>;
const TOKEN = 'test-admin-token';

const SLUG = 'delta-probe';
const YEAR = 2026;

type CacheRecord = { value: unknown; isStale: false };

/** Mirrors `fakeIncrementalCache` in `src/lib/server/__tests__/standingsCacheWarmer.test.ts`. */
function fakeIncrementalCache(events: string[]) {
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

type FakeStore = {
  route: string;
  fetchCache: string | undefined;
  incrementalCache: ReturnType<typeof fakeIncrementalCache>;
  pendingRevalidatedTags: string[];
  pendingRevalidates: Record<string, Promise<unknown>>;
  pendingRevalidateWrites: Promise<unknown>[];
  pathWasRevalidated: boolean;
  nextFetchId: number;
};

/**
 * `fetchCache` is read FROM THE ROUTE MODULE, mirroring the one line of Next
 * that connects the two: `app-route/module.js` does
 * `staticGenerationContext.renderOpts.fetchCache = this.userland.fetchCache`,
 * and `work-store.js` copies `renderOpts.fetchCache` onto the work store.
 * Hardcoding `undefined` here instead would make the harness blind to the route
 * exporting `fetchCache = 'force-no-store'` — which `unstable_cache` treats as
 * "skip the read", turning every request into a recompute-and-republish. A
 * mutation adding that export survived the suite until this line existed.
 */
function nextStore(incrementalCache: ReturnType<typeof fakeIncrementalCache>): FakeStore {
  return {
    route: '/api/debug/standings-cache-delta',
    fetchCache: (routeModule as { fetchCache?: string }).fetchCache,
    incrementalCache,
    pendingRevalidatedTags: [],
    pendingRevalidates: {},
    pendingRevalidateWrites: [],
    pathWasRevalidated: false,
    nextFetchId: 1,
  };
}

function authedRequest(query = `?leagueSlug=${SLUG}`): Request {
  return new Request(`http://localhost/api/debug/standings-cache-delta${query}`, {
    headers: { 'x-admin-token': TOKEN },
  });
}

/** One request through a fresh work store, exactly as a route invocation gets one. */
async function requestThrough(
  cache: ReturnType<typeof fakeIncrementalCache>,
  query?: string
): Promise<{ status: number; body: Record<string, never>; store: FakeStore }> {
  const store = nextStore(cache);
  const res = await workAsyncStorage.run(store as never, () => GET(authedRequest(query)));
  return { status: res.status, body: (await res.json()) as Record<string, never>, store };
}

/**
 * Warm the snapshot and PUBLISH it. The second step is the harness limitation
 * described at the top of this file: production drains `pendingRevalidates`
 * after the response through `pendingWaitUntil`; here the test does it.
 */
async function warmThrough(
  cache: ReturnType<typeof fakeIncrementalCache>,
  query?: string
): Promise<void> {
  const { store } = await requestThrough(cache, query);
  await Promise.allSettled(Object.values(store.pendingRevalidates));
}

/**
 * Archive rows, which is what `SeasonArchive.finalStandings` holds. Note the
 * `ties` — see `archiveRowsCarryAFabricatedTieCount` at the foot of this file.
 */
function makeRow(
  owner: string,
  overrides: Partial<StandingsHistoryStandingRow> = {}
): StandingsHistoryStandingRow {
  const wins = overrides.wins ?? 0;
  const losses = overrides.losses ?? 0;
  const decisions = wins + losses;
  return {
    owner,
    ties: overrides.ties ?? 0,
    wins,
    losses,
    winPct: overrides.winPct ?? (decisions > 0 ? wins / decisions : 0),
    pointsFor: overrides.pointsFor ?? 0,
    pointsAgainst: overrides.pointsAgainst ?? 0,
    pointDifferential:
      overrides.pointDifferential ?? (overrides.pointsFor ?? 0) - (overrides.pointsAgainst ?? 0),
    gamesBack: overrides.gamesBack ?? 0,
    finalGames: overrides.finalGames ?? decisions,
  };
}

const EMPTY_HISTORY: StandingsHistory = { weeks: [], byWeek: {}, byOwner: {} };

function makeLeague(): League {
  return {
    slug: SLUG,
    displayName: 'Delta Probe',
    year: YEAR,
    createdAt: '2026-01-01T00:00:00.000Z',
    status: { state: 'season', year: YEAR },
  };
}

/**
 * The archive branch of `resolveSeason` is the fixture with the fewest moving
 * parts: `snapshotFromArchive` puts `finalStandings` straight through
 * `splitOutNoClaim` into `rows`, so a row-level change is one `setAppState`
 * away and needs no schedule, score or catalog wiring.
 */
async function seedArchive(rows: StandingsHistoryStandingRow[]): Promise<void> {
  const archive: SeasonArchive = {
    leagueSlug: SLUG,
    year: YEAR,
    archivedAt: '2026-01-02T00:00:00.000Z',
    ownerRosterSnapshot: 'team,owner\n',
    standingsHistory: EMPTY_HISTORY,
    finalStandings: rows,
    games: [],
    scoresByKey: {},
  };
  await setAppState(`standings-archive:${SLUG}`, String(YEAR), archive);
}

async function seedBaseline(): Promise<void> {
  await setAppState('leagues', 'registry', [makeLeague()]);
  await seedArchive([
    makeRow('Ann', { wins: 9, losses: 1, pointsFor: 300, pointsAgainst: 150 }),
    makeRow('Bob', { wins: 4, losses: 6, pointsFor: 200, pointsAgainst: 260 }),
  ]);
}

/**
 * A live-derived fixture: roster CSV + one scored game. Every input here is a
 * DIRECT `getAppState` read, which matters — see
 * `nestedSeasonArchiveCacheIsSharedByBothSides` at the foot of this file for the
 * one input family that is not.
 */
async function seedLive(params: {
  csv: string;
  homeScore: number;
  awayScore: number;
}): Promise<void> {
  await setAppState('leagues', 'registry', [makeLeague()]);
  await setAppState(`owners:${SLUG}:${YEAR}`, 'csv', params.csv);
  await seedSchedule([scheduleGame('g1', 1, 'final')]);
  await seedScores(params.homeScore, params.awayScore);
}

function scheduleGame(id: string, week: number, status: string) {
  return {
    id,
    week,
    startDate: `${YEAR}-09-0${week}T18:00:00.000Z`,
    neutralSite: false,
    conferenceGame: false,
    homeTeam: 'Texas',
    awayTeam: 'Georgia',
    homeConference: 'Test Conf',
    awayConference: 'Test Conf',
    status,
    seasonType: 'regular',
  };
}

/** Split out so a test can move ONE input without touching the others. */
async function seedSchedule(items: ReturnType<typeof scheduleGame>[]): Promise<void> {
  await setAppState('schedule', `${YEAR}-all-all`, { items });
}

/** Split out so a test can move ONE input without touching the others. */
async function seedScores(homeScore: number, awayScore: number): Promise<void> {
  await setAppState('scores', `${YEAR}-all-regular`, {
    items: [
      {
        id: 'g1',
        seasonType: 'regular',
        startDate: `${YEAR}-09-01T18:00:00.000Z`,
        week: 1,
        status: 'final',
        home: { team: 'Texas', score: homeScore },
        away: { team: 'Georgia', score: awayScore },
        time: null,
      },
    ],
  });
}

const LIVE_CSV = 'team,owner\nTexas,Ann\nGeorgia,Bob\n';

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  __setAppStateWriteFailureForTests(null);
  MUTABLE_ENV.NODE_ENV = 'development';
  MUTABLE_ENV.ADMIN_API_TOKEN = TOKEN;
});

test.afterEach(() => {
  __setAppStateWriteFailureForTests(null);
});

test.after(() => {
  MUTABLE_ENV.NODE_ENV = ORIGINAL_NODE_ENV;
  if (ORIGINAL_ADMIN_API_TOKEN === undefined) {
    delete MUTABLE_ENV.ADMIN_API_TOKEN;
  } else {
    MUTABLE_ENV.ADMIN_API_TOKEN = ORIGINAL_ADMIN_API_TOKEN;
  }
});

// ---------------------------------------------------------------------------
// Acceptance 2 — the DETECTOR's own positive control.
//
// This is not the comparison's control (that is `reportsStaleSnapshotDifferences`
// below). It proves the detector reports MISS when the cache is genuinely empty.
//
// THE MUTATION THIS CATCHES, named because it is the one that matters: drop
// `currentDate: probe` from the route's `getCanonicalStandings` call. The
// selector then makes its own `new Date()` at its `resolvedCurrentDate` line,
// `generatedAt` can never equal `probeStamp`, and the route reports `hit` on
// every request including this one. `assert.equal(verdict, 'miss')` is the
// assertion that reddens.
// ---------------------------------------------------------------------------
test('reportsMissAgainstAnEmptyCache', async () => {
  await seedBaseline();
  const events: string[] = [];
  const { status, body } = await requestThrough(fakeIncrementalCache(events));

  assert.equal(status, 200);
  const cacheRead = body.cacheRead as unknown as Record<string, unknown>;
  assert.equal(cacheRead.verdict, 'miss', 'an empty cache must read as a miss');
  assert.equal(cacheRead.dataCacheWritten, true, 'a miss publishes a data-cache entry');
  assert.equal(cacheRead.incrementalCachePresent, true);
  assert.equal(
    cacheRead.cachedGeneratedAt,
    cacheRead.probeStamp,
    'the miss verdict rests on the returned stamp equalling this request’s own'
  );
  assert.match(String(cacheRead.restsOn), /THIS REQUEST computed the snapshot/);

  // Acceptance 2's second half: the report must NOT say cached and fresh agree.
  const comparison = body.comparison as unknown as Record<string, unknown>;
  assert.equal(comparison.matches, null, 'a miss cannot report agreement');
  assert.match(String(comparison.notComparableBecause), /not a pre-existing snapshot/);
  assert.equal(
    (comparison.differences as unknown[]).length,
    0,
    'the two sides do agree — which is exactly why `matches` must not say so'
  );
});

// ---------------------------------------------------------------------------
// Acceptance 1 — and the other half of the detector's control.
// ---------------------------------------------------------------------------
test('reportsHitAgainstAWarmSnapshot', async () => {
  await seedBaseline();
  const events: string[] = [];
  const cache = fakeIncrementalCache(events);
  await warmThrough(cache);

  const setsAfterWarm = events.filter((e) => e.startsWith('set:')).length;
  assert.ok(setsAfterWarm > 0, 'the warm actually published a snapshot');

  const { status, body } = await requestThrough(cache);
  assert.equal(status, 200);

  assert.equal(
    events.filter((e) => e.startsWith('set:')).length,
    setsAfterWarm,
    'the second request read the warm snapshot instead of recomputing it — this is also what fails if `fetchCache` were ever exported from the route'
  );

  const cacheRead = body.cacheRead as unknown as Record<string, unknown>;
  assert.equal(cacheRead.verdict, 'hit');
  assert.equal(cacheRead.dataCacheWritten, false);
  assert.notEqual(
    cacheRead.cachedGeneratedAt,
    cacheRead.probeStamp,
    'a hit returns the WARMING request’s stamp, not this one’s'
  );

  const comparison = body.comparison as unknown as Record<string, unknown>;
  assert.equal(comparison.matches, true, 'an unchanged warm snapshot matches the fresh rebuild');
  assert.equal(comparison.notComparableBecause, null);
  assert.equal(comparison.comparedOwners, 2, 'the population is printed, and it is not zero');
  assert.deepEqual(comparison.differences, []);
  assert.deepEqual(comparison.snapshotDifferences, []);
});

// ---------------------------------------------------------------------------
// The third verdict. Without it the route reports `miss` — and claims a snapshot
// was created — when `getCanonicalStandings` silently fell back to a direct
// compute and no snapshot exists or can exist.
// ---------------------------------------------------------------------------
test('reportsUnavailableWithoutAnIncrementalCache', async () => {
  await seedBaseline();
  // No `workAsyncStorage.run`: exactly the context `node:test` and any non-App
  // caller provides, and the one the selector's catch is written for.
  const res = await GET(authedRequest());
  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, never>;

  const cacheRead = body.cacheRead as unknown as Record<string, unknown>;
  assert.equal(cacheRead.verdict, 'unavailable');
  assert.equal(cacheRead.incrementalCachePresent, false);
  assert.equal(cacheRead.dataCacheWritten, false, 'nothing was written, so do not say it was');
  assert.match(String(cacheRead.restsOn), /no snapshot exists/);
  assert.equal(
    (cacheRead.flags as Record<string, unknown>).workStorePresent,
    false,
    'the flags are reported from the store, not assumed'
  );

  // The stamps DO match here — a direct compute uses this request's date — which
  // is precisely why the verdict cannot be derived from the stamp alone.
  assert.equal(cacheRead.cachedGeneratedAt, cacheRead.probeStamp);
  assert.equal((body.comparison as unknown as Record<string, unknown>).matches, null);
});

// ---------------------------------------------------------------------------
// Acceptance 3 — THE TEST THAT PROVES THE ROUTE CAN SEE WHAT IT EXISTS TO SEE.
//
// Warm, change an input, suppress invalidation (nothing here calls
// `invalidateStandings`), read again. Without this the route is an unproven
// observer: every other test above would pass against a route that compared a
// value with itself.
// ---------------------------------------------------------------------------
test('reportsStaleSnapshotDifferences', async () => {
  // Texas 31, Georgia 17 -> Ann 1-0, Bob 0-1.
  await seedLive({ csv: LIVE_CSV, homeScore: 31, awayScore: 17 });
  const events: string[] = [];
  const cache = fakeIncrementalCache(events);
  await warmThrough(cache);

  // ONE input moves, and nothing invalidates: the score is corrected the other
  // way. No `revalidateTag` anywhere, so the snapshot stays warm and wrong.
  await seedScores(10, 45);

  const { body } = await requestThrough(cache);
  const cacheRead = body.cacheRead as unknown as Record<string, unknown>;
  assert.equal(cacheRead.verdict, 'hit', 'the stale snapshot is still a hit — that is the hazard');

  const comparison = body.comparison as unknown as Record<string, unknown>;
  assert.equal(comparison.matches, false, 'the route must SEE the divergence');
  assert.equal(comparison.comparedOwners, 2, 'the population is printed beside the verdict');

  const differences = comparison.differences as Array<Record<string, unknown>>;
  const byOwner = new Map(differences.map((d) => [d.owner as string, d]));

  const ann = byOwner.get('Ann');
  assert.ok(ann, 'Ann won in the stale snapshot and lost in the rebuild — she must be named');
  assert.equal(ann.presence, 'both');
  const annFields = new Map(
    (ann.fields as Array<Record<string, unknown>>).map((f) => [f.field as string, f])
  );
  assert.deepEqual(
    annFields.get('wins'),
    { field: 'wins', cached: 1, fresh: 0 },
    'both values, not just a flag'
  );
  assert.deepEqual(annFields.get('losses'), { field: 'losses', cached: 0, fresh: 1 });
  assert.deepEqual(annFields.get('pointsFor'), { field: 'pointsFor', cached: 31, fresh: 10 });
  assert.deepEqual(annFields.get('pointsAgainst'), {
    field: 'pointsAgainst',
    cached: 17,
    fresh: 45,
  });
  assert.ok(annFields.has('rank'), 'Ann and Bob swapped places, and rank is part of the delta');

  const bob = byOwner.get('Bob');
  assert.ok(bob, 'the other side of the same game moved too');
  assert.equal(bob.presence, 'both');
});

test('reportsAnOwnerWhoExistsOnOnlyOneSide', async () => {
  await seedLive({ csv: LIVE_CSV, homeScore: 31, awayScore: 17 });
  const cache = fakeIncrementalCache([]);
  await warmThrough(cache);

  // The roster moves: Texas changes hands. Ann leaves the league, Cal joins.
  await setAppState(`owners:${SLUG}:${YEAR}`, 'csv', 'team,owner\nTexas,Cal\nGeorgia,Bob\n');

  const { body } = await requestThrough(cache);
  const comparison = body.comparison as unknown as Record<string, unknown>;
  assert.equal(comparison.matches, false);
  assert.equal(comparison.comparedOwners, 3, 'the union of both sides, not either one');
  assert.equal(comparison.cachedOwners, 2);
  assert.equal(comparison.freshOwners, 2);

  const byOwner = new Map(
    (comparison.differences as Array<Record<string, unknown>>).map((d) => [d.owner as string, d])
  );
  assert.equal(byOwner.get('Ann')?.presence, 'cached-only');
  assert.equal(byOwner.get('Cal')?.presence, 'fresh-only');
  const calWins = (byOwner.get('Cal')!.fields as Array<Record<string, unknown>>).find(
    (f) => f.field === 'wins'
  );
  assert.deepEqual(calWins, { field: 'wins', cached: null, fresh: 1 });
});

/**
 * ONE CLOCK FOR BOTH SIDES.
 *
 * The route passes a single `probe` Date to the cached read and to the rebuild,
 * so the only difference between the two snapshots is the DATA. Giving the fresh
 * side its own `new Date()` would manufacture a `lifecycle` difference — and
 * `lifecycle` is one of the fields `snapshotDifferences` reports, so the route
 * would blame the cache for a divergence it created itself.
 *
 * A mutation that shifted the fresh side's clock by 400 days survived every
 * other test in this file: the fixtures' `lifecycle` happened not to move over
 * that interval, and `generatedAt` is deliberately excluded from
 * `snapshotDifferences`. This assertion is clock-shift-proof because every
 * snapshot constructor stamps `generatedAt` from the date it was handed.
 */
test('theFreshRebuildSharesTheProbeClock', async () => {
  await seedLive({ csv: LIVE_CSV, homeScore: 31, awayScore: 17 });
  const cache = fakeIncrementalCache([]);
  await warmThrough(cache);
  const { body } = await requestThrough(cache);

  const freshness = body.freshness as unknown as Record<string, unknown>;
  const cacheRead = body.cacheRead as unknown as Record<string, unknown>;
  assert.equal(cacheRead.verdict, 'hit');
  assert.equal(
    freshness.freshGeneratedAt,
    cacheRead.probeStamp,
    'the rebuild was stamped with the probe date, so both sides ran on one clock'
  );
  assert.equal(freshness.clockIsShared, true);
  assert.notEqual(
    cacheRead.cachedGeneratedAt,
    freshness.freshGeneratedAt,
    'and the CACHED side kept the warming request’s stamp — the two are genuinely different snapshots'
  );
});

/**
 * The snapshot-level comparison's own positive control.
 *
 * `differences` covers owner rows; `snapshotDifferences` covers the facts beside
 * them — `source`, `lifecycle`, `ownersRosterSource`, the resolved archive year,
 * coverage state, the history's week count. A stale snapshot can carry IDENTICAL
 * ROWS and still be wrong, and a mutation that disabled this comparison entirely
 * survived every other test in this file.
 *
 * The scenario is a schedule refresh adding a week that has not been played. No
 * result changes, so every row is byte-identical — and the warm snapshot's
 * standings history is a week short, which is what `selectSeasonContext` reads
 * to decide whether a season is final. A row-only comparison reports a clean
 * match over it.
 */
test('reportsSnapshotLevelDivergenceWithIdenticalRows', async () => {
  await seedLive({ csv: LIVE_CSV, homeScore: 31, awayScore: 17 });
  const cache = fakeIncrementalCache([]);
  await warmThrough(cache);

  // A second, unplayed week appears in the schedule cache. Nothing invalidates.
  await seedSchedule([scheduleGame('g1', 1, 'final'), scheduleGame('g2', 2, 'scheduled')]);

  const { body } = await requestThrough(cache);
  const comparison = body.comparison as unknown as Record<string, unknown>;

  assert.deepEqual(
    comparison.differences,
    [],
    'the rows agree — which is exactly why the row comparison alone would miss this'
  );
  assert.deepEqual(
    comparison.snapshotDifferences,
    [{ field: 'standingsHistory.weeks', cached: 1, fresh: 2 }],
    'the divergence is in the snapshot facts, and both values are named'
  );
  assert.equal(comparison.matches, false, 'identical rows over a different history is not a match');
});

// ---------------------------------------------------------------------------
// Acceptance 4 — #771.
//
// NODE_ENV is pinned to 'production' here ON PURPOSE, and this test therefore
// does NOT exercise the condition #771 is about. `isAuthorizedAdminRequest`
// returns `!isProductionRuntime()` when `ADMIN_API_TOKEN` is unset, so outside
// production an unauthenticated caller is AUTHORIZED — and unpinned, the
// assertion below would fail against every `/api/debug/*` route, not just this
// one. What this proves is that the route is fail-closed in production and adds
// no bypass of its own. #771 stays open and is not narrowed here.
// ---------------------------------------------------------------------------
test('rejectsUnauthenticatedRequestsIncludingWithNoTokenConfigured', async () => {
  await seedBaseline();
  MUTABLE_ENV.NODE_ENV = 'production';

  delete MUTABLE_ENV.ADMIN_API_TOKEN;
  const unconfigured = await GET(new Request(`http://localhost/x?leagueSlug=${SLUG}`));
  assert.equal(unconfigured.status, 401, 'no token configured must not mean no gate');
  assert.equal(
    ((await unconfigured.json()) as { error: string }).error,
    'admin-token-server-misconfigured'
  );

  MUTABLE_ENV.ADMIN_API_TOKEN = TOKEN;
  const missing = await GET(new Request(`http://localhost/x?leagueSlug=${SLUG}`));
  assert.equal(missing.status, 401);

  const wrong = await GET(
    new Request(`http://localhost/x?leagueSlug=${SLUG}`, {
      headers: { 'x-admin-token': 'nope' },
    })
  );
  assert.equal(wrong.status, 401);
});

test('rejectsAnUnauthenticatedRequestBeforeReadingTheCache', async () => {
  await seedBaseline();
  MUTABLE_ENV.NODE_ENV = 'production';
  const events: string[] = [];
  const cache = fakeIncrementalCache(events);

  const res = await workAsyncStorage.run(nextStore(cache) as never, () =>
    GET(new Request(`http://localhost/x?leagueSlug=${SLUG}`))
  );
  assert.equal(res.status, 401);
  assert.deepEqual(events, [], 'an unauthorized request must not reach the cache or a build');
});

// ---------------------------------------------------------------------------
// Acceptance 5 — #770 / #774. Rejected BEFORE any build, and minting no entry.
// ---------------------------------------------------------------------------
test('rejectsAnOutOfRangeYearBeforeAnyBuild', async () => {
  await seedBaseline();
  for (const raw of ['99999', '2026nonsense', '2026.5', '0x7E0', '2e10', '1999', '-2026']) {
    const events: string[] = [];
    const cache = fakeIncrementalCache(events);
    const { status, body } = await requestThrough(cache, `?leagueSlug=${SLUG}&year=${raw}`);
    assert.equal(status, 400, `year=${raw} must be refused`);
    assert.match((body as unknown as { error: string }).error, /year must be an integer between/);
    assert.deepEqual(events, [], `year=${raw} must mint no cache entry and run no build`);
  }
});

test('acceptsAPaddedYearAndTheLeagueOperatingYear', async () => {
  await seedBaseline();
  const cache = fakeIncrementalCache([]);
  // `?year=%202026` — trimmed once, so emptiness and validity read the same
  // value. The first cut of #770 made this a 400 while `?year=` was a 200.
  const padded = await requestThrough(cache, `?leagueSlug=${SLUG}&year=%20${YEAR}`);
  assert.equal(padded.status, 200);
  assert.equal(
    (padded.body.year as unknown as Record<string, unknown>).source,
    'parameter',
    'a padded year is the parameter path, not the default path'
  );

  const absent = await requestThrough(cache, `?leagueSlug=${SLUG}&year=`);
  assert.equal(absent.status, 200);
  assert.equal(
    (absent.body.year as unknown as Record<string, unknown>).source,
    'resolveStandingsYear'
  );
  assert.equal((absent.body.year as unknown as Record<string, unknown>).resolved, YEAR);
});

test('requiresALeagueSlug', async () => {
  await seedBaseline();
  const events: string[] = [];
  const { status } = await requestThrough(fakeIncrementalCache(events), '');
  assert.equal(status, 400);
  assert.deepEqual(events, []);
});

// ---------------------------------------------------------------------------
// Acceptance 6 — no `setAppState` write on any path, WITH the observer's own
// positive control.
//
// The observer is the write-failure seam: any `setAppState` call throws, so a
// write would surface as a 500 or a rejected promise rather than passing
// silently. `storeWriteObserverSeesAWrite` below is the control proving the
// observer is not simply blind — without it, "no throw" and "the seam never
// armed" are the same result.
// ---------------------------------------------------------------------------
test('storeWriteObserverSeesAWrite', async () => {
  const tripwire = new Error('app-state write observed');
  __setAppStateWriteFailureForTests(tripwire);
  await assert.rejects(
    () => setAppState('leagues', 'registry', []),
    /app-state write observed/,
    'the observer must see a write when one happens'
  );
});

test('performsNoAppStateWriteOnAnyPath', async () => {
  await seedBaseline();
  const tripwire = new Error('app-state write observed');

  // Every path the route can take, under the armed observer.
  const paths: Array<[string, () => Promise<Response>]> = [
    [
      'cold cache (miss)',
      () =>
        workAsyncStorage.run(nextStore(fakeIncrementalCache([])) as never, () =>
          GET(authedRequest())
        ),
    ],
    ['no incremental cache (unavailable)', () => GET(authedRequest())],
    ['rejected year', () => GET(authedRequest(`?leagueSlug=${SLUG}&year=99999`))],
    ['unknown league', () => GET(authedRequest('?leagueSlug=no-such-league'))],
  ];

  const warmCache = fakeIncrementalCache([]);
  await warmThrough(warmCache);
  paths.push([
    'warm cache (hit)',
    () => workAsyncStorage.run(nextStore(warmCache) as never, () => GET(authedRequest())),
  ]);

  __setAppStateWriteFailureForTests(tripwire);
  try {
    for (const [name, run] of paths) {
      const res = await run();
      assert.ok(res.status === 200 || res.status === 400, `${name}: ${res.status}`);
    }
  } finally {
    __setAppStateWriteFailureForTests(null);
  }
});

// ---------------------------------------------------------------------------
// The comparison's field set, and the two facts recorded as findings.
// ---------------------------------------------------------------------------
test('comparedFieldsExcludeTies', async () => {
  await seedBaseline();
  const { body } = await requestThrough(fakeIncrementalCache([]));
  const comparison = body.comparison as unknown as Record<string, unknown>;

  assert.equal(
    (comparison.comparedFields as string[]).includes('ties'),
    false,
    'there is no ties field to compare'
  );
  assert.match(String(comparison.excluded), /deriveStandings drops final ties/);
  assert.deepEqual(comparison.derivedFields, ['rank'], 'rank is derived and labelled as derived');
  assert.equal(comparison.unit, 'owner', 'the unit is owner, not team');
});

/**
 * THE `ties` FINDING, PINNED RATHER THAN ASSERTED.
 *
 * `OwnerStandingsRow` declares no `ties`, and `deriveStandings` drops final ties
 * outright (`console.warn` + `continue`), so nothing counts one. The ONE place a
 * tie count exists is `toHistoryStandingsRows` in `standingsHistory.ts`, which
 * writes a hardcoded `ties: 0` onto every row — and those rows are what
 * `SeasonArchive.finalStandings` stores and `snapshotFromArchive` puts straight
 * into `rows`.
 *
 * So an archive-sourced snapshot's rows carry a `ties` property the type does
 * not declare, whose value is fabricated; a live-sourced snapshot's rows carry
 * no such key at all. A `ties` column in this route would report one of those
 * two things and call it a tie count. This test states the shape so the claim in
 * the route's `EXCLUDED_FIELD_NOTE` is checkable rather than asserted, and
 * reddens if either half changes.
 */
test('archiveRowsCarryAFabricatedTieCountAndLiveRowsCarryNone', async () => {
  await setAppState('leagues', 'registry', [makeLeague()]);
  await seedArchive([makeRow('Ann', { wins: 9, losses: 1, ties: 4 })]);

  const fromArchive = await computeCanonicalStandingsUncached({
    slug: SLUG,
    year: YEAR,
    currentDate: new Date('2026-09-17T12:00:00Z'),
  });
  assert.equal(fromArchive.source, 'archive');
  const archiveRow = fromArchive.rows[0] as OwnerStandingsRow & { ties?: number };
  assert.equal(
    archiveRow.ties,
    4,
    'the archive row carries whatever ties value was stored — it is not derived from any game'
  );

  // The same league with no archive falls to the preseason-names path, whose
  // rows are built by the selector rather than read back from a store.
  await setAppState('leagues', 'registry', [
    { ...makeLeague(), status: { state: 'preseason', year: YEAR } },
  ]);
  await setAppState(`preseason-owners:${SLUG}`, String(YEAR), ['Ann', 'Bob']);
  const fromSelector = await computeCanonicalStandingsUncached({
    slug: SLUG,
    year: YEAR,
    currentDate: new Date('2026-09-17T12:00:00Z'),
  });
  assert.equal(fromSelector.source, 'preseason-names');
  assert.equal(
    Object.hasOwn(fromSelector.rows[0]!, 'ties'),
    false,
    'a selector-built row has no tie count at all — the two sources do not even agree on the key'
  );
});

/**
 * And the consequence for this route: the comparison reads the DECLARED field
 * set, never the object keys. A deep-equal over rows would diff `ties` between
 * an archive-sourced side and a selector-built one and report a difference the
 * cache had nothing to do with.
 */
test('theComparisonIgnoresUndeclaredRowKeys', async () => {
  await setAppState('leagues', 'registry', [makeLeague()]);
  await seedArchive([makeRow('Ann', { wins: 9, losses: 1, ties: 4 })]);

  const cache = fakeIncrementalCache([]);
  await warmThrough(cache);
  const { body } = await requestThrough(cache);

  const comparison = body.comparison as unknown as Record<string, unknown>;
  assert.deepEqual(
    comparison.differences,
    [],
    'a stray `ties` on both sides is not a difference, because it is not compared'
  );
  assert.equal(
    (comparison.comparedFields as string[]).includes('ties'),
    false,
    'and it is not in the declared set'
  );
});

// ---------------------------------------------------------------------------
// THE ROUTE'S BLIND SPOT, PINNED RATHER THAN LEFT TO BE DISCOVERED.
//
// "Fresh" means uncached AT THE CANONICAL-STANDINGS LAYER. It does not mean the
// rebuild re-reads the store for everything: `getSeasonArchive` and
// `listSeasonArchives` carry their OWN tag-only `unstable_cache`
// (`seasonArchive.ts`, `revalidate: false`), and BOTH sides go through it. So on
// an `archive`-sourced league a stale archive entry is invisible here — the
// fresh side reads the same cached archive the warm snapshot was built from and
// the two agree.
//
// Every other input in the canonical path is a direct `getAppState`: the owners
// CSV, the schedule cache, the scores cache, the team catalog, the alias scopes,
// the postseason overrides and the preseason owners. The season-archive family
// is the whole exception, which is why `reportsStaleSnapshotDifferences` drives
// the LIVE path — it would have passed vacuously on the archive path, agreeing
// with itself.
//
// This test exists so the limitation is a measured fact with a name rather than
// a paragraph nobody can check. It reddens if the nested cache is ever removed
// or bypassed, at which point the route's `freshness` note should change too.
// ---------------------------------------------------------------------------
test('nestedSeasonArchiveCacheIsSharedByBothSides', async () => {
  await setAppState('leagues', 'registry', [makeLeague()]);
  await seedArchive([makeRow('Ann', { wins: 9, losses: 1 })]);

  const cache = fakeIncrementalCache([]);
  await warmThrough(cache);

  // The archive moves. Nothing invalidates the standings tag OR the archive tag.
  await seedArchive([makeRow('Ann', { wins: 2, losses: 8 })]);

  const { body } = await requestThrough(cache);
  const comparison = body.comparison as unknown as Record<string, unknown>;
  assert.equal(
    comparison.matches,
    true,
    'the rebuild read the same CACHED archive, so it agrees with the stale snapshot — the route cannot see this class of staleness'
  );
  assert.deepEqual(comparison.differences, []);

  assert.match(
    String((body.freshness as unknown as Record<string, unknown>).caveat),
    /season archive/i,
    'and the response says so, rather than letting a clean result imply more than it proves'
  );
});

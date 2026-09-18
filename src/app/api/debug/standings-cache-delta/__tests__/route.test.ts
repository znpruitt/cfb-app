import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
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
import {
  computeCanonicalStandingsUncached,
  getCanonicalStandings,
} from '../../../../../lib/selectors/leagueStandings.ts';
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

type CacheRecord = { value: unknown; isStale: boolean };

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
    /**
     * Test-only: mark every stored entry stale, so `incrementalCache.get`
     * returns one. Without this the fake could never produce `isStale: true`
     * and `classifyCacheRead`'s background-revalidation branch was unreachable
     * from the suite — coverage the classifier's doc comment implied and did not
     * have.
     */
    markAllStale() {
      for (const [key, record] of records) records.set(key, { ...record, isStale: true });
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
/**
 * WARMS THROUGH THE ROUTE, so the warming request stamps the snapshot with its
 * own `new Date()`.
 *
 * Use `warmAtFixedClock` instead in any test that asserts a VERDICT or a
 * BLOCKER. Two requests microseconds apart can land in the same millisecond, and
 * `classifyCacheRead` then reads a genuine hit as `bypassed` — a live
 * reproduction of the open millisecond-precision finding, not a harness
 * artefact. It surfaced as an ORDER-DEPENDENT failure: adding two tests ahead of
 * `reportsNullRatherThanDisagreementOverAnEmptyPopulation` shifted timing enough
 * to flip it, moving them made it pass, and a bare five-run loop failed once.
 * Order-dependent green is not green, so the warm is pinned instead.
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
/**
 * Warm the snapshot at a FIXED, distinctly-past clock.
 *
 * `warmThrough` warms through the route, which stamps the snapshot with its own
 * `new Date()`. Any later assertion that the warm stamp DIFFERS from the reading
 * request's then depends on the two landing in different milliseconds — against
 * an in-memory store they need not, and the test would redden with no code
 * defect. (That is the same intermittency the route's own detector was
 * re-derived to stop depending on, which is why it must not reappear here.)
 *
 * Warming via `getCanonicalStandings` with an explicit `currentDate` publishes
 * through the same real `unstable_cache` — an explicit year and the default both
 * resolve to one cache key, which is exactly the equivalence the production
 * warmer relies on — and makes the stamp deterministic.
 */
const WARM_CLOCK = new Date('2026-09-01T00:00:00.000Z');

async function warmAtFixedClock(cache: ReturnType<typeof fakeIncrementalCache>): Promise<void> {
  const store = nextStore(cache);
  await workAsyncStorage.run(store as never, () =>
    getCanonicalStandings({ slug: SLUG, year: YEAR, currentDate: WARM_CLOCK })
  );
  await Promise.allSettled(Object.values(store.pendingRevalidates));
}

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
  assert.equal(
    cacheRead.dataCachePublicationQueued,
    true,
    'a miss QUEUES a data-cache publication — queued, because unstable_cache inserts the promise and Next awaits it after the handler returns'
  );
  assert.equal(
    cacheRead.dataCachePublicationConfirmed,
    false,
    'and this request cannot confirm it landed, so it does not say it did'
  );
  assert.equal(cacheRead.queuedPublication, true);
  assert.ok(
    (cacheRead.pendingPublicationsAfterCachedRead as number) >
      (cacheRead.pendingPublicationsBefore as number),
    'both sides of the bracket are printed, so the verdict can be reconstructed'
  );
  assert.equal(cacheRead.incrementalCachePresent, true);
  assert.equal(
    cacheRead.cachedGeneratedAt,
    cacheRead.probeStamp,
    'the miss verdict rests on the returned stamp equalling this request’s own'
  );

  // Acceptance 2's second half: the report must NOT say cached and fresh agree.
  const comparison = body.comparison as unknown as Record<string, unknown>;
  assert.equal(comparison.matches, null, 'a miss cannot report agreement');
  assert.equal(comparison.blockedBy, 'cached-side-not-a-snapshot');
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
  // THE LIVE PATH, NOT THE ARCHIVE ONE, and the reason is a review finding. An
  // archive-sourced league can never report `matches: true`: both sides read the
  // same nested `getSeasonArchive` cache, so the route declines to answer. This
  // test needs a fixture where a match is genuinely informative.
  await seedLive({ csv: LIVE_CSV, homeScore: 31, awayScore: 17 });
  const events: string[] = [];
  const cache = fakeIncrementalCache(events);
  await warmAtFixedClock(cache);

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
  assert.equal(cacheRead.queuedPublication, false, 'a hit queues no standings publication');
  assert.equal(
    cacheRead.pendingPublicationsAfterCachedRead,
    cacheRead.pendingPublicationsBefore,
    'the bracket did not move across the cached read'
  );
  assert.equal(
    cacheRead.cachedGeneratedAt,
    WARM_CLOCK.toISOString(),
    'a hit returns the WARMING request’s stamp, not this one’s — asserted against the exact known warm clock rather than "different from now", which would ride on a millisecond boundary'
  );

  const comparison = body.comparison as unknown as Record<string, unknown>;
  assert.equal(comparison.matches, true, 'an unchanged warm snapshot matches the fresh rebuild');
  assert.equal(comparison.blockedBy, null, 'and nothing blocked the comparison');
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
  assert.equal(
    cacheRead.dataCachePublicationQueued,
    false,
    'nothing was queued, so do not say it was'
  );
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
  await warmAtFixedClock(cache);

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
  await warmAtFixedClock(cache);
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
  assert.equal(
    cacheRead.cachedGeneratedAt,
    WARM_CLOCK.toISOString(),
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
    [
      { field: 'standingsHistory.weeks', cached: '1', fresh: '1,2' },
      {
        field: 'standingsHistory.week2',
        cached: 'absent',
        fresh:
          'played=false;coverage=complete;pending=2-texas-georgia-H@2026-09-02T18:00:00.000Z;rows=Ann:1-0:31/17|Bob:0-1:17/31',
      },
    ],
    'the divergence is named per week, with the week’s CONTENT — not just a count'
  );
  assert.equal(comparison.matches, false, 'identical rows over a different history is not a match');
});

// ---------------------------------------------------------------------------
// Added at review. Each of these covers a way the route could claim more than
// it knows — the shape both reviewers found repeatedly.
// ---------------------------------------------------------------------------

/**
 * An unregistered slug must be refused BEFORE the cached read.
 *
 * `getCanonicalStandings` does not decline for an unknown league: it computes an
 * empty snapshot and publishes it under `canonicalStandingsCacheKeyParts(slug,
 * null)` with `revalidate: false`. Nothing can reclaim that entry — the only
 * things that fire `standings:<slug>` walk the registry, and this slug is in no
 * registry. #778 settled the identical hazard for the season-archive readers.
 */
test('refusesAnUnregisteredLeagueBeforeTouchingTheCache', async () => {
  await seedLive({ csv: LIVE_CSV, homeScore: 31, awayScore: 17 });
  const events: string[] = [];
  const { status, body } = await requestThrough(
    fakeIncrementalCache(events),
    '?leagueSlug=no-such-league'
  );
  assert.equal(status, 404);
  assert.equal((body as unknown as { error: string }).error, 'league-not-registered');
  assert.deepEqual(
    events,
    [],
    'no cache get and — the point — no set, so no year-long entry is minted under an arbitrary slug'
  );
});

/**
 * Draft mode is the one flag that gates BOTH the read and the publication
 * (`unstable-cache.js:143` and `:204`), so it recomputes and stores nothing.
 * Reporting that as `hit` would assert an existing snapshot was returned; as
 * `miss` it would assert one was created. Neither is true.
 */
test('reportsBypassedWhenTheCacheIsPresentButNothingIsReadOrPublished', async () => {
  await seedLive({ csv: LIVE_CSV, homeScore: 31, awayScore: 17 });
  const cache = fakeIncrementalCache([]);
  await warmThrough(cache);

  const store = { ...nextStore(cache), isDraftMode: true };
  const res = await workAsyncStorage.run(store as never, () => GET(authedRequest()));
  const body = (await res.json()) as Record<string, never>;
  const cacheRead = body.cacheRead as unknown as Record<string, unknown>;

  assert.equal(cacheRead.verdict, 'bypassed');
  assert.equal(cacheRead.queuedPublication, false, 'draft mode publishes nothing');
  assert.equal(cacheRead.dataCachePublicationQueued, false);
  assert.equal((cacheRead.flags as Record<string, unknown>).isDraftMode, true);
  assert.equal(
    (body.comparison as unknown as Record<string, unknown>).matches,
    null,
    'and nothing is claimed about agreement'
  );
});

/**
 * `unstable_cache` resolves its cache as
 * `workStore?.incrementalCache || globalThis.__incrementalCache`
 * (`unstable-cache.js:60`), and a Next server sets that global process-wide
 * (`base-server.js:852`). Checking only the work store reported `unavailable`
 * and "nothing was read from the data cache" for a request whose read went
 * through the global — a false negative about durable state.
 */
test('doesNotReportUnavailableWhenOnlyTheGlobalCacheIsPresent', async () => {
  await seedLive({ csv: LIVE_CSV, homeScore: 31, awayScore: 17 });
  const globals = globalThis as { __incrementalCache?: unknown };
  const original = globals.__incrementalCache;
  globals.__incrementalCache = fakeIncrementalCache([]);
  try {
    // No `workAsyncStorage.run`: the work store is absent, the global is not.
    const res = await GET(authedRequest());
    const body = (await res.json()) as Record<string, never>;
    const cacheRead = body.cacheRead as unknown as Record<string, unknown>;
    assert.notEqual(
      cacheRead.verdict,
      'unavailable',
      'a cache the read can actually reach must not be reported as absent'
    );
    assert.equal(cacheRead.incrementalCachePresent, true);
    assert.equal(
      (cacheRead.flags as Record<string, unknown>).workStorePresent,
      false,
      'and the narrower fact is still reported, so the two can be told apart'
    );
  } finally {
    if (original === undefined) delete globals.__incrementalCache;
    else globals.__incrementalCache = original;
  }
});

/**
 * A zero-owner comparison previously reported `matches: false` with
 * `differences: []` — an assertion of divergence with nothing to point at.
 */
test('reportsNullRatherThanDisagreementOverAnEmptyPopulation', async () => {
  // A registered league with no roster and no archive: the snapshot carries no
  // rows at all, so the population is empty on both sides.
  await setAppState('leagues', 'registry', [makeLeague()]);
  const cache = fakeIncrementalCache([]);
  await warmAtFixedClock(cache);
  const { body } = await requestThrough(cache);

  const comparison = body.comparison as unknown as Record<string, unknown>;
  assert.equal(comparison.comparedOwners, 0, 'the population is zero, and it is printed');
  assert.equal(comparison.matches, null, 'not false — there was nothing that could have differed');
  assert.equal(comparison.blockedBy, 'empty-population');
  assert.deepEqual(comparison.differences, []);
});

/**
 * Rank travels with a one-sided owner too. The response advertises rank as a
 * derived field, and omitting it here made the two difference shapes disagree.
 */
test('includesRankForAnOwnerPresentOnOnlyOneSide', async () => {
  await seedLive({ csv: LIVE_CSV, homeScore: 31, awayScore: 17 });
  const cache = fakeIncrementalCache([]);
  await warmAtFixedClock(cache);
  await setAppState(`owners:${SLUG}:${YEAR}`, 'csv', 'team,owner\nTexas,Cal\nGeorgia,Bob\n');

  const { body } = await requestThrough(cache);
  const byOwner = new Map(
    (
      (body.comparison as unknown as Record<string, unknown>).differences as Array<
        Record<string, unknown>
      >
    ).map((d) => [d.owner as string, d])
  );
  const annRank = (byOwner.get('Ann')!.fields as Array<Record<string, unknown>>).find(
    (f) => f.field === 'rank'
  );
  assert.deepEqual(annRank, { field: 'rank', cached: 1, fresh: null });
  const calRank = (byOwner.get('Cal')!.fields as Array<Record<string, unknown>>).find(
    (f) => f.field === 'rank'
  );
  assert.deepEqual(calRank, { field: 'rank', cached: null, fresh: 1 });
});

// ---------------------------------------------------------------------------
// Added at the confirming pass. Every one of these covers a way the route could
// still claim more than it knows — three of them defects round 1 introduced.
// ---------------------------------------------------------------------------

/**
 * ROUND 1 SHIPPED A FALSE CLAIM ABOUT DURABLE STATE HERE, and this is the test
 * that would have caught it.
 *
 * `unstable_cache` publishes one of two ways: with a work store it defers into
 * `pendingRevalidates` (`unstable-cache.js:211`); without one it `await`s
 * `cacheNewResult` INLINE (`:249`) and never touches that map. Round 1 widened
 * the cache check to include `globalThis.__incrementalCache` but left the
 * publication signal reading the work store, so on the inline branch the delta
 * was structurally zero, a cold read fell through to `bypassed`, and the route
 * announced "nothing was stored, no snapshot exists" for a request that had just
 * written two entries.
 *
 * The round-1 test asserted only `notEqual(verdict, 'unavailable')` and sailed
 * straight over it. This one asserts the verdict AND the cache's own events.
 */
test('reportsMissAndConfirmsThePublicationOnTheInlineBranch', async () => {
  await seedLive({ csv: LIVE_CSV, homeScore: 31, awayScore: 17 });
  const globals = globalThis as { __incrementalCache?: unknown };
  const original = globals.__incrementalCache;
  const events: string[] = [];
  globals.__incrementalCache = fakeIncrementalCache(events);
  try {
    // No `workAsyncStorage.run`: the work store is absent, the global is not.
    const res = await GET(authedRequest());
    const body = (await res.json()) as Record<string, never>;
    const cacheRead = body.cacheRead as unknown as Record<string, unknown>;

    const sets = events.filter((e) => e.startsWith('set:'));
    assert.ok(sets.length > 0, 'the inline branch really did publish');
    assert.equal(
      cacheRead.verdict,
      'miss',
      'a cold read that published must not report `bypassed` — that asserts nothing was stored'
    );
    assert.equal(
      cacheRead.dataCachePublicationConfirmed,
      true,
      'and here alone it can say CONFIRMED: the set was awaited before the value came back'
    );
    assert.equal(cacheRead.incrementalCachePresent, true);
    assert.equal((cacheRead.flags as Record<string, unknown>).workStorePresent, false);
  } finally {
    if (original === undefined) delete globals.__incrementalCache;
    else globals.__incrementalCache = original;
  }
});

/**
 * A BLOCKER GATES ABSENCE ONLY.
 *
 * Round 1 applied the blockers to `matches` unconditionally, so a snapshot with
 * no owners reported `matches: null` — "nothing could have differed" — while
 * `snapshotDifferences` listed a real divergence in the same payload. A positive
 * finding is evidence under every blocker in the list.
 */
test('reportsFalseWhenADifferenceIsFoundEvenUnderABlocker', async () => {
  // No roster and no archive: zero owners on both sides, so `empty-population`
  // would fire — but the schedule probe moves the source underneath it.
  await setAppState('leagues', 'registry', [makeLeague()]);
  const cache = fakeIncrementalCache([]);
  await warmAtFixedClock(cache);

  await setAppState('schedule-probe', String(YEAR), {
    year: YEAR,
    baseCachedAt: null,
    firstGameDate: `${YEAR}-08-30T00:00:00.000Z`,
  });

  const { body } = await requestThrough(cache);
  const comparison = body.comparison as unknown as Record<string, unknown>;

  assert.equal(comparison.comparedOwners, 0, 'still an empty population');
  assert.ok(
    (comparison.snapshotDifferences as unknown[]).length > 0,
    'and a real snapshot-level difference was found'
  );
  assert.equal(
    comparison.matches,
    false,
    'a difference that WAS found is evidence, whatever the blocker says about what could not be'
  );
  assert.equal(comparison.blockedBy, 'empty-population', 'the blocker is still reported');
});

/**
 * `pending` in the history digest — the case `selectSeasonContext` reads.
 *
 * `standingsHistory.ts` states it one line above `played`: the elapsed-time
 * allowance is deliberately not folded into `played`, so `pending` carries what
 * a consumer needs to apply the clock. Correcting an unresolved game's kickoff
 * moves `pending` and moves nothing else — same rows, same `played`, same
 * coverage — so a digest without it reports a clean match over a history that
 * decides finality differently.
 */
test('detectsAPendingKickoffCorrectionWithIdenticalRows', async () => {
  await seedLive({ csv: LIVE_CSV, homeScore: 31, awayScore: 17 });
  await seedSchedule([scheduleGame('g1', 1, 'final'), scheduleGame('g2', 2, 'scheduled')]);
  const cache = fakeIncrementalCache([]);
  await warmThrough(cache);

  // ONLY the unresolved game's kickoff moves. Nothing invalidates.
  const moved = { ...scheduleGame('g2', 2, 'scheduled'), startDate: `${YEAR}-09-05T23:30:00.000Z` };
  await seedSchedule([scheduleGame('g1', 1, 'final'), moved]);

  const { body } = await requestThrough(cache);
  const comparison = body.comparison as unknown as Record<string, unknown>;

  assert.deepEqual(comparison.differences, [], 'no owner row moved — that is the point');
  const weekDiffs = (comparison.snapshotDifferences as Array<Record<string, unknown>>).filter((d) =>
    String(d.field).startsWith('standingsHistory.week')
  );
  assert.equal(weekDiffs.length, 1, 'exactly the week whose pending game moved');
  assert.match(String(weekDiffs[0]!.cached), /pending=.*2026-09-02/);
  assert.match(String(weekDiffs[0]!.fresh), /pending=.*2026-09-05/);
  assert.equal(comparison.matches, false);
});

/**
 * The shared-cache list is a FACT THE TESTS CHECK, not a sentence.
 *
 * The prose it replaced asserted that non-archive sources "re-read every input
 * from the store", which review showed is false — `resolveSeason` calls
 * `listSeasonArchives` on every season compute and it is `unstable_cache`-
 * wrapped. This fails if `seasonArchive.ts` grows another cache site, so the
 * enumeration cannot go stale the way the sentence did.
 */
test('sharedNestedCachesAreEnumeratedCompletely', async () => {
  const source = await readFile(join(process.cwd(), 'src/lib/seasonArchive.ts'), 'utf8');
  // COUNT THE QUANTITY, NOT ITS FORMATTING. The first version matched only a
  // call that BEGAN a line, so `return unstable_cache(` or
  // `export const x = unstable_cache(` would have been invisible while this test
  // stayed green and `SHARED_NESTED_CACHES` went stale — the same
  // keyed-on-a-rendering-detail mistake CLAUDE.md records for the Codex
  // diff-base check, in the one test whose job is keeping that list honest.
  // Import lines and comments are excluded because neither is a cache site.
  const sites =
    source
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line) && !/^\s*import\b/.test(line))
      .join('\n')
      .match(/unstable_cache\s*\(/g) ?? [];
  assert.equal(
    sites.length,
    2,
    'seasonArchive.ts has exactly the two cache sites the payload enumerates; a third means sharedNestedCaches is now incomplete'
  );

  await seedLive({ csv: LIVE_CSV, homeScore: 31, awayScore: 17 });
  const { body } = await requestThrough(fakeIncrementalCache([]));
  assert.equal(
    ((body.freshness as unknown as Record<string, unknown>).sharedNestedCaches as string[]).length,
    sites.length,
    'and the payload lists exactly that many'
  );
});

/**
 * THE ACCEPTANCE BULLET THAT WENT UNCHECKED FOR TWO REVIEW ROUNDS.
 *
 * The prompt asks for the per-owner values "for both sides" AND a `differences`
 * array. Only `differences` was built, so when cached and fresh agreed the
 * response carried a count and a list of field names and no values — the
 * PRIMARY SUCCESS CASE could not show what it had compared. Both reviewers
 * missed it for two rounds because both reported against the receipt's rulings
 * rather than the prompt's acceptance list, and the rulings amended the unit and
 * the field set without ever removing this.
 */
test('returnsBothSidesForEveryComparedOwnerWhenTheyAgree', async () => {
  await seedLive({ csv: LIVE_CSV, homeScore: 31, awayScore: 17 });
  const cache = fakeIncrementalCache([]);
  await warmAtFixedClock(cache);
  const { body } = await requestThrough(cache);

  const comparison = body.comparison as unknown as Record<string, unknown>;
  assert.equal(comparison.matches, true, 'this is the success case');
  assert.deepEqual(comparison.differences, [], 'and it has no differences to show');

  const owners = comparison.owners as Array<Record<string, unknown>>;
  assert.equal(owners.length, comparison.comparedOwners, 'every compared owner is listed');
  const ann = owners.find((o) => o.owner === 'Ann');
  assert.ok(ann, 'Ann is present even though nothing about her changed');
  assert.deepEqual(
    ann.cached,
    {
      rank: 1,
      wins: 1,
      losses: 0,
      pointsFor: 31,
      pointsAgainst: 17,
      pointDifferential: 14,
      winPct: 1,
      gamesBack: 0,
      finalGames: 1,
    },
    'the cached side carries values, not just a field name'
  );
  assert.deepEqual(ann.fresh, ann.cached, 'and the fresh side is reported independently');
});

test('returnsANullSideForAnOwnerMissingFromOneSnapshot', async () => {
  await seedLive({ csv: LIVE_CSV, homeScore: 31, awayScore: 17 });
  const cache = fakeIncrementalCache([]);
  await warmAtFixedClock(cache);
  await setAppState(`owners:${SLUG}:${YEAR}`, 'csv', 'team,owner\nTexas,Cal\nGeorgia,Bob\n');

  const { body } = await requestThrough(cache);
  const owners = (body.comparison as unknown as Record<string, unknown>).owners as Array<
    Record<string, unknown>
  >;
  const ann = owners.find((o) => o.owner === 'Ann')!;
  const cal = owners.find((o) => o.owner === 'Cal')!;
  assert.equal(ann.fresh, null, 'absent from the rebuild');
  assert.equal((ann.cached as Record<string, unknown>).rank, 1);
  assert.equal(cal.cached, null, 'absent from the snapshot');
  assert.equal((cal.fresh as Record<string, unknown>).rank, 1);
});

/**
 * THE FOURTH BRANCH OF `classifyCacheRead`, which nothing exercised.
 *
 * `unstable_cache` serves a stale entry and queues its replacement
 * (`unstable-cache.js`, the `cacheEntry.isStale` path): the caller gets the OLD
 * value while a recompute lands in `pendingRevalidates`. So the publication
 * signal fires on a request that is unambiguously a HIT — which is exactly why
 * the verdict cannot rest on that signal alone, and why `generatedAt` has to
 * separate them.
 *
 * `fakeIncrementalCache` hardcoded `isStale: false`, so this branch was
 * unreachable from the suite while the classifier's doc named a test for each of
 * the other three verdicts. Review called that coverage that does not exist, and
 * it was right.
 */
test('reportsAHitWithBackgroundRevalidationForAStaleEntry', async () => {
  await seedLive({ csv: LIVE_CSV, homeScore: 31, awayScore: 17 });
  const events: string[] = [];
  const cache = fakeIncrementalCache(events);
  await warmAtFixedClock(cache);

  cache.markAllStale();
  const { body } = await requestThrough(cache);
  const cacheRead = body.cacheRead as unknown as Record<string, unknown>;

  assert.equal(
    cacheRead.verdict,
    'hit',
    'a stale entry is still served — the caller read the cache'
  );
  assert.equal(
    cacheRead.queuedPublication,
    true,
    'and a replacement was queued, so the publication signal alone would have said `miss`'
  );
  assert.equal(cacheRead.backgroundRevalidation, true);
  assert.equal(
    cacheRead.cachedGeneratedAt,
    WARM_CLOCK.toISOString(),
    'the value compared is the STALE one, stamped by the warming request'
  );
  assert.equal(
    cacheRead.dataCachePublicationConfirmed,
    false,
    'the replacement is queued, not confirmed'
  );
});

// ---------------------------------------------------------------------------
// Round 4. All three fixes are one class: the detector describing more than it
// observes. The precommitment is that another variant of this class ends the
// remediation and ships with the limitation documented.
// ---------------------------------------------------------------------------

/**
 * A GENUINE HIT MUST NOT READ AS `bypassed` WHEN THE STAMPS COLLIDE.
 *
 * `bypassed` used to be derived by elimination — no publication and the stamp
 * matches — so a snapshot warmed in this request's millisecond flipped a real
 * hit into "recomputed and published nothing". Both reviewers reported it three
 * times and this suite reproduced it. It is now gated on the observed
 * `isDraftMode` flag, the only thing that can actually produce that state.
 *
 * The collision is forced here rather than waited for: warming at the probe's
 * own clock is the same-millisecond case, made deterministic.
 */
test('doesNotReportBypassedWhenAWarmStampCollidesWithTheProbe', async () => {
  await seedLive({ csv: LIVE_CSV, homeScore: 31, awayScore: 17 });
  const cache = fakeIncrementalCache([]);

  // Warm with a clock we then force the request to share.
  const collide = new Date();
  const store = nextStore(cache);
  await workAsyncStorage.run(store as never, () =>
    getCanonicalStandings({ slug: SLUG, year: YEAR, currentDate: collide })
  );
  await Promise.allSettled(Object.values(store.pendingRevalidates));

  // The route calls `new Date()`, which does NOT consult `Date.now`, so stubbing
  // `Date.now` alone leaves the stamps a millisecond or two apart and the test
  // proves nothing. Freeze the constructor for exactly one request instead — the
  // collision assertion below is what catches it if this ever stops working.
  const RealDate = globalThis.Date;
  class FrozenDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(collide.getTime());
      else super(...(args as [number]));
    }
    static override now(): number {
      return collide.getTime();
    }
  }
  globalThis.Date = FrozenDate as unknown as DateConstructor;
  let body: Record<string, never>;
  try {
    ({ body } = await requestThrough(cache));
  } finally {
    globalThis.Date = RealDate;
  }

  const cacheRead = body!.cacheRead as unknown as Record<string, unknown>;
  assert.equal(
    cacheRead.cachedGeneratedAt,
    cacheRead.probeStamp,
    'the stamps really do collide — without this the test proves nothing'
  );
  assert.equal(cacheRead.queuedPublication, false, 'and nothing was published');
  assert.equal(
    cacheRead.verdict,
    'hit',
    'so the old elimination rule would have said `bypassed`; the flag gate says hit'
  );
  assert.equal(
    cacheRead.provenanceRestsOnTimestamp,
    false,
    'and this verdict no longer rests on the stamp at all'
  );
});

test('reportsThatProvenanceStillRestsOnTheStampWhereItDoes', async () => {
  await seedLive({ csv: LIVE_CSV, homeScore: 31, awayScore: 17 });
  const globals = globalThis as { __incrementalCache?: unknown };
  const original = globals.__incrementalCache;
  globals.__incrementalCache = fakeIncrementalCache([]);
  try {
    // The inline branch keeps no publication record, so the stamp is its only
    // signal and the residual is real. The route says so rather than implying
    // the stamp problem is gone everywhere.
    const res = await GET(authedRequest());
    const cacheRead = ((await res.json()) as Record<string, never>).cacheRead as unknown as Record<
      string,
      unknown
    >;
    assert.equal(cacheRead.provenanceRestsOnTimestamp, true);
  } finally {
    if (original === undefined) delete globals.__incrementalCache;
    else globals.__incrementalCache = original;
  }
});

/**
 * THE BLIND SPOT IS NAMED, AND IT IS NOT A BLOCKER.
 *
 * `resolveSeason`/`resolveOffseason` read `listSeasonArchives` through its own
 * tag-only cache, so a stale years list sends BOTH sides down the live branch
 * and they agree for that reason. The rows are still independently re-derived,
 * so blocking `matches` outright would answer `null` for essentially every real
 * request; the exposure is reported instead, which is what lets a reader tell
 * "agrees" from "both sides read the same stale input".
 */
test('namesTheArchiveYearsBlindSpotPerLifecycle', async () => {
  await seedLive({ csv: LIVE_CSV, homeScore: 31, awayScore: 17 });
  const cache = fakeIncrementalCache([]);
  await warmAtFixedClock(cache);
  const { body } = await requestThrough(cache);
  const comparison = body.comparison as unknown as Record<string, unknown>;

  assert.equal(comparison.matches, true, 'a season league still gets a usable answer');
  assert.equal(comparison.blockedBy, null, 'the blind spot is not a blocker');
  assert.equal((comparison.blindSpots as string[]).length, 1);
  assert.match(String((comparison.blindSpots as string[])[0]), /stale-archive-years-list/);

  // Preseason never calls `listSeasonArchives`, so it carries no such exposure.
  await setAppState('leagues', 'registry', [
    { ...makeLeague(), status: { state: 'preseason', year: YEAR } },
  ]);
  await setAppState(`preseason-owners:${SLUG}`, String(YEAR), ['Ann', 'Bob']);
  const preseason = await requestThrough(fakeIncrementalCache([]));
  assert.deepEqual(
    (preseason.body.comparison as unknown as Record<string, unknown>).blindSpots,
    [],
    'preseason reads no archive-years cache, so it claims no blind spot it does not have'
  );
});

/**
 * THE PUBLICATION SUMMARY COUNTS FROM ENTRY, NOT FROM THE VERDICT'S BRACKET.
 *
 * `resolveStandingsYear` consults `listSeasonArchives` on an offseason league
 * and can queue a publication before the bracket opens. The bracket stays narrow
 * so a year-resolution write cannot be mistaken for the standings entry; the
 * SUMMARY widened, because reporting `false` on a request that queued one is the
 * same false-negative-about-durable-state this route exists to prevent.
 */
test('countsPublicationsQueuedBeforeTheVerdictBracket', async () => {
  // An OFFSEASON league with NO archives, chosen so the pre-bracket write is the
  // ONLY publication in the request. `resolveStandingsYear` consults
  // `listSeasonArchives` for offseason status; with no archive rows
  // `resolveOffseason` never reaches `getSeasonArchive`, so the fresh rebuild
  // publishes nothing and the two mutations this pins — taking the entry reading
  // after year resolution, and summarising from the narrow bracket — both flip a
  // number rather than relying on a coincidence.
  await setAppState('leagues', 'registry', [{ ...makeLeague(), status: { state: 'offseason' } }]);

  const cache = fakeIncrementalCache([]);
  await warmAtFixedClock(cache);
  // Warming published the archive-years entry through the UN-NESTED
  // `resolveStandingsYear`. Evict it (and nothing else) so the next request's
  // year resolution misses again; `archive:<slug>` is the archive family's tag
  // and canonical standings does not carry it.
  await cache.revalidateTag(`archive:${SLUG}`);

  const { body } = await requestThrough(cache);
  const cacheRead = body.cacheRead as unknown as Record<string, unknown>;

  assert.equal(cacheRead.verdict, 'hit', 'the standings entry itself is still warm');
  assert.ok(
    (cacheRead.pendingPublicationsAtEntry as number) <
      (cacheRead.pendingPublicationsBefore as number),
    'year resolution queued a publication BEFORE the verdict bracket opened — which is only visible because the entry reading is taken first'
  );
  assert.equal(
    cacheRead.pendingPublicationsAfterFreshRebuild,
    cacheRead.pendingPublicationsAfterCachedRead,
    'and nothing else published, so the pre-bracket write is the only one in the request'
  );
  assert.equal(
    cacheRead.dataCachePublicationQueued,
    true,
    'the summary must report it; counting from the bracket instead would say false on a request that queued one'
  );
  assert.equal(cacheRead.queuedPublication, false, 'while the VERDICT stays on the narrow bracket');
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
    // 404 now, and that IS the point of the path: it must refuse before the
    // cached read rather than mint an entry under an arbitrary slug.
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
      assert.ok(
        res.status === 200 || res.status === 400 || res.status === 404,
        `${name}: ${res.status}`
      );
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
    'there is no ties field to compare — the list IS the claim, rather than a sentence about it'
  );
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
  await warmAtFixedClock(cache);

  // The archive moves. Nothing invalidates the standings tag OR the archive tag.
  await seedArchive([makeRow('Ann', { wins: 2, losses: 8 })]);

  const { body } = await requestThrough(cache);
  const comparison = body.comparison as unknown as Record<string, unknown>;
  // THIS ASSERTION IS THE REVIEW FINDING. It used to read `matches: true` —
  // the route asserting agreement over a divergence it structurally cannot see,
  // with this test pinning the misleading output as if it were correct.
  assert.equal(
    comparison.matches,
    null,
    'both sides read the same cached archive, so the route must decline to answer rather than claim agreement'
  );
  assert.equal(comparison.blockedBy, 'shared-archive-cache');
  assert.deepEqual(comparison.differences, [], 'and it still has nothing to point at');

  assert.ok(
    ((body.freshness as unknown as Record<string, unknown>).sharedNestedCaches as string[]).some(
      (entry) => entry.includes('archive')
    ),
    'and the response enumerates the shared cache, rather than letting a clean result imply more than it proves'
  );
});

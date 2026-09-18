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
  canonicalStandingsCacheKeyParts,
  computeCanonicalStandingsUncached,
  getCanonicalStandings,
  resolveStandingsYear,
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
// the route reads the work store for its `publication-unobservable-inline-path`
// verdict rule instead of
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
     * Test-only: rewrite every stored value. Used to build the ONE fixture that
     * cannot be produced through the selector — a snapshot published before a
     * field existed, where the key is absent rather than null.
     */
    mutateStoredValues(fn: (value: unknown) => unknown) {
      for (const [key, record] of records) {
        records.set(key, { ...record, value: fn(record.value) });
      }
    },
    /**
     * Test-only: mark every stored entry stale, so `incrementalCache.get`
     * returns one. Without this the fake could never produce `isStale: true`
     * and `deriveCacheReadFacts`'s background-revalidation branch was unreachable
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
 * WARMS THROUGH THE ROUTE AND PUBLISHES. The publish step is the harness
 * limitation described at the top of this file: production drains
 * `pendingRevalidates` after the response through `pendingWaitUntil`; here the
 * test does it. The warming request stamps the snapshot with its own
 * `new Date()`.
 *
 * Use `warmAtFixedClock` instead in any test that asserts a VERDICT or a
 * BLOCKER. Two requests microseconds apart can land in the same millisecond, and
 * `deriveCacheReadFacts` then reads a genuine hit as `cannot-tell` — a live
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

/** @see WARM_CLOCK above for why the warm clock is pinned. */
async function warmAtFixedClock(cache: ReturnType<typeof fakeIncrementalCache>): Promise<void> {
  const store = nextStore(cache);
  await workAsyncStorage.run(store as never, () =>
    getCanonicalStandings({ slug: SLUG, year: YEAR, currentDate: WARM_CLOCK })
  );
  await Promise.allSettled(Object.values(store.pendingRevalidates));
}

/**
 * Archive rows, which is what `SeasonArchive.finalStandings` holds. Note the
 * `ties` — see `archiveRowsCarryAFabricatedTieCountAndLiveRowsCarryNone` below.
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

/** As `seedArchive`, but with an explicit history so its ORDER can be controlled. */
async function seedArchiveWithHistory(
  rows: StandingsHistoryStandingRow[],
  standingsHistory: StandingsHistory
): Promise<void> {
  const archive: SeasonArchive = {
    leagueSlug: SLUG,
    year: YEAR,
    archivedAt: '2026-01-02T00:00:00.000Z',
    ownerRosterSnapshot: 'team,owner\n',
    standingsHistory,
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
    cacheRead.snapshotGeneratedAt,
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
  const byField = new Map(
    (comparison.snapshotDifferences as Array<Record<string, unknown>>).map((d) => [
      d.field as string,
      d,
    ])
  );
  assert.deepEqual(byField.get('standingsHistory.weeks'), {
    field: 'standingsHistory.weeks',
    cached: '1',
    fresh: '1,2',
  });
  assert.equal(byField.get('standingsHistory.week2')?.cached, 'absent');
  // Each row carries its INDEX — the position `selectRankTrend` reads as rank.
  assert.match(String(byField.get('standingsHistory.week2')?.fresh), /rows=0:Ann:1-0.*1:Bob:0-1/);
  // And `byOwner` is named PER OWNER, not compared by a key count that agrees
  // whenever the owner set does.
  assert.ok(byField.has('standingsHistory.byOwner.Ann'), 'Ann’s series gained a week');
  assert.ok(byField.has('standingsHistory.byOwner.Bob'), 'so did Bob’s');
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
// THE DETECTOR, v2. One test per row of `deriveCacheReadFacts`'s table,
// including all three `cannot-tell` rules — which are first-class outcomes here,
// not error paths.
//
// Each asserts the VERDICT, the RULE, and the printed observations the rule
// consumes, because acceptance is that a reader can re-derive the verdict from
// the payload without trusting the route.
// ---------------------------------------------------------------------------

/** keys added + stamped here -> miss */
test('reportsMissWhenAKeyIsPublishedAndTheSnapshotCarriesThisRequestStamp', async () => {
  await seedLive({ csv: LIVE_CSV, homeScore: 31, awayScore: 17 });
  const { body } = await requestThrough(fakeIncrementalCache([]));
  const cacheRead = body.cacheRead as unknown as Record<string, unknown>;

  assert.equal(cacheRead.verdict, 'miss');
  assert.equal(cacheRead.verdictRule, 'published-and-stamped-here');
  assert.ok(
    (cacheRead.publicationKeysAdded as string[]).some((k) => k.includes('canonical-standings')),
    'the standings entry is named in the added keys — a count could never say WHICH entry'
  );
  assert.equal(cacheRead.stampedByThisRequest, true);
  assert.equal(cacheRead.snapshotGeneratedAt, cacheRead.probeStamp);
  assert.deepEqual(cacheRead.pendingRevalidateKeysAtEntry, []);
  assert.equal(cacheRead.dataCachePublicationConfirmed, undefined, 'the field is gone entirely');
});

/** no keys + value predates us -> hit */
test('reportsHitWhenNothingIsPublishedAndTheSnapshotPredatesTheRequest', async () => {
  await seedLive({ csv: LIVE_CSV, homeScore: 31, awayScore: 17 });
  const cache = fakeIncrementalCache([]);
  await warmAtFixedClock(cache);
  const { body } = await requestThrough(cache);
  const cacheRead = body.cacheRead as unknown as Record<string, unknown>;

  assert.equal(cacheRead.verdict, 'hit');
  assert.equal(cacheRead.verdictRule, 'no-publication-and-value-predates-request');
  assert.deepEqual(cacheRead.publicationKeysAdded, []);
  assert.equal(cacheRead.stampedByThisRequest, false);
  assert.equal(cacheRead.snapshotGeneratedAt, WARM_CLOCK.toISOString());
  assert.equal(cacheRead.backgroundRevalidation, false);
});

/** keys added + value predates us -> hit, background revalidation */
test('reportsHitWithBackgroundRevalidationWhenAStaleEntryIsServed', async () => {
  await seedLive({ csv: LIVE_CSV, homeScore: 31, awayScore: 17 });
  const cache = fakeIncrementalCache([]);
  await warmAtFixedClock(cache);
  cache.markAllStale();

  const { body } = await requestThrough(cache);
  const cacheRead = body.cacheRead as unknown as Record<string, unknown>;

  // A publication IS queued here, which is exactly why the key set alone cannot
  // decide the verdict — the stamp is what separates this from a miss.
  assert.ok((cacheRead.publicationKeysAdded as string[]).length > 0);
  assert.equal(cacheRead.stampedByThisRequest, false);
  assert.equal(cacheRead.verdict, 'hit');
  assert.equal(cacheRead.verdictRule, 'published-and-value-predates-request');
  assert.equal(cacheRead.backgroundRevalidation, true);
  assert.equal(
    cacheRead.snapshotGeneratedAt,
    WARM_CLOCK.toISOString(),
    'the STALE value was served'
  );
});

/**
 * no keys + stamp matches -> CANNOT TELL.
 *
 * THE ROW THAT DEFINES THIS RECONSTRUCTION. Draft mode and a same-millisecond
 * warm both land here, and v1 resolved the state by elimination twice — first to
 * `bypassed`, then to `hit` — and both were review findings. It stays
 * unresolved, with `isDraftMode` printed beside it.
 */
test('reportsCannotTellWhenNothingPublishedAndTheStampMatches', async () => {
  await seedLive({ csv: LIVE_CSV, homeScore: 31, awayScore: 17 });
  const cache = fakeIncrementalCache([]);

  // Force the collision deterministically: warm at a clock, then make the
  // request share it. The route calls `new Date()`, which does not consult
  // `Date.now`, so the constructor is frozen for exactly one request.
  const collide = new Date();
  const store = nextStore(cache);
  await workAsyncStorage.run(store as never, () =>
    getCanonicalStandings({ slug: SLUG, year: YEAR, currentDate: collide })
  );
  await Promise.allSettled(Object.values(store.pendingRevalidates));

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
    cacheRead.snapshotGeneratedAt,
    cacheRead.probeStamp,
    'the stamps really do collide — without this the test proves nothing'
  );
  assert.deepEqual(cacheRead.publicationKeysAdded, []);
  assert.equal(
    cacheRead.verdict,
    'cannot-tell',
    'this was a genuine HIT; the route declines rather than guessing it from what did not happen'
  );
  assert.equal(cacheRead.verdictRule, 'no-publication-and-stamp-matches');
  assert.equal(
    (cacheRead.flags as Record<string, unknown>).isDraftMode,
    false,
    'and isDraftMode is printed, so a reader can see which of the two causes applies'
  );
  assert.equal(
    (body!.comparison as unknown as Record<string, unknown>).matches,
    null,
    'and nothing is claimed about agreement'
  );
});

/** draft mode reaches the SAME cannot-tell row, and is not promoted to a verdict */
test('reportsCannotTellUnderDraftModeRatherThanAVerdictOfItsOwn', async () => {
  await seedLive({ csv: LIVE_CSV, homeScore: 31, awayScore: 17 });
  const cache = fakeIncrementalCache([]);
  await warmAtFixedClock(cache);

  const store = { ...nextStore(cache), isDraftMode: true };
  const res = await workAsyncStorage.run(store as never, () => GET(authedRequest()));
  const cacheRead = ((await res.json()) as Record<string, never>).cacheRead as unknown as Record<
    string,
    unknown
  >;

  assert.equal(cacheRead.verdict, 'cannot-tell');
  assert.equal(cacheRead.verdictRule, 'no-publication-and-stamp-matches');
  assert.equal((cacheRead.flags as Record<string, unknown>).isDraftMode, true);
});

/** no work store -> CANNOT TELL, publication unobservable */
test('reportsCannotTellOnTheInlinePathWhereNoPublicationRecordExists', async () => {
  await seedLive({ csv: LIVE_CSV, homeScore: 31, awayScore: 17 });
  const globals = globalThis as { __incrementalCache?: unknown };
  const original = globals.__incrementalCache;
  const events: string[] = [];
  globals.__incrementalCache = fakeIncrementalCache(events);
  try {
    // No `workAsyncStorage.run`: `unstable_cache` takes its inline branch, which
    // awaits `cacheNewResult` and never touches `pendingRevalidates`.
    const res = await GET(authedRequest());
    const cacheRead = ((await res.json()) as Record<string, never>).cacheRead as unknown as Record<
      string,
      unknown
    >;

    assert.ok(
      events.some((e) => e.startsWith('set:')),
      'the inline branch really did publish — so a `hit` here would be a false claim'
    );
    assert.equal(cacheRead.verdict, 'cannot-tell');
    assert.equal(cacheRead.verdictRule, 'publication-unobservable-inline-path');
    assert.equal(cacheRead.incrementalCachePresent, true, 'the cache WAS present, via the global');
    assert.equal(cacheRead.workStorePresent, false, 'the work store was not');
    assert.deepEqual(
      cacheRead.pendingRevalidateKeysAtEntry,
      [],
      'and the map it would have been recorded in is empty because there is no map'
    );
  } finally {
    if (original === undefined) delete globals.__incrementalCache;
    else globals.__incrementalCache = original;
  }
});

/** no incremental cache -> CANNOT TELL, nothing consulted */
test('reportsCannotTellWhenNoDataCacheWasConsultedAtAll', async () => {
  await seedLive({ csv: LIVE_CSV, homeScore: 31, awayScore: 17 });
  const res = await GET(authedRequest());
  const body = (await res.json()) as Record<string, never>;
  const cacheRead = body.cacheRead as unknown as Record<string, unknown>;

  assert.equal(cacheRead.verdict, 'cannot-tell');
  assert.equal(cacheRead.verdictRule, 'no-data-cache-consulted');
  assert.equal(cacheRead.incrementalCachePresent, false);
  // The stamp DOES match here — a direct compute uses this request's date —
  // which is precisely why the verdict cannot be read off the stamp.
  assert.equal(cacheRead.stampedByThisRequest, true);
  assert.equal((body.comparison as unknown as Record<string, unknown>).matches, null);
});

/**
 * KEYS, NOT A COUNT.
 *
 * `patch-fetch.js:182`/`:723` delete entries from `pendingRevalidates` as fetch
 * cache-sets settle, so a count can fall while a real publication is added and a
 * delta of zero is not evidence of no write. A set difference cannot be fooled
 * that way. This simulates the deletion directly rather than arguing it.
 */
test('detectsAPublicationEvenWhenAnUnrelatedKeyIsDeletedInTheSameWindow', async () => {
  await seedLive({ csv: LIVE_CSV, homeScore: 31, awayScore: 17 });
  const cache = fakeIncrementalCache([]);
  const store = nextStore(cache);
  // TWO pending fetch keys at entry, both settling and being deleted during the
  // request — exactly what patch-fetch does. Two is the number that matters: the
  // cached read publishes two entries of its own (the archive-years read inside
  // the compute publishes too, nested or not), so deleting two makes the COUNT
  // net to zero while the SET still gained both. A one-key fixture nets +1 and a
  // count-based implementation survives it — which is how the first version of
  // this test let that mutation through.
  store.pendingRevalidates['patched-fetch-key-1'] = Promise.resolve();
  store.pendingRevalidates['patched-fetch-key-2'] = Promise.resolve();
  const originalGet = cache.get.bind(cache);
  let dropped = false;
  cache.get = async (key: string) => {
    if (!dropped) {
      dropped = true;
      delete store.pendingRevalidates['patched-fetch-key-1'];
      delete store.pendingRevalidates['patched-fetch-key-2'];
    }
    return originalGet(key);
  };

  const res = await workAsyncStorage.run(store as never, () => GET(authedRequest()));
  const cacheRead = ((await res.json()) as Record<string, never>).cacheRead as unknown as Record<
    string,
    unknown
  >;

  assert.deepEqual(
    cacheRead.publicationKeysRemoved,
    ['patched-fetch-key-1', 'patched-fetch-key-2'],
    'the deletions are reported, not silently absorbed'
  );
  assert.equal(
    (cacheRead.pendingRevalidateKeysAfterCachedRead as string[]).length,
    (cacheRead.pendingRevalidateKeysAtEntry as string[]).length,
    'the COUNT is unchanged across the window — a count-based detector sees nothing here'
  );
  assert.ok(
    (cacheRead.publicationKeysAdded as string[]).some((k) => k.includes('canonical-standings')),
    'and the real publication is still detected — a count would have netted to zero here'
  );
  assert.equal(cacheRead.verdict, 'miss');
});

// ---------------------------------------------------------------------------
// The four comparison-core corrections. The history ones close reachable gaps;
// the other two are cross-checks whose PURITY is what gets pinned, because
// claiming they close a gap they cannot reach would be the same habit in a new
// place.
// ---------------------------------------------------------------------------

/**
 * ACCEPTANCE 4 — two histories differing ONLY in order must report a difference.
 *
 * `selectRankTrend` (`trends.ts:306-320`) derives every historical rank as
 * `byWeek[week].standings.findIndex(...)`, so the array position IS the rank.
 * v1 sorted the rows into the digest and reported such a pair identical.
 *
 * The fixture reorders an ARCHIVE's history and evicts the archive cache while
 * leaving the standings snapshot warm — otherwise both sides read the same
 * cached archive and agree, which is the blind spot `sharedNestedCaches` names.
 * `finalStandings` is untouched, so the owner rows are identical on both sides
 * and ORDER is the only difference in play.
 */
test('reportsADifferenceWhenTwoHistoriesDifferOnlyInOrder', async () => {
  const ann = makeRow('Ann', { wins: 9, losses: 1, pointsFor: 300, pointsAgainst: 150 });
  const bob = makeRow('Bob', { wins: 4, losses: 6, pointsFor: 200, pointsAgainst: 260 });
  const historyWith = (order: StandingsHistoryStandingRow[]): StandingsHistory => ({
    weeks: [1],
    byWeek: { 1: { week: 1, standings: order, coverage: { state: 'complete', message: null } } },
    byOwner: {},
  });

  await setAppState('leagues', 'registry', [makeLeague()]);
  await seedArchiveWithHistory([ann, bob], historyWith([ann, bob]));

  const cache = fakeIncrementalCache([]);
  await warmAtFixedClock(cache);

  // Same rows, swapped positions. Nothing else moves.
  await seedArchiveWithHistory([ann, bob], historyWith([bob, ann]));
  await cache.revalidateTag(`archive:${SLUG}`);

  const { body } = await requestThrough(cache);
  const comparison = body.comparison as unknown as Record<string, unknown>;

  assert.deepEqual(
    comparison.differences,
    [],
    'the owner rows are identical — which is exactly why a row-only comparison misses this'
  );
  const weekDiff = (comparison.snapshotDifferences as Array<Record<string, unknown>>).find(
    (d) => d.field === 'standingsHistory.week1'
  );
  assert.ok(weekDiff, 'the reordered week is named');
  assert.match(String(weekDiff.cached), /rows=0:Ann.*1:Bob/);
  assert.match(String(weekDiff.fresh), /rows=0:Bob.*1:Ann/);
  assert.equal(comparison.matches, false);
});

/**
 * The purity `ownerColorOrder`'s comparison rests on. If this stops holding, the
 * comparison stops being a cross-check and becomes load-bearing — which is the
 * moment someone needs to know.
 */
test('ownerColorOrderIsPureInRows', async () => {
  // THE FIXTURE MUST BE ABLE TO FAIL. `LIVE_CSV` puts Ann on the winning team,
  // so canonical row order (wins desc) and alphabetical order coincide and a
  // broken sort is invisible — the first version of this test was vacuous for
  // exactly that reason. Zoe wins here, so the two orders disagree.
  await seedLive({ csv: 'team,owner\nTexas,Zoe\nGeorgia,Ann\n', homeScore: 31, awayScore: 17 });
  const snapshot = await computeCanonicalStandingsUncached({
    slug: SLUG,
    year: YEAR,
    currentDate: new Date('2026-09-17T12:00:00Z'),
  });
  assert.deepEqual(
    snapshot.rows.map((row) => row.owner),
    ['Zoe', 'Ann'],
    'canonical row order is by record, so it is NOT alphabetical here — the control'
  );
  assert.deepEqual(
    snapshot.ownerColorOrder,
    snapshot.rows
      .map((row) => row.owner)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })),
    'ownerColorOrder is the sorted owners of rows, so it cannot diverge while rows agree'
  );
  assert.deepEqual(snapshot.ownerColorOrder, ['Ann', 'Zoe'], 'and it really is sorted');
});

/**
 * The same, for `coverage.message`. Inside a canonical snapshot the only shapes
 * reachable are `{complete, null}` and `{partial, "Waiting on complete results"}`.
 */
test('coverageMessageIsDeterminedByState', async () => {
  await seedLive({ csv: LIVE_CSV, homeScore: 31, awayScore: 17 });
  const complete = await computeCanonicalStandingsUncached({
    slug: SLUG,
    year: YEAR,
    currentDate: new Date('2026-09-17T12:00:00Z'),
  });
  assert.equal(complete.coverage.state, 'complete');
  assert.equal(complete.coverage.message, null, 'complete carries no message');

  // An owned game with conclusion evidence and no usable final -> partial.
  await seedScores(31, null as unknown as number);
  const partial = await computeCanonicalStandingsUncached({
    slug: SLUG,
    year: YEAR,
    currentDate: new Date('2026-09-17T12:00:00Z'),
  });
  if (partial.coverage.state === 'partial') {
    assert.equal(
      partial.coverage.message,
      'Waiting on complete results',
      'partial carries the ONE constant message, so message adds no resolution over state'
    );
  }
});

/**
 * #818 — a season the league has ARCHIVED is admitted even when it falls outside
 * the ordinary range, matching `resolveArchiveYearParam`'s bound in
 * `seasonArchive.ts`. The refusal half is covered by
 * `rejectsAnOutOfRangeYearBeforeAnyBuild`; both halves matter, and this one had
 * no test until a mutation removing the disjunct survived.
 *
 * 2099 is above `maxCreatableSeasonYear`, so only the disjunct can admit it.
 * (Below `MIN_SEASON_YEAR` would not work as a fixture: `readArchiveYearsFromStore`
 * filters `n >= 2000`, so a 1999 archive is never listed in the first place.)
 */
test('acceptsAnArchivedSeasonOutsideTheOrdinaryRange', async () => {
  await seedLive({ csv: LIVE_CSV, homeScore: 31, awayScore: 17 });
  await setAppState(`standings-archive:${SLUG}`, '2099', {
    leagueSlug: SLUG,
    year: 2099,
    archivedAt: '2099-01-02T00:00:00.000Z',
    ownerRosterSnapshot: 'team,owner\n',
    standingsHistory: EMPTY_HISTORY,
    finalStandings: [makeRow('Ann', { wins: 1, losses: 0 })],
    games: [],
    scoresByKey: {},
  } satisfies SeasonArchive);

  const accepted = await requestThrough(fakeIncrementalCache([]), `?leagueSlug=${SLUG}&year=2099`);
  assert.equal(accepted.status, 200, 'an archived season is inspectable');
  assert.equal((accepted.body.year as unknown as Record<string, unknown>).resolved, 2099);

  // And an UNLISTED out-of-range year is still refused — the half that stops a
  // distinct `?year=` minting a rebuild per value.
  const refused = await requestThrough(fakeIncrementalCache([]), `?leagueSlug=${SLUG}&year=2098`);
  assert.equal(refused.status, 400);
});

// ---------------------------------------------------------------------------
// Review round 1. The attribution fix was authorized as an override of the
// precommitment; the other two are outside its class.
// ---------------------------------------------------------------------------

/**
 * THE VERDICT MUST IGNORE PUBLICATIONS FROM OTHER CACHE FAMILIES.
 *
 * `resolveStandingsYear` runs inside the observation window and, on an offseason
 * league, reads `listSeasonArchives` — tagged `archive:<slug>`, a different
 * family from `standings:*`. Branching on ANY added key reported a plain hit as
 * `published-and-value-predates-request` with `backgroundRevalidation: true`.
 * Both reviewers found it independently and one reproduced it.
 *
 * The fixture is theirs: offseason league with archives, warm at a fixed clock,
 * evict only the archive entries, then one request.
 */
test('doesNotAttributeAnArchiveYearsPublicationToTheStandingsRead', async () => {
  await setAppState('leagues', 'registry', [{ ...makeLeague(), status: { state: 'offseason' } }]);
  await seedArchive([makeRow('Ann', { wins: 9, losses: 1 })]);

  const cache = fakeIncrementalCache([]);
  await warmAtFixedClock(cache);
  // Evict ONLY the archive family. Canonical standings does not carry this tag.
  await cache.revalidateTag(`archive:${SLUG}`);

  const { body } = await requestThrough(cache);
  const cacheRead = body.cacheRead as unknown as Record<string, unknown>;

  // The archive-years publication really does land in the window — without this
  // the test would pass for the wrong reason.
  assert.ok(
    (cacheRead.publicationKeysAdded as string[]).some((k) => k.includes('season-archive-years')),
    'the archive-years entry was published inside the observed window'
  );
  assert.deepEqual(
    cacheRead.standingsPublicationKeysAdded,
    [],
    'but NOTHING was published for the canonical-standings entry'
  );
  assert.equal(cacheRead.verdict, 'hit');
  assert.equal(
    cacheRead.verdictRule,
    'no-publication-and-value-predates-request',
    'so the verdict is a plain hit, not a background revalidation'
  );
  assert.equal(cacheRead.backgroundRevalidation, false);
});

/**
 * The signature is derived from `canonicalStandingsCacheKeyParts`, so it cannot
 * drift from the key it matches. Printed too, so a reader can check the match
 * rather than trust it.
 */
test('printsTheStandingsKeySignatureItMatchedOn', async () => {
  await seedLive({ csv: LIVE_CSV, homeScore: 31, awayScore: 17 });
  const { body } = await requestThrough(fakeIncrementalCache([]));
  const cacheRead = body.cacheRead as unknown as Record<string, unknown>;

  const signature = String(cacheRead.standingsKeySignature);
  assert.match(signature, /^canonical-standings,delta-probe,2026,/);
  assert.ok(
    (cacheRead.standingsPublicationKeysAdded as string[]).every((k) => k.includes(signature)),
    'every key the verdict rested on really contains the signature'
  );
  assert.ok((cacheRead.standingsPublicationKeysAdded as string[]).length > 0);
  assert.equal(cacheRead.verdict, 'miss');
});

/**
 * #818's disjunct must not turn a certain 400 into a 500.
 *
 * `readArchiveYearsFromStore` filters `n >= 2000`, so a sub-floor year can never
 * be in the list and consulting the store for one is a round-trip whose result
 * cannot change the answer — while the read propagates failure. This is the
 * precedent's own review finding (`seasonArchive.ts`), which I cited and did not
 * copy.
 */
test('refusesASubFloorYearWithoutReadingArchives', async () => {
  await seedLive({ csv: LIVE_CSV, homeScore: 31, awayScore: 17 });
  const events: string[] = [];
  const { status } = await requestThrough(
    fakeIncrementalCache(events),
    `?leagueSlug=${SLUG}&year=1999`
  );
  assert.equal(status, 400);
  assert.equal(
    events.some((e) => e.includes('season-archive-years')),
    false,
    'the archive store was never consulted for a year it could not contain'
  );
});

/**
 * A durable archive predating `finalGames` must not silently lose the field.
 *
 * `finalGames` is typed required but legacy archives omit it (`trends.ts:124`
 * documents exactly this, and `undefined > 0` is false rather than an error,
 * which is why nothing else caught it). Assigning `undefined` made
 * `JSON.stringify` drop the key, so the projection shipped without a field
 * `comparedFields` advertises.
 */
test('serializesAMissingLegacyFieldAsNullRatherThanDroppingIt', async () => {
  await setAppState('leagues', 'registry', [makeLeague()]);
  const legacy = makeRow('Ann', { wins: 9, losses: 1 }) as Record<string, unknown>;
  delete legacy.finalGames;
  await seedArchive([legacy as unknown as StandingsHistoryStandingRow]);

  const { body } = await requestThrough(fakeIncrementalCache([]));
  const comparison = body.comparison as unknown as Record<string, unknown>;
  const ann = (comparison.owners as Array<Record<string, unknown>>).find((o) => o.owner === 'Ann');
  const cached = ann!.cached as Record<string, unknown>;

  assert.ok(
    Object.hasOwn(cached, 'finalGames'),
    'the field survives serialization instead of vanishing'
  );
  assert.equal(cached.finalGames, null);
  assert.ok(
    (comparison.comparedFields as string[]).includes('finalGames'),
    'and it is still advertised, so the payload and the projection agree'
  );
});

/**
 * THE LEGACY-FIELD DEFECT, CLOSED IN BOTH PLACES IT OCCURS.
 *
 * Round 1 applied `?? null` in `projectSide` and not in `compareOwners`, and its
 * commit message said the defect was closed. `finalGames` is typed required
 * while durable archives omit it (`trends.ts:124`), so TypeScript cannot see
 * either site; `JSON.stringify` drops an `undefined` value, and the difference
 * entry then reports NEITHER side's value while its own shape implies the
 * missing side was absent.
 *
 * Both directions are driven here because the reviewer reproduced both, and a
 * one-directional test would have passed against the half-fix that shipped.
 */
test('serializesBothSidesOfALegacyFieldDifferenceRatherThanDroppingOne', async () => {
  await setAppState('leagues', 'registry', [makeLeague()]);
  const modern = makeRow('Ann', { wins: 9, losses: 1 });
  await seedArchive([modern]);

  const cache = fakeIncrementalCache([]);
  await warmAtFixedClock(cache);

  // DIRECTION A — the both-sides branch. Ann keeps her row but loses
  // `finalGames`, so `left.row[field] !== right.row[field]` is `10 !== undefined`
  // (`makeRow` derives `finalGames` from wins + losses) and the pushed difference
  // would drop `fresh`.
  // DIRECTION B — the one-sided branch of `compareOwners`. A legacy Bob appears
  // only on the fresh side, so every compared field is mapped for him including
  // the absent one.
  const legacyAnn = { ...modern } as Record<string, unknown>;
  delete legacyAnn.finalGames;
  const legacyBob = { ...makeRow('Bob', { wins: 4, losses: 6 }) } as Record<string, unknown>;
  delete legacyBob.finalGames;
  await seedArchive([
    legacyAnn as unknown as StandingsHistoryStandingRow,
    legacyBob as unknown as StandingsHistoryStandingRow,
  ]);
  await cache.revalidateTag(`archive:${SLUG}`);

  const { body } = await requestThrough(cache);
  const comparison = body.comparison as unknown as Record<string, unknown>;
  const byOwner = new Map(
    (comparison.differences as Array<Record<string, unknown>>).map((d) => [d.owner as string, d])
  );

  const annFinalGames = (byOwner.get('Ann')!.fields as Array<Record<string, unknown>>).find(
    (f) => f.field === 'finalGames'
  );
  assert.ok(annFinalGames, 'the both-sides branch reported the field');
  assert.ok(
    Object.hasOwn(annFinalGames, 'fresh'),
    'and BOTH keys survived serialization — `fresh` is present, not dropped'
  );
  assert.deepEqual(annFinalGames, { field: 'finalGames', cached: 10, fresh: null });

  const bob = byOwner.get('Bob')!;
  assert.equal(bob.presence, 'fresh-only', 'the one-sided branch');
  const bobFinalGames = (bob.fields as Array<Record<string, unknown>>).find(
    (f) => f.field === 'finalGames'
  );
  assert.ok(
    Object.hasOwn(bobFinalGames!, 'fresh'),
    'the one-sided branch keeps both keys too — the site round 1 did not fix'
  );
  assert.deepEqual(bobFinalGames, { field: 'finalGames', cached: null, fresh: null });
});

// ---------------------------------------------------------------------------
// Review round 3. The undefined-drop defect has now been "closed" twice and was
// closed neither time — once at 1 of 3 sites, once at 2 of 3, each claim made
// from the sites I happened to be looking at. So this round does not add a third
// `?? null` and assert completeness again; it adds a check that does not depend
// on my enumeration being right.
// ---------------------------------------------------------------------------

/**
 * THE BOUNDARY INVARIANT: every difference-shaped object in the response carries
 * BOTH of its value keys, and every owner projection carries every compared
 * field.
 *
 * `JSON.stringify` DROPS an `undefined` value, so a dropped key — not an
 * `undefined` one — is what a reader actually sees. Walking the parsed body for
 * `undefined` would therefore find nothing; the observable defect is ABSENCE.
 *
 * This asserts the shape over every entry the response contains, so it covers
 * `compareOwners`' two branches, `compareSnapshotFields`, and any comparison
 * site added later, without anyone having to enumerate them.
 */
function assertEveryComparisonEntryCarriesBothSides(body: Record<string, never>): void {
  const comparison = body.comparison as unknown as Record<string, unknown>;
  const comparedFields = comparison.comparedFields as string[];

  for (const owner of comparison.owners as Array<Record<string, unknown>>) {
    for (const side of ['cached', 'fresh'] as const) {
      const projection = owner[side] as Record<string, unknown> | null;
      if (projection === null) continue;
      for (const field of [...comparedFields, 'rank']) {
        assert.ok(
          Object.hasOwn(projection, field),
          `owners[${owner.owner as string}].${side} dropped "${field}" — an undefined value does not survive serialization`
        );
      }
    }
  }

  for (const entry of comparison.differences as Array<Record<string, unknown>>) {
    for (const diff of entry.fields as Array<Record<string, unknown>>) {
      for (const side of ['cached', 'fresh'] as const) {
        assert.ok(
          Object.hasOwn(diff, side),
          `differences[${entry.owner as string}].${diff.field as string} dropped "${side}"`
        );
      }
    }
  }

  for (const diff of comparison.snapshotDifferences as Array<Record<string, unknown>>) {
    for (const side of ['cached', 'fresh'] as const) {
      assert.ok(
        Object.hasOwn(diff, side),
        `snapshotDifferences[${diff.field as string}] dropped "${side}"`
      );
    }
  }
}

/**
 * The third site, and the one the boundary check exists for.
 *
 * `compareSnapshotFields` passes seven of its eight entries raw. A snapshot
 * PUBLISHED BEFORE a field was added to `CanonicalStandings` is still served
 * under the same key — `dataCachedCanonicalStandings` wraps a thin arrow whose
 * `cb.toString()` does not change when a field appears, the key versions only the
 * history shape, and `revalidate: false` means tag-only invalidation. The cached
 * side then yields `undefined`, `undefined !== null` pushes a difference, and the
 * response ships that difference missing its `cached` key.
 *
 * The fixture reaches into the fake cache and removes the field from the STORED
 * value, which is exactly what a pre-deploy snapshot looks like.
 */
test('doesNotDropASideWhenACachedSnapshotPredatesAField', async () => {
  await seedLive({ csv: LIVE_CSV, homeScore: 31, awayScore: 17 });
  const cache = fakeIncrementalCache([]);
  await warmAtFixedClock(cache);

  // The snapshot as it would have been published before `lifecycle` existed: the
  // key is ABSENT, not null. A field whose rebuild value is itself null would not
  // do — absent and null now compare equal, correctly, so the difference needs a
  // real value on one side to exist at all.
  // `unstable_cache` stores an envelope — `{ kind, data: { body: <json> } }` —
  // so the snapshot has to be reached through `data.body`, not at the top level.
  cache.mutateStoredValues((value) => {
    const envelope = value as { data?: { body?: string } };
    if (typeof envelope?.data?.body !== 'string') return value;
    const snapshot = JSON.parse(envelope.data.body) as Record<string, unknown>;
    if (!Object.hasOwn(snapshot, 'lifecycle')) return value;
    // `lifecycle` -> absent vs a real string: a difference, both keys present.
    // `inferredSeasonStart` -> absent vs null: NOT a difference.
    delete snapshot.lifecycle;
    delete snapshot.inferredSeasonStart;
    return { ...envelope, data: { ...envelope.data, body: JSON.stringify(snapshot) } };
  });

  const { body } = await requestThrough(cache);
  const comparison = body.comparison as unknown as Record<string, unknown>;

  const diff = (comparison.snapshotDifferences as Array<Record<string, unknown>>).find(
    (d) => d.field === 'lifecycle'
  );
  assert.ok(diff, 'the absent field really did produce a difference — the control');
  assert.ok(
    Object.hasOwn(diff, 'cached'),
    'and BOTH keys survived serialization; this is the site two previous rounds claimed closed'
  );
  assert.equal(
    diff.cached,
    null,
    'the absent cached side normalizes to null rather than vanishing'
  );
  assert.equal(typeof diff.fresh, 'string', 'and the rebuild supplies a real value on the other');

  // AND THE OTHER HALF OF THE NORMALIZATION CLAIM: absent on one side against
  // NULL on the other is NOT a difference, because they mean the same thing.
  // `inferredSeasonStart` is null on this path, so a snapshot predating it must
  // produce no entry at all — normalizing AFTER the filter instead would report
  // a shape artefact as a divergence, in the list whose emptiness is the signal.
  assert.equal(
    (comparison.snapshotDifferences as Array<Record<string, unknown>>).some(
      (d) => d.field === 'inferredSeasonStart'
    ),
    false,
    'absent-vs-null is not reported as a difference'
  );

  assertEveryComparisonEntryCarriesBothSides(body);
});

/**
 * The boundary invariant, run over the fixtures that exercise the other two
 * sites — so one assertion covers all three and any site added later.
 */
test('everyComparisonEntryCarriesBothSidesAcrossEveryShape', async () => {
  // Legacy rows on both sides and one-sided, the round-2 fixture.
  await setAppState('leagues', 'registry', [makeLeague()]);
  const modern = makeRow('Ann', { wins: 9, losses: 1 });
  await seedArchive([modern]);
  const cache = fakeIncrementalCache([]);
  await warmAtFixedClock(cache);
  const legacyAnn = { ...modern } as Record<string, unknown>;
  delete legacyAnn.finalGames;
  const legacyBob = { ...makeRow('Bob', { wins: 4, losses: 6 }) } as Record<string, unknown>;
  delete legacyBob.finalGames;
  await seedArchive([
    legacyAnn as unknown as StandingsHistoryStandingRow,
    legacyBob as unknown as StandingsHistoryStandingRow,
  ]);
  await cache.revalidateTag(`archive:${SLUG}`);
  const archiveShaped = await requestThrough(cache);
  assert.ok(
    (archiveShaped.body.comparison as unknown as Record<string, unknown>).differences,
    'the archive fixture produced a comparison'
  );
  assertEveryComparisonEntryCarriesBothSides(archiveShaped.body);

  // A live-path miss, where every projection is fully populated.
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  await seedLive({ csv: LIVE_CSV, homeScore: 31, awayScore: 17 });
  const live = await requestThrough(fakeIncrementalCache([]));
  assertEveryComparisonEntryCarriesBothSides(live.body);
});

/**
 * The EQUIVALENCE the year-pinning rests on — and this test proves only that.
 *
 * WHAT IT DOES NOT PROVE, stated because a mutation showed it: reverting the
 * route to `year: yearOverride` on either read leaves this green. The two forms
 * resolve to the same year in every reachable branch, which is precisely the
 * safety argument for pinning, and it also means the pinning itself has no
 * observable effect in-suite. Its benefit appears only when a lifecycle
 * transition, rollover or archive write lands BETWEEN the route's resolution and
 * the reads — an interleaving no test here can stage.
 *
 * So: the change removes a real TOCTOU, its benefit is unobservable, and this
 * test pins the equivalence that makes it safe rather than the pinning itself.
 * `leagueStandings.ts` warns that a default-year and an explicit-year request
 * can produce different snapshots on the offseason path; if that ever became
 * true the pinning would be unsafe, and this is what would catch it.
 */
test('aDefaultYearRequestAndAnExplicitResolvedYearRequestShareOneKey', async () => {
  // Offseason with archives is the branch the selector's warning is about.
  await setAppState('leagues', 'registry', [{ ...makeLeague(), status: { state: 'offseason' } }]);
  await seedArchive([makeRow('Ann', { wins: 9, losses: 1 })]);

  const resolved = await resolveStandingsYear(SLUG, null);
  assert.equal(resolved, YEAR, 'the resolver picks the archived year');

  const defaultKey = canonicalStandingsCacheKeyParts(SLUG, resolved).join(',');
  const explicitKey = canonicalStandingsCacheKeyParts(
    SLUG,
    await resolveStandingsYear(SLUG, resolved)
  ).join(',');
  assert.equal(explicitKey, defaultKey, 'both resolutions produce one cache identity');

  // And the route reports the year it actually compared.
  const { body } = await requestThrough(fakeIncrementalCache([]));
  assert.equal((body.year as unknown as Record<string, unknown>).resolved, YEAR);
  assert.ok(
    String((body.cacheRead as unknown as Record<string, unknown>).standingsKeySignature).includes(
      `,${YEAR},`
    ),
    'and the signature names that same year'
  );
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
    assert.match(
      (body as unknown as { error: string }).error,
      /year must be an integer between .* or a season this league has archived/
    );
    // THE DISJUNCT HAS A COST AND THIS IS IT. Rejecting an out-of-range year now
    // consults `listSeasonArchives` (#818 parity), which can publish its own
    // entry. That entry is keyed on the SLUG ALONE — `season-archive-years,<slug>`
    // — so every bogus year for a league shares one, and the property the bound
    // exists to protect still holds: a distinct `?year=` cannot mint an
    // unbounded keyspace. What must never appear is a per-year
    // `canonical-standings` entry or a full-season build.
    assert.equal(
      events.some((e) => e.includes('canonical-standings')),
      false,
      `year=${raw} must mint no per-year standings entry and run no build`
    );
    assert.equal(
      events.filter((e) => e.startsWith('set:')).every((e) => e.includes('season-archive-years')),
      true,
      `year=${raw} may only touch the per-league archive-years entry`
    );
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
    ['no incremental cache (cannot-tell)', () => GET(authedRequest())],
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
 * the route's `comparedFields` is checkable rather than asserted, and
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

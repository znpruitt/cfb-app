import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateKeyLockFailureForTests,
  __setAppStateWriteFailureForTests,
  getAppState,
} from '../../server/appStateStore.ts';
import {
  __deleteDurableOddsStoreFileForTests,
  __resetDurableOddsStoreForTests,
  getDurableOddsStore,
  setDurableOddsStore,
} from '../../server/durableOddsStore.ts';
import {
  __resetOddsRouteCacheForTests,
  oddsCache,
  type NormalizedOddsEvent,
  type SharedOddsCacheEntry,
} from '../../../app/api/odds/routeInternals.ts';
import { getScopedAliasMap } from '../../server/globalAliasStore.ts';
import { buildScheduleFromApi, type AppGame } from '../../schedule.ts';
import {
  applyPregameOddsSnapshot,
  emptyDurableOddsRecord,
  type DurableOddsSnapshot,
} from '../../odds.ts';
import { createTeamIdentityResolver, type TeamIdentityResolver } from '../../teamIdentity.ts';
import {
  commitCanonicalOddsRefresh,
  commitFilteredOddsRefresh,
  maintainCanonicalClosingLines,
} from '../oddsCommit.ts';

const SEASON = 2026;
const KEY = '2026:bookmakers=x|markets=h2h|regions=us';
const NOW_ISO = '2026-09-01T00:00:00.000Z';
const KICKOFF = '2026-09-05T19:30:00.000Z';
const T1 = '2026-09-01T00:00:00.000Z';
const T2 = '2026-09-01T06:00:00.000Z';

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  await __deleteDurableOddsStoreFileForTests(SEASON);
  __resetDurableOddsStoreForTests();
  __resetOddsRouteCacheForTests();
  __setAppStateWriteFailureForTests(null);
  __setAppStateKeyLockFailureForTests(null);
});

async function buildGamesAndResolver(
  oddsEvents: NormalizedOddsEvent[]
): Promise<{ games: AppGame[]; resolver: TeamIdentityResolver }> {
  const teamsRaw = await fs.readFile(path.join(process.cwd(), 'src/data/teams.json'), 'utf8');
  const teams = (JSON.parse(teamsRaw) as { items?: unknown[] }).items ?? [];
  const aliasMap = await getScopedAliasMap('', SEASON);
  const scheduleItems = [
    {
      id: 'g1',
      week: 1,
      startDate: KICKOFF,
      neutralSite: false,
      conferenceGame: false,
      homeTeam: 'Georgia',
      awayTeam: 'Clemson',
      homeConference: 'SEC',
      awayConference: 'ACC',
      status: 'scheduled',
      seasonType: 'regular',
      gamePhase: 'regular',
    },
  ];
  const games = buildScheduleFromApi({
    scheduleItems,
    teams: teams as never,
    aliasMap,
    season: SEASON,
  }).games;
  const observedNames = Array.from(
    new Set(
      [
        ...games.flatMap((g) => [g.canHome, g.canAway]),
        ...oddsEvents.flatMap((e) => [e.homeTeam, e.awayTeam]),
      ].filter(Boolean)
    )
  );
  const resolver = createTeamIdentityResolver({ aliasMap, teams: teams as never, observedNames });
  return { games, resolver };
}

function oddsEvent(homeSpread: number): NormalizedOddsEvent {
  return {
    homeTeam: 'Georgia Bulldogs',
    awayTeam: 'Clemson Tigers',
    commenceTime: KICKOFF,
    bookmakers: [
      {
        key: 'draftkings',
        title: 'DraftKings',
        markets: [
          {
            key: 'spreads',
            outcomes: [
              { name: 'Georgia', point: homeSpread, price: -110 },
              { name: 'Clemson', point: -homeSpread, price: -110 },
            ],
          },
        ],
      },
    ],
  };
}

function rawEntry(observedAt: string, events: NormalizedOddsEvent[]): SharedOddsCacheEntry {
  return { data: events, lastFetch: Date.parse(observedAt), usage: null, observedAt };
}

// --- Per-game snapshot observation ordering (writer convergence #1/#2/#3) ---

test('merge: applyPregameOddsSnapshot rejects an older-or-equal capturedAt, accepts a newer one', () => {
  const base = emptyDurableOddsRecord('g1');
  const snap = (capturedAt: string, homeSpread: number): DurableOddsSnapshot => ({
    capturedAt,
    bookmakerKey: 'draftkings',
    favorite: 'Georgia',
    source: 'DraftKings',
    spread: homeSpread,
    homeSpread,
    awaySpread: -homeSpread,
    spreadPriceHome: -110,
    spreadPriceAway: -110,
    moneylineHome: null,
    moneylineAway: null,
    total: null,
    overPrice: null,
    underPrice: null,
  });
  const first = applyPregameOddsSnapshot({
    record: base,
    snapshot: snap(T2, -3.5),
    kickoff: KICKOFF,
    now: NOW_ISO,
  });
  assert.equal(first.latestSnapshot?.homeSpread, -3.5);
  // Older loses.
  const older = applyPregameOddsSnapshot({
    record: first,
    snapshot: snap(T1, -7),
    kickoff: KICKOFF,
    now: NOW_ISO,
  });
  assert.equal(older.latestSnapshot?.homeSpread, -3.5);
  // Equal loses (ties preserve existing).
  const equal = applyPregameOddsSnapshot({
    record: first,
    snapshot: snap(T2, -7),
    kickoff: KICKOFF,
    now: NOW_ISO,
  });
  assert.equal(equal.latestSnapshot?.homeSpread, -3.5);
  // Newer wins.
  const newer = applyPregameOddsSnapshot({
    record: first,
    snapshot: snap('2026-09-01T12:00:00.000Z', -7),
    kickoff: KICKOFF,
    now: NOW_ISO,
  });
  assert.equal(newer.latestSnapshot?.homeSpread, -7);
});

test('convergence #1: a stale observation resuming late is a no-op — newer raw and per-game survive', async () => {
  const { games, resolver } = await buildGamesAndResolver([oddsEvent(-3.5)]);
  // Newer observation (T2) commits first.
  const first = await commitCanonicalOddsRefresh({
    season: SEASON,
    seasonScopedKey: KEY,
    rawEntry: rawEntry(T2, [oddsEvent(-3.5)]),
    games,
    oddsEvents: [oddsEvent(-3.5)],
    resolver,
    observationAt: T2,
    now: NOW_ISO,
  });
  assert.equal(first.kind, 'committed');
  const gameKey = games[0]!.key;
  let store = await getDurableOddsStore(SEASON);
  assert.equal(store[gameKey]?.latestSnapshot?.homeSpread, -3.5);

  // Older observation (T1) resumes and commits second → stale-observation no-op.
  const stale = await commitCanonicalOddsRefresh({
    season: SEASON,
    seasonScopedKey: KEY,
    rawEntry: rawEntry(T1, [oddsEvent(-7)]),
    games,
    oddsEvents: [oddsEvent(-7)],
    resolver,
    observationAt: T1,
    now: NOW_ISO,
  });
  assert.equal(stale.kind, 'stale-observation');
  // Newer per-game line survives.
  store = await getDurableOddsStore(SEASON);
  assert.equal(store[gameKey]?.latestSnapshot?.homeSpread, -3.5);
  // Newer raw survives, both durably and in the process cache (no stale publication).
  const durableRaw = await getAppState<SharedOddsCacheEntry>('odds-cache', KEY);
  assert.equal(durableRaw?.value.observedAt, T2);
  assert.equal(oddsCache.entries[KEY]?.observedAt, T2);
});

test('convergence #2: an older commit first, newer resumes → newer wins', async () => {
  const { games, resolver } = await buildGamesAndResolver([oddsEvent(-3.5)]);
  await commitCanonicalOddsRefresh({
    season: SEASON,
    seasonScopedKey: KEY,
    rawEntry: rawEntry(T1, [oddsEvent(-7)]),
    games,
    oddsEvents: [oddsEvent(-7)],
    resolver,
    observationAt: T1,
    now: NOW_ISO,
  });
  const newer = await commitCanonicalOddsRefresh({
    season: SEASON,
    seasonScopedKey: KEY,
    rawEntry: rawEntry(T2, [oddsEvent(-3.5)]),
    games,
    oddsEvents: [oddsEvent(-3.5)],
    resolver,
    observationAt: T2,
    now: NOW_ISO,
  });
  assert.equal(newer.kind, 'committed');
  const store = await getDurableOddsStore(SEASON);
  assert.equal(store[games[0]!.key]?.latestSnapshot?.homeSpread, -3.5);
});

test('convergence #4: a canonical transaction failure changes neither durable key', async () => {
  const { games, resolver } = await buildGamesAndResolver([oddsEvent(-3.5)]);
  await commitCanonicalOddsRefresh({
    season: SEASON,
    seasonScopedKey: KEY,
    rawEntry: rawEntry(T2, [oddsEvent(-3.5)]),
    games,
    oddsEvents: [oddsEvent(-3.5)],
    resolver,
    observationAt: T2,
    now: NOW_ISO,
  });

  __setAppStateKeyLockFailureForTests(new Error('durable store down'), 'durable-odds:2026');
  const result = await commitCanonicalOddsRefresh({
    season: SEASON,
    seasonScopedKey: KEY,
    rawEntry: rawEntry('2026-09-02T00:00:00.000Z', [oddsEvent(-10)]),
    games,
    oddsEvents: [oddsEvent(-10)],
    resolver,
    observationAt: '2026-09-02T00:00:00.000Z',
    now: NOW_ISO,
  });
  __setAppStateKeyLockFailureForTests(null);
  assert.equal(result.kind, 'store-unavailable');
  // Prior-good is intact on both keys.
  const durableRaw = await getAppState<SharedOddsCacheEntry>('odds-cache', KEY);
  assert.equal(durableRaw?.value.observedAt, T2);
  const store = await getDurableOddsStore(SEASON);
  assert.equal(store[games[0]!.key]?.latestSnapshot?.homeSpread, -3.5);
});

test('convergence #5: a secondary (raw) write failure rolls back the primary (store) write', async () => {
  const { games, resolver } = await buildGamesAndResolver([oddsEvent(-3.5)]);
  // Seed a prior good state.
  await commitCanonicalOddsRefresh({
    season: SEASON,
    seasonScopedKey: KEY,
    rawEntry: rawEntry(T1, [oddsEvent(-3.5)]),
    games,
    oddsEvents: [oddsEvent(-3.5)],
    resolver,
    observationAt: T1,
    now: NOW_ISO,
  });
  // Fail the odds-cache (secondary) write; the whole transaction must roll back.
  __setAppStateWriteFailureForTests(new Error('raw write failed'), 'odds-cache');
  await assert.rejects(
    commitCanonicalOddsRefresh({
      season: SEASON,
      seasonScopedKey: KEY,
      rawEntry: rawEntry(T2, [oddsEvent(-10)]),
      games,
      oddsEvents: [oddsEvent(-10)],
      resolver,
      observationAt: T2,
      now: NOW_ISO,
    })
  );
  __setAppStateWriteFailureForTests(null);
  // Both keys remain at the prior-good T1 state.
  const durableRaw = await getAppState<SharedOddsCacheEntry>('odds-cache', KEY);
  assert.equal(durableRaw?.value.observedAt, T1);
  const store = await getDurableOddsStore(SEASON);
  assert.equal(store[games[0]!.key]?.latestSnapshot?.homeSpread, -3.5);
});

test('convergence #6: a filtered commit writes only its raw key, never the durable store', async () => {
  const result = await commitFilteredOddsRefresh({
    seasonScopedKey: KEY,
    rawEntry: rawEntry(T2, [oddsEvent(-3.5)]),
  });
  assert.equal(result.kind, 'committed');
  // Commit ordering is captured for same-millisecond success tie-breaking (F6).
  if (result.kind === 'committed') {
    assert.equal(typeof result.committedAt, 'string');
    assert.equal(typeof result.commitSeq, 'number');
  }
  const durableRaw = await getAppState<SharedOddsCacheEntry>('odds-cache', KEY);
  assert.equal(durableRaw?.value.observedAt, T2);
  // The canonical durable per-game store was never seeded.
  const store = await getAppState<Record<string, unknown>>('durable-odds:2026', 'store');
  assert.equal(store, null);
});

test('convergence F6b: a filtered stale-observation never rewrites the raw key', async () => {
  await commitFilteredOddsRefresh({
    seasonScopedKey: KEY,
    rawEntry: rawEntry(T2, [oddsEvent(-3.5)]),
  });
  const stale = await commitFilteredOddsRefresh({
    seasonScopedKey: KEY,
    rawEntry: rawEntry(T1, [oddsEvent(-7)]),
  });
  assert.equal(stale.kind, 'stale-observation');
  const durableRaw = await getAppState<SharedOddsCacheEntry>('odds-cache', KEY);
  assert.equal(durableRaw?.value.observedAt, T2);
});

test('convergence #8: public maintenance with no change performs no durable write', async () => {
  const { games, resolver } = await buildGamesAndResolver([]);
  // Seed a durable record, then re-run maintenance with identical inputs.
  await setDurableOddsStore(SEASON, {
    [games[0]!.key]: {
      ...emptyDurableOddsRecord(games[0]!.key),
      latestSnapshot: {
        capturedAt: T1,
        bookmakerKey: 'draftkings',
        favorite: 'Georgia',
        source: 'DraftKings',
        spread: -3.5,
        homeSpread: -3.5,
        awaySpread: 3.5,
        spreadPriceHome: -110,
        spreadPriceAway: -110,
        moneylineHome: null,
        moneylineAway: null,
        total: null,
        overPrice: null,
        underPrice: null,
      },
    },
  });
  const before = await getAppState<unknown>('durable-odds:2026', 'store');
  const result = await maintainCanonicalClosingLines({
    season: SEASON,
    games,
    oddsEvents: [],
    resolver,
    observationAt: T1,
    now: NOW_ISO,
  });
  assert.equal(result.kind === 'maintained' && result.wroteStore, false);
  const after = await getAppState<unknown>('durable-odds:2026', 'store');
  // No write ⇒ the durable record's updatedAt is unchanged.
  assert.equal(
    (before as { updatedAt?: string } | null)?.updatedAt,
    (after as { updatedAt?: string } | null)?.updatedAt
  );
});

test('convergence #9: closing freeze at kickoff is applied under the maintenance lock', async () => {
  const { games, resolver } = await buildGamesAndResolver([]);
  const gameKey = games[0]!.key;
  await setDurableOddsStore(SEASON, {
    [gameKey]: {
      ...emptyDurableOddsRecord(gameKey),
      latestSnapshot: {
        capturedAt: '2026-09-05T18:00:00.000Z',
        bookmakerKey: 'draftkings',
        favorite: 'Georgia',
        source: 'DraftKings',
        spread: -3.5,
        homeSpread: -3.5,
        awaySpread: 3.5,
        spreadPriceHome: -110,
        spreadPriceAway: -110,
        moneylineHome: null,
        moneylineAway: null,
        total: null,
        overPrice: null,
        underPrice: null,
      },
    },
  });
  // Run maintenance with `now` AT/after kickoff → the latest becomes the frozen closing.
  const result = await maintainCanonicalClosingLines({
    season: SEASON,
    games,
    oddsEvents: [],
    resolver,
    observationAt: '2026-09-05T18:00:00.000Z',
    now: '2026-09-05T20:00:00.000Z',
  });
  assert.equal(result.kind === 'maintained' && result.wroteStore, true);
  const store = await getDurableOddsStore(SEASON);
  assert.ok(store[gameKey]?.closingSnapshot);
  assert.equal(store[gameKey]?.closingSnapshot?.homeSpread, -3.5);
});

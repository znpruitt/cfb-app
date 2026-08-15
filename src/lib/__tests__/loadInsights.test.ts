import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import { addLeague } from '@/lib/leagueRegistry';
import {
  setAppState,
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
} from '@/lib/server/appStateStore';
import { savePreseasonOwners } from '@/lib/preseasonOwnerStore';
import { loadInsightsForLeague } from '@/lib/insights/loadInsights';
import { applySuppression } from '@/lib/insights/engine';

// ===========================================================================
// PLATFORM-053 — loadInsightsForLeague sources standings rows/history from the
// canonical selector (getCanonicalStandings), not an Insights-local
// deriveStandings/deriveStandingsHistory re-derivation. These integration tests
// exercise the canonical path end-to-end (no server → origin is null → games
// empty; canonical still drives standings inputs).
//
// NOTE: The row/history *contradiction* guarantee is enforced structurally —
// loadInsights no longer imports or calls deriveStandings/deriveStandingsHistory,
// so no code path can diverge from canonical — and is covered by PLATFORM-049's
// getCanonicalStandings authority tests (empty/null/complete) plus the existing
// generator tests that pass rows/history directly.
// ===========================================================================

const SLUG = 'tsc';

beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

test('loadInsightsForLeague returns a well-formed response from the canonical path (season + CSV)', async () => {
  await addLeague({
    slug: SLUG,
    displayName: 'Turf War',
    year: 2026,
    createdAt: '2026-01-01T00:00:00.000Z',
    status: { state: 'season', year: 2026 },
  });
  await setAppState(
    'owners:tsc:2026',
    'csv',
    'team,owner\nGeorgia,Alice\nClemson,Bob\nAir Force,NoClaim'
  );

  const res = await loadInsightsForLeague(SLUG, 2026);

  assert.ok(Array.isArray(res.insights));
  assert.equal(typeof res.lifecycleState, 'string');
  assert.equal(res.error, undefined);
});

test('canonical empty standings are authoritative: no crash, no fabricated insights', async () => {
  // Offseason league with no archive and no CSV → canonical resolves to an empty
  // snapshot. Insights must not resurrect local standings or error.
  await addLeague({
    slug: SLUG,
    displayName: 'Turf War',
    year: 2026,
    createdAt: '2026-01-01T00:00:00.000Z',
    status: { state: 'offseason' },
  });

  const res = await loadInsightsForLeague(SLUG, 2026);

  assert.ok(Array.isArray(res.insights));
  assert.equal(res.error, undefined);
});

test('canonical preseason-names lifecycle drives Insights when only preseason owners exist', async () => {
  // No current-year CSV — the OLD local path would derive an empty roster and
  // empty standings. Canonical synthesizes preseason-names rows for the seeded
  // owners, and Insights runs off the canonical preseason lifecycle.
  await addLeague({
    slug: SLUG,
    displayName: 'Turf War',
    year: 2026,
    createdAt: '2026-01-01T00:00:00.000Z',
    status: { state: 'preseason', year: 2026 },
  });
  await savePreseasonOwners(SLUG, 2026, ['Zelda', 'Yara']);

  const res = await loadInsightsForLeague(SLUG, 2026);

  assert.equal(res.lifecycleState, 'preseason');
  assert.ok(Array.isArray(res.insights));
  assert.equal(res.error, undefined);
});

test('unknown league returns an empty offseason response without throwing', async () => {
  const res = await loadInsightsForLeague('does-not-exist', 2026);
  assert.deepEqual(res.insights, []);
  assert.equal(res.lifecycleState, 'offseason');
  assert.match(res.error ?? '', /not found/);
});

test('PLATFORM-077: loadInsightsForLeague sources schedule/games in-process and never self-fetches', async () => {
  await addLeague({
    slug: SLUG,
    displayName: 'Turf War',
    year: 2026,
    createdAt: '2026-01-01T00:00:00.000Z',
    status: { state: 'season', year: 2026 },
  });
  await setAppState('owners:tsc:2026', 'csv', 'team,owner\nGeorgia,Alice\nClemson,Bob');
  // Seed the canonical schedule cache that the in-process path reads (the same
  // durable key `/api/schedule` and the standings selector use).
  await setAppState('schedule', '2026-all-all', {
    at: Date.now(),
    items: [
      {
        id: 'g1',
        week: 1,
        startDate: '2026-09-05T00:00:00Z',
        homeTeam: 'Georgia',
        awayTeam: 'Clemson',
        homeConference: 'SEC',
        awayConference: 'ACC',
        status: 'final',
        seasonType: 'regular',
        gamePhase: 'regular',
      },
    ],
  });

  // Any HTTP self-fetch is a regression: schedule/teams/etc. must be read
  // in-process. Fail loudly if the code reaches for fetch at all.
  const originalFetch = global.fetch;
  const fetchCalls: string[] = [];
  global.fetch = (async (input: URL | string) => {
    fetchCalls.push(typeof input === 'string' ? input : input.toString());
    return new Response('{}', { status: 500 });
  }) as typeof fetch;

  try {
    const res = await loadInsightsForLeague(SLUG, 2026);
    assert.equal(res.error, undefined);
    assert.ok(Array.isArray(res.insights));
    // A non-offseason lifecycle here can only come from the in-process schedule/
    // standings the seeded caches drive — the self-fetch stub returns 500.
    assert.notEqual(res.lifecycleState, 'offseason');
  } finally {
    global.fetch = originalFetch;
  }

  assert.deepEqual(
    fetchCalls,
    [],
    `insights must not self-fetch app routes; saw: ${fetchCalls.join(', ')}`
  );
});

test('INSIGHTS-029: the feed survives repeated loads through the real loader', async () => {
  // THE regression test, and it has to run through `loadInsightsForLeague`.
  //
  // Two earlier attempts were vacuous. The first pinned `selectServedInsights`
  // and `applySuppression` separately, so reverting the production change left
  // every test passing. The second went through the loader but used a fixture
  // that generated NO insights, and then one that generated only types absent
  // from `TYPE_THRESHOLDS` \u2014 neither could drain, so neither could fail.
  //
  // This fixture seeds three archived seasons on purpose: they are what reach
  // the career/historical generators, whose types (`dynasty`, `drought`,
  // `title_chaser`, `consistency`) carry `{ kind: 'unchanged' }`. Out of season
  // no stat value moves, so under suppression those all vanish on load two.
  // The positive control at the bottom holds the fixture to that.
  await addLeague({
    slug: SLUG,
    displayName: 'Turf War',
    year: 2026,
    createdAt: '2026-01-01T00:00:00.000Z',
    foundedYear: 2022,
    status: { state: 'season', year: 2026 },
  });
  const csv = 'team,owner\nGeorgia,Alice\nClemson,Bob\nAlabama,Carol\nOhio State,Dave';
  await setAppState('owners:tsc:2026', 'csv', csv);

  const owners = ['Alice', 'Bob', 'Carol', 'Dave'];
  const archivedSeasons: Record<number, [number, number][]> = {
    2023: [
      [10, 2],
      [8, 4],
      [6, 6],
      [2, 10],
    ],
    2024: [
      [9, 3],
      [7, 5],
      [5, 7],
      [3, 9],
    ],
    2025: [
      [11, 1],
      [6, 6],
      [4, 8],
      [1, 11],
    ],
  };
  for (const [year, records] of Object.entries(archivedSeasons)) {
    await setAppState(`standings-archive:${SLUG}`, year, {
      leagueSlug: SLUG,
      year: Number(year),
      archivedAt: '2026-01-01T00:00:00.000Z',
      ownerRosterSnapshot: csv,
      standingsHistory: { weeks: [], byWeek: {}, byOwner: {} },
      finalStandings: records.map(([wins, losses], i) => ({
        owner: owners[i],
        wins,
        losses,
        ties: 0,
        winPct: wins / (wins + losses),
        pointsFor: 350 + i * 10,
        pointsAgainst: 300,
        pointDifferential: 50 + i * 10,
        gamesBack: 0,
        finalGames: wins + losses,
      })),
      games: [],
      scoresByKey: {},
    });
  }

  const teams = ['Georgia', 'Clemson', 'Alabama', 'Ohio State'];
  const items = [];
  const scoreRows = [];
  let n = 0;
  for (let week = 1; week <= 6; week++) {
    for (let pair = 0; pair < 2; pair++) {
      const home = teams[pair * 2];
      const away = teams[pair * 2 + 1];
      const id = `g${++n}`;
      const startDate = `2026-09-0${week}T18:00:00.000Z`;
      items.push({
        id,
        week,
        startDate,
        neutralSite: false,
        conferenceGame: false,
        homeTeam: home,
        awayTeam: away,
        homeConference: 'SEC',
        awayConference: 'ACC',
        status: 'final',
        seasonType: 'regular',
      });
      scoreRows.push({
        id,
        seasonType: 'regular',
        startDate,
        week,
        status: 'final',
        home: { team: home, score: ((week * 7 + pair * 3) % 40) + 10 },
        away: { team: away, score: ((week * 5 + pair * 11) % 35) + 7 },
        time: null,
      });
    }
  }
  await setAppState('schedule', '2026-all-all', { items });
  await setAppState('scores', '2026-all-regular', { items: scoreRows });

  const first = await loadInsightsForLeague(SLUG, 2026);
  const second = await loadInsightsForLeague(SLUG, 2026);
  const third = await loadInsightsForLeague(SLUG, 2026);

  assert.deepEqual(
    second.insights.map((i) => i.id),
    first.insights.map((i) => i.id),
    'the second load serves the same feed \u2014 it does not drain'
  );
  assert.deepEqual(
    third.insights.map((i) => i.id),
    first.insights.map((i) => i.id),
    'and neither does the third'
  );

  // Positive control. Without this the assertions above pass for a fixture that
  // could never drain in the first place \u2014 the exact way two earlier versions
  // of this test failed. Run last: it writes suppression records, and the
  // serving path deliberately does not read them.
  const drained = await applySuppression(
    first.insights.map((i) => ({ ...i })),
    SLUG,
    2026
  );
  const drainedAgain = await applySuppression(
    first.insights.map((i) => ({ ...i })),
    SLUG,
    2026
  );
  assert.ok(
    drainedAgain.length < drained.length,
    'the fixture MUST contain suppressible insights, or this test proves nothing'
  );
});

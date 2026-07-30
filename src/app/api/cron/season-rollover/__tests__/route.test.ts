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
  getAppState,
  setAppState,
} from '../../../../../lib/server/appStateStore.ts';
import {
  __resetTeamDatabaseStoreForTests,
  setTeamDatabaseFile,
} from '../../../../../lib/server/teamDatabaseStore.ts';

// ---------------------------------------------------------------------------
// PLATFORM-071 — cron season-rollover must invalidate standings for each
// league it rolls from season → offseason (live standings → prior-season final
// from the freshly written archive). Previously it wrote the archive + status
// but left warm standings snapshots stale (documented gap).
// ---------------------------------------------------------------------------

const CRON_SECRET = 'test-cron-secret';
const YEAR = 2023;
const MUTABLE_ENV = process.env as Record<string, string | undefined>;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;

function makeLeague(slug: string, status: League['status']): League {
  return {
    slug,
    displayName: `League ${slug}`,
    year: YEAR,
    createdAt: '2022-01-01T00:00:00.000Z',
    status,
  };
}

// Seed a schedule cache containing a STRUCTURED CFP national-championship game
// plus a complete final score (PLATFORM-086E1A). `champDate` controls the rollover
// time gate: rollover fires only at championship + 7 days AND only off a
// structured (`cfbd-structured`), confirmed-final championship. `options.final`
// (default true) toggles the score's finality so a test can assert a
// not-yet-final championship does NOT roll.
async function seedScheduleWithChampionship(
  champDate: string,
  options: { final?: boolean } = {}
): Promise<void> {
  const final = options.final ?? true;
  await setTeamDatabaseFile({
    source: 'cfbd',
    updatedAt: '2023-01-01T00:00:00.000Z',
    items: [
      { school: 'Alpha U', conference: 'SEC' },
      { school: 'Beta U', conference: 'Big Ten' },
    ],
  });
  await setAppState('schedule', `${YEAR}-all-all`, {
    items: [
      {
        id: '401752',
        week: 15,
        startDate: champDate,
        neutralSite: true,
        conferenceGame: false,
        homeTeam: 'Alpha U',
        awayTeam: 'Beta U',
        homeConference: 'SEC',
        awayConference: 'Big Ten',
        status: 'final',
        seasonType: 'postseason',
        gamePhase: 'postseason',
        postseasonSubtype: 'playoff',
        playoffRound: 'national_championship',
        playoffCompetition: 'College Football Playoff',
        playoffRoundSource: 'cfbd-structured',
      },
    ],
  });
  // Rollover finality is derived from the SCORE cache via the centralized status
  // classifier — never from the schedule row's status. Attach a score to the
  // championship game by its exact CFBD provider game id.
  await setAppState('scores', `${YEAR}-all-postseason`, {
    at: Date.parse('2023-01-10T00:00:00.000Z'),
    source: 'cfbd',
    cfbdFallbackReason: 'none',
    items: [
      {
        id: '401752',
        seasonType: 'postseason',
        startDate: champDate,
        week: 15,
        status: final ? 'final' : 'in progress',
        home: { team: 'Alpha U', score: final ? 34 : 14 },
        away: { team: 'Beta U', score: final ? 21 : 10 },
        time: null,
      },
    ],
  });
}

function cronRequest(secret: string | null = CRON_SECRET): Request {
  const headers: Record<string, string> = {};
  if (secret) headers['authorization'] = `Bearer ${secret}`;
  return new Request('https://example.com/api/cron/season-rollover', { headers });
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
  __resetTeamDatabaseStoreForTests();
  MUTABLE_ENV.NODE_ENV = 'development';
  MUTABLE_ENV.CRON_SECRET = CRON_SECRET;
});

test.after(() => {
  MUTABLE_ENV.NODE_ENV = ORIGINAL_NODE_ENV;
  if (ORIGINAL_CRON_SECRET === undefined) delete MUTABLE_ENV.CRON_SECRET;
  else MUTABLE_ENV.CRON_SECRET = ORIGINAL_CRON_SECRET;
});

test('a completed rollover invalidates standings for each rolled-over league', async () => {
  await setAppState('leagues', 'registry', [makeLeague('alpha', { state: 'season', year: YEAR })]);
  // Championship well in the past → championship + 7 days is reached.
  await seedScheduleWithChampionship('2023-01-09T00:00:00.000Z');

  const { result: res, tags } = await runCapturingTags(() => GET(cronRequest()));
  const body = (await res.json()) as { leaguesRolledOver?: string[]; success?: boolean };
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.deepEqual(body.leaguesRolledOver, ['alpha'], 'alpha rolled over');
  assert.ok(tags.includes('standings:alpha'), 'rolled-over league standings invalidated');

  // The rollover actually happened (status is now offseason).
  const leagues = await getAppState<League[]>('leagues', 'registry');
  assert.equal(leagues?.value?.[0]?.status?.state, 'offseason');
});

test('an unauthorized request invalidates nothing', async () => {
  await setAppState('leagues', 'registry', [makeLeague('alpha', { state: 'season', year: YEAR })]);
  await seedScheduleWithChampionship('2023-01-09T00:00:00.000Z');

  const { result: res, tags } = await runCapturingTags(() => GET(cronRequest('wrong-secret')));
  assert.equal(res.status, 401);
  assert.deepEqual(
    tags.filter((t) => t.startsWith('standings:')),
    []
  );
});

test('no leagues in season state → skipped, invalidates nothing', async () => {
  await setAppState('leagues', 'registry', [makeLeague('alpha', { state: 'offseason' })]);

  const { result: res, tags } = await runCapturingTags(() => GET(cronRequest()));
  const body = (await res.json()) as { skipped?: boolean };
  assert.equal(res.status, 200);
  assert.equal(body.skipped, true);
  assert.deepEqual(
    tags.filter((t) => t.startsWith('standings:')),
    []
  );
});

test('championship + 7 days not reached → skipped, invalidates nothing', async () => {
  await setAppState('leagues', 'registry', [makeLeague('alpha', { state: 'season', year: YEAR })]);
  // Championship far in the future → time gate not reached.
  await seedScheduleWithChampionship('2999-01-09T00:00:00.000Z');

  const { result: res, tags } = await runCapturingTags(() => GET(cronRequest()));
  const body = (await res.json()) as { skipped?: boolean };
  assert.equal(res.status, 200);
  assert.equal(body.skipped, true);
  assert.deepEqual(
    tags.filter((t) => t.startsWith('standings:')),
    []
  );
});

// ---------------------------------------------------------------------------
// PLATFORM-086E1A — leagues are grouped by year and each year is evaluated
// independently: a not-yet-final year must not roll just because another year is.
// ---------------------------------------------------------------------------

function makeLeagueForYear(slug: string, year: number): League {
  return {
    slug,
    displayName: `League ${slug}`,
    year,
    createdAt: '2022-01-01T00:00:00.000Z',
    status: { state: 'season', year },
  };
}

async function seedYearChampionship(
  year: number,
  champDate: string,
  final: boolean
): Promise<void> {
  await setAppState('schedule', `${year}-all-all`, {
    items: [
      {
        id: `${year}0101`,
        week: 15,
        startDate: champDate,
        neutralSite: true,
        conferenceGame: false,
        homeTeam: 'Alpha U',
        awayTeam: 'Beta U',
        homeConference: 'SEC',
        awayConference: 'Big Ten',
        status: 'final',
        seasonType: 'postseason',
        gamePhase: 'postseason',
        postseasonSubtype: 'playoff',
        playoffRound: 'national_championship',
        playoffCompetition: 'College Football Playoff',
        playoffRoundSource: 'cfbd-structured',
      },
    ],
  });
  await setAppState('scores', `${year}-all-postseason`, {
    at: Date.parse(champDate) + 24 * 60 * 60 * 1000,
    source: 'cfbd',
    cfbdFallbackReason: 'none',
    items: [
      {
        id: `${year}0101`,
        seasonType: 'postseason',
        startDate: champDate,
        week: 15,
        status: final ? 'final' : 'in progress',
        home: { team: 'Alpha U', score: final ? 34 : 14 },
        away: { team: 'Beta U', score: final ? 21 : 10 },
        time: null,
      },
    ],
  });
}

// PLATFORM-086F2B — the cron consumes the SHARED grouping policy
// (groupRolloverTargets); the test league stays excluded from automatic rollover.
test('the test league is excluded from automatic rollover', async () => {
  await setAppState('leagues', 'registry', [
    makeLeague('test', { state: 'season', year: YEAR }),
    makeLeague('alpha', { state: 'season', year: YEAR }),
  ]);
  await seedScheduleWithChampionship('2023-01-09T00:00:00.000Z');

  const { result: res } = await runCapturingTags(() => GET(cronRequest()));
  const body = (await res.json()) as { leaguesRolledOver?: string[] };
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.deepEqual(body.leaguesRolledOver, ['alpha'], 'only the production league rolled');

  const leagues = await getAppState<League[]>('leagues', 'registry');
  const bySlug = Object.fromEntries((leagues?.value ?? []).map((l) => [l.slug, l.status?.state]));
  assert.equal(bySlug.test, 'season', 'test league untouched');
  assert.equal(bySlug.alpha, 'offseason');
});

test('multiple season years are evaluated independently for rollover', async () => {
  await setAppState('leagues', 'registry', [
    makeLeagueForYear('alpha', 2023),
    makeLeagueForYear('beta', 2024),
  ]);
  // Shared team catalog for both years.
  await setTeamDatabaseFile({
    source: 'cfbd',
    updatedAt: '2023-01-01T00:00:00.000Z',
    items: [
      { school: 'Alpha U', conference: 'SEC' },
      { school: 'Beta U', conference: 'Big Ten' },
    ],
  });
  // 2023: structured, final championship well in the past → eligible.
  await seedYearChampionship(2023, '2023-01-09T00:00:00.000Z', true);
  // 2024: structured championship but NOT final → not eligible.
  await seedYearChampionship(2024, '2024-01-08T00:00:00.000Z', false);

  const { result: res } = await runCapturingTags(() => GET(cronRequest()));
  const body = (await res.json()) as { leaguesRolledOver?: string[] };
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.deepEqual(body.leaguesRolledOver, ['alpha'], 'only the eligible year rolled');

  const leagues = await getAppState<League[]>('leagues', 'registry');
  const bySlug = Object.fromEntries((leagues?.value ?? []).map((l) => [l.slug, l.status?.state]));
  assert.equal(bySlug.alpha, 'offseason', '2023 rolled to offseason');
  assert.equal(bySlug.beta, 'season', '2024 (not final) stays in season');
});

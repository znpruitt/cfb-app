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

// Seed a schedule cache containing a national-championship game. `champDate`
// controls the rollover time gate: rollover fires only at championship + 7 days.
async function seedScheduleWithChampionship(champDate: string): Promise<void> {
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
        id: 'champ-1',
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
        playoffRound: 'national_championship',
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

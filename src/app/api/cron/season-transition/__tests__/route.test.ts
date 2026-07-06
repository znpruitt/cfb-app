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

// ---------------------------------------------------------------------------
// PLATFORM-071 — cron season-transition must invalidate standings for each
// league it flips preseason → season (preseason owner list → live standings).
// Previously it wrote status/year but left warm standings snapshots stale
// (documented gap).
//
// The success path drives the transition from a seeded schedule-probe with a
// past firstGameDate; the CFBD fetch short-circuits (no key configured in the
// test env), and the seeded probe alone satisfies the transition time gate.
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
});

test.after(() => {
  MUTABLE_ENV.NODE_ENV = ORIGINAL_NODE_ENV;
  if (ORIGINAL_CRON_SECRET === undefined) delete MUTABLE_ENV.CRON_SECRET;
  else MUTABLE_ENV.CRON_SECRET = ORIGINAL_CRON_SECRET;
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

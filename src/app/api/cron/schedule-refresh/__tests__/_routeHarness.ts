import test from 'node:test';

// Importing this harness installs root hooks for the importing test file. Those
// hooks reset PID-scoped AppState and route caches, own the mutable test env,
// and replace globalThis.fetch with the CFBD stub below. Import it only from
// schedule-refresh route tests that require that isolation contract.
//
// Install the global AsyncLocalStorage before the Next storage module loads so
// the E1A authority's `revalidateTag` (via invalidateStandings) runs under
// node:test.
import '../../../draft/[slug]/[year]/__tests__/_setup/installAsyncLocalStorage';
import { workAsyncStorage } from 'next/dist/server/app-render/work-async-storage.external';

import { GET } from '../route';
import { TEST_LEAGUE_SLUG, type League } from '../../../../../lib/league.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateReadFailureForTests,
  getAppState,
  setAppState,
} from '../../../../../lib/server/appStateStore.ts';
import {
  setDatasetAutoRefreshEnabled,
  setGlobalPause,
} from '../../../../../lib/server/providerRefreshSettings.ts';
import { getProviderRefreshStatus } from '../../../../../lib/server/providerRefreshStatus.ts';
import { yearScope } from '../../../../../lib/providerRefreshScope.ts';
import { acquireScheduleRefreshLease } from '../../../../../lib/schedule/scheduleRefreshLease.ts';
import { __resetSchedulePresentationMemoForTests } from '../../../../../lib/schedule/schedulePresentationJoin.ts';
import { resetScheduleRouteCacheForTests } from '../../../schedule/cache.ts';
import type { ScheduleRefreshCronExecutionEvent } from '../../../../../lib/schedule/cronExecutionLog.ts';

const CRON_SECRET = 'test-cron-secret';
const MUTABLE_ENV = process.env as Record<string, string | undefined>;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;
const ORIGINAL_CFBD_API_KEY = process.env.CFBD_API_KEY;
const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_CONSOLE_LOG = console.log;

// Deterministic operation fixtures relative to the REAL clock (the route
// classifies at Date.now()): a far-future latest regular kickoff keeps the year
// `ordinary-maintenance`; a past kickoff puts it past the boundary
// (`postseason-boundary`).
const ORDINARY_KICKOFF = '2099-11-27T20:00:00.000Z';
const CRITICAL_KICKOFF = '2020-11-28T20:00:00.000Z';

function makeLeague(slug: string, status: League['status'], year = 2031): League {
  return {
    slug,
    displayName: `League ${slug}`,
    year,
    createdAt: '2022-01-01T00:00:00.000Z',
    status,
  };
}

async function seedSeasonLeague(year: number, slug = `league-${year}`): Promise<void> {
  const existing = (await getAppState<League[]>('leagues', 'registry'))?.value ?? [];
  await setAppState('leagues', 'registry', [
    ...existing,
    makeLeague(slug, { state: 'season', year }, year),
  ]);
}

/** Seed a prior-good canonical schedule whose latest regular kickoff fixes the operation. */
async function seedSchedule(
  year: number,
  kickoff: string,
  options: { at?: number } = {}
): Promise<void> {
  await setAppState('schedule', `${year}-all-all`, {
    at: options.at ?? 1,
    items: [
      {
        id: `${year}-1`,
        week: 1,
        startDate: '2020-09-01T00:00:00.000Z',
        homeTeam: 'Texas',
        awayTeam: 'Rice',
        status: 'scheduled',
        seasonType: 'regular',
      },
      {
        id: `${year}-2`,
        week: 14,
        startDate: kickoff,
        homeTeam: 'Ohio State',
        awayTeam: 'Michigan',
        status: 'scheduled',
        seasonType: 'regular',
      },
    ],
    partialFailure: false,
    failedSeasonTypes: [],
  });
}

type PartitionResponse = string | 'throw';
const fetchLog: string[] = [];
/** Every provider URL requested, in order — the observer the zero-call assertions rest on. */
const providerUrlLog: string[] = [];
/** PLATFORM-086E1C2: presentation-endpoint requests, tracked SEPARATELY from the
 * canonical `/games` log so canonical assertions stay exact. */
const presentationFetchLog: string[] = [];

/**
 * Year-aware CFBD stub; records `${year}:${seasonType}` per canonical `/games`
 * request. Presentation endpoints (`/games/media`, `/venues`) dispatch to their
 * own handlers + log (default: empty arrays — a provider-cheap presentation
 * no-op) so the E1C2 wiring never contaminates canonical call accounting.
 */
function stubProvider(
  perYear: Record<number, { regular: PartitionResponse; postseason: PartitionResponse }>,
  presentation: {
    media?: (year: number) => PartitionResponse;
    venues?: () => PartitionResponse;
  } = {}
): void {
  globalThis.fetch = (async (input: URL | string | Request) => {
    // Resolve the URL from every input shape. `String(new Request(u))` is
    // '[object Request]', which `new URL()` rejects — so recording the real
    // href is what the zero-call accounting below depends on.
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    providerUrlLog.push(href);
    const url = new URL(href);
    if (url.pathname === '/games/media') {
      const mediaYear = Number(url.searchParams.get('year'));
      presentationFetchLog.push(`media:${mediaYear}`);
      const body = presentation.media ? presentation.media(mediaYear) : '[]';
      if (body === 'throw') throw new Error('stub: media network down');
      return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.pathname === '/venues') {
      presentationFetchLog.push('venues');
      const body = presentation.venues ? presentation.venues() : '[]';
      if (body === 'throw') throw new Error('stub: venues network down');
      return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
    }
    const year = Number(url.searchParams.get('year'));
    const seasonType = url.searchParams.get('seasonType') ?? '';
    fetchLog.push(`${year}:${seasonType}`);
    const cfg = perYear[year]?.[seasonType === 'postseason' ? 'postseason' : 'regular'];
    if (cfg === undefined || cfg === 'throw') throw new Error('stub: network down');
    return new Response(cfg, { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

function gameBody(year: number): string {
  return JSON.stringify([
    {
      id: year * 10 + 1,
      week: 1,
      home_team: 'Texas',
      away_team: 'Rice',
      start_date: `${year}-09-01T00:00:00Z`,
      home_conference: 'Big 12',
      away_conference: 'American',
    },
  ]);
}

function cronRequest(secret: string | null = CRON_SECRET): Request {
  const headers: Record<string, string> = {};
  if (secret) headers['authorization'] = `Bearer ${secret}`;
  return new Request('https://example.com/api/cron/schedule-refresh', { headers });
}

type CapturedRun = {
  res: Response;
  events: ScheduleRefreshCronExecutionEvent[];
  rawLines: string[];
};

/** Invoke the route under the Next work store, capturing structured log events. */
async function runRoute(req: Request = cronRequest()): Promise<CapturedRun> {
  const rawLines: string[] = [];
  const events: ScheduleRefreshCronExecutionEvent[] = [];
  console.log = ((...args: unknown[]) => {
    const line = args.map((a) => String(a)).join(' ');
    rawLines.push(line);
    try {
      const parsed = JSON.parse(line) as { event?: string };
      if (parsed?.event === 'schedule-refresh-cron') {
        events.push(parsed as ScheduleRefreshCronExecutionEvent);
      }
    } catch {
      // Non-JSON console output — ignored.
    }
  }) as typeof console.log;
  const store = {
    route: '/test',
    incrementalCache: {},
    pendingRevalidatedTags: [] as string[],
    pathWasRevalidated: false,
  };
  try {
    const res = await workAsyncStorage.run(store as never, () => GET(req));
    return { res, events, rawLines };
  } finally {
    console.log = ORIGINAL_CONSOLE_LOG;
  }
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  resetScheduleRouteCacheForTests();
  fetchLog.length = 0;
  providerUrlLog.length = 0;
  presentationFetchLog.length = 0;
  __resetSchedulePresentationMemoForTests();
  MUTABLE_ENV.NODE_ENV = 'development';
  MUTABLE_ENV.CRON_SECRET = CRON_SECRET;
  MUTABLE_ENV.CFBD_API_KEY = 'test-cfbd-token';
  stubProvider({});
});

test.after(() => {
  MUTABLE_ENV.NODE_ENV = ORIGINAL_NODE_ENV;
  if (ORIGINAL_CRON_SECRET === undefined) delete MUTABLE_ENV.CRON_SECRET;
  else MUTABLE_ENV.CRON_SECRET = ORIGINAL_CRON_SECRET;
  if (ORIGINAL_CFBD_API_KEY === undefined) delete MUTABLE_ENV.CFBD_API_KEY;
  else MUTABLE_ENV.CFBD_API_KEY = ORIGINAL_CFBD_API_KEY;
  globalThis.fetch = ORIGINAL_FETCH;
  console.log = ORIGINAL_CONSOLE_LOG;
});

const EARLY_FIRST_KICKOFF = '2099-08-28T16:00:00.000Z';

async function seedPreseasonLeague(year: number, slug = `pre-${year}`): Promise<void> {
  const existing = (await getAppState<League[]>('leagues', 'registry'))?.value ?? [];
  await setAppState('leagues', 'registry', [
    ...existing,
    makeLeague(slug, { state: 'preseason', year }, year),
  ]);
}

async function seedProbe(year: number, firstGameDate: string | null): Promise<void> {
  await setAppState('schedule-probe', String(year), {
    year,
    baseCachedAt: '2031-05-01T00:00:00.000Z',
    firstGameDate,
  });
}

export {
  GET,
  workAsyncStorage,
  TEST_LEAGUE_SLUG,
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateReadFailureForTests,
  getAppState,
  setAppState,
  setDatasetAutoRefreshEnabled,
  setGlobalPause,
  getProviderRefreshStatus,
  yearScope,
  acquireScheduleRefreshLease,
  resetScheduleRouteCacheForTests,
  CRON_SECRET,
  MUTABLE_ENV,
  ORIGINAL_CONSOLE_LOG,
  ORDINARY_KICKOFF,
  CRITICAL_KICKOFF,
  makeLeague,
  seedSeasonLeague,
  seedSchedule,
  fetchLog,
  providerUrlLog,
  presentationFetchLog,
  stubProvider,
  gameBody,
  cronRequest,
  runRoute,
  EARLY_FIRST_KICKOFF,
  seedPreseasonLeague,
  seedProbe,
};
export type { League };

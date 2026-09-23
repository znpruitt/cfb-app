import assert from 'node:assert/strict';
import test from 'node:test';

import { GET } from '../route';
import { TEST_LEAGUE_SLUG, type League } from '../../../../../lib/league.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateReadFailureForTests,
  setAppState,
} from '../../../../../lib/server/appStateStore.ts';
import {
  PROVIDER_REFRESH_SETTINGS_KEY,
  PROVIDER_REFRESH_SETTINGS_SCOPE,
  type ProviderRefreshSettings,
} from '../../../../../lib/server/providerRefreshSettings.ts';
import { PROVIDER_DATASETS } from '../../../../../lib/providerDatasets.ts';
import {
  acquireSchedulePresentationLease,
  SCHEDULE_MEDIA_REFRESH_CONTROL_SCOPE,
  VENUE_CATALOG_REFRESH_CONTROL_KEY,
  VENUE_CATALOG_REFRESH_CONTROL_SCOPE,
} from '../../../../../lib/schedule/schedulePresentationLease.ts';
import {
  scheduleMediaStateKey,
  SCHEDULE_MEDIA_STATE_SCOPE,
  VENUE_CATALOG_STATE_KEY,
  VENUE_CATALOG_STATE_SCOPE,
} from '../../../../../lib/schedule/schedulePresentation.ts';
import { __resetSchedulePresentationMemoForTests } from '../../../../../lib/schedule/schedulePresentationJoin.ts';
import {
  installSchedulerReceiptDeferrer,
  readSchedulerReceipt,
} from '../../../../../lib/server/__tests__/schedulerReceiptTestHarness.ts';
import type { SchedulePresentationRefreshEvent } from '../../../../../lib/schedule/schedulePresentationLog.ts';

/**
 * PLATFORM-757a — the STANDALONE schedule-presentation job.
 *
 * Acceptance 3 (the receipt survives a provider hang) lives in its own file,
 * `stall.test.ts`, because it drives the clock and must not share a process
 * where other tests rely on real timers.
 */

const CRON_SECRET = 'test-cron-secret';
const MUTABLE_ENV = process.env as Record<string, string | undefined>;
const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;
const ORIGINAL_CFBD_API_KEY = process.env.CFBD_API_KEY;
const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_CONSOLE_LOG = console.log;

let deferrer: ReturnType<typeof installSchedulerReceiptDeferrer>;

/**
 * EVERY provider URL the stub is handed, recorded BEFORE any parsing or
 * branching, so an unparseable input cannot empty the log while a call was in
 * fact attempted. This is the observer every zero-request assertion rests on,
 * and it is mutation-verified by the positive control at the end of this file.
 */
let providerUrlLog: string[] = [];

/** Structured runtime event lines this run emitted, parsed. */
let eventLog: Array<Record<string, unknown>> = [];

function authorized(): Request {
  return new Request('https://turfwar.games/api/cron/schedule-presentation', {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
}

function stubProvider(handlers: { media?: () => unknown; venues?: () => unknown } = {}): void {
  globalThis.fetch = (async (input: URL | string | Request) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    providerUrlLog.push(href);
    if (href.includes('/games/media')) {
      if (!handlers.media) throw new Error('unexpected /games/media call');
      return jsonResponse(handlers.media());
    }
    if (href.includes('/venues')) {
      if (!handlers.venues) throw new Error('unexpected /venues call');
      return jsonResponse(handlers.venues());
    }
    throw new Error(`unexpected provider call: ${href}`);
  }) as typeof fetch;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function makeLeague(
  slug: string,
  state: 'season' | 'preseason' | 'offseason',
  year: number
): League {
  return {
    slug,
    displayName: `League ${slug}`,
    year,
    createdAt: '2022-01-01T00:00:00.000Z',
    status: { state, year },
  };
}

async function seedLeagues(leagues: League[]): Promise<void> {
  await setAppState('leagues', 'registry', leagues);
}

/** A canonical schedule whose rows carry valid numeric provider ids. */
async function seedCanonicalSchedule(year: number, ids: string[] = ['101', '102']): Promise<void> {
  await setAppState('schedule', `${year}-all-all`, {
    at: 1,
    items: ids.map((id, index) => ({
      id,
      week: 1,
      startDate: '2026-09-05T23:00:00.000Z',
      neutralSite: false,
      conferenceGame: false,
      homeTeam: `Home ${index}`,
      awayTeam: `Away ${index}`,
      homeId: null,
      awayId: null,
      homeConference: 'SEC',
      awayConference: 'SEC',
      status: 'scheduled',
      seasonType: 'regular',
    })),
    partialFailure: false,
    failedSeasonTypes: [],
  });
}

async function seedSettings(overrides: Partial<ProviderRefreshSettings> = {}): Promise<void> {
  const datasets = {} as ProviderRefreshSettings['datasets'];
  for (const dataset of PROVIDER_DATASETS) datasets[dataset] = { enabled: true };
  await setAppState(PROVIDER_REFRESH_SETTINGS_SCOPE, PROVIDER_REFRESH_SETTINGS_KEY, {
    globalPause: false,
    datasets,
    ...overrides,
  } satisfies ProviderRefreshSettings);
}

const MEDIA_PAYLOAD = [
  { id: 101, mediaType: 'tv', outlet: 'ESPN' },
  { id: 102, mediaType: 'web', outlet: 'ESPN+' },
];
const VENUES_PAYLOAD = [
  { id: 3504, name: 'Kyle Field', city: 'College Station', state: 'TX', country_code: 'US' },
];

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  __resetSchedulePresentationMemoForTests();
  __setAppStateReadFailureForTests(null, null);
  providerUrlLog = [];
  eventLog = [];
  MUTABLE_ENV.CRON_SECRET = CRON_SECRET;
  MUTABLE_ENV.CFBD_API_KEY = 'test-cfbd-token';
  deferrer = installSchedulerReceiptDeferrer();
  console.log = (...args: unknown[]) => {
    const first = args[0];
    if (typeof first === 'string' && first.startsWith('{')) {
      try {
        eventLog.push(JSON.parse(first) as Record<string, unknown>);
        return;
      } catch {
        // Not one of ours — fall through to the real logger.
      }
    }
    ORIGINAL_CONSOLE_LOG(...args);
  };
});

test.afterEach(() => {
  deferrer.restore();
  globalThis.fetch = ORIGINAL_FETCH;
  console.log = ORIGINAL_CONSOLE_LOG;
  __setAppStateReadFailureForTests(null, null);
  MUTABLE_ENV.CRON_SECRET = ORIGINAL_CRON_SECRET;
  MUTABLE_ENV.CFBD_API_KEY = ORIGINAL_CFBD_API_KEY;
});

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

test('an unauthenticated request is 401 and creates NO receipt', async () => {
  stubProvider();
  await seedLeagues([makeLeague('a', 'season', 2026)]);
  const res = await GET(
    new Request('https://turfwar.games/api/cron/schedule-presentation', {
      headers: { authorization: 'Bearer wrong' },
    })
  );
  assert.equal(res.status, 401);
  assert.equal((await res.json()).reason, 'cron-authorization-invalid');
  // Identity is created only AFTER authentication, so nothing was deferred.
  assert.equal(deferrer.count(), 0, 'an unauthenticated request must not advance a receipt');
  await deferrer.flush();
  assert.equal(await readSchedulerReceipt('schedule-presentation'), null);
  assert.deepEqual(providerUrlLog, []);
});

// ---------------------------------------------------------------------------
// ACCEPTANCE 1 — a standalone run refreshes and writes its own receipt
// ---------------------------------------------------------------------------

test('ACCEPTANCE 1: a standalone run refreshes presentation and writes its own receipt', async () => {
  await seedLeagues([makeLeague('a', 'season', 2026)]);
  await seedSettings();
  await seedCanonicalSchedule(2026);
  stubProvider({ media: () => MEDIA_PAYLOAD, venues: () => VENUES_PAYLOAD });

  const res = await GET(authorized());
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.result, 'success');
  assert.equal(body.reason, 'presentation-refreshed');
  assert.deepEqual(
    body.years.map((y: { year: number; media: string }) => [y.year, y.media]),
    [[2026, 'written-clean']]
  );

  // It made the provider calls itself — this is a standalone job, not a reader
  // of someone else's refresh.
  assert.equal(providerUrlLog.filter((u) => u.includes('/games/media')).length, 1);
  assert.equal(providerUrlLog.filter((u) => u.includes('/venues')).length, 1);

  // And it committed, so the media cache is populated.
  const { getAppState } = await import('../../../../../lib/server/appStateStore.ts');
  const media = await getAppState<{ items: unknown[] }>(
    SCHEDULE_MEDIA_STATE_SCOPE,
    scheduleMediaStateKey(2026)
  );
  assert.equal(media?.value.items.length, 2);

  await deferrer.flush();
  const receipt = await readSchedulerReceipt('schedule-presentation');
  assert.ok(receipt, 'the standalone job files its OWN receipt');
  assert.equal(receipt.value.job, 'schedule-presentation');
  assert.equal(receipt.value.source, 'qstash');
  assert.equal(receipt.value.result, 'success');
  assert.equal(receipt.value.providerCallAttempted, true);
  assert.equal(receipt.value.target.kind, 'schedule-presentation');
});

test('the standalone run is distinguishable from an inline one in the logs', async () => {
  await seedLeagues([makeLeague('a', 'season', 2026)]);
  await seedSettings();
  await seedCanonicalSchedule(2026);
  stubProvider({ media: () => MEDIA_PAYLOAD, venues: () => VENUES_PAYLOAD });
  await GET(authorized());

  // The authority's own event carries the trigger. During 757a the inline call
  // inside `cron/schedule-refresh` emits the SAME event name with
  // `trigger: 'weekly'`, and the two run on the same Tuesday — so a shared
  // trigger value would make them indistinguishable in exactly the window this
  // slice exists to observe.
  const presentationEvents = eventLog.filter(
    (e) => e.event === 'schedule-presentation-refresh'
  ) as unknown as SchedulePresentationRefreshEvent[];
  assert.equal(presentationEvents.length, 1);
  assert.equal(presentationEvents[0].trigger, 'presentation-weekly');
  assert.notEqual(presentationEvents[0].trigger, 'weekly');

  // And the job emits its own cron event beside it.
  const cronEvents = eventLog.filter((e) => e.event === 'schedule-presentation-cron');
  assert.equal(cronEvents.length, 1);
  assert.equal(cronEvents[0].reason, 'presentation-refreshed');
});

// ---------------------------------------------------------------------------
// ACCEPTANCE 8 — the operator gate
// ---------------------------------------------------------------------------

test('ACCEPTANCE 8: global pause skips the run and makes NO provider call', async () => {
  await seedLeagues([makeLeague('a', 'season', 2026)]);
  await seedSettings({ globalPause: true });
  await seedCanonicalSchedule(2026);
  stubProvider(); // any call throws

  const body = await (await GET(authorized())).json();
  assert.equal(body.result, 'skipped');
  assert.equal(body.reason, 'automation-paused-or-disabled');
  assert.deepEqual(providerUrlLog, [], 'a paused run must not touch the provider');

  await deferrer.flush();
  const receipt = await readSchedulerReceipt('schedule-presentation');
  assert.equal(receipt?.value.result, 'skipped');
  assert.equal(receipt?.value.providerCallAttempted, false);
});

test('ACCEPTANCE 8: the Schedule dataset toggle alone also stops the run', async () => {
  await seedLeagues([makeLeague('a', 'season', 2026)]);
  const datasets = {} as ProviderRefreshSettings['datasets'];
  for (const dataset of PROVIDER_DATASETS) datasets[dataset] = { enabled: true };
  datasets.schedule = { enabled: false };
  await setAppState(PROVIDER_REFRESH_SETTINGS_SCOPE, PROVIDER_REFRESH_SETTINGS_KEY, {
    globalPause: false,
    datasets,
  } satisfies ProviderRefreshSettings);
  await seedCanonicalSchedule(2026);
  stubProvider();

  const body = await (await GET(authorized())).json();
  assert.equal(body.reason, 'automation-paused-or-disabled');
  assert.deepEqual(providerUrlLog, []);

  // The presentation refresh records against the `schedule` dataset's scopes,
  // so the Schedule toggle is the one that governs it. A different dataset
  // being off must NOT stop this job — otherwise the gate is the wrong gate and
  // this assertion is the only thing that would say so.
  const otherOff = {} as ProviderRefreshSettings['datasets'];
  for (const dataset of PROVIDER_DATASETS) otherOff[dataset] = { enabled: true };
  otherOff.odds = { enabled: false };
  await setAppState(PROVIDER_REFRESH_SETTINGS_SCOPE, PROVIDER_REFRESH_SETTINGS_KEY, {
    globalPause: false,
    datasets: otherOff,
  } satisfies ProviderRefreshSettings);
  stubProvider({ media: () => MEDIA_PAYLOAD, venues: () => VENUES_PAYLOAD });
  const second = await (await GET(authorized())).json();
  assert.equal(second.reason, 'presentation-refreshed', 'only the Schedule toggle gates this job');
});

test('ACCEPTANCE 8: a settings-store outage fails CLOSED and says which it was', async () => {
  await seedLeagues([makeLeague('a', 'season', 2026)]);
  await seedCanonicalSchedule(2026);
  stubProvider();
  // Fail ONLY the settings scope, so the registry read still succeeds and the
  // run genuinely reaches the gate rather than failing earlier for a different
  // reason — which would make this test pass while proving nothing.
  __setAppStateReadFailureForTests(
    new Error('settings store down'),
    PROVIDER_REFRESH_SETTINGS_SCOPE
  );

  const body = await (await GET(authorized())).json();
  assert.equal(body.result, 'failure');
  assert.equal(
    body.reason,
    'settings-unavailable',
    'an unreadable gate is reported, never assumed open'
  );
  assert.deepEqual(providerUrlLog, [], 'a run that cannot read the gate makes no provider call');
});

// ---------------------------------------------------------------------------
// ACCEPTANCE 5 — concurrency with the inline call
// ---------------------------------------------------------------------------

test('ACCEPTANCE 5: when the inline call holds the media lease this job yields and spends nothing', async () => {
  await seedLeagues([makeLeague('a', 'season', 2026)]);
  await seedSettings();
  await seedCanonicalSchedule(2026);

  // Exactly what an in-flight inline refresh looks like: a live durable lease on
  // the media control key for this year, held by someone else.
  const held = await acquireSchedulePresentationLease({
    controlScope: SCHEDULE_MEDIA_REFRESH_CONTROL_SCOPE,
    controlKey: '2026',
    now: Date.now(),
  });
  assert.equal(held.acquired, true, 'the other holder takes the lease first');

  stubProvider({ venues: () => VENUES_PAYLOAD });
  const body = await (await GET(authorized())).json();

  assert.equal(body.years[0].media, 'refresh-in-progress', 'the loser does not fetch media');
  assert.equal(
    providerUrlLog.filter((u) => u.includes('/games/media')).length,
    0,
    'a lease loser issues NO media request'
  );
  // The two parts are independently leased, so losing media does not block the
  // venue refresh. That independence is the contract, and asserting it here is
  // what would catch a future change that collapsed the two leases into one.
  assert.equal(providerUrlLog.filter((u) => u.includes('/venues')).length, 1);
});

test('ACCEPTANCE 5: the venue lease is global, so a held venue lease yields independently', async () => {
  await seedLeagues([makeLeague('a', 'season', 2026)]);
  await seedSettings();
  await seedCanonicalSchedule(2026);
  const held = await acquireSchedulePresentationLease({
    controlScope: VENUE_CATALOG_REFRESH_CONTROL_SCOPE,
    controlKey: VENUE_CATALOG_REFRESH_CONTROL_KEY,
    now: Date.now(),
  });
  assert.equal(held.acquired, true);

  stubProvider({ media: () => MEDIA_PAYLOAD });
  const body = await (await GET(authorized())).json();
  assert.equal(body.years[0].venues, 'refresh-in-progress');
  assert.equal(body.years[0].media, 'written-clean', 'media proceeds while venues is held');
  assert.equal(providerUrlLog.filter((u) => u.includes('/venues')).length, 0);
});

// ---------------------------------------------------------------------------
// Target selection
// ---------------------------------------------------------------------------

test('it refreshes every active season year, and no offseason or demo year', async () => {
  await seedLeagues([
    makeLeague('prod-season', 'season', 2026),
    makeLeague('prod-preseason', 'preseason', 2027),
    makeLeague('prod-offseason', 'offseason', 2025),
    makeLeague(TEST_LEAGUE_SLUG, 'season', 2024),
  ]);
  await seedSettings();
  await seedCanonicalSchedule(2026);
  await seedCanonicalSchedule(2027);
  stubProvider({ media: () => MEDIA_PAYLOAD, venues: () => VENUES_PAYLOAD });

  const body = await (await GET(authorized())).json();
  assert.deepEqual(
    body.years.map((y: { year: number }) => y.year).sort(),
    [2026, 2027],
    'both active years, neither the offseason nor the demo year'
  );
  // The venue catalog is GLOBAL and TTL-gated, so a two-year run fetches it once
  // and the second year reads it fresh. This is the arithmetic the budget rests
  // on: N years cost N media calls plus ONE venue call, not 2N.
  assert.equal(providerUrlLog.filter((u) => u.includes('/venues')).length, 1);
  assert.equal(providerUrlLog.filter((u) => u.includes('/games/media')).length, 2);
});

test('an active demo league alone reports the demo reason, not "no target"', async () => {
  await seedLeagues([makeLeague(TEST_LEAGUE_SLUG, 'season', 2026)]);
  await seedSettings();
  stubProvider();
  const body = await (await GET(authorized())).json();
  assert.equal(body.result, 'skipped');
  assert.equal(body.reason, 'no-automatic-maintenance-target');
  assert.deepEqual(providerUrlLog, []);
});

test('a structurally invalid season year is refused and counted, never refreshed', async () => {
  // A STRING year, via `unknown`, because that is the shape durable JSON can
  // actually hold: `readLeagueRegistry` types the array `League[]` but validates
  // no element, so the type here is a claim about the code, not about the store.
  // The double cast is the honest spelling of that gap, not a convenience.
  await seedLeagues([
    {
      ...makeLeague('bad', 'season', 2026),
      status: { state: 'season', year: '2026' },
    } as unknown as League,
  ]);
  await seedSettings();
  stubProvider();
  const body = await (await GET(authorized())).json();
  assert.equal(body.result, 'failure');
  assert.equal(body.reason, 'unusable-lifecycle-year');
  assert.equal(body.invalidLifecycleTargets, 1);
  assert.deepEqual(providerUrlLog, []);
});

test('a malformed registry container is reported as such, not as "no active league"', async () => {
  await setAppState('leagues', 'registry', { not: 'an array' });
  await seedSettings();
  stubProvider();
  const body = await (await GET(authorized())).json();
  assert.equal(body.result, 'failure');
  assert.equal(body.reason, 'registry-malformed');
  assert.deepEqual(providerUrlLog, []);
});

// ---------------------------------------------------------------------------
// The canonical-context precondition — the job is NOT gated on the schedule job
// ---------------------------------------------------------------------------

test('an absent canonical schedule makes no provider call and is not a failure', async () => {
  await seedLeagues([makeLeague('a', 'season', 2026)]);
  await seedSettings();
  // No canonical schedule seeded at all.
  stubProvider();
  const body = await (await GET(authorized())).json();
  // The authority checks its OWN precondition; the job never reads the schedule
  // job's receipt, so a lost receipt (#757's own failure) cannot stop it.
  assert.equal(body.years[0].media, 'no-eligible-games');
  assert.equal(body.result, 'no-op');
  assert.deepEqual(providerUrlLog, []);
});

// ---------------------------------------------------------------------------
// ACCEPTANCE 9 — most-stale-media-first ordering
// ---------------------------------------------------------------------------

test('ACCEPTANCE 9: years run most-stale-media first, so a truncated run advances the stalest', async () => {
  await seedLeagues([
    makeLeague('a', 'season', 2026),
    makeLeague('b', 'preseason', 2027),
    makeLeague('c', 'preseason', 2028),
  ]);
  await seedSettings();
  for (const year of [2026, 2027, 2028]) await seedCanonicalSchedule(year);

  // 2027 is the stalest, 2026 next, 2028 freshest. Lowest-numbered-first would
  // give 2026, 2027, 2028 — so the assertion below fails against that ordering.
  await setAppState(SCHEDULE_MEDIA_STATE_SCOPE, scheduleMediaStateKey(2026), {
    at: 5_000,
    items: [],
  });
  await setAppState(SCHEDULE_MEDIA_STATE_SCOPE, scheduleMediaStateKey(2027), {
    at: 1_000,
    items: [],
  });
  await setAppState(SCHEDULE_MEDIA_STATE_SCOPE, scheduleMediaStateKey(2028), {
    at: 9_000,
    items: [],
  });
  await setAppState(VENUE_CATALOG_STATE_SCOPE, VENUE_CATALOG_STATE_KEY, {
    at: Date.now(),
    items: VENUES_PAYLOAD.map((v) => ({
      id: v.id,
      name: v.name,
      city: v.city,
      state: v.state,
      countryCode: 'US',
      timezone: null,
      capacity: null,
      grass: null,
      dome: null,
    })),
  });
  stubProvider({ media: () => MEDIA_PAYLOAD });

  const body = await (await GET(authorized())).json();
  assert.deepEqual(
    body.years.map((y: { year: number }) => y.year),
    [2027, 2026, 2028],
    'stalest media first, not ascending year'
  );
});

test('ACCEPTANCE 9: a year whose media was NEVER refreshed sorts ahead of every dated one', async () => {
  await seedLeagues([makeLeague('a', 'season', 2026), makeLeague('b', 'preseason', 2027)]);
  await seedSettings();
  await seedCanonicalSchedule(2026);
  await seedCanonicalSchedule(2027);
  // 2026 has a media entry; 2027 has none at all. "Never refreshed" is staler
  // than any timestamp, so 2027 must lead.
  await setAppState(SCHEDULE_MEDIA_STATE_SCOPE, scheduleMediaStateKey(2026), {
    at: 1_000,
    items: [],
  });
  stubProvider({ media: () => MEDIA_PAYLOAD, venues: () => VENUES_PAYLOAD });

  const body = await (await GET(authorized())).json();
  assert.deepEqual(
    body.years.map((y: { year: number }) => y.year),
    [2027, 2026]
  );
});

// ---------------------------------------------------------------------------
// Positive control for the observer every zero-request assertion depends on
// ---------------------------------------------------------------------------

test('POSITIVE CONTROL: providerUrlLog does record a real provider call', async () => {
  // Every `assert.deepEqual(providerUrlLog, [])` above is only as good as this.
  // A log that recorded nothing would make all of them pass against a job that
  // called CFBD on every path — the failure mode where a scan returning zero
  // because it did not look reads identically to one that looked.
  await seedLeagues([makeLeague('a', 'season', 2026)]);
  await seedSettings();
  await seedCanonicalSchedule(2026);
  stubProvider({ media: () => MEDIA_PAYLOAD, venues: () => VENUES_PAYLOAD });
  await GET(authorized());
  assert.ok(providerUrlLog.length >= 2, 'the observer sees media AND venues');
  assert.ok(providerUrlLog.some((u) => u.includes('/games/media')));
  assert.ok(providerUrlLog.some((u) => u.includes('/venues')));
});

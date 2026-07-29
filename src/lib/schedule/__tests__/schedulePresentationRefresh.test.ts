import test from 'node:test';
import assert from 'node:assert/strict';

import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateReadFailureForTests,
  __setAppStateWriteFailureForTests,
  getAppState,
  setAppState,
} from '../../server/appStateStore.ts';
import { getProviderRefreshStatus } from '../../server/providerRefreshStatus.ts';
import { scheduleMediaScope, venueCatalogScope } from '../../providerRefreshScope.ts';
import {
  scheduleMediaStateKey,
  SCHEDULE_MEDIA_STATE_SCOPE,
  VENUE_CATALOG_STATE_KEY,
  VENUE_CATALOG_STATE_SCOPE,
  type ScheduleMediaCacheEntry,
  type VenueCatalogCacheEntry,
} from '../schedulePresentation.ts';
import {
  acquireSchedulePresentationLease,
  SCHEDULE_MEDIA_REFRESH_CONTROL_SCOPE,
  VENUE_CATALOG_REFRESH_CONTROL_KEY,
  VENUE_CATALOG_REFRESH_CONTROL_SCOPE,
} from '../schedulePresentationLease.ts';
import { __resetSchedulePresentationMemoForTests } from '../schedulePresentationJoin.ts';
import {
  refreshSchedulePresentation,
  VENUE_CATALOG_TTL_MS,
} from '../schedulePresentationRefresh.ts';

const YEAR = 2027;
const NOW = Date.parse('2027-08-01T12:00:00Z');
const MEDIA_SCOPE = scheduleMediaScope(YEAR);
const VENUES_SCOPE = venueCatalogScope();

type MockFetch = typeof fetch;

/** Install a URL-dispatching fetch mock and count calls per endpoint. */
function installFetchMock(handlers: { media?: () => unknown; venues?: () => unknown }): {
  calls: { media: number; venues: number; other: number };
} {
  const calls = { media: 0, venues: 0, other: 0 };
  global.fetch = (async (input: URL | string) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/games/media')) {
      calls.media += 1;
      if (!handlers.media) throw new Error('unexpected /games/media call');
      return jsonResponse(handlers.media());
    }
    if (url.includes('/venues')) {
      calls.venues += 1;
      if (!handlers.venues) throw new Error('unexpected /venues call');
      return jsonResponse(handlers.venues());
    }
    calls.other += 1;
    throw new Error(`unexpected provider call: ${url}`);
  }) as MockFetch;
  return { calls };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function forbidAllFetches(): { calls: { media: number; venues: number; other: number } } {
  return installFetchMock({});
}

/** Seed a populated canonical schedule whose rows carry valid provider ids. */
async function seedCanonicalSchedule(
  items: Array<Record<string, unknown>> = [
    { id: '101', week: 1, homeTeam: 'Texas', awayTeam: 'Rice', startDate: '2027-08-28T23:00:00Z' },
    { id: '102', week: 1, homeTeam: 'Georgia', awayTeam: 'UT Martin', startDate: null },
  ]
): Promise<void> {
  await setAppState('schedule', `${YEAR}-all-all`, {
    at: NOW - 60_000,
    items,
    partialFailure: false,
    failedSeasonTypes: [],
  });
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
  process.env.CFBD_API_KEY = 'test-cfbd-token';
});

test('missing or empty canonical schedule produces no provider call at all', async () => {
  const { calls } = forbidAllFetches();
  // Absent canonical entry.
  const absent = await refreshSchedulePresentation({ year: YEAR, trigger: 'manual', now: NOW });
  assert.equal(absent.media.reason, 'no-eligible-games');
  assert.equal(absent.venues.reason, 'no-eligible-games');
  assert.equal(absent.status, 'no-op');
  // Genuinely empty canonical entry.
  await seedCanonicalSchedule([]);
  const empty = await refreshSchedulePresentation({ year: YEAR, trigger: 'manual', now: NOW });
  assert.equal(empty.media.reason, 'no-eligible-games');
  assert.equal(empty.media.providerCallAttempted, false);
  assert.equal(calls.media + calls.venues + calls.other, 0, 'no provider request of any kind');
  // No fabricated status attempt either.
  const mediaStatus = await getProviderRefreshStatus('schedule', MEDIA_SCOPE);
  assert.equal(mediaStatus.lastAttemptAt, null);
});

test('a canonical schedule-store read failure is canonical-context-unavailable, provider-free', async () => {
  const { calls } = forbidAllFetches();
  __setAppStateReadFailureForTests(new Error('durable read boom'), 'schedule');
  try {
    const result = await refreshSchedulePresentation({ year: YEAR, trigger: 'manual', now: NOW });
    assert.equal(result.media.reason, 'canonical-context-unavailable');
    assert.equal(result.venues.reason, 'canonical-context-unavailable');
    assert.equal(result.status, 'failure');
  } finally {
    __setAppStateReadFailureForTests(null);
  }
  assert.equal(calls.media + calls.venues + calls.other, 0);
});

test('a populated canonical schedule with zero usable provider ids is unavailable context, not permission to fetch', async () => {
  const { calls } = forbidAllFetches();
  await seedCanonicalSchedule([{ id: '1-Texas-Rice', week: 1, homeTeam: 'Texas' }]);
  const result = await refreshSchedulePresentation({ year: YEAR, trigger: 'manual', now: NOW });
  assert.equal(result.media.reason, 'canonical-context-unavailable');
  assert.equal(result.venues.reason, 'canonical-context-unavailable');
  assert.equal(calls.media + calls.venues + calls.other, 0);
});

test('valid media and venue payloads commit durable-first with exact per-scope success status', async () => {
  await seedCanonicalSchedule();
  const { calls } = installFetchMock({ media: () => MEDIA_PAYLOAD, venues: () => VENUES_PAYLOAD });
  const result = await refreshSchedulePresentation({ year: YEAR, trigger: 'manual', now: NOW });

  assert.equal(result.status, 'success');
  assert.equal(result.media.reason, 'written-clean');
  assert.equal(result.media.rowsReceived, 2);
  assert.equal(result.media.rowsCommitted, 2);
  assert.equal(result.media.dataChanged, true);
  assert.equal(result.venues.reason, 'written-clean');
  assert.equal(result.venues.rowsCommitted, 1);
  assert.equal(calls.media, 1);
  assert.equal(calls.venues, 1);

  const mediaEntry = await getAppState<ScheduleMediaCacheEntry>(
    SCHEDULE_MEDIA_STATE_SCOPE,
    scheduleMediaStateKey(YEAR)
  );
  assert.equal(mediaEntry?.value.items.length, 2);
  assert.deepEqual(mediaEntry?.value.items[0], { gameId: '101', mediaType: 'tv', outlet: 'ESPN' });
  const venueEntry = await getAppState<VenueCatalogCacheEntry>(
    VENUE_CATALOG_STATE_SCOPE,
    VENUE_CATALOG_STATE_KEY
  );
  assert.equal(venueEntry?.value.items[0]?.name, 'Kyle Field');

  const mediaStatus = await getProviderRefreshStatus('schedule', MEDIA_SCOPE);
  assert.equal(mediaStatus.latestAttemptOutcome, 'succeeded');
  const venueStatus = await getProviderRefreshStatus('schedule', VENUES_SCOPE);
  assert.equal(venueStatus.latestAttemptOutcome, 'succeeded');
  // The canonical schedule YEAR status is untouched — presentation never
  // overwrites or implies canonical schedule success.
  const yearStatus = await getProviderRefreshStatus('schedule', {
    kind: 'year',
    year: YEAR,
  });
  assert.equal(yearStatus.lastAttemptAt, null);
});

test('a venue catalog younger than 30 days suppresses /venues while media still refreshes', async () => {
  await seedCanonicalSchedule();
  await setAppState(VENUE_CATALOG_STATE_SCOPE, VENUE_CATALOG_STATE_KEY, {
    at: NOW - 1000,
    items: [
      {
        id: 1,
        name: 'Fresh Venue',
        city: null,
        state: null,
        countryCode: null,
        timezone: null,
        capacity: null,
        grass: null,
        dome: null,
      },
    ],
  });
  const { calls } = installFetchMock({ media: () => MEDIA_PAYLOAD });
  const result = await refreshSchedulePresentation({ year: YEAR, trigger: 'manual', now: NOW });
  assert.equal(result.venues.reason, 'fresh-cache');
  assert.equal(result.venues.providerCallAttempted, false);
  assert.equal(result.media.reason, 'written-clean');
  assert.equal(calls.media, 1);
  assert.equal(calls.venues, 0);
  // fresh-cache begins NO attempt.
  const venueStatus = await getProviderRefreshStatus('schedule', VENUES_SCOPE);
  assert.equal(venueStatus.lastAttemptAt, null);
});

test('a venue catalog at least 30 days old is due and refetches', async () => {
  await seedCanonicalSchedule();
  await setAppState(VENUE_CATALOG_STATE_SCOPE, VENUE_CATALOG_STATE_KEY, {
    at: NOW - VENUE_CATALOG_TTL_MS,
    items: [
      {
        id: 1,
        name: 'Old Venue',
        city: null,
        state: null,
        countryCode: null,
        timezone: null,
        capacity: null,
        grass: null,
        dome: null,
      },
    ],
  });
  const { calls } = installFetchMock({ media: () => MEDIA_PAYLOAD, venues: () => VENUES_PAYLOAD });
  const result = await refreshSchedulePresentation({ year: YEAR, trigger: 'manual', now: NOW });
  assert.equal(result.venues.reason, 'written-clean');
  assert.equal(calls.venues, 1);
});

test('media lease contention yields refresh-in-progress with no provider call and no status attempt', async () => {
  await seedCanonicalSchedule();
  const held = await acquireSchedulePresentationLease({
    controlScope: SCHEDULE_MEDIA_REFRESH_CONTROL_SCOPE,
    controlKey: String(YEAR),
    now: NOW,
  });
  assert.ok(held.acquired);
  const { calls } = installFetchMock({ venues: () => VENUES_PAYLOAD });
  const result = await refreshSchedulePresentation({ year: YEAR, trigger: 'manual', now: NOW });
  assert.equal(result.media.reason, 'refresh-in-progress');
  assert.equal(result.media.status, 'in-progress');
  assert.equal(calls.media, 0);
  // The venue part is fully independent — it still refreshed.
  assert.equal(result.venues.reason, 'written-clean');
  const mediaStatus = await getProviderRefreshStatus('schedule', MEDIA_SCOPE);
  assert.equal(mediaStatus.lastAttemptAt, null, 'no fabricated attempt for the contended part');
});

test('venue lease contention leaves media refreshing normally', async () => {
  await seedCanonicalSchedule();
  const held = await acquireSchedulePresentationLease({
    controlScope: VENUE_CATALOG_REFRESH_CONTROL_SCOPE,
    controlKey: VENUE_CATALOG_REFRESH_CONTROL_KEY,
    now: NOW,
  });
  assert.ok(held.acquired);
  const { calls } = installFetchMock({ media: () => MEDIA_PAYLOAD });
  const result = await refreshSchedulePresentation({ year: YEAR, trigger: 'manual', now: NOW });
  assert.equal(result.media.reason, 'written-clean');
  assert.equal(result.venues.reason, 'refresh-in-progress');
  assert.equal(calls.media, 1);
  assert.equal(calls.venues, 0);
});

test('a missing credential records a failure against the exact presentation scopes', async () => {
  await seedCanonicalSchedule();
  delete process.env.CFBD_API_KEY;
  const { calls } = forbidAllFetches();
  const result = await refreshSchedulePresentation({ year: YEAR, trigger: 'manual', now: NOW });
  assert.equal(result.media.reason, 'cfbd-api-key-missing');
  assert.equal(result.media.providerCallAttempted, false);
  assert.equal(result.venues.reason, 'cfbd-api-key-missing');
  assert.equal(result.status, 'failure');
  assert.equal(calls.media + calls.venues, 0);
  const mediaStatus = await getProviderRefreshStatus('schedule', MEDIA_SCOPE);
  assert.equal(mediaStatus.latestAttemptOutcome, 'failed');
  const venueStatus = await getProviderRefreshStatus('schedule', VENUES_SCOPE);
  assert.equal(venueStatus.latestAttemptOutcome, 'failed');
});

test('one part can fail while the other succeeds and retains its own prior-good', async () => {
  await seedCanonicalSchedule();
  // Prior-good media so the failed refresh has something to retain.
  await setAppState(SCHEDULE_MEDIA_STATE_SCOPE, scheduleMediaStateKey(YEAR), {
    at: NOW - 60_000,
    items: [{ gameId: '101', mediaType: 'tv', outlet: 'Prior TV' }],
  });
  global.fetch = (async (input: URL | string) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/games/media')) throw new Error('media transport down');
    if (url.includes('/venues')) return jsonResponse(VENUES_PAYLOAD);
    throw new Error(`unexpected provider call: ${url}`);
  }) as MockFetch;

  const result = await refreshSchedulePresentation({ year: YEAR, trigger: 'manual', now: NOW });
  assert.equal(result.media.reason, 'provider-fetch-failed');
  assert.equal(result.media.providerCallAttempted, true);
  assert.equal(result.venues.reason, 'written-clean');
  assert.equal(result.status, 'partial');

  const mediaEntry = await getAppState<ScheduleMediaCacheEntry>(
    SCHEDULE_MEDIA_STATE_SCOPE,
    scheduleMediaStateKey(YEAR)
  );
  assert.equal(mediaEntry?.value.items[0]?.outlet, 'Prior TV', 'prior-good media retained');
});

test('non-array, schema-drift, and unexpected-empty replacements preserve prior-good', async () => {
  await seedCanonicalSchedule();
  const priorMedia = {
    at: NOW - 60_000,
    items: [{ gameId: '101', mediaType: 'tv' as const, outlet: 'Prior TV' }],
  };
  const cases: Array<{ payload: unknown; reason: string }> = [
    { payload: { rows: [] }, reason: 'invalid-payload' },
    { payload: [{ id: 101, network: 'ESPN' }], reason: 'schema-drift' },
    { payload: [], reason: 'empty-replacement-rejected' },
  ];
  for (const [index, { payload, reason }] of cases.entries()) {
    await __deleteAppStateFileForTests();
    __resetAppStateForTests();
    __resetSchedulePresentationMemoForTests();
    process.env.CFBD_API_KEY = 'test-cfbd-token';
    await seedCanonicalSchedule();
    await setAppState(SCHEDULE_MEDIA_STATE_SCOPE, scheduleMediaStateKey(YEAR), priorMedia);
    installFetchMock({ media: () => payload, venues: () => VENUES_PAYLOAD });
    const result = await refreshSchedulePresentation({ year: YEAR, trigger: 'manual', now: NOW });
    assert.equal(result.media.reason, reason, `case ${index}: ${reason}`);
    assert.equal(result.media.status, 'failure');
    const entry = await getAppState<ScheduleMediaCacheEntry>(
      SCHEDULE_MEDIA_STATE_SCOPE,
      scheduleMediaStateKey(YEAR)
    );
    assert.equal(entry?.value.items[0]?.outlet, 'Prior TV', `case ${index}: prior-good retained`);
  }
});

test('an empty target result with no prior-good media is a valid empty-response no-op', async () => {
  await seedCanonicalSchedule();
  installFetchMock({ media: () => [], venues: () => VENUES_PAYLOAD });
  const result = await refreshSchedulePresentation({ year: YEAR, trigger: 'manual', now: NOW });
  assert.equal(result.media.reason, 'empty-response');
  assert.equal(result.media.status, 'no-op');
  const mediaStatus = await getProviderRefreshStatus('schedule', MEDIA_SCOPE);
  assert.equal(mediaStatus.latestAttemptOutcome, 'no-op');
});

test('an older or equal observation cannot overwrite a newer durable entry', async () => {
  await seedCanonicalSchedule();
  await setAppState(SCHEDULE_MEDIA_STATE_SCOPE, scheduleMediaStateKey(YEAR), {
    at: NOW,
    items: [{ gameId: '101', mediaType: 'tv', outlet: 'Newer TV' }],
  });
  installFetchMock({ media: () => MEDIA_PAYLOAD, venues: () => VENUES_PAYLOAD });
  const result = await refreshSchedulePresentation({ year: YEAR, trigger: 'manual', now: NOW });
  assert.equal(result.media.reason, 'stale-observation');
  assert.equal(result.media.status, 'no-op');
  const entry = await getAppState<ScheduleMediaCacheEntry>(
    SCHEDULE_MEDIA_STATE_SCOPE,
    scheduleMediaStateKey(YEAR)
  );
  assert.equal(entry?.value.items[0]?.outlet, 'Newer TV', 'the newer durable entry is preserved');
});

test('unchanged content commits only observation metadata and reports no data change', async () => {
  await seedCanonicalSchedule();
  await setAppState(SCHEDULE_MEDIA_STATE_SCOPE, scheduleMediaStateKey(YEAR), {
    at: NOW - 60_000,
    items: [
      { gameId: '101', mediaType: 'tv', outlet: 'ESPN' },
      { gameId: '102', mediaType: 'web', outlet: 'ESPN+' },
    ],
  });
  installFetchMock({ media: () => MEDIA_PAYLOAD, venues: () => VENUES_PAYLOAD });
  const result = await refreshSchedulePresentation({ year: YEAR, trigger: 'manual', now: NOW });
  assert.equal(result.media.reason, 'unchanged-clean');
  assert.equal(result.media.rowsCommitted, 0);
  assert.equal(result.media.dataChanged, false);
  const entry = await getAppState<ScheduleMediaCacheEntry>(
    SCHEDULE_MEDIA_STATE_SCOPE,
    scheduleMediaStateKey(YEAR)
  );
  assert.equal(entry?.value.at, NOW, 'observation metadata advanced');
});

test('a durable transaction failure publishes no memo and no success status', async () => {
  await seedCanonicalSchedule();
  installFetchMock({ media: () => MEDIA_PAYLOAD, venues: () => VENUES_PAYLOAD });
  __setAppStateWriteFailureForTests(new Error('durable write down'), SCHEDULE_MEDIA_STATE_SCOPE);
  try {
    const result = await refreshSchedulePresentation({ year: YEAR, trigger: 'manual', now: NOW });
    assert.equal(result.media.reason, 'durable-commit-failed');
    assert.equal(result.media.status, 'failure');
  } finally {
    __setAppStateWriteFailureForTests(null);
  }
  const mediaStatus = await getProviderRefreshStatus('schedule', MEDIA_SCOPE);
  assert.equal(mediaStatus.latestAttemptOutcome, 'failed');
  assert.equal(mediaStatus.lastSuccessAt, null, 'no success published');
  const entry = await getAppState<ScheduleMediaCacheEntry>(
    SCHEDULE_MEDIA_STATE_SCOPE,
    scheduleMediaStateKey(YEAR)
  );
  assert.equal(entry, null, 'nothing durably committed');
});

test('the runtime event is emitted exactly once, allowlisted, parseable, and leak-free', async () => {
  await seedCanonicalSchedule();
  installFetchMock({ media: () => MEDIA_PAYLOAD, venues: () => VENUES_PAYLOAD });
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    if (typeof args[0] === 'string') lines.push(args[0]);
  };
  try {
    await refreshSchedulePresentation({ year: YEAR, trigger: 'manual', now: NOW });
  } finally {
    console.log = originalLog;
  }
  const eventLines = lines.filter((line) => line.includes('schedule-presentation-refresh'));
  assert.equal(eventLines.length, 1, 'exactly one event line');
  const event = JSON.parse(eventLines[0]!);
  assert.deepEqual(Object.keys(event).sort(), [
    'durationMs',
    'event',
    'media',
    'result',
    'trigger',
    'venues',
    'year',
  ]);
  assert.equal(event.event, 'schedule-presentation-refresh');
  assert.equal(event.trigger, 'manual');
  assert.equal(event.year, YEAR);
  assert.equal(event.result, 'success');
  assert.deepEqual(Object.keys(event.media).sort(), [
    'dataChanged',
    'providerCallAttempted',
    'reason',
    'result',
    'rowsCommitted',
    'rowsReceived',
  ]);
  assert.ok(!eventLines[0]!.includes('test-cfbd-token'), 'no credential in the event');
  assert.ok(!eventLines[0]!.includes('collegefootballdata'), 'no provider URL in the event');
});

test('a logger failure changes no authority result', async () => {
  await seedCanonicalSchedule();
  installFetchMock({ media: () => MEDIA_PAYLOAD, venues: () => VENUES_PAYLOAD });
  const originalLog = console.log;
  console.log = () => {
    throw new Error('console down');
  };
  try {
    const result = await refreshSchedulePresentation({ year: YEAR, trigger: 'manual', now: NOW });
    assert.equal(result.status, 'success');
    assert.equal(result.media.reason, 'written-clean');
  } finally {
    console.log = originalLog;
  }
});

test('non-canonical (leading-zero) schedule ids never enter the eligible media target', async () => {
  const { calls } = forbidAllFetches();
  await seedCanonicalSchedule([{ id: '0123', week: 1, homeTeam: 'Texas', awayTeam: 'Rice' }]);
  const result = await refreshSchedulePresentation({ year: YEAR, trigger: 'manual', now: NOW });
  assert.equal(result.media.reason, 'canonical-context-unavailable');
  assert.equal(calls.media + calls.venues + calls.other, 0);
});

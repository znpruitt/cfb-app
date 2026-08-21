import assert from 'node:assert/strict';
import test from 'node:test';

import {
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
  ORDINARY_KICKOFF,
  CRITICAL_KICKOFF,
  makeLeague,
  seedSeasonLeague,
  seedSchedule,
  fetchLog,
  presentationFetchLog,
  stubProvider,
  gameBody,
  runRoute,
  type League,
} from './_routeHarness.ts';

// ---------------------------------------------------------------------------
// PLATFORM-086E1C2 — automatic presentation wiring (trigger: 'weekly').
// A qualifying POPULATED E1A success invokes the REAL E1C1 authority exactly
// once per year; every skip/deferral/gate/failure/no-op/contention path invokes
// nothing; presentation outcomes never alter canonical cron truth.
// ---------------------------------------------------------------------------

function mediaBody(year: number): string {
  return JSON.stringify([{ id: year * 10 + 1, mediaType: 'tv', outlet: 'ESPN' }]);
}

const VENUES_BODY = JSON.stringify([
  { id: 3504, name: 'Kyle Field', city: 'College Station', state: 'TX', country_code: 'US' },
]);

function presentationEvents(rawLines: string[]): Array<{
  trigger: string;
  year: number;
  result: string;
  media: { reason: string };
  venues: { reason: string };
}> {
  const events: Array<{
    trigger: string;
    year: number;
    result: string;
    media: { reason: string };
    venues: { reason: string };
  }> = [];
  for (const line of rawLines) {
    try {
      const parsed = JSON.parse(line) as { event?: string };
      if (parsed?.event === 'schedule-presentation-refresh') {
        events.push(parsed as (typeof events)[number]);
      }
    } catch {
      // Non-JSON console output — ignored.
    }
  }
  return events;
}

async function seedFreshVenueCatalog(): Promise<void> {
  await setAppState('venue-catalog', 'current', {
    at: Date.now() - 1000,
    items: [
      {
        id: 3504,
        name: 'Kyle Field',
        city: 'College Station',
        state: 'TX',
        countryCode: 'US',
        timezone: null,
        capacity: null,
        grass: null,
        dome: null,
      },
    ],
  });
}

// 1 + 14 + 15 — written-clean success → exactly one 'weekly' presentation
// refresh; with a fresh venue catalog: 2 canonical calls + 1 media + 0 venues.
test('a written-clean weekly success invokes the presentation authority once with trigger weekly', async () => {
  await seedSeasonLeague(2031);
  await seedSchedule(2031, ORDINARY_KICKOFF);
  await seedFreshVenueCatalog();
  stubProvider(
    { 2031: { regular: gameBody(2031), postseason: '[]' } },
    { media: (year) => mediaBody(year) }
  );
  const { res, events, rawLines } = await runRoute();
  assert.equal(res.status, 200);
  assert.equal(events[0]!.years[0]!.reason, 'written-clean');

  assert.deepEqual([...fetchLog].sort(), ['2031:postseason', '2031:regular']);
  assert.deepEqual(presentationFetchLog, ['media:2031'], 'one media call, zero venue calls');
  const pEvents = presentationEvents(rawLines);
  assert.equal(pEvents.length, 1, 'exactly one separate presentation event');
  assert.equal(pEvents[0]!.trigger, 'weekly');
  assert.equal(pEvents[0]!.year, 2031);
  assert.equal(pEvents[0]!.media.reason, 'written-clean');
  assert.equal(pEvents[0]!.venues.reason, 'fresh-cache');

  const mediaEntry = await getAppState<{ items: unknown[] }>('schedule-media', '2031-all');
  assert.equal(mediaEntry?.value?.items?.length, 1, 'media durably committed');
});

// 2 — an unchanged-clean canonical success STILL refreshes presentation
// (broadcast assignments change independently of canonical rows).
test('an unchanged-clean weekly success still invokes the presentation authority', async () => {
  await seedSeasonLeague(2031);
  await seedSchedule(2031, ORDINARY_KICKOFF);
  await seedFreshVenueCatalog();
  stubProvider(
    { 2031: { regular: gameBody(2031), postseason: '[]' } },
    { media: (year) => mediaBody(year) }
  );
  const first = await runRoute();
  assert.equal(first.events[0]!.years[0]!.reason, 'written-clean');
  const second = await runRoute();
  assert.equal(second.events[0]!.years[0]!.reason, 'unchanged-clean');
  assert.deepEqual(presentationFetchLog, ['media:2031', 'media:2031'], 'both runs refreshed media');
  const pEvents = presentationEvents(second.rawLines);
  assert.equal(pEvents.length, 1);
  assert.equal(pEvents[0]!.media.reason, 'unchanged-clean', 'same media payload → unchanged-clean');
});

// 3 — successful preseason-maintenance updates the probe AND runs presentation;
// a presentation fault never disturbs the probe update.
test('successful preseason-maintenance updates the probe and presentation independently', async () => {
  const year = 2040;
  const firstKickoff = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const existing = (await getAppState<League[]>('leagues', 'registry'))?.value ?? [];
  await setAppState('leagues', 'registry', [
    ...existing,
    makeLeague(`pre-${year}`, { state: 'preseason', year }, year),
  ]);
  await seedSchedule(year, firstKickoff);
  await setAppState('schedule-probe', String(year), {
    year,
    baseCachedAt: '2020-01-01T00:00:00.000Z',
    firstGameDate: firstKickoff,
  });
  await seedFreshVenueCatalog();
  // Media THROWS — the presentation part fails while canonical + probe succeed.
  stubProvider({ [year]: { regular: gameBody(year), postseason: '[]' } }, { media: () => 'throw' });
  const { res, events, rawLines } = await runRoute();
  assert.equal(res.status, 200);
  const entry = events[0]!.years[0]!;
  assert.equal(entry.operation, 'preseason-maintenance');
  assert.equal(entry.result, 'success');

  const probe = await getAppState<{ firstGameDate: string | null }>('schedule-probe', String(year));
  assert.equal(
    probe?.value?.firstGameDate,
    `${year}-09-01T00:00:00.000Z`,
    'the probe re-derived firstGameDate from the committed schedule BEFORE presentation work'
  );
  const pEvents = presentationEvents(rawLines);
  assert.equal(pEvents.length, 1, 'presentation was still attempted');
  assert.equal(pEvents[0]!.media.reason, 'provider-fetch-failed');
});

// 5 — postseason-boundary success invokes presentation despite the settings
// exemption (gates closed gate ONLY ordinary canonical work, and presentation
// follows canonical success unconditionally).
test('a postseason-boundary success invokes presentation despite closed gates', async () => {
  await seedSeasonLeague(2020);
  await seedSchedule(2020, CRITICAL_KICKOFF);
  await setGlobalPause(true);
  await setDatasetAutoRefreshEnabled('schedule', false);
  await seedFreshVenueCatalog();
  stubProvider(
    { 2020: { regular: gameBody(2020), postseason: '[]' } },
    { media: (year) => mediaBody(year) }
  );
  const { events, rawLines } = await runRoute();
  assert.equal(events[0]!.years[0]!.operation, 'postseason-boundary');
  assert.equal(events[0]!.years[0]!.result, 'success');
  assert.deepEqual(presentationFetchLog, ['media:2020']);
  assert.equal(presentationEvents(rawLines)[0]!.trigger, 'weekly');
});

// 6/7/8/9/10/11 — every non-qualifying path performs NO presentation work.
test('non-qualifying weekly paths never invoke the presentation authority', async () => {
  // (6) season-transition-owner deferral: preseason league, unarmed probe.
  await setAppState('leagues', 'registry', [
    makeLeague('pre-2041', { state: 'preseason', year: 2041 }, 2041),
  ]);
  await seedSchedule(2041, ORDINARY_KICKOFF);
  stubProvider({});
  let run = await runRoute();
  assert.equal(run.events[0]!.years[0]!.reason, 'season-transition-owner');
  assert.equal(presentationFetchLog.length, 0);
  assert.equal(presentationEvents(run.rawLines).length, 0, 'no presentation event');

  // (7) closed Schedule gate.
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  resetScheduleRouteCacheForTests();
  await seedSeasonLeague(2031);
  await seedSchedule(2031, ORDINARY_KICKOFF);
  await setDatasetAutoRefreshEnabled('schedule', false);
  stubProvider({});
  run = await runRoute();
  assert.equal(run.events[0]!.years[0]!.reason, 'automation-paused-or-disabled');
  assert.equal(presentationFetchLog.length, 0);
  assert.equal(presentationEvents(run.rawLines).length, 0);

  // (8) settings store unavailable.
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  resetScheduleRouteCacheForTests();
  await seedSeasonLeague(2031);
  await seedSchedule(2031, ORDINARY_KICKOFF);
  __setAppStateReadFailureForTests(new Error('settings down'), 'provider-refresh-settings');
  stubProvider({});
  run = await runRoute();
  __setAppStateReadFailureForTests(null);
  assert.equal(run.events[0]!.years[0]!.reason, 'settings-unavailable');
  assert.equal(presentationFetchLog.length, 0);
  assert.equal(presentationEvents(run.rawLines).length, 0);

  // (9) canonical context unavailable (no prior-good schedule).
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  resetScheduleRouteCacheForTests();
  await seedSeasonLeague(2031);
  stubProvider({});
  run = await runRoute();
  assert.equal(run.events[0]!.years[0]!.reason, 'canonical-context-unavailable');
  assert.equal(presentationFetchLog.length, 0);
  assert.equal(presentationEvents(run.rawLines).length, 0);

  // (10) E1A failure (a partition transport failure).
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  resetScheduleRouteCacheForTests();
  await seedSeasonLeague(2031);
  await seedSchedule(2031, ORDINARY_KICKOFF);
  stubProvider({ 2031: { regular: gameBody(2031), postseason: 'throw' } });
  run = await runRoute();
  assert.equal(run.events[0]!.years[0]!.result, 'failure');
  assert.equal(presentationFetchLog.length, 0);
  assert.equal(presentationEvents(run.rawLines).length, 0);

  // (11a) an empty replacement over populated prior-good is an E1A failure —
  // no presentation. (A weekly E1A `empty-response` is unreachable by
  // construction: classification requires a populated prior entry, and an empty
  // provider result over it is `empty-replacement-rejected`; the reachable
  // empty-response no-op is covered on the season-transition route.)
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  resetScheduleRouteCacheForTests();
  await seedSeasonLeague(2031);
  await seedSchedule(2031, ORDINARY_KICKOFF);
  stubProvider({ 2031: { regular: '[]', postseason: '[]' } });
  run = await runRoute();
  assert.equal(run.events[0]!.years[0]!.reason, 'empty-replacement-rejected');
  assert.equal(presentationFetchLog.length, 0);
  assert.equal(presentationEvents(run.rawLines).length, 0);

  // (11b) stale observation (prior durable entry observed in the future).
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  resetScheduleRouteCacheForTests();
  await seedSeasonLeague(2031);
  await seedSchedule(2031, ORDINARY_KICKOFF, { at: Date.now() + 1_000_000_000 });
  stubProvider({ 2031: { regular: gameBody(2031), postseason: '[]' } });
  run = await runRoute();
  assert.equal(run.events[0]!.years[0]!.reason, 'stale-observation');
  assert.equal(presentationFetchLog.length, 0);
  assert.equal(presentationEvents(run.rawLines).length, 0);

  // (11c) refresh-in-progress (E1A lease contention).
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  resetScheduleRouteCacheForTests();
  await seedSeasonLeague(2031);
  await seedSchedule(2031, ORDINARY_KICKOFF);
  const lease = await acquireScheduleRefreshLease({ year: 2031, now: Date.now() });
  assert.ok(lease.acquired);
  stubProvider({});
  run = await runRoute();
  assert.equal(run.events[0]!.years[0]!.reason, 'refresh-in-progress');
  assert.equal(presentationFetchLog.length, 0);
  assert.equal(presentationEvents(run.rawLines).length, 0);
});

// 12 + 16 — mixed multi-year: presentation runs only for qualifying successes,
// once each, ascending; the first year's committed venue catalog makes the
// later year's venue part fresh-cache (no duplicate /venues spend).
test('mixed multi-year runs invoke presentation only for qualifying years, venues once', async () => {
  await seedSeasonLeague(2030);
  await seedSeasonLeague(2031);
  await seedSeasonLeague(2032);
  await seedSchedule(2030, ORDINARY_KICKOFF);
  await seedSchedule(2031, ORDINARY_KICKOFF);
  await seedSchedule(2032, ORDINARY_KICKOFF);
  // 2030 + 2032 succeed; 2031 fails its postseason partition. NO venue catalog
  // seeded — the first qualifying year fetches /venues; the later year sees the
  // freshly committed durable catalog and stays fresh-cache.
  stubProvider(
    {
      2030: { regular: gameBody(2030), postseason: '[]' },
      2031: { regular: gameBody(2031), postseason: 'throw' },
      2032: { regular: gameBody(2032), postseason: '[]' },
    },
    { media: (year) => mediaBody(year), venues: () => VENUES_BODY }
  );
  const { rawLines } = await runRoute();
  assert.deepEqual(
    presentationFetchLog,
    ['media:2030', 'venues', 'media:2032'],
    'qualifying years only, ascending, one venue fetch total'
  );
  const pEvents = presentationEvents(rawLines);
  assert.deepEqual(
    pEvents.map((event) => `${event.year}:${event.trigger}`),
    ['2030:weekly', '2032:weekly']
  );
  assert.equal(pEvents[1]!.venues.reason, 'fresh-cache');
});

// 13 + 34 — a presentation failure leaves canonical truth byte-identical and
// never contaminates the canonical schedule provider status.
test('a presentation failure changes nothing about canonical weekly results', async () => {
  await seedSeasonLeague(2031);
  await seedSchedule(2031, ORDINARY_KICKOFF);
  await seedFreshVenueCatalog();
  stubProvider({ 2031: { regular: gameBody(2031), postseason: '[]' } }, { media: () => 'throw' });
  const { res, events, rawLines } = await runRoute();
  const body = (await res.json()) as { result: string; reason: string; years: unknown[] };
  assert.equal(res.status, 200);
  assert.equal(body.result, 'success', 'aggregate result unchanged');
  assert.equal(body.reason, 'year-results');
  const entry = events[0]!.years[0]!;
  assert.equal(entry.result, 'success');
  assert.equal(entry.reason, 'written-clean');
  assert.equal(entry.rowsCommitted, 1, 'canonical year entry unchanged');
  assert.equal(events.length, 1, 'exactly one schedule-refresh-cron event');

  const pEvents = presentationEvents(rawLines);
  assert.equal(pEvents[0]!.media.reason, 'provider-fetch-failed');

  const canonicalStatus = await getProviderRefreshStatus('schedule', yearScope(2031));
  assert.equal(
    canonicalStatus.latestAttemptOutcome,
    'succeeded',
    'the canonical year scope never reflects presentation outcomes'
  );
});

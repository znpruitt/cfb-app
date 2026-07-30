import test from 'node:test';
import assert from 'node:assert/strict';

import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateReadFailureForTests,
  setAppState,
} from '../../server/appStateStore.ts';
import type { ScheduleItem } from '../cfbdSchedule.ts';
import {
  scheduleMediaStateKey,
  SCHEDULE_MEDIA_STATE_SCOPE,
  VENUE_CATALOG_STATE_KEY,
  VENUE_CATALOG_STATE_SCOPE,
} from '../schedulePresentation.ts';
import {
  __resetSchedulePresentationMemoForTests,
  enrichScheduleItemsWithPresentation,
  SCHEDULE_PRESENTATION_MEMO_TTL_MS,
} from '../schedulePresentationJoin.ts';

const YEAR = 2027;
const NOW = Date.parse('2027-08-01T12:00:00Z');

function scheduleItem(overrides: Partial<ScheduleItem> = {}): ScheduleItem {
  return {
    id: '101',
    week: 1,
    startDate: '2027-08-28T23:00:00Z',
    neutralSite: false,
    conferenceGame: false,
    homeTeam: 'Texas',
    awayTeam: 'Rice',
    homeId: 251,
    awayId: 242,
    homeConference: 'SEC',
    awayConference: 'American',
    status: 'scheduled',
    ...overrides,
  };
}

async function seedMedia(): Promise<void> {
  await setAppState(SCHEDULE_MEDIA_STATE_SCOPE, scheduleMediaStateKey(YEAR), {
    at: NOW - 1000,
    items: [
      { gameId: '101', mediaType: 'tv', outlet: 'ESPN' },
      { gameId: '101', mediaType: 'radio', outlet: 'ESPN Radio' },
      { gameId: '202', mediaType: 'tv', outlet: 'FOX' },
    ],
  });
}

async function seedVenues(): Promise<void> {
  await setAppState(VENUE_CATALOG_STATE_SCOPE, VENUE_CATALOG_STATE_KEY, {
    at: NOW - 1000,
    items: [
      {
        id: 3504,
        name: 'Darrell K Royal–Texas Memorial Stadium',
        city: 'Austin',
        state: 'TX',
        countryCode: 'US',
        timezone: 'America/Chicago',
        capacity: 100119,
        grass: false,
        dome: false,
      },
    ],
  });
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  __resetSchedulePresentationMemoForTests();
});

test('media joins by exact item.id and venue by exact item.venueId', async () => {
  await seedMedia();
  await seedVenues();
  const items = [
    scheduleItem({ id: '101', venueId: 3504, venue: 'DKR' }),
    scheduleItem({ id: '999', venueId: 42 }), // no media, no catalog match
  ];
  const enriched = await enrichScheduleItemsWithPresentation({ year: YEAR, items, now: NOW });

  assert.equal(enriched[0]!.media?.length, 2);
  assert.deepEqual(enriched[0]!.media?.[0], { gameId: '101', mediaType: 'tv', outlet: 'ESPN' });
  assert.deepEqual(enriched[0]!.venue, {
    stadium: 'Darrell K Royal–Texas Memorial Stadium',
    city: 'Austin',
    state: 'TX',
    country: 'US',
  });
  // The unmatched row is returned untouched — the SAME reference, proving the
  // join never mutates canonical rows.
  assert.equal(enriched[1], items[1]);
  assert.equal(enriched[1]!.media, undefined);
});

test('venue enrichment prefers nonblank catalog values and preserves existing fields for missing ones', async () => {
  await setAppState(VENUE_CATALOG_STATE_SCOPE, VENUE_CATALOG_STATE_KEY, {
    at: NOW - 1000,
    items: [
      {
        id: 7,
        name: 'Catalog Stadium',
        city: null, // catalog has no city — the schedule row's city must survive
        state: null,
        countryCode: null,
        timezone: null,
        capacity: null,
        grass: null,
        dome: null,
      },
    ],
  });
  const items = [
    scheduleItem({
      venueId: 7,
      venue: { stadium: 'Row Stadium', city: 'Row City', state: 'RS', country: null },
    }),
  ];
  const enriched = await enrichScheduleItemsWithPresentation({ year: YEAR, items, now: NOW });
  assert.deepEqual(enriched[0]!.venue, {
    stadium: 'Catalog Stadium',
    city: 'Row City',
    state: 'RS',
    country: null,
  });
});

test('missing media and venue caches yield ordinary base rows', async () => {
  const items = [scheduleItem({ venueId: 3504 })];
  const enriched = await enrichScheduleItemsWithPresentation({ year: YEAR, items, now: NOW });
  assert.equal(enriched[0], items[0], 'identical reference — no fabricated overlay');
});

test('a genuine presentation-cache read failure serves base rows without throwing', async () => {
  await seedMedia();
  __resetSchedulePresentationMemoForTests();
  __setAppStateReadFailureForTests(new Error('read boom'), SCHEDULE_MEDIA_STATE_SCOPE);
  const warns: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    if (typeof args[0] === 'string') warns.push(args[0]);
  };
  try {
    const items = [scheduleItem()];
    const enriched = await enrichScheduleItemsWithPresentation({ year: YEAR, items, now: NOW });
    assert.equal(enriched[0], items[0], 'base row served');
  } finally {
    console.warn = originalWarn;
    __setAppStateReadFailureForTests(null);
  }
  assert.ok(
    warns.some((line) => line.includes('media cache read failed')),
    'one generic diagnostic'
  );
  assert.ok(
    warns.every((line) => !line.includes('read boom')),
    'no raw error detail in the diagnostic'
  );
});

test('the input items and durable caches are never mutated by enrichment', async () => {
  await seedMedia();
  await seedVenues();
  const original = scheduleItem({ id: '101', venueId: 3504, venue: 'DKR' });
  const snapshot = JSON.parse(JSON.stringify(original));
  const enriched = await enrichScheduleItemsWithPresentation({
    year: YEAR,
    items: [original],
    now: NOW,
  });
  assert.notEqual(enriched[0], original, 'an enriched row is a NEW object');
  assert.deepEqual(original, snapshot, 'the input row is untouched');
});

test('cross-instance durable updates become visible after the bounded memo expires', async () => {
  await seedMedia();
  const items = [scheduleItem()];
  const first = await enrichScheduleItemsWithPresentation({ year: YEAR, items, now: NOW });
  assert.equal(first[0]!.media?.[0]?.outlet, 'ESPN');

  // Another instance commits a fresher durable entry; our memo still holds the
  // old rows within the TTL...
  await setAppState(SCHEDULE_MEDIA_STATE_SCOPE, scheduleMediaStateKey(YEAR), {
    at: NOW + 1000,
    items: [{ gameId: '101', mediaType: 'tv', outlet: 'FOX' }],
  });
  const withinTtl = await enrichScheduleItemsWithPresentation({
    year: YEAR,
    items,
    now: NOW + SCHEDULE_PRESENTATION_MEMO_TTL_MS - 1,
  });
  assert.equal(withinTtl[0]!.media?.[0]?.outlet, 'ESPN', 'bounded staleness inside the memo');

  // ...and the fresher entry wins once the memo expires.
  const afterTtl = await enrichScheduleItemsWithPresentation({
    year: YEAR,
    items,
    now: NOW + SCHEDULE_PRESENTATION_MEMO_TTL_MS + 1,
  });
  assert.equal(afterTtl[0]!.media?.[0]?.outlet, 'FOX', 'durable update visible after the memo');
});

test('empty input returns empty without any cache read', async () => {
  __setAppStateReadFailureForTests(new Error('must not read'), SCHEDULE_MEDIA_STATE_SCOPE);
  try {
    const enriched = await enrichScheduleItemsWithPresentation({ year: YEAR, items: [], now: NOW });
    assert.deepEqual(enriched, []);
  } finally {
    __setAppStateReadFailureForTests(null);
  }
});

test('a raced durable read cannot roll the memo back below a fresher published entry', async () => {
  const { publishScheduleMediaMemo } = await import('../schedulePresentationJoin.ts');
  // Durable holds the OLDER entry (a read that began before a commit); the
  // fresher committed entry has already been published into the memo.
  await setAppState(SCHEDULE_MEDIA_STATE_SCOPE, scheduleMediaStateKey(YEAR), {
    at: NOW - 60_000,
    items: [{ gameId: '101', mediaType: 'tv', outlet: 'Older TV' }],
  });
  publishScheduleMediaMemo(YEAR, {
    at: NOW,
    items: [{ gameId: '101', mediaType: 'tv', outlet: 'Fresher TV' }],
  });

  const items = [scheduleItem()];
  const enriched = await enrichScheduleItemsWithPresentation({
    year: YEAR,
    items,
    now: NOW,
    forceDurable: true,
  });
  assert.equal(
    enriched[0]!.media?.[0]?.outlet,
    'Fresher TV',
    'the guarded loader keeps the fresher published entry'
  );
});

test('a stale durable ABSENCE cannot roll the memo back below a fresher published entry', async () => {
  const { publishScheduleMediaMemo } = await import('../schedulePresentationJoin.ts');
  // Durable is ABSENT (a read that began before the first commit), while the
  // fresher committed entry has already been published into the memo — the
  // published entry must win (these caches have no deletion path).
  publishScheduleMediaMemo(YEAR, {
    at: NOW,
    items: [{ gameId: '101', mediaType: 'tv', outlet: 'Fresher TV' }],
  });

  const enriched = await enrichScheduleItemsWithPresentation({
    year: YEAR,
    items: [scheduleItem()],
    now: NOW,
    forceDurable: true,
  });
  assert.equal(
    enriched[0]!.media?.[0]?.outlet,
    'Fresher TV',
    'pre-commit absence never overwrites a concurrently published entry'
  );
});

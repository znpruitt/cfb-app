import assert from 'node:assert/strict';
import test from 'node:test';

import { attachOddsEventsToSchedule } from '../oddsAttachment.ts';
import { createTeamIdentityResolver } from '../teamIdentity.ts';

test('odds attachment uses centralized resolver equality for aliases and casing', () => {
  const resolver = createTeamIdentityResolver({
    aliasMap: { 'wash st': 'Washington State' },
    teams: [
      { school: 'Washington State', level: 'FBS' },
      { school: 'Boise State', level: 'FBS' },
    ],
  });

  const attached = attachOddsEventsToSchedule({
    games: [
      {
        key: 'wazzu-boise',
        week: 1,
        canHome: 'Washington State',
        canAway: 'Boise State',
        csvHome: 'Washington State',
        csvAway: 'Boise State',
      },
    ],
    events: [
      {
        homeTeam: 'wash st',
        awayTeam: 'BOISE STATE',
      },
    ],
    resolver,
  });

  assert.equal(attached.length, 1);
  assert.equal(attached[0]?.gameKey, 'wazzu-boise');
});

test('odds attachment keeps distinct teams from cross-matching', () => {
  const resolver = createTeamIdentityResolver({
    aliasMap: {},
    teams: [
      { school: 'Washington State', level: 'FBS' },
      { school: 'Washington', level: 'FBS' },
      { school: 'Boise State', level: 'FBS' },
      { school: 'Boise', level: 'OTHER' },
    ],
  });

  const attached = attachOddsEventsToSchedule({
    games: [
      {
        key: 'wazzu-boise-state',
        week: 1,
        canHome: 'Washington State',
        canAway: 'Boise State',
        csvHome: 'Washington State',
        csvAway: 'Boise State',
      },
    ],
    events: [
      {
        homeTeam: 'Washington',
        awayTeam: 'Boise',
      },
    ],
    resolver,
  });

  assert.equal(attached.length, 0);
});

// ---------------------------------------------------------------------------
// PLATFORM-030 — odds attachment regression coverage.
//
// These tests document the CURRENT pair-only matching behavior and lock the
// intended schedule-canonical invariants. Tests marked `skip` capture behavior
// that is KNOWN UNSAFE until PLATFORM-031-EVENT-DATE-AWARE-ATTACHMENT-v1 (event-centric / date-aware odds
// attachment). The current OddsAttachmentEventBase has no date/commence-time,
// so pair-only matching cannot disambiguate repeated meetings of the same pair.
// ---------------------------------------------------------------------------

function rematchResolver() {
  return createTeamIdentityResolver({
    aliasMap: {},
    teams: [
      { school: 'Georgia', level: 'FBS' },
      { school: 'Texas', level: 'FBS' },
      { school: 'Alabama', level: 'FBS' },
    ],
  });
}

function scheduleGame(key: string, week: number, canHome: string, canAway: string) {
  return { key, week, canHome, canAway, csvHome: canHome, csvAway: canAway };
}

test('odds attachment ignores upstream events with no canonical schedule game', () => {
  const resolver = rematchResolver();
  const attached = attachOddsEventsToSchedule({
    games: [scheduleGame('uga-tex', 5, 'Georgia', 'Texas')],
    events: [
      { homeTeam: 'Georgia', awayTeam: 'Texas' }, // matches the scheduled game
      { homeTeam: 'Alabama', awayTeam: 'Texas' }, // no scheduled game -> must not create an entry
    ],
    resolver,
  });
  assert.equal(attached.length, 1);
  assert.equal(attached[0]?.gameKey, 'uga-tex');
});

test('odds attachment never emits a gameKey absent from the canonical schedule', () => {
  const resolver = rematchResolver();
  const games = [scheduleGame('uga-tex', 5, 'Georgia', 'Texas')];
  const attached = attachOddsEventsToSchedule({
    games,
    events: [{ homeTeam: 'Alabama', awayTeam: 'Georgia' }], // unscheduled pair
    resolver,
  });
  const scheduleKeys = new Set(games.map((g) => g.key));
  for (const a of attached) assert.ok(scheduleKeys.has(a.gameKey));
  assert.equal(attached.length, 0);
});

test('DOCUMENTS CURRENT (unsafe): one odds event fans out to BOTH same-pair canonical games', () => {
  // A regular-season meeting and a postseason/championship rematch share the same
  // unordered pair. Pair-only matching reuses the single upstream event for every
  // same-pair game. KNOWN UNSAFE until PLATFORM-031-EVENT-DATE-AWARE-ATTACHMENT-v1 date/commence-time matching.
  const resolver = rematchResolver();
  const attached = attachOddsEventsToSchedule({
    games: [
      scheduleGame('reg-uga-tex', 5, 'Georgia', 'Texas'),
      scheduleGame('ccg-uga-tex', 16, 'Texas', 'Georgia'),
    ],
    events: [{ homeTeam: 'Georgia', awayTeam: 'Texas' }],
    resolver,
  });
  // Current behavior: the single event is attached to both canonical games.
  assert.equal(attached.length, 2);
  assert.deepEqual(
    new Set(attached.map((a) => a.gameKey)),
    new Set(['reg-uga-tex', 'ccg-uga-tex'])
  );
  assert.equal(attached[0]?.event, attached[1]?.event);
});

test('DOCUMENTS CURRENT: duplicate provider events for one pair keep a single attachment (first wins)', () => {
  // One scheduled game, two upstream events for the same pair (stale duplicate or a
  // second feed). Current behavior keeps a single canonical attachment and silently
  // uses the FIRST event; the duplicate is dropped, not collapsed into the game.
  const resolver = rematchResolver();
  const first = { homeTeam: 'Georgia', awayTeam: 'Texas' };
  const second = { homeTeam: 'Texas', awayTeam: 'Georgia' };
  const attached = attachOddsEventsToSchedule({
    games: [scheduleGame('uga-tex', 5, 'Georgia', 'Texas')],
    events: [first, second],
    resolver,
  });
  assert.equal(attached.length, 1);
  assert.equal(attached[0]?.event, first); // arbitrary first-wins among duplicates
});

// ---------------------------------------------------------------------------
// PLATFORM-031-EVENT-DATE-AWARE-ATTACHMENT-v1 executable contracts (skipped).
//
// These call the real attachOddsEventsToSchedule with dated rematch/duplicate
// fixtures and assert the intended date-aware gameKey mappings. They fail under
// today's pair-only implementation (which ignores commence time and fans out /
// first-wins), so they remain `skip` until PLATFORM-031 makes the schedule game
// + odds event shapes carry a date/commence time and attachment becomes
// date-aware. `attachOddsEventsToSchedule` is generic over the event type, so the
// wider DatedOddsEvent shape is already accepted at the call site.
// ---------------------------------------------------------------------------

type DatedScheduleGame = ReturnType<typeof scheduleGame> & { date: string };
type DatedOddsEvent = { homeTeam: string; awayTeam: string; commenceTime: string };

function datedGame(
  key: string,
  week: number,
  canHome: string,
  canAway: string,
  date: string
): DatedScheduleGame {
  return { ...scheduleGame(key, week, canHome, canAway), date };
}

test.skip('INTENDED (PLATFORM-031-EVENT-DATE-AWARE-ATTACHMENT-v1): a dated odds event attaches to exactly the date-aligned canonical game', () => {
  const resolver = rematchResolver();
  const games: DatedScheduleGame[] = [
    datedGame('reg-uga-tex', 5, 'Georgia', 'Texas', '2025-09-06T23:30:00Z'),
    datedGame('ccg-uga-tex', 16, 'Texas', 'Georgia', '2025-12-06T20:00:00Z'),
  ];
  // A single December event must map only to the December championship game.
  const events: DatedOddsEvent[] = [
    { homeTeam: 'Texas', awayTeam: 'Georgia', commenceTime: '2025-12-06T20:00:00Z' },
  ];

  const attached = attachOddsEventsToSchedule({ games, events, resolver });

  assert.equal(attached.length, 1, 'no fan-out across same-pair games');
  assert.equal(attached[0]?.gameKey, 'ccg-uga-tex');
});

test.skip('INTENDED (PLATFORM-031-EVENT-DATE-AWARE-ATTACHMENT-v1): same-pair rematches on different dates each attach to their own canonical game', () => {
  const resolver = rematchResolver();
  const games: DatedScheduleGame[] = [
    datedGame('reg-uga-tex', 5, 'Georgia', 'Texas', '2025-09-06T23:30:00Z'),
    datedGame('ccg-uga-tex', 16, 'Texas', 'Georgia', '2025-12-06T20:00:00Z'),
  ];
  const events: DatedOddsEvent[] = [
    { homeTeam: 'Georgia', awayTeam: 'Texas', commenceTime: '2025-09-06T23:30:00Z' },
    { homeTeam: 'Texas', awayTeam: 'Georgia', commenceTime: '2025-12-06T20:00:00Z' },
  ];

  const attached = attachOddsEventsToSchedule({ games, events, resolver });
  const commenceByGame = new Map(attached.map((a) => [a.gameKey, a.event.commenceTime]));

  assert.equal(attached.length, 2);
  assert.equal(commenceByGame.get('reg-uga-tex'), '2025-09-06T23:30:00Z');
  assert.equal(commenceByGame.get('ccg-uga-tex'), '2025-12-06T20:00:00Z');
});

test.skip('INTENDED (PLATFORM-031-EVENT-DATE-AWARE-ATTACHMENT-v1): duplicate provider events for a pair attach by date, not arbitrary first-won', () => {
  const resolver = rematchResolver();
  const games: DatedScheduleGame[] = [
    datedGame('uga-tex', 5, 'Georgia', 'Texas', '2025-09-06T23:30:00Z'),
  ];
  // The stale/wrong-dated duplicate is listed FIRST; date-aware attachment must
  // still pick the event whose commence time aligns with the scheduled game.
  const staleDuplicate: DatedOddsEvent = {
    homeTeam: 'Texas',
    awayTeam: 'Georgia',
    commenceTime: '2025-08-30T23:30:00Z',
  };
  const dateAligned: DatedOddsEvent = {
    homeTeam: 'Georgia',
    awayTeam: 'Texas',
    commenceTime: '2025-09-06T23:30:00Z',
  };

  const attached = attachOddsEventsToSchedule({
    games,
    events: [staleDuplicate, dateAligned],
    resolver,
  });

  assert.equal(attached.length, 1);
  assert.equal(attached[0]?.gameKey, 'uga-tex');
  assert.equal(attached[0]?.event, dateAligned); // date match wins over first-listed
});

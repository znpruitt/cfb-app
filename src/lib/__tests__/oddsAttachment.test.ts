import assert from 'node:assert/strict';
import test from 'node:test';

import { attachOddsEventsToSchedule, type OddsAttachmentDiagnostic } from '../oddsAttachment.ts';
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
// PLATFORM-030 / PLATFORM-031 — odds attachment regression coverage.
//
// PLATFORM-031 replaced pair-only fan-out with event-centric, date-aware
// attachment. These tests lock the schedule-canonical invariants: an event
// attaches to at most one canonical game, never fans out across same-pair games,
// disambiguates repeated meetings by commence time, and refuses to guess when a
// pair is ambiguous or a date does not align.
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

test('an undated event for an ambiguous same-pair slate attaches to no game (no fan-out)', () => {
  // A regular-season meeting and a championship rematch share the same unordered
  // pair. With no commence time to disambiguate, attachment refuses to guess
  // rather than fanning the single event out across both canonical games.
  const resolver = rematchResolver();
  const attached = attachOddsEventsToSchedule({
    games: [
      scheduleGame('reg-uga-tex', 5, 'Georgia', 'Texas'),
      scheduleGame('ccg-uga-tex', 16, 'Texas', 'Georgia'),
    ],
    events: [{ homeTeam: 'Georgia', awayTeam: 'Texas' }],
    resolver,
  });
  assert.equal(attached.length, 0);
});

test('a single canonical game still attaches an undated event (common case)', () => {
  // When the pair is unambiguous (one canonical game) a dateless event still
  // attaches — the safety guard only blocks genuinely ambiguous same-pair slates.
  const resolver = rematchResolver();
  const attached = attachOddsEventsToSchedule({
    games: [scheduleGame('uga-tex', 5, 'Georgia', 'Texas')],
    events: [{ homeTeam: 'Georgia', awayTeam: 'Texas' }],
    resolver,
  });
  assert.equal(attached.length, 1);
  assert.equal(attached[0]?.gameKey, 'uga-tex');
});

test('duplicate provider events for one game attach once (one-to-one, no overwrite)', () => {
  // One scheduled game, two upstream events for the same pair (stale duplicate or a
  // second feed). The first claims the game; the duplicate is skipped rather than
  // overwriting it, so exactly one attachment survives.
  const resolver = rematchResolver();
  const first = { homeTeam: 'Georgia', awayTeam: 'Texas' };
  const second = { homeTeam: 'Texas', awayTeam: 'Georgia' };
  const attached = attachOddsEventsToSchedule({
    games: [scheduleGame('uga-tex', 5, 'Georgia', 'Texas')],
    events: [first, second],
    resolver,
  });
  assert.equal(attached.length, 1);
  assert.equal(attached[0]?.event, first);
});

// ---------------------------------------------------------------------------
// PLATFORM-031-EVENT-DATE-AWARE-ATTACHMENT-v1 date-aware contracts.
//
// These call attachOddsEventsToSchedule with dated rematch/duplicate fixtures and
// assert the date-aware gameKey mappings now implemented by PLATFORM-031. The
// schedule game carries `date` and the odds event carries `commenceTime`;
// `attachOddsEventsToSchedule` is generic over the event type, so the wider
// DatedOddsEvent shape is accepted at the call site.
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

test('PLATFORM-031-EVENT-DATE-AWARE-ATTACHMENT-v1 — a dated odds event attaches to exactly the date-aligned canonical game', () => {
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

test('PLATFORM-031-EVENT-DATE-AWARE-ATTACHMENT-v1 — same-pair rematches on different dates each attach to their own canonical game', () => {
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

test('PLATFORM-031-EVENT-DATE-AWARE-ATTACHMENT-v1 — duplicate provider events for a pair attach by date, not arbitrary first-won', () => {
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

test('PLATFORM-031-EVENT-DATE-AWARE-ATTACHMENT-v1 — reports reason codes for unmatched, ambiguous, and date-mismatch events', () => {
  const resolver = rematchResolver();
  const games: DatedScheduleGame[] = [
    datedGame('reg-uga-tex', 5, 'Georgia', 'Texas', '2025-09-06T23:30:00Z'),
    datedGame('ccg-uga-tex', 16, 'Texas', 'Georgia', '2025-12-06T20:00:00Z'),
  ];
  const diagnostics: OddsAttachmentDiagnostic[] = [];
  const events = [
    { homeTeam: 'Alabama', awayTeam: 'Texas' }, // no scheduled pair -> unmatched_pair
    { homeTeam: 'Georgia', awayTeam: 'Texas' }, // two same-pair games, no date -> ambiguous_pair
    // dated but aligns to neither scheduled game -> date_mismatch
    { homeTeam: 'Georgia', awayTeam: 'Texas', commenceTime: '2025-10-01T00:00:00Z' },
  ];

  const attached = attachOddsEventsToSchedule({ games, events, resolver, diagnostics });

  assert.equal(attached.length, 0);
  assert.deepEqual(
    diagnostics.map((d) => d.reason),
    ['unmatched_pair', 'ambiguous_pair', 'date_mismatch']
  );
});

test('PLATFORM-031-EVENT-DATE-AWARE-ATTACHMENT-v1 — reports consumed_or_duplicate for a second event on a claimed game', () => {
  const resolver = rematchResolver();
  const games: DatedScheduleGame[] = [
    datedGame('uga-tex', 5, 'Georgia', 'Texas', '2025-09-06T23:30:00Z'),
  ];
  const diagnostics: OddsAttachmentDiagnostic[] = [];
  const events: DatedOddsEvent[] = [
    { homeTeam: 'Georgia', awayTeam: 'Texas', commenceTime: '2025-09-06T23:30:00Z' },
    { homeTeam: 'Texas', awayTeam: 'Georgia', commenceTime: '2025-09-06T23:30:00Z' },
  ];

  const attached = attachOddsEventsToSchedule({ games, events, resolver, diagnostics });

  assert.equal(attached.length, 1);
  assert.equal(attached[0]?.gameKey, 'uga-tex');
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.reason, 'consumed_or_duplicate');
  assert.deepEqual(diagnostics[0]?.candidateGameKeys, ['uga-tex']);
});

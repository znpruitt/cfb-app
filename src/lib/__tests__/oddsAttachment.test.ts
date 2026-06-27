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
// ODDS-001 — odds attachment regression coverage.
//
// These tests document the CURRENT pair-only matching behavior and lock the
// intended schedule-canonical invariants. Tests marked `skip` capture behavior
// that is KNOWN UNSAFE until ODDS-002-EVENT-DATE-AWARE-ATTACHMENT-v1 (event-centric / date-aware odds
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
  // same-pair game. KNOWN UNSAFE until ODDS-002-EVENT-DATE-AWARE-ATTACHMENT-v1 date/commence-time matching.
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

test.skip('INTENDED (ODDS-002-EVENT-DATE-AWARE-ATTACHMENT-v1): one odds event attaches to at most one canonical game', () => {
  // After event-centric/date-aware attachment, a single upstream odds event for a
  // repeated pair must resolve to exactly one canonical game (or none if it cannot
  // be disambiguated), never silently fan out to every same-pair game.
  const resolver = rematchResolver();
  const attached = attachOddsEventsToSchedule({
    games: [
      scheduleGame('reg-uga-tex', 5, 'Georgia', 'Texas'),
      scheduleGame('ccg-uga-tex', 16, 'Texas', 'Georgia'),
    ],
    events: [{ homeTeam: 'Georgia', awayTeam: 'Texas' }],
    resolver,
  });
  assert.ok(attached.length <= 1);
});

test.skip('INTENDED (ODDS-002-EVENT-DATE-AWARE-ATTACHMENT-v1): same-pair rematches on different dates disambiguate by commence time', () => {
  // Pair-only matching cannot distinguish a regular-season meeting from a later
  // rematch (CFP repeat, conference championship). ODDS-002-EVENT-DATE-AWARE-ATTACHMENT-v1 must add a
  // commence_time/date to the odds event and attach each event only to the
  // date-aligned canonical game. OddsAttachmentEventBase has no date field today,
  // so this invariant is unattainable until the event shape is extended.
  assert.ok(
    false,
    'requires ODDS-002-EVENT-DATE-AWARE-ATTACHMENT-v1 event-centric/date-aware odds attachment'
  );
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

test.skip('INTENDED (ODDS-002-EVENT-DATE-AWARE-ATTACHMENT-v1): duplicate provider events for a pair are disambiguated or flagged, not arbitrarily first-won', () => {
  // Arbitrary first-wins can attach the wrong line when duplicate provider events
  // exist (doubleheaders, stale feeds). ODDS-002-EVENT-DATE-AWARE-ATTACHMENT-v1 should select by date/event id
  // or flag ambiguity instead of silently taking events[0].
  assert.ok(
    false,
    'requires ODDS-002-EVENT-DATE-AWARE-ATTACHMENT-v1 date/event-id disambiguation for duplicate provider events'
  );
});

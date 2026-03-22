import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyScheduleRow } from '../postseason-classify.ts';

test('classifyScheduleRow prefers normalized playoff metadata for CFP quarterfinal bowls', () => {
  const classified = classifyScheduleRow(
    {
      id: 'g1',
      week: 17,
      startDate: '2025-12-31T01:00:00Z',
      neutralSite: true,
      neutralSiteDisplay: 'vs',
      conferenceGame: false,
      homeTeam: 'TBD',
      awayTeam: 'TBD',
      homeConference: '',
      awayConference: '',
      status: 'scheduled',
      seasonType: 'postseason',
      gamePhase: 'postseason',
      postseasonSubtype: 'playoff',
      playoffRound: 'quarterfinal',
      bowlName: 'Rose Bowl',
      eventKey: 'cfp-quarterfinal-rose-bowl',
      label: 'CFP Quarterfinal at Rose Bowl',
    },
    2025
  );

  assert.equal(classified.kind, 'postseason_placeholder');
  if (classified.kind === 'postseason_placeholder') {
    assert.equal(classified.stage, 'playoff');
    assert.equal(classified.playoffRound, 'quarterfinal');
    assert.equal(classified.eventId, '2025-cfp-quarterfinal-rose-bowl');
  }
});

test('classifyScheduleRow keeps conference championship metadata in regular-week context', () => {
  const classified = classifyScheduleRow(
    {
      id: 'g2',
      week: 15,
      startDate: '2025-12-06T20:00:00Z',
      neutralSite: true,
      conferenceGame: true,
      homeTeam: 'Texas',
      awayTeam: 'Georgia',
      homeConference: 'SEC',
      awayConference: 'SEC',
      status: 'scheduled',
      seasonType: 'regular',
      gamePhase: 'conference_championship',
      regularSubtype: 'conference_championship',
      conferenceChampionshipConference: 'SEC',
      eventKey: 'sec-championship',
      label: 'SEC Championship',
    },
    2025
  );

  assert.deepEqual(classified, { kind: 'regular_game' });
});

test('classifyScheduleRow preserves venue-only bowl markers for object venues', () => {
  const classified = classifyScheduleRow(
    {
      id: 'venue-object-bowl',
      week: 17,
      startDate: null,
      neutralSite: true,
      conferenceGame: false,
      homeTeam: 'TBD',
      awayTeam: 'TBD',
      homeConference: '',
      awayConference: '',
      status: 'scheduled',
      seasonType: 'postseason',
      label: '',
      notes: '',
      venue: { stadium: 'Rose Bowl', city: 'Pasadena', state: 'CA', country: 'USA' },
    },
    2025
  );

  assert.equal(classified.kind, 'postseason_placeholder');
  if (classified.kind === 'postseason_placeholder') {
    assert.equal(classified.stage, 'bowl');
    assert.equal(classified.eventKey, 'rose-bowl');
  }
});

test('classifyScheduleRow still recognizes venue-only bowl markers for string and location-only venues', () => {
  const stringVenue = classifyScheduleRow(
    {
      id: 'venue-string-bowl',
      week: 17,
      startDate: null,
      neutralSite: true,
      conferenceGame: false,
      homeTeam: 'TBD',
      awayTeam: 'TBD',
      homeConference: '',
      awayConference: '',
      status: 'scheduled',
      seasonType: 'postseason',
      label: '',
      notes: '',
      venue: 'Rose Bowl',
    },
    2025
  );

  const locationOnlyVenue = classifyScheduleRow(
    {
      id: 'venue-location-only',
      week: 17,
      startDate: null,
      neutralSite: true,
      conferenceGame: false,
      homeTeam: 'Rose Bowl',
      awayTeam: 'TBD',
      homeConference: '',
      awayConference: '',
      status: 'scheduled',
      seasonType: 'postseason',
      label: '',
      notes: '',
      venue: { stadium: null, city: 'Pasadena', state: 'CA', country: 'USA' },
    },
    2025
  );

  assert.equal(stringVenue.kind, 'postseason_placeholder');
  assert.equal(locationOnlyVenue.kind, 'postseason_placeholder');
});

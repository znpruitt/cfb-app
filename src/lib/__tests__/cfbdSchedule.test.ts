import test from 'node:test';
import assert from 'node:assert/strict';

import { mapCfbdScheduleGame } from '../schedule/cfbdSchedule';

test('mapCfbdScheduleGame maps valid snake_case payload', () => {
  const result = mapCfbdScheduleGame(
    {
      id: 123,
      week: 1,
      home_team: 'Texas',
      away_team: 'Rice',
      start_date: '2025-08-30T16:00:00.000Z',
    },
    'regular'
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.item.id, '123');
    assert.equal(result.item.week, 1);
    assert.equal(result.item.homeTeam, 'Texas');
    assert.equal(result.item.awayTeam, 'Rice');
    assert.equal(result.item.startDate, '2025-08-30T16:00:00.000Z');
    assert.equal(result.item.seasonType, 'regular');
    assert.equal(result.item.gamePhase, 'regular');
  }
});

test('mapCfbdScheduleGame maps CFP quarterfinal at Orange Bowl', () => {
  const result = mapCfbdScheduleGame(
    {
      id: 401,
      week: 17,
      home_team: 'TBD',
      away_team: 'TBD',
      neutral_site: true,
      notes: 'College Football Playoff Quarterfinal at the Capital One Orange Bowl',
      name: 'CFP Quarterfinal',
      venue: 'Hard Rock Stadium',
    },
    'postseason'
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.item.postseasonSubtype, 'playoff');
    assert.equal(result.item.playoffRound, 'quarterfinal');
    assert.equal(result.item.bowlName, 'Capital One Orange Bowl');
    assert.equal(result.item.eventKey, 'cfp-quarterfinal-capital-one-orange-bowl');
    assert.equal(result.item.neutralSiteDisplay, 'vs');
  }
});

test('mapCfbdScheduleGame maps CFP quarterfinal at Rose Bowl', () => {
  const result = mapCfbdScheduleGame(
    {
      id: 402,
      week: 17,
      home_team: 'TBD',
      away_team: 'TBD',
      neutral_site: true,
      notes: 'College Football Playoff Quarterfinal at the Rose Bowl Presented by Prudential',
    },
    'postseason'
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.item.postseasonSubtype, 'playoff');
    assert.equal(result.item.playoffRound, 'quarterfinal');
    assert.equal(result.item.bowlName, 'Rose Bowl');
  }
});

test('mapCfbdScheduleGame maps CFP quarterfinal at Sugar Bowl', () => {
  const result = mapCfbdScheduleGame(
    {
      id: 403,
      week: 17,
      home_team: 'TBD',
      away_team: 'TBD',
      neutral_site: true,
      notes: 'College Football Playoff Quarterfinal at the Allstate Sugar Bowl',
    },
    'postseason'
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.item.postseasonSubtype, 'playoff');
    assert.equal(result.item.playoffRound, 'quarterfinal');
    assert.equal(result.item.bowlName, 'Allstate Sugar Bowl');
  }
});

test('mapCfbdScheduleGame maps ordinary bowl game', () => {
  const result = mapCfbdScheduleGame(
    {
      id: 500,
      week: 17,
      home_team: 'Team A',
      away_team: 'Team B',
      notes: 'Vrbo Fiesta Bowl',
      neutral_site: true,
    },
    'postseason'
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.item.postseasonSubtype, 'bowl');
    assert.equal(result.item.bowlName, 'Vrbo Fiesta Bowl');
    assert.equal(result.item.playoffRound, null);
  }
});

test('mapCfbdScheduleGame uses playoff inference when normalized postseason subtype is missing', () => {
  const result = mapCfbdScheduleGame(
    {
      id: 701,
      week: 18,
      home_team: 'TBD',
      away_team: 'TBD',
      game_phase: 'postseason',
      postseason_subtype: null,
      notes: 'College Football Playoff Semifinal at the Cotton Bowl',
      neutral_site: true,
    },
    'postseason'
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.item.gamePhase, 'postseason');
    assert.equal(result.item.postseasonSubtype, 'playoff');
    assert.equal(result.item.playoffRound, 'semifinal');
    assert.equal(result.item.eventKey, 'cfp-semifinal-cotton-bowl');
  }
});

test('mapCfbdScheduleGame recognizes conference championship as regular-season subtype', () => {
  const result = mapCfbdScheduleGame(
    {
      id: 650,
      week: 15,
      home_team: 'Georgia',
      away_team: 'Texas',
      notes: 'SEC Championship',
      home_conference: 'SEC',
      away_conference: 'Southeastern Conference',
      neutral_site: true,
    },
    'regular'
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.item.gamePhase, 'conference_championship');
    assert.equal(result.item.regularSubtype, 'conference_championship');
    assert.equal(result.item.conferenceChampionshipConference, 'SEC');
    assert.equal(result.item.eventKey, 'sec-championship');
    assert.equal(result.item.neutralSiteDisplay, 'vs');
  }
});

test('mapCfbdScheduleGame trusts normalized conference championship subtype metadata', () => {
  const result = mapCfbdScheduleGame(
    {
      id: 651,
      week: 15,
      home_team: 'Georgia',
      away_team: 'Texas',
      game_phase: 'conference_championship',
      regular_subtype: 'conference_championship',
      conference_championship_conference: 'SEC',
      event_key: 'sec-championship',
      neutral_site_display: 'vs',
      home_conference: 'SEC',
      away_conference: 'Southeastern Conference',
      neutral_site: true,
    },
    'regular'
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.item.gamePhase, 'conference_championship');
    assert.equal(result.item.regularSubtype, 'conference_championship');
    assert.equal(result.item.postseasonSubtype, null);
    assert.equal(result.item.conferenceChampionshipConference, 'SEC');
    assert.equal(result.item.eventKey, 'sec-championship');
    assert.equal(result.item.neutralSiteDisplay, 'vs');
  }
});

test('mapCfbdScheduleGame keeps fallback notes parsing when normalized subtype metadata is absent', () => {
  const result = mapCfbdScheduleGame(
    {
      id: 652,
      week: 15,
      home_team: 'Georgia',
      away_team: 'Texas',
      notes: 'SEC Championship',
      home_conference: 'SEC',
      away_conference: 'Southeastern Conference',
      neutral_site: true,
    },
    'regular'
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.item.gamePhase, 'conference_championship');
    assert.equal(result.item.regularSubtype, 'conference_championship');
    assert.equal(result.item.conferenceChampionshipConference, 'SEC');
    assert.equal(result.item.eventKey, 'sec-championship');
  }
});

test('mapCfbdScheduleGame maps valid camelCase payload', () => {
  const result = mapCfbdScheduleGame(
    {
      id: 'abc',
      week: '2',
      homeTeam: 'Alabama',
      awayTeam: 'Georgia',
      startDate: '2025-09-06T20:00:00.000Z',
    },
    'regular'
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.item.week, 2);
    assert.equal(result.item.homeTeam, 'Alabama');
    assert.equal(result.item.awayTeam, 'Georgia');
    assert.equal(result.item.startDate, '2025-09-06T20:00:00.000Z');
  }
});

test('mapCfbdScheduleGame drops payload with missing week', () => {
  const result = mapCfbdScheduleGame({ home_team: 'Texas', away_team: 'Rice' }, 'regular');

  assert.deepEqual(result, {
    ok: false,
    reason: 'missing_week',
    raw: { home_team: 'Texas', away_team: 'Rice' },
  });
});

test('mapCfbdScheduleGame drops payload with missing home team', () => {
  const result = mapCfbdScheduleGame({ week: 1, away_team: 'Rice' }, 'regular');

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, 'missing_home_team');
  }
});

test('mapCfbdScheduleGame drops payload with missing away team', () => {
  const result = mapCfbdScheduleGame({ week: 1, home_team: 'Texas' }, 'regular');

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, 'missing_away_team');
  }
});

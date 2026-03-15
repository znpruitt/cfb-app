import test from 'node:test';
import assert from 'node:assert/strict';

import { isTruePostseasonGame } from '../postseason-display';
import { buildScheduleFromApi } from '../schedule';

test('conference placeholders are excluded from postseason tab while week-based chronology remains intact', () => {
  const built = buildScheduleFromApi({
    season: 2025,
    aliasMap: {},
    teams: [
      { school: 'Alabama', level: 'FBS', conference: 'SEC' },
      { school: 'Georgia', level: 'FBS', conference: 'SEC' },
      { school: 'Army', level: 'FBS', conference: 'Independent' },
      { school: 'Navy', level: 'FBS', conference: 'American' },
      { school: 'Notre Dame', level: 'FBS', conference: 'Independent' },
      { school: 'Penn State', level: 'FBS', conference: 'Big Ten' },
    ],
    scheduleItems: [
      {
        id: 'reg-w15-sec-real',
        week: 15,
        startDate: '2025-12-06T20:00:00Z',
        neutralSite: true,
        conferenceGame: true,
        homeTeam: 'Alabama',
        awayTeam: 'Georgia',
        homeConference: 'SEC',
        awayConference: 'SEC',
        status: 'scheduled',
        seasonType: 'regular',
      },
      {
        id: 'reg-w16-army-navy',
        week: 16,
        startDate: '2025-12-13T20:00:00Z',
        neutralSite: true,
        conferenceGame: false,
        homeTeam: 'Army',
        awayTeam: 'Navy',
        homeConference: 'Independent',
        awayConference: 'American',
        status: 'scheduled',
        seasonType: 'regular',
      },
      {
        id: 'post-conf-placeholder',
        week: 15,
        startDate: '2025-12-06T21:00:00Z',
        neutralSite: true,
        conferenceGame: true,
        homeTeam: 'TBD',
        awayTeam: 'TBD',
        homeConference: 'SEC',
        awayConference: 'SEC',
        status: 'scheduled',
        label: 'SEC Championship Game',
        seasonType: 'postseason',
      },
      {
        id: 'post-orange-bowl',
        week: 17,
        startDate: '2025-12-30T01:00:00Z',
        neutralSite: true,
        conferenceGame: false,
        homeTeam: 'Notre Dame',
        awayTeam: 'Penn State',
        homeConference: 'Independent',
        awayConference: 'Big Ten',
        status: 'scheduled',
        label: 'Orange Bowl (CFP Semifinal)',
        seasonType: 'postseason',
      },
    ],
  });

  const week15Regular = built.games.find(
    (game) => game.week === 15 && game.stage === 'regular' && game.canHome === 'Alabama'
  );
  assert.ok(
    week15Regular,
    'expected real SEC title matchup to remain in week-based schedule content'
  );

  const armyNavy = built.games.find(
    (game) => game.week === 16 && game.stage === 'regular' && game.canHome === 'Army'
  );
  assert.ok(armyNavy, 'expected late regular-season special case to remain week-based');

  const postseasonTabGames = built.games.filter(isTruePostseasonGame);
  assert.ok(postseasonTabGames.some((game) => game.bowlName === 'Orange Bowl'));
  assert.equal(
    postseasonTabGames.some((game) => game.stage === 'conference_championship'),
    false,
    'conference championship placeholders should not appear in postseason tab content'
  );
  assert.equal(
    postseasonTabGames.some((game) => game.canHome === 'Army' || game.canAway === 'Navy'),
    false,
    'late regular-season games should not be moved into postseason tab content'
  );
});

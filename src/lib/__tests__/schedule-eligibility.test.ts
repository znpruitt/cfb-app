import test from 'node:test';
import assert from 'node:assert/strict';

import { isTruePostseasonGame } from '../postseason-display';
import { buildScheduleFromApi, type ScheduleWireItem } from '../schedule';
import type { TeamCatalogItem } from '../teamIdentity';

const teams: TeamCatalogItem[] = [
  { school: 'Army', level: 'FBS', conference: 'Independent' },
  { school: 'Navy', level: 'FBS', conference: 'American' },
  { school: 'Alabama', level: 'FBS', conference: 'SEC' },
  { school: 'Georgia', level: 'FBS', conference: 'SEC' },
  { school: 'Notre Dame', level: 'FBS', conference: 'Independent' },
  { school: 'Penn State', level: 'FBS', conference: 'Big Ten' },
  { school: 'UC Davis', level: 'FCS', conference: 'Big Sky' },
  { school: 'Illinois State', level: 'FCS', conference: 'Missouri Valley' },
  { school: 'Montana State', level: 'FCS', conference: 'Big Sky' },
  { school: 'South Dakota State', level: 'FCS', conference: 'Missouri Valley' },
];

function build(scheduleItems: ScheduleWireItem[]) {
  return buildScheduleFromApi({
    season: 2025,
    aliasMap: {},
    teams,
    scheduleItems,
  });
}

test('filters eligibility consistently: keeps valid FBS content while excluding FCS-vs-FCS leaks', () => {
  const built = build([
    {
      id: 'reg-fbs-fbs',
      week: 4,
      startDate: '2025-09-20T19:00:00Z',
      neutralSite: false,
      conferenceGame: true,
      homeTeam: 'Alabama',
      awayTeam: 'Georgia',
      homeConference: 'SEC',
      awayConference: 'SEC',
      status: 'scheduled',
      seasonType: 'regular',
    },
    {
      id: 'reg-fbs-fcs',
      week: 4,
      startDate: '2025-09-20T22:00:00Z',
      neutralSite: false,
      conferenceGame: false,
      homeTeam: 'Alabama',
      awayTeam: 'UC Davis',
      homeConference: 'SEC',
      awayConference: 'Big Sky',
      status: 'scheduled',
      seasonType: 'regular',
    },
    {
      id: 'reg-fcs-fcs',
      week: 14,
      startDate: '2025-11-29T22:00:00Z',
      neutralSite: false,
      conferenceGame: true,
      homeTeam: 'Illinois State',
      awayTeam: 'UC Davis',
      homeConference: 'Missouri Valley',
      awayConference: 'Big Sky',
      status: 'scheduled',
      seasonType: 'regular',
    },
    {
      id: 'reg-fcs-fcs-unresolved-names',
      week: 11,
      startDate: '2025-11-08T20:00:00Z',
      neutralSite: false,
      conferenceGame: true,
      homeTeam: 'UCD Aggies',
      awayTeam: 'ISU Redbirds',
      homeConference: 'Big Sky',
      awayConference: 'MVFC',
      status: 'scheduled',
      seasonType: 'regular',
    },

    {
      id: 'reg-army-navy',
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
      id: 'reg-unknown',
      week: 8,
      startDate: '2025-10-18T20:00:00Z',
      neutralSite: false,
      conferenceGame: false,
      homeTeam: 'Unknown University',
      awayTeam: 'Mystery Tech',
      homeConference: '',
      awayConference: '',
      status: 'scheduled',
      seasonType: 'regular',
    },
    {
      id: 'conf-rematch',
      week: 15,
      startDate: '2025-12-06T21:00:00Z',
      neutralSite: true,
      conferenceGame: true,
      homeTeam: 'Alabama',
      awayTeam: 'Georgia',
      homeConference: 'SEC',
      awayConference: 'SEC',
      status: 'scheduled',
      seasonType: 'regular',
      gamePhase: 'conference_championship',
      regularSubtype: 'conference_championship',
      conferenceChampionshipConference: 'SEC',
      eventKey: 'sec-championship',
    },
    {
      id: 'post-fcs-playoff',
      week: 17,
      startDate: '2025-12-20T20:00:00Z',
      neutralSite: false,
      conferenceGame: false,
      homeTeam: 'Montana State',
      awayTeam: 'South Dakota State',
      homeConference: 'Big Sky',
      awayConference: 'Missouri Valley',
      status: 'scheduled',
      seasonType: 'postseason',
      gamePhase: 'postseason',
      postseasonSubtype: 'playoff',
      label: 'FCS Playoffs Semifinal',
      eventKey: 'fcs-playoff-semifinal',
    },
    {
      id: 'post-cfp-placeholder',
      week: 17,
      startDate: '2025-12-31T01:00:00Z',
      neutralSite: true,
      conferenceGame: false,
      homeTeam: 'TBD',
      awayTeam: 'TBD',
      homeConference: '',
      awayConference: '',
      status: 'scheduled',
      seasonType: 'postseason',
      gamePhase: 'postseason',
      postseasonSubtype: 'playoff',
      playoffRound: 'semifinal',
      label: 'College Football Playoff Semifinal',
      eventKey: 'cfp-semifinal-1',
    },
    {
      id: 'post-bowl-placeholder',
      week: 17,
      startDate: '2025-12-28T01:00:00Z',
      neutralSite: true,
      conferenceGame: false,
      homeTeam: 'TBD',
      awayTeam: 'TBD',
      homeConference: '',
      awayConference: '',
      status: 'scheduled',
      seasonType: 'postseason',
      gamePhase: 'postseason',
      postseasonSubtype: 'bowl',
      label: 'Orange Bowl',
      bowlName: 'Orange Bowl',
      eventKey: 'orange-bowl',
    },
    {
      id: 'post-conf-placeholder',
      week: 15,
      startDate: '2025-12-06T23:00:00Z',
      neutralSite: true,
      conferenceGame: true,
      homeTeam: 'TBD',
      awayTeam: 'TBD',
      homeConference: 'SEC',
      awayConference: 'SEC',
      status: 'scheduled',
      seasonType: 'postseason',
      label: 'SEC Championship Game',
    },
    {
      id: 'post-unknown-nonplaceholder',
      week: 17,
      startDate: '2025-12-30T21:00:00Z',
      neutralSite: true,
      conferenceGame: false,
      homeTeam: 'Unknown Team A',
      awayTeam: 'Unknown Team B',
      homeConference: '',
      awayConference: '',
      status: 'scheduled',
      seasonType: 'postseason',
      gamePhase: 'postseason',
      postseasonSubtype: 'playoff',
      label: 'Mystery Invitational Playoff',
      eventKey: 'mystery-playoff',
    },
  ]);

  const games = built.games;

  assert.ok(games.some((g) => g.canHome === 'Alabama' && g.canAway === 'Georgia' && g.week === 4));
  assert.ok(games.some((g) => g.canHome === 'Alabama' && g.canAway === 'UC Davis'));

  assert.equal(
    games.some((g) => g.csvHome === 'Illinois State' && g.csvAway === 'UC Davis'),
    false,
    'FCS-vs-FCS should never be admitted'
  );

  assert.equal(
    games.some((g) => g.csvHome === 'Montana State' && g.csvAway === 'South Dakota State'),
    false,
    'FCS postseason/playoff rows should not be admitted'
  );

  assert.equal(
    games.some((g) => g.csvHome === 'UCD Aggies' && g.csvAway === 'ISU Redbirds'),
    false,
    'conference metadata should keep unresolved FCS-vs-FCS rows out of the model'
  );

  assert.ok(games.some((g) => g.canHome === 'Army' && g.canAway === 'Navy'));

  assert.ok(
    games.some((g) => g.stage === 'conference_championship' && g.eventKey === 'sec-championship'),
    'conference championship rematch should still be present'
  );

  assert.ok(
    games.some((g) => g.isPlaceholder && g.stage === 'playoff' && /semifinal/i.test(g.label ?? '')),
    'CFP placeholders should be kept'
  );
  assert.ok(
    games.some((g) => g.isPlaceholder && g.stage === 'bowl' && /orange bowl/i.test(g.label ?? '')),
    'bowl placeholders should be kept'
  );
  assert.ok(
    games.some((g) => g.isPlaceholder && g.stage === 'conference_championship' && g.week === 15),
    'conference championship placeholders should be kept'
  );

  assert.equal(
    games.some((g) => g.csvHome === 'Unknown University' && g.csvAway === 'Mystery Tech'),
    false,
    'unresolved non-placeholder regular rows should fail closed'
  );

  assert.equal(
    games.some((g) => g.csvHome === 'Unknown Team A' && g.csvAway === 'Unknown Team B'),
    false,
    'unresolved non-placeholder postseason rows should fail closed'
  );

  const postseasonTabGames = games.filter(isTruePostseasonGame);
  assert.equal(
    postseasonTabGames.some(
      (g) => g.csvHome === 'Montana State' || g.csvAway === 'South Dakota State'
    ),
    false,
    'postseason view should exclude non-FBS content'
  );
  assert.ok(
    postseasonTabGames.some((g) => /orange bowl/i.test(g.label ?? '')),
    'postseason view should keep legitimate bowl entries'
  );
  assert.ok(
    postseasonTabGames.some((g) => /semifinal/i.test(g.label ?? '')),
    'postseason view should keep legitimate CFP entries'
  );
});

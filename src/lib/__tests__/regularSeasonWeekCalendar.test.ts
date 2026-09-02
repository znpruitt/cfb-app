import assert from 'node:assert/strict';
import test from 'node:test';

import { buildScheduleFromApi } from '../schedule.ts';
import { deriveRegularWeekTabs } from '../activeView.ts';
import { isFbsRelevantScheduleBuildRow } from '../scheduleRelevance.ts';

const teams = [
  { school: 'Iowa State', level: 'FBS' as const },
  { school: 'Kansas State', level: 'FBS' as const },
  { school: 'Georgia', level: 'FBS' as const },
  { school: 'Alabama', level: 'FBS' as const },
  { school: 'Texas', level: 'FBS' as const },
  { school: 'Rice', level: 'FBS' as const },
  { school: 'Navy', level: 'FBS' as const },
  { school: 'Notre Dame', level: 'FBS' as const },
  { school: 'Iowa', level: 'FBS' as const },
  { school: 'Baylor', level: 'FBS' as const },
  { school: 'Northern Plains', level: 'FCS' as const },
  { school: 'Southern Valley', level: 'FCS' as const },
];

test('FBS filtering preserves postseason canonical weeks and retains postseason rows', () => {
  const scheduleItems = [
    {
      id: 'regular-week-15',
      week: 15,
      startDate: '2026-12-05T18:00:00.000Z',
      neutralSite: false,
      conferenceGame: true,
      homeTeam: 'Georgia',
      awayTeam: 'Alabama',
      homeConference: 'SEC',
      awayConference: 'SEC',
      homeClassification: 'fbs' as const,
      awayClassification: 'fbs' as const,
      status: 'scheduled',
      seasonType: 'regular' as const,
    },
    {
      id: 'irrelevant-week-16',
      week: 16,
      startDate: '2026-12-12T18:00:00.000Z',
      neutralSite: false,
      conferenceGame: true,
      homeTeam: 'Northern Plains',
      awayTeam: 'Southern Valley',
      homeConference: 'Big Sky',
      awayConference: 'Missouri Valley',
      homeClassification: 'fcs' as const,
      awayClassification: 'fcs' as const,
      status: 'scheduled',
      seasonType: 'regular' as const,
    },
    {
      id: 'postseason-week-1',
      week: 1,
      startDate: '2026-12-19T18:00:00.000Z',
      neutralSite: true,
      conferenceGame: false,
      homeTeam: 'Georgia',
      awayTeam: 'Alabama',
      homeConference: 'SEC',
      awayConference: 'SEC',
      homeClassification: 'fbs' as const,
      awayClassification: 'fbs' as const,
      status: 'scheduled',
      seasonType: 'postseason' as const,
      gamePhase: 'postseason',
      postseasonSubtype: 'bowl',
      eventKey: 'fixture-bowl',
    },
    {
      id: 'postseason-placeholder',
      week: 1,
      startDate: '2026-12-20T18:00:00.000Z',
      neutralSite: true,
      conferenceGame: false,
      homeTeam: 'TBD Home',
      awayTeam: 'TBD Away',
      homeConference: '',
      awayConference: '',
      // The postseason classifier intentionally keeps this shell even though
      // both provider classifications are known non-FBS.
      homeClassification: 'fcs' as const,
      awayClassification: 'iii' as const,
      status: 'scheduled',
      seasonType: 'postseason' as const,
      label: 'Placeholder Fixture Bowl',
      bowlName: 'Placeholder Fixture Bowl',
    },
  ];

  const unfiltered = buildScheduleFromApi({
    aliasMap: {},
    teams,
    season: 2026,
    scheduleItems,
  });
  const filtered = buildScheduleFromApi({
    aliasMap: {},
    teams,
    season: 2026,
    scheduleItems: scheduleItems.filter(isFbsRelevantScheduleBuildRow),
  });
  const summarize = (games: typeof unfiltered.games) =>
    games.map((game) => ({
      providerGameId: game.providerGameId,
      providerWeek: game.providerWeek,
      canonicalWeek: game.canonicalWeek,
      stage: game.stage,
    }));

  assert.deepEqual(summarize(filtered.games), summarize(unfiltered.games));
  assert.deepEqual(
    summarize(unfiltered.games).find((game) => game.providerGameId === 'postseason-week-1'),
    {
      providerGameId: 'postseason-week-1',
      providerWeek: 1,
      canonicalWeek: 16,
      stage: 'bowl',
    }
  );
  assert.deepEqual(
    summarize(unfiltered.games).find((game) => game.providerGameId === 'postseason-placeholder'),
    {
      providerGameId: 'postseason-placeholder',
      providerWeek: 1,
      canonicalWeek: 16,
      stage: 'bowl',
    }
  );
});

test('provider week 1 stays canonical week 1 across two opening date clusters', () => {
  const scheduleItems = [
    {
      id: 'isu-w0',
      week: 1,
      startDate: '2025-08-23T18:00:00.000Z',
      neutralSite: false,
      conferenceGame: false,
      homeTeam: 'Iowa State',
      awayTeam: 'Kansas State',
      homeConference: 'Big 12',
      awayConference: 'Big 12',
      status: 'scheduled',
      seasonType: 'regular' as const,
    },
    {
      id: 'uga-bama',
      week: 1,
      startDate: '2025-08-30T18:00:00.000Z',
      neutralSite: false,
      conferenceGame: false,
      homeTeam: 'Georgia',
      awayTeam: 'Alabama',
      homeConference: 'SEC',
      awayConference: 'SEC',
      status: 'scheduled',
      seasonType: 'regular' as const,
    },
    {
      id: 'tex-rice',
      week: 1,
      startDate: '2025-08-31T18:00:00.000Z',
      neutralSite: false,
      conferenceGame: false,
      homeTeam: 'Texas',
      awayTeam: 'Rice',
      homeConference: 'SEC',
      awayConference: 'American',
      status: 'scheduled',
      seasonType: 'regular' as const,
    },
  ];

  const built = buildScheduleFromApi({ aliasMap: {}, teams, season: 2025, scheduleItems });
  const iowaStateOpener = built.games.find((game) => game.providerGameId === 'isu-w0');
  const georgiaWeek1 = built.games.find((game) => game.providerGameId === 'uga-bama');

  assert.equal(iowaStateOpener?.providerWeek, 1);
  assert.equal(iowaStateOpener?.canonicalWeek, 1);
  assert.equal(iowaStateOpener?.week, 1);
  assert.equal(georgiaWeek1?.providerWeek, 1);
  assert.equal(georgiaWeek1?.canonicalWeek, 1);
  assert.equal(
    built.games.some((game) => game.canonicalWeek === 0),
    false
  );
  assert.deepEqual(deriveRegularWeekTabs(built.games), [1]);
});

test('one opening date cluster keeps provider week 1', () => {
  const scheduleItems = [
    {
      id: 'navy-nd',
      week: 1,
      startDate: '2026-08-29T16:00:00.000Z',
      neutralSite: false,
      conferenceGame: false,
      homeTeam: 'Navy',
      awayTeam: 'Notre Dame',
      homeConference: 'American',
      awayConference: 'Independent',
      status: 'scheduled',
      seasonType: 'regular' as const,
    },
    {
      id: 'isu-iowa',
      week: 1,
      startDate: '2026-08-30T16:00:00.000Z',
      neutralSite: false,
      conferenceGame: false,
      homeTeam: 'Iowa State',
      awayTeam: 'Iowa',
      homeConference: 'Big 12',
      awayConference: 'Big Ten',
      status: 'scheduled',
      seasonType: 'regular' as const,
    },
  ];

  const built = buildScheduleFromApi({ aliasMap: {}, teams, season: 2026, scheduleItems });
  assert.deepEqual(
    built.games.map((game) => game.canonicalWeek),
    [1, 1]
  );
});

test('same team can appear twice in provider week 1 without creating a week 0', () => {
  const built = buildScheduleFromApi({
    aliasMap: {},
    teams,
    season: 2025,
    scheduleItems: [
      {
        id: 'isu-w0',
        week: 1,
        startDate: '2025-08-23T18:00:00.000Z',
        neutralSite: false,
        conferenceGame: false,
        homeTeam: 'Iowa State',
        awayTeam: 'Kansas State',
        homeConference: 'Big 12',
        awayConference: 'Big 12',
        status: 'scheduled',
        seasonType: 'regular' as const,
      },
      {
        id: 'isu-w1',
        week: 1,
        startDate: '2025-08-30T18:00:00.000Z',
        neutralSite: false,
        conferenceGame: false,
        homeTeam: 'Iowa State',
        awayTeam: 'Baylor',
        homeConference: 'Big 12',
        awayConference: 'Big 12',
        status: 'scheduled',
        seasonType: 'regular' as const,
      },
      {
        id: 'tex-rice',
        week: 1,
        startDate: '2025-08-31T18:00:00.000Z',
        neutralSite: false,
        conferenceGame: false,
        homeTeam: 'Texas',
        awayTeam: 'Rice',
        homeConference: 'SEC',
        awayConference: 'American',
        status: 'scheduled',
        seasonType: 'regular' as const,
      },
    ],
  });

  const iowaStateGames = built.games
    .filter((game) => game.canHome === 'Iowa State')
    .sort((a, b) => a.week - b.week);

  assert.deepEqual(
    iowaStateGames.map((game) => ({ week: game.week, providerWeek: game.providerWeek })),
    [
      { week: 1, providerWeek: 1 },
      { week: 1, providerWeek: 1 },
    ]
  );
});

test('provider week 1 followed by provider week 2 preserves both provider weeks', () => {
  const scheduleItems = [
    {
      id: 'week-1-light',
      week: 1,
      startDate: '2026-08-29T16:00:00.000Z',
      neutralSite: false,
      conferenceGame: false,
      homeTeam: 'Navy',
      awayTeam: 'Notre Dame',
      homeConference: 'American',
      awayConference: 'Independent',
      status: 'scheduled',
      seasonType: 'regular' as const,
    },
    {
      id: 'week-2-a',
      week: 2,
      startDate: '2026-09-05T16:00:00.000Z',
      neutralSite: false,
      conferenceGame: false,
      homeTeam: 'Iowa State',
      awayTeam: 'Iowa',
      homeConference: 'Big 12',
      awayConference: 'Big Ten',
      status: 'scheduled',
      seasonType: 'regular' as const,
    },
    {
      id: 'week-2-b',
      week: 2,
      startDate: '2026-09-06T16:00:00.000Z',
      neutralSite: false,
      conferenceGame: false,
      homeTeam: 'Texas',
      awayTeam: 'Rice',
      homeConference: 'SEC',
      awayConference: 'American',
      status: 'scheduled',
      seasonType: 'regular' as const,
    },
  ];

  const built = buildScheduleFromApi({ aliasMap: {}, teams, season: 2026, scheduleItems });
  assert.equal(built.games.find((game) => game.providerGameId === 'week-1-light')?.week, 1);
  assert.equal(built.games.find((game) => game.providerGameId === 'week-2-a')?.week, 2);
});

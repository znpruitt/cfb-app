import assert from 'node:assert/strict';
import test from 'node:test';

import { buildScheduleFromApi } from '../schedule.ts';
import {
  buildRegularSeasonDateClusters,
  buildRegularSeasonWeekCalendar,
  deriveCanonicalRegularSeasonWeek,
} from '../regularSeasonWeekCalendar.ts';
import { deriveRegularWeekTabs } from '../activeView.ts';

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
];

test('smaller earlier cluster is derived as canonical week 0 while main opening cluster stays week 1', () => {
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

  const clusters = buildRegularSeasonDateClusters(scheduleItems);
  assert.equal(clusters.length, 2);
  assert.equal(clusters[0]?.gameCount, 1);
  assert.equal(clusters[1]?.gameCount, 2);

  const weekCalendar = buildRegularSeasonWeekCalendar(scheduleItems);
  const earlyWeek = deriveCanonicalRegularSeasonWeek(scheduleItems[0]!, weekCalendar);
  const openingWeek = deriveCanonicalRegularSeasonWeek(scheduleItems[1]!, weekCalendar);

  assert.deepEqual(earlyWeek, {
    providerWeek: 1,
    canonicalWeek: 0,
    weekCorrectionReason: 'derived_week_0_from_opening_cluster',
  });
  assert.deepEqual(openingWeek, {
    providerWeek: 1,
    canonicalWeek: 1,
    weekCorrectionReason: null,
  });

  const built = buildScheduleFromApi({ aliasMap: {}, teams, season: 2025, scheduleItems });
  const iowaStateWeek0 = built.games.find((game) => game.providerGameId === 'isu-w0');
  const georgiaWeek1 = built.games.find((game) => game.providerGameId === 'uga-bama');

  assert.equal(iowaStateWeek0?.providerWeek, 1);
  assert.equal(iowaStateWeek0?.canonicalWeek, 0);
  assert.equal(iowaStateWeek0?.week, 0);
  assert.equal(georgiaWeek1?.providerWeek, 1);
  assert.equal(georgiaWeek1?.canonicalWeek, 1);
  assert.deepEqual(deriveRegularWeekTabs(built.games), [0, 1]);
});

test('season with no earlier cluster does not derive week 0', () => {
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

  const weekCalendar = buildRegularSeasonWeekCalendar(scheduleItems);
  assert.equal(weekCalendar.openingWeek0Cluster, null);
  assert.equal(weekCalendar.openingWeek1Cluster?.gameCount, 2);

  const derivedWeeks = scheduleItems.map((item) =>
    deriveCanonicalRegularSeasonWeek(item, weekCalendar)
  );
  assert.deepEqual(
    derivedWeeks.map((item) => item.canonicalWeek),
    [1, 1]
  );
});

test('same team can appear in derived week 0 and week 1 without collapsing schedule weeks', () => {
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
      { week: 0, providerWeek: 1 },
      { week: 1, providerWeek: 1 },
    ]
  );
});

test('lighter provider week 1 followed by provider week 2 does not derive a false week 0', () => {
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

  const weekCalendar = buildRegularSeasonWeekCalendar(scheduleItems);
  assert.equal(weekCalendar.openingWeek0Cluster, null);
  assert.deepEqual(weekCalendar.openingWeek1Cluster?.providerWeeks, [1]);

  const built = buildScheduleFromApi({ aliasMap: {}, teams, season: 2026, scheduleItems });
  assert.equal(built.games.find((game) => game.providerGameId === 'week-1-light')?.week, 1);
  assert.equal(built.games.find((game) => game.providerGameId === 'week-2-a')?.week, 2);
});

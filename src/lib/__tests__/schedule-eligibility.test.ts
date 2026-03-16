import test from 'node:test';
import assert from 'node:assert/strict';

import { isTruePostseasonGame } from '../postseason-display';
import { buildScheduleFromApi, type ScheduleWireItem } from '../schedule';
import { fetchScoresByGame } from '../scores';
import {
  getAmbiguousConferenceDiagnostics,
  getPresentDayPolicyConferenceDiagnostics,
  getUnresolvedConferenceDiagnostics,
  resetUnresolvedConferenceDiagnostics,
} from '../conferenceDiagnostics';
import type { CfbdConferenceRecord } from '../conferenceSubdivision';
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
  { school: 'UT Permian Basin', level: 'D2', conference: 'Lone Star' },
  { school: 'Harding', level: 'D2', conference: 'Great American' },
  { school: 'American', level: 'FBS', conference: 'Patriot' },
  { school: 'Jackson State', level: 'FCS', conference: 'SWAC' },
  { school: 'Florida A&M', level: 'FCS', conference: 'SWAC' },
  { school: 'Miami', level: 'FBS', conference: 'ACC' },
  { school: 'App State', level: 'FBS', conference: 'Sun Belt' },
];

const conferenceRecords: CfbdConferenceRecord[] = [
  {
    name: 'American Athletic Conference',
    shortName: 'American Athletic',
    abbreviation: 'AAC',
    classification: 'fbs',
  },
  {
    name: 'Patriot League',
    shortName: 'Patriot',
    abbreviation: 'PAT',
    classification: 'fcs',
  },
  {
    name: 'Great American Conference',
    shortName: 'Great American',
    abbreviation: 'GAC',
    classification: 'ii',
  },
  {
    id: 700,
    name: 'Southwestern Athletic Conference',
    shortName: 'SWAC',
    abbreviation: 'SWAC',
    classification: 'fcs',
  },
  {
    id: 701,
    name: 'Southwestern Athletic Conference (Historical)',
    shortName: 'SWAC',
    abbreviation: 'SWAC',
    classification: 'fbs',
  },
  {
    id: 801,
    name: 'Atlantic Coast Conference',
    shortName: 'ACC',
    abbreviation: 'ACC',
    classification: 'fbs',
  },
  {
    id: 802,
    name: 'Sun Belt Conference',
    shortName: 'Sun Belt',
    abbreviation: 'SBC',
    classification: 'fbs',
  },
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
      id: 'post-bowl-mixed-placeholder',
      week: 18,
      startDate: '2026-01-02T01:00:00Z',
      neutralSite: true,
      conferenceGame: false,
      homeTeam: 'Boise State',
      awayTeam: 'Team TBD',
      homeConference: 'Mountain West',
      awayConference: '',
      status: 'scheduled',
      seasonType: 'postseason',
      gamePhase: 'postseason',
      postseasonSubtype: 'bowl',
      label: 'Fiesta Bowl',
      bowlName: 'Fiesta Bowl',
      eventKey: 'fiesta-bowl',
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
    games.some(
      (g) =>
        g.stage === 'bowl' &&
        g.canHome === 'Boise State' &&
        g.participants.away.kind === 'placeholder'
    ),
    'mixed postseason games with one resolved FBS team and one recognized placeholder should be kept'
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

test('D2-vs-D2 games are excluded even when one team name is American', () => {
  const built = build([
    {
      id: 'reg-utpb-harding',
      week: 15,
      startDate: '2025-12-06T20:00:00Z',
      neutralSite: false,
      conferenceGame: false,
      homeTeam: 'UT Permian Basin',
      awayTeam: 'Harding',
      homeConference: 'Lone Star',
      awayConference: 'Great American',
      status: 'scheduled',
      seasonType: 'regular',
    },
  ]);

  assert.equal(
    built.games.some((g) => g.csvHome === 'UT Permian Basin' && g.csvAway === 'Harding'),
    false,
    'non-FBS regular-season matchups must be excluded from canonical schedule'
  );
});

test('similar-name FCS conference marker does not get upgraded to FBS via conference substring', () => {
  const built = buildScheduleFromApi({
    season: 2025,
    teams,
    scheduleItems: [
      {
        id: 'reg-similar-name-leak',
        week: 5,
        startDate: '2025-10-01T20:00:00Z',
        neutralSite: false,
        conferenceGame: false,
        homeTeam: 'Harding',
        awayTeam: 'American',
        homeConference: 'Great American',
        awayConference: 'Patriot',
        status: 'scheduled',
        seasonType: 'regular',
      },
    ],
    aliasMap: {},
  });

  assert.equal(
    built.games.length,
    0,
    'Great American should not be treated as FBS American Athletic conference marker'
  );
});

test('legitimate American Athletic conference values resolve to FBS with CFBD conference records', () => {
  const built = buildScheduleFromApi({
    season: 2025,
    teams,
    scheduleItems: [
      {
        id: 'reg-aac-vs-fcs',
        week: 2,
        startDate: '2025-09-06T20:00:00Z',
        neutralSite: false,
        conferenceGame: false,
        homeTeam: 'Navy',
        awayTeam: 'UC Davis',
        homeConference: 'AAC',
        awayConference: 'Patriot',
        status: 'scheduled',
        seasonType: 'regular',
      },
    ],
    aliasMap: {},
    conferenceRecords,
  });

  assert.equal(
    built.games.length,
    1,
    'AAC should map to FBS via structured conference record match'
  );
});

test('conference classification index does not leak across builds when records are omitted', () => {
  const scheduleItems: ScheduleWireItem[] = [
    {
      id: 'reg-index-leak-check',
      week: 6,
      startDate: '2025-10-04T20:00:00Z',
      neutralSite: false,
      conferenceGame: false,
      homeTeam: 'Unknown Team Alpha',
      awayTeam: 'Unknown Team Beta',
      homeConference: 'Test League',
      awayConference: 'Test League',
      status: 'scheduled',
      seasonType: 'regular',
    },
  ];

  const localConferenceRecords: CfbdConferenceRecord[] = [
    {
      name: 'Test League',
      shortName: 'Test League',
      abbreviation: 'TL',
      classification: 'fbs',
    },
  ];

  const withRecords = buildScheduleFromApi({
    season: 2025,
    teams,
    scheduleItems,
    aliasMap: {},
    conferenceRecords: localConferenceRecords,
  });

  assert.equal(withRecords.games.length, 1);

  const withoutRecords = buildScheduleFromApi({
    season: 2025,
    teams,
    scheduleItems,
    aliasMap: {},
  });

  assert.equal(
    withoutRecords.games.length,
    0,
    'when conference records are omitted, prior in-memory conference index must not be reused'
  );
});
test('unresolved conference diagnostics capture label and context', () => {
  resetUnresolvedConferenceDiagnostics();

  buildScheduleFromApi({
    season: 2025,
    teams,
    scheduleItems: [
      {
        id: 'reg-unresolved-conf-diag',
        week: 9,
        startDate: '2025-10-25T20:00:00Z',
        neutralSite: false,
        conferenceGame: false,
        homeTeam: 'Unknown University',
        awayTeam: 'Mystery Tech',
        homeConference: 'Totally New League',
        awayConference: 'Totally New League',
        status: 'scheduled',
        seasonType: 'regular',
      },
    ],
    aliasMap: {},
    conferenceRecords,
  });

  const diagnostics = getUnresolvedConferenceDiagnostics();
  const target = diagnostics.find((d) => d.normalizedKey === 'totallynewleague');
  assert.ok(target, 'unresolved conference should be present in diagnostics');
  assert.ok((target?.contexts ?? []).includes('schedule:regular'));
  assert.ok((target?.sampleGames ?? []).includes('reg-unresolved-conf-diag'));
});
test('unresolved conference values follow explicit fallback behavior', () => {
  const built = buildScheduleFromApi({
    season: 2025,
    teams,
    scheduleItems: [
      {
        id: 'reg-unknown-conference-fallback',
        week: 7,
        startDate: '2025-10-11T20:00:00Z',
        neutralSite: false,
        conferenceGame: false,
        homeTeam: 'Unknown University',
        awayTeam: 'Mystery Tech',
        homeConference: 'Completely Unknown League',
        awayConference: 'Another Unknown League',
        status: 'scheduled',
        seasonType: 'regular',
      },
    ],
    aliasMap: {},
    conferenceRecords,
  });

  assert.equal(
    built.games.length,
    0,
    'unresolved conferences should not force non-FBS rows into canonical schedule'
  );
});
test('conference-marked FCS teams stay excluded even when aliases resolve to FBS programs', () => {
  const built = buildScheduleFromApi({
    season: 2025,
    teams,
    scheduleItems: [
      {
        id: 'reg-fcs-fcs-alias-leak',
        week: 16,
        startDate: '2025-12-13T20:00:00Z',
        neutralSite: false,
        conferenceGame: true,
        homeTeam: 'UC Davis',
        awayTeam: 'Illinois State',
        homeConference: 'Big Sky',
        awayConference: 'MVFC',
        status: 'final',
        seasonType: 'regular',
      },
    ],
    aliasMap: {
      'uc davis': 'Navy',
      'illinois state': 'Army',
    },
  });

  assert.equal(
    built.games.length,
    0,
    'FCS-vs-FCS row should fail closed regardless of alias map drift'
  );
});

test('excluded games cannot be reintroduced by score matching/backfill', async () => {
  const built = build([
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
      id: 'reg-fcs-fcs',
      week: 16,
      startDate: '2025-12-13T22:00:00Z',
      neutralSite: false,
      conferenceGame: true,
      homeTeam: 'UC Davis',
      awayTeam: 'Illinois State',
      homeConference: 'Big Sky',
      awayConference: 'MVFC',
      status: 'scheduled',
      seasonType: 'regular',
    },
  ]);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        items: [
          {
            week: 16,
            status: 'final',
            time: null,
            home: 'UC Davis',
            away: 'Illinois State',
            homeScore: 31,
            awayScore: 42,
          },
          {
            week: 16,
            status: 'final',
            time: null,
            home: 'Army',
            away: 'Navy',
            homeScore: 24,
            awayScore: 17,
          },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )) as typeof fetch;

  try {
    const result = await fetchScoresByGame({
      games: built.games,
      aliasMap: {},
      season: 2025,
      teams,
    });

    assert.ok(
      Object.keys(result.scoresByKey).some((key) => key.includes('army') && key.includes('navy')),
      'eligible Army-Navy game should still receive score enrichment'
    );

    assert.equal(
      Object.values(result.scoresByKey).some(
        (pack) => pack.home.team === 'UC Davis' || pack.away.team === 'Illinois State'
      ),
      false,
      'excluded FCS-vs-FCS game must not be resurrected by scores feed'
    );

    assert.equal(
      result.issues.some((issue) => issue.includes('UC Davis') && issue.includes('Illinois State')),
      false,
      'scores flow should ignore clearly non-FBS rows and never materialize them'
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('scores are filtered to schedule scope before attachment diagnostics', async () => {
  const built = build([
    {
      id: 'reg-army-navy-w1',
      week: 1,
      startDate: '2025-09-01T20:00:00Z',
      neutralSite: false,
      conferenceGame: false,
      homeTeam: 'Army',
      awayTeam: 'Navy',
      homeConference: 'Independent',
      awayConference: 'American',
      status: 'scheduled',
      seasonType: 'regular',
    },
  ]);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        items: [
          {
            week: 1,
            seasonType: 'regular',
            status: 'final',
            time: null,
            home: 'Army',
            away: 'Navy',
            homeScore: 17,
            awayScore: 14,
          },
          {
            week: 2,
            seasonType: 'regular',
            status: 'final',
            time: null,
            home: 'Boise State',
            away: 'Washington State',
            homeScore: 31,
            awayScore: 28,
          },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )) as typeof fetch;

  try {
    const result = await fetchScoresByGame({
      games: built.games,
      aliasMap: {},
      season: 2025,
      teams,
      debugTrace: true,
    });

    assert.equal(result.debugSnapshot?.providerRowCount, 1);
    assert.equal(result.debugSnapshot?.attachedCount, 1);
    assert.equal(result.debugSnapshot?.diagnosticsCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ignored score rows stay out of user-facing diagnostics when debugTrace is off', async () => {
  const built = build([
    {
      id: 'reg-army-navy-w1',
      week: 1,
      startDate: '2025-09-01T20:00:00Z',
      neutralSite: false,
      conferenceGame: false,
      homeTeam: 'Army',
      awayTeam: 'Navy',
      homeConference: 'Independent',
      awayConference: 'American',
      status: 'scheduled',
      seasonType: 'regular',
    },
  ]);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        items: [
          {
            week: 1,
            seasonType: 'regular',
            status: 'final',
            time: null,
            home: 'Unknown U',
            away: 'Unknown V',
            homeScore: 17,
            awayScore: 14,
          },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )) as typeof fetch;

  try {
    const result = await fetchScoresByGame({
      games: built.games,
      aliasMap: {},
      season: 2025,
      teams,
      debugTrace: false,
    });

    assert.equal(result.diag.length, 0);
    assert.equal(result.debugDiagnostics, undefined);
    assert.equal(result.debugSnapshot, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('current SWAC-vs-SWAC regular season game is excluded from FBS canonical schedule', () => {
  const built = buildScheduleFromApi({
    season: 2025,
    teams,
    scheduleItems: [
      {
        id: 'reg-swac-vs-swac',
        week: 6,
        startDate: '2025-10-04T20:00:00Z',
        neutralSite: false,
        conferenceGame: true,
        homeTeam: 'Jackson State',
        awayTeam: 'Florida A&M',
        homeConference: 'SWAC',
        awayConference: 'SWAC',
        status: 'scheduled',
        seasonType: 'regular',
      },
    ],
    aliasMap: {},
    conferenceRecords,
  });

  assert.equal(
    built.games.some((g) => g.csvHome === 'Jackson State' && g.csvAway === 'Florida A&M'),
    false,
    'SWAC-vs-SWAC should remain excluded from FBS schedule even when catalog contains historical FBS duplicate'
  );
});

test('valid modern FBS conferences continue to classify as eligible', () => {
  const built = buildScheduleFromApi({
    season: 2025,
    teams,
    scheduleItems: [
      {
        id: 'reg-acc-vs-sunbelt',
        week: 5,
        startDate: '2025-09-27T20:00:00Z',
        neutralSite: false,
        conferenceGame: false,
        homeTeam: 'Miami',
        awayTeam: 'App State',
        homeConference: 'ACC',
        awayConference: 'Sun Belt',
        status: 'scheduled',
        seasonType: 'regular',
      },
    ],
    aliasMap: {},
    conferenceRecords,
  });

  assert.equal(built.games.length, 1);
});

test('ambiguous conference diagnostics capture unresolved duplicate labels without override', () => {
  resetUnresolvedConferenceDiagnostics();

  buildScheduleFromApi({
    season: 2025,
    teams,
    scheduleItems: [
      {
        id: 'reg-ambiguous-iag',
        week: 7,
        startDate: '2025-10-11T20:00:00Z',
        neutralSite: false,
        conferenceGame: false,
        homeTeam: 'Unknown University',
        awayTeam: 'Mystery Tech',
        homeConference: 'IAG',
        awayConference: 'IAG',
        status: 'scheduled',
        seasonType: 'regular',
      },
    ],
    aliasMap: {},
    conferenceRecords: [
      {
        id: 900,
        name: 'Independent Athletic Group',
        shortName: 'IAG',
        abbreviation: 'IAG',
        classification: 'fbs',
      },
      {
        id: 901,
        name: 'Independent Athletic Group (Historical)',
        shortName: 'IAG',
        abbreviation: 'IAG',
        classification: 'fcs',
      },
    ],
  });

  const ambiguous = getAmbiguousConferenceDiagnostics();
  const target = ambiguous.find((entry) => entry.normalizedKey === 'iag');
  assert.ok(target, 'ambiguous conference should be present in diagnostics');
  assert.ok((target?.contexts ?? []).includes('schedule:regular'));
  assert.ok((target?.sampleGames ?? []).includes('reg-ambiguous-iag'));
  assert.equal((target?.candidateRecords ?? []).length >= 2, true);
});

test('present-day policy diagnostics capture policy-based conference classification', () => {
  resetUnresolvedConferenceDiagnostics();

  buildScheduleFromApi({
    season: 2025,
    teams,
    scheduleItems: [
      {
        id: 'reg-policy-sec',
        week: 3,
        startDate: '2025-09-14T20:00:00Z',
        neutralSite: false,
        conferenceGame: true,
        homeTeam: 'Alabama',
        awayTeam: 'Georgia',
        homeConference: 'SEC',
        awayConference: 'SEC',
        status: 'scheduled',
        seasonType: 'regular',
      },
    ],
    aliasMap: {},
  });

  const policy = getPresentDayPolicyConferenceDiagnostics();
  const sec = policy.find((entry) => entry.normalizedKey === 'sec');
  assert.ok(sec);
  assert.equal(sec?.policyConference, 'Southeastern Conference');
  assert.equal(sec?.policyClassification, 'FBS');
});

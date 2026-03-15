import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeTeamName } from '../teamNormalization';
import { createTeamIdentityResolver } from '../teamIdentity';
import { buildScheduleFromApi } from '../schedule';
import { classifyScheduleRow } from '../postseason-classify';

test('normalization cases', () => {
  assert.equal(normalizeTeamName('Fordham'), 'fordham');
  assert.equal(normalizeTeamName('Gardner-Webb'), 'gardnerwebb');
  assert.equal(normalizeTeamName('Miami (FL)'), 'miamifl');
  assert.equal(normalizeTeamName('Texas A&M'), 'texasam');
  assert.equal(normalizeTeamName('Ole Miss'), 'olemiss');
});

test('canonical resolution includes observed FCS opponents', () => {
  const resolver = createTeamIdentityResolver({
    aliasMap: {},
    teams: [{ school: 'Boston College', level: 'FBS' }],
    observedNames: ['Fordham'],
  });

  const result = resolver.resolveName('Fordham');
  assert.equal(result.status, 'resolved');
  assert.equal(result.identityKey, 'fordham');
});

test('resolver distinguishes unknown-team unresolved from invalid-label unresolved', () => {
  const resolver = createTeamIdentityResolver({
    aliasMap: {},
    teams: [{ school: 'Boston College', level: 'FBS' }],
  });

  const unknown = resolver.resolveName('Nortern Illinois');
  assert.equal(unknown.status, 'unresolved');
  assert.equal(unknown.resolutionSource, 'unresolved');

  const invalid = resolver.resolveName('Kickoff Classic 8pm ET');
  assert.equal(invalid.status, 'unresolved');
  assert.equal(invalid.resolutionSource, 'invalid_label');
});

test('resolver cache key includes subdivision changes', () => {
  const first = createTeamIdentityResolver({
    aliasMap: {},
    teams: [
      { school: 'Boise State', level: null, subdivision: 'OTHER', conference: 'Mountain West' },
    ],
  });
  assert.equal(first.isFbsName('Boise State'), true);

  const second = createTeamIdentityResolver({
    aliasMap: {},
    teams: [
      { school: 'Boise State', level: null, subdivision: 'FCS', conference: 'Mountain West' },
    ],
  });
  assert.equal(second.isFbsName('Boise State'), false);
});
test('conference championship row without "game" keyword still maps to conference slot', () => {
  const classified = classifyScheduleRow(
    {
      id: '2025-1b',
      week: 15,
      startDate: null,
      neutralSite: true,
      conferenceGame: true,
      homeTeam: 'Indiana',
      awayTeam: 'Ohio State',
      homeConference: 'Big Ten',
      awayConference: 'Big Ten',
      status: 'scheduled',
      label: 'Big Ten Championship Presented by Dr Pepper',
      seasonType: 'postseason',
    },
    2025
  );

  assert.equal(classified.kind, 'postseason_placeholder');
  if (classified.kind === 'postseason_placeholder') {
    assert.equal(classified.stage, 'conference_championship');
    assert.equal(classified.eventId, '2025-big-ten-championship');
  }
});

test('conference championship row becomes postseason placeholder', () => {
  const classified = classifyScheduleRow(
    {
      id: '2025-1',
      week: 15,
      startDate: null,
      neutralSite: true,
      conferenceGame: false,
      homeTeam: 'ACC Championship Game 8pm ET ABC Charlotte, NC',
      awayTeam: 'TBD',
      homeConference: '',
      awayConference: '',
      status: 'scheduled',
      seasonType: 'postseason',
    },
    2025
  );

  assert.equal(classified.kind, 'postseason_placeholder');
  if (classified.kind === 'postseason_placeholder') {
    assert.equal(classified.stage, 'conference_championship');
    assert.equal(classified.eventId, '2025-acc-championship');
  }
});

test('bowl row becomes postseason placeholder', () => {
  const classified = classifyScheduleRow(
    {
      id: '2025-2',
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
    },
    2025
  );

  assert.equal(classified.kind, 'postseason_placeholder');
  if (classified.kind === 'postseason_placeholder') {
    assert.equal(classified.stage, 'bowl');
    assert.equal(classified.eventId, '2025-rose-bowl');
    assert.equal(classified.postseasonRole, 'bowl');
  }
});

test('playoff-hosting bowl is classified by seasonal role', () => {
  const classified = classifyScheduleRow(
    {
      id: '2025-2b',
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
      notes: 'College Football Playoff Quarterfinal',
    },
    2025
  );

  assert.equal(classified.kind, 'postseason_placeholder');
  if (classified.kind === 'postseason_placeholder') {
    assert.equal(classified.stage, 'playoff');
    assert.equal(classified.postseasonRole, 'playoff');
  }
});

test('playoff row becomes postseason placeholder', () => {
  const classified = classifyScheduleRow(
    {
      id: '2025-3',
      week: 18,
      startDate: null,
      neutralSite: true,
      conferenceGame: false,
      homeTeam: 'CFP Semifinal 1',
      awayTeam: 'TBD',
      homeConference: '',
      awayConference: '',
      status: 'scheduled',
      seasonType: 'postseason',
    },
    2025
  );

  assert.equal(classified.kind, 'postseason_placeholder');
  if (classified.kind === 'postseason_placeholder') {
    assert.equal(classified.stage, 'playoff');
    assert.equal(classified.eventId, '2025-cfp-semifinal-1');
    assert.equal(classified.postseasonRole, 'playoff');
  }
});

test('regular-season rows are not routed into postseason classification', () => {
  const classified = classifyScheduleRow(
    {
      id: 'reg-d3-1',
      week: 2,
      startDate: null,
      neutralSite: false,
      conferenceGame: false,
      homeTeam: 'North Central College',
      awayTeam: 'Wisconsin-River Falls',
      homeConference: '',
      awayConference: '',
      status: 'scheduled',
      seasonType: 'regular',
      label: 'NCAA Division III regular season',
    },
    2025
  );

  assert.equal(classified.kind, 'regular_game');
});

test('conference identity normalization handles common provider variants', () => {
  const cases = [
    {
      id: 'aac-variant',
      homeConference: 'AAC',
      awayConference: 'American Athletic Conference',
      expectedEventId: '2025-aac-championship',
    },
    {
      id: 'cusa-variant',
      homeConference: 'C-USA',
      awayConference: 'Conference USA',
      expectedEventId: '2025-c-usa-championship',
    },
    {
      id: 'mwc-variant',
      homeConference: 'MWC',
      awayConference: 'Mountain West',
      expectedEventId: '2025-mwc-championship',
    },
  ] as const;

  const built = buildScheduleFromApi({
    aliasMap: {},
    teams: [
      { school: 'Team A', level: 'FBS' },
      { school: 'Team B', level: 'FBS' },
    ],
    season: 2025,
    scheduleItems: cases.map((entry) => ({
      id: entry.id,
      week: 15,
      startDate: null,
      neutralSite: true,
      neutralSiteDisplay: 'vs' as const,
      conferenceGame: true,
      homeTeam: 'Team A',
      awayTeam: 'Team B',
      homeConference: entry.homeConference,
      awayConference: entry.awayConference,
      status: 'scheduled',
      seasonType: 'regular' as const,
      gamePhase: 'conference_championship' as const,
      regularSubtype: 'conference_championship' as const,
      conferenceChampionshipConference: entry.homeConference,
      eventKey: entry.expectedEventId.replace('2025-', ''),
    })),
  });

  for (const entry of cases) {
    const slot = built.games.find((game) => game.eventId === entry.expectedEventId);
    assert.ok(slot, `missing hydrated slot for ${entry.id}`);
    assert.equal(slot?.participants.home.kind, 'team');
    assert.equal(slot?.participants.away.kind, 'team');
  }
});

test('postseason conference-game rows with unknown conference remain regular games', () => {
  const classified = classifyScheduleRow(
    {
      id: 'post-unknown-conf-title',
      week: 16,
      startDate: null,
      neutralSite: true,
      conferenceGame: true,
      homeTeam: 'Alpha University',
      awayTeam: 'Beta State',
      homeConference: 'Pacific Championship League',
      awayConference: 'Pacific Championship League',
      status: 'scheduled',
      seasonType: 'postseason',
      label: '',
      notes: '',
    },
    2025
  );

  assert.equal(classified.kind, 'regular_game');
});

test('postseason feed rows without postseason markers stay regular-season rows', () => {
  const classified = classifyScheduleRow(
    {
      id: 'reg-in-post-feed',
      week: 2,
      startDate: null,
      neutralSite: false,
      conferenceGame: false,
      homeTeam: 'Boise State',
      awayTeam: 'Washington',
      homeConference: 'Mountain West',
      awayConference: 'Big Ten',
      status: 'scheduled',
      seasonType: 'postseason',
      label: 'NCAA Football Bowl Subdivision',
    },
    2025
  );

  assert.equal(classified.kind, 'regular_game');
});

test('postseason rows can be detected from venue markers', () => {
  const classified = classifyScheduleRow(
    {
      id: 'post-venue-only',
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

  assert.equal(classified.kind, 'postseason_placeholder');
  if (classified.kind === 'postseason_placeholder') {
    assert.equal(classified.stage, 'bowl');
  }
});

test('playoff rows without numeric slot generate stable distinct ids', () => {
  const first = classifyScheduleRow(
    {
      id: '2025-cfp-semi-a',
      week: 18,
      startDate: null,
      neutralSite: true,
      conferenceGame: false,
      homeTeam: 'College Football Playoff Semifinal',
      awayTeam: 'TBD',
      homeConference: '',
      awayConference: '',
      status: 'scheduled',
      seasonType: 'postseason',
    },
    2025
  );
  const second = classifyScheduleRow(
    {
      id: '2025-cfp-semi-b',
      week: 18,
      startDate: null,
      neutralSite: true,
      conferenceGame: false,
      homeTeam: 'College Football Playoff Semifinal',
      awayTeam: 'TBD',
      homeConference: '',
      awayConference: '',
      status: 'scheduled',
      seasonType: 'postseason',
    },
    2025
  );

  assert.equal(first.kind, 'postseason_placeholder');
  assert.equal(second.kind, 'postseason_placeholder');
  if (first.kind === 'postseason_placeholder' && second.kind === 'postseason_placeholder') {
    assert.notEqual(first.eventId, second.eventId);
    assert.equal(first.eventId, '2025-cfp-semifinal-2025-cfp-semi-a');
    assert.equal(second.eventId, '2025-cfp-semifinal-2025-cfp-semi-b');
  }
});

test('build schedule keeps both semifinal games when slot numbers are absent', () => {
  const built = buildScheduleFromApi({
    aliasMap: {},
    teams: [
      { school: 'Texas', level: 'FBS' },
      { school: 'Alabama', level: 'FBS' },
      { school: 'Michigan', level: 'FBS' },
      { school: 'Washington', level: 'FBS' },
    ],
    season: 2025,
    scheduleItems: [
      {
        id: 'semi-a',
        week: 18,
        startDate: null,
        neutralSite: true,
        conferenceGame: false,
        homeTeam: 'Texas',
        awayTeam: 'Alabama',
        homeConference: 'SEC',
        awayConference: 'SEC',
        status: 'scheduled',
        label: 'College Football Playoff Semifinal',
        seasonType: 'postseason',
      },
      {
        id: 'semi-b',
        week: 18,
        startDate: null,
        neutralSite: true,
        conferenceGame: false,
        homeTeam: 'Michigan',
        awayTeam: 'Washington',
        homeConference: 'Big Ten',
        awayConference: 'Big Ten',
        status: 'scheduled',
        label: 'College Football Playoff Semifinal',
        seasonType: 'postseason',
      },
    ],
  });

  const semifinals = built.games.filter((g) => g.playoffRound === 'semifinal' && !g.isPlaceholder);
  assert.equal(semifinals.length, 2);
  assert.notEqual(semifinals[0]?.eventId, semifinals[1]?.eventId);
});

test('placeholder rows bypass team identity resolution', () => {
  const built = buildScheduleFromApi({
    aliasMap: {},
    teams: [{ school: 'Boston College', level: 'FBS' }],
    season: 2025,
    scheduleItems: [
      {
        id: '2025-acc',
        week: 15,
        startDate: null,
        neutralSite: true,
        conferenceGame: false,
        homeTeam: 'ACC Championship Game 8pm ET ABC Charlotte, NC',
        awayTeam: 'TBD',
        homeConference: '',
        awayConference: '',
        status: 'scheduled',
        seasonType: 'postseason',
      },
    ],
  });

  assert.equal(
    built.issues.some((x) => x.includes('identity-unresolved')),
    false
  );
  assert.equal(
    built.games.some((g) => g.eventId === '2025-acc-championship'),
    true
  );
});

test('conference championship matchup without championship label still hydrates seeded slot', () => {
  const built = buildScheduleFromApi({
    aliasMap: {},
    teams: [
      { school: 'Georgia', level: 'FBS' },
      { school: 'Alabama', level: 'FBS' },
    ],
    season: 2025,
    scheduleItems: [
      {
        id: '2025-sec-final',
        week: 15,
        startDate: '2025-12-08T01:00:00.000Z',
        neutralSite: true,
        conferenceGame: true,
        homeTeam: 'Georgia',
        awayTeam: 'Alabama',
        homeConference: 'SEC',
        awayConference: 'SEC',
        status: 'scheduled',
        seasonType: 'regular',
        gamePhase: 'conference_championship',
        regularSubtype: 'conference_championship',
        conferenceChampionshipConference: 'SEC',
        eventKey: 'sec-championship',
      },
    ],
  });

  const secGames = built.games.filter((g) => g.eventId === '2025-sec-championship');
  assert.equal(secGames.length, 1);
  assert.equal(secGames[0]?.participants.home.kind, 'team');
  assert.equal(secGames[0]?.participants.away.kind, 'team');
  assert.equal(
    built.games.some((g) => g.eventId === '2025-sec-final'),
    false
  );
});

test('representative conference championship matchups hydrate canonical conference slots', () => {
  const entries = [
    {
      id: 'sec-real',
      conference: 'SEC',
      home: 'Georgia',
      away: 'Alabama',
      expectedEventId: '2025-sec-championship',
    },
    {
      id: 'mwc-real',
      conference: 'Mountain West',
      home: 'Boise State',
      away: 'UNLV',
      expectedEventId: '2025-mwc-championship',
    },
    {
      id: 'b1g-real',
      conference: 'Big Ten',
      home: 'Indiana',
      away: 'Ohio State',
      expectedEventId: '2025-big-ten-championship',
    },
    {
      id: 'b12-real',
      conference: 'Big 12',
      home: 'BYU',
      away: 'Texas Tech',
      expectedEventId: '2025-big-12-championship',
    },
    {
      id: 'aac-real',
      conference: 'American Athletic',
      home: 'Tulane',
      away: 'North Texas',
      expectedEventId: '2025-aac-championship',
    },
    {
      id: 'acc-real',
      conference: 'ACC',
      home: 'Duke',
      away: 'Virginia',
      expectedEventId: '2025-acc-championship',
    },
    {
      id: 'mac-real',
      conference: 'Mid-American',
      home: 'Western Michigan',
      away: 'Miami (OH)',
      expectedEventId: '2025-mac-championship',
    },
    {
      id: 'cusa-real',
      conference: 'Conference USA',
      home: 'Jacksonville State',
      away: 'Kennesaw State',
      expectedEventId: '2025-c-usa-championship',
    },
    {
      id: 'sun-real',
      conference: 'Sun Belt',
      home: 'James Madison',
      away: 'Troy',
      expectedEventId: '2025-sun-belt-championship',
    },
  ] as const;

  const built = buildScheduleFromApi({
    aliasMap: {},
    teams: entries.flatMap((entry) => [
      { school: entry.home, level: 'FBS' as const },
      { school: entry.away, level: 'FBS' as const },
    ]),
    season: 2025,
    scheduleItems: entries.map((entry) => ({
      id: entry.id,
      week: 15,
      startDate: '2025-12-07T01:00:00.000Z',
      neutralSite: true,
      conferenceGame: true,
      homeTeam: entry.home,
      awayTeam: entry.away,
      homeConference: entry.conference,
      awayConference: entry.conference,
      status: 'scheduled',
      seasonType: 'regular' as const,
      gamePhase: 'conference_championship' as const,
      regularSubtype: 'conference_championship' as const,
      conferenceChampionshipConference: entry.conference,
      eventKey: entry.expectedEventId.replace('2025-', ''),
    })),
  });

  for (const entry of entries) {
    const slot = built.games.find((game) => game.eventId === entry.expectedEventId);
    assert.ok(slot, `missing slot for ${entry.expectedEventId}`);
    assert.equal(slot?.participants.home.kind, 'team');
    assert.equal(slot?.participants.away.kind, 'team');
    assert.equal(slot?.participants.home.displayName, entry.home);
    assert.equal(slot?.participants.away.displayName, entry.away);
    assert.equal(
      built.games.some((game) => game.eventId === entry.id),
      false,
      `duplicate standalone row still present for ${entry.id}`
    );
  }
});

test('conference championship matchup hydrates seeded slot instead of creating duplicate row', () => {
  const built = buildScheduleFromApi({
    aliasMap: {},
    teams: [
      { school: 'Indiana', level: 'FBS' },
      { school: 'Ohio State', level: 'FBS' },
    ],
    season: 2025,
    scheduleItems: [
      {
        id: '2025-b1g',
        week: 15,
        startDate: '2025-12-07T01:00:00.000Z',
        neutralSite: true,
        conferenceGame: true,
        homeTeam: 'Indiana',
        awayTeam: 'Ohio State',
        homeConference: 'Big Ten',
        awayConference: 'Big Ten',
        status: 'scheduled',
        label: 'Big Ten Championship Presented by Dr Pepper',
        seasonType: 'postseason',
      },
    ],
  });

  const b1gGames = built.games.filter((g) => g.eventId === '2025-big-ten-championship');
  assert.equal(b1gGames.length, 1);
  const game = b1gGames[0];
  assert.equal(game?.participants.home.kind, 'team');
  assert.equal(game?.participants.away.kind, 'team');
  assert.equal(
    built.games.some(
      (g) => g.stage === 'regular' && g.csvHome === 'Indiana' && g.csvAway === 'Ohio State'
    ),
    false
  );
});

test('normalized conference championship metadata drives representative week rendering', () => {
  const entries = [
    {
      id: 'sec-ccg',
      conference: 'SEC',
      eventKey: 'sec-championship',
      home: 'Georgia',
      away: 'Texas',
    },
    {
      id: 'acc-ccg',
      conference: 'ACC',
      eventKey: 'acc-championship',
      home: 'Clemson',
      away: 'Miami (FL)',
    },
    {
      id: 'b1g-ccg',
      conference: 'Big Ten',
      eventKey: 'big-ten-championship',
      home: 'Ohio State',
      away: 'Oregon',
    },
    {
      id: 'b12-ccg',
      conference: 'Big 12',
      eventKey: 'big-12-championship',
      home: 'BYU',
      away: 'Kansas State',
    },
    {
      id: 'aac-ccg',
      conference: 'AAC',
      eventKey: 'aac-championship',
      home: 'Tulane',
      away: 'Memphis',
    },
    {
      id: 'mac-ccg',
      conference: 'MAC',
      eventKey: 'mac-championship',
      home: 'Toledo',
      away: 'Ohio',
    },
    {
      id: 'mwc-ccg',
      conference: 'MWC',
      eventKey: 'mwc-championship',
      home: 'Boise State',
      away: 'UNLV',
    },
    {
      id: 'sun-ccg',
      conference: 'Sun Belt',
      eventKey: 'sun-belt-championship',
      home: 'Troy',
      away: 'James Madison',
    },
    {
      id: 'cusa-ccg',
      conference: 'C-USA',
      eventKey: 'c-usa-championship',
      home: 'Liberty',
      away: 'WKU',
    },
  ] as const;

  const built = buildScheduleFromApi({
    aliasMap: {},
    teams: entries.flatMap((entry) => [
      { school: entry.home, level: 'FBS' as const },
      { school: entry.away, level: 'FBS' as const },
    ]),
    season: 2025,
    scheduleItems: entries.map((entry) => ({
      id: entry.id,
      week: 15,
      startDate: '2025-12-07T01:00:00.000Z',
      neutralSite: true,
      neutralSiteDisplay: 'vs' as const,
      conferenceGame: true,
      homeTeam: entry.home,
      awayTeam: entry.away,
      homeConference: entry.conference,
      awayConference: entry.conference,
      status: 'scheduled',
      seasonType: 'regular' as const,
      gamePhase: 'conference_championship' as const,
      regularSubtype: 'conference_championship' as const,
      conferenceChampionshipConference: entry.conference,
      eventKey: entry.eventKey,
    })),
  });

  for (const entry of entries) {
    const game = built.games.find((g) => g.eventId === `2025-${entry.eventKey}`);
    assert.ok(game, `missing normalized championship game for ${entry.conference}`);
    assert.equal(game?.stage, 'conference_championship');
    assert.equal(game?.week, 15);
    assert.equal(game?.participants.home.kind, 'team');
    assert.equal(game?.participants.away.kind, 'team');
  }

  assert.equal(built.weeks.includes(15), true);
});

test('merged participants keep csv and canonical fields aligned for shared event ids', () => {
  const built = buildScheduleFromApi({
    aliasMap: {},
    teams: [
      { school: 'Texas', level: 'FBS', conference: 'SEC' },
      { school: 'Georgia', level: 'FBS', conference: 'SEC' },
    ],
    season: 2025,
    scheduleItems: [
      {
        id: 'sec-ccg-home-known',
        week: 15,
        startDate: '2025-12-07T01:00:00.000Z',
        neutralSite: true,
        conferenceGame: true,
        homeTeam: 'Texas',
        awayTeam: 'TBD',
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
        id: 'sec-ccg-away-known',
        week: 15,
        startDate: '2025-12-07T01:00:00.000Z',
        neutralSite: true,
        conferenceGame: true,
        homeTeam: 'TBD',
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
    ],
  });

  const ccg = built.games.find((g) => g.eventId === '2025-sec-championship');
  assert.ok(ccg);
  assert.equal(ccg?.participants.home.kind, 'team');
  assert.equal(ccg?.participants.away.kind, 'team');
  assert.equal(ccg?.csvHome, 'Texas');
  assert.equal(ccg?.csvAway, 'Georgia');
  assert.equal(ccg?.canHome, 'Texas');
  assert.equal(ccg?.canAway, 'Georgia');
});

test('national championship is not misclassified as conference championship', () => {
  const classified = classifyScheduleRow(
    {
      id: '2025-title',
      week: 19,
      startDate: '2026-01-20T01:00:00.000Z',
      neutralSite: true,
      conferenceGame: false,
      homeTeam: 'SEC Champion',
      awayTeam: 'Big Ten Champion',
      homeConference: 'SEC',
      awayConference: 'Big Ten',
      status: 'scheduled',
      label: 'College Football Playoff National Championship',
      seasonType: 'postseason',
    },
    2025
  );

  assert.equal(classified.kind, 'postseason_placeholder');
  if (classified.kind === 'postseason_placeholder') {
    assert.equal(classified.stage, 'playoff');
    assert.equal(classified.postseasonRole, 'national_championship');
    assert.equal(classified.eventId, '2025-national-championship');
  }
});

test('placeholder hydrates into real matchup and keeps slot id', () => {
  const built = buildScheduleFromApi({
    aliasMap: {},
    teams: [
      { school: 'Clemson', level: 'FBS' },
      { school: 'Miami', level: 'FBS' },
    ],
    season: 2025,
    scheduleItems: [
      {
        id: '2025-acc',
        week: 15,
        startDate: null,
        neutralSite: true,
        conferenceGame: false,
        homeTeam: 'Clemson',
        awayTeam: 'Miami',
        homeConference: 'ACC',
        awayConference: 'ACC',
        status: 'scheduled',
        label: 'ACC Championship Game',
        seasonType: 'postseason',
      },
    ],
  });

  const game = built.games.find((g) => g.eventId === '2025-acc-championship');
  assert.ok(game);
  assert.equal(game?.eventId, '2025-acc-championship');
  assert.equal(game?.participants.home.kind, 'team');
  assert.equal(game?.participants.away.kind, 'team');
});

test('partial known participants are supported for postseason events', () => {
  const built = buildScheduleFromApi({
    aliasMap: {},
    teams: [{ school: 'Boise State', level: 'FBS' }],
    season: 2025,
    scheduleItems: [
      {
        id: '2025-fiesta',
        week: 17,
        startDate: null,
        neutralSite: true,
        conferenceGame: false,
        homeTeam: 'Boise State',
        awayTeam: 'Team TBD',
        homeConference: 'MWC',
        awayConference: '',
        status: 'scheduled',
        label: 'Fiesta Bowl',
        seasonType: 'postseason',
      },
    ],
  });

  const bowl = built.games.find((g) => g.eventId === '2025-fiesta-bowl');
  assert.ok(bowl);
  assert.equal(bowl?.participants.home.kind, 'team');
  assert.equal(bowl?.participants.away.kind, 'placeholder');
});

test('placeholder generation is idempotent and does not duplicate slots', () => {
  const params = {
    aliasMap: {},
    teams: [{ school: 'Boston College', level: 'FBS' }],
    season: 2025,
    scheduleItems: [
      {
        id: 'a',
        week: 15,
        startDate: null,
        neutralSite: true,
        conferenceGame: false,
        homeTeam: 'SEC Championship Game',
        awayTeam: 'TBD',
        homeConference: '',
        awayConference: '',
        status: 'scheduled',
        seasonType: 'postseason' as const,
      },
    ],
  };

  const one = buildScheduleFromApi(params);
  const two = buildScheduleFromApi(params);

  const oneIds = one.games.map((g) => g.eventId).sort();
  const twoIds = two.games.map((g) => g.eventId).sort();
  assert.deepEqual(oneIds, twoIds);
  assert.equal(oneIds.filter((id) => id === '2025-sec-championship').length, 1);
});

test('true invalid rows are still rejected', () => {
  const built = buildScheduleFromApi({
    aliasMap: {},
    teams: [{ school: 'Boston College', level: 'FBS' }],
    season: 2025,
    scheduleItems: [
      {
        id: '2025-bad',
        week: 1,
        startDate: null,
        neutralSite: true,
        conferenceGame: false,
        homeTeam: '',
        awayTeam: '',
        homeConference: '',
        awayConference: '',
        status: 'scheduled',
      },
    ],
  });

  assert.equal(
    built.games.some((g) => g.providerGameId === '2025-bad'),
    false
  );
});

test('regular season API games remain when postseason templates are present', () => {
  const built = buildScheduleFromApi({
    aliasMap: {},
    teams: [{ school: 'Boston College', level: 'FBS' }],
    season: 2025,
    scheduleItems: [
      {
        id: 'reg-1',
        week: 1,
        startDate: null,
        neutralSite: false,
        conferenceGame: true,
        homeTeam: 'Boston College',
        awayTeam: 'Fordham',
        homeConference: 'ACC',
        awayConference: 'Patriot',
        status: 'scheduled',
        seasonType: 'regular',
      },
      {
        id: 'post-1',
        week: 15,
        startDate: null,
        neutralSite: true,
        conferenceGame: false,
        homeTeam: 'SEC Championship Game',
        awayTeam: 'TBD',
        homeConference: '',
        awayConference: '',
        status: 'scheduled',
        seasonType: 'postseason',
      },
    ],
  });

  assert.equal(
    built.games.some((g) => g.stage === 'regular' && g.csvHome === 'Boston College'),
    true
  );
  assert.equal(
    built.games.some((g) => g.eventId === '2025-sec-championship'),
    true
  );
  assert.equal(built.weeks.includes(1), true);
  assert.equal(built.conferences.includes('ACC'), true);
});

test('regular-season rows with one known FBS team and one unresolved side are retained', () => {
  const built = buildScheduleFromApi({
    aliasMap: {},
    teams: [{ school: 'Boston College', level: 'FBS', conference: 'ACC' }],
    season: 2025,
    scheduleItems: [
      {
        id: 'fbs-unresolved',
        week: 3,
        startDate: null,
        neutralSite: false,
        conferenceGame: false,
        homeTeam: 'Boston College',
        awayTeam: 'Team TBD',
        homeConference: 'ACC',
        awayConference: '',
        status: 'scheduled',
        seasonType: 'regular',
      },
    ],
  });

  assert.equal(
    built.games.some(
      (g) => g.providerGameId === 'fbs-unresolved' && g.csvHome === 'Boston College'
    ),
    true
  );
  assert.equal(
    built.issues.some((issue) => issue.includes('identity-unresolved: Boston College vs Team TBD')),
    true
  );
  assert.equal((built.byes[3] ?? []).includes('Boston College'), false);
});

test('regular-season rows with alias-repair style unresolved opponent labels are retained', () => {
  const built = buildScheduleFromApi({
    aliasMap: {},
    teams: [{ school: 'Boston College', level: 'FBS', conference: 'ACC' }],
    season: 2025,
    scheduleItems: [
      {
        id: 'fbs-unresolved-alias-like',
        week: 4,
        startDate: null,
        neutralSite: false,
        conferenceGame: false,
        homeTeam: 'Boston College',
        awayTeam: 'Kickoff Classic 8pm ET',
        homeConference: 'ACC',
        awayConference: '',
        status: 'scheduled',
        seasonType: 'regular',
      },
    ],
  });

  assert.equal(
    built.games.some(
      (g) =>
        g.providerGameId === 'fbs-unresolved-alias-like' && g.csvAway === 'Kickoff Classic 8pm ET'
    ),
    true
  );
  assert.equal(
    built.issues.some((issue) =>
      issue.includes('identity-unresolved: Boston College vs Kickoff Classic 8pm ET')
    ),
    true
  );
  assert.equal((built.byes[4] ?? []).includes('Boston College'), false);
});

test('unsupported postseason rows emit out-of-scope diagnostics', () => {
  const built = buildScheduleFromApi({
    aliasMap: {},
    teams: [{ school: 'Texas', level: 'FBS', conference: 'SEC' }],
    season: 2025,
    scheduleItems: [
      {
        id: 'unknown-post-row',
        week: 17,
        startDate: null,
        neutralSite: true,
        conferenceGame: false,
        homeTeam: 'Team X Championship Game',
        awayTeam: 'Team Y',
        homeConference: '',
        awayConference: '',
        status: 'scheduled',
        seasonType: 'postseason',
      },
    ],
  });

  assert.equal(
    built.issues.some((issue) => issue.startsWith('out-of-scope-postseason-row:')),
    true
  );
});

test('postseason normalization does not emit placeholder diagnostics for ordinary games', () => {
  const built = buildScheduleFromApi({
    aliasMap: {},
    teams: [
      { school: 'Boise State', level: 'FBS', conference: 'Mountain West' },
      { school: 'Washington', level: 'FBS', conference: 'Big Ten' },
    ],
    season: 2025,
    scheduleItems: [
      {
        id: 'ordinary-post-feed-row',
        week: 1,
        startDate: null,
        neutralSite: false,
        conferenceGame: false,
        homeTeam: 'Washington',
        awayTeam: 'Boise State',
        homeConference: 'Big Ten',
        awayConference: 'Mountain West',
        status: 'scheduled',
        seasonType: 'postseason',
        label: 'NCAA Football Bowl Subdivision',
      },
    ],
  });

  assert.equal(
    built.games.some((g) => g.providerGameId === 'ordinary-post-feed-row' && g.stage === 'regular'),
    true
  );
  assert.deepEqual(built.hydrationDiagnostics, []);
});

test('unsupported lower-division regular-season rows are filtered before identity diagnostics', () => {
  const built = buildScheduleFromApi({
    aliasMap: {},
    teams: [{ school: 'Boston College', level: 'FBS' }],
    season: 2025,
    scheduleItems: [
      {
        id: 'd3-regular',
        week: 2,
        startDate: null,
        neutralSite: false,
        conferenceGame: false,
        homeTeam: 'Trinity (CT)',
        awayTeam: 'Colby College',
        homeConference: 'NESCAC',
        awayConference: 'NESCAC',
        status: 'scheduled',
        seasonType: 'regular',
      },
    ],
  });

  assert.equal(
    built.games.some((g) => g.providerGameId === 'd3-regular'),
    false
  );
  assert.equal(
    built.issues.some((issue) => issue.includes('identity-unresolved')),
    false
  );
  assert.equal(
    built.issues.some((issue) => issue.includes('invalid-schedule-row')),
    false
  );
});

test('game filtering keeps FBS-vs-FCS and drops FCS-vs-FCS', () => {
  const built = buildScheduleFromApi({
    aliasMap: {},
    teams: [
      { school: 'Boston College', level: 'FBS' },
      { school: 'Fordham', level: 'FCS' },
      { school: 'Colgate', level: 'FCS' },
    ],
    season: 2025,
    scheduleItems: [
      {
        id: '1',
        week: 1,
        startDate: null,
        neutralSite: false,
        conferenceGame: false,
        homeTeam: 'Boston College',
        awayTeam: 'Fordham',
        homeConference: 'ACC',
        awayConference: 'Patriot',
        status: 'scheduled',
      },
      {
        id: '2',
        week: 1,
        startDate: null,
        neutralSite: false,
        conferenceGame: false,
        homeTeam: 'Fordham',
        awayTeam: 'Colgate',
        homeConference: 'Patriot',
        awayConference: 'Patriot',
        status: 'scheduled',
      },
    ],
  });

  assert.equal(
    built.games.some((g) => g.csvAway === 'Fordham' && g.csvHome === 'Boston College'),
    true
  );
  assert.equal(
    built.games.some((g) => g.csvHome === 'Fordham' && g.csvAway === 'Colgate'),
    false
  );
  assert.equal((built.byes[1] ?? []).includes('Fordham'), false);
});

test('postseason tracking keeps provider-postseason rows even when participants are non-FBS', () => {
  const built = buildScheduleFromApi({
    aliasMap: {},
    teams: [
      { school: 'Montana State', level: 'FCS', conference: 'Big Sky' },
      { school: 'South Dakota State', level: 'FCS', conference: 'Missouri Valley' },
      { school: 'Texas', level: 'FBS', conference: 'SEC' },
      { school: 'Alabama', level: 'FBS', conference: 'SEC' },
    ],
    season: 2025,
    scheduleItems: [
      {
        id: 'fcs-post-1',
        week: 16,
        startDate: null,
        neutralSite: true,
        conferenceGame: false,
        homeTeam: 'Montana State',
        awayTeam: 'South Dakota State',
        homeConference: 'Big Sky',
        awayConference: 'Missouri Valley',
        status: 'scheduled',
        seasonType: 'postseason',
        gamePhase: 'postseason',
        postseasonSubtype: 'bowl',
        bowlName: 'Celebration Bowl',
        eventKey: 'cricket-celebration-bowl',
        slotOrder: null,
        neutralSiteDisplay: 'vs',
        label: 'Cricket Celebration Bowl',
      },
      {
        id: 'fbs-post-1',
        week: 17,
        startDate: null,
        neutralSite: true,
        conferenceGame: false,
        homeTeam: 'Texas',
        awayTeam: 'Alabama',
        homeConference: 'SEC',
        awayConference: 'SEC',
        status: 'scheduled',
        seasonType: 'postseason',
        gamePhase: 'postseason',
        postseasonSubtype: 'bowl',
        bowlName: 'Frisco Bowl',
        eventKey: 'frisco-bowl',
        slotOrder: null,
        neutralSiteDisplay: 'vs',
        label: 'Frisco Bowl',
      },
    ],
  });

  const celebration = built.games.find((g) => g.providerGameId === 'fcs-post-1');
  const frisco = built.games.find((g) => g.providerGameId === 'fbs-post-1');

  assert.ok(celebration);
  assert.equal(celebration?.stage, 'bowl');
  assert.equal(celebration?.neutralDisplay, 'vs');
  assert.equal(celebration?.slotOrder, 80);

  assert.ok(frisco);
  assert.equal(frisco?.stage, 'bowl');
});

test('normalized postseason bowls with provider identities are retained for postseason rendering', () => {
  const built = buildScheduleFromApi({
    aliasMap: {},
    teams: [
      { school: 'Georgia', level: 'FBS', conference: 'SEC' },
      { school: 'Miami', level: 'FBS', conference: 'ACC' },
    ],
    season: 2025,
    scheduleItems: [
      {
        id: 'gasparilla-1',
        week: 16,
        startDate: '2025-12-20T00:00:00.000Z',
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
        bowlName: 'Union Home Mortgage Gasparilla Bowl',
        eventKey: 'union-home-mortgage-gasparilla-bowl',
        slotOrder: null,
        neutralSiteDisplay: 'vs',
        venue: 'Raymond James Stadium',
        notes: 'Tampa, FL',
        label: 'Union Home Mortgage Gasparilla Bowl',
      },
      {
        id: 'myrtle-1',
        week: 16,
        startDate: '2025-12-21T00:00:00.000Z',
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
        bowlName: 'Myrtle Beach Bowl',
        eventKey: 'myrtle-beach-bowl',
        slotOrder: null,
        neutralSiteDisplay: 'vs',
        label: 'Myrtle Beach Bowl',
      },
      {
        id: 'la-bowl-1',
        week: 16,
        startDate: '2025-12-22T00:00:00.000Z',
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
        bowlName: 'Bucked Up LA Bowl',
        eventKey: 'bucked-up-la-bowl',
        slotOrder: null,
        neutralSiteDisplay: 'vs',
        label: 'Bucked Up LA Bowl',
      },
      {
        id: 'cure-1',
        week: 16,
        startDate: '2025-12-23T00:00:00.000Z',
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
        bowlName: 'StaffDNA Cure Bowl',
        eventKey: 'staffdna-cure-bowl',
        slotOrder: null,
        neutralSiteDisplay: 'vs',
        label: 'StaffDNA Cure Bowl',
      },
      {
        id: 'ventures-1',
        week: 16,
        startDate: '2025-12-24T00:00:00.000Z',
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
        bowlName: '68 Ventures Bowl',
        eventKey: '68-ventures-bowl',
        slotOrder: null,
        neutralSiteDisplay: 'vs',
        label: '68 Ventures Bowl',
      },
      {
        id: 'celebration-1',
        week: 16,
        startDate: '2025-12-25T00:00:00.000Z',
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
        bowlName: 'Cricket Celebration Bowl',
        eventKey: 'cricket-celebration-bowl',
        slotOrder: null,
        neutralSiteDisplay: 'vs',
        label: 'Cricket Celebration Bowl',
      },
    ],
  });

  const expectedEventKeys = [
    'union-home-mortgage-gasparilla-bowl',
    'myrtle-beach-bowl',
    'bucked-up-la-bowl',
    'staffdna-cure-bowl',
    '68-ventures-bowl',
    'cricket-celebration-bowl',
  ];

  for (const key of expectedEventKeys) {
    const game = built.games.find((g) => g.eventKey === key);
    assert.ok(game, `missing ${key}`);
    assert.equal(game?.stage, 'bowl');
    assert.equal(game?.neutralDisplay, 'vs');
    assert.equal(game?.slotOrder, 80);
  }
});

test('playoff-hosting bowls from normalized API rows render once without synthetic CFP slot duplicates', () => {
  const built = buildScheduleFromApi({
    aliasMap: {},
    teams: [
      { school: 'Texas', level: 'FBS', conference: 'SEC' },
      { school: 'Oregon', level: 'FBS', conference: 'Big Ten' },
    ],
    season: 2025,
    scheduleItems: [
      {
        id: 'rose-qf-provider',
        week: 17,
        startDate: '2025-12-31T22:00:00.000Z',
        neutralSite: true,
        conferenceGame: false,
        homeTeam: 'Texas',
        awayTeam: 'Oregon',
        homeConference: 'SEC',
        awayConference: 'Big Ten',
        status: 'scheduled',
        seasonType: 'postseason',
        gamePhase: 'postseason',
        postseasonSubtype: 'playoff',
        playoffRound: 'quarterfinal',
        bowlName: 'Rose Bowl',
        eventKey: 'cfp-quarterfinal-rose-bowl',
        slotOrder: null,
        neutralSiteDisplay: 'vs',
        label: 'Rose Bowl — CFP Quarterfinal',
      },
    ],
  });

  const roseQuarterfinalGames = built.games.filter(
    (g) => g.eventKey === 'cfp-quarterfinal-rose-bowl'
  );
  assert.equal(roseQuarterfinalGames.length, 1);
  assert.equal(roseQuarterfinalGames[0]?.providerGameId, 'rose-qf-provider');
  assert.equal(
    built.games.some((g) => g.eventId === '2025-cfp-quarterfinal-1'),
    false
  );
  assert.equal(roseQuarterfinalGames[0]?.slotOrder, 80);
});

test('conference championship rows remain regular-season week context and out of postseason view', () => {
  const built = buildScheduleFromApi({
    aliasMap: {},
    teams: [
      { school: 'Texas', level: 'FBS', conference: 'SEC' },
      { school: 'Georgia', level: 'FBS', conference: 'SEC' },
    ],
    season: 2025,
    scheduleItems: [
      {
        id: 'sec-ccg-provider',
        week: 15,
        startDate: '2025-12-07T01:00:00.000Z',
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
        slotOrder: 1,
        neutralSiteDisplay: 'vs',
        label: 'SEC Championship Game',
      },
    ],
  });

  const ccg = built.games.find((g) => g.providerGameId === 'sec-ccg-provider');
  assert.ok(ccg);
  assert.equal(ccg?.stage, 'conference_championship');
  assert.equal(ccg?.week, 15);
  assert.equal(ccg?.postseasonRole, 'conference_championship');
});

test('unresolved normalized conference championship rows are retained as placeholders', () => {
  const built = buildScheduleFromApi({
    aliasMap: {},
    teams: [{ school: 'Texas', level: 'FBS', conference: 'SEC' }],
    season: 2025,
    scheduleItems: [
      {
        id: 'sec-ccg-unresolved',
        week: 15,
        startDate: '2025-12-07T01:00:00.000Z',
        neutralSite: true,
        conferenceGame: true,
        homeTeam: 'TBD',
        awayTeam: 'TBD',
        homeConference: 'SEC',
        awayConference: 'SEC',
        status: 'scheduled',
        seasonType: 'regular',
        gamePhase: 'conference_championship',
        regularSubtype: 'conference_championship',
        conferenceChampionshipConference: 'SEC',
        eventKey: 'sec-championship',
        slotOrder: 1,
        neutralSiteDisplay: 'vs',
        label: 'SEC Championship Game',
      },
    ],
  });

  const ccg = built.games.find((g) => g.providerGameId === 'sec-ccg-unresolved');
  assert.ok(ccg);
  assert.equal(ccg?.stage, 'conference_championship');
  assert.equal(ccg?.isPlaceholder, true);
  assert.equal(ccg?.status, 'placeholder');
  assert.equal(ccg?.participants.home.kind, 'placeholder');
  assert.equal(ccg?.participants.away.kind, 'placeholder');
});

test('conference list excludes conferences that only appear in dropped FCS-vs-FCS games', () => {
  const built = buildScheduleFromApi({
    aliasMap: {},
    teams: [
      { school: 'Boston College', level: 'FBS', conference: 'ACC' },
      { school: 'Clemson', level: 'FBS', conference: 'ACC' },
      { school: 'Fordham', level: 'FCS', conference: 'Patriot' },
      { school: 'Colgate', level: 'FCS', conference: 'Patriot' },
    ],
    season: 2025,
    scheduleItems: [
      {
        id: '1',
        week: 1,
        startDate: null,
        neutralSite: false,
        conferenceGame: true,
        homeTeam: 'Boston College',
        awayTeam: 'Clemson',
        homeConference: 'ACC',
        awayConference: 'ACC',
        status: 'scheduled',
      },
      {
        id: '2',
        week: 1,
        startDate: null,
        neutralSite: false,
        conferenceGame: false,
        homeTeam: 'Fordham',
        awayTeam: 'Colgate',
        homeConference: 'Patriot',
        awayConference: 'Patriot',
        status: 'scheduled',
      },
    ],
  });

  assert.equal(built.conferences.includes('ACC'), true);
  assert.equal(built.conferences.includes('Patriot'), false);
});
test('tracked filtering falls back to resolver ownable metadata when team level is OTHER', () => {
  const built = buildScheduleFromApi({
    aliasMap: {},
    teams: [
      { school: 'Boston College', level: 'OTHER', subdivision: 'OTHER', conference: 'ACC' },
      { school: 'Fordham', level: 'FCS', conference: 'Patriot' },
    ],
    season: 2025,
    scheduleItems: [
      {
        id: '1',
        week: 1,
        startDate: null,
        neutralSite: false,
        conferenceGame: false,
        homeTeam: 'Boston College',
        awayTeam: 'Fordham',
        homeConference: 'ACC',
        awayConference: 'Patriot',
        status: 'scheduled',
      },
    ],
  });

  assert.equal(
    built.games.some((g) => g.stage === 'regular' && g.csvHome === 'Boston College'),
    true
  );
  assert.equal(
    built.games.some((g) => g.stage === 'regular' && g.csvAway === 'Fordham'),
    true
  );
});

test('fcs independent teams are not inferred as FBS in tracked games', () => {
  const built = buildScheduleFromApi({
    aliasMap: {},
    teams: [
      { school: 'Illinois State', level: 'OTHER', conference: 'Missouri Valley' },
      { school: 'North Dakota State', level: 'OTHER', conference: 'FCS Independent' },
    ],
    season: 2025,
    scheduleItems: [
      {
        id: 'fcs-1',
        week: 15,
        startDate: null,
        neutralSite: false,
        conferenceGame: false,
        homeTeam: 'North Dakota State',
        awayTeam: 'Illinois State',
        homeConference: 'FCS Independent',
        awayConference: 'Missouri Valley',
        status: 'scheduled',
        seasonType: 'postseason',
        label: 'FCS Semifinal',
      },
    ],
  });

  assert.equal(
    built.games.some(
      (g) =>
        g.csvHome === 'North Dakota State' ||
        g.csvAway === 'North Dakota State' ||
        g.csvHome === 'Illinois State' ||
        g.csvAway === 'Illinois State'
    ),
    false
  );
});

test('tracked filtering keeps G5 regular-season games when catalog levels are OTHER', () => {
  const built = buildScheduleFromApi({
    aliasMap: {},
    teams: [
      { school: 'Boise State', level: 'OTHER', subdivision: 'OTHER', conference: 'Mountain West' },
      {
        school: 'San Diego State',
        level: 'OTHER',
        subdivision: 'OTHER',
        conference: 'Mountain West',
      },
    ],
    season: 2025,
    scheduleItems: [
      {
        id: '1',
        week: 1,
        startDate: null,
        neutralSite: false,
        conferenceGame: true,
        homeTeam: 'Boise State',
        awayTeam: 'San Diego State',
        homeConference: 'Mountain West',
        awayConference: 'Mountain West',
        status: 'scheduled',
      },
    ],
  });

  assert.equal(
    built.games.some((g) => g.stage === 'regular' && g.csvHome === 'Boise State'),
    true
  );
  assert.equal(
    built.games.some((g) => g.stage === 'regular' && g.csvAway === 'San Diego State'),
    true
  );
});
test('postseason placeholders stay in tracked schedule before matchup hydration', () => {
  const built = buildScheduleFromApi({
    aliasMap: {},
    teams: [{ school: 'Texas', level: 'FBS', conference: 'SEC' }],
    season: 2025,
    scheduleItems: [
      {
        id: 'post-1',
        week: 15,
        startDate: null,
        neutralSite: true,
        conferenceGame: false,
        homeTeam: 'SEC Championship Game',
        awayTeam: 'TBD',
        homeConference: '',
        awayConference: '',
        status: 'scheduled',
        seasonType: 'postseason',
      },
    ],
  });

  assert.equal(
    built.games.some((g) => g.eventId === '2025-sec-championship'),
    true
  );
  assert.equal(built.weeks.includes(15), true);
});

test('full schedule survives load with regular weeks plus postseason weeks', () => {
  const built = buildScheduleFromApi({
    aliasMap: {},
    teams: [
      { school: 'Texas', level: 'FBS' },
      { school: 'Alabama', level: 'FBS' },
      { school: 'Michigan', level: 'FBS' },
      { school: 'Ohio State', level: 'FBS' },
    ],
    season: 2025,
    scheduleItems: [
      {
        id: 'reg-1',
        week: 1,
        startDate: null,
        neutralSite: false,
        conferenceGame: true,
        homeTeam: 'Texas',
        awayTeam: 'Alabama',
        homeConference: 'SEC',
        awayConference: 'SEC',
        status: 'scheduled',
        seasonType: 'regular',
      },
      {
        id: 'reg-2',
        week: 2,
        startDate: null,
        neutralSite: false,
        conferenceGame: true,
        homeTeam: 'Michigan',
        awayTeam: 'Ohio State',
        homeConference: 'Big Ten',
        awayConference: 'Big Ten',
        status: 'scheduled',
        seasonType: 'regular',
      },
      {
        id: 'post-15',
        week: 15,
        startDate: null,
        neutralSite: true,
        conferenceGame: false,
        homeTeam: 'SEC Championship Game',
        awayTeam: 'TBD',
        homeConference: '',
        awayConference: '',
        status: 'scheduled',
        seasonType: 'postseason',
      },
      {
        id: 'post-17',
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
      },
      {
        id: 'post-18',
        week: 18,
        startDate: null,
        neutralSite: true,
        conferenceGame: false,
        homeTeam: 'CFP Semifinal 1',
        awayTeam: 'TBD',
        homeConference: '',
        awayConference: '',
        status: 'scheduled',
        seasonType: 'postseason',
        gamePhase: 'postseason',
        postseasonSubtype: 'playoff',
        playoffRound: 'semifinal',
        eventKey: 'cfp-semifinal-1',
      },
      {
        id: 'post-19',
        week: 19,
        startDate: null,
        neutralSite: true,
        conferenceGame: false,
        homeTeam: 'National Championship',
        awayTeam: 'TBD',
        homeConference: '',
        awayConference: '',
        status: 'scheduled',
        seasonType: 'postseason',
      },
    ],
  });

  assert.equal(
    built.games.some((g) => g.stage === 'regular' && g.week === 1),
    true
  );
  assert.equal(
    built.games.some((g) => g.stage === 'regular' && g.week === 2),
    true
  );
  assert.deepEqual(
    built.weeks.filter((w) => [1, 2, 15, 17, 18, 19].includes(w)),
    [1, 2, 15, 17, 18, 19]
  );
});

test('week derivation includes early and late weeks from all games', () => {
  const built = buildScheduleFromApi({
    aliasMap: {},
    teams: [
      { school: 'Texas', level: 'FBS' },
      { school: 'Alabama', level: 'FBS' },
      { school: 'Michigan', level: 'FBS' },
      { school: 'Ohio State', level: 'FBS' },
    ],
    season: 2025,
    scheduleItems: [
      {
        id: 'w1',
        week: 1,
        startDate: null,
        neutralSite: false,
        conferenceGame: true,
        homeTeam: 'Texas',
        awayTeam: 'Alabama',
        homeConference: 'SEC',
        awayConference: 'SEC',
        status: 'scheduled',
      },
      {
        id: 'w2',
        week: 2,
        startDate: null,
        neutralSite: false,
        conferenceGame: true,
        homeTeam: 'Michigan',
        awayTeam: 'Ohio State',
        homeConference: 'Big Ten',
        awayConference: 'Big Ten',
        status: 'scheduled',
      },
      {
        id: 'w3',
        week: 3,
        startDate: null,
        neutralSite: false,
        conferenceGame: true,
        homeTeam: 'Texas',
        awayTeam: 'Michigan',
        homeConference: 'SEC',
        awayConference: 'Big Ten',
        status: 'scheduled',
      },
      {
        id: 'w15',
        week: 15,
        startDate: null,
        neutralSite: true,
        conferenceGame: false,
        homeTeam: 'SEC Championship Game',
        awayTeam: 'TBD',
        homeConference: '',
        awayConference: '',
        status: 'scheduled',
        seasonType: 'postseason',
      },
      {
        id: 'w17',
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
      },
    ],
  });

  assert.deepEqual(
    built.weeks.filter((w) => [1, 2, 3, 15, 17].includes(w)),
    [1, 2, 3, 15, 17]
  );
});

test('hydration keeps regular season games while hydrating placeholders', () => {
  const regularGames = Array.from({ length: 100 }, (_, idx) => ({
    id: `reg-${idx + 1}`,
    week: (idx % 10) + 1,
    startDate: null,
    neutralSite: false,
    conferenceGame: true,
    homeTeam: idx % 2 ? 'Texas' : 'Alabama',
    awayTeam: idx % 2 ? 'Michigan' : 'Ohio State',
    homeConference: idx % 2 ? 'SEC' : 'Big Ten',
    awayConference: idx % 2 ? 'Big Ten' : 'SEC',
    status: 'scheduled',
    seasonType: 'regular' as const,
  }));

  const postseasonGames = Array.from({ length: 20 }, (_, idx) => ({
    id: `post-${idx + 1}`,
    week: 15 + (idx % 5),
    startDate: null,
    neutralSite: true,
    conferenceGame: false,
    homeTeam: `Placeholder Bowl ${idx + 1}`,
    awayTeam: 'TBD',
    homeConference: '',
    awayConference: '',
    status: 'scheduled',
    label: `Placeholder Bowl ${idx + 1}`,
    seasonType: 'postseason' as const,
  }));

  const built = buildScheduleFromApi({
    aliasMap: {},
    teams: [
      { school: 'Texas', level: 'FBS' },
      { school: 'Alabama', level: 'FBS' },
      { school: 'Michigan', level: 'FBS' },
      { school: 'Ohio State', level: 'FBS' },
    ],
    season: 2025,
    scheduleItems: [...regularGames, ...postseasonGames],
  });

  const regularCount = built.games.filter((g) => g.stage === 'regular').length;
  assert.equal(regularCount >= 10, true);
});

test('normalization keeps week 0 regular-season rows', () => {
  const built = buildScheduleFromApi({
    aliasMap: {},
    teams: [
      { school: 'Texas', level: 'FBS' },
      { school: 'Alabama', level: 'FBS' },
      { school: 'Michigan', level: 'FBS' },
      { school: 'Ohio State', level: 'FBS' },
    ],
    season: 2025,
    scheduleItems: [
      {
        id: 'w0',
        week: 0,
        startDate: null,
        neutralSite: false,
        conferenceGame: false,
        homeTeam: 'Texas',
        awayTeam: 'Alabama',
        homeConference: 'SEC',
        awayConference: 'SEC',
        status: 'scheduled',
      },
      {
        id: 'w1',
        week: 1,
        startDate: null,
        neutralSite: false,
        conferenceGame: false,
        homeTeam: 'Michigan',
        awayTeam: 'Ohio State',
        homeConference: 'Big Ten',
        awayConference: 'Big Ten',
        status: 'scheduled',
      },
      {
        id: 'w2',
        week: 2,
        startDate: null,
        neutralSite: false,
        conferenceGame: false,
        homeTeam: 'Texas',
        awayTeam: 'Michigan',
        homeConference: 'SEC',
        awayConference: 'Big Ten',
        status: 'scheduled',
      },
    ],
  });

  assert.equal(
    built.games.some((g) => g.stage === 'regular' && g.week === 0),
    true
  );
  assert.deepEqual(
    built.weeks.filter((w) => [0, 1, 2].includes(w)),
    [0, 1, 2]
  );
});

test('bowl placeholder identity uses notes when label is not bowl-specific', () => {
  const classified = classifyScheduleRow(
    {
      id: '2025-bowl-notes',
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
      label: 'ESPN Primetime',
      notes: 'Vrbo Fiesta Bowl',
      venue: 'State Farm Stadium',
    },
    2025
  );

  assert.equal(classified.kind, 'postseason_placeholder');
  if (classified.kind === 'postseason_placeholder') {
    assert.equal(classified.eventId, '2025-fiesta-bowl');
    assert.equal(classified.bowlName, 'Fiesta Bowl');
  }
});

test('postseason bowls render directly from normalized rows when ids differ from legacy placeholders', () => {
  const built = buildScheduleFromApi({
    aliasMap: {},
    teams: [
      { school: 'Boise State', level: 'FBS' },
      { school: 'Washington', level: 'FBS' },
    ],
    season: 2025,
    scheduleItems: [
      {
        id: 'provider-fiesta-1',
        week: 17,
        startDate: '2025-12-30T01:00:00.000Z',
        neutralSite: true,
        conferenceGame: false,
        homeTeam: 'Washington',
        awayTeam: 'Boise State',
        homeConference: 'Big Ten',
        awayConference: 'Mountain West',
        status: 'scheduled',
        label: 'Vrbo Fiesta Bowl',
        seasonType: 'postseason',
        venue: 'State Farm Stadium',
      },
    ],
  });

  const fiesta = built.games.find((g) => g.providerGameId === 'provider-fiesta-1');
  assert.ok(fiesta);
  assert.equal(fiesta?.participants.home.kind, 'team');
  assert.equal(fiesta?.participants.away.kind, 'team');
  assert.deepEqual(built.hydrationDiagnostics, []);
});

test('postseason rows do not require placeholder hydration to avoid playoff/bowl collisions', () => {
  const built = buildScheduleFromApi({
    aliasMap: {},
    teams: [
      { school: 'Penn State', level: 'FBS' },
      { school: 'Utah', level: 'FBS' },
      { school: 'Texas', level: 'FBS' },
      { school: 'Oregon', level: 'FBS' },
    ],
    season: 2025,
    scheduleItems: [
      {
        id: 'cfp-quarterfinal-slot',
        week: 17,
        startDate: '2025-12-30T01:00:00.000Z',
        neutralSite: true,
        conferenceGame: false,
        homeTeam: 'Texas',
        awayTeam: 'Oregon',
        homeConference: 'SEC',
        awayConference: 'Big Ten',
        status: 'scheduled',
        label: 'College Football Playoff Quarterfinal',
        seasonType: 'postseason',
        venue: 'State Farm Stadium',
      },
      {
        id: 'pop-tarts-provider-row',
        week: 17,
        startDate: '2025-12-30T01:00:00.000Z',
        neutralSite: true,
        conferenceGame: false,
        homeTeam: 'Penn State',
        awayTeam: 'Utah',
        homeConference: 'Big Ten',
        awayConference: 'Big 12',
        status: 'scheduled',
        label: 'Pop-Tarts Bowl',
        seasonType: 'postseason',
        venue: 'State Farm Stadium',
      },
    ],
  });

  const popTarts = built.games.find((g) => g.bowlName === 'Pop-Tarts Bowl');
  const quarterfinal = built.games.find((g) => g.playoffRound === 'quarterfinal');
  assert.ok(popTarts);
  assert.ok(quarterfinal);
  assert.equal(popTarts?.participants.home.kind, 'team');
  assert.equal(popTarts?.participants.away.kind, 'team');
  assert.equal(quarterfinal?.participants.home.kind, 'team');
  assert.equal(quarterfinal?.participants.away.kind, 'team');
  assert.equal(quarterfinal?.csvHome, 'Texas');
  assert.equal(quarterfinal?.csvAway, 'Oregon');

  assert.deepEqual(built.hydrationDiagnostics, []);
});

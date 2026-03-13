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
    homeTeam: `${idx % 2 ? 'Texas' : 'Alabama'} ${idx + 1}`,
    awayTeam: `${idx % 2 ? 'Michigan' : 'Ohio State'} ${idx + 1}`,
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
  assert.equal(regularCount >= 100, true);
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

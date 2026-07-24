import test from 'node:test';
import assert from 'node:assert/strict';

import { deriveScheduleWeeks, mapCfbdScheduleGame } from '../schedule/cfbdSchedule.ts';

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

test('mapCfbdScheduleGame preserves week 0 from string payload', () => {
  const result = mapCfbdScheduleGame(
    {
      id: 777,
      week: ' 0 ',
      home_team: 'Notre Dame',
      away_team: 'Navy',
    },
    'regular'
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.item.week, 0);
  }
});

test('deriveScheduleWeeks includes week 0 and sorts numerically', () => {
  assert.deepEqual(
    deriveScheduleWeeks([{ week: 2 }, { week: 0 }, { week: 10 }, { week: 2 }, { week: 1 }]),
    [0, 1, 2, 10]
  );
});

test('mapCfbdScheduleGame preserves plain numeric week 0 payload', () => {
  const result = mapCfbdScheduleGame(
    {
      id: 778,
      week: 0,
      home_team: 'USC',
      away_team: 'LSU',
    },
    'regular'
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.item.week, 0);
  }
});

test('mapCfbdScheduleGame rejects empty, negative, and non-numeric week strings', () => {
  const cases: Array<unknown> = ['', '   ', '-1', 'week-zero', '0.5'];

  for (const week of cases) {
    const result = mapCfbdScheduleGame(
      {
        id: `bad-${String(week)}`,
        week: week as string,
        home_team: 'Texas',
        away_team: 'Rice',
      },
      'regular'
    );

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, 'missing_week');
    }
  }
});

// ---------------------------------------------------------------------------
// PLATFORM-086-SCHEDULE-NON-FBS-POSTSEASON-CLASSIFICATION-SAFETY: generic
// postseason wording ("semifinal", "championship") on explicitly non-FBS rows
// (CFBD classifications `fcs`, `ii`, `iii`) must not mint shared `cfp-*` event
// identities. The 2024 partition carried FCS and Division III semifinals whose
// notes produced the SAME `cfp-semifinal` key, collapsing four unrelated games
// into one canonical postseason slot. Missing classifications keep the legacy
// text fallback; explicit FBS CFP rows are unchanged.
// ---------------------------------------------------------------------------

function eventKeyOf(result: ReturnType<typeof mapCfbdScheduleGame>): string {
  assert.equal(result.ok, true);
  return result.ok ? (result.item.eventKey ?? '') : '';
}

test('non-FBS safety: FCS semifinal text cannot mint a cfp-* key (snake_case classifications)', () => {
  const result = mapCfbdScheduleGame(
    {
      id: 401729786,
      week: 1,
      home_team: 'North Dakota State',
      away_team: 'South Dakota State',
      home_classification: 'fcs',
      away_classification: 'fcs',
      start_date: '2024-12-21T17:00:00.000Z',
      notes: 'FCS Championship - Semifinals',
    },
    'postseason'
  );
  const key = eventKeyOf(result);
  assert.ok(!key.startsWith('cfp-'), `key must not be CFP: ${key}`);
  assert.notEqual(key, 'national-championship');
  if (result.ok) assert.equal(result.item.gamePhase, 'postseason');
});

test('non-FBS safety: Division III semifinal text cannot mint a cfp-* key (camelCase classifications)', () => {
  const result = mapCfbdScheduleGame(
    {
      id: 401738295,
      week: 1,
      homeTeam: 'University of Mount Union',
      awayTeam: 'Johns Hopkins University',
      homeClassification: 'iii',
      awayClassification: 'iii',
      startDate: '2024-12-21T17:00:00.000Z',
      notes: 'Division III Championship - Semifinal',
    },
    'postseason'
  );
  const key = eventKeyOf(result);
  assert.ok(!key.startsWith('cfp-'), `key must not be CFP: ${key}`);
});

test('non-FBS safety: Division II semifinal text cannot mint a cfp-* key', () => {
  const result = mapCfbdScheduleGame(
    {
      id: 500,
      week: 1,
      home_team: 'Ferris State',
      away_team: 'Valdosta State',
      home_classification: 'ii',
      away_classification: 'ii',
      notes: 'Division II Championship - Semifinal',
    },
    'postseason'
  );
  assert.ok(!eventKeyOf(result).startsWith('cfp-'));
});

test('non-FBS safety: ONE explicitly non-FBS participant suppresses CFP inference', () => {
  const result = mapCfbdScheduleGame(
    {
      id: 501,
      week: 1,
      home_team: 'Some FBS Team',
      away_team: 'Some FCS Team',
      home_classification: 'fbs',
      away_classification: 'fcs',
      notes: 'Championship Semifinal',
    },
    'postseason'
  );
  assert.ok(!eventKeyOf(result).startsWith('cfp-'));
});

test('non-FBS safety: classification values normalize (trim + case-insensitive)', () => {
  const result = mapCfbdScheduleGame(
    {
      id: 502,
      week: 1,
      home_team: 'A',
      away_team: 'B',
      home_classification: ' FCS ',
      away_classification: 'FCS',
      notes: 'FCS Championship - Semifinals',
    },
    'postseason'
  );
  assert.ok(!eventKeyOf(result).startsWith('cfp-'));
});

test('non-FBS safety: missing classifications preserve the legacy text fallback', () => {
  // No classification metadata at all: generic semifinal wording still infers
  // a CFP identity exactly as before this correction.
  const result = mapCfbdScheduleGame(
    {
      id: 503,
      week: 1,
      home_team: 'TBD',
      away_team: 'TBD',
      notes: 'Semifinal',
    },
    'postseason'
  );
  assert.equal(eventKeyOf(result), 'cfp-semifinal');
  if (result.ok) {
    assert.equal(result.item.postseasonSubtype, 'playoff');
    assert.equal(result.item.playoffRound, 'semifinal');
  }
});

test('non-FBS safety: explicit fbs/fbs CFP semifinals still normalize as playoff semifinals', () => {
  const orange = mapCfbdScheduleGame(
    {
      id: 401677189,
      week: 1,
      home_team: 'Penn State',
      away_team: 'Notre Dame',
      home_classification: 'fbs',
      away_classification: 'fbs',
      notes: 'College Football Playoff Semifinal at the Capital One Orange Bowl',
    },
    'postseason'
  );
  const cotton = mapCfbdScheduleGame(
    {
      id: 401677191,
      week: 1,
      home_team: 'Texas',
      away_team: 'Ohio State',
      home_classification: 'fbs',
      away_classification: 'fbs',
      notes: 'College Football Playoff Semifinal at the Goodyear Cotton Bowl Classic',
    },
    'postseason'
  );
  for (const result of [orange, cotton]) {
    assert.equal(result.ok, true);
    if (!result.ok) continue;
    assert.equal(result.item.postseasonSubtype, 'playoff');
    assert.equal(result.item.playoffRound, 'semifinal');
    assert.ok((result.item.eventKey ?? '').startsWith('cfp-semifinal'));
  }
  // Bowl-specific CFP semifinal keys remain distinct from each other.
  assert.ok(orange.ok && cotton.ok);
  if (orange.ok && cotton.ok) assert.notEqual(orange.item.eventKey, cotton.item.eventKey);
});

test('non-FBS safety: the CFP national championship retains national-championship', () => {
  const result = mapCfbdScheduleGame(
    {
      id: 401677192,
      week: 1,
      home_team: 'Ohio State',
      away_team: 'Notre Dame',
      home_classification: 'fbs',
      away_classification: 'fbs',
      notes: 'College Football Playoff National Championship',
    },
    'postseason'
  );
  assert.equal(eventKeyOf(result), 'national-championship');
  if (result.ok) assert.equal(result.item.playoffRound, 'national_championship');
});

test('non-FBS safety: the 2025 FCS and Division III semifinal class receives no CFP identity', () => {
  const rows = [
    { id: 401840097, home: 'North Central College', away: 'Mount Union', cls: 'iii' },
    { id: 401840096, home: 'Johns Hopkins University', away: 'Susquehanna', cls: 'iii' },
    { id: 401833989, home: 'North Dakota State', away: 'Montana State', cls: 'fcs' },
    { id: 401833990, home: 'South Dakota State', away: 'South Dakota', cls: 'fcs' },
  ];
  const keys = rows.map((row) =>
    eventKeyOf(
      mapCfbdScheduleGame(
        {
          id: row.id,
          week: 1,
          home_team: row.home,
          away_team: row.away,
          home_classification: row.cls,
          away_classification: row.cls,
          notes:
            row.cls === 'iii'
              ? 'Division III Championship - Semifinal'
              : 'FCS Championship - Semifinals',
        },
        'postseason'
      )
    )
  );
  for (const key of keys) assert.ok(!key.startsWith('cfp-'), key);
  assert.equal(new Set(keys).size, keys.length, 'identities remain row-specific');
});

test('non-FBS safety: explicitly supplied normalized event metadata is preserved verbatim', () => {
  // Re-normalizing an already-normalized wire item with a curated non-CFP key:
  // the key must pass through untouched, never rewritten into a CFP identity.
  const result = mapCfbdScheduleGame(
    {
      id: 504,
      week: 1,
      home_team: 'North Dakota State',
      away_team: 'South Dakota State',
      home_classification: 'fcs',
      away_classification: 'fcs',
      game_phase: 'postseason',
      event_key: 'fcs-semifinal-1',
      notes: 'FCS Championship - Semifinals',
    },
    'postseason'
  );
  assert.equal(eventKeyOf(result), 'fcs-semifinal-1');
});

test('non-FBS safety: the normalized-postseason branch is guarded too (no explicit key)', () => {
  // Already-normalized wire item (game_phase set) WITHOUT an event key: the
  // text fallback runs inside the normalized branch and must not mint cfp-*.
  const result = mapCfbdScheduleGame(
    {
      id: 505,
      week: 1,
      home_team: 'Montana State',
      away_team: 'South Dakota',
      home_classification: 'fcs',
      away_classification: 'fcs',
      game_phase: 'postseason',
      notes: 'FCS Championship - Semifinals',
    },
    'postseason'
  );
  const key = eventKeyOf(result);
  assert.ok(!key.startsWith('cfp-'), `key must not be CFP: ${key}`);
});

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildScheduleFromApi, type ScheduleWireItem } from '../schedule.ts';
import { mapCfbdScheduleGame, type CfbdScheduleGame } from '../schedule/cfbdSchedule.ts';

// ---------------------------------------------------------------------------
// PLATFORM-086-SCHEDULE-NON-FBS-POSTSEASON-CLASSIFICATION-SAFETY — canonical
// collection regression. On current production data the four 2024 FCS and
// Division III championship semifinals all normalized to the SHARED event key
// `cfp-semifinal`; `buildScheduleFromApi` keys postseason rows by
// `${season}-${eventKey}`, and the authoritative collection can merge same-key
// rows into a HYBRID record carrying one row's participants under another
// row's providerGameId (observed in production: North Dakota State vs South
// Dakota State participants under the Division III providerGameId 401738295,
// surfaced when the resynced team catalog made North Dakota State resolvable).
// With the classification guard, each row keeps a row-specific identity and no
// hybrid can form.
// ---------------------------------------------------------------------------

/** The four confirmed colliding 2024 provider rows (two same-kickoff pairs). */
const RAW_2024: CfbdScheduleGame[] = [
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
  {
    id: 401738295,
    week: 1,
    home_team: 'University of Mount Union',
    away_team: 'Johns Hopkins University',
    home_classification: 'iii',
    away_classification: 'iii',
    start_date: '2024-12-21T17:00:00.000Z',
    notes: 'Division III Championship - Semifinal',
  },
  {
    id: 401738307,
    week: 1,
    home_team: 'North Central College',
    away_team: 'Susquehanna',
    home_classification: 'iii',
    away_classification: 'iii',
    start_date: '2024-12-21T20:30:00.000Z',
    notes: 'Division III Championship - Semifinal',
  },
  {
    id: 401729787,
    week: 1,
    home_team: 'Montana State',
    away_team: 'South Dakota',
    home_classification: 'fcs',
    away_classification: 'fcs',
    start_date: '2024-12-21T20:30:00.000Z',
    notes: 'FCS Championship - Semifinals',
  },
];

const RAW_BY_ID = new Map(RAW_2024.map((row) => [String(row.id), row]));

function mapAll(rows: CfbdScheduleGame[]): ScheduleWireItem[] {
  return rows.map((row) => {
    const result = mapCfbdScheduleGame(row, 'postseason');
    assert.equal(result.ok, true, `fixture row ${row.id} maps`);
    return (result.ok ? result.item : null) as unknown as ScheduleWireItem;
  });
}

test('the two confirmed same-kickoff 2024 pairs receive distinct non-CFP identities', () => {
  const items = mapAll(RAW_2024);
  const keys = items.map((item) => item.eventKey ?? `fallback-${item.id}`);
  for (const key of keys) {
    assert.ok(!String(key).startsWith('cfp-'), `event key must not be CFP: ${key}`);
  }
  assert.equal(new Set(keys).size, keys.length, 'all four identities are row-specific');
  // The same-kickoff pairs explicitly (17:00Z pair and 20:30Z pair).
  assert.notEqual(keys[0], keys[1]);
  assert.notEqual(keys[2], keys[3]);
});

test('canonical collection keeps each row aligned with its own provider id (no hybrid rows)', () => {
  // Reproduce the production trigger: North Dakota State is resolvable (the
  // resynced catalog lists it), the other seven schools are not.
  const items = mapAll(RAW_2024);
  const { games } = buildScheduleFromApi({
    scheduleItems: items,
    teams: [{ school: 'North Dakota State', level: 'FBS', conference: 'Missouri Valley' }],
    aliasMap: {},
    season: 2024,
  });

  for (const game of games) {
    const raw = RAW_BY_ID.get(String(game.providerGameId));
    if (!raw) continue;
    const ownLabels = new Set([raw.home_team, raw.away_team]);
    for (const side of ['home', 'away'] as const) {
      const participant = game.participants[side];
      if (participant.kind !== 'team') continue;
      assert.ok(
        ownLabels.has(participant.rawName) || ownLabels.has(participant.canonicalName),
        `game ${game.providerGameId} carries foreign participant ${participant.canonicalName}`
      );
    }
  }

  // The specific production hybrid can never re-form: nothing carrying the
  // Division III provider id may hold the FCS matchup's participants.
  for (const game of games) {
    if (String(game.providerGameId) !== '401738295') continue;
    for (const side of ['home', 'away'] as const) {
      const participant = game.participants[side];
      if (participant.kind !== 'team') continue;
      assert.notEqual(participant.canonicalName, 'North Dakota State');
      assert.notEqual(participant.canonicalName, 'South Dakota State');
    }
  }

  // The resolvable FCS matchup, when it survives, keeps ITS OWN provider id.
  const ndsuGames = games.filter((game) =>
    (['home', 'away'] as const).some(
      (side) =>
        game.participants[side].kind === 'team' &&
        game.participants[side].canonicalName === 'North Dakota State'
    )
  );
  for (const game of ndsuGames) {
    assert.equal(String(game.providerGameId), '401729786');
  }
});

test('FBS-vs-FCS eligibility remains green (classification guard changes identity only)', () => {
  const mapped = mapCfbdScheduleGame(
    {
      id: 600,
      week: 3,
      home_team: 'Texas',
      away_team: 'Nicholls',
      home_classification: 'fbs',
      away_classification: 'fcs',
      start_date: '2024-09-14T16:00:00.000Z',
    },
    'regular'
  );
  assert.equal(mapped.ok, true);
  const { games } = buildScheduleFromApi({
    scheduleItems: [(mapped.ok ? mapped.item : null) as unknown as ScheduleWireItem],
    teams: [{ school: 'Texas', level: 'FBS', conference: 'SEC' }],
    aliasMap: {},
    season: 2024,
  });
  assert.equal(games.length, 1, 'the FBS-vs-FCS game remains eligible');
  assert.equal(String(games[0]!.providerGameId), '600');
});

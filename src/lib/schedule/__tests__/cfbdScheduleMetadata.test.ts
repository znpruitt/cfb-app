import assert from 'node:assert/strict';
import test from 'node:test';

import { mapCfbdScheduleGame, type CfbdScheduleGame } from '../cfbdSchedule.ts';
import { buildScheduleFromApi, type ScheduleWireItem } from '../../schedule.ts';
import type { TeamCatalogItem } from '../../teamIdentity.ts';

const YEAR = 2031;
const TEAMS: TeamCatalogItem[] = [
  { school: 'Alpha U', level: 'FBS', conference: 'SEC' },
  { school: 'Beta U', level: 'FBS', conference: 'Big Ten' },
];

// 30 — new schedule metadata survives provider → cache → canonical game.
test('new schedule metadata survives provider → cache → canonical game', async () => {
  // A structured CFBD playoff national championship, with the new scalar flags.
  const raw: CfbdScheduleGame = {
    id: 401752,
    week: 15,
    start_date: '2032-01-13T00:00:00Z',
    home_team: 'Alpha U',
    away_team: 'Beta U',
    home_conference: 'SEC',
    away_conference: 'Big Ten',
    game_phase: 'postseason',
    postseason_subtype: 'playoff',
    completed: true,
    start_time_tbd: false,
    venue_id: 3504,
    // Structured playoff object — its scalars are extracted, the object is not persisted.
    playoff: { competition: 'College Football Playoff', round: 'National Championship' },
  };

  const mapped = mapCfbdScheduleGame(raw, 'postseason');
  assert.ok(mapped.ok);
  if (!mapped.ok) return;
  const item = mapped.item;

  // Provider → cache (the persisted ScheduleItem).
  assert.equal(item.completed, true);
  assert.equal(item.startTimeTBD, false);
  assert.equal(item.venueId, 3504);
  assert.equal(item.playoffCompetition, 'College Football Playoff');
  assert.equal(item.playoffRound, 'national_championship');
  assert.equal(item.playoffRoundSource, 'cfbd-structured');

  // Cache → canonical game (the AppGame produced by buildScheduleFromApi).
  const { games } = buildScheduleFromApi({
    scheduleItems: [item as ScheduleWireItem],
    teams: TEAMS,
    aliasMap: {},
    season: YEAR,
  });
  const champ = games.find((g) => g.providerGameId === '401752');
  assert.ok(champ, 'the championship canonical game was built');
  assert.equal(champ?.playoffRound, 'national_championship');
  assert.equal(champ?.playoffCompetition, 'College Football Playoff');
  assert.equal(champ?.playoffRoundSource, 'cfbd-structured');
  assert.equal(champ?.completed, true);
  assert.equal(champ?.startTimeTBD, false);
  assert.equal(champ?.venueId, 3504);
});

// 30b — a flat explicit round WITHOUT a competition is `explicit-provider-field`,
// and a text-only round is `text-inferred` (neither authoritative for rollover).
test('playoff provenance distinguishes structured, explicit-field, and text-inferred', async () => {
  const explicit = mapCfbdScheduleGame(
    {
      id: 1,
      week: 15,
      home_team: 'Alpha U',
      away_team: 'Beta U',
      game_phase: 'postseason',
      playoff_round: 'national_championship',
    },
    'postseason'
  );
  assert.ok(explicit.ok);
  if (explicit.ok) {
    assert.equal(explicit.item.playoffRoundSource, 'explicit-provider-field');
    assert.equal(explicit.item.playoffCompetition, undefined);
  }

  const textInferred = mapCfbdScheduleGame(
    {
      id: 2,
      week: 15,
      home_team: 'Alpha U',
      away_team: 'Beta U',
      game_phase: 'postseason',
      name: 'CFP National Championship',
    },
    'postseason'
  );
  assert.ok(textInferred.ok);
  if (textInferred.ok) {
    assert.equal(textInferred.item.playoffRound, 'national_championship');
    assert.equal(textInferred.item.playoffRoundSource, 'text-inferred');
  }
});

// 30c — a nested structured playoff object authorizes cfbd-structured provenance
// even when the row omits `game_phase` (PLATFORM-086E1A finding 1).
test('a nested structured playoff without game_phase is still cfbd-structured', async () => {
  const mapped = mapCfbdScheduleGame(
    {
      id: 401752,
      week: 15,
      home_team: 'Alpha U',
      away_team: 'Beta U',
      // NO game_phase — the row is only classifiable as postseason via seasonType.
      playoff: { competition: 'College Football Playoff', round: 'National Championship' },
    },
    'postseason'
  );
  assert.ok(mapped.ok);
  if (!mapped.ok) return;
  assert.equal(mapped.item.gamePhase, 'postseason');
  assert.equal(mapped.item.playoffRound, 'national_championship');
  assert.equal(mapped.item.playoffRoundSource, 'cfbd-structured');
  assert.equal(mapped.item.playoffCompetition, 'College Football Playoff');
});

// 30d — a FLAT round + FLAT competition (no nested structured object) is only
// explicit-provider-field, never cfbd-structured (PLATFORM-086E1A finding 2), so it
// cannot authorize rollover.
test('a flat playoff_round + flat competition is explicit-provider-field, not structured', async () => {
  const mapped = mapCfbdScheduleGame(
    {
      id: 401752,
      week: 15,
      home_team: 'Alpha U',
      away_team: 'Beta U',
      game_phase: 'postseason',
      playoff_round: 'national_championship',
      playoff_competition: 'College Football Playoff',
    },
    'postseason'
  );
  assert.ok(mapped.ok);
  if (!mapped.ok) return;
  assert.equal(mapped.item.playoffRound, 'national_championship');
  assert.equal(
    mapped.item.playoffRoundSource,
    'explicit-provider-field',
    'flat fields are not the structured nested object'
  );
});

// 31 — excluded / raw provider fields are not persisted.
test('excluded and raw provider fields are not persisted', async () => {
  const raw = {
    id: 401752,
    week: 15,
    home_team: 'Alpha U',
    away_team: 'Beta U',
    game_phase: 'postseason',
    playoff: { competition: 'College Football Playoff', round: 'National Championship' },
    // Excluded score-owned / betting / weather / raw provider fields.
    home_points: 34,
    away_points: 21,
    line_scores: [7, 14, 7, 6],
    weather: { temperature: 45 },
    betting: { spread: -3 },
    excitement_index: 8.1,
    home_pregame_elo: 1800,
    win_probability: 0.6,
    attendance: 70000,
    highlights: 'http://example.com/highlights',
    broadcasts: [{ network: 'ESPN' }],
  } as unknown as CfbdScheduleGame;

  const mapped = mapCfbdScheduleGame(raw, 'postseason');
  assert.ok(mapped.ok);
  if (!mapped.ok) return;
  const persistedKeys = Object.keys(mapped.item);

  for (const excluded of [
    'playoff', // the RAW structured object is never persisted (only its scalars)
    'home_points',
    'away_points',
    'points',
    'line_scores',
    'lineScores',
    'weather',
    'betting',
    'excitement_index',
    'home_pregame_elo',
    'win_probability',
    'attendance',
    'highlights',
    'broadcasts',
  ]) {
    assert.ok(
      !persistedKeys.includes(excluded),
      `persisted schedule item must not carry excluded field "${excluded}"`
    );
  }

  // The allowed structured scalars WERE extracted (proving exclusion is not just
  // "we dropped everything").
  assert.equal(mapped.item.playoffCompetition, 'College Football Playoff');
  assert.equal(mapped.item.playoffRoundSource, 'cfbd-structured');
});

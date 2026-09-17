import test from 'node:test';
import assert from 'node:assert/strict';

import { buildScheduleFromApi, type AppGame, type ScheduleWireItem } from '../schedule.ts';
import { mapCfbdScheduleGame, type CfbdScheduleGame } from '../schedule/cfbdSchedule.ts';

// ---------------------------------------------------------------------------
// PLATFORM-708 — CFP first-round event identity.
//
// Ingest normalizes every CFP first-round row to the ONE event key
// `cfp-first-round` (there is no bowl name to separate them), and the build
// used to key `eventId` on it, so all four games shared an `eventId` and one
// label override landed on all four. The fixture below is the stored
// production shape of the four 2025 first-round rows (`schedule`
// `2025-all-all`, read on the replica 2026-09-16), including that shared key.
// ---------------------------------------------------------------------------

const TEAMS = [
  { school: 'Oklahoma', level: 'FBS', conference: 'SEC' },
  { school: 'Alabama', level: 'FBS', conference: 'SEC' },
  { school: 'Texas A&M', level: 'FBS', conference: 'SEC' },
  { school: 'Miami', level: 'FBS', conference: 'ACC' },
  { school: 'Ole Miss', level: 'FBS', conference: 'SEC' },
  { school: 'Tulane', level: 'FBS', conference: 'American Athletic' },
  { school: 'Oregon', level: 'FBS', conference: 'Big Ten' },
  { school: 'James Madison', level: 'FBS', conference: 'Sun Belt' },
  { school: 'Indiana', level: 'FBS', conference: 'Big Ten' },
];

function storedFirstRoundRow(
  id: string,
  home: string,
  away: string,
  startDate: string,
  overrides: Partial<ScheduleWireItem> = {}
): ScheduleWireItem {
  return {
    id,
    week: 1,
    startDate,
    neutralSite: false,
    conferenceGame: false,
    homeTeam: home,
    awayTeam: away,
    homeConference: '',
    awayConference: '',
    homeClassification: 'fbs',
    awayClassification: 'fbs',
    status: 'scheduled',
    seasonType: 'postseason',
    gamePhase: 'postseason',
    regularSubtype: 'standard',
    postseasonSubtype: 'playoff',
    playoffRound: 'first-round',
    playoffCompetition: 'cfp',
    playoffRoundSource: 'text-inferred',
    bowlName: null,
    label: null,
    notes: 'College Football Playoff First Round Game',
    eventKey: 'cfp-first-round',
    slotOrder: null,
    neutralSiteDisplay: 'home_away',
    ...overrides,
  };
}

const FIRST_ROUND_2025: ScheduleWireItem[] = [
  storedFirstRoundRow('401779840', 'Oklahoma', 'Alabama', '2025-12-20T01:00:00.000Z'),
  storedFirstRoundRow('401779841', 'Texas A&M', 'Miami', '2025-12-20T17:00:00.000Z'),
  storedFirstRoundRow('401779842', 'Ole Miss', 'Tulane', '2025-12-20T20:30:00.000Z'),
  storedFirstRoundRow('401779843', 'Oregon', 'James Madison', '2025-12-21T00:30:00.000Z'),
];

/** A quarterfinal row: its bowl-named key must stay byte-identical. */
const QUARTERFINAL_2025 = storedFirstRoundRow(
  '401769072',
  'Indiana',
  'Alabama',
  '2026-01-01T21:00:00.000Z',
  {
    playoffRound: 'quarterfinal',
    bowlName: 'Rose Bowl',
    notes: 'College Football Playoff Quarterfinal at the Rose Bowl Game',
    eventKey: 'cfp-quarterfinal-rose-bowl',
  }
);

function build(
  scheduleItems: ScheduleWireItem[],
  manualOverrides?: Record<string, Partial<AppGame>>
): AppGame[] {
  return buildScheduleFromApi({
    scheduleItems,
    teams: TEAMS,
    aliasMap: {},
    season: 2025,
    manualOverrides,
  }).games;
}

function firstRound(games: AppGame[]): AppGame[] {
  return games
    .filter((game) => game.playoffRound === 'first-round')
    .sort((a, b) => String(a.providerGameId).localeCompare(String(b.providerGameId)));
}

test('first-round rows get distinct eventIds and keys', () => {
  const games = firstRound(build([...FIRST_ROUND_2025, QUARTERFINAL_2025]));

  assert.equal(games.length, 4);
  assert.equal(new Set(games.map((game) => game.key)).size, 4, 'first-round keys are distinct');
  assert.equal(
    new Set(games.map((game) => game.eventId)).size,
    4,
    'first-round eventIds are distinct'
  );
  assert.deepEqual(
    games.map((game) => game.eventId),
    [
      '2025-cfp-first-round-401779840',
      '2025-cfp-first-round-401779841',
      '2025-cfp-first-round-401779842',
      '2025-cfp-first-round-401779843',
    ]
  );
  // Each game owns its base key outright: no collision suffix is needed.
  assert.deepEqual(
    games.map((game) => game.key),
    games.map((game) => game.eventId)
  );
});

test('a non-first-round postseason eventId is unchanged', () => {
  const [quarterfinal] = build([...FIRST_ROUND_2025, QUARTERFINAL_2025]).filter(
    (game) => game.playoffRound === 'quarterfinal'
  );
  assert.equal(quarterfinal?.eventId, '2025-cfp-quarterfinal-rose-bowl');
  assert.equal(quarterfinal?.key, '2025-cfp-quarterfinal-rose-bowl');
});

test('one override saved against one first-round game changes that game only', () => {
  const before = firstRound(build(FIRST_ROUND_2025));
  const target = before[1]!;
  assert.equal(target.providerGameId, '401779841');

  const after = firstRound(
    build(FIRST_ROUND_2025, { [target.eventId]: { label: 'Overridden label' } })
  );

  const labelled = after.filter((game) => game.label === 'Overridden label');
  assert.deepEqual(
    labelled.map((game) => game.providerGameId),
    ['401779841'],
    'exactly the targeted game carries the override'
  );
});

test("an empty id keeps today's key", () => {
  const rows = FIRST_ROUND_2025.map((row) => ({ ...row, id: '' }));
  const games = build(rows).filter((game) => game.playoffRound === 'first-round');

  assert.equal(games.length, 4);
  assert.deepEqual(
    [...new Set(games.map((game) => game.eventId))],
    ['2025-cfp-first-round'],
    'no id to append: the shared stored key stands'
  );
  // The collection's collision suffix still keeps their React keys apart.
  assert.equal(new Set(games.map((game) => game.key)).size, 4, 'keys stay distinct');
});

// #708 round 1, Codex P2: `CfbdScheduleGame.id` is optional, and when CFBD
// omits it `mapCfbdScheduleGame` fabricates `${week}-${homeTeam}-${awayTeam}`
// — a value that CHANGES when the teams are assigned. Appending a fabricated
// id would move the eventId across exactly the transition an override has to
// survive, so an id that is not all digits keeps the shared key instead.
test("a fabricated id keeps today's key across resolution", () => {
  const raw = (home: string, away: string): CfbdScheduleGame =>
    ({
      week: 1,
      home_team: home,
      away_team: away,
      start_date: '2025-12-20T17:00:00.000Z',
      notes: 'College Football Playoff First Round Game',
      season_type: 'postseason',
      game_phase: 'postseason',
    }) as CfbdScheduleGame;

  const tbdMapped = mapCfbdScheduleGame(raw('TBD', 'TBD'), 'postseason');
  const resolvedMapped = mapCfbdScheduleGame(raw('Oregon', 'James Madison'), 'postseason');
  assert.ok(tbdMapped.ok && resolvedMapped.ok);
  if (!tbdMapped.ok || !resolvedMapped.ok) return;
  // The ids ingest fabricates differ precisely because the teams do.
  assert.equal(tbdMapped.item.id, '1-TBD-TBD');
  assert.equal(resolvedMapped.item.id, '1-Oregon-James Madison');

  const [tbd] = build([tbdMapped.item]);
  assert.equal(tbd?.isPlaceholder, true, 'the TBD game is a placeholder');
  assert.equal(tbd?.eventId, '2025-cfp-first-round', 'a fabricated id is not appended');

  const override = { [tbd!.eventId]: { label: 'First Round at Autzen' } };
  const [resolved] = build([resolvedMapped.item], override);

  assert.equal(resolved?.isPlaceholder, false, 'the resolved game has its teams');
  assert.equal(
    resolved?.eventId,
    tbd?.eventId,
    'a fabricated id leaves the eventId unmoved across resolution'
  );
  assert.equal(resolved?.label, 'First Round at Autzen', 'the override still applies');
});

// Parity with `collectionIdentity` (`schedulePostseasonHelpers.ts:185-193`),
// which treats a beyond-safe decimal as id-less because such strings collapse
// under `Number`. An id this build accepted but that one rejected would mint a
// distinct eventId over a row the collection routes by its fragment rules.
test("a beyond-safe-integer id keeps today's key", () => {
  const beyondSafe = '9007199254740993'; // 2^53 + 1
  assert.equal(Number(beyondSafe), Number('9007199254740992'), 'the two ids collapse under Number');

  const [game] = build([
    storedFirstRoundRow(beyondSafe, 'Oregon', 'Tulane', '2025-12-20T17:00:00.000Z'),
  ]);
  assert.equal(game?.eventId, '2025-cfp-first-round', 'a beyond-safe id is not appended');

  // 1e16 ROUND-TRIPS (`String(Number(x)) === x`) and is still not a safe
  // integer, so the canonical check alone would let it through: this case is
  // what makes `Number.isSafeInteger` load-bearing rather than decorative.
  const roundTripsButUnsafe = '10000000000000000';
  assert.equal(String(Number(roundTripsButUnsafe)), roundTripsButUnsafe, 'it round-trips');
  assert.equal(Number.isSafeInteger(Number(roundTripsButUnsafe)), false, 'and is not safe');

  const [unsafe] = build([
    storedFirstRoundRow(roundTripsButUnsafe, 'Oregon', 'Tulane', '2025-12-20T17:00:00.000Z'),
  ]);
  assert.equal(
    unsafe?.eventId,
    '2025-cfp-first-round',
    'an unsafe id that round-trips is not appended'
  );
});

// A durable schedule row reaches `buildScheduleFromApi` UNVALIDATED —
// `seasonBuild.ts:97` casts stored items straight to `ScheduleWireItem[]` — so a
// row whose `id` is a JSON number must not throw. A throw here would take down
// the whole build (season build, draft board, odds, live scores), not one row.
test("a non-string id does not throw and keeps today's key", () => {
  const row = {
    ...storedFirstRoundRow('unused', 'Oregon', 'Tulane', '2025-12-20T17:00:00.000Z'),
    id: 401779842 as unknown as string,
  };

  const games = build([row]).filter((game) => game.playoffRound === 'first-round');
  assert.equal(games.length, 1, 'the row still builds');
  assert.equal(games[0]?.eventId, '2025-cfp-first-round', 'a non-string id is not appended');
});

// `collectionIdentity` reads '0401779840' as pid 401779840 — the SAME game as
// '401779840' — so appending the raw string would spell two different events for
// one provider game. The canonical round-trip is what keeps the two rules equal.
test("a leading-zero id keeps today's key", () => {
  const [game] = build([
    storedFirstRoundRow('0401779840', 'Oregon', 'Tulane', '2025-12-20T17:00:00.000Z'),
  ]);
  assert.equal(game?.eventId, '2025-cfp-first-round', 'a non-canonical decimal is not appended');
});

// CHARACTERIZATION, not an endorsement (#811). Rows CFBD sends without an `id`
// keep the shared key, so several of them still collide on one eventId and one
// override still reaches all of them — the residue #708 does not close, along
// with the identical collision in every other bare `cfp-<round>` key. The
// alternative is worse and was measured: a fabricated id is TEAM-DERIVED, so
// appending it moves the eventId across resolution and loses the override at
// the one transition it exists for ("a fabricated id keeps today's key across
// resolution" above). This test exists so a later change to the guard has to
// confront the trade rather than discover it.
test('#811 residue: id-less first-round rows still share one eventId', () => {
  const raw = (home: string, away: string): CfbdScheduleGame =>
    ({
      week: 1,
      home_team: home,
      away_team: away,
      start_date: home === 'Oregon' ? '2025-12-21T00:30:00.000Z' : '2025-12-20T17:00:00.000Z',
      notes: 'College Football Playoff First Round Game',
      season_type: 'postseason',
      game_phase: 'postseason',
    }) as CfbdScheduleGame;

  const mapped = [raw('Oregon', 'James Madison'), raw('Texas A&M', 'Miami')].map((row) =>
    mapCfbdScheduleGame(row, 'postseason')
  );
  assert.ok(mapped.every((result) => result.ok));
  const items = mapped.flatMap((result) => (result.ok ? [result.item] : []));
  assert.equal(new Set(items.map((item) => item.id)).size, 2, 'the fabricated ids differ');

  const games = build(items).filter((game) => game.playoffRound === 'first-round');
  assert.equal(games.length, 2);
  assert.equal(
    new Set(games.map((game) => game.eventId)).size,
    1,
    'id-less rows share one eventId — the #811 residue'
  );

  const overridden = build(items, {
    [games[0]!.eventId]: { label: 'Applies to both' },
  }).filter((game) => game.playoffRound === 'first-round');
  assert.equal(
    overridden.filter((game) => game.label === 'Applies to both').length,
    2,
    'one override still reaches both id-less games — the #811 residue'
  );

  // The ABSENT -> PRESENT edge of the same residue (#811, Codex round 3): when a
  // later refresh supplies the real id, the eventId moves off the shared key and
  // the override saved on the id-less row stops matching. Pinned, not endorsed —
  // the alternative is appending the TEAM-DERIVED fabricated id, which loses the
  // override at the TBD -> resolved transition instead.
  const withRealId = build([{ ...items[0]!, id: '401779843' }], {
    [games[0]!.eventId]: { label: 'Applies to both' },
  }).filter((game) => game.playoffRound === 'first-round');
  assert.equal(
    withRealId[0]?.eventId,
    '2025-cfp-first-round-401779843',
    'an id arriving later moves the eventId — the #811 residue'
  );
  assert.equal(
    withRealId[0]?.label,
    null,
    'the override saved on the id-less row no longer matches — the #811 residue'
  );
});

test('an explicitly non-FBS row never gets a derived cfp- key', () => {
  const [storedNonFbs] = build([
    storedFirstRoundRow('401729786', 'Oregon', 'Tulane', '2025-12-20T17:00:00.000Z', {
      homeClassification: 'fcs',
    }),
  ]);
  assert.equal(storedNonFbs?.eventId, '2025-cfp-first-round', 'a stored non-FBS row keeps its key');

  // And at ingest, an FCS "first round" row never mints a cfp- key at all.
  const mapped = mapCfbdScheduleGame(
    {
      id: 401729786,
      week: 1,
      home_team: 'North Dakota State',
      away_team: 'South Dakota State',
      home_classification: 'fcs',
      away_classification: 'fcs',
      start_date: '2025-12-20T17:00:00.000Z',
      notes: 'FCS Championship - First Round',
      game_phase: 'postseason',
    } as CfbdScheduleGame,
    'postseason'
  );
  assert.equal(mapped.ok, true);
  if (mapped.ok) {
    const built = build([mapped.item]);
    assert.ok(built.every((game) => !game.eventId.includes('cfp-')));
  }
});

// Acceptance 4 (revised by ruling): the TBD row and the resolved row CFBD
// issues under the SAME id build the same eventId, so a label override saved
// on the TBD placeholder — the only state the admin button offers it in —
// still applies once the teams are known. Both rows go through the real
// ingest mapper, so the shared key is the one ingest actually produces.
test('a TBD row and its resolved row share one eventId', () => {
  const raw = (home: string, away: string): CfbdScheduleGame =>
    ({
      id: 401779841,
      week: 1,
      home_team: home,
      away_team: away,
      home_classification: home === 'TBD' ? undefined : 'fbs',
      away_classification: away === 'TBD' ? undefined : 'fbs',
      start_date: '2025-12-20T17:00:00.000Z',
      notes: 'College Football Playoff First Round Game',
      season_type: 'postseason',
      game_phase: 'postseason',
    }) as CfbdScheduleGame;

  const tbdMapped = mapCfbdScheduleGame(raw('TBD', 'TBD'), 'postseason');
  const resolvedMapped = mapCfbdScheduleGame(raw('Texas A&M', 'Miami'), 'postseason');
  assert.ok(tbdMapped.ok && resolvedMapped.ok);
  if (!tbdMapped.ok || !resolvedMapped.ok) return;
  assert.equal(tbdMapped.item.eventKey, 'cfp-first-round');
  assert.equal(resolvedMapped.item.eventKey, 'cfp-first-round');

  const [tbd] = build([tbdMapped.item]);
  assert.equal(tbd?.isPlaceholder, true, 'the TBD game is a placeholder');

  const override = { [tbd!.eventId]: { label: 'First Round at College Station' } };
  const [resolved] = build([resolvedMapped.item], override);

  assert.equal(resolved?.isPlaceholder, false, 'the resolved game has its teams');
  assert.equal(resolved?.eventId, tbd?.eventId, 'the eventId holds across resolution');
  assert.equal(resolved?.label, 'First Round at College Station', 'the override still applies');
  assert.equal(tbd?.eventId, '2025-cfp-first-round-401779841', 'the TBD game is keyed on its id');
});

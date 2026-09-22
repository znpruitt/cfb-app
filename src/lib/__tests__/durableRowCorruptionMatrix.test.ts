import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSeasonArchive } from '../seasonRollover.ts';
import { getCanonicalStandings } from '../selectors/leagueStandings.ts';
import type { SeasonArchive } from '../seasonArchive.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  setAppState,
} from '../server/appStateStore.ts';
import {
  __resetTeamDatabaseStoreForTests,
  setTeamDatabaseFile,
} from '../server/teamDatabaseStore.ts';

/**
 * PLATFORM-813 v3 round 1 — the invariant, tested over its INPUT SPACE.
 *
 * **INVARIANT: no corrupted durable row produces an archive or a standings snapshot that
 * reads as complete.** Either the writer REFUSES, or what it records is exactly what the
 * uncorrupted season records.
 *
 * **WHY A MATRIX.** v2 and v3 were each built from a list of the places a row is lost,
 * and each list was incomplete: v2 caught rows dropped at the boundary and missed rows the
 * build discards; v3 caught the build's discards and missed the boundary's drops (F1) and
 * postseason participants blanked into TBD slots (F2). A test written from a list inherits
 * the list's gaps. AGENTS.md: "An invariant over a space must be tested over the space,
 * not over chosen representatives."
 *
 * **THE SPACE**: every row kind (regular, conference championship, postseason) × every
 * string-typed field of `ScheduleWireItem` made non-string × one row or every row of that
 * kind — plus a non-object row. Required fields take a number AND `null` (the type
 * promises a string, so `null` is corruption); optional fields take a number only, because
 * `null` is legitimate absence there, not corruption.
 *
 * **THE ORACLE** compares against the uncorrupted season, not against an expectation
 * written by hand: each game's identity (key, stage, week, both participants, placeholder,
 * status), which games carry an attached score, and the standings — for the ARCHIVE and
 * for live canonical STANDINGS, the two durable writers.
 *
 * **What it found that no list had.** Planning's round-1 list was participant fields.
 * The matrix, run without any refusal, found six fields that change the recorded season:
 * the two participants, `status`, `id` (a conference championship's score stops
 * attaching), and two OPTIONAL fields — `seasonType` (a postseason game moves week) and
 * `eventKey` (its key changes). `LOSSY_COERCIONS` in `durableScheduleRow.ts` is that
 * measured set; this test fails if a field outside it changes a writer's output
 * unreported.
 *
 * **FAILS AGAINST `781c1115`** (v3 before this round), in the cells F1 and F2 describe
 * and in the four the list missed.
 */

const SLUG = 'matrix-league';
const YEAR = 2031;
const MUTABLE_ENV = process.env as Record<string, string | undefined>;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

type Row = Record<string, unknown>;
type Kind = 'regular' | 'conference-championship' | 'postseason';

function row(fields: Row): Row {
  return {
    neutralSite: false,
    conferenceGame: false,
    homeConference: 'SEC',
    awayConference: 'Big Ten',
    status: 'final',
    ...fields,
  };
}

/** Two rows of every kind, so "every row of a kind" can collide rows with each other. */
const SEASON: ReadonlyArray<{ kind: Kind; row: Row }> = [
  {
    kind: 'regular',
    row: row({
      id: 'r1',
      week: 1,
      startDate: `${YEAR}-09-01T18:00:00.000Z`,
      homeTeam: 'Alpha U',
      awayTeam: 'Gamma U',
      seasonType: 'regular',
    }),
  },
  {
    kind: 'regular',
    row: row({
      id: 'r2',
      week: 2,
      startDate: `${YEAR}-09-08T18:00:00.000Z`,
      homeTeam: 'Beta U',
      awayTeam: 'Delta U',
      seasonType: 'regular',
    }),
  },
  {
    kind: 'conference-championship',
    row: row({
      id: 'c1',
      week: 14,
      startDate: `${YEAR}-12-06T18:00:00.000Z`,
      homeTeam: 'Alpha U',
      awayTeam: 'Beta U',
      awayConference: 'SEC',
      seasonType: 'regular',
      gamePhase: 'conference_championship',
      regularSubtype: 'conference_championship',
      conferenceChampionshipConference: 'SEC',
      eventKey: 'sec-championship',
    }),
  },
  {
    kind: 'conference-championship',
    row: row({
      id: 'c2',
      week: 14,
      startDate: `${YEAR}-12-06T22:00:00.000Z`,
      homeTeam: 'Gamma U',
      awayTeam: 'Delta U',
      homeConference: 'Big Ten',
      seasonType: 'regular',
      gamePhase: 'conference_championship',
      regularSubtype: 'conference_championship',
      conferenceChampionshipConference: 'Big Ten',
      eventKey: 'big-ten-championship',
    }),
  },
  {
    kind: 'postseason',
    row: row({
      id: 'p1',
      week: 1,
      startDate: `${YEAR}-12-28T18:00:00.000Z`,
      homeTeam: 'Alpha U',
      awayTeam: 'Delta U',
      neutralSite: true,
      seasonType: 'postseason',
      gamePhase: 'postseason',
      postseasonSubtype: 'bowl',
      bowlName: 'Orange Bowl',
      label: 'Orange Bowl',
      eventKey: 'orange-bowl',
    }),
  },
  {
    kind: 'postseason',
    row: row({
      id: 'p2',
      week: 1,
      startDate: `${YEAR}-12-29T18:00:00.000Z`,
      homeTeam: 'Beta U',
      awayTeam: 'Gamma U',
      neutralSite: true,
      seasonType: 'postseason',
      gamePhase: 'postseason',
      postseasonSubtype: 'bowl',
      bowlName: 'Rose Bowl',
      label: 'Rose Bowl',
      eventKey: 'rose-bowl',
    }),
  },
];

/** Declared non-optional and non-nullable string on `ScheduleWireItem`. */
const REQUIRED = ['id', 'homeTeam', 'awayTeam', 'homeConference', 'awayConference', 'status'];
/** Every other string-admitting field, `venue` included. */
const OPTIONAL = [
  'startDate',
  'label',
  'notes',
  'seasonType',
  'gamePhase',
  'regularSubtype',
  'postseasonSubtype',
  'playoffRound',
  'playoffCompetition',
  'bowlName',
  'conferenceChampionshipConference',
  'eventKey',
  'neutralSiteDisplay',
  'homeClassification',
  'awayClassification',
  'playoffRoundSource',
  'venue',
];
const NON_OBJECT = '<the whole row is null>';

type Cell = { kind: Kind; scope: 'one row' | 'every row'; field: string; value: unknown };

function cells(): Cell[] {
  const out: Cell[] = [];
  for (const kind of ['regular', 'conference-championship', 'postseason'] as const) {
    for (const scope of ['one row', 'every row'] as const) {
      for (const field of REQUIRED) {
        out.push({ kind, scope, field, value: 7 }, { kind, scope, field, value: null });
      }
      for (const field of OPTIONAL) out.push({ kind, scope, field, value: 7 });
      out.push({ kind, scope, field: NON_OBJECT, value: null });
    }
  }
  return out;
}

function corrupt(cell: Cell): unknown[] {
  const targets = SEASON.filter((entry) => entry.kind === cell.kind).slice(
    0,
    cell.scope === 'one row' ? 1 : undefined
  );
  return SEASON.map((entry) => {
    if (!targets.includes(entry)) return entry.row;
    return cell.field === NON_OBJECT ? null : { ...entry.row, [cell.field]: cell.value };
  });
}

async function seed(items: unknown[]): Promise<void> {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  __resetTeamDatabaseStoreForTests();
  await setTeamDatabaseFile({
    source: 'cfbd',
    updatedAt: `${YEAR}-01-01T00:00:00.000Z`,
    items: [
      { school: 'Alpha U', conference: 'SEC' },
      { school: 'Beta U', conference: 'SEC' },
      { school: 'Gamma U', conference: 'Big Ten' },
      { school: 'Delta U', conference: 'Big Ten' },
    ],
  });
  await setAppState('leagues', 'registry', [
    {
      slug: SLUG,
      displayName: 'Matrix League',
      year: YEAR,
      createdAt: `${YEAR - 1}-01-01T00:00:00.000Z`,
      status: { state: 'season', year: YEAR },
    },
  ]);
  await setAppState(
    `owners:${SLUG}:${YEAR}`,
    'csv',
    ['team,owner', 'Alpha U,Ann', 'Beta U,Ben', 'Gamma U,Cal', 'Delta U,Dee'].join('\n')
  );
  await setAppState('schedule', `${YEAR}-all-all`, {
    at: Date.now(),
    items,
    partialFailure: false,
    failedSeasonTypes: [],
  });
  // Scores come from the UNCORRUPTED season: the corruption under test is the schedule's,
  // and every game has a result the writers should record.
  for (const seasonType of ['regular', 'postseason'] as const) {
    await setAppState('scores', `${YEAR}-all-${seasonType}`, {
      at: Date.now(),
      items: SEASON.filter(({ row: r }) => r.seasonType === seasonType).map(({ row: r }) => ({
        id: r.id,
        seasonType,
        startDate: r.startDate,
        week: r.week,
        status: 'final',
        home: { team: r.homeTeam, score: 30 },
        away: { team: r.awayTeam, score: 10 },
        time: null,
      })),
      partialFailure: false,
      failedSeasonTypes: [],
    });
  }
}

type Outcome = { refused: true; message: string } | { refused: false; record: string[] };

function archiveRecord(archive: SeasonArchive): string[] {
  return [
    ...archive.games
      .map((g) =>
        [
          'game',
          g.key,
          g.stage,
          g.week,
          g.canHome,
          g.canAway,
          g.isPlaceholder ? 'placeholder' : 'real',
          g.status,
        ].join('|')
      )
      .sort(),
    ...Object.keys(archive.scoresByKey)
      .sort()
      .map((key) => `scored|${key}`),
    ...archive.finalStandings.map((r) => `standing|${r.owner}|${r.wins}-${r.losses}`).sort(),
  ];
}

async function archiveOutcome(): Promise<Outcome> {
  try {
    return { refused: false, record: archiveRecord(await buildSeasonArchive(SLUG, YEAR)) };
  } catch (error) {
    return { refused: true, message: (error as Error).message };
  }
}

async function standingsOutcome(): Promise<Outcome> {
  try {
    const standings = await getCanonicalStandings({
      slug: SLUG,
      leagueStatusOverride: { state: 'season', year: YEAR },
    });
    return {
      refused: false,
      record: standings.rows.map((r) => `${r.owner}|${r.wins}-${r.losses}`).sort(),
    };
  } catch (error) {
    return { refused: true, message: (error as Error).message };
  }
}

function label(cell: Cell): string {
  return `${cell.kind} / ${cell.scope} / ${cell.field} = ${JSON.stringify(cell.value)}`;
}

test.before(() => {
  // The dev-mode path the other archive tests use: the file-backed store, no database.
  MUTABLE_ENV.NODE_ENV = 'development';
});

test.after(async () => {
  MUTABLE_ENV.NODE_ENV = ORIGINAL_NODE_ENV;
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

test('no corrupted durable row reaches the archive or standings as a complete season', async () => {
  await seed(SEASON.map((entry) => entry.row));
  const baselineArchive = await archiveOutcome();
  const baselineStandings = await standingsOutcome();

  // THE BASELINE MUST BE A REAL SEASON. If the clean fixture refused, or recorded nothing,
  // every cell below would compare against an empty or refused baseline and "pass".
  assert.equal(baselineArchive.refused, false, 'the uncorrupted season archives');
  assert.equal(baselineStandings.refused, false, 'the uncorrupted season derives standings');
  const archiveBase = (baselineArchive as { record: string[] }).record;
  const standingsBase = (baselineStandings as { record: string[] }).record;
  assert.equal(
    archiveBase.filter((line) => line.startsWith('game|')).length,
    SEASON.length,
    'every fixture row is a game'
  );
  assert.equal(
    archiveBase.filter((line) => line.startsWith('scored|')).length,
    SEASON.length,
    'every game carries its score, so a lost score is visible'
  );
  assert.ok(
    archiveBase.includes('game|2031-orange-bowl|bowl|15|Alpha U|Delta U|real|matchup_set'),
    'the postseason rows build as REAL matchups, so a TBD placeholder is a visible change'
  );

  const silent: string[] = [];
  let refusedCells = 0;
  const space = cells();
  for (const cell of space) {
    await seed(corrupt(cell));
    const archive = await archiveOutcome();
    const standings = await standingsOutcome();

    if (archive.refused) refusedCells += 1;
    if (!archive.refused && archive.record.join('\n') !== archiveBase.join('\n')) {
      silent.push(`ARCHIVE    ${label(cell)}`);
    }
    if (!standings.refused && standings.record.join('\n') !== standingsBase.join('\n')) {
      silent.push(`STANDINGS  ${label(cell)}`);
    }
  }

  // THE MEASURED SIZE OF THE SPACE, so a loop that quietly iterated fewer cells cannot
  // pass. 3 kinds × 2 scopes × (6 required × 2 values + 17 optional + 1 non-object).
  assert.equal(space.length, 3 * 2 * (REQUIRED.length * 2 + OPTIONAL.length + 1));
  assert.equal(space.length, 180);
  // And the refusal is not unconditional: most of the space is harmless corruption that
  // must still archive, or a writer that refused everything would pass the invariant.
  assert.ok(
    refusedCells > 0 && refusedCells < space.length / 2,
    `refusal must be discriminating: ${refusedCells} of ${space.length} cells refused`
  );

  assert.deepEqual(
    silent,
    [],
    `a corrupted row changed what a durable writer records, and the writer did not refuse:\n${silent.join('\n')}`
  );
});

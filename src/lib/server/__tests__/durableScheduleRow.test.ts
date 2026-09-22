import assert from 'node:assert/strict';
import test from 'node:test';

import type { ScheduleWireItem } from '../../schedule.ts';
import { mapCfbdScheduleGame, type CfbdScheduleGame } from '../../schedule/cfbdSchedule.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  setAppState,
} from '../appStateStore.ts';
import { loadCanonicalScheduleEntry } from '../canonicalScheduleCache.ts';
import {
  assertConformingScheduleRows,
  ROW_CONTRACT,
  ScheduleRowNonConformanceError,
} from '../durableScheduleRow.ts';

/**
 * PLATFORM-813 v4 — the durable-row contract, tested over the CONTRACT, not over a list of
 * fields somebody thought to check.
 *
 * v2 and v3 tested the fields their audits found, and each review round found another. So the
 * value table below is keyed by EVERY property of `ScheduleWireItem`: `tsc` rejects this file
 * if a field is added to the type without values here, the same way it rejects the validator.
 * The values are written independently of `ROW_CONTRACT` — deriving them from the contract's
 * own predicates would test the table against itself.
 */

type Values = { good: unknown[]; bad: unknown[] };
const STR_OR_NULL: Values = { good: ['x', '', null], bad: [7, true, {}, []] };
const STR: Values = { good: ['x', ''], bad: [null, 7, true, {}, []] };
const NUM: Values = { good: [0, 7, 1.5], bad: ['7', null, true, {}] };
const NUM_OR_NULL: Values = { good: [7, null], bad: ['7', true, {}] };
const BOOL: Values = { good: [true, false], bad: ['true', 0, null, {}] };
const VENUE_INFO = { stadium: 'Stadium', city: null, state: 'TX', country: 'USA' };

const FIELD_VALUES: { [K in keyof Required<ScheduleWireItem>]: Values } = {
  id: STR,
  week: NUM,
  providerWeek: NUM,
  canonicalWeek: NUM,
  startDate: STR_OR_NULL,
  neutralSite: BOOL,
  conferenceGame: BOOL,
  homeTeam: STR,
  awayTeam: STR,
  homeId: NUM_OR_NULL,
  awayId: NUM_OR_NULL,
  homeConference: STR,
  awayConference: STR,
  // Closed union: an OUT-OF-SET string is the case a type check alone would pass.
  homeClassification: { good: ['fbs', 'fcs', 'ii', 'iii'], bad: ['FBS', 'd2', '', null, 7] },
  awayClassification: { good: ['fbs', 'iii'], bad: ['fbs ', 'unknown', null] },
  status: STR,
  completed: BOOL,
  startTimeTBD: BOOL,
  // Nested: VenueInfo is checked field by field — every one of its four fields.
  venue: {
    good: ['Stadium', null, VENUE_INFO],
    bad: [
      7,
      [],
      { ...VENUE_INFO, stadium: 7 },
      { ...VENUE_INFO, city: {} },
      { ...VENUE_INFO, state: false },
      { ...VENUE_INFO, country: 1 },
      { stadium: 'Stadium', city: null, state: null },
    ],
  },
  venueId: NUM,
  // Nested: each media item's fields, and its mediaType closed union.
  media: {
    good: [[], [{ gameId: '1', mediaType: 'tv', outlet: 'ESPN' }]],
    bad: [
      null,
      {},
      [null],
      [{ gameId: 1, mediaType: 'tv', outlet: 'ESPN' }],
      [{ gameId: '1', mediaType: 'cable', outlet: 'ESPN' }],
      [{ gameId: '1', mediaType: 'tv', outlet: null }],
    ],
  },
  label: STR_OR_NULL,
  notes: STR_OR_NULL,
  seasonType: STR_OR_NULL,
  gamePhase: STR_OR_NULL,
  regularSubtype: STR_OR_NULL,
  postseasonSubtype: STR_OR_NULL,
  playoffRound: STR_OR_NULL,
  // `string`, NOT nullable — the writer omits it rather than storing null.
  playoffCompetition: STR,
  playoffRoundSource: {
    good: ['cfbd-structured', 'explicit-provider-field', 'text-inferred'],
    bad: ['CFBD-structured', 'guessed', null, 7],
  },
  bowlName: STR_OR_NULL,
  conferenceChampionshipConference: STR_OR_NULL,
  eventKey: STR_OR_NULL,
  slotOrder: NUM_OR_NULL,
  neutralSiteDisplay: STR_OR_NULL,
};

const REQUIRED = Object.entries(ROW_CONTRACT)
  .filter(([, spec]) => spec.required)
  .map(([field]) => field);

/** One conforming row per row KIND the build branches on — including a playoff game. */
const ROW_KINDS: Record<string, ScheduleWireItem> = {
  regular: {
    id: 'g-reg',
    week: 1,
    startDate: '2031-09-01T18:00:00.000Z',
    neutralSite: false,
    conferenceGame: true,
    homeTeam: 'Alpha U',
    awayTeam: 'Beta U',
    homeConference: 'SEC',
    awayConference: 'SEC',
    status: 'final',
    seasonType: 'regular',
    gamePhase: 'regular',
  },
  'conference championship': {
    id: 'g-ccg',
    week: 14,
    startDate: '2031-12-06T18:00:00.000Z',
    neutralSite: true,
    conferenceGame: true,
    homeTeam: 'Alpha U',
    awayTeam: 'Beta U',
    homeConference: 'SEC',
    awayConference: 'SEC',
    status: 'final',
    seasonType: 'regular',
    gamePhase: 'conference_championship',
    regularSubtype: 'conference_championship',
    conferenceChampionshipConference: 'SEC',
    eventKey: 'sec-championship',
  },
  postseason: {
    id: 'g-cfp',
    week: 1,
    startDate: '2032-01-10T00:00:00.000Z',
    neutralSite: true,
    conferenceGame: false,
    homeTeam: 'Alpha U',
    awayTeam: 'Gamma U',
    homeConference: 'SEC',
    awayConference: 'Big Ten',
    status: 'final',
    seasonType: 'postseason',
    gamePhase: 'postseason',
    postseasonSubtype: 'playoff',
    playoffRound: 'national_championship',
    playoffCompetition: 'College Football Playoff',
    playoffRoundSource: 'cfbd-structured',
  },
};

function with_(row: ScheduleWireItem, field: string, value: unknown): Record<string, unknown> {
  return { ...row, [field]: value };
}
function without(row: ScheduleWireItem, field: string): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...row };
  delete copy[field];
  return copy;
}

function assertNonConformance(
  error: unknown,
  expected: { key: string; index: number | null; field: string }
): true {
  assert.ok(error instanceof ScheduleRowNonConformanceError, `typed error, got ${String(error)}`);
  assert.equal(error.key, expected.key, 'names the durable key');
  assert.equal(error.index, expected.index, 'names the row position');
  assert.equal(error.field, expected.field, 'names the field');
  assert.ok(error.observed.length > 0, 'names the observed type');
  assert.match(error.message, new RegExp(`schedule ${expected.key}:`));
  assert.ok(error.message.includes(expected.field), 'the message names the field');
  return true;
}

// ---------------------------------------------------------------------------
// The validator itself
// ---------------------------------------------------------------------------

test('a conforming row is returned UNCHANGED — the same object, no coercion', () => {
  for (const row of Object.values(ROW_KINDS)) {
    const items = [row];
    const out = assertConformingScheduleRows('k', items);
    assert.equal(out, items, 'the same array');
    assert.equal(out[0], row, 'the same row object');
  }
});

test('an empty array conforms — genuine absence is a real state', () => {
  assert.deepEqual(assertConformingScheduleRows('k', []), []);
});

test('every field accepts every value its declared type admits, in every row kind', () => {
  // The over-rejection half. A validator that rejected a legal value would take a
  // well-typed season down; this is what proves the contract is not stricter than the type.
  for (const [kind, row] of Object.entries(ROW_KINDS)) {
    for (const [field, { good }] of Object.entries(FIELD_VALUES)) {
      for (const value of good) {
        assert.doesNotThrow(
          () => assertConformingScheduleRows('k', [with_(row, field, value)]),
          `${kind}: ${field} = ${JSON.stringify(value)} must conform`
        );
      }
    }
  }
});

test('every OPTIONAL field may be absent; every REQUIRED one may not', () => {
  for (const [kind, row] of Object.entries(ROW_KINDS)) {
    for (const field of Object.keys(ROW_CONTRACT)) {
      const attempt = () => assertConformingScheduleRows('k', [without(row, field)]);
      if (REQUIRED.includes(field)) {
        assert.throws(attempt, (e) => assertNonConformance(e, { key: 'k', index: 0, field }));
      } else {
        assert.doesNotThrow(attempt, `${kind}: an absent ${field} conforms`);
      }
    }
  }
  // Pinned so a contract that silently lost its required set cannot pass the loop above.
  assert.deepEqual([...REQUIRED].sort(), [
    'awayConference',
    'awayTeam',
    'conferenceGame',
    'homeConference',
    'homeTeam',
    'id',
    'neutralSite',
    'startDate',
    'status',
    'week',
  ]);
});

test('a non-object row and a non-array container are non-conformance too', () => {
  for (const bad of [null, 7, 'row', [], true]) {
    assert.throws(
      () => assertConformingScheduleRows('k', [ROW_KINDS.regular, bad]),
      (e) => assertNonConformance(e, { key: 'k', index: 1, field: '<row>' })
    );
  }
  for (const bad of ['not-an-array', 7, {}, null]) {
    assert.throws(
      () => assertConformingScheduleRows('k', bad),
      (e) => assertNonConformance(e, { key: 'k', index: null, field: 'items' })
    );
  }
});

test('the error carries the row id when the row has a usable one', () => {
  assert.throws(
    () => assertConformingScheduleRows('2031-all-all', [with_(ROW_KINDS.regular, 'homeTeam', 7)]),
    (e: Error) => {
      assert.match(
        e.message,
        /schedule 2031-all-all: row #0 \(id "g-reg"\) homeTeam is number, expected string/
      );
      return true;
    }
  );
});

// ---------------------------------------------------------------------------
// ACCEPTANCE 1 — through the canonical reader, both construction paths
// ---------------------------------------------------------------------------

async function freshStore(): Promise<void> {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
}

type Path = { name: string; key: string; seed: (items: unknown[]) => Promise<void> };
const YEAR = 2031;
const PATHS: Path[] = [
  {
    name: 'aggregate',
    key: `${YEAR}-all-all`,
    seed: async (items) => {
      await setAppState('schedule', `${YEAR}-all-all`, {
        at: 1,
        items,
        partialFailure: false,
        failedSeasonTypes: [],
      });
    },
  },
  {
    // The pair path builds its entry inline, so it is the second place a check could be
    // forgotten. The bad row sits in the POSTSEASON partition, behind a clean regular one,
    // so the error must name the partition that holds it.
    name: 'partition pair',
    key: `${YEAR}-all-postseason`,
    seed: async (items) => {
      await setAppState('schedule', `${YEAR}-all-regular`, {
        at: 1,
        items: [ROW_KINDS.regular],
        partialFailure: false,
        failedSeasonTypes: [],
      });
      await setAppState('schedule', `${YEAR}-all-postseason`, {
        at: 1,
        items,
        partialFailure: false,
        failedSeasonTypes: [],
      });
    },
  },
];

test('ACCEPTANCE 1: every non-conforming field, in every row kind, through both reader paths, throws naming key, row, field and type', async () => {
  let cells = 0;
  for (const path of PATHS) {
    for (const [kind, row] of Object.entries(ROW_KINDS)) {
      for (const [field, { bad }] of Object.entries(FIELD_VALUES)) {
        for (const value of bad) {
          await freshStore();
          // The bad row is SECOND, behind a conforming one, so "the first row is fine" is
          // never mistaken for "the season is fine".
          await path.seed([ROW_KINDS.regular, with_(row, field, value)]);
          await assert.rejects(
            () => loadCanonicalScheduleEntry(YEAR),
            (e) => assertNonConformance(e, { key: path.key, index: 1, field }),
            `${path.name} / ${kind} / ${field} = ${JSON.stringify(value)}`
          );
          cells += 1;
        }
      }
      for (const field of REQUIRED) {
        await freshStore();
        await path.seed([ROW_KINDS.regular, without(row, field)]);
        await assert.rejects(
          () => loadCanonicalScheduleEntry(YEAR),
          (e) => assertNonConformance(e, { key: path.key, index: 1, field }),
          `${path.name} / ${kind} / missing ${field}`
        );
        cells += 1;
      }
      await freshStore();
      await path.seed([ROW_KINDS.regular, null]);
      await assert.rejects(
        () => loadCanonicalScheduleEntry(YEAR),
        (e) => assertNonConformance(e, { key: path.key, index: 1, field: '<row>' })
      );
      cells += 1;
    }
  }
  // The measured size of the space, so a loop that quietly iterated less cannot pass.
  const badValues = Object.values(FIELD_VALUES).reduce((n, { bad }) => n + bad.length, 0);
  assert.equal(
    cells,
    PATHS.length * Object.keys(ROW_KINDS).length * (badValues + REQUIRED.length + 1)
  );
});

test('ACCEPTANCE 1 control: the same seeding with conforming rows reads cleanly on both paths', async () => {
  // Without this, a reader that rejected EVERYTHING would satisfy the test above.
  for (const path of PATHS) {
    await freshStore();
    await path.seed(Object.values(ROW_KINDS));
    const entry = await loadCanonicalScheduleEntry(YEAR);
    assert.ok(entry && entry.items.length > 0, `${path.name} serves conforming rows`);
  }
});

// ---------------------------------------------------------------------------
// ACCEPTANCE 8 — the WRITER never produces a row the reader would reject
// ---------------------------------------------------------------------------

/**
 * Every provider field `mapCfbdScheduleGame` can be handed, compile-checked against the
 * provider type: adding a field to `CfbdScheduleGame` fails `tsc` here until it is covered.
 * `startDate` was found by reading every field by hand; this finds the next one without
 * anyone having to.
 */
const PROVIDER_FIELDS: { [K in keyof Required<CfbdScheduleGame>]: true } = {
  id: true,
  week: true,
  start_date: true,
  startDate: true,
  neutral_site: true,
  neutralSite: true,
  conference_game: true,
  conferenceGame: true,
  home_team: true,
  away_team: true,
  homeTeam: true,
  awayTeam: true,
  home_points: true,
  away_points: true,
  homePoints: true,
  awayPoints: true,
  home_score: true,
  away_score: true,
  home_id: true,
  homeId: true,
  away_id: true,
  awayId: true,
  home_conference: true,
  away_conference: true,
  homeConference: true,
  awayConference: true,
  home_classification: true,
  homeClassification: true,
  away_classification: true,
  awayClassification: true,
  status: true,
  completed: true,
  start_time_tbd: true,
  startTimeTBD: true,
  venue: true,
  venue_id: true,
  venueId: true,
  venue_city: true,
  venueCity: true,
  venue_state: true,
  venueState: true,
  venue_country: true,
  venueCountry: true,
  notes: true,
  name: true,
  season_type: true,
  seasonType: true,
  game_phase: true,
  gamePhase: true,
  regular_subtype: true,
  regularSubtype: true,
  postseason_subtype: true,
  postseasonSubtype: true,
  playoff_round: true,
  playoffRound: true,
  playoff_competition: true,
  playoffCompetition: true,
  playoff: true,
  bowl_name: true,
  bowlName: true,
  conference_championship_conference: true,
  conferenceChampionshipConference: true,
  event_key: true,
  eventKey: true,
  slot_order: true,
  slotOrder: true,
  neutral_site_display: true,
  neutralSiteDisplay: true,
};

/** Hostile values: wrong types, out-of-set strings, and strings that look structured. */
const ADVERSARIAL: unknown[] = [
  7,
  0,
  -1,
  1.5,
  true,
  false,
  null,
  {},
  [],
  ['x'],
  { round: 7, competition: 7 },
  { round: 'national_championship', competition: 'College Football Playoff' },
  '',
  ' ',
  'x',
  'FBS',
  'fbs',
  'not a date',
  '2031-09-01T18:00:00.000Z',
  '0401779840',
  'national_championship',
  'conference_championship',
  'postseason',
  'playoff',
  'Orange Bowl',
];

const PROVIDER_BASES: Record<string, CfbdScheduleGame> = {
  regular: {
    id: 401,
    week: 1,
    start_date: '2031-09-01T18:00:00.000Z',
    home_team: 'Alpha U',
    away_team: 'Beta U',
    home_conference: 'SEC',
    away_conference: 'SEC',
    home_classification: 'fbs',
    away_classification: 'fbs',
    status: 'final',
  },
  'conference championship': {
    id: 402,
    week: 14,
    start_date: '2031-12-06T18:00:00.000Z',
    home_team: 'Alpha U',
    away_team: 'Beta U',
    home_conference: 'SEC',
    away_conference: 'SEC',
    game_phase: 'conference_championship',
    notes: 'SEC Championship',
  },
  playoff: {
    id: 403,
    week: 1,
    start_date: '2032-01-10T00:00:00.000Z',
    home_team: 'Alpha U',
    away_team: 'Gamma U',
    game_phase: 'postseason',
    playoff: { round: 'national_championship', competition: 'College Football Playoff' },
  },
};

test('ACCEPTANCE 8: every row the writer produces from adversarial provider input conforms', () => {
  const failures: string[] = [];
  const throwingFields = new Set<string>();
  let rows = 0;
  for (const seasonType of ['regular', 'postseason'] as const) {
    for (const [kind, base] of Object.entries(PROVIDER_BASES)) {
      for (const field of Object.keys(PROVIDER_FIELDS)) {
        for (const value of ADVERSARIAL) {
          let mapped: ReturnType<typeof mapCfbdScheduleGame>;
          try {
            mapped = mapCfbdScheduleGame(
              { ...base, [field]: value } as CfbdScheduleGame,
              seasonType
            );
          } catch {
            // A THROW stores nothing, so it cannot violate the contract — the refresh fails
            // loudly instead. Recorded, not counted as non-conformance; pinned below.
            throwingFields.add(field);
            continue;
          }
          if (!mapped.ok) continue; // a dropped row stores nothing, so it cannot violate
          rows += 1;
          try {
            assertConformingScheduleRows('k', [mapped.item]);
          } catch (e) {
            failures.push(
              `${seasonType} / ${kind} / ${field} = ${JSON.stringify(value)}: ${(e as Error).message}`
            );
          }
        }
      }
    }
  }
  // Coverage: most adversarial inputs still map to a row, so this looked at the writer's
  // output rather than at a mapper that dropped everything.
  assert.ok(rows > 5000, `the writer produced ${rows} rows to check`);
  assert.deepEqual(failures.slice(0, 10), [], `${failures.length} non-conforming rows`);

  // PRE-EXISTING, and separate from conformance: a non-string provider `name` or `notes`
  // makes the mapper THROW at `conferenceChampionships.ts:39` (`normalizeConferenceIdentity`
  // calls `.toLowerCase` on the raw value). Loud — nothing is stored and the partition
  // refresh fails, exactly as on `main` — so not v4's to fix. Pinned as a SET so a new
  // throwing field surfaces here, and so fixing it updates this line deliberately.
  assert.deepEqual([...throwingFields].sort(), ['name', 'notes']);
});

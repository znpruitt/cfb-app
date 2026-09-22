import assert from 'node:assert/strict';
import test from 'node:test';

import { METHOD_CALLED_FIELDS, validateDurableScheduleRows } from '../durableScheduleRow.ts';
import { loadCachedScheduleItems } from '../canonicalScheduleCache.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  setAppState,
} from '../appStateStore.ts';
import { buildScheduleFromApi, type ScheduleWireItem } from '../../schedule.ts';
import { classifyScheduleRow } from '../../postseason-classify.ts';

/**
 * PLATFORM-813 v2 — the row is validated once, at the boundary.
 *
 * **These tests are the only evidence.** Nothing writes a non-string field today, so
 * no live data fails if the validation is wrong; every fixture is constructed
 * deliberately. Each per-field case was confirmed to FAIL against the pre-fix code
 * with `TypeError: ... is not a function`.
 *
 * **PER FIELD, NOT PER CLASS.** v1 asserted the class and covered one field; the
 * reviewers then found the next field four times across two rounds. The ten fields
 * below are the MEASURED surface — resolved by the TypeScript checker rather than by
 * a regex, because `?? ''` and `?.` catch absence while still throwing on a number,
 * so the guarded-looking forms were exactly the unguarded ones.
 */

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

/** The values a durable JSON row can actually hold in a string-typed field. */
const MALFORMED: Array<[label: string, value: unknown]> = [
  ['a JSON number', 401779840],
  ['a float', 1.5],
  ['zero', 0],
  ['an object', { nested: true }],
  ['an array', ['x']],
  ['a boolean', true],
];

function row(overrides: Record<string, unknown> = {}): ScheduleWireItem {
  return {
    id: '401779840',
    week: 1,
    startDate: '2027-09-01T00:00:00.000Z',
    neutralSite: false,
    conferenceGame: false,
    homeTeam: 'Texas',
    awayTeam: 'Rice',
    homeConference: 'SEC',
    awayConference: 'American',
    status: 'scheduled',
    seasonType: 'regular',
    gamePhase: 'regular',
    ...overrides,
  } as unknown as ScheduleWireItem;
}

// --- The validator itself ----------------------------------------------------

test('every one of the ten audited fields is coerced when non-string', () => {
  // The population assertion. If a field is dropped from METHOD_CALLED_FIELDS, this
  // stops covering it — so the list and the coverage cannot drift apart silently.
  assert.equal(METHOD_CALLED_FIELDS.length, 10, 'the audited surface is ten fields');

  for (const field of METHOD_CALLED_FIELDS) {
    for (const [label, value] of MALFORMED) {
      const { items } = validateDurableScheduleRows([row({ [field]: value })]);
      assert.equal(
        (items[0] as unknown as Record<string, unknown>)[field],
        '',
        `${field} holding ${label} must coerce to an empty string`
      );
    }
  }
});

test('absent and null are LEFT ALONE, and that is not an oversight', () => {
  // Coercing `undefined` to `''` would make an absent field indistinguishable from a
  // present-but-empty one. Every consumer already handles absence — `?.` and `?? ''`
  // do work for it — so absence is not this slice's to change.
  const { items } = validateDurableScheduleRows([
    row({ label: null, bowlName: undefined, eventKey: null }),
  ]);
  const out = items[0] as unknown as Record<string, unknown>;
  assert.equal(out.label, null);
  assert.equal(out.bowlName, undefined);
  assert.equal(out.eventKey, null);
});

test('a well-formed row is returned by reference, unmodified', () => {
  // Positive control for the whole file: a validator that rebuilt or blanked every
  // row would satisfy the coercion assertions above while destroying real data.
  const input = row();
  const { items } = validateDurableScheduleRows([input]);
  assert.equal(items[0], input, 'no copy is made when nothing needs coercing');
});

test('venue keeps an object, because an object is legitimate there', () => {
  // `venue` is `VenueInfo | string | null`. Coercing an object to '' would destroy
  // real venue data — this is why venue is handled apart from the string fields.
  const venue = { stadium: 'DKR', city: 'Austin', state: 'TX', country: 'USA' };
  const { items } = validateDurableScheduleRows([row({ venue })]);
  assert.deepEqual((items[0] as unknown as Record<string, unknown>).venue, venue);

  // But a number is wrong for venue too, and becomes null rather than ''.
  const bad = validateDurableScheduleRows([row({ venue: 42 })]);
  assert.equal((bad.items[0] as unknown as Record<string, unknown>).venue, null);
});

test('non-object rows are discarded and the survivor is repaired', () => {
  // One number cannot carry both questions. "six fields were repaired" and "six rows
  // were discarded" have different consequences: a dropped row changes the season's
  // content, a coerced field changes one value in a row that survives.
  const { items } = validateDurableScheduleRows([null, 'x', 7, row({ homeTeam: 5, status: 9 })]);
  assert.equal(items.length, 1, 'only the real row survives');
});

test('a season whose EVERY row was dropped is unreadable, not empty', async () => {
  // THE DECISIVE CASE. `nationalChampionshipRollover` records
  // `{ kind: 'skip', reason: 'no-season-schedule' }` for `[]` — so collapsing
  // corruption into `[]` would write "this season has no schedule" into a durable
  // receipt when the truth is "the schedule was unreadable". Throwing also preserves
  // what production already did: `[null]` threw on `row.homeTeam.trim()` before this
  // slice existed.
  await setAppState('schedule', '2031-all-all', { at: 5, items: [null, 3] });
  await assert.rejects(
    () => loadCachedScheduleItems(2031),
    (err: Error) => {
      assert.equal(err.name, 'SeasonScheduleUnreadableError');
      assert.match(err.message, /could not be read as rows/);
      assert.match(err.message, /unreadable, not empty/);
      return true;
    }
  );
});

test('an EMPTY stored array is still genuine absence, not unreadable', async () => {
  // The discriminating control. A throw on every zero-row read would satisfy the test
  // above while breaking the ordinary no-schedule state, which is a real state that
  // consumers legitimately skip on.
  await setAppState('schedule', '2031-all-all', { at: 5, items: [] });
  assert.deepEqual(await loadCachedScheduleItems(2031), [], 'absence stays absence');
});

test('a PARTIAL drop still serves the surviving rows', async () => {
  // The other boundary of the same decision: some rows unusable is not the whole
  // season unreadable, so the survivors must still reach consumers.
  await setAppState('schedule', '2031-all-all', {
    at: 5,
    items: [null, { id: 'g1', week: 1, homeTeam: 'Texas', awayTeam: 'Rice', status: 'final' }],
  });
  const items = await loadCachedScheduleItems(2031);
  assert.equal(items.length, 1, 'the usable row survives a partial drop');
});

// --- The build, which is what the fields actually took down --------------------

test('PER FIELD: a non-string value in any audited field cannot take down the build', () => {
  // The blast-radius assertion. Each of these threw out of `buildScheduleFromApi`'s
  // per-row loop before the boundary validated, taking standings, Insights, the draft
  // board, odds, live scores and archives with it — not one row.
  for (const field of METHOD_CALLED_FIELDS) {
    const validated = validateDurableScheduleRows([
      row({ [field]: 401779840, gamePhase: 'postseason', seasonType: 'postseason' }),
    ]);
    const built = buildScheduleFromApi({
      scheduleItems: validated.items,
      teams: [],
      aliasMap: {},
      season: 2027,
    });
    assert.equal(built.games.length, 1, `${field} holding a number must not fail the build`);
  }
});

test('PER FIELD: classifyScheduleRow survives a non-string value in any audited field', () => {
  // The second reader, and the one that reads FIRST: `looksEmptyRow` calls
  // `row.homeTeam.trim()` on the opening line of `classifyScheduleRow`, ahead of every
  // guard v1 added. A guard a sibling read jumps in front of is not a guard.
  for (const field of METHOD_CALLED_FIELDS) {
    const validated = validateDurableScheduleRows([
      row({ [field]: 401779840, gamePhase: 'postseason', seasonType: 'postseason' }),
    ]);
    assert.doesNotThrow(
      () => classifyScheduleRow(validated.items[0]!, 2027),
      `${field} holding a number must not throw out of classifyScheduleRow`
    );
  }
});

test('a numeric homeTeam becomes an empty name, and the EXISTING rule drops it', () => {
  // The drop decision stays where it already is. `looksEmptyRow` → `invalid_row` is
  // the rule that has always dropped nameless rows; coercion feeds it rather than the
  // boundary inventing a second drop rule whose absence from standings nobody records.
  const validated = validateDurableScheduleRows([row({ homeTeam: 12345 })]);
  const classified = classifyScheduleRow(validated.items[0]!, 2027);
  assert.deepEqual(classified, { kind: 'invalid_row', reason: 'empty participant names' });
});

test('a non-string status still classifies, and an ABSENT status still classifies', () => {
  // Paired on purpose (PLATFORM-813 ruling 3). `mapStatus`'s `|| ''` covers ABSENCE
  // and the boundary covers TYPE; neither may be removed on the belief that the other
  // protects it, so both halves are asserted here.
  const typed = validateDurableScheduleRows([row({ status: 99 })]);
  const builtTyped = buildScheduleFromApi({
    scheduleItems: typed.items,
    teams: [],
    aliasMap: {},
    season: 2027,
  });
  assert.equal(builtTyped.games.length, 1, 'a numeric status survives the build');

  const absent = validateDurableScheduleRows([row({ status: undefined })]);
  const builtAbsent = buildScheduleFromApi({
    scheduleItems: absent.items,
    teams: [],
    aliasMap: {},
    season: 2027,
  });
  assert.equal(builtAbsent.games.length, 1, 'an absent status survives the build');
});

// ---------------------------------------------------------------------------
// PLATFORM-813 v2 review round 1.
// ---------------------------------------------------------------------------

test('null and undefined in a REQUIRED field are malformed, not absence', () => {
  // Codex P2-1. The first version skipped null/undefined for EVERY field on the
  // reasoning that absence is legitimate — true of the optional fields, false of
  // these, where the type promises a string is always present. `row.homeTeam.trim()`
  // throws on null exactly as it throws on a number, and the fixture that should have
  // caught it held six malformed values, none of them null, for the same wrong reason.
  for (const field of [
    'homeTeam',
    'awayTeam',
    'id',
    'homeConference',
    'awayConference',
    'status',
  ]) {
    for (const bad of [null, undefined]) {
      const { items } = validateDurableScheduleRows([row({ [field]: bad })]);
      assert.equal(
        (items[0] as unknown as Record<string, unknown>)[field],
        '',
        `${field} = ${String(bad)} must coerce, because the type says it is always present`
      );
    }
  }
});

test('null in an OPTIONAL field is still left alone', () => {
  // The discriminating control for the split. A validator that coerced every
  // null/undefined would pass the test above while destroying the absent-vs-empty
  // distinction the optional fields depend on.
  const { items } = validateDurableScheduleRows([
    row({ label: null, eventKey: null, bowlName: undefined }),
  ]);
  const out = items[0] as unknown as Record<string, unknown>;
  assert.equal(out.label, null);
  assert.equal(out.eventKey, null);
  assert.equal(out.bowlName, undefined);
});

test('a null homeTeam takes the existing drop path rather than the build down', () => {
  const validated = validateDurableScheduleRows([row({ homeTeam: null })]);
  assert.doesNotThrow(() =>
    buildScheduleFromApi({
      scheduleItems: validated.items,
      teams: [],
      aliasMap: {},
      season: 2027,
    })
  );
  assert.deepEqual(classifyScheduleRow(validated.items[0]!, 2027), {
    kind: 'invalid_row',
    reason: 'empty participant names',
  });
});

test('a NON-ARRAY items is UNREADABLE, not an empty season', () => {
  // v2 returned `0/0` here, which the boundary read as "measured, nothing wrong" — a fix
  // that recreated the collapse it was added to fix. The verdict is what distinguishes a
  // container that could not be read from a season that genuinely has no rows.
  for (const notAnArray of [{ a: 1 }, 'rows', 42, true]) {
    const result = validateDurableScheduleRows(notAnArray);
    assert.deepEqual(result.items, [], `${JSON.stringify(notAnArray)} yields no rows`);
    assert.equal(
      result.unreadableContainer,
      true,
      `${JSON.stringify(notAnArray)} is unreadable, not empty`
    );
  }

  // The discriminating control: a genuinely empty array is NOT unreadable.
  const empty = validateDurableScheduleRows([]);
  assert.deepEqual(empty.items, []);
  assert.equal(empty.unreadableContainer, false, 'an empty array is real absence');
});

test('the field lists cover every string-admitting field of the type', () => {
  // The claim that was wrong. Its first version said "20 of 35, MEASURED" while the
  // array held 19 and omitted three — because the enumeration behind it tested whether
  // each field's type ANNOTATION contained the substring `string`, so
  // `ProviderClassification` and `playoffRoundSource`'s union were never counted.
  // I measured the annotation, not the type.
  for (const field of ['homeClassification', 'awayClassification', 'playoffRoundSource']) {
    const { items } = validateDurableScheduleRows([row({ [field]: 7 })]);
    assert.equal(
      (items[0] as unknown as Record<string, unknown>)[field],
      '',
      `${field} is string-typed and must be covered`
    );
  }
});

test('a PARTIAL drop does not throw — the season is usable and continues', async () => {
  // The ruling, and the reason option 1 was rejected: `buildScheduleFromApi`'s per-row
  // loop has no try/catch, so one bad row already took down the whole build. Throwing
  // on a partial drop would restore precisely the defect #813 was filed about.
  await setAppState('schedule', '2031-all-all', {
    at: Date.now(),
    items: [null, { id: 'g1', week: 1, homeTeam: 'Texas', awayTeam: 'Rice', status: 'final' }],
  });
  const items = await loadCachedScheduleItems(2031);
  assert.equal(items.length, 1, 'the usable row is served rather than the season failing');
});

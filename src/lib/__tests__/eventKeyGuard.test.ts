import test from 'node:test';
import assert from 'node:assert/strict';

import { buildScheduleFromApi, type ScheduleWireItem } from '../schedule.ts';
import {
  buildConferenceChampionshipEventKey,
  normalizedEventKey,
} from '../schedulePostseasonHelpers.ts';
import { classifyScheduleRow } from '../postseason-classify.ts';

/**
 * PLATFORM-813 — a durable row's `eventKey` is read without validation, and a
 * non-string value threw.
 *
 * **These tests are the only evidence the defect is fixed, because it is
 * unreachable in production today**: nothing writes a numeric `eventKey`, so no
 * live data will fail if the guard is wrong. The fixtures therefore construct the
 * malformed row deliberately, and each one was confirmed to FAIL against the
 * pre-fix code (`item.eventKey?.trim()` / `(row.eventKey ?? '').trim()`) with
 * `TypeError: ...trim is not a function`.
 *
 * The trigger is narrower than the blast radius: only a POSTSEASON row reaches
 * these reads, but the throw happens inside `buildScheduleFromApi`'s per-row loop,
 * so one bad row takes down the WHOLE build rather than dropping itself.
 */

const MALFORMED_VALUES: Array<[label: string, value: unknown]> = [
  ['a JSON number', 401779840],
  ['a float', 1.5],
  ['an object', { key: 'cfp-first-round' }],
  ['an array', ['cfp-first-round']],
  ['a boolean', true],
];

/**
 * Any `.eventKey` read that reaches a STRING METHOD, however it is spelled.
 *
 * REWRITTEN AT REVIEW, and the first version is the lesson. It matched only two
 * observed renderings — `eventKey?.` and `eventKey ?? ''` followed by `)` — so it
 * caught 1 of 3 real shapes. It MISSED a bare `game.eventKey.trim()`, which is the
 * spelling a future author is most likely to write, because `AppGame.eventKey` is
 * declared non-optional `string` and typechecks cleanly; and it missed a
 * double-quoted `(x.eventKey ?? "").trim()` because it hardcoded `''`.
 *
 * That is this repo's recurring check-design failure — keying on how the code
 * currently LOOKS instead of on the question being asked — the same one `CLAUDE.md`
 * records correcting three times on the review diff-base rule. This version keys on
 * the question: does a string method get applied to something derived from
 * `.eventKey` on this line, whatever punctuation intervenes.
 *
 * A false positive here is a loud failure that a comment can resolve; a false
 * negative is the defect walking back in, so the pattern errs wide on purpose.
 */
const STRING_METHODS =
  'trim|toLowerCase|toUpperCase|startsWith|endsWith|slice|substring|replace|replaceAll|split|padStart|padEnd|charAt|includes|indexOf|match|normalize';
const UNGUARDED_EVENT_KEY_READ = new RegExp(
  `\\.eventKey\\b[^;\\n]*?\\.\\s*(?:${STRING_METHODS})\\s*\\(`
);

function postseasonRow(eventKey: unknown): ScheduleWireItem {
  return {
    id: '401779840',
    week: 16,
    startDate: '2027-12-20T00:00:00.000Z',
    neutralSite: true,
    conferenceGame: false,
    homeTeam: 'Texas',
    awayTeam: 'Georgia',
    homeConference: 'SEC',
    awayConference: 'SEC',
    status: 'scheduled',
    seasonType: 'postseason',
    gamePhase: 'postseason',
    postseasonSubtype: 'playoff',
    // The whole point: the durable row is cast to `ScheduleWireItem` with no runtime
    // validation, so this field can hold any JSON value despite its declared type.
    eventKey: eventKey as string | null | undefined,
  };
}

test('the normalizer treats every non-string as absent, never throwing', () => {
  for (const [label, value] of MALFORMED_VALUES) {
    assert.equal(normalizedEventKey(value), '', `${label} must normalize to absent`);
  }
  assert.equal(normalizedEventKey(null), '');
  assert.equal(normalizedEventKey(undefined), '');
  // Strings keep today's exact behaviour, including the trim.
  assert.equal(normalizedEventKey('  cfp-first-round  '), 'cfp-first-round');
  assert.equal(normalizedEventKey('   '), '', 'a whitespace-only key is absent, as before');
});

test('CALL SITE 1 — buildScheduleFromApi survives a malformed eventKey on a postseason row', () => {
  for (const [label, value] of MALFORMED_VALUES) {
    const built = buildScheduleFromApi({
      scheduleItems: [postseasonRow(value)],
      teams: [],
      aliasMap: {},
      season: 2027,
    });
    // The build completes at all — this is the assertion that threw before the fix.
    assert.equal(built.games.length, 1, `${label} must not take down the build`);
    // And the row falls back to its derived key rather than adopting the bad value.
    assert.ok(
      built.games[0]!.eventKey.length > 0,
      `${label} must fall back to a derived event key`
    );
    assert.equal(
      built.games[0]!.eventKey.includes('[object'),
      false,
      `${label} must never be stringified into the key`
    );
  }
});

test('CALL SITE 2 — classifyScheduleRow survives a malformed eventKey', () => {
  for (const [label, value] of MALFORMED_VALUES) {
    const classified = classifyScheduleRow(postseasonRow(value), 2027);
    assert.ok(classified, `${label} must classify rather than throw`);
    if (classified && 'eventKey' in classified) {
      assert.ok(classified.eventKey.length > 0, `${label} must receive a derived stable event key`);
    }
  }
});

test('CALL SITE 3 — buildConferenceChampionshipEventKey survives a malformed eventKey', () => {
  for (const [label, value] of MALFORMED_VALUES) {
    const row: ScheduleWireItem = {
      ...postseasonRow(value),
      gamePhase: 'conference_championship',
      conferenceChampionshipConference: 'SEC',
    };
    const key = buildConferenceChampionshipEventKey(row);
    assert.equal(key, 'sec-championship', `${label} must fall back to the conference slug`);
  }
});

test('a good string eventKey is still honoured at every call site', () => {
  // The positive control. Without this, a guard that returned '' unconditionally
  // would pass every assertion above while destroying real event identity.
  assert.equal(normalizedEventKey('cfp-semifinal'), 'cfp-semifinal');

  const built = buildScheduleFromApi({
    scheduleItems: [postseasonRow('cfp-semifinal')],
    teams: [],
    aliasMap: {},
    season: 2027,
  });
  assert.equal(built.games[0]!.eventKey, 'cfp-semifinal');

  const classified = classifyScheduleRow(postseasonRow('cfp-semifinal'), 2027);
  assert.ok(classified && 'eventKey' in classified);
  if (classified && 'eventKey' in classified) {
    assert.equal(classified.eventKey, 'cfp-semifinal');
  }

  assert.equal(
    buildConferenceChampionshipEventKey({
      ...postseasonRow('big12-championship'),
      gamePhase: 'conference_championship',
      conferenceChampionshipConference: 'Big 12',
    }),
    'big12-championship'
  );
});

test('no unguarded eventKey read remains in src/', async () => {
  // The coverage assertion. Fixing three call sites does not stop a FOURTH being
  // added with `?.trim()`, and that is exactly how this defect survived #708 — the
  // sibling `id` read was guarded while `eventKey` beside it was not. This fails if
  // any file reads `eventKey` with a string method outside the shared normalizer.
  const { readdir, readFile } = await import('node:fs/promises');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  // `import.meta.dirname` is undefined under this runner — derive it from the URL.
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

  async function walk(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const out: string[] = [];
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
        out.push(...(await walk(full)));
      } else if (/\.tsx?$/.test(entry.name)) {
        out.push(full);
      }
    }
    return out;
  }

  const offenders: string[] = [];
  for (const file of await walk(root)) {
    const text = await readFile(file, 'utf8');
    for (const [index, line] of text.split('\n').entries()) {
      if (line.trimStart().startsWith('*') || line.trimStart().startsWith('//')) continue;
      if (UNGUARDED_EVENT_KEY_READ.test(line)) {
        offenders.push(`${path.relative(root, file)}:${index + 1}`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `read eventKey through normalizedEventKey() instead: ${offenders.join(', ')}`
  );
});

test('the sweep can actually see every unguarded spelling', () => {
  // POSITIVE CONTROL for the sweep. Without this, a pattern that matched nothing
  // would make the test above pass forever — and the FIRST version of that pattern
  // really did miss two of these three, so this control is not hypothetical.
  const mustCatch: Array<[label: string, line: string]> = [
    ['optional chain', `  const k = item.eventKey?.trim() || fallback;`],
    ['bare access on a non-optional field', `  const k = game.eventKey.trim();`],
    ['single-quoted nullish coalesce', `  const k = (row.eventKey ?? '').trim();`],
    ['double-quoted nullish coalesce', `  const k = (row.eventKey ?? "").trim();`],
    ['a different string method', `  if (game.eventKey.startsWith('cfp-')) return true;`],
    ['non-null assertion', `  const k = item.eventKey!.toLowerCase();`],
  ];
  for (const [label, line] of mustCatch) {
    assert.ok(UNGUARDED_EVENT_KEY_READ.test(line), `the sweep must catch the ${label} shape`);
  }

  const mustIgnore: Array<[label: string, line: string]> = [
    ['the guarded call', `  const k = normalizedEventKey(item.eventKey) || fallback;`],
    ['a plain comparison', `  if (game.eventKey === other.eventKey) return true;`],
    ['an assignment', `  item.eventKey = derived;`],
    ['a property declaration', `  eventKey?: string | null;`],
  ];
  for (const [label, line] of mustIgnore) {
    assert.equal(
      UNGUARDED_EVENT_KEY_READ.test(line),
      false,
      `the sweep must NOT flag ${label} — a check that cries wolf gets skipped`
    );
  }
});

// ---------------------------------------------------------------------------
// PLATFORM-813 review round 1 — the SIBLING fields in the same function.
//
// The first pass guarded `eventKey` and left
// `(item.conferenceChampionshipConference ?? '').trim()` two lines below and
// `(item.startDate ?? '').slice(0, 10)` eight lines below it, on the same
// unvalidated row, inside the same per-row loop. `CALL SITE 3` above passes a
// STRING conference, so it never touched either hole — a test that exercises the
// function without exercising the field it shares a line with.
// ---------------------------------------------------------------------------

test('a malformed conferenceChampionshipConference does not take down the build', () => {
  for (const [label, value] of MALFORMED_VALUES) {
    const row: ScheduleWireItem = {
      ...postseasonRow('  '), // no usable eventKey, so the conference branch is reached
      gamePhase: 'conference_championship',
      conferenceChampionshipConference: value as string | null,
    };

    const key = buildConferenceChampionshipEventKey(row);
    // Falls through to the date/id derivation rather than throwing.
    assert.match(
      key,
      /^conference-championship-week-/,
      `${label} must fall through to the derived key`
    );
    assert.equal(key.includes('[object'), false, `${label} must not be stringified into the key`);
  }
});

test('a malformed startDate does not take down the build', () => {
  for (const [label, value] of MALFORMED_VALUES) {
    const row: ScheduleWireItem = {
      ...postseasonRow('  '),
      gamePhase: 'conference_championship',
      conferenceChampionshipConference: null,
      startDate: value as string | null,
    };

    const key = buildConferenceChampionshipEventKey(row);
    assert.match(key, /date-unknown/, `${label} must yield an explicit unknown date`);
  }
});

test('the sibling fields still work correctly when well formed', () => {
  // Positive control for both guards: a guard returning '' unconditionally would
  // satisfy the two tests above while destroying real conference and date keys.
  assert.equal(
    buildConferenceChampionshipEventKey({
      ...postseasonRow('  '),
      gamePhase: 'conference_championship',
      conferenceChampionshipConference: 'Big Ten',
    }),
    'big-ten-championship'
  );

  const withDate = buildConferenceChampionshipEventKey({
    ...postseasonRow('  '),
    gamePhase: 'conference_championship',
    conferenceChampionshipConference: null,
    startDate: '2027-12-04T20:00:00.000Z',
  });
  assert.match(withDate, /2027-12-04/, 'a well-formed date still reaches the key');
});

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
      // `eventKey` followed by an optional-chain or nullish-coalesce into a string
      // method — the two shapes that looked guarded and were not.
      if (/eventKey\s*(\?\.|\)\s*\.)\s*(trim|toLowerCase|startsWith|slice|replace)\b/.test(line)) {
        offenders.push(`${path.relative(root, file)}:${index + 1}`);
      }
      if (/\(\s*\w+\.eventKey\s*\?\?\s*''\s*\)\s*\.trim\(\)/.test(line)) {
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

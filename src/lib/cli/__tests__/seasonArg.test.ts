import assert from 'node:assert/strict';
import test from 'node:test';

import { parseSeasonArg } from '../seasonArg.ts';

// ---------------------------------------------------------------------------
// The `--year` flag on `npm run fetch:teams` decides whether the canonical team
// seed is pinned to a season or takes CFBD's current one. Both a bad value and a
// missing value used to be accepted silently, and the script's only job is to
// OVERWRITE `src/data/teams.json` — so a malformed pin corrupts the catalog the
// draft write path reads.
// ---------------------------------------------------------------------------

test('no --year flag asks for the current season', () => {
  assert.deepEqual(parseSeasonArg(['node', 'script']), { kind: 'current' });
});

test('a well-formed --year pins that season', () => {
  assert.deepEqual(parseSeasonArg(['node', 'script', '--year', '2026']), {
    kind: 'pinned',
    year: 2026,
  });
});

test('trailing garbage is rejected rather than truncated to a plausible season', () => {
  // Number.parseInt('20256x') === 20256 — a typo would have pinned a real-looking
  // wrong season and overwritten the seed with it.
  const result = parseSeasonArg(['node', 'script', '--year', '20256x']);
  assert.equal(result.kind, 'invalid');
  assert.match(result.kind === 'invalid' ? result.message : '', /whole season number/);
});

test('a non-numeric --year is rejected instead of becoming NaN', () => {
  // The previous guard was `yearArg !== null`, which NaN passes: the script sent
  // `?year=NaN` to CFBD and wrote `"year": null` into the seed.
  const result = parseSeasonArg(['node', 'script', '--year', 'twentytwentysix']);
  assert.equal(result.kind, 'invalid');
});

test('--year with no value is refused, NOT silently treated as unpinned', () => {
  const result = parseSeasonArg(['node', 'script', '--year']);
  assert.equal(result.kind, 'invalid');
  assert.match(result.kind === 'invalid' ? result.message : '', /requires a season/);
});

test('--year followed by another flag is refused', () => {
  const result = parseSeasonArg(['node', 'script', '--year', '--verbose']);
  assert.equal(result.kind, 'invalid');
});

test('a season outside the plausible range is refused', () => {
  for (const raw of ['1999', '2101', '0', '-2026']) {
    const result = parseSeasonArg(['node', 'script', '--year', raw]);
    assert.equal(result.kind, 'invalid', `expected "${raw}" to be refused`);
  }
});

test('a fractional season is refused', () => {
  assert.equal(parseSeasonArg(['node', 'script', '--year', '2026.5']).kind, 'invalid');
});

// Positive control: the assertions above can distinguish accept from refuse, so a
// parser that accepted everything would fail this file rather than pass it.
test('the refusal cases are not vacuous — a valid season still parses', () => {
  const bad = parseSeasonArg(['node', 'script', '--year', 'nope']);
  const good = parseSeasonArg(['node', 'script', '--year', '2026']);
  assert.notEqual(bad.kind, good.kind);
  assert.equal(good.kind, 'pinned');
});

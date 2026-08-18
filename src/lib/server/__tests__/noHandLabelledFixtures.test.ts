import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/**
 * A test may not WRITE a field the application DERIVES.
 *
 * This is the one habit that produced four vacuous tests in a single day, and it
 * fails the same way every time: a fixture is hand-labelled with a state, the
 * label contradicts the fixture's own data, and the test then exercises a branch
 * with an input combination production can never construct. It passes regardless
 * of what the code does.
 *
 * The worked example, because the abstract version never lands. Delivery
 * timeliness is DERIVED: `startedAt >= requiredStartedAt` is on-time, earlier is
 * late. A test built a row where the run was NEWER than the slot — the on-time
 * shape — and typed `deliveryState: 'late'` on it. The code under test computed
 * its gap backwards. The fixture had the timestamps backwards in exactly the same
 * way. The two errors cancelled, 48 tests passed, and the deployed page told
 * operators a four-day outage was "under a minute late".
 *
 * `deliveryRow` now refuses a row whose label its own timestamps contradict, so
 * the runtime guard is the real protection. This scan closes the way around it:
 * an object literal that sets the derived field directly, never touching the
 * helper.
 *
 * Scoped deliberately narrow — one field, in test files. It is not a lint rule
 * for a whole category, it is a tripwire on the specific field that has already
 * cost a shipped defect.
 */

/**
 * The patterns, and note which one actually caused the defect.
 *
 *  1. `deliveryState: 'late'` written into an object literal — asserting the
 *     answer instead of producing it.
 *  2. SPREADING a built row and then overriding a field the label depends on.
 *     This is the one that shipped: the fixtures called `deliveryRow(...)` and
 *     then replaced `requiredStartedAt` afterwards, which sails past the check
 *     inside the helper because the helper has already returned.
 *
 * (2) is the subtle one and the reason a runtime guard alone is not enough.
 */
const HAND_LABEL = /deliveryState\s*:\s*['"`]/;
const SPREAD_OVERRIDE = /\.\.\.deliveryRow\(/;
const CLASSIFIED_FIELD = /requiredStartedAt\s*:/;

/** The fixture builder, the producer, and this scan's own prose. */
const ALLOWED = new Set([
  'systemHealthFixtures.ts',
  'schedulerDeliveryHealth.ts',
  'noHandLabelledFixtures.test.ts',
]);

function testFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...testFilesUnder(full));
    else if (/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

test('no test constructs a delivery row the classifier could not produce', () => {
  const root = fileURLToPath(new URL('../../..', import.meta.url)); // src/
  const offenders: string[] = [];

  for (const file of testFilesUnder(root)) {
    if (ALLOWED.has(file.split('/').pop()!)) continue;
    const source = readFileSync(file, 'utf8');
    const lines = source.split('\n');

    lines.forEach((line, i) => {
      const where = `${file.replace(root, 'src/')}:${i + 1}`;
      if (HAND_LABEL.test(line)) {
        offenders.push(`${where}  hand-labelled state: ${line.trim()}`);
      }
      // A spread of a built row followed, within the same literal, by an
      // override of a field its label depends on.
      if (SPREAD_OVERRIDE.test(line)) {
        const literal = lines.slice(i, i + 8).join('\n');
        if (CLASSIFIED_FIELD.test(literal)) {
          offenders.push(
            `${where}  overrides requiredStartedAt after deliveryRow(): ${line.trim()}`
          );
        }
      }
    });
  }

  assert.deepEqual(
    offenders,
    [],
    'Pass the slot as `deliveryRow(job, state, receipt, requiredStartedAt)` so the helper can ' +
      'refuse a label its own timestamps contradict. Overriding it afterwards bypasses that ' +
      `check — which is how a four-day outage rendered as "under a minute late":\n  ${offenders.join('\n  ')}`
  );
});

test('ANTI-VACUITY: the scan catches the code that actually shipped', () => {
  // An empty result is otherwise indistinguishable from a broken pattern or a
  // broken file walk — the same silent pass this scan exists to prevent. So feed
  // it the REAL historical fixture and require a match.
  const shipped = [
    "    row.job === 'live-scores'",
    '      ? {',
    "          ...deliveryRow('live-scores', 'late', receiptFor('live-scores', 'success', NOW - 60_000)),",
    '          requiredStartedAt: new Date(dueMs).toISOString(),',
    '        }',
  ].join('\n');
  const lines = shipped.split('\n');
  const caught = lines.some(
    (line, i) =>
      SPREAD_OVERRIDE.test(line) && CLASSIFIED_FIELD.test(lines.slice(i, i + 8).join('\n'))
  );
  assert.ok(caught, 'the scan must flag the exact fixture that let the sign bug through');

  assert.ok(HAND_LABEL.test("    deliveryState: 'late',"), 'and a hand-labelled state');
  assert.ok(
    !HAND_LABEL.test("deliveryRow('odds', 'late', receiptFor('odds', 'success'))"),
    'while leaving the sanctioned helper alone'
  );

  const root = fileURLToPath(new URL('../../..', import.meta.url));
  assert.ok(testFilesUnder(root).length > 50, 'the walk finds the suite, not a handful of files');
});

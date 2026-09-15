import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * PLATFORM-625 incident, 2026-09-15 — the bounded opener must stay ONE template literal.
 *
 * WHAT THIS CATCHES: someone re-splitting `APP_STATE_BOUNDED_BEGIN` into two concatenated
 * template literals, which is the source shape that caused the outage.
 *
 * WHAT IT DOES NOT CATCH, AND THIS HALF IS NOT OPTIONAL: **it cannot see the minifier, so
 * it cannot catch a recurrence of the incident itself.** The defect was invisible in
 * source — the source was correct in every commit and evaluated correctly in node — and
 * only the emitted bundle was wrong. A reader who takes the paragraph above and stops has
 * the wrong idea of what is guarded here. Nothing in the test suite sees the build.
 *
 * WHY IT ASSERTS SOURCE TEXT RATHER THAN THE VALUE, established by mutation rather than
 * assumed: re-splitting the literal evaluates to the SAME string, so every value-based
 * assertion passes. Measured — with the constant re-split into two literals,
 * `appStateBoundedWaits.test.ts` (which captures the real BEGIN and asserts its contents)
 * stayed 15/15 green. A value assertion catches a typo in the string; only a source-shape
 * assertion catches the shape that the minifier then corrupts.
 *
 * `AGENTS.md` prefers behavioural tests and permits a source scan only when an invariant
 * cannot be observed behaviourally. This invariant is about the SHAPE OF THE SOURCE and
 * has no runtime signature at all — the mutation above is the evidence, not an appeal.
 *
 * THIS REPLACED A TEST THAT GREPPED `.next`. That one claimed artifact coverage it could
 * not deliver: `.next` is gitignored and machine-local, with nothing tying it to the
 * source under test, so it passed green against a checked-out tree that still contained
 * the defect — verified live, with a build 52 minutes older than the file it "covered".
 * The artifact question is real and is its own slice; it is not silently covered here.
 */

const SOURCE = path.join(process.cwd(), 'src', 'lib', 'server', 'appStateStore.ts');

/** The declaration statement, from `const` to its terminating semicolon. */
function openerDeclaration(): string {
  const source = readFileSync(SOURCE, 'utf8');
  const start = source.indexOf('const APP_STATE_BOUNDED_BEGIN');
  assert.notEqual(start, -1, 'APP_STATE_BOUNDED_BEGIN was renamed or removed');
  const end = source.indexOf(';\n', start);
  assert.notEqual(end, -1, 'could not find the end of the declaration');
  return source.slice(start, end + 1);
}

test('the bounded opener is a single template literal, not a concatenation', () => {
  const declaration = openerDeclaration();
  // THE ASSERTION THE INCIDENT NEEDED. Two adjacent template literals joined with `+`
  // are folded by the minifier, which drops the tail of the left one after its final
  // interpolation — emitting `15000set local ...` and making every store read fail with
  // `42601 trailing junk after numeric literal`.
  assert.doesNotMatch(
    declaration,
    /`[^`]*`\s*\+/,
    `the opener must be ONE template literal; found a concatenation:\n${declaration}`
  );
  // Exactly one backtick pair — a stronger statement of the same property, and it also
  // rejects a three-way chain, where EVERY left operand's tail is dropped.
  assert.equal(
    (declaration.match(/`/g) ?? []).length,
    2,
    `expected exactly one template literal in the declaration:\n${declaration}`
  );
});

test('the declaration still contains both bounds — the positive control', () => {
  // Without this, deleting the constant's body entirely would satisfy the test above.
  const declaration = openerDeclaration();
  assert.match(declaration, /begin; set local statement_timeout = \$\{/);
  assert.match(declaration, /set local lock_timeout = \$\{/);
});

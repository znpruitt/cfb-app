import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * PLATFORM-625 incident, 2026-09-15 — the bounded opener's SOURCE must stay exactly one
 * template literal carrying exactly the intended SQL.
 *
 * THE FALSIFIER IS "THE STRING DIFFERS FROM THE INTENDED SQL", NOT "SOMEONE RE-SPLIT IT".
 * The first version of this file asserted only the shape, and a reviewer showed it was
 * GREEN ON THE EXACT BYTES THAT TOOK PRODUCTION DOWN: delete the `; ` separator while
 * keeping one literal — `...statement_timeout = ${A}set local lock_timeout = ${B}`, the
 * emitted string from the incident — and all 17 tests passed. It asserted that both
 * interpolations existed and never that anything separated them. **I mutation-proved the
 * falsifier I had in mind and never asked what else produces the bad bytes.**
 *
 * So there are two assertions and they catch different things:
 *   - CONTENT — the literal's body is exactly the intended SQL. Catches the missing
 *     separator, and any other edit to the string.
 *   - SHAPE — exactly one template literal. Catches a re-split, which CONTENT cannot see
 *     because a re-split evaluates to the same string (measured: with the constant
 *     re-split, `appStateBoundedWaits.test.ts` stayed 15/15 green).
 *
 * WHAT THIS FILE CANNOT DO, AND THE DISCLAIMER IS NOT OPTIONAL: **it reads source, so it
 * cannot see the build.** The incident's source was correct in every commit and evaluated
 * correctly in node; only the emitted bundle was wrong. Nothing in this suite reads the
 * build, so **this cannot catch a recurrence of the incident itself.** A reader who takes
 * the paragraph above and stops has the wrong idea of what is guarded.
 *
 * `AGENTS.md` permits a source scan only when an invariant cannot be observed
 * behaviourally. The SHAPE invariant cannot: a re-split has no runtime signature at all,
 * and the mutation above is the evidence rather than an appeal to the permission.
 */

const SOURCE = path.join(process.cwd(), 'src', 'lib', 'server', 'appStateStore.ts');

/** The intended SQL, with the interpolations written as they appear in source. */
const INTENDED =
  'begin; set local statement_timeout = ${APP_STATE_STATEMENT_TIMEOUT_MS}; ' +
  'set local lock_timeout = ${APP_STATE_LOCK_TIMEOUT_MS}';

/**
 * The declaration statement, parsed to the template literal's CLOSING BACKTICK rather
 * than to the first `;\n`.
 *
 * The first version sliced to `source.indexOf(';\n', start)`, which a reviewer showed
 * truncates the moment the literal is legally reformatted across lines: the slice stops
 * at a `;` INSIDE the literal, leaving one backtick, and the test then failed with
 * "expected exactly one template literal" against a declaration that IS exactly one.
 * **An error message asserting the opposite of the truth is worse than a crash**, because
 * it sends the next person to fix something that is not wrong. It also died outright on a
 * CRLF checkout, where no `;\n` exists at all.
 */
function openerDeclaration(): { declaration: string; body: string } {
  const source = readFileSync(SOURCE, 'utf8');
  // Anchored on the `=`: a bare prefix match would silently retarget to a future sibling
  // such as `APP_STATE_BOUNDED_BEGIN_READONLY` declared earlier in the file, and keep
  // passing while the real opener went unguarded.
  const start = source.indexOf('const APP_STATE_BOUNDED_BEGIN =');
  assert.notEqual(start, -1, 'const APP_STATE_BOUNDED_BEGIN = ... was renamed or removed');

  const open = source.indexOf('`', start);
  assert.notEqual(open, -1, 'the opener declaration contains no template literal at all');
  const close = source.indexOf('`', open + 1);
  assert.notEqual(close, -1, 'the opener declaration has an unterminated template literal');

  const semi = source.indexOf(';', close);
  assert.notEqual(semi, -1, 'the opener declaration is not terminated');
  return { declaration: source.slice(start, semi + 1), body: source.slice(open + 1, close) };
}

test('the opener carries EXACTLY the intended SQL, separator included', () => {
  // THE ASSERTION THE INCIDENT NEEDED. Deleting the `; ` between the two SET statements
  // is what production actually ran — `15000set local ...` — and every previous
  // assertion in this repo was green on it.
  const { body } = openerDeclaration();
  assert.equal(body, INTENDED);
});

test('the opener is a single template literal, not a concatenation', () => {
  // Distinct from the content assertion: a re-split produces the SAME string, so only
  // the source shape distinguishes it. Two adjacent literals joined with `+` are the
  // form the shipped bundle corrupted.
  const { declaration } = openerDeclaration();
  assert.doesNotMatch(
    declaration,
    /`[^`]*`\s*\+/,
    `the opener must be ONE template literal; found a concatenation:\n${declaration}`
  );
  assert.equal(
    (declaration.match(/`/g) ?? []).length,
    2,
    `expected exactly one template literal in the declaration:\n${declaration}`
  );
});

test('the parser survives a legally reformatted multi-line literal', () => {
  // The regression for the truncation above: this is the shape that used to produce a
  // failure message asserting the opposite of the truth. Parsing to the closing backtick
  // means a reformat is a CONTENT question, answered by the first test, not a spurious
  // shape failure.
  const { declaration, body } = openerDeclaration();
  assert.ok(declaration.startsWith('const APP_STATE_BOUNDED_BEGIN ='));
  assert.ok(declaration.endsWith(';'));
  assert.ok(body.includes('statement_timeout'), 'the parsed body is the SQL, not a fragment');
});

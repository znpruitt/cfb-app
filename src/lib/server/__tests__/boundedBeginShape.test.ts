import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * PLATFORM-625 incident, 2026-09-15 — the bounded opener's SOURCE must stay exactly one
 * template literal carrying exactly the intended SQL.
 *
 * THE FALSIFIER IS "THE STRING DIFFERS FROM THE INTENDED SQL", NOT "SOMEONE RE-SPLIT IT".
 * An earlier version of this file asserted only the shape, and it was GREEN ON THE EXACT
 * BYTES THAT TOOK PRODUCTION DOWN: delete the `; ` separator while keeping one literal and
 * every test passed. So there are two assertions on the real source, catching different
 * things:
 *   - CONTENT — the literal's body is exactly the intended SQL, separator included.
 *   - SHAPE — exactly one template literal. A re-split evaluates to the SAME string, so
 *     CONTENT cannot see it (measured: with the constant re-split,
 *     `appStateBoundedWaits.test.ts` stayed 15/15 green).
 *
 * WHAT THIS FILE CANNOT DO: **it reads source, so it cannot see the build and cannot catch
 * a recurrence of the incident itself.** The incident's source was correct and evaluated
 * correctly in node; only the emitted bundle was wrong. Nothing in this suite reads the
 * build.
 *
 * `AGENTS.md` permits a source scan only when an invariant cannot be observed
 * behaviourally. A re-split has no runtime signature at all; the mutation above is the
 * evidence, not an appeal to the permission.
 */

const SOURCE = path.join(process.cwd(), 'src', 'lib', 'server', 'appStateStore.ts');

/** The intended SQL, with the interpolations written as they appear in source. */
const INTENDED =
  'begin; set local statement_timeout = ${APP_STATE_STATEMENT_TIMEOUT_MS}; ' +
  'set local lock_timeout = ${APP_STATE_LOCK_TIMEOUT_MS}';

const DECLARATION_HEAD = 'const APP_STATE_BOUNDED_BEGIN =';

/**
 * Extract the opener's declaration and its template-literal body from SOURCE TEXT.
 *
 * TAKES A STRING, NOT A PATH, AND THAT IS THE ROUND-2 FIX. The previous version read the
 * file itself, so the only input it was ever tested on was the one-line declaration that
 * is checked in. Its "reformat" test therefore could not fail: the old `indexOf(';\n')`
 * slicing returns the same result on that input, and the "18/18 pass" I reported for a
 * multi-line reformat came from a one-off manual mutation that nothing re-checked. Taking
 * source text lets the parser tests below feed it LF, CRLF and multi-line inputs directly.
 *
 * THE LITERAL MUST START AT THE `=`. The first non-whitespace character after
 * `const APP_STATE_BOUNDED_BEGIN =` has to be a backtick. The previous version took the
 * first backtick ANYWHERE later in the file, so an opener rewritten as a quoted string
 * made it grab an unrelated literal further down and report a misleading failure. Now that
 * case fails with a message naming what actually happened.
 *
 * THROWS with a specific message on every malformed input, so a failure says what is
 * wrong rather than something adjacent to it.
 */
function parseOpenerDeclaration(source: string): { declaration: string; body: string } {
  // Anchored on the `=`: a bare prefix would retarget to a sibling such as
  // `APP_STATE_BOUNDED_BEGIN_READONLY` declared earlier in the file.
  const start = source.indexOf(DECLARATION_HEAD);
  if (start === -1) throw new Error(`${DECLARATION_HEAD} ... was renamed or removed`);

  let open = start + DECLARATION_HEAD.length;
  while (open < source.length && /\s/.test(source[open]!)) open += 1;
  if (source[open] !== '`') {
    throw new Error(
      `APP_STATE_BOUNDED_BEGIN is not a template literal: its value starts with ${JSON.stringify(
        source.slice(open, open + 20)
      )}`
    );
  }

  const close = source.indexOf('`', open + 1);
  if (close === -1) throw new Error('APP_STATE_BOUNDED_BEGIN has an unterminated template literal');

  const semi = source.indexOf(';', close);
  if (semi === -1) throw new Error('APP_STATE_BOUNDED_BEGIN is not terminated');

  return { declaration: source.slice(start, semi + 1), body: source.slice(open + 1, close) };
}

// === The real source ===

test('the opener carries EXACTLY the intended SQL, separator included', () => {
  // THE ASSERTION THE INCIDENT NEEDED. Deleting the `; ` between the two SET statements
  // is what production ran — `15000set local ...`.
  const { body } = parseOpenerDeclaration(readFileSync(SOURCE, 'utf8'));
  assert.equal(body, INTENDED);
});

test('the opener is a single template literal, not a concatenation', () => {
  const { declaration } = parseOpenerDeclaration(readFileSync(SOURCE, 'utf8'));
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

// === The parser itself, on inputs the checked-in source never provides ===

const SQL_LITERAL =
  '`begin; set local statement_timeout = ${APP_STATE_STATEMENT_TIMEOUT_MS}; set local lock_timeout = ${APP_STATE_LOCK_TIMEOUT_MS}`';

function sourceWith(declaration: string, eol = '\n'): string {
  return ['const before = 1;', declaration, 'const after = `unrelated; text`;', ''].join(eol);
}

test('parser: one-line declaration with LF', () => {
  const parsed = parseOpenerDeclaration(sourceWith(`${DECLARATION_HEAD} ${SQL_LITERAL};`));
  assert.equal(parsed.body, INTENDED);
  assert.equal(parsed.declaration, `${DECLARATION_HEAD} ${SQL_LITERAL};`);
});

test('parser: declaration broken after the `=` (prettier-style), LF', () => {
  // COVERAGE, NOT A REGRESSION: the old `;\n` slicing handled this input correctly too —
  // measured by restoring it, and this test stayed green. It is here because prettier emits
  // this shape for a long declaration, so the parser must keep handling it. The inputs the
  // old slicing actually broke on are the CRLF and in-literal-newline tests below, which
  // both went red when it was restored.
  const parsed = parseOpenerDeclaration(sourceWith(`${DECLARATION_HEAD}\n  ${SQL_LITERAL};`));
  assert.equal(parsed.body, INTENDED);
});

test('parser: the same declaration with CRLF line endings', () => {
  // The old slicing searched for `;\n`, which does not occur in a CRLF file at all.
  const parsed = parseOpenerDeclaration(
    sourceWith(`${DECLARATION_HEAD}\r\n  ${SQL_LITERAL};`, '\r\n')
  );
  assert.equal(parsed.body, INTENDED);
});

test('parser: a literal whose body spans lines is extracted whole', () => {
  // A `;` followed by a newline INSIDE the literal is what truncated the old parser to one
  // backtick. The body here is different SQL, so CONTENT would correctly reject it — the
  // point is that the parser returns the whole literal instead of a fragment.
  const multiLine = '`begin;\nset local statement_timeout = 1;\nset local lock_timeout = 2`';
  const parsed = parseOpenerDeclaration(sourceWith(`${DECLARATION_HEAD} ${multiLine};`));
  assert.equal(parsed.body, multiLine.slice(1, -1));
  assert.equal((parsed.declaration.match(/`/g) ?? []).length, 2);
});

test('parser: a sibling declared EARLIER does not retarget the parse', () => {
  const source = [
    'const APP_STATE_BOUNDED_BEGIN_READONLY = `begin read only`;',
    `${DECLARATION_HEAD} ${SQL_LITERAL};`,
    '',
  ].join('\n');
  assert.equal(parseOpenerDeclaration(source).body, INTENDED);
});

test('parser: a quoted-string opener fails naming the real problem', () => {
  // The misleading-message case from round 2's review: previously the parser skipped to a
  // later backtick pair and compared unrelated file text against the SQL.
  const quoted = `${DECLARATION_HEAD} 'begin; set local statement_timeout = 15000';`;
  assert.throws(() => parseOpenerDeclaration(sourceWith(quoted)), /is not a template literal/);
});

test('parser: a missing declaration fails naming the real problem', () => {
  assert.throws(() => parseOpenerDeclaration('const somethingElse = 1;\n'), /renamed or removed/);
});

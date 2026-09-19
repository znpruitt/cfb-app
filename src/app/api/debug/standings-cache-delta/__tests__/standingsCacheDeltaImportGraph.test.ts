import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

// ---------------------------------------------------------------------------
// PLATFORM-816 — `computeCanonicalStandingsUncached` has exactly one legitimate
// caller, and ASSERTING THAT IN A COMMENT IS NOT ENFORCING IT (PLATFORM-086F2J).
//
// The export exists so the diagnostic can put a fresh rebuild beside the cached
// snapshot. One call is a full-season rebuild — #714 measures the same order of
// cost on the Insights page, which already pays it on every render — so a member
// path or a scheduled job reaching this function would be a real regression, and
// the ONLY thing standing between the two is that nobody imports it. This test
// is that guard.
//
// It is a file scan, not a bundler graph, so it proves no MODULE names the
// symbol. That is the population it can measure and it is the one that matters:
// the symbol cannot be reached without being named, because it is a named export
// and this repo has no dynamic-import or re-export indirection over it (the
// `re-export` check below is what keeps that true).
// ---------------------------------------------------------------------------

const SYMBOL = 'computeCanonicalStandingsUncached';
const SRC = path.join(process.cwd(), 'src');
/**
 * `scripts/` IS PART OF THE POPULATION, and leaving it out was the gap.
 *
 * Five operator scripts import from `../src` today, and `recover-game-stats.ts`
 * is the one place CLAUDE.md says may hold the production read-WRITE credential.
 * A script importing the uncached full-season rebuild is the worst version of
 * the thing this guard exists to prevent, and it would have passed a scan that
 * walked `src/` alone — while the guard's own comment claimed the only thing
 * standing between the two is that nobody imports it.
 */
const SCANNED_ROOTS = [SRC, path.join(process.cwd(), 'scripts')];
const DEFINING_FILE = path.join(SRC, 'lib/selectors/leagueStandings.ts');
const ALLOWED_CALLER_DIR = path.join(SRC, 'app/api/debug/standings-cache-delta');

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(full)));
    } else if (/\.tsx?$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

test('computeCanonicalStandingsUncached is named only by its defining file and the debug route', async () => {
  const files = (await Promise.all(SCANNED_ROOTS.map((root) => walk(root)))).flat();
  assert.ok(files.length > 100, `the scan must actually have walked src (saw ${files.length})`);
  assert.ok(
    files.some((file) => file.startsWith(path.join(process.cwd(), 'scripts') + path.sep)),
    'and scripts/ too — its absence is what let an operator script import this unguarded'
  );

  const namingFiles: string[] = [];
  let scanned = 0;
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    scanned += 1;
    if (text.includes(SYMBOL)) namingFiles.push(file);
  }

  // A measurement's coverage is part of its result: a scan returning zero
  // because it did not look reads identically to one that looked.
  assert.equal(scanned, files.length, 'every file was read');

  const unexpected = namingFiles.filter(
    (file) => file !== DEFINING_FILE && !file.startsWith(ALLOWED_CALLER_DIR + path.sep)
  );
  assert.deepEqual(
    unexpected.map((file) => path.relative(process.cwd(), file)),
    [],
    'only src/lib/selectors/leagueStandings.ts and src/app/api/debug/standings-cache-delta may name the uncached compute — scripts/ included in the scan'
  );

  // The positive control for the scan itself. Without it, a broken path
  // constant, a bad glob or a renamed symbol would produce the same empty
  // `unexpected` list as genuine compliance.
  assert.ok(
    namingFiles.includes(DEFINING_FILE),
    'the scan found the defining file, so an empty result means compliance rather than a scan that missed'
  );
  assert.ok(
    namingFiles.some((file) => file.startsWith(ALLOWED_CALLER_DIR + path.sep)),
    'the scan found the one legitimate caller'
  );
});

test('the uncached compute is not re-exported or aliased under another name', async () => {
  const text = await readFile(DEFINING_FILE, 'utf8');

  // WHOLE-TEXT, NOT LINE-BY-LINE. The previous version required the symbol and
  // `export` on the SAME line, which a Prettier-wrapped export block defeats —
  //
  //   export {
  //     computeCanonicalStandings,
  //     computeCanonicalStandingsUncached as freshStandings,
  //   };
  //
  // no single line there carries both, so an importer naming only `freshStandings`
  // would pass this AND the scan above. Same for `export const leak =\n  <symbol>`.
  // Matching across newlines asks the question the guard cares about instead of
  // keying on how the file happens to be formatted — the mistake this suite has
  // now made twice.
  const exportBlockAlias = new RegExp(String.raw`export\s*\{[^}]*\b${SYMBOL}\b[^}]*\}`, 's');
  assert.equal(
    exportBlockAlias.test(text),
    false,
    'no `export { … }` block names the symbol, on one line or wrapped across several'
  );

  const bindingAlias = new RegExp(
    String.raw`export\s+(?:const|let|var|function)\s+\w+\s*(?:=|\()[\s\S]{0,80}?\b${SYMBOL}\b`,
    's'
  );
  assert.equal(bindingAlias.test(text), false, 'no second exported binding of the function');

  assert.equal(
    text.includes('export * from'),
    false,
    'no star re-export out of the defining module'
  );

  // The control: the declaration itself must be findable, so an all-clear means
  // "no alias" rather than "the patterns match nothing in this file".
  assert.ok(
    new RegExp(String.raw`export function ${SYMBOL}\(`).test(text),
    'the declaration was found, so the patterns are looking at the right text'
  );
});

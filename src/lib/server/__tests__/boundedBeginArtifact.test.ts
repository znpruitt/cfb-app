import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * PLATFORM-625 incident, 2026-09-15 — the bounded opener must be correct IN THE BUILT
 * ARTIFACT, not merely in source.
 *
 * WHY THIS TEST READS `.next` AND NOT A MODULE. The opener was written as two adjacent
 * template literals concatenated with `+`. That source is correct, and evaluating it in
 * node produces the correct string — but the minifier folds the pair and DROPS THE TAIL
 * OF THE FIRST LITERAL after its final interpolation, so the shipped bundle contained:
 *
 *     begin; set local statement_timeout = 15000set local lock_timeout = 10000
 *
 * Postgres answered `42601 trailing junk after numeric literal at or near "15000set"` on
 * every authenticated page that reads `app_state`.
 *
 * **Every source-level gate passed while production was down** — `tsc`, `lint:all`, and
 * the entire suite, including the tests that assert this exact string, because all of
 * them read the source. A defect that exists only after the build is invisible to every
 * check that runs before it, so the only test that can see this class is one that reads
 * the emitted output.
 *
 * SKIPS WHEN THERE IS NO BUILD, deliberately: `npm test` does not build, and a test that
 * failed for the absence of an artifact would be noise on every ordinary run and would
 * train people to ignore it. It earns its place in the pre-merge/pre-promotion path,
 * where a build exists. That skip is the honest limit — it means a green `npm test` is
 * NOT evidence the artifact is sound.
 */

const NEXT_DIR = path.join(process.cwd(), '.next');

/** Every emitted JS file under `.next`, bounded so a stray directory cannot hang this. */
function emittedJsFiles(dir: string, budget = { left: 4000 }): string[] {
  const out: string[] = [];
  if (budget.left <= 0) return out;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (budget.left <= 0) break;
    const full = path.join(dir, entry);
    let isDir = false;
    try {
      isDir = statSync(full).isDirectory();
    } catch {
      continue;
    }
    if (isDir) {
      if (entry === 'cache') continue;
      out.push(...emittedJsFiles(full, budget));
      continue;
    }
    if (entry.endsWith('.js')) {
      budget.left -= 1;
      out.push(full);
    }
  }
  return out;
}

test('the bounded opener survives the build with its statement separator intact', (t) => {
  if (!existsSync(NEXT_DIR)) {
    t.skip('no .next build present — run `npm run build` first; see the note above');
    return;
  }

  const seen = new Set<string>();
  for (const file of emittedJsFiles(NEXT_DIR)) {
    let contents: string;
    try {
      contents = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    if (!contents.includes('set local statement_timeout')) continue;
    for (const match of contents.matchAll(/begin;\s*set local statement_timeout[^"'`]{0,80}/g)) {
      seen.add(match[0]);
    }
  }

  if (seen.size === 0) {
    t.skip('this build emitted no chunk containing the opener');
    return;
  }

  for (const opener of seen) {
    // THE ASSERTION THE INCIDENT NEEDED: a separator between the two SET statements.
    // Without it the timeout value runs into the next keyword — `15000set` — and every
    // store read fails with a syntax error.
    assert.match(
      opener,
      /statement_timeout = \d+;\s*set local lock_timeout/,
      `emitted opener lost its statement separator: ${opener}`
    );
    assert.doesNotMatch(opener, /\d set local/, `emitted opener is missing a semicolon: ${opener}`);
  }
});

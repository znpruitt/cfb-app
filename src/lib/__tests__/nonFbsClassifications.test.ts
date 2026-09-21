import test from 'node:test';
import assert from 'node:assert/strict';

import { NON_FBS_CLASSIFICATIONS } from '../schedule/cfbdSchedule.ts';

/**
 * PLATFORM-813 — one provider vocabulary, one definition.
 *
 * `schedule.ts` held `NON_FBS_PROVIDER_CLASSIFICATIONS` and `cfbdSchedule.ts` held
 * `NON_FBS_CLASSIFICATIONS`: two separately spelled sets of the same three values.
 *
 * **PREVENTIVE, and the sets were IDENTICAL when merged**, so no drift was repaired —
 * one copy was removed so the next edit cannot create drift. The sweep below is the
 * part that lasts, because consolidating once does not stop a third copy appearing and
 * a second copy is invisible until the two disagree.
 */

test('the single definition holds exactly the provider non-FBS values', () => {
  assert.deepEqual([...NON_FBS_CLASSIFICATIONS].sort(), ['fcs', 'ii', 'iii']);
});

test('fbs is NOT in the set', () => {
  // An inverted membership test would pass the assertion above while classifying every
  // FBS game as non-FBS.
  assert.equal(NON_FBS_CLASSIFICATIONS.has('fbs' as never), false);
});

/**
 * A set literal enumerating the three non-FBS values, in any order, on one line or
 * spread across several, with or without a generic type argument.
 *
 * REWRITTEN AT REVIEW. v1's pattern required a literal `newSet([` after whitespace
 * stripping, so `new Set<ProviderClassification>(['fcs','ii','iii'])` did not match —
 * and since the values are typed `ProviderClassification`, the generic-annotated form
 * is the natural spelling for a third copy. The pattern that misses the likeliest
 * shape returns the same clean zero as one that looked.
 */
const DUPLICATE_SET = /newSet(?:<[^>]*>)?\(\[(['"](?:fcs|ii|iii)['"],?){3}\]\)/;

test('no second definition of the non-FBS vocabulary exists under src/', async () => {
  const { readdir, readFile } = await import('node:fs/promises');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');

  // POPULATION: all of `src/`, every `.ts`/`.tsx` outside `__tests__`.
  //
  // This file lives at `src/lib/__tests__/`, so `src` is TWO levels up. The root is
  // ASSERTED rather than trusted: v1's version of this sweep resolved `..` and
  // therefore searched `src/lib` only, never `src/app` or `src/components`, while its
  // name claimed `src/`. A clean result from a narrow root is byte-identical to a
  // clean result from the right one — which is why the root belongs in the result.
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  assert.equal(path.basename(root), 'src', `the sweep root must be src/, got ${root}`);

  const CANONICAL = path.join(root, 'lib', 'schedule', 'cfbdSchedule.ts');

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

  const scanned = await walk(root);
  // Coverage is part of the result: a sweep that read four files and found nothing
  // reports the same zero as one that read the repo.
  assert.ok(scanned.length > 300, `the sweep must cover src/ broadly, saw ${scanned.length} files`);
  assert.ok(
    scanned.some((f) => f.includes(`${path.sep}app${path.sep}`)),
    'src/app must be in the population — that is the half v1 missed'
  );

  const offenders: string[] = [];
  for (const file of scanned) {
    if (file === CANONICAL) continue;
    if (DUPLICATE_SET.test((await readFile(file, 'utf8')).replace(/\s+/g, ''))) {
      offenders.push(path.relative(root, file));
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `import NON_FBS_CLASSIFICATIONS from schedule/cfbdSchedule.ts instead of redefining it: ${offenders.join(', ')}`
  );
});

test('the sweep can actually see a second definition, in every spelling', () => {
  // POSITIVE CONTROL. The previous version's control exercised only the un-annotated
  // form, so it could not detect that the pattern missed the annotated one.
  const mustMatch: Array<[label: string, source: string]> = [
    ['single-line', `const X: ReadonlySet<P> = new Set(['fcs', 'ii', 'iii']);`],
    ['multi-line', `const X = new Set([\n  'fcs',\n  'ii',\n  'iii',\n]);`],
    ['reordered', `const X = new Set(['iii', 'fcs', 'ii']);`],
    ['double-quoted', `const X = new Set(["fcs", "ii", "iii"]);`],
    ['generic-annotated', `const X = new Set<ProviderClassification>(['fcs', 'ii', 'iii']);`],
  ];
  for (const [label, source] of mustMatch) {
    assert.ok(
      DUPLICATE_SET.test(source.replace(/\s+/g, '')),
      `the sweep must match the ${label} shape`
    );
  }

  const mustIgnore: Array<[label: string, source: string]> = [
    ['an unrelated set', `const X = new Set(['fbs']);`],
    ['a superset including fbs', `const X = new Set(['fbs', 'fcs', 'ii', 'iii']);`],
    ['the import', `import { NON_FBS_CLASSIFICATIONS } from './schedule/cfbdSchedule.ts';`],
  ];
  for (const [label, source] of mustIgnore) {
    assert.equal(
      DUPLICATE_SET.test(source.replace(/\s+/g, '')),
      false,
      `the sweep must NOT flag ${label} — a check that cries wolf gets skipped`
    );
  }
});

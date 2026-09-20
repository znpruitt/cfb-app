import test from 'node:test';
import assert from 'node:assert/strict';

import { NON_FBS_CLASSIFICATIONS } from '../schedule/cfbdSchedule.ts';

/**
 * PLATFORM-813 — one provider vocabulary, one definition.
 *
 * `schedule.ts` held `NON_FBS_PROVIDER_CLASSIFICATIONS` and `cfbdSchedule.ts` held
 * `NON_FBS_CLASSIFICATIONS`, separately spelled sets of the same three values.
 *
 * **This is PREVENTIVE and the sets were IDENTICAL when merged**, so no drift was
 * repaired — one copy was removed so the next edit cannot create drift. The sweep
 * below is the part that lasts: consolidating once does not stop a third copy being
 * added next year, and a second copy is invisible until the two disagree.
 */

test('the single definition holds exactly the provider non-FBS values', () => {
  assert.deepEqual([...NON_FBS_CLASSIFICATIONS].sort(), ['fcs', 'ii', 'iii']);
});

test('fbs is NOT in the set', () => {
  // The whole point of the set; an inverted membership test would pass the
  // assertion above while classifying every FBS game as non-FBS.
  assert.equal(NON_FBS_CLASSIFICATIONS.has('fbs' as never), false);
});

test('no second definition of the non-FBS vocabulary exists in src/', async () => {
  const { readdir, readFile } = await import('node:fs/promises');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const CANONICAL = path.join(root, 'schedule', 'cfbdSchedule.ts');

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

  // A set literal enumerating the three non-FBS values, in any order, on one line
  // or spread across several — the shape both copies had.
  const offenders: string[] = [];
  for (const file of await walk(root)) {
    if (file === CANONICAL) continue;
    const text = await readFile(file, 'utf8');
    const compact = text.replace(/\s+/g, '');
    if (/newSet\(\[(['"](fcs|ii|iii)['"],?){3}\]\)/.test(compact)) {
      offenders.push(path.relative(root, file));
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `import NON_FBS_CLASSIFICATIONS from schedule/cfbdSchedule.ts instead of redefining it: ${offenders.join(', ')}`
  );
});

test('the sweep can actually see a second definition', () => {
  // POSITIVE CONTROL for the sweep above. Its regex runs against whitespace-stripped
  // source, and a pattern that matched nothing would make the previous test pass
  // forever regardless of how many copies existed. This asserts the pattern matches
  // the exact shape both real copies had, in both orderings and both layouts.
  const pattern = /newSet\(\[(['"](fcs|ii|iii)['"],?){3}\]\)/;
  const oneLine = `const X: ReadonlySet<P> = new Set(['fcs', 'ii', 'iii']);`;
  const multiLine = `const X: ReadonlySet<P> = new Set([\n  'fcs',\n  'ii',\n  'iii',\n]);`;
  const reordered = `const X = new Set(['iii', 'fcs', 'ii']);`;
  for (const [label, source] of [
    ['single-line', oneLine],
    ['multi-line', multiLine],
    ['reordered', reordered],
  ] as const) {
    assert.ok(pattern.test(source.replace(/\s+/g, '')), `the sweep must match the ${label} shape`);
  }
  // And it must NOT match an unrelated set, or every file would be an offender.
  assert.equal(pattern.test(`new Set(['fbs'])`.replace(/\s+/g, '')), false);
});

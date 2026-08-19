import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { resolveTestArguments } from '../../../scripts/run-tests.mjs';

const REPO_ROOT = process.cwd();

test('an exact bracketed route test is escaped as a literal Node test glob', () => {
  const testPath = path.join('src', 'app', 'admin', '[slug]', '__tests__', 'page.test.ts');

  assert.equal(
    resolveTestArguments([testPath], REPO_ROOT)[0],
    path.join('src', 'app', 'admin', '[[]slug[]]', '__tests__', 'page.test.ts')
  );
});

test('a test glob resolves to executable files before Node receives it', () => {
  const testGlob = 'src/**/*.test.ts';
  const resolved = resolveTestArguments([testGlob], REPO_ROOT);

  assert.ok(resolved.length > 0);
  assert.ok(resolved.every((testPath) => testPath.endsWith('.test.ts')));
});

test('an empty extension glob is optional when a sibling glob finds tests', () => {
  const resolved = resolveTestArguments(
    ['src/app/api/**/*.test.ts', 'src/app/api/**/*.test.tsx'],
    REPO_ROOT
  );

  assert.ok(resolved.length > 0);
  assert.ok(resolved.every((testPath) => testPath.endsWith('.test.ts')));
});

test('an unmatched bracketed route path fails instead of becoming a zero-test glob', () => {
  const missing = path.join('src', 'app', 'admin', '[slug]', '__tests__', 'missing.test.ts');

  assert.throws(
    () => resolveTestArguments([missing], REPO_ROOT),
    /No test files matched: src\/app\/admin\/\[slug\]\/__tests__\/missing\.test\.ts/
  );
});

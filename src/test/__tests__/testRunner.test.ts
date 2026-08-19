import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { resolveTestArguments } from '../../../scripts/run-tests.mjs';

const REPO_ROOT = process.cwd();
const RUNNER_PATH = path.join(REPO_ROOT, 'scripts', 'run-tests.mjs');

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

test('an App Router bracket segment stays literal in a wildcard glob', () => {
  const resolved = resolveTestArguments(
    ['src/app/admin/[slug]/__tests__/*.test.ts', 'src/lib/insights/__tests__/*.test.ts'],
    REPO_ROOT
  );
  const adminPrefix = path.join('src', 'app', 'admin', '[[]slug[]]', '__tests__');

  assert.ok(resolved.some((testPath) => testPath.startsWith(`${adminPrefix}${path.sep}`)));
});

test('an unmatched bracketed route path fails instead of becoming a zero-test glob', () => {
  const missing = path.join('src', 'app', 'admin', '[slug]', '__tests__', 'missing.test.ts');

  assert.throws(
    () => resolveTestArguments([missing], REPO_ROOT),
    /No test files matched: src\/app\/admin\/\[slug\]\/__tests__\/missing\.test\.ts/
  );
});

test('invoking the runner through a symlink still executes it', async () => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'cfb-test-runner-'));
  const linkedRunner = path.join(fixtureRoot, 'run-tests.mjs');

  try {
    await symlink(RUNNER_PATH, linkedRunner);
    const result = spawnSync(
      process.execPath,
      [linkedRunner, 'src/lib/insights/__tests__/missing.test.ts'],
      {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      }
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /No test files matched/);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

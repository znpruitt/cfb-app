import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const REPO_ROOT = process.cwd();
const SOURCE_ROOT = path.join(REPO_ROOT, 'src');

function isExecutableTest(relativePath: string): boolean {
  return /\.test\.tsx?$/.test(relativePath);
}

function isUnderTestsDirectory(relativePath: string): boolean {
  return relativePath.split(path.sep).includes('__tests__');
}

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const entryPath = path.join(directory, entry.name);
      return entry.isDirectory() ? listFiles(entryPath) : [entryPath];
    })
  );
  return nested.flat();
}

async function findMisplacedTests(sourceRoot: string, repoRoot: string): Promise<string[]> {
  return (await listFiles(sourceRoot))
    .map((filePath) => path.relative(repoRoot, filePath))
    .filter(isExecutableTest)
    .filter((filePath) => !isUnderTestsDirectory(filePath))
    .sort();
}

test('the layout audit surfaces a misplaced test from a fixture tree', async () => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'cfb-test-layout-'));
  const sourceRoot = path.join(fixtureRoot, 'src');
  const misplaced = path.join(sourceRoot, 'app', 'api', 'odds', 'route.test.ts');
  const collected = path.join(sourceRoot, 'app', 'api', 'odds', '__tests__', 'route.test.ts');

  try {
    await mkdir(path.dirname(misplaced), { recursive: true });
    await mkdir(path.dirname(collected), { recursive: true });
    await writeFile(misplaced, '');
    await writeFile(collected, '');

    assert.deepEqual(await findMisplacedTests(sourceRoot, fixtureRoot), [
      path.join('src', 'app', 'api', 'odds', 'route.test.ts'),
    ]);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test('every executable test is stored under an __tests__ directory', async () => {
  const misplaced = await findMisplacedTests(SOURCE_ROOT, REPO_ROOT);

  assert.deepEqual(
    misplaced,
    [],
    `Move executable tests under the nearest __tests__ directory:\n${misplaced.join('\n')}`
  );
});

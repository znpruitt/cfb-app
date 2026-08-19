import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
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

test('the layout predicate detects a colocated route suite', () => {
  const misplaced = path.join('src', 'app', 'api', 'odds', 'route.test.ts');
  const collected = path.join('src', 'app', 'api', 'odds', '__tests__', 'route.test.ts');

  assert.equal(isExecutableTest(misplaced), true, 'positive control: recognizes a test file');
  assert.equal(
    isUnderTestsDirectory(misplaced),
    false,
    'positive control: rejects colocated tests'
  );
  assert.equal(isUnderTestsDirectory(collected), true, 'accepts the canonical layout');
});

test('every executable test is stored under an __tests__ directory', async () => {
  const misplaced = (await listFiles(SOURCE_ROOT))
    .map((filePath) => path.relative(REPO_ROOT, filePath))
    .filter(isExecutableTest)
    .filter((filePath) => !isUnderTestsDirectory(filePath))
    .sort();

  assert.deepEqual(
    misplaced,
    [],
    `Move executable tests under the nearest __tests__ directory:\n${misplaced.join('\n')}`
  );
});

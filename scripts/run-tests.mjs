import { spawnSync } from 'node:child_process';
import { globSync, realpathSync, statSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LITERAL_GLOB_ESCAPES = {
  '[': '[[]',
  ']': '[]]',
  '*': '[*]',
  '?': '[?]',
};

function escapeLiteralGlobPath(filePath) {
  return filePath.replace(/[[\]*?]/g, (character) => LITERAL_GLOB_ESCAPES[character]);
}

function escapeLiteralRouteSegments(pattern) {
  return pattern
    .split(/([/\\])/)
    .map((segment) =>
      segment.startsWith('[') && segment.endsWith(']') ? escapeLiteralGlobPath(segment) : segment
    )
    .join('');
}

export function resolveTestArguments(argumentsToRun, cwd = process.cwd()) {
  const files = [];

  for (const argument of argumentsToRun) {
    const exactFile = statSync(path.resolve(cwd, argument), { throwIfNoEntry: false });
    const isWildcardGlob = /[*?]/.test(argument);
    const matches = exactFile?.isFile()
      ? [argument]
      : globSync(escapeLiteralRouteSegments(argument), { cwd }).filter((match) =>
          statSync(path.resolve(cwd, match), { throwIfNoEntry: false })?.isFile()
        );

    if (matches.length === 0 && !isWildcardGlob) {
      throw new Error(`No test files matched: ${argument}`);
    }

    files.push(...matches);
  }

  if (files.length === 0) {
    throw new Error(`No test files matched: ${argumentsToRun.join(', ')}`);
  }

  return [...new Set(files)].map(escapeLiteralGlobPath);
}

export function nodeTestConcurrency(parallelism = availableParallelism()) {
  const defaultConcurrency = Math.max(1, parallelism - 1);
  // PLATFORM-106: our `parallelism - 1` policy selected seven file workers on
  // the 8-way host, where schedule-refresh and admin-leagues crossed the
  // 30-second timeout under full-suite contention. Four is the load-bearing
  // fix; splitting both suites adds margin (loaded admin worst: 21.4s → 17.7s)
  // but does not make higher file concurrency safe.
  return Math.min(4, defaultConcurrency);
}

export function buildNodeTestArguments(testFiles, parallelism = availableParallelism()) {
  return [
    '--import',
    'tsx',
    '--test',
    '--test-timeout=30000',
    `--test-concurrency=${nodeTestConcurrency(parallelism)}`,
    ...testFiles,
  ];
}

export function runTests(argumentsToRun, spawnProcess = spawnSync) {
  if (argumentsToRun.length === 0) {
    console.error('Pass at least one exact test file or test glob.');
    return 1;
  }

  let testFiles;
  try {
    testFiles = resolveTestArguments(argumentsToRun);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  const result = spawnProcess(process.execPath, buildNodeTestArguments(testFiles), {
    env: {
      ...process.env,
      APP_STATE_TEST_ISOLATION: '1',
      TSX_TSCONFIG_PATH: 'tsconfig.test.json',
      UPSTREAM_PACING_DISABLED: '1',
    },
    stdio: 'inherit',
  });

  if (result.error) {
    console.error(result.error.message);
    return 1;
  }

  return result.status ?? 1;
}

const invokedPath = process.argv[1] ? realpathSync(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = runTests(process.argv.slice(2));
}

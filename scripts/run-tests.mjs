import { spawnSync } from 'node:child_process';
import { globSync, realpathSync, statSync } from 'node:fs';
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

export function runTests(argumentsToRun) {
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

  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', '--test', '--test-timeout=30000', ...testFiles],
    {
      env: {
        ...process.env,
        APP_STATE_TEST_ISOLATION: '1',
        TSX_TSCONFIG_PATH: 'tsconfig.test.json',
      },
      stdio: 'inherit',
    }
  );

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

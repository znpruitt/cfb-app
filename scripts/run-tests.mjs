import { spawnSync } from 'node:child_process';
import { globSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * PLATFORM-620. The prefix of every isolated app-state store directory. Declared
 * here as well as in `src/lib/server/appStateStore.ts` because this script is run
 * by bare `node` and cannot import a TypeScript module;
 * `src/test/__tests__/testStoreLifecycle.test.ts` asserts the two never drift.
 *
 * THE SWEEP BELOW MATCHES ON THIS PREFIX AND ONLY ON DIRECTORIES, so it cannot
 * reach the legacy `cfb-app-app-state-test-<pid>.json` files the retired pid
 * scheme left in `$TMPDIR`. Clearing those is the owner's call and a named step,
 * never a side effect of running the suite.
 */
export const TEST_STORE_DIRECTORY_PREFIX = 'cfb-app-test-store-';

/**
 * A test process lives at most 30 seconds (`--test-timeout`) and a full run takes
 * about two minutes, so a day is three orders of magnitude of headroom over any
 * live directory. The window exists for one case only: a run directory orphaned
 * because `run-tests.mjs` ITSELF was killed with `SIGKILL`, whose `finally` never
 * ran. Without the sweep that leak is slower than the pid scheme's but still
 * unbounded, and "slower" is not a fix.
 */
export const STALE_TEST_STORE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

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

/**
 * Remove app-state store directories left by a run whose runner was killed before
 * its `finally` could delete them. Age-gated, prefix-scoped, and directories only —
 * see {@link TEST_STORE_DIRECTORY_PREFIX} for why the legacy pid FILES are out of
 * reach on purpose. Returns the directories it removed so the caller can report
 * the sweep as a step rather than perform it silently.
 */
export function sweepStaleTestStoreDirectories(
  parentDirectory = tmpdir(),
  now = Date.now(),
  maxAgeMs = STALE_TEST_STORE_MAX_AGE_MS
) {
  let entries;
  try {
    entries = readdirSync(parentDirectory, { withFileTypes: true });
  } catch {
    return [];
  }

  const removed = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(TEST_STORE_DIRECTORY_PREFIX)) continue;

    const directory = path.join(parentDirectory, entry.name);
    try {
      if (now - statSync(directory).mtimeMs < maxAgeMs) continue;
      rmSync(directory, { recursive: true, force: true });
      removed.push(directory);
    } catch {
      // Another user's directory, or one already gone. Neither is this run's problem.
    }
  }

  return removed;
}

export function runTests(argumentsToRun, spawnProcess = spawnSync, runParentDirectory = tmpdir()) {
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

  // PLATFORM-620. One directory per RUN, handed to every child as the parent its
  // own store directory is created in. It buys cleanup, not correctness: a child
  // killed with `SIGKILL` skips its own exit handler, and the `finally` below
  // collects it anyway. Isolation itself does not depend on either.
  //
  // WHICH IS WHY NEITHER HALF MAY FAIL THE RUN. If the directory cannot be created,
  // the store falls back to `os.tmpdir()` on its own and isolation is untouched —
  // refusing to run the suite because a CLEANUP convenience was unavailable would
  // invert the priority the paragraph above just stated. Found by review, which
  // noticed these were the only unguarded filesystem calls in a change that is
  // deliberately best-effort everywhere else.
  let runDirectory = null;
  try {
    runDirectory = mkdtempSync(path.join(runParentDirectory, TEST_STORE_DIRECTORY_PREFIX));
  } catch (error) {
    console.warn(
      `Could not create a test store run directory (${
        error instanceof Error ? error.message : String(error)
      }); each test process will clean up after itself instead.`
    );
  }

  const environment = {
    ...process.env,
    APP_STATE_TEST_ISOLATION: '1',
    TSX_TSCONFIG_PATH: 'tsconfig.test.json',
    UPSTREAM_PACING_DISABLED: '1',
  };
  // Explicitly cleared rather than left to `...process.env`, so a stale value
  // exported by an earlier run cannot point this run's children at a dead directory.
  if (runDirectory) environment.APP_STATE_TEST_STORE_DIR = runDirectory;
  else delete environment.APP_STATE_TEST_STORE_DIR;

  // The clock-shift shim (Item 137/#696) is attached as an ARGUMENT to the test
  // child, and deliberately NOT through `NODE_OPTIONS`. Two review rounds found the
  // two ways this goes wrong, and both are why it is written this way:
  //
  //   1. Shifting THIS process poisons the startup sweep above, which deletes stale
  //      `cfb-app-test-store-*` directories by mtime against a 24-hour threshold. A
  //      shifted clock makes every real-clock directory look stale — including the
  //      live directory of a suite running concurrently in another worktree, which
  //      with three worktrees on one `os.tmpdir()` is normal operation here.
  //   2. `NODE_OPTIONS` is inherited by GRANDCHILDREN. `testRunner.test.ts` spawns
  //      this runner as a real subprocess to prove symlinked invocation works, and
  //      that subprocess IS `run-tests.mjs` running as main — so it performs the
  //      sweep, with the shim silently inherited. Measured: a planted live directory
  //      survived every single-file shifted run and was deleted by the full suite.
  //      An argument reaches exactly one process; an env var reaches the whole tree.
  //
  // `CLOCK_SHIFT_DAYS` still travels through the environment because the shim reads
  // the offset from it, but on its own it shifts nothing — a process that inherits
  // the variable without the `--import` keeps a real clock.
  //
  // The INJECTION is keyed on a separate one-shot flag, which is consumed here and
  // deliberately not forwarded. `CLOCK_SHIFT_DAYS` has to reach the test child, so a
  // test calling `runTests` IN-PROCESS would otherwise see it and re-inject, adding
  // arguments the runner's own argv-contract test does not expect — measured, as a
  // failure of 'the shared runner passes its computed concurrency cap to the Node
  // child process' under a shifted run. The detector must not perturb the suite it
  // is measuring.
  const spawnArguments = buildNodeTestArguments(testFiles);
  if (environment.CLOCK_SHIFT_INJECT === '1') {
    delete environment.CLOCK_SHIFT_INJECT;
    spawnArguments.unshift(
      '--import',
      fileURLToPath(new URL('./clock-shift.mjs', import.meta.url))
    );
  }

  try {
    const result = spawnProcess(process.execPath, spawnArguments, {
      env: environment,
      stdio: 'inherit',
    });

    if (result.error) {
      console.error(result.error.message);
      return 1;
    }

    return result.status ?? 1;
  } finally {
    // A throw here would replace the suite's exit status with a stack trace, so a
    // GREEN run would report failure. Cleanup does not get to do that.
    if (runDirectory) {
      try {
        rmSync(runDirectory, { recursive: true, force: true });
      } catch {
        // The next run's sweep ages it out.
      }
    }
  }
}

const invokedPath = process.argv[1] ? realpathSync(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  // A named step with its own report line when it acts, never a silent side effect.
  const swept = sweepStaleTestStoreDirectories();
  if (swept.length > 0) {
    console.log(
      `test store sweep: removed ${swept.length} orphaned run ${
        swept.length === 1 ? 'directory' : 'directories'
      } older than ${STALE_TEST_STORE_MAX_AGE_MS / 3_600_000}h`
    );
  }

  process.exitCode = runTests(process.argv.slice(2));
}

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  createTestStoreDirectory,
  getAppState,
  getAppStateStorageStatus,
  TEST_STORE_DIRECTORY_PREFIX,
} from '@/lib/server/appStateStore';
import {
  PROVIDER_REFRESH_SETTINGS_KEY,
  PROVIDER_REFRESH_SETTINGS_SCOPE,
  getProviderRefreshSettings,
} from '@/lib/server/providerRefreshSettings';

import {
  STALE_TEST_STORE_MAX_AGE_MS,
  TEST_STORE_DIRECTORY_PREFIX as RUNNER_TEST_STORE_DIRECTORY_PREFIX,
  runTests,
  sweepStaleTestStoreDirectories,
} from '../../../scripts/run-tests.mjs';

/**
 * PLATFORM-620 — the isolated app-state store's path scheme and its lifecycle.
 *
 * The retired scheme was `os.tmpdir()/cfb-app-app-state-test-${process.pid}.json`,
 * a pure function of the pid, deleted by nobody. macOS recycles pids, so a process
 * could start life owning an earlier run's populated store: 17,315 files had
 * accumulated on the owner's machine, and 40 of the 154 app-state-initialising
 * processes in one measured `npm test` (26.0%) began with a file already sitting at
 * their pid path.
 *
 * The tests below separate the two claims the fix makes, because they have
 * different strengths and hiding the weaker one inside the stronger is how a
 * cleanup-dependent design gets mistaken for a correct one:
 *
 *   CORRECTNESS — inheritance is impossible, by exclusive creation, always.
 *   CLEANUP     — best effort in the child, guaranteed by the runner for a killed
 *                 child, and merely bounded when the RUNNER itself is killed.
 */

const REPO_ROOT = process.cwd();
const APP_STATE_MODULE = path.join(REPO_ROOT, 'src', 'lib', 'server', 'appStateStore.ts');

function legacyPidPath(pid = process.pid): string {
  return path.join(os.tmpdir(), `cfb-app-app-state-test-${pid}.json`);
}

// ---------------------------------------------------------------------------
// CORRECTNESS
// ---------------------------------------------------------------------------

test('the same pid in two runs cannot collide — the collision is simulated, not argued', () => {
  const parent = mkdtempSync(path.join(os.tmpdir(), 'cfb-620-collision-'));

  try {
    // One process, so `process.pid` is CONSTANT across every iteration — which is
    // exactly the input a recycled pid hands a later run. 500 calls, 500 paths.
    const created = new Set<string>();
    for (let index = 0; index < 500; index += 1) {
      created.add(createTestStoreDirectory(parent));
    }

    assert.equal(created.size, 500);

    // POSITIVE CONTROL for the assertion above: the retired scheme, given those
    // same 500 calls, yields ONE path. Without this line the test would pass just
    // as happily against a scheme that never collides because it was never asked
    // to — it proves the comparison can come out the other way.
    const legacy = new Set<string>();
    for (let index = 0; index < 500; index += 1) {
      legacy.add(legacyPidPath());
    }

    assert.equal(legacy.size, 1);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test('a directory already sitting at the prefix cannot be adopted — creation is exclusive', () => {
  const parent = mkdtempSync(path.join(os.tmpdir(), 'cfb-620-exclusive-'));

  try {
    const first = createTestStoreDirectory(parent);
    writeFileSync(path.join(first, 'app-state.json'), '{"entries":{"planted":{}}}', 'utf8');

    const second = createTestStoreDirectory(parent);

    assert.notEqual(second, first);
    assert.equal(existsSync(path.join(second, 'app-state.json')), false);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test('the PLATFORM-207 plant at this process’s own pid path is no longer reachable', async () => {
  // The exact payload the 207 lane planted: a settings record holding BOTH planner
  // jobs, which is what turned a green suite into four failing planner tests.
  const planted = {
    entries: {
      [`${PROVIDER_REFRESH_SETTINGS_SCOPE}::${PROVIDER_REFRESH_SETTINGS_KEY}`]: {
        value: { globalPause: true, datasets: {} },
        updatedAt: '2026-09-05T00:00:00.000Z',
      },
    },
  };
  const serialized = JSON.stringify(planted);
  const livePath = getAppStateStorageStatus().filePath;

  try {
    // POSITIVE CONTROL FIRST, on the same bytes: at the store path this process
    // ACTUALLY reads, the plant is honoured. A "the plant did nothing" assertion
    // whose fixture could never have done anything is not evidence.
    await writeFile(livePath, serialized, 'utf8');
    assert.equal((await getProviderRefreshSettings()).globalPause, true);

    await __deleteAppStateFileForTests();
    __resetAppStateForTests();

    // Now the same bytes at the retired path. Same process, same pid.
    await writeFile(legacyPidPath(), serialized, 'utf8');

    assert.equal(
      await getAppState(PROVIDER_REFRESH_SETTINGS_SCOPE, PROVIDER_REFRESH_SETTINGS_KEY),
      null
    );
    assert.equal((await getProviderRefreshSettings()).globalPause, false);
  } finally {
    await unlink(legacyPidPath()).catch(() => undefined);
    await __deleteAppStateFileForTests();
    __resetAppStateForTests();
  }
});

test('the store directory this process uses is not derived from its pid', () => {
  const filePath = getAppStateStorageStatus().filePath;

  assert.equal(path.basename(filePath), 'app-state.json');
  assert.ok(path.basename(path.dirname(filePath)).startsWith(TEST_STORE_DIRECTORY_PREFIX));
  assert.doesNotMatch(filePath, new RegExp(`\\b${process.pid}\\b`));
});

// ---------------------------------------------------------------------------
// CLEANUP — a separate claim, asserted separately
// ---------------------------------------------------------------------------

type ChildStoreProbe = {
  child: ReturnType<typeof spawn>;
  storeDirectory: Promise<string>;
};

/**
 * Start a real isolated process that creates its store directory and then either
 * exits or waits to be killed. It must be a CHILD: `process.on('exit')` cleanup and
 * `SIGKILL` skipping it are both properties of a process ending, which an
 * in-process assertion cannot observe.
 */
function startStoreChild(runDirectory: string, hold: boolean): ChildStoreProbe {
  const driver = `
    const loaded = await import(${JSON.stringify(APP_STATE_MODULE)});
    const store = loaded.default ?? loaded;
    const filePath = store.getAppStateStorageStatus().filePath;
    process.stdout.write(filePath + '\\n');
    ${hold ? 'setInterval(() => {}, 1000);' : ''}
  `;
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '--eval', driver],
    {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        APP_STATE_TEST_ISOLATION: '1',
        APP_STATE_TEST_STORE_DIR: runDirectory,
        TSX_TSCONFIG_PATH: 'tsconfig.test.json',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  const storeDirectory = new Promise<string>((resolve, reject) => {
    let buffered = '';
    child.stdout.on('data', (chunk: Buffer) => {
      buffered += chunk.toString('utf8');
      const newline = buffered.indexOf('\n');
      if (newline >= 0) resolve(path.dirname(buffered.slice(0, newline).trim()));
    });
    child.on('exit', () => reject(new Error(`child exited before printing a store path`)));
    child.on('error', reject);
  });

  return { child, storeDirectory };
}

function whenExited(child: ReturnType<typeof spawn>): Promise<void> {
  return new Promise((resolve) => child.on('exit', () => resolve()));
}

test('a normal exit removes the store directory the process created', async () => {
  const runDirectory = mkdtempSync(path.join(os.tmpdir(), 'cfb-620-exit-'));

  try {
    const probe = startStoreChild(runDirectory, false);
    const storeDirectory = await probe.storeDirectory;

    assert.equal(path.dirname(storeDirectory), runDirectory);

    await whenExited(probe.child);

    assert.equal(existsSync(storeDirectory), false);
  } finally {
    rmSync(runDirectory, { recursive: true, force: true });
  }
});

test('SIGKILL SKIPS that cleanup — the run directory is what collects it', async () => {
  const runDirectory = mkdtempSync(path.join(os.tmpdir(), 'cfb-620-sigkill-'));

  try {
    const probe = startStoreChild(runDirectory, true);
    const storeDirectory = await probe.storeDirectory;

    assert.equal(existsSync(storeDirectory), true);

    probe.child.kill('SIGKILL');
    await whenExited(probe.child);

    // ASSERTED AS WHAT IT IS, not hidden inside the previous test: an exit handler
    // a killed process never runs leaves the directory exactly where it was.
    assert.equal(existsSync(storeDirectory), true);

    // What makes that survivable is containment, not cleanup — the orphan is inside
    // the run directory, so the runner's `finally` takes it with the run.
    assert.equal(path.dirname(storeDirectory), runDirectory);

    rmSync(runDirectory, { recursive: true, force: true });

    assert.equal(existsSync(storeDirectory), false);
  } finally {
    rmSync(runDirectory, { recursive: true, force: true });
  }
});

test('the runner creates a run directory, hands it to the child, and removes it', () => {
  const observed: { directory?: string; existedDuringSpawn?: boolean } = {};
  const fakeSpawn = ((
    _executable: string,
    _args: readonly string[],
    options: {
      env?: NodeJS.ProcessEnv;
    }
  ) => {
    observed.directory = options.env?.APP_STATE_TEST_STORE_DIR;
    observed.existedDuringSpawn = existsSync(observed.directory ?? '');
    return { status: 0 };
  }) as never;

  assert.equal(runTests(['src/test/__tests__/testStoreLifecycle.test.ts'], fakeSpawn), 0);

  assert.ok(observed.directory);
  assert.ok(path.basename(observed.directory).startsWith(TEST_STORE_DIRECTORY_PREFIX));
  assert.equal(observed.existedDuringSpawn, true);
  assert.equal(existsSync(observed.directory), false);
});

test('the run directory is removed even when the spawn throws', () => {
  let directory: string | undefined;
  const throwingSpawn = ((
    _executable: string,
    _args: readonly string[],
    options: {
      env?: NodeJS.ProcessEnv;
    }
  ) => {
    directory = options.env?.APP_STATE_TEST_STORE_DIR;
    throw new Error('spawn exploded');
  }) as never;

  assert.throws(
    () => runTests(['src/test/__tests__/testStoreLifecycle.test.ts'], throwingSpawn),
    /spawn exploded/
  );

  assert.ok(directory);
  assert.equal(existsSync(directory), false);
});

// ---------------------------------------------------------------------------
// THE SWEEP — bounded, prefix-scoped, and unable to reach the legacy files
// ---------------------------------------------------------------------------

test('the sweep removes orphaned run directories and nothing else', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'cfb-620-sweep-'));
  const now = Date.now();
  const stale = new Date(now - STALE_TEST_STORE_MAX_AGE_MS - 60_000);

  const orphaned = path.join(root, `${TEST_STORE_DIRECTORY_PREFIX}orphaned`);
  const live = path.join(root, `${TEST_STORE_DIRECTORY_PREFIX}live`);
  const unrelated = path.join(root, 'someone-elses-directory');
  const prefixedFile = path.join(root, `${TEST_STORE_DIRECTORY_PREFIX}not-a-directory.json`);
  // THE FILE THE GATE IS ABOUT: ~18,000 of these sit in the owner's $TMPDIR, and
  // removing them is his call, not a side effect of running the suite.
  const legacyFile = path.join(root, 'cfb-app-app-state-test-4242.json');

  try {
    for (const directory of [orphaned, live, unrelated]) mkdirSync(directory);
    for (const file of [prefixedFile, legacyFile]) writeFileSync(file, '{}', 'utf8');
    for (const entry of [orphaned, unrelated, prefixedFile, legacyFile]) {
      utimesSync(entry, stale, stale);
    }

    const removed = sweepStaleTestStoreDirectories(root, now, STALE_TEST_STORE_MAX_AGE_MS);

    assert.deepEqual(removed, [orphaned]);
    assert.equal(existsSync(orphaned), false);
    assert.equal(existsSync(live), true);
    assert.equal(existsSync(unrelated), true);
    assert.equal(existsSync(prefixedFile), true);
    assert.equal(existsSync(legacyFile), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the store and the runner name the same prefix', () => {
  // They are two declarations because `run-tests.mjs` is plain JS run by bare
  // `node` and cannot import a TypeScript module. A drift between them would leave
  // the sweep matching nothing while reporting success.
  assert.equal(RUNNER_TEST_STORE_DIRECTORY_PREFIX, TEST_STORE_DIRECTORY_PREFIX);
});

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
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
  const legacyPath = legacyPidPath();
  // THIS TEST DOES NOT GET TO DELETE ONE OF THE FILES THE ITEM IS ABOUT. Roughly a
  // quarter of processes already own a legacy file at their pid path — that rate IS
  // the defect being fixed — so planting here without preserving what was there
  // would quietly dispose of an owner artifact once every few runs, which is the
  // side-effect deletion this branch's gate forbids. Found by review.
  //
  // When nothing is there, a sentinel is written so the restore is ASSERTED on every
  // run rather than only on the one-in-four where a real file exists — a preservation
  // that is exercised by chance is a preservation nobody has tested.
  const priorLegacyBytes = existsSync(legacyPath) ? readFileSync(legacyPath) : null;
  const ownedByThisTest = priorLegacyBytes === null;
  const bytesToRestore = priorLegacyBytes ?? Buffer.from('{"entries":{"sentinel-620":{}}}');
  writeFileSync(legacyPath, bytesToRestore);

  try {
    // POSITIVE CONTROL FIRST, on the same bytes: at the store path this process
    // ACTUALLY reads, the plant is honoured. A "the plant did nothing" assertion
    // whose fixture could never have done anything is not evidence.
    await writeFile(livePath, serialized, 'utf8');
    assert.equal((await getProviderRefreshSettings()).globalPause, true);

    await __deleteAppStateFileForTests();
    __resetAppStateForTests();

    // Now the same bytes at the retired path. Same process, same pid.
    await writeFile(legacyPath, serialized, 'utf8');

    assert.equal(
      await getAppState(PROVIDER_REFRESH_SETTINGS_SCOPE, PROVIDER_REFRESH_SETTINGS_KEY),
      null
    );
    assert.equal((await getProviderRefreshSettings()).globalPause, false);

    writeFileSync(legacyPath, bytesToRestore);
    assert.deepEqual(readFileSync(legacyPath), bytesToRestore);
  } finally {
    writeFileSync(legacyPath, bytesToRestore);
    if (ownedByThisTest) await unlink(legacyPath).catch(() => undefined);
    await __deleteAppStateFileForTests();
    __resetAppStateForTests();
  }
});

test('an absent parent directory is recreated rather than thrown out of the read path', () => {
  const parent = path.join(
    mkdtempSync(path.join(os.tmpdir(), 'cfb-620-absent-parent-')),
    'gone',
    'deeper'
  );

  try {
    // The OS reaps `$TMPDIR` on its own schedule — observed doing so mid-session — and
    // an exported APP_STATE_TEST_STORE_DIR outlives its run. Without the recreate, an
    // absent parent makes every app-state read and write in the process throw ENOENT.
    const created = createTestStoreDirectory(parent);

    assert.equal(existsSync(created), true);
    assert.equal(path.dirname(created), parent);
  } finally {
    rmSync(path.dirname(path.dirname(parent)), { recursive: true, force: true });
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
 * `SIGKILL` skipping it are both properties of a process ENDING, which no in-process
 * assertion can observe.
 *
 * Settles on `close`, never on `exit`. Only `close` guarantees the stdio streams
 * have drained — `exit` can in principle arrive while a written line is still
 * buffered in the pipe, which would reject a probe that had in fact printed its
 * path. Neither reviewer could make that ordering happen here (600 spawns between
 * them, one with the parent's event loop blocked), so this is the guarantee being
 * taken rather than a flake being chased.
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

  // STDERR IS READ, NOT MERELY PIPED. An unread pipe blocks its writer at ~64 KB,
  // so a chatty child would hang to the 30s timeout instead of failing; and when the
  // child dies before printing — a tsx resolution failure, or a throw inside the
  // module under test — its stderr is the only account of why, so it belongs in the
  // rejection rather than in a discarded buffer. Found by review.
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });

  const storeDirectory = new Promise<string>((resolve, reject) => {
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      const newline = stdout.indexOf('\n');
      if (newline >= 0) resolve(path.dirname(stdout.slice(0, newline).trim()));
    });
    child.on('error', reject);
    child.on('close', () => {
      reject(
        new Error(
          `the store child closed without printing a store path.\nstderr:\n${stderr || '(empty)'}`
        )
      );
    });
  });

  return { child, storeDirectory };
}

/** Resolves once the child has ended AND its stdio has drained. */
function whenClosed(child: ReturnType<typeof spawn>): Promise<void> {
  return new Promise((resolve) => child.on('close', () => resolve()));
}

/**
 * Kill unconditionally on the way out. The held child is a bare `setInterval` that
 * never returns on its own, and Node does not reap a child when its parent exits —
 * so a single failed assertion before the explicit kill would leave a `node` process
 * spinning on the developer's machine, holding nothing the sweep can see. Killing an
 * already-dead child is a no-op. Found by review.
 */
async function withStoreChild(
  runDirectory: string,
  hold: boolean,
  body: (probe: ChildStoreProbe) => Promise<void>
): Promise<void> {
  const probe = startStoreChild(runDirectory, hold);
  try {
    await body(probe);
  } finally {
    probe.child.kill('SIGKILL');
  }
}

test('a normal exit removes the store directory the process created', async () => {
  const runDirectory = mkdtempSync(path.join(os.tmpdir(), 'cfb-620-exit-'));

  try {
    await withStoreChild(runDirectory, false, async (probe) => {
      const storeDirectory = await probe.storeDirectory;

      assert.equal(path.dirname(storeDirectory), runDirectory);

      await whenClosed(probe.child);

      assert.equal(existsSync(storeDirectory), false);
    });
  } finally {
    rmSync(runDirectory, { recursive: true, force: true });
  }
});

test('SIGKILL SKIPS that cleanup — the run directory is what collects it', async () => {
  const runDirectory = mkdtempSync(path.join(os.tmpdir(), 'cfb-620-sigkill-'));

  try {
    await withStoreChild(runDirectory, true, async (probe) => {
      const storeDirectory = await probe.storeDirectory;

      assert.equal(existsSync(storeDirectory), true);

      probe.child.kill('SIGKILL');
      await whenClosed(probe.child);

      // ASSERTED AS WHAT IT IS, not hidden inside the previous test: an exit handler
      // a killed process never runs leaves the directory exactly where it was.
      assert.equal(existsSync(storeDirectory), true);

      // What makes that survivable is containment, not cleanup — the orphan is inside
      // the run directory, so the runner's `finally` takes it with the run.
      assert.equal(path.dirname(storeDirectory), runDirectory);

      rmSync(runDirectory, { recursive: true, force: true });

      assert.equal(existsSync(storeDirectory), false);
    });
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

test('an uncreatable run directory warns and runs anyway — cleanup never fails the run', () => {
  // The run directory buys CLEANUP, so failing the suite when it cannot be made
  // would invert the design's own priority: isolation is intact either way, because
  // the store falls back to `os.tmpdir()` when the variable is absent.
  const staleValue = process.env.APP_STATE_TEST_STORE_DIR;
  const warnings: string[] = [];
  const originalWarn = console.warn;
  let environment: NodeJS.ProcessEnv | undefined;

  const fakeSpawn = ((
    _executable: string,
    _args: readonly string[],
    options: { env?: NodeJS.ProcessEnv }
  ) => {
    environment = options.env;
    return { status: 0 };
  }) as never;

  try {
    // A stale export from an earlier run must not survive into the children.
    process.env.APP_STATE_TEST_STORE_DIR = '/tmp/a-directory-that-this-run-does-not-own';
    console.warn = (message: string) => warnings.push(String(message));

    const status = runTests(
      ['src/test/__tests__/testStoreLifecycle.test.ts'],
      fakeSpawn,
      // `mkdtemp` under a path whose parent is a FILE cannot succeed.
      path.join(os.devNull, 'unreachable')
    );

    assert.equal(status, 0);
    assert.equal(environment?.APP_STATE_TEST_STORE_DIR, undefined);
    assert.equal(environment?.APP_STATE_TEST_ISOLATION, '1');
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /Could not create a test store run directory/);
  } finally {
    console.warn = originalWarn;
    if (staleValue === undefined) delete process.env.APP_STATE_TEST_STORE_DIR;
    else process.env.APP_STATE_TEST_STORE_DIR = staleValue;
  }
});

test('a run directory that cannot be removed does not turn a green run red', () => {
  const parent = mkdtempSync(path.join(os.tmpdir(), 'cfb-620-unremovable-'));
  let runDirectory: string | undefined;

  const fakeSpawn = ((
    _executable: string,
    _args: readonly string[],
    options: { env?: NodeJS.ProcessEnv }
  ) => {
    runDirectory = options.env?.APP_STATE_TEST_STORE_DIR;
    // Removing a directory needs write permission on its PARENT, so this makes the
    // `finally`'s `rmSync` fail with EACCES exactly when it runs.
    chmodSync(parent, 0o555);
    return { status: 0 };
  }) as never;

  try {
    assert.equal(runTests(['src/test/__tests__/testStoreLifecycle.test.ts'], fakeSpawn, parent), 0);
    assert.ok(runDirectory);
    assert.equal(existsSync(runDirectory), true);
  } finally {
    chmodSync(parent, 0o755);
    rmSync(parent, { recursive: true, force: true });
  }
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

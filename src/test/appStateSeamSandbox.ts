import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { __resetAppStateForTests } from '@/lib/server/appStateStore';

/**
 * PLATFORM-211 — the sandbox every destructive-seam refusal test runs inside.
 *
 * A test for a refusal has to RUN the unguarded path to prove the guard works,
 * so its failure mode IS the damage. On the Item 210 branch that fired twice:
 * one mutation lost nothing only because no dev store happened to exist, and the
 * next actually wrote `{not-valid-json` over `data/app-state.json`. So the
 * sandbox is built first and the mutation runs inside it, never the reverse.
 *
 * It lives in `src/test/` rather than beside one suite because FOUR suites across
 * two subsystems need it — the three Item 211 stores and Item 210's
 * `appStateStore.test.ts` — and `AGENTS.md` → **Verification** puts harnesses
 * crossing a subsystem boundary here. A second sandbox vocabulary would be the
 * same drift this campaign rejects for refusal MESSAGES; Item 210's suite having
 * layer 1 without layer 2 was that drift already starting.
 *
 * TWO layers, because they fail in different ways.
 *
 * 1. `DATABASE_URL` is pinned to a port the kernel refuses instantly, so a seam
 *    that escapes its guard dies at connect before reaching a row. **Pinning is a
 *    DIVERSION, NOT A FILTER**, and the distinction is the whole reason layer 2
 *    exists. `deleteAppState` does not skip its file write when a URL is present —
 *    it takes the Postgres branch INSTEAD, and the file write sits in the `else`
 *    below it. Read `hasDatabaseConfig()` as a filter and you conclude the file
 *    path is unreachable; it is reachable, and it is what runs whenever the URL is
 *    unset — writing the durable `data/app-state.json`, and CREATING it when
 *    absent. Measured, not assumed: with cwd relocated and no URL, one
 *    `deleteAppState` call produced `{"entries": {}}` at `data/app-state.json`.
 *    The pin therefore rests entirely on one branch selection holding.
 * 2. `cwd` is relocated to a temp directory, which is what survives layer 1
 *    failing. `appStateFilePath()` falls back to `path.join(process.cwd(), 'data')`,
 *    so with cwd moved even a regression in `hasDatabaseConfig()` writes into the
 *    sandbox rather than the developer's store. Item 210 needed this alone for
 *    `__corruptAppStateFileForTests`, whose write is unconditional and has no URL
 *    to neutralise.
 *
 * Top-level tests within a file run sequentially — the runner's
 * `--test-concurrency` is FILE-level, and each file is its own process — so the
 * process-wide `chdir` cannot race a neighbouring test.
 */

/** Refused instantly by the kernel, so nothing here can hang on DNS or a socket. */
export const UNREACHABLE_DATABASE_URL = 'postgres://user:pw@127.0.0.1:1/nowhere';

/** Captured at import, before any test can `chdir`. */
const REPO_ROOT = process.cwd();
export const DURABLE_STORE_PATH = path.join(REPO_ROOT, 'data', 'app-state.json');

export type StoreFingerprint = {
  exists: boolean;
  digest: string | null;
  inode: number | null;
  mtimeMs: number | null;
};

/**
 * CONTENT IS NOT ENOUGH, AND THE GAP IS MEASURED RATHER THAN THEORETICAL.
 * `writeJsonFileAtomic` writes a temp file and RENAMES it over the target, so
 * deleting an absent key from an existing store replaces the file with
 * byte-identical JSON. A digest-only fingerprint stays green through that: probed
 * on a sandboxed store, sha256 `b62dd01fd1bc` before and after, inode 155116585 →
 * 155116586. The replacement loses no data, but the point of this observer is to
 * notice that a destructive seam RAN AT ALL, so the inode is what makes the event
 * visible and the digest is what makes the damage visible.
 */
export function fingerprintStore(storePath: string = DURABLE_STORE_PATH): StoreFingerprint {
  let stats;
  try {
    stats = statSync(storePath);
  } catch {
    return { exists: false, digest: null, inode: null, mtimeMs: null };
  }
  return {
    exists: true,
    digest: createHash('sha256').update(readFileSync(storePath)).digest('hex'),
    inode: stats.ino,
    mtimeMs: stats.mtimeMs,
  };
}

const FINGERPRINT_AT_IMPORT = fingerprintStore();

/**
 * The observer behind {@link assertDurableStoreUntouched}, parameterised so its
 * own POSITIVE CONTROL can drive it against a sandboxed store rather than the
 * real one. `AGENTS.md` → **Verification** requires a negative assertion to prove
 * its observer detects the forbidden event on the same path, and pointing that
 * proof at `data/app-state.json` would perform the damage it exists to forbid.
 */
export function assertStoreUnchanged(baseline: StoreFingerprint, storePath: string): void {
  assert.deepEqual(
    fingerprintStore(storePath),
    baseline,
    // ATTRIBUTION THIS CANNOT ESTABLISH IS LEFT OUT ON PURPOSE. `data/app-state.json`
    // is one repo-root file and the runner runs up to four suites as concurrent
    // sibling PROCESSES, each holding its own baseline — so a write by any suite
    // reddens every suite that imported before it, and a suite importing after it
    // adopts the damaged file as its own baseline. The check is a real backstop;
    // "this suite wrote it" is not something it can know.
    `The durable store at ${storePath} changed during this test run — a destructive ` +
      'test-only seam escaped its refusal in SOME suite of this run, not necessarily this one.'
  );
}

/** Assert the durable store neither appeared, changed, nor was replaced. */
export function assertDurableStoreUntouched(): void {
  assertStoreUnchanged(FINGERPRINT_AT_IMPORT, DURABLE_STORE_PATH);
}

/**
 * Run `body` with the given environment overrides, inside a relocated `cwd`, with
 * `DATABASE_URL` pinned unreachable unless the caller overrides it. Restores the
 * environment, the working directory and the app-state pool afterwards.
 */
export async function withSeamSandbox(
  overrides: Record<string, string | undefined>,
  body: () => Promise<void>
): Promise<void> {
  // EVERY MUTATION HAPPENS INSIDE THE `try`. With the environment loop above it,
  // a throw from `mkdtempSync` — an unwritable or full TMPDIR — would leave
  // DATABASE_URL pinned and APP_STATE_TEST_ISOLATION DELETED with nothing to
  // restore them, and every remaining test in the file would then run with
  // isolation off against the durable store. Found by review; `withEnvironment`
  // in Item 210's suite had the same shape, which is one more reason for the two
  // to share this one implementation.
  const previousEnv = new Map<string, string | undefined>();
  const previousCwd = process.cwd();
  let sandbox: string | null = null;

  try {
    const applied: Record<string, string | undefined> = {
      DATABASE_URL: UNREACHABLE_DATABASE_URL,
      ...overrides,
    };
    for (const [name, value] of Object.entries(applied)) {
      previousEnv.set(name, process.env[name]);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }

    sandbox = mkdtempSync(path.join(os.tmpdir(), 'app-state-seam-sandbox-'));
    process.chdir(sandbox);
    __resetAppStateForTests();

    await body();
  } finally {
    process.chdir(previousCwd);
    if (sandbox) rmSync(sandbox, { recursive: true, force: true });
    for (const [name, value] of previousEnv) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    __resetAppStateForTests();
  }
}

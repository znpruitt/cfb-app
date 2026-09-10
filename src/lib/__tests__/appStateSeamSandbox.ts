import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { __resetAppStateForTests } from '../server/appStateStore.ts';

/**
 * PLATFORM-211 — the sandbox every destructive-seam refusal test runs inside.
 *
 * A test for a refusal has to RUN the unguarded path to prove the guard works,
 * so its failure mode IS the damage. On the Item 210 branch that fired twice:
 * one mutation lost nothing only because no dev store happened to exist, and the
 * next actually wrote `{not-valid-json` over `data/app-state.json`. So the
 * sandbox is built first and the mutation runs inside it, never the reverse.
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
 *    absent (`readFileStore` returns `{}` on ENOENT, `writeJsonFileAtomic` does
 *    `mkdir -p` then rename). The pin therefore rests entirely on one branch
 *    selection holding.
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
const DURABLE_STORE_PATH = path.join(REPO_ROOT, 'data', 'app-state.json');

type StoreFingerprint = { exists: boolean; digest: string | null };

function fingerprintDurableStore(): StoreFingerprint {
  try {
    statSync(DURABLE_STORE_PATH);
  } catch {
    return { exists: false, digest: null };
  }
  return {
    exists: true,
    digest: createHash('sha256').update(readFileSync(DURABLE_STORE_PATH)).digest('hex'),
  };
}

const FINGERPRINT_AT_IMPORT = fingerprintDurableStore();

/**
 * Assert the suite neither created nor rewrote the durable store — the direct
 * check for the damage that has already happened once.
 *
 * Stated as "unchanged" rather than "absent" because `data/app-state.json` is a
 * gitignored dev artifact (`.gitignore:70`, `data/*.json`): it is absent in a
 * clean worktree and present on any machine that has run `npm run dev`. An
 * absence assertion would pass here and fail there while measuring nothing extra.
 * When the file is absent at import — the usual case, and the case in the
 * worktree this shipped from — "unchanged" IS "still absent".
 */
export function assertDurableStoreUntouched(): void {
  assert.deepEqual(
    fingerprintDurableStore(),
    FINGERPRINT_AT_IMPORT,
    `The suite wrote ${DURABLE_STORE_PATH}. A destructive test-only seam escaped its refusal.`
  );
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
  const applied: Record<string, string | undefined> = {
    DATABASE_URL: UNREACHABLE_DATABASE_URL,
    ...overrides,
  };

  const previousEnv = new Map<string, string | undefined>();
  for (const [name, value] of Object.entries(applied)) {
    previousEnv.set(name, process.env[name]);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }

  const previousCwd = process.cwd();
  const sandbox = mkdtempSync(path.join(os.tmpdir(), 'item211-seam-sandbox-'));
  process.chdir(sandbox);
  __resetAppStateForTests();

  try {
    await body();
  } finally {
    process.chdir(previousCwd);
    rmSync(sandbox, { recursive: true, force: true });
    for (const [name, value] of previousEnv) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    __resetAppStateForTests();
  }
}

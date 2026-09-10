import assert from 'node:assert/strict';
import { mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  assertStoreUnchanged,
  fingerprintStore,
  withSeamSandbox,
} from '@/test/appStateSeamSandbox';

// ---------------------------------------------------------------------------
// PLATFORM-211 — THE POSITIVE CONTROL FOR A NEGATIVE ASSERTION.
//
// `assertDurableStoreUntouched` claims nothing wrote the durable store. Per
// `AGENTS.md` → **Verification**, a claim like that is worth nothing until the
// same observer is shown DETECTING the forbidden event: an observer that never
// looks and an observer that looked and found nothing return the identical
// green. Item 211 mutation-proved all three production guards and left the
// observer watching them unproven — found by review, and it is the same lapse
// INSIGHTS-029 recorded (a fixture-based test needs a positive control proving
// the fixture CAN fail).
//
// Every control runs against a SANDBOXED store path. Pointing them at the real
// `data/app-state.json` would perform exactly the damage the observer forbids.
// ---------------------------------------------------------------------------

function withTempStore(body: (storePath: string) => void): void {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'seam-observer-control-'));
  try {
    body(path.join(directory, 'app-state.json'));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('observer control: a store APPEARING where none existed is detected', () => {
  withTempStore((storePath) => {
    const baseline = fingerprintStore(storePath);
    assert.equal(baseline.exists, false);
    assert.doesNotThrow(() => assertStoreUnchanged(baseline, storePath));

    writeFileSync(storePath, '{"entries":{}}\n', 'utf8');

    assert.throws(() => assertStoreUnchanged(baseline, storePath), {
      name: 'AssertionError',
    });
  });
});

test('observer control: a CORRUPTING write over an existing store is detected', () => {
  withTempStore((storePath) => {
    writeFileSync(storePath, '{"entries":{}}\n', 'utf8');
    const baseline = fingerprintStore(storePath);
    assert.doesNotThrow(() => assertStoreUnchanged(baseline, storePath));

    writeFileSync(storePath, '{not-valid-json', 'utf8');

    assert.throws(() => assertStoreUnchanged(baseline, storePath), {
      name: 'AssertionError',
    });
  });
});

test('observer control: a BYTE-IDENTICAL atomic replacement is detected', () => {
  // The case a digest-only fingerprint misses, and the reason the fingerprint
  // carries the inode. `writeJsonFileAtomic` renames a temp file over the target,
  // so deleting an ABSENT key from an existing store rewrites identical bytes —
  // no data lost, but a destructive seam demonstrably ran. Reproduced here with a
  // rename rather than through a seam, so the control cannot itself be
  // destructive.
  withTempStore((storePath) => {
    const contents = '{"entries":{}}\n';
    writeFileSync(storePath, contents, 'utf8');
    const baseline = fingerprintStore(storePath);

    const replacement = `${storePath}.replacement`;
    writeFileSync(replacement, contents, 'utf8');
    renameSync(replacement, storePath);

    const after = fingerprintStore(storePath);
    assert.equal(after.digest, baseline.digest, 'the bytes really are identical');
    assert.notEqual(after.inode, baseline.inode, 'the inode is what makes the event visible');
    assert.throws(() => assertStoreUnchanged(baseline, storePath), {
      name: 'AssertionError',
    });
  });
});

test('withSeamSandbox restores cwd and environment even when the body throws', () => {
  // The restore path matters more than the happy path: if it leaks, every later
  // test in that file runs with isolation off against the durable store.
  const cwdBefore = process.cwd();
  const isolationBefore = process.env.APP_STATE_TEST_ISOLATION;
  const urlBefore = process.env.DATABASE_URL;

  return assert
    .rejects(
      () =>
        withSeamSandbox({ APP_STATE_TEST_ISOLATION: undefined }, async () => {
          assert.notEqual(process.cwd(), cwdBefore, 'the body runs relocated');
          assert.equal(process.env.APP_STATE_TEST_ISOLATION, undefined);
          throw new Error('body failure');
        }),
      /body failure/
    )
    .then(() => {
      assert.equal(process.cwd(), cwdBefore);
      assert.equal(process.env.APP_STATE_TEST_ISOLATION, isolationBefore);
      assert.equal(process.env.DATABASE_URL, urlBefore);
    });
});

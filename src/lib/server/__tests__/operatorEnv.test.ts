import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  OPERATOR_READ_CREDENTIAL_REFUSAL,
  OPERATOR_READ_ENV_FILE,
  OPERATOR_WRITE_CREDENTIAL_REFUSAL,
  OPERATOR_WRITE_ENV_FILE,
  operatorReadOnlyEnv,
  operatorWriteConnectionString,
} from '../../../../scripts/lib/operatorEnv';
import {
  applyRunCredential,
  runNeedsWriteCredential,
} from '../../../../scripts/recover-game-stats';
import type { RecoveryArgs } from '../../../../scripts/recover-game-stats';

/**
 * Issue #703 — the operator write credential, and which runs may see it.
 *
 * EVERY CASE POINTS AT A FIXTURE DIRECTORY, never at `process.cwd()`. The machine
 * running this suite has a real `.env.operator.local`, and will have a real
 * `.env.operator.write.local` once the key is moved — so a test that let the
 * lookup fall through to the repo root would be asserting a fact about the
 * developer's disk, and "the file is absent" would flip from true to false the day
 * the fix is finished being applied.
 */

const CAPTURE: RecoveryArgs = {
  mode: 'capture',
  year: 2021,
  week: 15,
  seasonType: 'regular',
  gameIds: [1],
  out: '/tmp/out.json',
  quotaOverride: false,
};
const APPLY_DRY: RecoveryArgs = { mode: 'apply', capture: '/tmp/c.json', apply: false };
const APPLY_COMMIT: RecoveryArgs = { mode: 'apply', capture: '/tmp/c.json', apply: true };

function fixture(files: Record<string, string>): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'cfb703-'));
  for (const [name, contents] of Object.entries(files)) {
    writeFileSync(path.join(directory, name), contents, 'utf8');
  }
  return directory;
}

test('only `apply --apply` needs the write credential', () => {
  // Measured against the code, not assumed: `runCapture` contains no write-capable
  // call, and `runApply` returns before its single `commit` when `--apply` is absent.
  assert.equal(runNeedsWriteCredential(CAPTURE), false);
  assert.equal(runNeedsWriteCredential(APPLY_DRY), false);
  assert.equal(runNeedsWriteCredential(APPLY_COMMIT), true);
});

test('a read-only run gets the rail, and an exported write credential does NOT survive it', () => {
  const directory = fixture({ [OPERATOR_READ_ENV_FILE]: 'DATABASE_URL_RO=postgres://ro\n' });

  try {
    // THE ASSIGNMENT IS UNCONDITIONAL, and this is the case that proves it. An
    // operator with the production write credential exported in their shell still
    // runs `capture` on the rail: "prefer the read-only string" is a preference, and
    // a preference is not a guarantee.
    const env: Record<string, string | undefined> = { DATABASE_URL: 'postgres://EXPORTED-WRITE' };
    const result = applyRunCredential(CAPTURE, env, directory);

    assert.deepEqual(result, { ok: true });
    assert.equal(env.DATABASE_URL, 'postgres://ro');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a dry-run apply also runs on the rail, with no write file present at all', () => {
  const directory = fixture({ [OPERATOR_READ_ENV_FILE]: 'DATABASE_URL_RO=postgres://ro\n' });

  try {
    const env: Record<string, string | undefined> = {};

    assert.deepEqual(applyRunCredential(APPLY_DRY, env, directory), { ok: true });
    assert.equal(env.DATABASE_URL, 'postgres://ro');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('`apply --apply` takes the write credential from its own file, never the rail file', () => {
  const directory = fixture({
    [OPERATOR_READ_ENV_FILE]: 'DATABASE_URL_RO=postgres://ro\nDATABASE_URL=postgres://LEGACY-RW\n',
    [OPERATOR_WRITE_ENV_FILE]: 'DATABASE_URL=postgres://rw\n',
  });

  try {
    const env: Record<string, string | undefined> = {};

    assert.deepEqual(applyRunCredential(APPLY_COMMIT, env, directory), { ok: true });
    // The rail file's own `DATABASE_URL` — the key this item exists to relocate — is
    // never what is used, even while it is still sitting there.
    assert.equal(env.DATABASE_URL, 'postgres://rw');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a missing write file refuses, and the refusal is the one that names the anti-pattern', () => {
  const directory = fixture({ [OPERATOR_READ_ENV_FILE]: 'DATABASE_URL_RO=postgres://ro\n' });

  try {
    const env: Record<string, string | undefined> = {};
    const result = applyRunCredential(APPLY_COMMIT, env, directory);

    assert.deepEqual(result, { ok: false, refusal: OPERATOR_WRITE_CREDENTIAL_REFUSAL });
    // Nothing was set: a caller that warned and continued would land on the local
    // file fallback, which is not what an operator asking to write production wants.
    assert.equal(env.DATABASE_URL, undefined);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('no write file + the legacy key STILL in the rail file refuses — the pre-move state', () => {
  // THE STATE OF THE OWNER'S MACHINE THE DAY THIS SHIPS, and the case that a
  // mutation caught this suite failing to cover. `.env.operator.local` still holds
  // the production `DATABASE_URL` until the key is moved by hand; a write reader
  // that fell back to it would find a working credential, every `apply --apply`
  // would keep succeeding, and the split would look done while changing nothing.
  //
  // Mutation target: add a fallback from the write file to the rail file and this
  // goes red alone — the four cases around it stay green, which is how the gap hid.
  const directory = fixture({
    [OPERATOR_READ_ENV_FILE]: 'DATABASE_URL_RO=postgres://ro\nDATABASE_URL=postgres://LEGACY-RW\n',
  });

  try {
    const env: Record<string, string | undefined> = {};

    assert.equal(operatorWriteConnectionString(directory), null);
    assert.deepEqual(applyRunCredential(APPLY_COMMIT, env, directory), {
      ok: false,
      refusal: OPERATOR_WRITE_CREDENTIAL_REFUSAL,
    });
    assert.equal(env.DATABASE_URL, undefined);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a missing rail refuses too, rather than falling through to the file store', () => {
  const directory = fixture({});

  try {
    const env: Record<string, string | undefined> = {};
    const result = applyRunCredential(CAPTURE, env, directory);

    assert.deepEqual(result, { ok: false, refusal: OPERATOR_READ_CREDENTIAL_REFUSAL });
    assert.equal(env.DATABASE_URL, undefined);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('both refusals name the file, the key, and the prohibition', () => {
  // THE PROHIBITION IS THE POINT AND IT IS ASSERTED SEPARATELY. A reword that keeps
  // the filename and drops `vercel env pull` would still read like a helpful error
  // and would still send the next operator to write every production secret to disk
  // to supply one — which is the failure the read-only rail exists to prevent.
  for (const refusal of [OPERATOR_WRITE_CREDENTIAL_REFUSAL, OPERATOR_READ_CREDENTIAL_REFUSAL]) {
    assert.match(refusal, /vercel env pull/);
    assert.match(refusal, /Do NOT run/);
  }
  assert.match(OPERATOR_WRITE_CREDENTIAL_REFUSAL, /\.env\.operator\.write\.local/);
  assert.match(OPERATOR_WRITE_CREDENTIAL_REFUSAL, /DATABASE_URL/);
  assert.match(OPERATOR_WRITE_CREDENTIAL_REFUSAL, /apply --apply/);
  assert.match(OPERATOR_READ_CREDENTIAL_REFUSAL, /\.env\.operator\.local/);
  assert.match(OPERATOR_READ_CREDENTIAL_REFUSAL, /DATABASE_URL_RO/);
});

test('neither reader touches `process.env`, whatever its file holds', () => {
  const directory = fixture({
    [OPERATOR_READ_ENV_FILE]: 'DATABASE_URL_RO=postgres://ro\nDATABASE_URL=postgres://LEGACY-RW\n',
    [OPERATOR_WRITE_ENV_FILE]: 'DATABASE_URL=postgres://rw\nSOMETHING_ELSE=nope\n',
  });
  const beforeUrl = process.env.DATABASE_URL;
  const beforeRo = process.env.DATABASE_URL_RO;
  // Snapshotted, not assumed absent: the runner forwards the ambient environment, so
  // asserting `undefined` outright would make this suite's result depend on the host
  // that ran it. Found by review. `AGENTS.md` requires the gate be deterministic.
  const beforeOther = process.env.SOMETHING_ELSE;

  try {
    // Exactly one key each, into a private object — the mechanism that stops a file
    // holding two credentials from handing a process the one it must not have.
    assert.deepEqual(Object.keys(operatorReadOnlyEnv({}, directory)), ['DATABASE_URL_RO']);
    assert.equal(operatorWriteConnectionString(directory), 'postgres://rw');

    assert.equal(process.env.DATABASE_URL, beforeUrl, 'ambient DATABASE_URL untouched');
    assert.equal(process.env.DATABASE_URL_RO, beforeRo, 'ambient DATABASE_URL_RO untouched');
    assert.equal(process.env.SOMETHING_ELSE, beforeOther);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('an exported DATABASE_URL is NOT what `apply --apply` writes to', () => {
  // THE TEST THAT USED TO ASSERT THE OPPOSITE. It read "an ambient write credential
  // wins without the file being read", which made the suite defend the defect review
  // found: `main` runs a bare `dotenv.config()` before the credential is resolved, so
  // a stray `.env` or one `export` would have become the target of a production write
  // and the tool would have reported a successful merge against a database nobody
  // chose. The read path beside it already refused to be a preference; this one now
  // matches it.
  const directory = fixture({ [OPERATOR_WRITE_ENV_FILE]: 'DATABASE_URL=postgres://from-file\n' });
  const previous = process.env.DATABASE_URL;

  try {
    process.env.DATABASE_URL = 'postgres://EXPORTED-BY-THE-SHELL';

    assert.equal(operatorWriteConnectionString(directory), 'postgres://from-file');

    const env: Record<string, string | undefined> = {
      DATABASE_URL: 'postgres://EXPORTED-BY-THE-SHELL',
    };
    assert.deepEqual(applyRunCredential(APPLY_COMMIT, env, directory), { ok: true });
    assert.equal(env.DATABASE_URL, 'postgres://from-file');
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a trailing newline is trimmed OFF the value, not merely tested for', () => {
  // `$(cat …)` and here-docs carry one. Untrimmed it reaches `new Pool` and fails
  // inside pg rather than at the refusal. Found by review.
  const directory = fixture({
    [OPERATOR_WRITE_ENV_FILE]: 'DATABASE_URL="postgres://rw   "\n',
  });

  try {
    assert.equal(operatorWriteConnectionString(directory), 'postgres://rw');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

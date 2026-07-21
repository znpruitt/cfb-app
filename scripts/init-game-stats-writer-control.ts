// One-shot initializer for the game-stats writer-control record
// (PLATFORM-086H3B-REPLACEMENT-LEGACY-WRITER-FENCE).
//
// It creates the SINGLE initial valid `legacy` writer-control record that the
// fenced legacy writer revalidates on every write. This record MUST exist before
// the fenced writer is deployed — otherwise the fence fails closed and legacy
// game-stat writes are refused (see the rollout sequence in the runbook).
//
// It is intentionally NOT an operations surface: it can only CREATE the initial
// `legacy` record when the row is durably absent. It is an idempotent no-op when a
// valid `legacy` record already exists, and it REFUSES (writes nothing) when the
// row is malformed or in any non-`legacy` state. It can never arm, activate, stop,
// repair, delete, or otherwise edit the record — those are future (E) concerns.
//
// Usage:
//   tsx scripts/init-game-stats-writer-control.ts           # dry run (report only)
//   tsx scripts/init-game-stats-writer-control.ts --apply   # create the legacy row
//
// Dry run is read-only. `--apply` operates ONLY against a writable PostgreSQL store
// (it refuses a dev/file or read-only connection). Run the dry run first.
//
// Exit codes: 0 = success / would-create / already-legacy no-op;
//             2 = refused (malformed or non-legacy record — investigate manually);
//             3 = store unavailable / not a writable PostgreSQL store;
//             1 = unexpected error.

import path from 'node:path';
import { pathToFileURL } from 'node:url';

import dotenv from 'dotenv';

import {
  assertAppStateWritable,
  getAppStateStorageStatus,
  withAppStateKeyTransaction,
} from '../src/lib/server/appStateStore.ts';
import {
  WRITER_CONTROL_KEY,
  WRITER_CONTROL_SCOPE,
  initialLegacyWriterControl,
  toWriterControlRead,
  type WriterControlState,
} from '../src/lib/gameStats/writerFence.ts';

/** The bounded outcome of an initialization attempt (create-if-absent only). */
export type WriterControlInitOutcome =
  | { action: 'would-create' } // absent + dry-run: nothing written
  | { action: 'created' } // absent + apply: initial `legacy` record written
  | { action: 'noop-valid-legacy' } // already a valid `legacy` record: nothing written
  | { action: 'refused-malformed' } // present but malformed: nothing written
  | { action: 'refused-not-legacy'; state: WriterControlState }; // non-legacy: nothing written

/**
 * Core initializer logic against the configured app-state store. CREATE-IF-ABSENT
 * only, ATOMICALLY: the presence-aware reread and the initial-`legacy` write run in ONE
 * `withAppStateKeyTransaction` rooted (and advisory-locked) on the writer-control key,
 * so absence is required at the instant the record is written — a concurrent
 * initializer or future transition cannot be overwritten, and a racing second
 * initializer observes the committed record and returns the truthful outcome. A
 * malformed or non-`legacy` present record is refused and left untouched — this
 * function never overwrites, resets, arms, activates, or deletes a record.
 * Store-agnostic so it can be tested against the isolated file store; the CLI enforces
 * PostgreSQL for `--apply`.
 */
export async function initializeWriterControl(opts: {
  apply: boolean;
}): Promise<WriterControlInitOutcome> {
  return await withAppStateKeyTransaction<WriterControlInitOutcome>(
    WRITER_CONTROL_SCOPE,
    WRITER_CONTROL_KEY,
    async (txn) => {
      const read = toWriterControlRead(await txn.read<unknown>());
      if (!read.present) {
        if (!opts.apply) return { action: 'would-create' };
        await txn.write(initialLegacyWriterControl());
        return { action: 'created' };
      }
      if (read.record === null) return { action: 'refused-malformed' };
      if (read.record.state !== 'legacy') {
        return { action: 'refused-not-legacy', state: read.record.state };
      }
      return { action: 'noop-valid-legacy' };
    }
  );
}

/** Map an outcome to a sanitized human line + process exit code. */
export function describeOutcome(
  outcome: WriterControlInitOutcome,
  apply: boolean
): { line: string; code: number } {
  const target = `${WRITER_CONTROL_SCOPE}/${WRITER_CONTROL_KEY}`;
  switch (outcome.action) {
    case 'would-create':
      return {
        line: `[dry-run] ${target} is absent — would create the initial \`legacy\` record.`,
        code: 0,
      };
    case 'created':
      return {
        line: `[apply] created the initial \`legacy\` writer-control record at ${target}.`,
        code: 0,
      };
    case 'noop-valid-legacy':
      return {
        line: `${apply ? '[apply]' : '[dry-run]'} ${target} already holds a valid \`legacy\` record — no change.`,
        code: 0,
      };
    case 'refused-malformed':
      return {
        line: `REFUSED: ${target} holds a malformed record. This tool never edits state — investigate manually.`,
        code: 2,
      };
    case 'refused-not-legacy':
      return {
        line: `REFUSED: ${target} is in state \`${outcome.state}\`, not \`legacy\`. This tool never transitions state — investigate manually.`,
        code: 2,
      };
  }
}

async function main(): Promise<void> {
  // Load the TARGET environment before inspecting storage, so a `DATABASE_URL` that
  // lives only in `.env.local` selects PostgreSQL (not the dev/file fallback) for both
  // the dry run and `--apply`. `.env.local` wins; `.env` fills any gaps.
  dotenv.config({ path: path.join(process.cwd(), '.env.local') });
  dotenv.config();

  const apply = process.argv.includes('--apply');
  const mode = getAppStateStorageStatus().mode;
  // Report the resolved storage mode so the operator can see WHICH store the dry run
  // inspected (a dry run against `file-fallback` is not inspecting the target DB).
  console.log(`storage mode: ${mode}`);

  if (apply) {
    // `--apply` only against a writable PostgreSQL store — never a dev/file or
    // read-only connection.
    if (mode !== 'postgres') {
      console.error('REFUSED: --apply requires a PostgreSQL store (set DATABASE_URL). Aborting.');
      process.exit(3);
    }
    try {
      await assertAppStateWritable();
    } catch {
      console.error(
        'REFUSED: the PostgreSQL store is not writable (read-only or unavailable). Aborting.'
      );
      process.exit(3);
    }
  }
  try {
    const outcome = await initializeWriterControl({ apply });
    const { line, code } = describeOutcome(outcome, apply);
    console.log(line);
    if (!apply && outcome.action === 'would-create') {
      console.log('Re-run with --apply against the target PostgreSQL environment to create it.');
    }
    process.exit(code);
  } catch (err) {
    // Redacted by default — raw store/driver errors can leak paths, hosts, or SQL into
    // operator/CI logs. Detail is available only through an explicitly enabled channel.
    const detail =
      process.env.INIT_WRITER_CONTROL_DEBUG === '1' && err instanceof Error
        ? `: ${err.message}`
        : '';
    console.error(
      `unexpected error [writer-control-init-failed] (set INIT_WRITER_CONTROL_DEBUG=1 for detail)${detail}`
    );
    process.exit(1);
  }
}

// Run the CLI only when invoked directly, so tests can import the core function
// without triggering the process-exiting wrapper.
const invokedDirectly =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) void main();

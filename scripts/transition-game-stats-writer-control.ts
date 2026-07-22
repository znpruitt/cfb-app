// Operator CLI for writer-control transitions (PLATFORM-086H3D).
//
// The ONLY caller of the strict transition authority
// (`src/lib/gameStats/writerControlTransition.ts`). It moves the durable
// `game-stats-writer-control/state` record along the closed rollout graph
//
//   legacy ⇄ armed → active ⇄ read-only-safe
//
// and refuses everything else — same-state requests, unlisted edges, and any
// return to `legacy` after activation. It never creates, repairs, or deletes
// the record (creation is the one-shot initializer's sole job, and that
// initializer remains incapable of transitioning).
//
// Usage:
//   tsx scripts/transition-game-stats-writer-control.ts --from <state> --to <state>            # dry run
//   tsx scripts/transition-game-stats-writer-control.ts --from <state> --to <state> --apply    # atomic transition
//
// The default execution is a READ-ONLY dry run: it validates the current
// record, the expected state, and the requested edge without writing. A dry run
// is NOT a reservation — `--apply` repeats the whole atomic expected-state
// check inside one transaction on the control key. `--apply` runs only against
// a writable PostgreSQL store (never the dev/file fallback or a read-only
// connection).
//
// Exit codes: 0 = confirmed transition / valid dry run;
//             2 = refused (absent/malformed record, expected-state mismatch,
//                 forbidden edge, or invalid arguments — nothing written);
//             3 = store unavailable / not a writable PostgreSQL store
//                 (no durable transition occurred);
//             4 = INDETERMINATE durability — mutation SQL was submitted and the
//                 commit could not be confirmed, so EITHER state may be durable.
//                 REREAD the record (dry run) before any further action; never
//                 retry blindly;
//             1 = unexpected error.

import path from 'node:path';
import { pathToFileURL } from 'node:url';

import dotenv from 'dotenv';

import {
  assertAppStateWritable,
  getAppStateStorageStatus,
} from '../src/lib/server/appStateStore.ts';
import {
  WRITER_CONTROL_KEY,
  WRITER_CONTROL_SCOPE,
  WRITER_CONTROL_STATES,
  type WriterControlState,
} from '../src/lib/gameStats/writerFence.ts';
import {
  transitionWriterControl,
  type WriterControlTransitionOutcome,
} from '../src/lib/gameStats/writerControlTransition.ts';

const TARGET = `${WRITER_CONTROL_SCOPE}/${WRITER_CONTROL_KEY}`;
const USAGE =
  'usage: tsx scripts/transition-game-stats-writer-control.ts --from <state> --to <state> [--apply]\n' +
  `       states: ${WRITER_CONTROL_STATES.join(' | ')}`;

export type TransitionCliArgs = {
  from: WriterControlState;
  to: WriterControlState;
  apply: boolean;
};

/**
 * Strict argument parsing: `--from` and `--to` are REQUIRED and must each name
 * a valid writer-control state; `--apply` is the only flag; anything else is a
 * refusal. There are no defaults — an operator must state both the expected
 * current state and the requested next state explicitly.
 */
export function parseTransitionArgs(
  argv: readonly string[]
): TransitionCliArgs | { error: string } {
  let from: string | null = null;
  let to: string | null = null;
  let apply = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === '--apply') {
      apply = true;
      continue;
    }
    if (arg === '--from' || arg === '--to') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        return { error: `${arg} requires a state argument` };
      }
      if (arg === '--from') from = value;
      else to = value;
      i += 1;
      continue;
    }
    return { error: `unknown argument: ${arg}` };
  }
  if (from === null || to === null) return { error: 'both --from and --to are required' };
  const states: readonly string[] = WRITER_CONTROL_STATES;
  if (!states.includes(from)) return { error: `--from must be one of: ${states.join(', ')}` };
  if (!states.includes(to)) return { error: `--to must be one of: ${states.join(', ')}` };
  return { from: from as WriterControlState, to: to as WriterControlState, apply };
}

/** Map an outcome to a sanitized human line + process exit code. */
export function describeTransitionOutcome(
  outcome: WriterControlTransitionOutcome,
  apply: boolean
): { line: string; code: number } {
  const mode = apply ? '[apply]' : '[dry-run]';
  switch (outcome.kind) {
    case 'transitioned':
      return {
        line: `[apply] ${TARGET} transitioned \`${outcome.from}\` → \`${outcome.to}\` (committed).`,
        code: 0,
      };
    case 'would-transition':
      return {
        line:
          `[dry-run] ${TARGET} is \`${outcome.from}\` — the edge \`${outcome.from}\` → ` +
          `\`${outcome.to}\` is permitted. Nothing was written; --apply repeats the atomic check.`,
        code: 0,
      };
    case 'refused':
      switch (outcome.reason) {
        case 'control-absent':
          return {
            line:
              `${mode} REFUSED: ${TARGET} is absent. This tool never creates the record — ` +
              'initialize it first (npm run init:writer-control) and reread.',
            code: 2,
          };
        case 'control-malformed':
          return {
            line:
              `${mode} REFUSED: ${TARGET} holds a malformed record. This tool never repairs ` +
              'state — investigate manually.',
            code: 2,
          };
        case 'expected-state-mismatch':
          return {
            line:
              `${mode} REFUSED: ${TARGET} is \`${outcome.actual}\`, not the expected ` +
              `\`${outcome.expected}\`. Nothing was written — reread state before acting.`,
            code: 2,
          };
        case 'forbidden-edge':
          return {
            line:
              `${mode} REFUSED: \`${outcome.from}\` → \`${outcome.to}\` is not a permitted ` +
              'transition (allowed: legacy⇄armed, armed→active, active⇄read-only-safe; ' +
              'never back to legacy after activation). Nothing was written.',
            code: 2,
          };
      }
      break;
    case 'store-unavailable':
      return {
        line: `${mode} FAILED: the store is unavailable. No durable transition occurred.`,
        code: 3,
      };
    case 'store-indeterminate':
      return {
        line:
          `[apply] INDETERMINATE: mutation SQL was submitted but the commit could not be ` +
          `confirmed — EITHER state may now be durable at ${TARGET}. REREAD the record ` +
          '(dry run) before any further action; do NOT retry, repair, or assume which state won.',
        code: 4,
      };
  }
  // Exhaustive above; TypeScript needs a terminator for the nested switch.
  return { line: 'unhandled outcome', code: 1 };
}

async function main(): Promise<void> {
  // Load the TARGET environment before inspecting storage, so a `DATABASE_URL` that
  // lives only in `.env.local` selects PostgreSQL (not the dev/file fallback) for both
  // the dry run and `--apply`. `.env.local` wins; `.env` fills any gaps.
  dotenv.config({ path: path.join(process.cwd(), '.env.local') });
  dotenv.config();

  const parsed = parseTransitionArgs(process.argv.slice(2));
  if ('error' in parsed) {
    console.error(`REFUSED: ${parsed.error}\n${USAGE}`);
    process.exit(2);
  }

  const mode = getAppStateStorageStatus().mode;
  // Report the resolved storage mode so the operator can see WHICH store this run
  // inspected (a dry run against `file-fallback` is not inspecting the target DB).
  console.log(`storage mode: ${mode}`);

  if (mode === 'production-misconfigured') {
    console.error('REFUSED: no PostgreSQL store is configured (set DATABASE_URL). Aborting.');
    process.exit(3);
  }

  if (parsed.apply) {
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
    const outcome = await transitionWriterControl({
      expected: parsed.from,
      to: parsed.to,
      apply: parsed.apply,
    });
    const { line, code } = describeTransitionOutcome(outcome, parsed.apply);
    console.log(line);
    process.exit(code);
  } catch (err) {
    // Redacted by default — raw store/driver errors can leak paths, hosts, or SQL into
    // operator/CI logs. Detail is available only through an explicitly enabled channel.
    const detail =
      process.env.TRANSITION_WRITER_CONTROL_DEBUG === '1' && err instanceof Error
        ? `: ${err.message}`
        : '';
    console.error(
      `unexpected error [writer-control-transition-failed] (set TRANSITION_WRITER_CONTROL_DEBUG=1 for detail)${detail}`
    );
    process.exit(1);
  }
}

// Run the CLI only when invoked directly, so tests can import the parsing and
// outcome mapping without triggering the process-exiting wrapper.
const invokedDirectly =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) void main();

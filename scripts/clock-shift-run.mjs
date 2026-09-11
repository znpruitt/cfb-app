/**
 * Run the test suite under a shifted clock — the time-bomb detector (Item 137/#696).
 * See `scripts/clock-shift.mjs` for what the shim does and, importantly, for the
 * one failure expected at every non-zero shift.
 *
 *   npm run test:clock-shift -- 90
 *   npm run test:clock-shift -- 90 src/app/api/odds/__tests__/writer-convergence.test.ts
 *   npm run test:clock-shift -- 0        # the control run; must be fully green
 *
 * The shift travels as `CLOCK_SHIFT_DAYS` and is turned into an `--import` on the
 * CHILD by `run-tests.mjs`. It is deliberately NOT passed through `NODE_OPTIONS`:
 * that would also shift the runner process, whose startup sweep deletes stale
 * test-store directories by mtime — and a shifted runner deletes the LIVE directory
 * of any suite running concurrently in another worktree.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_GLOBS = ['src/**/*.test.ts', 'src/**/*.test.tsx'];
// Beyond this the shifted epoch stops being a representable date and `new Date()`
// starts returning `Invalid Date` throughout the suite — failures that look like
// time bombs but are the harness misconfigured. ~273 years is far past any use.
const MAX_ABS_DAYS = 100_000;

function usage(message) {
  console.error(`clock-shift: ${message}`);
  console.error('usage: npm run test:clock-shift -- <days> [test file or glob ...]');
  console.error('       days is an integer; 0 is the control run and must be fully green');
  process.exit(2);
}

const rawDays = process.argv[2];
const days = Number(rawDays);
if (rawDays === undefined) usage('a day count is required');
if (!Number.isInteger(days)) usage(`day count must be an integer; received ${rawDays}`);
if (Math.abs(days) > MAX_ABS_DAYS) usage(`day count must be within ±${MAX_ABS_DAYS}`);

const here = path.dirname(fileURLToPath(import.meta.url));
const targets = process.argv.slice(3);
const testArguments = targets.length > 0 ? targets : DEFAULT_GLOBS;

const target = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
console.error(
  `[clock-shift] running ${targets.length > 0 ? targets.join(' ') : 'the full suite'} ` +
    `as if it were ${target} (${days >= 0 ? '+' : ''}${days}d)`
);
if (days !== 0) {
  console.error(
    '[clock-shift] expected floor: 1 failure in src/test/__tests__/testStoreLifecycle.test.ts ' +
      '(it sweeps real filesystem mtimes against a shifted now, and pins no calendar date). ' +
      'ANY OTHER failure is a real expiry.'
  );
}

const result = spawnSync(process.execPath, [path.join(here, 'run-tests.mjs'), ...testArguments], {
  stdio: 'inherit',
  env: {
    ...process.env,
    CLOCK_SHIFT_DAYS: String(days),
    // One-shot: `run-tests.mjs` consumes this to decide whether to add the shim as an
    // argument, and does not forward it. See the comment at that spawn site.
    CLOCK_SHIFT_INJECT: '1',
  },
});

process.exit(result.status ?? 1);

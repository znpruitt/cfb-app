/**
 * Run the full test suite under a shifted clock — the time-bomb detector
 * (Item 137/#696). See `scripts/clock-shift.mjs` for what the shim does and,
 * importantly, for the one expected failure at every non-zero shift.
 *
 *   npm run test:clock-shift -- 90
 *
 * The shift is applied via `NODE_OPTIONS`, not by preloading here: `run-tests.mjs`
 * spawns a CHILD node process to run the suite, and that child is the process
 * whose clock has to move. Preloading in this wrapper would shift a process that
 * runs no tests.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const days = Number(process.argv[2]);
if (!Number.isFinite(days)) {
  console.error('usage: npm run test:clock-shift -- <days>   (e.g. 90, or 0 for the control run)');
  process.exit(2);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const shim = path.join(here, 'clock-shift.mjs');
const target = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

console.error(`[clock-shift] running the full suite as if it were ${target} (+${days}d)`);
if (days !== 0) {
  console.error(
    '[clock-shift] expected floor: 1 failure in src/test/__tests__/testStoreLifecycle.test.ts ' +
      '(real mtimes vs a shifted now — not a time bomb). ANY OTHER failure is a real expiry.'
  );
}

const result = spawnSync(
  process.execPath,
  [path.join(here, 'run-tests.mjs'), 'src/**/*.test.ts', 'src/**/*.test.tsx'],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      CLOCK_SHIFT_DAYS: String(days),
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import ${shim}`.trim(),
    },
  }
);

process.exit(result.status ?? 1);

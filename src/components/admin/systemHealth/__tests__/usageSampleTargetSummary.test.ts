import assert from 'node:assert/strict';
import test from 'node:test';

import { summarizeReceiptTarget } from '../systemHealthPresentation';

/**
 * Both reviewers independently found that an `indeterminate` write still rendered
 * "not recorded" on the System Health row — the exact claim the write path refuses
 * to make. Carrying a tri-state through the receipt is only worth anything if the
 * reader shows the third state.
 */
test('a usage-sample target renders all THREE durability states distinctly', () => {
  const summarize = (recorded: boolean | null): string =>
    summarizeReceiptTarget({ kind: 'usage-sample', day: '2026-09-04', recorded } as never);

  assert.equal(summarize(true), '2026-09-04 · recorded');
  assert.equal(summarize(false), '2026-09-04 · not recorded');
  assert.equal(
    summarize(null),
    '2026-09-04 · durability unknown',
    'unknown must not render as either certainty'
  );
  // The three renderings must be mutually distinct, or the tri-state collapses in
  // the only place a human reads it.
  assert.equal(new Set([summarize(true), summarize(false), summarize(null)]).size, 3);
});

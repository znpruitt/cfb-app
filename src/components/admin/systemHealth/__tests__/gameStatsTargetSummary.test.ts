import assert from 'node:assert/strict';
import test from 'node:test';

import { summarizeReceiptTarget } from '../systemHealthPresentation';

/**
 * PLATFORM-110B — the receipt carries `mode` so an operator can tell a bounded
 * CORRECTION pass over a long-settled partition from a polling run that
 * regressed to a stale one. Review found the field stored but never rendered:
 * the justification lived in a docblock while the display was unchanged, so the
 * distinction it exists for never reached anyone.
 */
const gameStats = (mode?: 'poll' | 'reconcile' | null): string =>
  summarizeReceiptTarget({
    kind: 'game-stats',
    year: 2026,
    week: 1,
    seasonType: 'regular',
    ...(mode === undefined ? {} : { mode }),
  } as never);

test('a reconciliation target is DISTINGUISHABLE from a polling target', () => {
  const reconcile = gameStats('reconcile');
  const poll = gameStats('poll');
  assert.equal(reconcile, '2026 · week 1 · regular · reconcile');
  assert.equal(poll, '2026 · week 1 · regular · poll');
  assert.notEqual(
    reconcile,
    poll,
    'in week 10 both render week 1; only the mode separates a correction from a regression'
  );
});

test('a receipt written before the field still renders, with no trailing separator', () => {
  // Legacy receipts carry no mode, and the rebuild normalizes it to null.
  assert.equal(gameStats(undefined), '2026 · week 1 · regular');
  assert.equal(gameStats(null), '2026 · week 1 · regular');
});

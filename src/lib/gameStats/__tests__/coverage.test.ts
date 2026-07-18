import assert from 'node:assert/strict';
import test from 'node:test';

import { expectsGameStats } from '../coverage.ts';

// PLATFORM-086H3: the content-based "usable row" helpers were retired with
// the shared committed-state coverage model (`partitionCoverage.ts`, covered
// in partitionCoverage.test.ts) — no consumer keeps a parallel usability
// interpretation. This module retains only the shared stat-producing-status
// predicate.

// 5th-review finding #1 — disrupted games do not produce stats.
test('expectsGameStats excludes disrupted statuses, includes normal ones', () => {
  for (const status of ['Canceled', 'cancelled', 'Postponed', 'Suspended', 'Delayed']) {
    assert.equal(expectsGameStats(status), false, status);
  }
  for (const status of ['STATUS_FINAL', 'final', 'in progress', 'scheduled', '']) {
    assert.equal(expectsGameStats(status), true, status);
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  dischargePendingStandingsInvalidation,
  recordPendingStandingsInvalidation,
} from '../../server/standingsInvalidationPending.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  getAppState,
} from '../../server/appStateStore.ts';
import { STANDINGS_INVALIDATION_PENDING_SCOPE } from '../../server/standingsInvalidationPending.ts';

/**
 * PLATFORM-693 TRIGGER B — the discharge the MANUAL repair path reaches.
 *
 * `refreshFullSeasonSchedule` calls this immediately before its content decision, and
 * that placement is the fix: the System Health repair link drives
 * `/api/schedule?bypassCache=1&year=Y`, a failed bust leaves content unchanged, so the
 * refresh took the `unchanged-clean` sentinel and reported success over a standing
 * fault. The cron's drain cannot cover that path; this cannot cover a zero-target run.
 * Two triggers, two reachability gaps.
 */

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

test('the repair path discharges a pending year even when nothing changed', async () => {
  // The exact repair scenario: year pending, content unchanged, no score repair. Before
  // the discharge moved ahead of the content decision, this cleared nothing.
  await recordPendingStandingsInvalidation(2026);

  const walked: number[] = [];
  const result = await dischargePendingStandingsInvalidation(2026, async (year) => {
    walked.push(year);
    return { result: 'complete' };
  });

  assert.deepEqual(walked, [2026], 'the unchanged path must still re-walk a pending year');
  assert.equal(result.cleared, true);
  const row = await getAppState(STANDINGS_INVALIDATION_PENDING_SCOPE, String(2026));
  assert.equal(row?.value ?? null, null);
});

test('a healthy year costs no registry walk on an unchanged refresh', async () => {
  // The discharge runs on EVERY full-season refresh, so it must be free when there is
  // nothing to repair — otherwise the fix taxes every ordinary cron year.
  let calls = 0;
  await dischargePendingStandingsInvalidation(2026, async () => {
    calls += 1;
    return { result: 'complete' };
  });
  assert.equal(calls, 0);
});

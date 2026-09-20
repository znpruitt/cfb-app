import test from 'node:test';
import assert from 'node:assert/strict';

import * as scheduleSeasonFetch from '../scheduleSeasonFetch.ts';
import type { ScheduleSeasonType } from '../scheduleSeasonFetch.ts';

/**
 * PLATFORM-833. This module used to hold the shared schedule empty-response
 * policy; PLATFORM-663 made the full-season authority the only committing schedule
 * path and enforce that policy itself, leaving `classifyEmptyScheduleRefresh` and
 * `hasRequiredSeasonTypeFailure` with zero production callers while the module
 * docstring still claimed they prevented drift.
 *
 * The tests that exercised those two functions went with them — keeping them would
 * have meant a suite asserting the behaviour of code nothing calls, which is how a
 * dead module looks alive. What replaces them is a pin on the module's SHAPE, so
 * neither function can come back without this failing.
 */

test('the module exports the season-type vocabulary and nothing at runtime', () => {
  // A type-only module has no runtime exports. This is the assertion that fails if
  // either removed function is reintroduced, or if any other value export is added
  // here rather than to the authority that now owns the policy.
  assert.deepEqual(
    Object.keys(scheduleSeasonFetch),
    [],
    'scheduleSeasonFetch.ts must export types only — the empty-response policy lives in fullSeasonScheduleRefresh'
  );
});

test('neither removed policy function is exported', () => {
  // Named explicitly, so a reader of a future failure sees WHICH symbol returned
  // rather than only that the key set changed.
  for (const removed of ['classifyEmptyScheduleRefresh', 'hasRequiredSeasonTypeFailure']) {
    assert.equal(
      removed in scheduleSeasonFetch,
      false,
      `${removed} was deleted by PLATFORM-833 — the full-season refresh authority owns this policy now`
    );
  }
});

test('ScheduleSeasonType still admits exactly the two canonical partitions', () => {
  // The type is why the module survives at all (live consumers:
  // api/cron/season-transition and lifecycleCronExecutionLog). Relocating it is #837.
  const regular: ScheduleSeasonType = 'regular';
  const postseason: ScheduleSeasonType = 'postseason';
  assert.deepEqual([regular, postseason], ['regular', 'postseason']);
});

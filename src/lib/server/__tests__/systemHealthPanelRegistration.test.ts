import assert from 'node:assert/strict';
import test from 'node:test';

import { panelOwnerForCode, type SystemHealthPanelOwner } from '../systemHealthPanels.ts';
import type { SystemHealthIssueCode } from '../systemHealthIssues.ts';

/**
 * PLATFORM-693 round 2 — EVERY issue code is claimed by exactly one panel, on purpose.
 *
 * THE DEFECT THIS CLOSES IS A CLASS, NOT AN INSTANCE. `providerDataPanel`'s predicate is
 * RESIDUAL: anything the scheduler, automation, quota, storage and untiled sets do not
 * claim falls to Provider data. So a new issue code lands on the provider tile with no
 * error and no failing test — the dashboard simply starts naming the provider as
 * degraded for a fault that has nothing to do with provider data, breaking the axis
 * separation the F2G tiles exist to keep.
 *
 * **It has happened twice.** `lifecycle-data-unusable` reached the provider tile that
 * way in PLATFORM-086F2H3B2, and `standings-invalidation-pending` did it again here.
 * Registering the second one closes the instance; this file closes the class.
 *
 * HOW IT IS ENFORCED, AND THE ENFORCEMENT IS THE TYPE, NOT THE ASSERTIONS. `OWNERSHIP`
 * below is a `Record<SystemHealthIssueCode, SystemHealthPanelOwner>`. TypeScript requires
 * an object literal of that type to carry EVERY member of the union — so adding a code to
 * `SystemHealthIssueCode` and not to this record fails `npx tsc --noEmit`, and a key that
 * is not a real code fails it too. The decision about which tile owns a fault is forced at
 * compile time, in a file whose whole subject is that decision.
 *
 * That the type gate is real was established by positive control, not assumed: a
 * deliberate type error placed in a `__tests__` file was reported by `tsc --noEmit`, so
 * test files are inside the type-check gate.
 *
 * The runtime assertions then check the SHIPPING predicate agrees with the record.
 * `panelOwnerForCode` is the function `providerDataPanel` itself calls — not a second
 * copy of the rule, which would pass while the panel did something else.
 */

const OWNERSHIP: Record<SystemHealthIssueCode, SystemHealthPanelOwner> = {
  // -- Scheduler delivery ------------------------------------------------------
  'scheduler-delivery-missing': 'scheduler',
  'scheduler-delivery-late': 'scheduler',
  'scheduler-receipt-invalid': 'scheduler',
  'scheduler-delivery-unavailable': 'scheduler',
  'scheduler-execution-failed': 'scheduler',
  'scheduler-execution-partial': 'scheduler',
  // The round-2 registration. A job-execution fact about `schedule-refresh`, which is
  // a subject the scheduler tile already owns.
  'standings-invalidation-pending': 'scheduler',

  // -- Automation gates --------------------------------------------------------
  'automation-global-pause-active': 'automation',
  'automation-dataset-disabled': 'automation',
  'automation-settings-unavailable': 'automation',

  // -- Quota -------------------------------------------------------------------
  'cfbd-quota-unavailable': 'quota',
  'cfbd-quota-untrustworthy': 'quota',
  'cfbd-automation-reserve-reached': 'quota',
  'odds-quota-snapshot-absent': 'quota',
  'odds-quota-unavailable': 'quota',
  'odds-automation-reserve-reached': 'quota',

  // -- Storage -----------------------------------------------------------------
  'storage-production-misconfigured': 'storage',

  // -- Owned by no tile, folded into Overall (PLATFORM-086F2H3B2) ---------------
  'lifecycle-data-unusable': 'untiled',

  // -- Provider data: the subsystem-level code ---------------------------------
  'data-diagnostics-unavailable': 'provider',

  // -- Provider data: refresh-attempt outcomes ---------------------------------
  // OMITTED WHEN THIS FILE WAS FIRST WRITTEN, and `tsc --noEmit` named all five. That
  // is this record's guarantee demonstrating itself on its first use, which is better
  // evidence that the gate works than any assertion below.
  'provider-refresh-failed': 'provider',
  'provider-refresh-partial': 'provider',
  'provider-refresh-interrupted': 'provider',
  'provider-status-invalid': 'provider',
  'provider-status-unavailable': 'provider',

  // -- Provider data: the per-branch diagnostics -------------------------------
  // These are the codes the residual fallback is FOR. They are listed explicitly so
  // that "provider" is a recorded decision here rather than an accident of omission.
  'schedule-cache-missing': 'provider',
  'schedule-refresh-partial': 'provider',
  'schedule-cache-stale': 'provider',
  'schedule-diagnostics-unavailable': 'provider',
  'scores-terminal-coverage-missing': 'provider',
  'scores-terminal-coverage-partial': 'provider',
  'scores-elapsed-time-conclusions': 'provider',
  'scores-diagnostics-unavailable': 'provider',
  'game-stats-context-unavailable': 'provider',
  'game-stats-latest-slate-missing': 'provider',
  'game-stats-older-slate-missing': 'provider',
  'game-stats-evidence-partial': 'provider',
  'game-stats-duplicate-conflict': 'provider',
  'game-stats-identity-mismatch': 'provider',
  'game-stats-participant-validation-unavailable': 'provider',
  'game-stats-record-unservable': 'provider',
  'game-stats-diagnostics-unavailable': 'provider',
  'rankings-cache-missing': 'provider',
  'rankings-cache-stale': 'provider',
  'rankings-diagnostics-unavailable': 'provider',
  'records-cache-stale': 'provider',
  'records-diagnostics-unavailable': 'provider',
  'odds-cache-missing': 'provider',
  'odds-cache-stale': 'provider',
  'odds-diagnostics-unavailable': 'provider',
};

test('every issue code is owned by the tile this file records', () => {
  for (const [code, owner] of Object.entries(OWNERSHIP) as Array<
    [SystemHealthIssueCode, SystemHealthPanelOwner]
  >) {
    assert.equal(
      panelOwnerForCode(code),
      owner,
      `${code} is filed under ${panelOwnerForCode(code)}, but this file records ${owner}`
    );
  }
});

test('the pending-standings code is owned by the SCHEDULER tile, not Provider data', () => {
  // The round-2 regression, stated as its own case so a mutation says which thing broke.
  // Before the registration this returned 'provider' — a cache-invalidation fault
  // rendering as provider degradation.
  assert.equal(panelOwnerForCode('standings-invalidation-pending'), 'scheduler');
});

test('the residual fallback still exists, and an UNREGISTERED code proves it', () => {
  // POSITIVE CONTROL for the whole file. Without it, a `panelOwnerForCode` that returned
  // 'scheduler' for everything would satisfy the test above for the scheduler codes and
  // the record would look enforced when it was not. This is also the direct evidence for
  // the hazard the docblocks describe: an unclaimed code IS silently a provider code.
  assert.equal(
    panelOwnerForCode('a-code-no-set-claims'),
    'provider',
    'the fallback is residual — this is why the exhaustive record above is the guarantee'
  );
});

test('the recorded owners are only the six the panels understand', () => {
  // Guards against a typo'd owner string passing the record via a widened type later.
  const valid: SystemHealthPanelOwner[] = [
    'scheduler',
    'automation',
    'quota',
    'storage',
    'untiled',
    'provider',
  ];
  for (const owner of Object.values(OWNERSHIP)) {
    assert.ok(valid.includes(owner), `unknown panel owner recorded: ${owner}`);
  }
});

/**
 * PLATFORM-086F2F — pure issue-derivation tests. Every input is injected via the
 * shared fixtures (no I/O, no clock), so each case exercises exactly one fact
 * domain and the deterministic aggregation.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deriveSystemHealthIssues,
  summarizeSystemHealthIssues,
  type SystemHealthIssue,
  formatLateness,
} from '../systemHealthIssues.ts';
import { INTERRUPTED_ATTEMPT_AFTER_MS } from '../../providerRefreshConstants.ts';
import {
  baseInputs,
  canonicalOutcome,
  canonicalScopeFor,
  deliveryRow,
  deliverySnapshot,
  healthyDelivery,
  NOW,
  receiptFor,
  receiptWithRefusals,
  refreshSnapshot,
  safeStatus,
  unavailableDelivery,
  YEAR,
  assertRowIsClassifiable,
} from './systemHealthFixtures.ts';
import { EXTERNAL_SCHEDULER_JOBS } from '../schedulerExecutionStatus.ts';
import { oddsTargetScope, weekPartitionScope } from '../../providerRefreshScope.ts';

function codes(issues: SystemHealthIssue[]): string[] {
  return issues.map((i) => i.code);
}
function find(issues: SystemHealthIssue[], code: string): SystemHealthIssue | undefined {
  return issues.find((i) => i.code === code);
}

test('healthy baseline → no issues, overall healthy', () => {
  const issues = deriveSystemHealthIssues(baseInputs());
  assert.deepEqual(issues, []);
  const summary = summarizeSystemHealthIssues(issues);
  assert.equal(summary.overallState, 'healthy');
  assert.deepEqual(summary.issueCounts, { critical: 0, warning: 0, info: 0 });
});

// Case 3 — timely skipped receipt → on-time delivery, no execution fault.
test('timely skipped receipt raises no delivery or execution issue', () => {
  const rows = EXTERNAL_SCHEDULER_JOBS.map((job) =>
    deliveryRow(job, 'on-time', receiptFor(job, 'skipped'))
  );
  const issues = deriveSystemHealthIssues(
    baseInputs({ schedulerDelivery: deliverySnapshot(rows) })
  );
  assert.deepEqual(issues, []);
});

// Case 4 — timely failed receipt → on-time delivery + execution-failed issue.
test('timely failed receipt → execution-failed issue, no delivery issue', () => {
  const rows = healthyDelivery().jobs.map((row) =>
    row.job === 'live-scores'
      ? deliveryRow('live-scores', 'on-time', receiptFor('live-scores', 'failure'))
      : row
  );
  const issues = deriveSystemHealthIssues(
    baseInputs({ schedulerDelivery: deliverySnapshot(rows) })
  );
  assert.ok(!find(issues, 'scheduler-delivery-missing'));
  assert.ok(!find(issues, 'scheduler-delivery-late'));
  const failed = find(issues, 'scheduler-execution-failed');
  assert.ok(failed);
  assert.equal(failed!.subject.id, 'live-scores');
  assert.equal(failed!.repair?.surface, 'data-maintenance'); // provider job
});

// Case 5 — late successful receipt → delivery-late, no execution-failed.
test('late successful receipt → delivery-late issue, no execution fault', () => {
  const rows = healthyDelivery().jobs.map((row) =>
    row.job === 'odds' ? deliveryRow('odds', 'late', receiptFor('odds', 'success')) : row
  );
  const issues = deriveSystemHealthIssues(
    baseInputs({ schedulerDelivery: deliverySnapshot(rows) })
  );
  const late = find(issues, 'scheduler-delivery-late');
  assert.ok(late);
  assert.equal(late!.subject.id, 'odds');
  assert.equal(late!.repair, null);
  assert.ok(!find(issues, 'scheduler-execution-failed'));
});

// PLATFORM-086F2H4 — a lifecycle execution failure routes NOWHERE. It used to
// link Season Management, a page that could not repair a lifecycle fault and has
// since been retired.
test('a lifecycle execution failure offers no repair; a provider one still does', () => {
  const rows = healthyDelivery().jobs.map((row) =>
    row.job === 'season-rollover'
      ? deliveryRow('season-rollover', 'on-time', receiptFor('season-rollover', 'failure'))
      : row
  );
  const issues = deriveSystemHealthIssues(
    baseInputs({ schedulerDelivery: deliverySnapshot(rows) })
  );
  const failed = find(issues, 'scheduler-execution-failed');
  // PLATFORM-086F2H4 — a LIFECYCLE job's execution fault offers NO repair. It
  // used to link Season Management, a page that could not repair a lifecycle
  // fault and has since been retired.
  assert.equal(failed!.repair, null);

  // POSITIVE CONTROL — a NON-lifecycle job on the same shape still receives the
  // Data Maintenance repair, so the null above is routing and not repairs having
  // stopped working.
  const providerRows = healthyDelivery().jobs.map((row) =>
    row.job === 'odds' ? deliveryRow('odds', 'on-time', receiptFor('odds', 'failure')) : row
  );
  const providerIssues = deriveSystemHealthIssues(
    baseInputs({ schedulerDelivery: deliverySnapshot(providerRows) })
  );
  const providerFailed = find(providerIssues, 'scheduler-execution-failed');
  assert.equal(providerFailed!.repair?.surface, 'data-maintenance');
  assert.equal(providerFailed!.repair?.href, '/admin/data/cache');
});

// Case 6 — a closed provider gate never demotes a missing delivery.
test('closed provider gate does not hide missing scheduler delivery', () => {
  const rows = healthyDelivery().jobs.map((row) =>
    row.job === 'game-stats' ? deliveryRow('game-stats', 'missing', null) : row
  );
  const paused = baseInputs({
    schedulerDelivery: deliverySnapshot(rows),
    automation: {
      state: 'available',
      globalPause: true,
      datasets: {
        scores: { enabled: false },
        schedule: { enabled: false },
        odds: { enabled: false },
        rankings: { enabled: false },
        conferences: { enabled: false },
        'game-stats': { enabled: false },
      },
    },
  });
  const issues = deriveSystemHealthIssues(paused);
  const missing = find(issues, 'scheduler-delivery-missing');
  assert.ok(missing, 'missing delivery is still reported while gates are off');
  assert.equal(missing!.severity, 'warning');
  // The informational gate issues must not push overall past degraded-from-delivery.
  const summary = summarizeSystemHealthIssues(issues);
  assert.equal(summary.overallState, 'degraded');
});

// Case 7 — a scheduler scope-read failure → ONE global unavailable issue.
test('all-unavailable scheduler rows produce one global delivery-unavailable issue', () => {
  const issues = deriveSystemHealthIssues(baseInputs({ schedulerDelivery: unavailableDelivery() }));
  const unavailable = issues.filter((i) => i.code === 'scheduler-delivery-unavailable');
  assert.equal(unavailable.length, 1);
  assert.equal(unavailable[0].subject.axis, 'global');
  assert.equal(unavailable[0].repair, null);
});

// Case 13 — failed attempt + available cache → warning.
test('failed provider attempt with available cache → warning', () => {
  const inputs = baseInputs({
    providerRefresh: refreshSnapshot({
      scores: { canonical: canonicalOutcome('scores', 'failed') },
    }),
    cacheStates: baseInputs().cacheStates, // all available
  });
  const issues = deriveSystemHealthIssues(inputs);
  const failed = find(issues, 'provider-refresh-failed');
  assert.ok(failed);
  assert.equal(failed!.severity, 'warning');
  assert.equal(failed!.subject.id, 'scores');
  assert.equal(failed!.repair?.surface, 'data-maintenance');
});

// Case 14 — failed attempt + absent cache → critical.
test('failed provider attempt with absent cache → critical', () => {
  const cacheStates = baseInputs().cacheStates;
  cacheStates.scores = 'absent';
  const inputs = baseInputs({
    providerRefresh: refreshSnapshot({
      scores: { canonical: canonicalOutcome('scores', 'failed') },
    }),
    cacheStates,
  });
  const issues = deriveSystemHealthIssues(inputs);
  const failed = find(issues, 'provider-refresh-failed');
  assert.equal(failed!.severity, 'critical');
  assert.equal(summarizeSystemHealthIssues(issues).overallState, 'critical');
});

// Case 15 — in-progress attempt crosses the ten-minute interrupted threshold.
test('in-progress attempt at/after the interrupted threshold is interrupted (strict boundary)', () => {
  const dataset = 'odds' as const;
  const scope = canonicalScopeFor(dataset);
  const atThreshold = new Date(NOW - INTERRUPTED_ATTEMPT_AFTER_MS).toISOString();
  const pastThreshold = new Date(NOW - INTERRUPTED_ATTEMPT_AFTER_MS - 1).toISOString();

  const atIssues = deriveSystemHealthIssues(
    baseInputs({
      providerRefresh: refreshSnapshot({
        [dataset]: {
          canonical: {
            state: 'available',
            status: safeStatus(dataset, scope, {
              latestAttemptOutcome: 'in-progress',
              lastAttemptAt: atThreshold,
            }),
          },
        },
      }),
    })
  );
  assert.ok(
    !find(atIssues, 'provider-refresh-interrupted'),
    'exactly at threshold is not yet interrupted'
  );

  const pastIssues = deriveSystemHealthIssues(
    baseInputs({
      providerRefresh: refreshSnapshot({
        [dataset]: {
          canonical: {
            state: 'available',
            status: safeStatus(dataset, scope, {
              latestAttemptOutcome: 'in-progress',
              lastAttemptAt: pastThreshold,
            }),
          },
        },
      }),
    })
  );
  const interrupted = find(pastIssues, 'provider-refresh-interrupted');
  assert.ok(interrupted, 'just past the threshold is interrupted');
  assert.equal(interrupted!.subject.id, 'odds');
});

// A recent in-progress attempt is not an issue.
test('a recent in-progress attempt raises no issue', () => {
  const dataset = 'odds' as const;
  const scope = canonicalScopeFor(dataset);
  const issues = deriveSystemHealthIssues(
    baseInputs({
      providerRefresh: refreshSnapshot({
        [dataset]: {
          canonical: {
            state: 'available',
            status: safeStatus(dataset, scope, {
              latestAttemptOutcome: 'in-progress',
              lastAttemptAt: new Date(NOW - 60_000).toISOString(),
            }),
          },
        },
      }),
    })
  );
  assert.deepEqual(issues, []);
});

// r3 Finding 1 — a legacy pre-outcome record's failure/partial is still surfaced.
test('a legacy null-outcome record with lastError → failed issue (not silent-healthy)', () => {
  const dataset = 'scores' as const;
  const scope = canonicalScopeFor(dataset);
  const issues = deriveSystemHealthIssues(
    baseInputs({
      providerRefresh: refreshSnapshot({
        [dataset]: {
          canonical: {
            state: 'available',
            status: safeStatus(dataset, scope, { latestAttemptOutcome: null, hasError: true }),
          },
        },
      }),
    })
  );
  const failed = find(issues, 'provider-refresh-failed');
  assert.ok(failed, 'legacy error record surfaces a failed issue');
  assert.equal(failed!.subject.id, 'scores');
});

test('a legacy null-outcome record with partialFailure → partial issue', () => {
  const dataset = 'schedule' as const;
  const scope = canonicalScopeFor(dataset);
  const issues = deriveSystemHealthIssues(
    baseInputs({
      providerRefresh: refreshSnapshot({
        [dataset]: {
          canonical: {
            state: 'available',
            status: safeStatus(dataset, scope, {
              latestAttemptOutcome: null,
              hasError: false,
              partialFailure: true,
            }),
          },
        },
      }),
    })
  );
  assert.ok(find(issues, 'provider-refresh-partial'));
});

test('a legacy null-outcome record with no error/partial → no issue', () => {
  const dataset = 'scores' as const;
  const scope = canonicalScopeFor(dataset);
  const issues = deriveSystemHealthIssues(
    baseInputs({
      providerRefresh: refreshSnapshot({
        [dataset]: {
          canonical: {
            state: 'available',
            status: safeStatus(dataset, scope, { latestAttemptOutcome: null }),
          },
        },
      }),
    })
  );
  assert.deepEqual(issues, []);
});

// Case 16 — no refresh history alone produces no issue.
test('absent refresh history produces no provider issue', () => {
  // baseInputs already has all-absent canonical + latest; succeeded/no-op likewise silent.
  const issues = deriveSystemHealthIssues(
    baseInputs({
      providerRefresh: refreshSnapshot({
        scores: { canonical: canonicalOutcome('scores', 'succeeded') },
        odds: { canonical: canonicalOutcome('odds', 'no-op') },
      }),
    })
  );
  assert.deepEqual(issues, []);
});

// Provider-status subsystem unavailable → one global issue.
test('provider-status subsystem unavailable → one global provider-status-unavailable', () => {
  const issues = deriveSystemHealthIssues(
    baseInputs({ providerRefresh: { subsystem: 'unavailable', rows: refreshSnapshot().rows } })
  );
  const unavailable = issues.filter((i) => i.code === 'provider-status-unavailable');
  assert.equal(unavailable.length, 1);
  assert.equal(unavailable[0].subject.axis, 'global');
});

// A malformed canonical status → per-dataset provider-status-invalid.
test('malformed canonical status → provider-status-invalid for that dataset only', () => {
  const issues = deriveSystemHealthIssues(
    baseInputs({
      providerRefresh: refreshSnapshot({ rankings: { canonical: { state: 'invalid' } } }),
    })
  );
  const invalid = issues.filter((i) => i.code === 'provider-status-invalid');
  assert.equal(invalid.length, 1);
  assert.equal(invalid[0].subject.id, 'rankings');
  assert.equal(invalid[0].repair, null);
});

// Canonical succeeded + a DIFFERENT-scope failed latest activity → one dataset fault.
test('a failed latest scoped activity is surfaced even when canonical succeeded', () => {
  const dataset = 'scores' as const;
  const weekScope = weekPartitionScope(YEAR, 3, 'regular');
  const issues = deriveSystemHealthIssues(
    baseInputs({
      providerRefresh: refreshSnapshot({
        [dataset]: {
          canonical: canonicalOutcome(dataset, 'succeeded'),
          latest: {
            state: 'available',
            status: safeStatus(dataset, weekScope, {
              latestAttemptOutcome: 'failed',
              lastAttemptAt: new Date(NOW - 60_000).toISOString(),
            }),
          },
        },
      }),
    })
  );
  const failed = issues.filter((i) => i.code === 'provider-refresh-failed');
  assert.equal(failed.length, 1);
  assert.equal(failed[0].subject.id, 'scores');
  // The failed activity is a NONCANONICAL week partition, so the canonical cache
  // signal does not apply → warning (never critical) regardless of canonical cache.
  assert.equal(failed[0].severity, 'warning');
});

// Finding 1 — a noncanonical failed activity is never made critical by an absent
// CANONICAL cache (the cache probe describes the canonical target only).
test('a failed noncanonical activity stays warning even when the canonical cache is absent', () => {
  const dataset = 'odds' as const;
  const filteredScope = oddsTargetScope(YEAR, 'filtered', 'k');
  const cacheStates = baseInputs().cacheStates;
  cacheStates.odds = 'absent'; // canonical odds cache absent
  const issues = deriveSystemHealthIssues(
    baseInputs({
      cacheStates,
      providerRefresh: refreshSnapshot({
        [dataset]: {
          latest: {
            state: 'available',
            status: safeStatus(dataset, filteredScope, {
              latestAttemptOutcome: 'failed',
              lastAttemptAt: new Date(NOW - 60_000).toISOString(),
            }),
          },
        },
      }),
    })
  );
  const failed = find(issues, 'provider-refresh-failed');
  assert.ok(failed);
  assert.equal(failed!.severity, 'warning', 'noncanonical cache is unknown, not absent');
});

// Finding 3 — a failed diagnostics subsystem is surfaced as a global warning.
test('diagnostics subsystem unavailable → global data-diagnostics-unavailable warning (degrades)', () => {
  const issues = deriveSystemHealthIssues(baseInputs({ diagnostics: { state: 'unavailable' } }));
  const diag = find(issues, 'data-diagnostics-unavailable');
  assert.ok(diag);
  assert.equal(diag!.severity, 'warning');
  assert.equal(diag!.subject.axis, 'global');
  assert.equal(diag!.repair, null);
  assert.equal(summarizeSystemHealthIssues(issues).overallState, 'degraded');
});

// Finding 4 — a dataset whose toggle no active job consumes never claims a disabled effect.
test('a disabled dataset whose toggle no job consumes (conferences) emits no issue', () => {
  const automation = {
    state: 'available' as const,
    globalPause: false,
    datasets: {
      scores: { enabled: true },
      schedule: { enabled: true },
      odds: { enabled: true },
      rankings: { enabled: true },
      conferences: { enabled: false }, // no job consumes this toggle
      'game-stats': { enabled: true },
    },
  };
  const issues = deriveSystemHealthIssues(baseInputs({ automation }));
  assert.ok(!issues.some((i) => i.code === 'automation-dataset-disabled'));
});

// Finding 4 — a lifecycle-critical dataset (schedule) qualifies its disabled wording.
test('a disabled lifecycle-critical dataset (schedule) qualifies that exempt ops remain', () => {
  const automation = {
    state: 'available' as const,
    globalPause: false,
    datasets: {
      scores: { enabled: true },
      schedule: { enabled: false },
      odds: { enabled: true },
      rankings: { enabled: true },
      conferences: { enabled: true },
      'game-stats': { enabled: true },
    },
  };
  const issues = deriveSystemHealthIssues(baseInputs({ automation }));
  const disabled = find(issues, 'automation-dataset-disabled');
  assert.ok(disabled);
  assert.equal(disabled!.subject.id, 'schedule');
  assert.match(disabled!.explanation, /lifecycle-critical operations remain exempt/);
});

// Case 18 (routing) — identity mismatch → Team Identity; duplicate/conflict → Data Maintenance.
test('game-stat identity mismatch routes to Team Identity; duplicate-conflict to Data Maintenance', () => {
  const issues = deriveSystemHealthIssues(
    baseInputs({
      diagnostics: {
        state: 'available',
        diagnostics: [
          {
            dataset: 'game-stats',
            code: 'game-stats-identity-mismatch',
            severity: 'warning',
            repair: 'team-identity',
          },
          {
            dataset: 'game-stats',
            code: 'game-stats-duplicate-conflict',
            severity: 'warning',
            repair: 'data-maintenance',
          },
        ],
      },
    })
  );
  const mismatch = find(issues, 'game-stats-identity-mismatch');
  const duplicate = find(issues, 'game-stats-duplicate-conflict');
  assert.equal(mismatch!.repair?.surface, 'team-identity');
  assert.equal(mismatch!.repair?.href, '/admin/aliases');
  assert.equal(duplicate!.repair?.surface, 'data-maintenance');
  assert.equal(duplicate!.repair?.href, '/admin/data/cache');
});

// Canonical data diagnostic severity mapping (error→critical, warning→warning, info→info).
test('diagnostic severity maps error→critical, warning→warning, info→info', () => {
  const issues = deriveSystemHealthIssues(
    baseInputs({
      diagnostics: {
        state: 'available',
        diagnostics: [
          {
            dataset: 'schedule',
            code: 'schedule-cache-missing',
            severity: 'error',
            repair: 'data-maintenance',
          },
          {
            dataset: 'odds',
            code: 'odds-cache-stale',
            severity: 'warning',
            repair: 'data-maintenance',
          },
          {
            dataset: 'rankings',
            code: 'rankings-cache-missing',
            severity: 'info',
            repair: 'data-maintenance',
          },
        ],
      },
    })
  );
  assert.equal(find(issues, 'schedule-cache-missing')!.severity, 'critical');
  assert.equal(find(issues, 'odds-cache-stale')!.severity, 'warning');
  assert.equal(find(issues, 'rankings-cache-missing')!.severity, 'info');
  assert.equal(summarizeSystemHealthIssues(issues).overallState, 'critical');
});

// A diagnostic whose repair surface is null (e.g. an unavailable read) has null repair.
test('an unavailable-read diagnostic carries a null repair', () => {
  const issues = deriveSystemHealthIssues(
    baseInputs({
      diagnostics: {
        state: 'available',
        diagnostics: [
          {
            dataset: 'schedule',
            code: 'schedule-diagnostics-unavailable',
            severity: 'warning',
            repair: null,
          },
        ],
      },
    })
  );
  assert.equal(find(issues, 'schedule-diagnostics-unavailable')!.repair, null);
});

// Case 21 — settings read failure never fabricates open gates.
test('settings read failure → automation-settings-unavailable, no fabricated gates', () => {
  const issues = deriveSystemHealthIssues(baseInputs({ automation: { state: 'unavailable' } }));
  assert.ok(find(issues, 'automation-settings-unavailable'));
  assert.ok(!find(issues, 'automation-global-pause-active'));
  assert.ok(!find(issues, 'automation-dataset-disabled'));
});

// Case 22 — global pause / dataset off are informational and do not degrade.
test('global pause + dataset disabled are info-only and keep overall healthy', () => {
  const automation = {
    state: 'available' as const,
    globalPause: true,
    datasets: {
      scores: { enabled: true },
      schedule: { enabled: true },
      odds: { enabled: false },
      rankings: { enabled: true },
      conferences: { enabled: true },
      'game-stats': { enabled: true },
    },
  };
  const issues = deriveSystemHealthIssues(baseInputs({ automation }));
  const pause = find(issues, 'automation-global-pause-active');
  const disabled = find(issues, 'automation-dataset-disabled');
  assert.equal(pause!.severity, 'info');
  assert.equal(disabled!.severity, 'info');
  assert.equal(disabled!.subject.id, 'odds');
  assert.equal(summarizeSystemHealthIssues(issues).overallState, 'healthy');
});

// Case 24 — CFBD remaining 1,007 permits and 1,006 warns.
test('CFBD reserve boundary: 1007 permits, 1006 reaches the reserve', () => {
  const okQuota = baseInputs().quota;
  const permit = deriveSystemHealthIssues(
    baseInputs({
      quota: {
        ...okQuota,
        cfbd: {
          state: 'available',
          used: 3993,
          remaining: 1007,
          limit: 5000,
          consistent: true,
          reserve: 1007,
          classification: 'ok',
        },
      },
    })
  );
  assert.ok(!find(permit, 'cfbd-automation-reserve-reached'));

  const reached = deriveSystemHealthIssues(
    baseInputs({
      quota: {
        ...okQuota,
        cfbd: {
          state: 'available',
          used: 3994,
          remaining: 1006,
          limit: 5000,
          consistent: true,
          reserve: 1007,
          classification: 'reserve-reached',
        },
      },
    })
  );
  assert.ok(find(reached, 'cfbd-automation-reserve-reached'));
});

// CFBD untrustworthy vs unavailable are distinct.
test('CFBD untrustworthy and unavailable produce distinct codes', () => {
  const untrustworthy = deriveSystemHealthIssues(
    baseInputs({
      quota: {
        ...baseInputs().quota,
        cfbd: {
          state: 'available',
          used: null,
          remaining: null,
          limit: null,
          consistent: false,
          reserve: 1007,
          classification: 'untrustworthy',
        },
      },
    })
  );
  assert.ok(find(untrustworthy, 'cfbd-quota-untrustworthy'));
  assert.ok(!find(untrustworthy, 'cfbd-quota-unavailable'));

  const unavailable = deriveSystemHealthIssues(
    baseInputs({ quota: { ...baseInputs().quota, cfbd: { state: 'unavailable' } } })
  );
  assert.ok(find(unavailable, 'cfbd-quota-unavailable'));
});

// Case 25 — canonical Odds threshold is 53; 53 permits and 52 warns.
test('Odds reserve boundary: 53 permits, 52 reaches the reserve', () => {
  const okQuota = baseInputs().quota;
  const permit = deriveSystemHealthIssues(
    baseInputs({
      quota: {
        ...okQuota,
        odds: {
          state: 'available',
          used: 447,
          remaining: 53,
          limit: 500,
          threshold: 53,
          capturedAt: null,
          classification: 'ok',
        },
      },
    })
  );
  assert.ok(!find(permit, 'odds-automation-reserve-reached'));

  const reached = deriveSystemHealthIssues(
    baseInputs({
      quota: {
        ...okQuota,
        odds: {
          state: 'available',
          used: 448,
          remaining: 52,
          limit: 500,
          threshold: 53,
          capturedAt: null,
          classification: 'reserve-reached',
        },
      },
    })
  );
  assert.ok(find(reached, 'odds-automation-reserve-reached'));
});

// Case 26 — odds usage absent and unavailable remain distinct.
test('Odds snapshot absent and unavailable produce distinct codes/severities', () => {
  const absent = deriveSystemHealthIssues(
    baseInputs({ quota: { ...baseInputs().quota, odds: { state: 'absent' } } })
  );
  const absentIssue = find(absent, 'odds-quota-snapshot-absent');
  assert.ok(absentIssue);
  assert.equal(absentIssue!.severity, 'info');

  const unavailable = deriveSystemHealthIssues(
    baseInputs({ quota: { ...baseInputs().quota, odds: { state: 'unavailable' } } })
  );
  const unavailableIssue = find(unavailable, 'odds-quota-unavailable');
  assert.ok(unavailableIssue);
  assert.equal(unavailableIssue!.severity, 'warning');
});

// Case 27 — PostgreSQL configured does not fabricate a healthy database claim.
test('postgres storage mode emits no issue and no positive health claim', () => {
  const issues = deriveSystemHealthIssues(
    baseInputs({
      storage: {
        state: 'available',
        mode: 'postgres',
        isProduction: true,
        databaseConfigured: true,
      },
    })
  );
  assert.equal(issues.filter((i) => i.code.startsWith('storage-')).length, 0);
  assert.ok(!codes(issues).some((c) => /healthy/.test(c)));
});

// Case 28 — production-misconfigured storage is critical.
test('production-misconfigured storage is a critical issue', () => {
  const issues = deriveSystemHealthIssues(
    baseInputs({
      storage: {
        state: 'available',
        mode: 'production-misconfigured',
        isProduction: true,
        databaseConfigured: false,
      },
    })
  );
  const storage = find(issues, 'storage-production-misconfigured');
  assert.ok(storage);
  assert.equal(storage!.severity, 'critical');
  assert.equal(storage!.repair, null);
  assert.equal(summarizeSystemHealthIssues(issues).overallState, 'critical');
});

// A storage read failure emits no false misconfigured claim.
test('storage read failure emits no misconfigured issue', () => {
  const issues = deriveSystemHealthIssues(baseInputs({ storage: { state: 'unavailable' } }));
  assert.ok(!find(issues, 'storage-production-misconfigured'));
});

// Case 29 — deterministic severity ordering + identity dedup.
test('issues are ordered by severity → axis → canonical order and deduped by identity', () => {
  const cacheStates = baseInputs().cacheStates;
  cacheStates.scores = 'absent';
  const inputs = baseInputs({
    storage: {
      state: 'available',
      mode: 'production-misconfigured',
      isProduction: true,
      databaseConfigured: false,
    },
    providerRefresh: refreshSnapshot({
      scores: { canonical: canonicalOutcome('scores', 'failed') }, // critical (absent cache)
      odds: { canonical: canonicalOutcome('odds', 'partial') }, // warning
    }),
    cacheStates,
    automation: {
      state: 'available',
      globalPause: true, // info
      datasets: {
        scores: { enabled: true },
        schedule: { enabled: true },
        odds: { enabled: true },
        rankings: { enabled: true },
        conferences: { enabled: true },
        'game-stats': { enabled: true },
      },
    },
  });
  const issues = deriveSystemHealthIssues(inputs);
  const severities = issues.map((i) => i.severity);
  const sorted = [...severities].sort(
    (a, b) =>
      (a === 'critical' ? 0 : a === 'warning' ? 1 : 2) -
      (b === 'critical' ? 0 : b === 'warning' ? 1 : 2)
  );
  assert.deepEqual(severities, sorted, 'severity is non-decreasing across the list');
  // Critical first (storage global + scores dataset), then warnings, then the info gate.
  assert.equal(issues[0].severity, 'critical');
  assert.equal(issues[issues.length - 1].code, 'automation-global-pause-active');

  // Dedup: identical identity collapses.
  const withDupe = [...issues, issues[0]];
  const seen = new Set(withDupe.map((i) => `${i.code}|${i.subject.axis}|${i.subject.id}`));
  assert.equal(seen.size, issues.length);
});

// ---------------------------------------------------------------------------
// PLATFORM-086F2H3B2 — the lifecycle-integrity issue. Closes deferral (q),
// carried since PLATFORM-086F2H1R3.
//
// The count reaches System Health already: it rides on the receipt TARGET for
// the four lifecycle-bearing jobs and the parser normalizes a legacy `undefined`
// to 0. Until now it surfaced only as a suffix inside a collapsed scheduler row.
// ---------------------------------------------------------------------------

const LIFECYCLE_TARGET_JOBS = [
  'schedule-refresh',
  'rankings',
  'season-transition',
  'season-rollover',
] as const;

/** Delivery snapshot where `job` reports `refusals` and every other job is clean. */
function refusalDelivery(job: (typeof LIFECYCLE_TARGET_JOBS)[number], refusals: number) {
  return deliverySnapshot(
    EXTERNAL_SCHEDULER_JOBS.map((j) =>
      deliveryRow(
        j,
        'on-time',
        j === job ? receiptWithRefusals(j, 'success', refusals) : receiptFor(j, 'success')
      )
    )
  );
}

test('a single job reporting refused lifecycle records raises one issue', () => {
  const issues = deriveSystemHealthIssues(
    baseInputs({ schedulerDelivery: refusalDelivery('season-rollover', 1) })
  );

  const lifecycle = issues.filter((i) => i.code === 'lifecycle-data-unusable');
  assert.equal(lifecycle.length, 1);
  assert.equal(lifecycle[0]!.severity, 'warning');
  assert.deepEqual(lifecycle[0]!.subject, { axis: 'global', id: 'lifecycle-integrity' });
  assert.match(lifecycle[0]!.explanation, /refused production lifecycle data/);
});

// THE counting constraint. Each count is per JOB and per RUN and counts RECORDS,
// and the same corrupt league is counted independently by up to four jobs — so
// three jobs reporting 1 each is not "3 leagues", and no arithmetic over those
// counts is defensible. Receipts carry no slug, so a deduplicated league count
// is not derivable at all.
test('three jobs reporting refusals produce ONE issue that states no count', () => {
  const snapshot = deliverySnapshot(
    EXTERNAL_SCHEDULER_JOBS.map((j) =>
      deliveryRow(
        j,
        'on-time',
        (LIFECYCLE_TARGET_JOBS as readonly string[]).includes(j) && j !== 'schedule-refresh'
          ? receiptWithRefusals(j as (typeof LIFECYCLE_TARGET_JOBS)[number], 'success', 1)
          : receiptFor(j, 'success')
      )
    )
  );

  const issues = deriveSystemHealthIssues(baseInputs({ schedulerDelivery: snapshot }));
  const lifecycle = issues.filter((i) => i.code === 'lifecycle-data-unusable');

  assert.equal(lifecycle.length, 1, 'one issue, not one per reporting job');
  // The COUNT alone is partly guaranteed by the derivation's dedup, which
  // collapses identical `code|axis|id` identities — a per-job implementation
  // emitting the same global subject would still reduce to one. The GLOBAL
  // subject is what actually makes this a single combined issue, so it is
  // asserted directly: a per-job subject produces four identities and four rows.
  assert.deepEqual(lifecycle[0]!.subject, { axis: 'global', id: 'lifecycle-integrity' });
  const text = `${lifecycle[0]!.title} ${lifecycle[0]!.explanation}`;
  assert.ok(!/\d/.test(text), `no digit may appear in operator copy; got: ${text}`);
  assert.ok(!/\bleagues?\b/i.test(text), 'never expressed as a league count');

  // It names the reporting jobs — the most specific TRUE thing available — and
  // only those.
  assert.match(lifecycle[0]!.explanation, /rankings/);
  assert.match(lifecycle[0]!.explanation, /season-transition/);
  assert.match(lifecycle[0]!.explanation, /season-rollover/);
  assert.ok(
    !lifecycle[0]!.explanation.includes('schedule-refresh'),
    'a job that reported nothing is not named'
  );
});

// REGRESSION TEST — the issue must NOT derive from `result`. R3's ruling: a valid
// target can succeed while another production record is refused, so gating on the
// aggregate would hide exactly the case this issue exists to surface.
test('the issue appears regardless of the reporting run’s aggregate result', () => {
  for (const result of ['success', 'partial', 'no-op', 'skipped'] as const) {
    const snapshot = deliverySnapshot(
      EXTERNAL_SCHEDULER_JOBS.map((j) =>
        deliveryRow(
          j,
          'on-time',
          j === 'rankings' ? receiptWithRefusals(j, result, 2) : receiptFor(j, 'success')
        )
      )
    );
    const issues = deriveSystemHealthIssues(baseInputs({ schedulerDelivery: snapshot }));
    assert.ok(
      find(issues, 'lifecycle-data-unusable'),
      `a ${result} run carrying refusals must still raise the issue`
    );
  }
});

test('no issue when every parsed receipt reports zero', () => {
  const issues = deriveSystemHealthIssues(baseInputs({ schedulerDelivery: healthyDelivery() }));
  assert.equal(find(issues, 'lifecycle-data-unusable'), undefined);

  // POSITIVE CONTROL — the same shape with one positive count DOES raise it, so
  // the absence above is a real observation rather than a derivation that never
  // fires.
  const armed = deriveSystemHealthIssues(
    baseInputs({ schedulerDelivery: refusalDelivery('rankings', 1) })
  );
  assert.ok(find(armed, 'lifecycle-data-unusable'));
});

// A receipt that is absent or unparsed cannot report a count. Inferring one would
// be fabrication, so a `missing` delivery contributes nothing.
test('a job with no readable receipt contributes nothing', () => {
  const snapshot = deliverySnapshot(
    EXTERNAL_SCHEDULER_JOBS.map((j) =>
      deliveryRow(
        j,
        j === 'season-rollover' ? 'missing' : 'on-time',
        j === 'season-rollover' ? null : receiptFor(j, 'success')
      )
    )
  );
  const issues = deriveSystemHealthIssues(baseInputs({ schedulerDelivery: snapshot }));
  assert.equal(find(issues, 'lifecycle-data-unusable'), undefined);

  // POSITIVE CONTROL — that same job WITH a readable refusal-bearing receipt
  // raises the issue, so the absence is about the missing receipt and not about
  // this job being unreachable by the derivation.
  const armed = deriveSystemHealthIssues(
    baseInputs({ schedulerDelivery: refusalDelivery('season-rollover', 1) })
  );
  assert.ok(find(armed, 'lifecycle-data-unusable'));
});

// There is NO supported operation that writes a lifecycle status or year onto a
// production record, so the issue offers no destination. `/admin/season` would
// name a page that cannot perform the repair.
test('the issue offers no repair destination', () => {
  const issues = deriveSystemHealthIssues(
    baseInputs({ schedulerDelivery: refusalDelivery('season-transition', 1) })
  );
  assert.equal(find(issues, 'lifecycle-data-unusable')!.repair, null);
});

// It is ADDITIVE to the execution fault, never a replacement — the two answer
// different questions and a wholly-refused run raises both.
test('it co-exists with an execution fault on the same run', () => {
  const snapshot = deliverySnapshot(
    EXTERNAL_SCHEDULER_JOBS.map((j) =>
      deliveryRow(
        j,
        'on-time',
        j === 'season-rollover' ? receiptWithRefusals(j, 'failure', 1) : receiptFor(j, 'success')
      )
    )
  );
  const issues = deriveSystemHealthIssues(baseInputs({ schedulerDelivery: snapshot }));

  assert.ok(find(issues, 'scheduler-execution-failed'), 'the run fault still raises');
  assert.ok(find(issues, 'lifecycle-data-unusable'), 'and the data fault raises beside it');
});

// Ordering and dedup stay deterministic with the new global-axis issue present.
test('the new issue does not disturb deterministic ordering or dedup', () => {
  const inputs = baseInputs({ schedulerDelivery: refusalDelivery('rankings', 3) });
  const first = codes(deriveSystemHealthIssues(inputs));
  const second = codes(deriveSystemHealthIssues(inputs));

  assert.deepEqual(first, second, 'stable across calls');
  assert.equal(
    first.filter((c) => c === 'lifecycle-data-unusable').length,
    1,
    'exactly one, never duplicated'
  );
});

// ---------------------------------------------------------------------------
// Two different questions, deliberately split.
//
// `formatLateness` is a pure function: test it DIRECTLY across every magnitude,
// where reachability is not a claim anyone has to make. Building a fake row to
// reach a formatter is what produced three tests that asserted states the
// classifier can never emit — including a `30_000ms` case whose receipt sits
// AFTER its required slot, which is the on-time shape.
//
// The row-level behaviour then needs exactly ONE test, built through
// `deliveryRow`, which now refuses a row the classifier would not produce.
// ---------------------------------------------------------------------------

test('formatLateness reports the granularity an operator acts on', () => {
  // Largest two units, one-minute floor: the question is "minutes or days", and
  // nobody decides anything on seconds.
  assert.equal(formatLateness(30_000), 'under a minute');
  assert.equal(formatLateness(7 * 60_000), '7m');
  assert.equal(formatLateness(95 * 60_000), '1h 35m');
  assert.equal(formatLateness(26 * 3_600_000), '1d 2h');
  assert.equal(formatLateness(3 * 86_400_000), '3d');
  assert.equal(formatLateness(60_000), '1m', 'the floor boundary itself');
});

test('formatLateness refuses a span that is not a duration', () => {
  // THE SHIPPED BUG'S SHAPE. A negative span slid through the `< 60_000` check
  // and printed "under a minute", so a four-day silence read as trivial. NaN took
  // the other path and printed the literal "NaNm".
  //
  // Tested here rather than through a row because no row can carry these values —
  // and a test that invents one to reach this branch is the failure this file has
  // already made three times.
  assert.equal(formatLateness(-1), 'an unknown interval');
  assert.equal(formatLateness(-3 * 86_400_000), 'an unknown interval');
  assert.equal(formatLateness(Number.NaN), 'an unknown interval');
  assert.equal(formatLateness(Number.POSITIVE_INFINITY), 'an unknown interval');
});

test('a late warning names the slot, the last start, and how long ago that was', () => {
  // ONE row-level test, and `deliveryRow` refuses it if the label and the
  // timestamps disagree — so this fixture is a shape production can emit.
  const startedMs = NOW - (3 * 86_400_000 + 11 * 3_600_000);
  const rows = healthyDelivery().jobs.map((row) =>
    row.job === 'live-scores'
      ? deliveryRow(
          'live-scores',
          'late',
          receiptFor('live-scores', 'success', startedMs),
          new Date(NOW - 60_000).toISOString() // slot AFTER the last run: that is what late means
        )
      : row
  );
  const late = find(
    deriveSystemHealthIssues(baseInputs({ schedulerDelivery: deliverySnapshot(rows) })),
    'scheduler-delivery-late'
  );
  assert.ok(late);

  // Absolute UTC on both instants — the reader is comparing them, and relative
  // rendering ("7m ago" against "Friday") is what hid a three-day gap.
  assert.match(late!.explanation, /at or after \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC/);
  assert.match(late!.explanation, /started \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC/);
  assert.match(late!.explanation, /3d 11h ago/);
  // The regression guard: this row rendered "under a minute late" in production.
  assert.doesNotMatch(late!.explanation, /under a minute/);
  // And it must not read as an EARLY arrival, which "due by X ... arrived before X" did.
  assert.doesNotMatch(late!.explanation, /due by/);
});

test('the late TITLE does not claim a delivery answered the slot', () => {
  // The title renders first and larger than the explanation, so it is the
  // sentence an operator reads. It said "delivered later than scheduled" while
  // the corrected explanation said nothing was delivered for that slot at all —
  // the headline asserting exactly what the body had just been fixed to deny.
  const rows = healthyDelivery().jobs.map((row) =>
    row.job === 'live-scores'
      ? deliveryRow(
          'live-scores',
          'late',
          receiptFor('live-scores', 'success', NOW - 86_400_000),
          new Date(NOW - 60_000).toISOString()
        )
      : row
  );
  const late = find(
    deriveSystemHealthIssues(baseInputs({ schedulerDelivery: deliverySnapshot(rows) })),
    'scheduler-delivery-late'
  );
  assert.match(late!.title, /has not delivered since its required slot/);
  assert.doesNotMatch(late!.title, /delivered later than scheduled/);
});

test('a run that is barely late is still a row the helper accepts', () => {
  // The derived slot used to be `startedAt + 60s`, which for a recent receipt
  // lands in the FUTURE — and the guard then refused a row the classifier can
  // genuinely emit, telling a future author their legitimate case was impossible.
  assert.doesNotThrow(() =>
    deliveryRow('live-scores', 'late', receiptFor('live-scores', 'success', NOW - 30_000))
  );
  // ...and the clamp must not break the ordering that makes it late.
  const row = deliveryRow(
    'live-scores',
    'late',
    receiptFor('live-scores', 'success', NOW - 30_000)
  );
  assert.ok(
    Date.parse(row.receipt!.startedAt) < Date.parse(row.requiredStartedAt),
    'still classifies late'
  );
  assert.ok(Date.parse(row.requiredStartedAt) <= NOW, 'and the slot is never in the future');
});

test('a missing delivery names its deadline and claims no elapsed figure', () => {
  // No receipt means no silence to measure. `now - slot` is floored by the grace
  // window, so for hourly odds it reads the same whether one slot was missed or
  // the job has never run.
  const rows = healthyDelivery().jobs.map((row) =>
    row.job === 'odds' ? deliveryRow('odds', 'missing', null) : row
  );
  const missing = find(
    deriveSystemHealthIssues(baseInputs({ schedulerDelivery: deliverySnapshot(rows) })),
    'scheduler-delivery-missing'
  );
  assert.ok(missing);
  assert.match(missing!.explanation, /at or after \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC/);
  assert.match(missing!.explanation, /grace period has expired/, 'names the field accurately');
  assert.doesNotMatch(missing!.explanation, /ago/, 'no figure this state cannot support');
});

test('an incoherent row cannot enter a snapshot, however it was built', () => {
  // The guard lives at the CHOKE POINT — `deliverySnapshot` — because checking
  // only at construction let a caller spread the built row and replace a
  // timestamp afterwards, which is exactly how the shipped fixture was written.
  // Each case below is a bypass a reviewer found or a defect that reached the
  // page, and each must now be impossible to get into a snapshot.
  const ok = () => receiptFor('live-scores', 'success', NOW - 3_600_000);

  // 1. The ORIGINAL: spread the row, then override the slot so the label lies.
  assert.throws(
    () =>
      deliverySnapshot([
        {
          ...deliveryRow('live-scores', 'late', ok()),
          requiredStartedAt: new Date(NOW - 7_200_000).toISOString(), // now on-time
        },
      ]),
    /classifies 'on-time'/,
    'inline spread-override'
  );

  // 2. The HOISTED form, which a source scan for the inline spelling missed.
  const built = deliveryRow('live-scores', 'late', ok());
  const hoisted = { ...built, requiredStartedAt: new Date(NOW - 7_200_000).toISOString() };
  assert.throws(() => deliverySnapshot([hoisted]), /classifies 'on-time'/, 'hoisted override');

  // 3. A required slot in the FUTURE. Production computes it as
  //    `previousSlot(now - grace)`, so it never is — and a future slot let a
  //    seconds-old run be labelled late and render "under a minute ago".
  // Built from a PAST receipt so `deliveryRow` accepts it, then pushed into the
  // future by the override — otherwise the helper's own guard throws first and
  // the assertion passes on the inner error, proving nothing about the choke
  // point. (It did exactly that: delete `rows.forEach(...)` and this case still
  // went green.)
  const futureSlot = {
    ...deliveryRow('odds', 'late', receiptFor('odds', 'success', NOW - 3_600_000)),
    requiredStartedAt: new Date(NOW + 60_000).toISOString(),
  };
  assert.doesNotThrow(
    () =>
      assertRowIsClassifiable({
        ...futureSlot,
        requiredStartedAt: new Date(NOW - 60_000).toISOString(),
      }),
    'control: the row is otherwise coherent, so the future slot is what fails'
  );
  assert.throws(() => deliverySnapshot([futureSlot]), /is after now/, 'future required slot');

  // 4. `invalid` carrying a receipt — emits both a receipt-invalid issue and an
  //    execution issue, a pair no real snapshot produces.
  assert.throws(
    () => deliverySnapshot([{ ...deliveryRow('odds', 'invalid', null), receipt: ok() }]),
    /must carry no receipt/,
    'invalid with a receipt'
  );

  // 5. An unparseable instant. NaN comparisons are false, so this classified as
  //    `late` and slipped past the ordering check entirely.
  assert.throws(
    () =>
      deliverySnapshot([
        { ...deliveryRow('odds', 'late', ok()), requiredStartedAt: 'not-a-timestamp' },
      ]),
    /unparseable/,
    'unparseable required slot'
  );

  // POSITIVE CONTROL: a coherent row passes, so the guard is rejecting
  // incoherence rather than everything handed to it.
  assert.doesNotThrow(() =>
    deliverySnapshot([
      deliveryRow('live-scores', 'late', ok(), new Date(NOW - 60_000).toISOString()),
    ])
  );
});

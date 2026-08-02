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
  refreshSnapshot,
  safeStatus,
  unavailableDelivery,
  YEAR,
} from './systemHealthFixtures.ts';
import { EXTERNAL_SCHEDULER_JOBS } from '../schedulerExecutionStatus.ts';
import { weekPartitionScope } from '../../providerRefreshScope.ts';

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

// Lifecycle execution failure routes to Season Management.
test('lifecycle execution failure links to Season Management', () => {
  const rows = healthyDelivery().jobs.map((row) =>
    row.job === 'season-rollover'
      ? deliveryRow('season-rollover', 'on-time', receiptFor('season-rollover', 'failure'))
      : row
  );
  const issues = deriveSystemHealthIssues(
    baseInputs({ schedulerDelivery: deliverySnapshot(rows) })
  );
  const failed = find(issues, 'scheduler-execution-failed');
  assert.equal(failed!.repair?.surface, 'season-management');
  assert.equal(failed!.repair?.href, '/admin/season');
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

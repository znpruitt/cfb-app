/**
 * PLATFORM-086F2G — deterministic tests for the server-side stoplight panel
 * derivation. Health policy lives here (not in React); these lock the
 * status/label mapping per fact+issue shape.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deriveDatasetFreshness,
  deriveSystemHealthPanels,
  type SystemHealthPanelKey,
  type SystemHealthPanelsInput,
} from '../systemHealthPanels.ts';
import type {
  AutomationHealth,
  SystemHealthIssue,
  SystemHealthQuota,
} from '../systemHealthIssues.ts';

const NOW = new Date('2026-10-15T12:00:00.000Z').toISOString();

function automationOn(): AutomationHealth {
  return {
    state: 'available',
    globalPause: false,
    datasets: {
      scores: { enabled: true },
      schedule: { enabled: true },
      odds: { enabled: true },
      rankings: { enabled: true },
      conferences: { enabled: true },
      'game-stats': { enabled: true },
    },
  };
}

function quotaOk(): SystemHealthQuota {
  return {
    cfbd: {
      state: 'available',
      used: 100,
      remaining: 4900,
      limit: 5000,
      consistent: true,
      reserve: 1007,
      classification: 'ok',
    },
    odds: {
      state: 'available',
      used: 100,
      remaining: 400,
      limit: 500,
      threshold: 53,
      capturedAt: NOW,
      classification: 'ok',
    },
  };
}

function issue(
  overrides: Partial<SystemHealthIssue> & Pick<SystemHealthIssue, 'code' | 'severity'>
): SystemHealthIssue {
  return {
    subject: { axis: 'global', id: 'x' },
    title: `${overrides.code} title`,
    explanation: 'explanation',
    repair: null,
    ...overrides,
  };
}

function baseInput(overrides: Partial<SystemHealthPanelsInput> = {}): SystemHealthPanelsInput {
  return {
    generatedAt: NOW,
    overallState: 'healthy',
    issues: [],
    automation: automationOn(),
    quota: quotaOk(),
    storage: { state: 'available', mode: 'postgres', isProduction: true, databaseConfigured: true },
    ...overrides,
  };
}

function panel(input: SystemHealthPanelsInput, key: SystemHealthPanelKey) {
  const p = deriveSystemHealthPanels(input).find((x) => x.key === key);
  assert.ok(p, `expected panel ${key}`);
  return p!;
}

test('six panels in fixed order', () => {
  const keys = deriveSystemHealthPanels(baseInput()).map((p) => p.key);
  assert.deepEqual(keys, [
    'overall',
    'scheduler',
    'provider-data',
    'automation',
    'quota',
    'storage',
  ]);
});

test('all-healthy → every panel green/Healthy', () => {
  const panels = deriveSystemHealthPanels(baseInput());
  for (const p of panels) {
    assert.equal(p.status, 'green', `${p.key} should be green`);
    assert.equal(p.stateLabel, 'Healthy');
  }
});

test('overall maps critical→red, degraded→yellow, healthy→green', () => {
  assert.equal(panel(baseInput({ overallState: 'critical' }), 'overall').status, 'red');
  assert.equal(panel(baseInput({ overallState: 'degraded' }), 'overall').status, 'yellow');
  assert.equal(panel(baseInput({ overallState: 'healthy' }), 'overall').status, 'green');
});

test('a scheduler warning → scheduler yellow / Attention needed', () => {
  const p = panel(
    baseInput({
      issues: [
        issue({
          code: 'scheduler-delivery-late',
          severity: 'warning',
          subject: { axis: 'job', id: 'odds' },
        }),
      ],
    }),
    'scheduler'
  );
  assert.equal(p.status, 'yellow');
  assert.equal(p.stateLabel, 'Attention needed');
});

test('scheduler all-unavailable → yellow / Unknown', () => {
  const p = panel(
    baseInput({ issues: [issue({ code: 'scheduler-delivery-unavailable', severity: 'warning' })] }),
    'scheduler'
  );
  assert.equal(p.status, 'yellow');
  assert.equal(p.stateLabel, 'Unknown');
});

test('a critical provider issue → provider-data red / Action required, repair surfaced', () => {
  const p = panel(
    baseInput({
      issues: [
        issue({
          code: 'provider-refresh-failed',
          severity: 'critical',
          subject: { axis: 'dataset', id: 'scores' },
          repair: {
            surface: 'data-maintenance',
            href: '/admin/data/cache',
            label: 'Open Data Maintenance',
          },
        }),
      ],
    }),
    'provider-data'
  );
  assert.equal(p.status, 'red');
  assert.equal(p.stateLabel, 'Action required');
});

test('automation paused (info gate issue) → gray / Paused', () => {
  const p = panel(
    baseInput({ issues: [issue({ code: 'automation-global-pause-active', severity: 'info' })] }),
    'automation'
  );
  assert.equal(p.status, 'gray');
  assert.equal(p.stateLabel, 'Paused');
});

test('automation settings unavailable → yellow / Unknown', () => {
  const p = panel(baseInput({ automation: { state: 'unavailable' } }), 'automation');
  assert.equal(p.status, 'yellow');
  assert.equal(p.stateLabel, 'Unknown');
});

test('odds snapshot absent (info) → quota gray / Awaiting activity', () => {
  const p = panel(
    baseInput({
      issues: [issue({ code: 'odds-quota-snapshot-absent', severity: 'info' })],
      quota: { ...quotaOk(), odds: { state: 'absent' } },
    }),
    'quota'
  );
  assert.equal(p.status, 'gray');
  assert.equal(p.stateLabel, 'Awaiting activity');
});

test('cfbd reserve reached (warning) → quota yellow / Attention needed', () => {
  const p = panel(
    baseInput({
      issues: [issue({ code: 'cfbd-automation-reserve-reached', severity: 'warning' })],
    }),
    'quota'
  );
  assert.equal(p.status, 'yellow');
  assert.equal(p.stateLabel, 'Attention needed');
});

test('storage production-misconfigured → red / Action required', () => {
  const p = panel(
    baseInput({
      storage: {
        state: 'available',
        mode: 'production-misconfigured',
        isProduction: true,
        databaseConfigured: false,
      },
    }),
    'storage'
  );
  assert.equal(p.status, 'red');
  assert.equal(p.stateLabel, 'Action required');
});

test('storage unavailable → yellow / Unknown', () => {
  const p = panel(baseInput({ storage: { state: 'unavailable' } }), 'storage');
  assert.equal(p.status, 'yellow');
  assert.equal(p.stateLabel, 'Unknown');
});

test('healthy provider panel does not claim a successful refresh', () => {
  const p = panel(baseInput(), 'provider-data');
  assert.equal(p.status, 'green');
  assert.ok(!/refresh/i.test(p.detail), 'detail should not assert a successful refresh');
});

// --- deriveDatasetFreshness (server-side freshness stoplight) -----------------

test('freshness: available cache + no diagnostics → green Current', () => {
  const f = deriveDatasetFreshness({
    dataset: 'schedule',
    cacheState: 'available',
    diagnostics: [],
  });
  assert.deepEqual(f, { status: 'green', label: 'Current' });
});

test('freshness: conferences available → green Available (availability-only)', () => {
  const f = deriveDatasetFreshness({
    dataset: 'conferences',
    cacheState: 'available',
    diagnostics: [],
  });
  assert.deepEqual(f, { status: 'green', label: 'Available' });
});

test('freshness: a warning diagnostic → yellow Stale', () => {
  const f = deriveDatasetFreshness({
    dataset: 'rankings',
    cacheState: 'available',
    diagnostics: [{ severity: 'warning' }],
  });
  assert.equal(f.status, 'yellow');
  assert.equal(f.label, 'Stale');
});

test('freshness: an error diagnostic → red Missing', () => {
  const f = deriveDatasetFreshness({
    dataset: 'schedule',
    cacheState: 'absent',
    diagnostics: [{ severity: 'error' }],
  });
  assert.equal(f.status, 'red');
  assert.equal(f.label, 'Missing');
});

test('freshness: absent cache + no diagnostics → yellow No cached data', () => {
  const f = deriveDatasetFreshness({ dataset: 'scores', cacheState: 'absent', diagnostics: [] });
  assert.deepEqual(f, { status: 'yellow', label: 'No cached data' });
});

test('freshness: unknown cache + no diagnostics → gray Unknown', () => {
  const f = deriveDatasetFreshness({ dataset: 'scores', cacheState: 'unknown', diagnostics: [] });
  assert.deepEqual(f, { status: 'gray', label: 'Unknown' });
});

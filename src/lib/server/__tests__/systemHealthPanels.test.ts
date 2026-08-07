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
  type PanelStatus,
  type SystemHealthPanelKey,
  type SystemHealthPanelsInput,
} from '../systemHealthPanels.ts';
import type {
  AutomationHealth,
  SystemHealthIssue,
  SystemHealthQuota,
} from '../systemHealthIssues.ts';
import { PROVIDER_DATASETS, type ProviderDataset } from '../../providerDatasets.ts';

const NOW = new Date('2026-10-15T12:00:00.000Z').toISOString();

function automationAvailable(
  globalPause: boolean,
  disabled: ProviderDataset[] = []
): AutomationHealth {
  const datasets = {} as Record<ProviderDataset, { enabled: boolean }>;
  for (const d of PROVIDER_DATASETS) datasets[d] = { enabled: !disabled.includes(d) };
  return { state: 'available', globalPause, datasets };
}

function automationOn(): AutomationHealth {
  return automationAvailable(false);
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

const ALL_GREEN: PanelStatus[] = ['green', 'green', 'green', 'green', 'green', 'green'];

function baseInput(overrides: Partial<SystemHealthPanelsInput> = {}): SystemHealthPanelsInput {
  return {
    generatedAt: NOW,
    issues: [],
    automation: automationOn(),
    quota: quotaOk(),
    storage: { state: 'available', mode: 'postgres', isProduction: true, databaseConfigured: true },
    datasetFreshness: ALL_GREEN,
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

test('all-healthy → every panel green (configuration-only labels for automation/storage)', () => {
  const panels = deriveSystemHealthPanels(baseInput());
  for (const p of panels) {
    assert.equal(p.status, 'green', `${p.key} should be green`);
  }
  const label = (key: SystemHealthPanelKey) => panels.find((p) => p.key === key)!.stateLabel;
  assert.equal(label('overall'), 'Healthy');
  assert.equal(label('scheduler'), 'Healthy');
  assert.equal(label('provider-data'), 'Healthy');
  assert.equal(label('quota'), 'Healthy');
  // Automation gates prove ENABLED, not running; storage proves CONFIGURED, not live.
  assert.equal(label('automation'), 'Enabled');
  assert.equal(label('storage'), 'Configured');
});

test('provider-data panel folds dataset freshness: an absent-cache row (no issue) → yellow', () => {
  const freshness: PanelStatus[] = ['green', 'green', 'yellow', 'green', 'green', 'green'];
  const p = panel(baseInput({ datasetFreshness: freshness }), 'provider-data');
  assert.equal(p.status, 'yellow');
  assert.equal(p.stateLabel, 'Attention needed');
  assert.ok(
    !/present and current/.test(p.detail),
    'must not claim all data present when a row is not'
  );
});

test('overall is a holistic rollup of the sections (never contradicts a tile)', () => {
  // All green → green.
  assert.equal(panel(baseInput(), 'overall').status, 'green');
  // A yellow section (freshness alone, no issue) → overall yellow (fixes the
  // "all normal" over a yellow tile contradiction).
  assert.equal(
    panel(
      baseInput({ datasetFreshness: ['green', 'green', 'yellow', 'green', 'green', 'green'] }),
      'overall'
    ).status,
    'yellow'
  );
  // A red section (storage misconfigured) → overall red.
  assert.equal(
    panel(
      baseInput({
        storage: {
          state: 'available',
          mode: 'production-misconfigured',
          isProduction: true,
          databaseConfigured: false,
        },
      }),
      'overall'
    ).status,
    'red'
  );
  // Intentional gray (automation paused) alone does NOT degrade overall.
  assert.equal(
    panel(baseInput({ automation: automationAvailable(true) }), 'overall').status,
    'green'
  );
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

test('automation global pause → gray / Paused', () => {
  const p = panel(
    baseInput({
      automation: automationAvailable(true),
      issues: [issue({ code: 'automation-global-pause-active', severity: 'info' })],
    }),
    'automation'
  );
  assert.equal(p.status, 'gray');
  assert.equal(p.stateLabel, 'Paused');
});

test('one disabled dataset (not a global pause) → gray / Partially disabled', () => {
  const p = panel(
    baseInput({
      automation: automationAvailable(false, ['game-stats']),
      issues: [
        issue({
          code: 'automation-dataset-disabled',
          severity: 'info',
          subject: { axis: 'dataset', id: 'game-stats' },
        }),
      ],
    }),
    'automation'
  );
  assert.equal(p.status, 'gray');
  assert.equal(p.stateLabel, 'Partially disabled');
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
    diagnosticsAvailable: true,
    diagnostics: [],
  });
  assert.deepEqual(f, { status: 'green', label: 'Current' });
});

test('freshness: conferences available → green Available (availability-only)', () => {
  const f = deriveDatasetFreshness({
    dataset: 'conferences',
    cacheState: 'available',
    diagnosticsAvailable: true,
    diagnostics: [],
  });
  assert.deepEqual(f, { status: 'green', label: 'Available' });
});

test('freshness: a *-cache-stale warning → yellow Stale', () => {
  const f = deriveDatasetFreshness({
    dataset: 'rankings',
    cacheState: 'available',
    diagnosticsAvailable: true,
    diagnostics: [{ severity: 'warning', code: 'rankings-cache-stale' }],
  });
  assert.deepEqual(f, { status: 'yellow', label: 'Stale' });
});

test('freshness: a non-stale warning defect (identity mismatch) → yellow Attention, not Stale', () => {
  const f = deriveDatasetFreshness({
    dataset: 'game-stats',
    cacheState: 'available',
    diagnosticsAvailable: true,
    diagnostics: [{ severity: 'warning', code: 'game-stats-identity-mismatch' }],
  });
  assert.equal(f.status, 'yellow');
  assert.equal(f.label, 'Attention');
});

test('freshness: an unavailable-evidence warning → gray Unknown, not Stale', () => {
  const f = deriveDatasetFreshness({
    dataset: 'game-stats',
    cacheState: 'available',
    diagnosticsAvailable: true,
    diagnostics: [{ severity: 'warning', code: 'game-stats-diagnostics-unavailable' }],
  });
  assert.deepEqual(f, { status: 'gray', label: 'Unknown' });
});

test('freshness: diagnostics subsystem unavailable → gray Unknown (even with cache present)', () => {
  const f = deriveDatasetFreshness({
    dataset: 'schedule',
    cacheState: 'available',
    diagnosticsAvailable: false,
    diagnostics: [],
  });
  assert.deepEqual(f, { status: 'gray', label: 'Unknown' });
});

test('freshness: an error diagnostic → red Missing', () => {
  const f = deriveDatasetFreshness({
    dataset: 'schedule',
    cacheState: 'absent',
    diagnosticsAvailable: true,
    diagnostics: [{ severity: 'error', code: 'schedule-cache-missing' }],
  });
  assert.equal(f.status, 'red');
  assert.equal(f.label, 'Missing');
});

test('freshness: absent cache + no diagnostics → yellow No cached data', () => {
  const f = deriveDatasetFreshness({
    dataset: 'scores',
    cacheState: 'absent',
    diagnosticsAvailable: true,
    diagnostics: [],
  });
  assert.deepEqual(f, { status: 'yellow', label: 'No cached data' });
});

test('freshness: unknown cache + no diagnostics → gray Unknown', () => {
  const f = deriveDatasetFreshness({
    dataset: 'scores',
    cacheState: 'unknown',
    diagnosticsAvailable: true,
    diagnostics: [],
  });
  assert.deepEqual(f, { status: 'gray', label: 'Unknown' });
});

// ---------------------------------------------------------------------------
// PLATFORM-086F2H3B2 — panel routing for the lifecycle-integrity issue.
//
// `providerDataPanel`'s predicate is RESIDUAL: anything not claimed by the
// scheduler, automation, quota, or storage sets falls into Provider data. A new
// issue code therefore lands there by default, and nothing in this suite pinned
// that behaviour — which is why the first version of F2H3B2 shipped a
// league-registry fault rendered as a provider-data fault, and no test failed.
// ---------------------------------------------------------------------------

const LIFECYCLE_ISSUE: SystemHealthIssue = {
  code: 'lifecycle-data-unusable',
  severity: 'warning',
  subject: { axis: 'global', id: 'lifecycle-integrity' },
  title: 'Production lifecycle data is unusable',
  explanation: 'Automatic processing refused production lifecycle data.',
  repair: null,
};

test('a lifecycle-integrity issue never touches the Provider data tile', () => {
  const input = baseInput({ issues: [LIFECYCLE_ISSUE] });

  const providerData = panel(input, 'provider-data');
  assert.equal(providerData.status, 'green', 'nothing about provider data is wrong');
  assert.ok(
    !providerData.detail.includes('lifecycle'),
    `the provider tile must not carry the lifecycle sentence; got: ${providerData.detail}`
  );

  // POSITIVE CONTROL — a genuine provider warning on the same helper DOES turn
  // the tile yellow, so the green above is a real routing observation and not a
  // tile that can never degrade.
  const withProvider = panel(
    baseInput({
      issues: [issue({ code: 'provider-refresh-failed', severity: 'warning' })],
    }),
    'provider-data'
  );
  assert.equal(withProvider.status, 'yellow');
});

// Overall is the verdict, not a tile. An issue owned by no tile must still reach
// it, or the dashboard reports "all systems are operating normally" above an
// open warning.
test('a lifecycle-integrity issue still degrades Overall', () => {
  const panels = deriveSystemHealthPanels(baseInput({ issues: [LIFECYCLE_ISSUE] }));
  const overall = panels.find((p) => p.key === 'overall')!;

  assert.equal(overall.status, 'yellow');
  assert.equal(overall.stateLabel, 'Attention needed');

  // The deliberate consequence, pinned so it is a decision rather than a
  // surprise: every SECTION tile stays green, because the fault is not any
  // subsystem's. The issue carries its own detail in the issues list.
  for (const p of panels) {
    if (p.key === 'overall') continue;
    assert.equal(p.status, 'green', `${p.key} is not the subject of this fault`);
  }
});

// REGRESSION TEST — `governing` takes the FIRST match in the globally-sorted
// list, and `compareIssues` ranks the `global` axis ahead of `dataset` at equal
// severity. While the lifecycle issue fell into the provider bucket it therefore
// DISPLACED a real provider fault from that tile's single detail line, hiding it.
test('a real provider fault keeps the Provider data detail line', () => {
  const providerFault = issue({
    code: 'provider-refresh-failed',
    severity: 'warning',
    subject: { axis: 'dataset', id: 'rankings' },
    title: 'rankings refresh failed',
  });
  const providerData = panel(
    baseInput({ issues: [LIFECYCLE_ISSUE, providerFault] }),
    'provider-data'
  );

  assert.equal(providerData.status, 'yellow');
  assert.equal(
    providerData.detail,
    'rankings refresh failed',
    'the provider tile reports the provider fault, not the lifecycle one'
  );
});

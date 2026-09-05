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
  type DatasetFreshness,
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

/**
 * A dataset freshness entry for the panel fold. `intentional` is false unless a
 * test is exercising the PLATFORM-090 expected-absence state, so the pre-existing
 * fold assertions keep their original meaning.
 */
function fresh(status: PanelStatus, intentional = false): DatasetFreshness {
  return { status, label: `${status} label`, intentional };
}

const ALL_GREEN: DatasetFreshness[] = PROVIDER_DATASETS.map(() => fresh('green'));

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
  const freshness: DatasetFreshness[] = [
    fresh('green'),
    fresh('green'),
    fresh('yellow'),
    fresh('green'),
    fresh('green'),
    fresh('green'),
  ];
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
      baseInput({
        datasetFreshness: [
          fresh('green'),
          fresh('green'),
          fresh('yellow'),
          fresh('green'),
          fresh('green'),
          fresh('green'),
        ],
      }),
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
    expectation: 'expected',
  });
  assert.deepEqual(f, { status: 'green', label: 'Current', intentional: false });
});

test('freshness: conferences available → green Available (availability-only)', () => {
  const f = deriveDatasetFreshness({
    dataset: 'conferences',
    cacheState: 'available',
    diagnosticsAvailable: true,
    diagnostics: [],
    expectation: 'expected',
  });
  assert.deepEqual(f, { status: 'green', label: 'Available', intentional: false });
});

test('freshness: a *-cache-stale warning → yellow Stale', () => {
  const f = deriveDatasetFreshness({
    dataset: 'rankings',
    cacheState: 'available',
    diagnosticsAvailable: true,
    diagnostics: [{ severity: 'warning', code: 'rankings-cache-stale' }],
    expectation: 'expected',
  });
  assert.deepEqual(f, { status: 'yellow', label: 'Stale', intentional: false });
});

test('freshness: a non-stale warning defect (identity mismatch) → yellow Attention, not Stale', () => {
  const f = deriveDatasetFreshness({
    dataset: 'game-stats',
    cacheState: 'available',
    diagnosticsAvailable: true,
    diagnostics: [{ severity: 'warning', code: 'game-stats-identity-mismatch' }],
    expectation: 'expected',
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
    expectation: 'expected',
  });
  assert.deepEqual(f, { status: 'gray', label: 'Unknown', intentional: false });
});

test('freshness: diagnostics subsystem unavailable → gray Unknown (even with cache present)', () => {
  const f = deriveDatasetFreshness({
    dataset: 'schedule',
    cacheState: 'available',
    diagnosticsAvailable: false,
    diagnostics: [],
    expectation: 'expected',
  });
  assert.deepEqual(f, { status: 'gray', label: 'Unknown', intentional: false });
});

test('freshness: an error diagnostic → red Missing', () => {
  const f = deriveDatasetFreshness({
    dataset: 'schedule',
    cacheState: 'absent',
    diagnosticsAvailable: true,
    diagnostics: [{ severity: 'error', code: 'schedule-cache-missing' }],
    expectation: 'expected',
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
    expectation: 'expected',
  });
  assert.deepEqual(f, { status: 'yellow', label: 'No cached data', intentional: false });
});

test('freshness: unknown cache + no diagnostics → gray Unknown', () => {
  const f = deriveDatasetFreshness({
    dataset: 'scores',
    cacheState: 'unknown',
    diagnosticsAvailable: true,
    diagnostics: [],
    expectation: 'expected',
  });
  assert.deepEqual(f, { status: 'gray', label: 'Unknown', intentional: false });
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

// ---------------------------------------------------------------------------
// PLATFORM-090 — expected absence is NEUTRAL; unexpected absence still warns.
//
// Game stats cannot exist before a stat-producing slate has been played, so in
// the preseason the dataset's cache is correctly absent, the canonical
// diagnostics correctly emit nothing, and the row nevertheless rendered a yellow
// "No cached data" that propagated into Provider data → Overall. These lock the
// distinction the fix introduces, in BOTH directions.
// ---------------------------------------------------------------------------

// REGRESSION TEST — pre-fix this branch returned `{ yellow, 'No cached data' }`
// for every absent cache regardless of expectation.
test('freshness: absent cache the lifecycle does NOT yet expect → gray None expected (intentional)', () => {
  const f = deriveDatasetFreshness({
    dataset: 'game-stats',
    cacheState: 'absent',
    diagnosticsAvailable: true,
    diagnostics: [],
    expectation: 'not-yet-expected',
  });
  assert.deepEqual(f, { status: 'gray', label: 'None expected', intentional: true });
  // Never green: green must keep meaning positive, present evidence.
  assert.notEqual(f.status, 'green');
});

test('freshness: absent cache whose expectation is UNKNOWN keeps the actionable warning', () => {
  const f = deriveDatasetFreshness({
    dataset: 'game-stats',
    cacheState: 'absent',
    diagnosticsAvailable: true,
    diagnostics: [],
    expectation: 'unknown',
  });
  assert.deepEqual(f, { status: 'yellow', label: 'No cached data', intentional: false });
});

test('freshness: an UNREADABLE cache is never reported as expected absence', () => {
  const f = deriveDatasetFreshness({
    dataset: 'game-stats',
    cacheState: 'unknown',
    diagnosticsAvailable: true,
    diagnostics: [],
    expectation: 'not-yet-expected',
  });
  assert.deepEqual(f, { status: 'gray', label: 'Unknown', intentional: false });
});

test('freshness: expectation never softens a diagnostic-derived state', () => {
  // An error outranks the absent-cache branch entirely...
  assert.deepEqual(
    deriveDatasetFreshness({
      dataset: 'game-stats',
      cacheState: 'absent',
      diagnosticsAvailable: true,
      diagnostics: [{ severity: 'error', code: 'schedule-cache-missing' }],
      expectation: 'not-yet-expected',
    }),
    { status: 'red', label: 'Missing', intentional: false }
  );
  // ...as does a warning.
  assert.deepEqual(
    deriveDatasetFreshness({
      dataset: 'game-stats',
      cacheState: 'absent',
      diagnosticsAvailable: true,
      diagnostics: [{ severity: 'warning', code: 'game-stats-record-unservable' }],
      expectation: 'not-yet-expected',
    }),
    { status: 'yellow', label: 'Attention', intentional: false }
  );
});

// REGRESSION TEST — pre-fix the fold mapped EVERY gray row to yellow, so an
// expected-absence row (had one existed) would still have degraded the panel.
test('provider-data panel: an INTENTIONAL gray row does not degrade the panel', () => {
  const freshness = [...ALL_GREEN];
  freshness[5] = { status: 'gray', label: 'None expected', intentional: true };
  const p = panel(baseInput({ datasetFreshness: freshness }), 'provider-data');
  assert.equal(p.status, 'green');
  assert.equal(p.stateLabel, 'Healthy');
});

test('provider-data panel: an UNKNOWN gray row still contributes yellow', () => {
  const freshness = [...ALL_GREEN];
  freshness[5] = { status: 'gray', label: 'Unknown', intentional: false };
  const p = panel(baseInput({ datasetFreshness: freshness }), 'provider-data');
  assert.equal(p.status, 'yellow');
  assert.equal(p.stateLabel, 'Attention needed');
});

test('overall: an intentional-gray dataset row alone leaves Overall healthy', () => {
  const freshness = [...ALL_GREEN];
  freshness[5] = { status: 'gray', label: 'None expected', intentional: true };
  const p = panel(baseInput({ datasetFreshness: freshness }), 'overall');
  assert.equal(p.status, 'green');
  assert.equal(p.stateLabel, 'Healthy');
});

test('overall: a genuine yellow elsewhere still dominates an intentional gray', () => {
  const freshness = [...ALL_GREEN];
  freshness[0] = fresh('yellow');
  freshness[5] = { status: 'gray', label: 'None expected', intentional: true };
  assert.equal(panel(baseInput({ datasetFreshness: freshness }), 'provider-data').status, 'yellow');
  assert.equal(panel(baseInput({ datasetFreshness: freshness }), 'overall').status, 'yellow');
});

// REGRESSION TEST (PLATFORM-090 review) — the first cut mapped an intentional
// gray to green for the fold and then reused the unqualified green detail, so
// the tile asserted "Canonical provider data is present and current." directly
// above a row whose cache is provably absent.
test('provider-data panel: a green panel with an awaiting row does not claim all data present', () => {
  const freshness = [...ALL_GREEN];
  freshness[5] = { status: 'gray', label: 'None expected', intentional: true };
  const p = panel(baseInput({ datasetFreshness: freshness }), 'provider-data');
  assert.equal(p.status, 'green');
  assert.equal(p.stateLabel, 'Healthy');
  assert.ok(
    !/present and current/.test(p.detail),
    'must not claim every dataset is present while one is absent'
  );
  assert.equal(p.detail, 'Canonical provider data is current, apart from data not expected yet.');
});

// The unqualified sentence must survive for the case it is actually true of.
test('provider-data panel: a fully green panel keeps the unqualified present-and-current detail', () => {
  const p = panel(baseInput(), 'provider-data');
  assert.equal(p.status, 'green');
  assert.equal(p.detail, 'Canonical provider data is present and current.');
});

// A governing issue still owns the detail line, awaiting row or not.
test('provider-data panel: a governing issue still owns the detail line over an awaiting row', () => {
  const freshness = [...ALL_GREEN];
  freshness[5] = { status: 'gray', label: 'None expected', intentional: true };
  const p = panel(
    baseInput({
      datasetFreshness: freshness,
      issues: [
        issue({
          code: 'provider-refresh-failed',
          severity: 'warning',
          subject: { axis: 'dataset', id: 'rankings' },
          title: 'rankings refresh failed',
        }),
      ],
    }),
    'provider-data'
  );
  assert.equal(p.detail, 'rankings refresh failed');
});

// --- Item 88: partition-scoped datasets (scores, game-stats) -----------------

const partitionBase = {
  dataset: 'scores' as const,
  cacheState: 'available' as const,
  diagnosticsAvailable: true,
  diagnostics: [],
  expectation: 'expected' as const,
};

test('Item 88: a STALLED partition dataset is never green, even with a full cache', () => {
  // The defect. Scores stay cached through a total polling outage, so the cache
  // branch returned green while live scoring was dead — the row could not go bad
  // at all. Its cached data is just what the last successful poll left behind.
  const f = deriveDatasetFreshness({
    ...partitionBase,
    partitionHealth: { state: 'stalled', staleSinceMs: null },
  });

  assert.equal(f.status, 'yellow');
  assert.equal(f.label, 'Refresh overdue');
});

test('Item 88: QUIET reads green — correctly knowing nothing is due is healthy', () => {
  // Owner ruling. For most of the year this is the Scores row's normal state, and
  // it is a working state rather than an absence of news.
  const f = deriveDatasetFreshness({
    ...partitionBase,
    partitionHealth: { state: 'quiet' },
  });

  assert.deepEqual(f, {
    status: 'green',
    label: 'Idle — no games in window',
    // `intentional: false` — the field's contract reserves it for grays, whose
    // rollup treatment depends on it. A green needs no such exemption.
    intentional: false,
  });
});

test('Item 88: QUIET with no cached data DEFERS to the PLATFORM-090 expectation', () => {
  // Two different questions. PLATFORM-090 asks "should this dataset have data by
  // now"; this asks "was a refresh due in the last few minutes". A game-stats
  // cache can be absent AND expected — games were played, stats should exist —
  // while the cron has no polling target because the window closed. Quiet must
  // not silence that.
  const stillExpected = deriveDatasetFreshness({
    ...partitionBase,
    cacheState: 'absent',
    expectation: 'expected',
    partitionHealth: { state: 'quiet' },
  });
  assert.deepEqual(stillExpected, {
    status: 'yellow',
    label: 'No cached data',
    intentional: false,
  });

  // And when the canonical authority agrees nothing is due yet, it stays gray.
  const notYet = deriveDatasetFreshness({
    ...partitionBase,
    cacheState: 'absent',
    expectation: 'not-yet-expected',
    partitionHealth: { state: 'quiet' },
  });
  assert.equal(notYet.status, 'gray');
  assert.equal(notYet.label, 'None expected');
});

test('Item 88: an INDETERMINATE scheduler yields Unknown, never green', () => {
  const f = deriveDatasetFreshness({
    ...partitionBase,
    partitionHealth: { state: 'indeterminate' },
  });

  assert.notEqual(f.status, 'green', 'the point: a silent scheduler cannot read healthy');
  assert.deepEqual(f, { status: 'gray', label: 'Unknown', intentional: false });
  // Distinguishable from the other gray: an idle window with no cache reads
  // "None expected", which is a different claim from "cannot tell".
});

test('Item 88: ACTIVE falls through to the ordinary cache branch', () => {
  // Positive control: the partition path must not hijack the normal case, or the
  // three assertions above would prove nothing about routing.
  const f = deriveDatasetFreshness({
    ...partitionBase,
    partitionHealth: { state: 'active', lastActivityAtMs: 0 },
  });

  assert.deepEqual(f, { status: 'green', label: 'Current', intentional: false });
});

test('Item 88: a dataset with NO partition health keeps its existing behaviour', () => {
  // Every other dataset passes nothing here, so this path must be inert for them.
  const withNull = deriveDatasetFreshness({ ...partitionBase, partitionHealth: null });
  const without = deriveDatasetFreshness(partitionBase);

  assert.deepEqual(withNull, { status: 'green', label: 'Current', intentional: false });
  assert.deepEqual(without, withNull);
});

test('Item 88: a real diagnostic still outranks partition health', () => {
  // Partition health softens or hardens the ABSENCE of a signal; it must never
  // suppress an error the diagnostics authority actually raised.
  const f = deriveDatasetFreshness({
    ...partitionBase,
    diagnostics: [{ dataset: 'scores', code: 'scores-cache-missing', severity: 'error' } as never],
    partitionHealth: { state: 'quiet' },
  });

  assert.equal(f.status, 'red', 'an error diagnostic wins over a quiet window');
});

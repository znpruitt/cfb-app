/**
 * PLATFORM-086F2F — orchestrator tests. Every external boundary is injected, so
 * the build performs no real I/O; the model is asserted for axis separation,
 * failure isolation, one-CFBD-observation discipline, and canary-free output.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSystemHealthViewModel, type SystemHealthLoaders } from '../systemHealth.ts';
import { readProviderRefreshHealth } from '../providerRefreshHealth.ts';
import { readSchedulerDeliveryHealth } from '../schedulerDeliveryHealth.ts';
import type { ProviderRefreshSettings } from '../providerRefreshSettings.ts';
import type { ProviderDataDiagnosticsResult } from '../providerDataDiagnostics.ts';
import type { CfbdUsage } from '../../api/cfbdUsage.ts';
import type { OddsUsageReadState } from '../oddsUsageStore.ts';
import type { AppStateStorageStatus } from '../appStateStore.ts';
import { PROVIDER_DATASETS, type ProviderDataset } from '../../providerDatasets.ts';
import { EXTERNAL_SCHEDULER_JOBS } from '../schedulerExecutionStatus.ts';
import {
  NOW,
  YEAR,
  allExpectations,
  healthyDelivery,
  refreshSnapshot,
} from './systemHealthFixtures.ts';

function healthySettings(): ProviderRefreshSettings {
  const datasets = {} as ProviderRefreshSettings['datasets'];
  for (const dataset of PROVIDER_DATASETS) datasets[dataset] = { enabled: true };
  return { globalPause: false, datasets };
}

function healthyDiagnostics(): ProviderDataDiagnosticsResult {
  return {
    year: YEAR,
    generatedAt: new Date(NOW).toISOString(),
    diagnostics: [],
    expectations: allExpectations(),
    scoreSeasonTypes: ['regular'],
  };
}

function healthyStorageStatus(): AppStateStorageStatus {
  return {
    mode: 'postgres',
    isProduction: false,
    databaseConfigured: true,
    filePath: '/tmp/app-state.json',
  };
}

function healthyCfbd(): CfbdUsage {
  return { patronLevel: 1, used: 100, remaining: 4900, limit: 5000 };
}

function healthyOdds(): OddsUsageReadState {
  return {
    state: 'available',
    snapshot: {
      used: 100,
      remaining: 400,
      lastCost: 3,
      limit: 500,
      capturedAt: new Date(NOW).toISOString(),
      source: 'odds-response-headers',
    },
  };
}

function healthyLoaders(
  overrides: Partial<SystemHealthLoaders> = {}
): Partial<SystemHealthLoaders> {
  return {
    storage: () => healthyStorageStatus(),
    schedulerDelivery: () => Promise.resolve(healthyDelivery()),
    automationSettings: () => Promise.resolve(healthySettings()),
    providerRefresh: () => Promise.resolve(refreshSnapshot()),
    cacheStates: () => Promise.resolve(allAvailable()),
    diagnostics: () => Promise.resolve(healthyDiagnostics()),
    cfbdUsage: () => Promise.resolve(healthyCfbd()),
    oddsUsage: () => Promise.resolve(healthyOdds()),
    ...overrides,
  };
}

function allAvailable() {
  const states = {} as Record<ProviderDataset, 'available'>;
  for (const dataset of PROVIDER_DATASETS) states[dataset] = 'available';
  return states;
}

// Case 1 — seven scheduler jobs + six datasets remain separate collections.
test('model exposes exactly seven scheduler jobs and six datasets', async () => {
  const model = await buildSystemHealthViewModel({
    year: YEAR,
    nowMs: NOW,
    loaders: healthyLoaders(),
  });
  assert.equal(model.schedulerJobs.length, 7);
  assert.equal(model.datasets.length, 6);
  assert.deepEqual(
    model.schedulerJobs.map((j) => j.job),
    [...EXTERNAL_SCHEDULER_JOBS]
  );
  assert.deepEqual(
    model.datasets.map((d) => d.dataset),
    [...PROVIDER_DATASETS]
  );
  assert.equal(model.overallState, 'healthy');
});

// Case 2 — Schedule has multiple related jobs and is not collapsed into one row.
test('schedule-refresh and season-transition are both jobs; schedule is one dataset', async () => {
  const model = await buildSystemHealthViewModel({
    year: YEAR,
    nowMs: NOW,
    loaders: healthyLoaders(),
  });
  const jobIds = model.schedulerJobs.map((j) => j.job);
  assert.ok(jobIds.includes('schedule-refresh'));
  assert.ok(jobIds.includes('season-transition'));
  assert.equal(model.datasets.filter((d) => d.dataset === 'schedule').length, 1);
});

// Case 23 — exactly one CFBD usage loader invocation per build.
test('CFBD usage loader is invoked exactly once per build', async () => {
  let calls = 0;
  const model = await buildSystemHealthViewModel({
    year: YEAR,
    nowMs: NOW,
    loaders: healthyLoaders({
      cfbdUsage: () => {
        calls += 1;
        return Promise.resolve(healthyCfbd());
      },
    }),
  });
  assert.equal(calls, 1);
  assert.equal(model.quota.cfbd.state, 'available');
});

// Case 7 — a scheduler scope-read failure yields seven unavailable rows + one global issue.
test('scheduler scope-read failure → seven unavailable rows, one global issue', async () => {
  const model = await buildSystemHealthViewModel({
    year: YEAR,
    nowMs: NOW,
    loaders: healthyLoaders({
      schedulerDelivery: () =>
        readSchedulerDeliveryHealth({
          nowMs: NOW,
          loadEntries: () => Promise.reject(new Error('scope boom')),
        }),
    }),
  });
  assert.equal(model.schedulerJobs.length, 7);
  assert.ok(model.schedulerJobs.every((j) => j.deliveryState === 'unavailable'));
  const global = model.issues.filter((i) => i.code === 'scheduler-delivery-unavailable');
  assert.equal(global.length, 1);
  assert.equal(global[0].subject.axis, 'global');
});

// Case 12 — provider-status scope-read failure degrades without throwing the model.
test('provider-status scope-read failure → unavailable facts, six datasets, model still builds', async () => {
  const model = await buildSystemHealthViewModel({
    year: YEAR,
    nowMs: NOW,
    loaders: healthyLoaders({
      providerRefresh: () =>
        readProviderRefreshHealth({
          year: YEAR,
          loadEntries: () => Promise.reject(new Error('scope boom')),
        }),
    }),
  });
  assert.equal(model.datasets.length, 6);
  assert.ok(model.datasets.every((d) => d.canonicalStatus.state === 'unavailable'));
  assert.equal(model.issues.filter((i) => i.code === 'provider-status-unavailable').length, 1);
});

// Case 21 — a settings read failure never fabricates open gates.
test('settings loader failure → automation unavailable, no fabricated gates', async () => {
  const model = await buildSystemHealthViewModel({
    year: YEAR,
    nowMs: NOW,
    loaders: healthyLoaders({
      automationSettings: () => Promise.reject(new Error('settings boom')),
    }),
  });
  assert.equal(model.automation.state, 'unavailable');
  assert.ok(model.issues.some((i) => i.code === 'automation-settings-unavailable'));
  assert.ok(!model.issues.some((i) => i.code === 'automation-global-pause-active'));
});

// Case 26 — odds usage absent vs unavailable stay distinct at the model level.
test('odds usage absent and unavailable map to distinct quota facts', async () => {
  const absent = await buildSystemHealthViewModel({
    year: YEAR,
    nowMs: NOW,
    loaders: healthyLoaders({ oddsUsage: () => Promise.resolve({ state: 'absent' }) }),
  });
  assert.equal(absent.quota.odds.state, 'absent');

  const unavailable = await buildSystemHealthViewModel({
    year: YEAR,
    nowMs: NOW,
    loaders: healthyLoaders({
      oddsUsage: () => Promise.resolve({ state: 'unavailable', error: 'boom' }),
    }),
  });
  assert.equal(unavailable.quota.odds.state, 'unavailable');
});

// Finding 2 — a malformed durable Odds snapshot is treated as unavailable, and its
// raw non-numeric fields never serialize into the model.
test('a malformed durable Odds snapshot → quota unavailable, raw value not serialized', async () => {
  const model = await buildSystemHealthViewModel({
    year: YEAR,
    nowMs: NOW,
    loaders: healthyLoaders({
      oddsUsage: () =>
        Promise.resolve({
          state: 'available',
          // A legacy/corrupt snapshot: `remaining` is a raw string, not a number.
          snapshot: {
            used: 100,
            remaining: 'CORRUPT_REMAINING' as unknown as number,
            lastCost: 3,
            limit: 500,
            capturedAt: new Date(NOW).toISOString(),
            source: 'odds-response-headers',
          },
        }),
    }),
  });
  assert.equal(model.quota.odds.state, 'unavailable');
  assert.ok(!JSON.stringify(model).includes('CORRUPT_REMAINING'));
});

// Codex r2 Finding — an impossible Odds balance (remaining exceeds limit) → unavailable.
test('an impossible Odds balance (remaining exceeds limit) → quota unavailable', async () => {
  const model = await buildSystemHealthViewModel({
    year: YEAR,
    nowMs: NOW,
    loaders: healthyLoaders({
      oddsUsage: () =>
        Promise.resolve({
          state: 'available',
          snapshot: {
            used: 100,
            remaining: 1_000_000,
            lastCost: 3,
            limit: 500,
            capturedAt: new Date(NOW).toISOString(),
            source: 'odds-response-headers',
          },
        }),
    }),
  });
  assert.equal(model.quota.odds.state, 'unavailable');
});

// r3 Finding — an internally inconsistent Odds balance (over-count) → unavailable.
test('an over-counting Odds balance (used + remaining exceeds limit) → quota unavailable', async () => {
  const model = await buildSystemHealthViewModel({
    year: YEAR,
    nowMs: NOW,
    loaders: healthyLoaders({
      oddsUsage: () =>
        Promise.resolve({
          state: 'available',
          snapshot: {
            used: 400,
            remaining: 400, // 400 + 400 = 800 > 500
            lastCost: 3,
            limit: 500,
            capturedAt: new Date(NOW).toISOString(),
            source: 'odds-response-headers',
          },
        }),
    }),
  });
  assert.equal(model.quota.odds.state, 'unavailable');
});

// r3 Finding — the Odds observation timestamp is preserved (provenance for staleness).
test('the Odds quota fact preserves a validated capturedAt', async () => {
  const captured = '2026-10-15T11:30:00.000Z';
  const model = await buildSystemHealthViewModel({
    year: YEAR,
    nowMs: NOW,
    loaders: healthyLoaders({
      oddsUsage: () =>
        Promise.resolve({
          state: 'available',
          snapshot: {
            used: 100,
            remaining: 400,
            lastCost: 3,
            limit: 500,
            capturedAt: captured,
            source: 'odds-response-headers',
          },
        }),
    }),
  });
  assert.equal(model.quota.odds.state, 'available');
  assert.equal(
    model.quota.odds.state === 'available' ? model.quota.odds.capturedAt : 'MISSING',
    captured
  );
});

// Finding 3 — a rejected diagnostics loader surfaces a global issue (not silent-healthy).
test('a diagnostics loader failure surfaces a global data-diagnostics-unavailable issue', async () => {
  const model = await buildSystemHealthViewModel({
    year: YEAR,
    nowMs: NOW,
    loaders: healthyLoaders({ diagnostics: () => Promise.reject(new Error('diag boom')) }),
  });
  assert.ok(model.issues.some((i) => i.code === 'data-diagnostics-unavailable'));
  assert.equal(model.overallState, 'degraded');
});

// Case 31 — one failed subsystem still returns truthful results from the rest.
test('one failed subsystem does not erase truthful results from the others', async () => {
  const model = await buildSystemHealthViewModel({
    year: YEAR,
    nowMs: NOW,
    loaders: healthyLoaders({ cfbdUsage: () => Promise.reject(new Error('cfbd boom')) }),
  });
  assert.equal(model.quota.cfbd.state, 'unavailable');
  // Everything else stays truthful.
  assert.equal(model.schedulerJobs.length, 7);
  assert.ok(model.schedulerJobs.every((j) => j.deliveryState === 'on-time'));
  assert.equal(model.storage.state, 'available');
  assert.equal(model.automation.state, 'available');
  assert.equal(model.quota.odds.state, 'available');
});

// Case 30 — no raw error / credential / path / provider-payload canary escapes.
test('raw error, source, and filesystem-path canaries never appear in the model', async () => {
  const CANARY = 'DO_NOT_LEAK_CANARY';
  const model = await buildSystemHealthViewModel({
    year: YEAR,
    nowMs: NOW,
    loaders: healthyLoaders({
      // A valid provider-refresh record whose lastError.message + source carry canaries.
      providerRefresh: () =>
        readProviderRefreshHealth({
          year: YEAR,
          loadEntries: () =>
            Promise.resolve([
              {
                key: 'scores:year:2026',
                value: {
                  dataset: 'scores',
                  scope: { kind: 'year', year: 2026 },
                  scopeKey: 'scores:year:2026',
                  lastAttemptAt: new Date(NOW - 1000).toISOString(),
                  lastAttemptId: 'attempt-1',
                  latestAttemptOutcome: 'failed',
                  latestAttemptResolvedAt: new Date(NOW).toISOString(),
                  lastSuccessAt: null,
                  lastError: { message: `err-${CANARY}`, code: 'RATE_LIMIT', status: 429 },
                  source: `src-${CANARY}`,
                  rowsCommitted: 0,
                  partialFailure: false,
                },
                updatedAt: new Date(NOW).toISOString(),
              },
            ]),
        }),
      // Storage filePath carries a canary; the fact drops the path entirely.
      storage: () => ({
        mode: 'file-fallback',
        isProduction: false,
        databaseConfigured: false,
        filePath: `/private/${CANARY}/app-state.json`,
      }),
      // A diagnostic message carries a canary; the safe diagnostic drops the message.
      diagnostics: () =>
        Promise.resolve({
          year: YEAR,
          generatedAt: new Date(NOW).toISOString(),
          diagnostics: [
            {
              dataset: 'schedule',
              severity: 'warning',
              code: 'schedule-diagnostics-unavailable',
              message: `diag-${CANARY}`,
              repair: null,
            },
          ],
          expectations: allExpectations(),
          scoreSeasonTypes: [],
        }),
      // A thrown error whose message carries a canary is discarded by the settle wrapper.
      cfbdUsage: () => {
        throw new Error(`thrown-${CANARY}`);
      },
    }),
  });

  const serialized = JSON.stringify(model);
  assert.ok(!serialized.includes(CANARY), 'no canary string leaked into the serialized model');
  // Sanity: the safe error code (not the message) IS retained.
  const scores = model.datasets.find((d) => d.dataset === 'scores');
  assert.equal(
    scores?.canonicalStatus.state === 'available' ? scores.canonicalStatus.status.errorCode : null,
    'RATE_LIMIT'
  );
});

// r4 Finding — CFBD health matches the ACTUAL automation gate, not normalizeProviderQuota.
test('CFBD health: integer remaining with no patronLevel is not flagged untrustworthy/reserve', async () => {
  const model = await buildSystemHealthViewModel({
    year: YEAR,
    nowMs: NOW,
    loaders: healthyLoaders({
      cfbdUsage: () =>
        Promise.resolve({ patronLevel: null, used: null, remaining: 3000, limit: null }),
    }),
  });
  assert.equal(model.quota.cfbd.state, 'available');
  // The gate allows 3000 ≥ 1007 (no limit needed), so no fault issue is emitted.
  assert.ok(!model.issues.some((i) => i.code === 'cfbd-quota-untrustworthy'));
  assert.ok(!model.issues.some((i) => i.code === 'cfbd-automation-reserve-reached'));
});

test('CFBD health: a fractional remaining is untrustworthy (matches the gate)', async () => {
  const model = await buildSystemHealthViewModel({
    year: YEAR,
    nowMs: NOW,
    loaders: healthyLoaders({
      cfbdUsage: () =>
        Promise.resolve({ patronLevel: 1, used: null, remaining: 1500.5, limit: 5000 }),
    }),
  });
  assert.ok(model.issues.some((i) => i.code === 'cfbd-quota-untrustworthy'));
});

// r4 Finding — a malformed Odds capturedAt is dropped, never serialized.
test('a malformed Odds capturedAt is dropped (not serialized)', async () => {
  const model = await buildSystemHealthViewModel({
    year: YEAR,
    nowMs: NOW,
    loaders: healthyLoaders({
      oddsUsage: () =>
        Promise.resolve({
          state: 'available',
          snapshot: {
            used: 100,
            remaining: 400,
            lastCost: 3,
            limit: 500,
            capturedAt: '2026-10-15 (/private/tmp)',
            source: 'odds-response-headers',
          },
        }),
    }),
  });
  assert.equal(model.quota.odds.state, 'available');
  assert.equal(model.quota.odds.state === 'available' ? model.quota.odds.capturedAt : 'x', null);
  assert.ok(!JSON.stringify(model).includes('/private/tmp'));
});

// Case 32 — the build performs no internal HTTP request (and no write path is invoked).
test('the model build issues no internal HTTP request', async () => {
  const originalFetch = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = (async () => {
    fetched += 1;
    throw new Error('fetch must not be called');
  }) as typeof fetch;
  try {
    await buildSystemHealthViewModel({ year: YEAR, nowMs: NOW, loaders: healthyLoaders() });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(fetched, 0);
});

// Year validation is explicit; never derived from wall-clock or leagues.
test('an invalid year is rejected', async () => {
  await assert.rejects(
    () => buildSystemHealthViewModel({ year: 1999, nowMs: NOW, loaders: healthyLoaders() }),
    /invalid season year/
  );
  await assert.rejects(
    () => buildSystemHealthViewModel({ year: Number.NaN, nowMs: NOW, loaders: healthyLoaders() }),
    /invalid season year/
  );
});

// generatedAt derives from the single injected nowMs (never the wall-clock).
test('generatedAt reflects the injected nowMs', async () => {
  const model = await buildSystemHealthViewModel({
    year: YEAR,
    nowMs: NOW,
    loaders: healthyLoaders(),
  });
  assert.equal(model.generatedAt, new Date(NOW).toISOString());
  assert.equal(model.year, YEAR);
});

// ---------------------------------------------------------------------------
// PLATFORM-090 — end-to-end: the REPORTED preseason state must not read as
// degraded.
//
// That reported state, exactly: game-stats cache absent (correctly — no slate
// has been played), no game-stats diagnostic, and every OTHER provider cache
// populated. The row nevertheless rendered yellow "No cached data" and dragged
// Provider data and Overall to "Attention needed".
//
// SCOPE, stated precisely (review finding): this is not a claim that any cold
// preseason renders green. On a deployment where `scores`, `odds`, or
// `rankings` are also uncached, those rows are still yellow "No cached data" —
// their absence diagnostics are `info` (or gated on a completed slate), which
// the freshness stoplight does not consult — and the panels degrade again.
// Giving them their own applicability authority is the tracked follow-up
// recorded in `providerDataDiagnostics.ts`; this fixture holds them `available`
// deliberately, to isolate the game-stats axis rather than to assert that case.
// ---------------------------------------------------------------------------

function cacheStatesWith(overrides: Partial<Record<ProviderDataset, 'available' | 'absent'>>) {
  return { ...allAvailable(), ...overrides };
}

function panelOf(model: Awaited<ReturnType<typeof buildSystemHealthViewModel>>, key: string) {
  const p = model.panels.find((x) => x.key === key);
  assert.ok(p, `expected panel ${key}`);
  return p!;
}

// REGRESSION TEST — pre-fix this produced a yellow game-stats row, a yellow
// Provider data panel, and a yellow Overall panel.
test('PLATFORM-090: expected preseason game-stats absence is neutral end to end', async () => {
  const model = await buildSystemHealthViewModel({
    year: YEAR,
    nowMs: NOW,
    loaders: healthyLoaders({
      cacheStates: () => Promise.resolve(cacheStatesWith({ 'game-stats': 'absent' })),
      diagnostics: () =>
        Promise.resolve({
          ...healthyDiagnostics(),
          expectations: allExpectations('expected', { 'game-stats': 'not-yet-expected' }),
        }),
    }),
  });

  const row = model.datasets.find((d) => d.dataset === 'game-stats')!;
  assert.equal(row.cacheState, 'absent');
  assert.deepEqual(row.diagnostics, [], 'no diagnostic requires action');
  assert.deepEqual(row.freshness, {
    status: 'gray',
    label: 'Awaiting games',
    intentional: true,
  });
  assert.equal(panelOf(model, 'provider-data').status, 'green');
  assert.equal(panelOf(model, 'provider-data').stateLabel, 'Healthy');
  // Green must not assert that data is PRESENT while this cache is absent.
  assert.ok(
    !/present and current/.test(panelOf(model, 'provider-data').detail),
    'the green provider tile must account for the expected absence'
  );
  assert.equal(panelOf(model, 'overall').status, 'green');
  assert.equal(panelOf(model, 'overall').stateLabel, 'Healthy');
  assert.equal(model.overallState, 'healthy');
});

test('PLATFORM-090: once evidence IS expected, an absent game-stats cache still warns', async () => {
  const model = await buildSystemHealthViewModel({
    year: YEAR,
    nowMs: NOW,
    loaders: healthyLoaders({
      cacheStates: () => Promise.resolve(cacheStatesWith({ 'game-stats': 'absent' })),
      diagnostics: () =>
        Promise.resolve({
          ...healthyDiagnostics(),
          expectations: allExpectations('expected'),
        }),
    }),
  });

  const row = model.datasets.find((d) => d.dataset === 'game-stats')!;
  assert.deepEqual(row.freshness, {
    status: 'yellow',
    label: 'No cached data',
    intentional: false,
  });
  assert.equal(panelOf(model, 'provider-data').status, 'yellow');
  assert.equal(panelOf(model, 'provider-data').stateLabel, 'Attention needed');
  assert.equal(panelOf(model, 'overall').status, 'yellow');
  assert.equal(panelOf(model, 'overall').stateLabel, 'Attention needed');
});

// CONTRACT PIN (not a regression test for the expectation fallback) — review
// mutation-proved that this scenario is decided by the `diagnosticsAvailable`
// short-circuit, NOT by `unknownProviderDataExpectations()`: replacing that
// helper's return with all-`not-yet-expected` leaves this assertion green. What
// it truthfully pins is that a failed diagnostics pass still yields a
// non-intentional Unknown row, whichever of the two guards gets there first.
test('PLATFORM-090: a diagnostics-pass failure yields a non-intentional Unknown row', async () => {
  const model = await buildSystemHealthViewModel({
    year: YEAR,
    nowMs: NOW,
    loaders: healthyLoaders({
      cacheStates: () => Promise.resolve(cacheStatesWith({ 'game-stats': 'absent' })),
      diagnostics: () => Promise.reject(new Error('diagnostics boom')),
    }),
  });

  const row = model.datasets.find((d) => d.dataset === 'game-stats')!;
  assert.equal(row.freshness.intentional, false);
  assert.equal(row.freshness.status, 'gray');
  assert.equal(row.freshness.label, 'Unknown');
});

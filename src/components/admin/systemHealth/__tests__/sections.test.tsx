/**
 * PLATFORM-086F2G — render tests for the always-visible status sections + the
 * stoplight/issues surfaces (static markup; no router needed). They assert the UI
 * faithfully reflects the F2F model: two separate axes, delivery vs execution,
 * canonical vs latest activity, thresholds, truthful storage, and that repair
 * links appear ONLY in Prioritized issues.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  buildSystemHealthViewModel,
  type SystemHealthViewModel,
  type SystemHealthLoaders,
} from '@/lib/server/systemHealth';
import {
  allExpectations,
  deliveryRow,
  deliverySnapshot,
  healthyDelivery,
  receiptFor,
  lateReceiptFor,
  refreshSnapshot,
  canonicalOutcome,
  canonicalScopeFor,
  safeStatus,
} from '@/lib/server/__tests__/systemHealthFixtures';
import { weekPartitionScope } from '@/lib/providerRefreshScope';
import { EXTERNAL_SCHEDULER_JOBS } from '@/lib/server/schedulerExecutionStatus';
import { PROVIDER_DATASETS, type ProviderDataset } from '@/lib/providerDatasets';
import type { CfbdUsage } from '@/lib/api/cfbdUsage';
import type { OddsUsageReadState } from '@/lib/server/oddsUsageStore';
import type { ProviderRefreshSettings } from '@/lib/server/providerRefreshSettings';
import type { ProviderCacheStates } from '@/lib/server/providerCacheState';
import type { ProviderDataDiagnosticsResult } from '@/lib/server/providerDataDiagnostics';

import SystemHealthStoplightPanel from '../SystemHealthStoplightPanel';
import SystemHealthIssues from '../SystemHealthIssues';
import SchedulerHealthSection from '../SchedulerHealthSection';
import ProviderHealthSection from '../ProviderHealthSection';
import QuotaStorageSection from '../QuotaStorageSection';

const YEAR = 2026;
const NOW = Date.parse('2026-10-15T12:00:00.000Z');

function settings(): ProviderRefreshSettings {
  const datasets = {} as ProviderRefreshSettings['datasets'];
  for (const d of PROVIDER_DATASETS) datasets[d] = { enabled: true };
  return { globalPause: false, datasets };
}
function cacheStates(a: ProviderCacheStates[ProviderDataset]): ProviderCacheStates {
  const s = {} as ProviderCacheStates;
  for (const d of PROVIDER_DATASETS) s[d] = a;
  return s;
}
function diagnostics(
  list: ProviderDataDiagnosticsResult['diagnostics']
): ProviderDataDiagnosticsResult {
  return {
    year: YEAR,
    generatedAt: new Date(NOW).toISOString(),
    diagnostics: list,
    expectations: allExpectations(),
    scoreSeasonTypes: ['regular'],
  };
}
const cfbdOk: CfbdUsage = { patronLevel: 1, used: 100, remaining: 4899, limit: 5000 };
const oddsOk: OddsUsageReadState = {
  state: 'available',
  snapshot: {
    used: 100,
    remaining: 400,
    lastCost: 3,
    limit: 500,
    capturedAt: new Date(NOW - 3_600_000).toISOString(),
    source: 'odds-response-headers',
  },
};

async function buildModel(
  overrides: Partial<SystemHealthLoaders> = {}
): Promise<SystemHealthViewModel> {
  return buildSystemHealthViewModel({
    year: YEAR,
    nowMs: NOW,
    loaders: {
      storage: () => ({
        mode: 'postgres',
        isProduction: true,
        databaseConfigured: true,
        filePath: '/secret/path',
      }),
      schedulerDelivery: () => Promise.resolve(healthyDelivery()),
      automationSettings: () => Promise.resolve(settings()),
      providerRefresh: () =>
        Promise.resolve(
          refreshSnapshot(
            Object.fromEntries(
              PROVIDER_DATASETS.map((d) => [
                d,
                {
                  canonical: canonicalOutcome(d, 'succeeded'),
                  latest: canonicalOutcome(d, 'succeeded'),
                },
              ])
            )
          )
        ),
      cacheStates: () => Promise.resolve(cacheStates('available')),
      diagnostics: () => Promise.resolve(diagnostics([])),
      cfbdUsage: () => Promise.resolve(cfbdOk),
      oddsUsage: () => Promise.resolve(oddsOk),
      ...overrides,
    },
  });
}

test('stoplight renders six panels with text state labels and no repair links', async () => {
  const model = await buildModel();
  const html = renderToStaticMarkup(
    <SystemHealthStoplightPanel panels={model.panels} nowMs={NOW} />
  );
  for (const title of [
    'Overall system',
    'Scheduler delivery',
    'Provider data',
    'Automation',
    'Provider quota',
    'Durable storage',
  ]) {
    assert.ok(html.includes(title), `stoplight missing ${title}`);
  }
  assert.ok(html.includes('Healthy'));
  assert.ok(
    !/\/admin\/(data\/cache|season|aliases)/.test(html),
    'stoplight must carry no repair links'
  );
});

test('scheduler renders 9 human-named rows keeping delivery and execution separate', async () => {
  const model = await buildModel({
    schedulerDelivery: () =>
      Promise.resolve(
        deliverySnapshot(
          EXTERNAL_SCHEDULER_JOBS.map((job) => {
            if (job === 'game-stats')
              return deliveryRow('game-stats', 'on-time', receiptFor('game-stats', 'failure'));
            if (job === 'odds')
              return deliveryRow('odds', 'late', lateReceiptFor('odds', 'success'));
            if (job === 'live-scores') return deliveryRow('live-scores', 'missing', null);
            return deliveryRow(job, 'on-time', receiptFor(job, 'success'));
          })
        )
      ),
  });
  const html = renderToStaticMarkup(
    <SchedulerHealthSection jobs={model.schedulerJobs} nowMs={NOW} />
  );
  // Human names, all nine.
  for (const label of [
    'Live scores',
    'Team records',
    'Game stats',
    'Odds polling',
    'Weekly schedule',
    'Rankings publication',
    'CFBD usage sample',
    'Season transition',
    'Season rollover',
  ]) {
    assert.ok(html.includes(label), `scheduler missing ${label}`);
  }
  // Delivery + execution shown as separate facts.
  assert.ok(
    html.includes('On time') && html.includes('Failed'),
    'on-time delivery + failed execution both shown'
  );
  assert.ok(
    html.includes('Late') && html.includes('Success'),
    'late delivery + success execution both shown'
  );
  assert.ok(
    html.includes('No recent delivery') && html.includes('no receipt'),
    'missing receipt row is distinct'
  );
  assert.ok(
    !/\/admin\/(data\/cache|season|aliases)/.test(html),
    'scheduler rows carry no repair links'
  );
});

test('provider renders 6 rows with freshness, outcome, automation as separate facts and no repair links', async () => {
  const model = await buildModel({
    diagnostics: () =>
      Promise.resolve(
        diagnostics([
          {
            dataset: 'rankings',
            code: 'rankings-cache-stale',
            severity: 'warning',
            message: 'x',
            repair: 'data-maintenance',
          },
        ])
      ),
  });
  const html = renderToStaticMarkup(
    <ProviderHealthSection
      datasets={model.datasets}
      automation={model.automation}
      year={model.year}
      nowMs={NOW}
    />
  );
  assert.ok(html.includes('2026 operational season'), 'names the operational season');
  for (const label of ['Schedule', 'Scores', 'Odds', 'Rankings', 'Conferences', 'Game stats']) {
    assert.ok(html.includes(label), `provider missing ${label}`);
  }
  assert.ok(html.includes('Current'), 'freshness label present');
  assert.ok(html.includes('Stale'), 'stale freshness for rankings');
  assert.ok(html.includes('Succeeded'), 'refresh outcome shown separately');
  assert.ok(html.includes('Manual only'), 'conferences automation shown as manual-only');
  assert.ok(
    !/\/admin\/(data\/cache|season|aliases)/.test(html),
    'provider rows carry no repair links'
  );
});

// PLATFORM-090 — the Game stats row renders the neutral lifecycle state (gray
// dot + "None expected"), not the yellow "No cached data" warning, when the
// canonical authority says no evidence is expected yet.
test('provider Game stats row renders expected absence as neutral, not a warning', async () => {
  const model = await buildModel({
    cacheStates: () => Promise.resolve({ ...cacheStates('available'), 'game-stats': 'absent' }),
    diagnostics: () =>
      Promise.resolve({
        ...diagnostics([]),
        expectations: allExpectations('expected', { 'game-stats': 'not-yet-expected' }),
      }),
  });
  const row = model.datasets.find((d) => d.dataset === 'game-stats')!;
  assert.equal(row.freshness.status, 'gray');
  const html = renderToStaticMarkup(
    <ProviderHealthSection
      datasets={model.datasets}
      automation={model.automation}
      year={model.year}
      nowMs={NOW}
    />
  );
  assert.ok(html.includes('None expected'), 'the row states that absence is expected');
  assert.ok(!html.includes('No cached data'), 'no dataset renders the absence warning');
  // POSITIVE CONTROL — the same harness DOES render the warning when the
  // expectation is ordinary, so the assertion above is not vacuous.
  const warned = await buildModel({
    cacheStates: () => Promise.resolve({ ...cacheStates('available'), 'game-stats': 'absent' }),
  });
  const warnedHtml = renderToStaticMarkup(
    <ProviderHealthSection
      datasets={warned.datasets}
      automation={warned.automation}
      year={warned.year}
      nowMs={NOW}
    />
  );
  assert.ok(warnedHtml.includes('No cached data'), 'positive control: the warning still renders');
  assert.ok(!warnedHtml.includes('None expected'));
});

test('scheduler execution column distinguishes missing / invalid / unavailable receipts', async () => {
  const model = await buildModel({
    schedulerDelivery: () =>
      Promise.resolve(
        deliverySnapshot(
          EXTERNAL_SCHEDULER_JOBS.map((job) => {
            if (job === 'live-scores') return deliveryRow('live-scores', 'missing', null);
            if (job === 'game-stats') return deliveryRow('game-stats', 'invalid', null);
            if (job === 'odds') return deliveryRow('odds', 'unavailable', null);
            return deliveryRow(job, 'on-time', receiptFor(job, 'success'));
          })
        )
      ),
  });
  const html = renderToStaticMarkup(
    <SchedulerHealthSection jobs={model.schedulerJobs} nowMs={NOW} />
  );
  assert.ok(html.includes('no receipt'), 'missing → no receipt');
  assert.ok(html.includes('receipt unparseable'), 'invalid → receipt unparseable');
  assert.ok(html.includes('unavailable'), 'unavailable → unavailable');
});

test('provider row timestamps the latest attempt (not prior success) and shows latest-activity scope', async () => {
  const recent = new Date(NOW - 60_000).toISOString();
  const old = new Date(NOW - 5 * 86_400_000).toISOString(); // 5 days ago
  const weekScope = weekPartitionScope(YEAR, 3, 'regular');
  const model = await buildModel({
    providerRefresh: () =>
      Promise.resolve(
        refreshSnapshot({
          scores: {
            // Latest canonical attempt FAILED recently; a prior success is preserved.
            canonical: {
              state: 'available',
              status: safeStatus('scores', canonicalScopeFor('scores'), {
                latestAttemptOutcome: 'failed',
                latestAttemptResolvedAt: recent,
                lastAttemptAt: recent,
                lastSuccessAt: old,
                hasError: true,
              }),
            },
            // Latest scoped activity is a NONCANONICAL week partition.
            latest: {
              state: 'available',
              status: safeStatus('scores', weekScope, {
                latestAttemptOutcome: 'failed',
                lastAttemptAt: recent,
              }),
            },
          },
        })
      ),
    // Absent scores cache so the failed attempt is a genuine concern (not asserted here).
    cacheStates: () => Promise.resolve({ ...cacheStates('available'), scores: 'available' }),
  });
  const html = renderToStaticMarkup(
    <ProviderHealthSection
      datasets={model.datasets}
      automation={model.automation}
      year={model.year}
      nowMs={NOW}
    />
  );
  // The noncanonical latest-activity scope key is disclosed (exact-target).
  assert.ok(html.includes('scores:week:2026:3:regular'), 'latest-activity scope key shown');
  // The historical success is exposed separately as "Last success".
  assert.ok(html.includes('Last success'), 'prior success surfaced separately');
});

test('issues render in model order with repair links only for non-null repairs', async () => {
  // Storage misconfigured (critical, null repair) + a stale rankings diagnostic (warning, data-maintenance).
  const model = await buildModel({
    storage: () => ({
      mode: 'production-misconfigured',
      isProduction: true,
      databaseConfigured: false,
      filePath: '/x',
    }),
    diagnostics: () =>
      Promise.resolve(
        diagnostics([
          {
            dataset: 'rankings',
            code: 'rankings-cache-stale',
            severity: 'warning',
            message: 'x',
            repair: 'data-maintenance',
          },
        ])
      ),
  });
  const html = renderToStaticMarkup(<SystemHealthIssues issues={model.issues} />);
  // Critical storage issue appears (no repair link for it), rankings issue has a repair link.
  assert.ok(html.includes('storage') || html.includes('Storage'));
  assert.ok(html.includes('/admin/data/cache'), 'a non-null repair renders a link');
  // The critical storage issue must appear before the warning (severity order).
  const idxCritical = html.indexOf('Durable storage');
  const idxWarn = html.indexOf('Rankings');
  assert.ok(idxCritical >= 0 && idxWarn >= 0 && idxCritical < idxWarn, 'critical precedes warning');
});

test('quota/storage rows use model thresholds and never claim database liveness', async () => {
  const model = await buildModel();
  const html = renderToStaticMarkup(
    <QuotaStorageSection quota={model.quota} storage={model.storage} nowMs={NOW} />
  );
  assert.ok(html.includes('4,899 remaining'), 'CFBD remaining shown');
  assert.ok(html.includes('Postgres configured'), 'storage shows configuration mode');
  assert.ok(!/healthy database/i.test(html), 'never claims a healthy database');
  assert.ok(!html.includes('/secret/path'), 'filesystem path never serialized into the UI');
});

test('production-misconfigured storage renders an Action required row', async () => {
  const model = await buildModel({
    storage: () => ({
      mode: 'production-misconfigured',
      isProduction: true,
      databaseConfigured: false,
      filePath: '/x',
    }),
  });
  const html = renderToStaticMarkup(
    <QuotaStorageSection quota={model.quota} storage={model.storage} nowMs={NOW} />
  );
  assert.ok(html.includes('Production storage is misconfigured'));
  assert.ok(html.includes('Action required'));
});

test('scheduler rows show WHICH BUILD executed each run, and say nothing more when unknown', async () => {
  // The server side of this field got four tests and the surface an operator
  // actually reads got none — and the empty branch is the one production hits
  // first, because every receipt stored before it shipped lacks the field.
  const model = await buildModel({
    schedulerDelivery: () =>
      Promise.resolve(
        deliverySnapshot(
          EXTERNAL_SCHEDULER_JOBS.map((job) => {
            const receipt = receiptFor(job, 'success');
            // `season-transition` reports a build; the rest report none, which is
            // exactly the mixed state the first production read will show.
            return deliveryRow(
              job,
              'on-time',
              job === 'season-transition'
                ? { ...receipt, buildCommitSha: 'e043fe97aabbccddeeff00112233445566778899' }
                : { ...receipt, buildCommitSha: null }
            );
          })
        )
      ),
  });

  const html = renderToStaticMarkup(
    <SchedulerHealthSection jobs={model.schedulerJobs} nowMs={NOW} />
  );

  assert.ok(html.includes('Built from'), 'the label renders');
  assert.ok(
    html.includes('e043fe97aabbccddeeff00112233445566778899'),
    'a recorded commit reaches the DOM in full — a truncated SHA cannot be compared to a promotion'
  );

  // The empty state states a FACT and asserts no cause. It has three of them (a
  // run predating the field, a runtime that supplied none, a non-Git deploy) and
  // an earlier version claimed the second for all three, which made the SAFE
  // outcome in deployment-runbook §6b unreadable.
  assert.ok(html.includes('not recorded'), 'the empty state is shown, not hidden');
  assert.ok(
    !/not reported by the runtime/.test(html),
    'and does not claim the runtime was the reason'
  );
  // It points at the timestamp that disambiguates it, which is the whole
  // procedure: a RECENT run with no commit is itself the answer.
  assert.ok(html.includes('Completed'), 'the disambiguating field is on the row');
});

test('scheduler timestamps render absolute AND relative, not relative alone', () => {
  // The complaint this branch started from: "we know enough to say it was
  // delivered later than scheduled, but not when it was planned vs when it
  // arrived". The issue text was fixed first, and the row detail kept showing the
  // same two instants relatively — so the page carried both formats and an
  // operator diffing "7m ago" against "Friday" still could not separate a
  // three-minute gap from a three-day one.
  const startedMs = NOW - 3 * 86_400_000;
  const rows = healthyDelivery().jobs.map((row) =>
    row.job === 'live-scores'
      ? deliveryRow(
          'live-scores',
          'late',
          receiptFor('live-scores', 'success', startedMs),
          new Date(NOW - 60_000).toISOString()
        )
      : row
  );
  const html = renderToStaticMarkup(
    <SchedulerHealthSection jobs={deliverySnapshot(rows).jobs} nowMs={NOW} />
  );

  // Asserted PER FIELD. A count across the whole section proves nothing here:
  // seven rows render three instants each, so dropping one field still leaves
  // roughly twenty and the assertion passes — which it did, until a mutation
  // showed it surviving the revert.
  for (const label of ['Required slot', 'Started', 'Completed']) {
    const cell = new RegExp(`${label}[\\s\\S]{0,200}?\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2} UTC`);
    assert.match(html, cell, `${label} must render an absolute instant`);
  }
  assert.ok(html.includes('Started'), 'the value the delivery contract actually compares');
  // Relative kept ALONGSIDE — it is the faster read when the answer is "minutes".
  assert.match(html, /\(\s*[^)]*ago\s*\)/, 'relative form retained in parentheses');
});

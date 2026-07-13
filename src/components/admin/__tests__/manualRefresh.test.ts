import assert from 'node:assert/strict';
import test from 'node:test';

import {
  combineOutcomes,
  controlModeLabel,
  datasetControlMode,
  interpretRefreshResponse,
  manualRefreshUrls,
} from '../manualRefresh.ts';
import { getProviderDatasetDescriptor } from '../../../lib/providerDatasets.ts';

// ---- Finding #2: manual game-stats refresh targets the right season type ----

test('game-stats manual refresh includes the selected season type', () => {
  const regular = manualRefreshUrls('game-stats', { year: 2026, week: 3, seasonType: 'regular' });
  assert.equal(regular.length, 1);
  assert.match(regular[0], /seasonType=regular/);
  assert.match(regular[0], /week=3/);

  const post = manualRefreshUrls('game-stats', { year: 2026, week: 1, seasonType: 'postseason' });
  assert.match(post[0], /seasonType=postseason/);
  assert.match(post[0], /week=1/);
  assert.doesNotMatch(post[0], /seasonType=regular/);
});

test('scores manual refresh fans out to regular + postseason', () => {
  const urls = manualRefreshUrls('scores', { year: 2026 });
  assert.equal(urls.length, 2);
  assert.ok(urls.some((u) => u.includes('seasonType=regular')));
  assert.ok(urls.some((u) => u.includes('seasonType=postseason')));
});

// ---- Finding #6: fallback responses are NOT treated as success ----

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('interpretRefreshResponse: plain 2xx is success', async () => {
  const outcome = await interpretRefreshResponse(jsonResponse({ meta: { source: 'cfbd_live' } }));
  assert.equal(outcome.ok, true);
});

test('interpretRefreshResponse: non-2xx is an http failure', async () => {
  const outcome = await interpretRefreshResponse(jsonResponse({ error: 'boom' }, 502));
  assert.equal(outcome.ok, false);
  assert.equal(outcome.ok === false && outcome.kind, 'http');
});

test('interpretRefreshResponse: 200 with fallbackUsed is a failure', async () => {
  const outcome = await interpretRefreshResponse(
    jsonResponse({ meta: { source: 'local_snapshot', fallbackUsed: true } })
  );
  assert.equal(outcome.ok, false);
  assert.equal(outcome.ok === false && outcome.kind, 'fallback');
});

test('interpretRefreshResponse: 200 with local_snapshot source is a failure even without the flag', async () => {
  const outcome = await interpretRefreshResponse(
    jsonResponse({ meta: { source: 'local_snapshot' } })
  );
  assert.equal(outcome.ok, false);
});

test('combineOutcomes: any failure makes the whole action a failure', () => {
  assert.equal(combineOutcomes([{ ok: true }, { ok: true }]).ok, true);
  const combined = combineOutcomes([{ ok: true }, { ok: false, kind: 'http', status: 500 }]);
  assert.equal(combined.ok, false);
});

// ---- Finding #7: controls are interactive only when consumed ----

test('datasetControlMode: game-stats is interactive (consumed today)', () => {
  assert.equal(datasetControlMode(getProviderDatasetDescriptor('game-stats')), 'interactive');
});

test('datasetControlMode: schedule is lifecycle-exempt', () => {
  assert.equal(datasetControlMode(getProviderDatasetDescriptor('schedule')), 'lifecycle-exempt');
});

test('datasetControlMode: planned datasets are not interactive', () => {
  for (const dataset of ['scores', 'odds', 'rankings', 'conferences'] as const) {
    assert.equal(datasetControlMode(getProviderDatasetDescriptor(dataset)), 'planned');
  }
});

test('controlModeLabel: exempt and planned modes have honest read-only text', () => {
  assert.match(controlModeLabel('lifecycle-exempt'), /exempt/i);
  assert.match(controlModeLabel('planned'), /not active yet/i);
  assert.equal(controlModeLabel('interactive'), '');
});

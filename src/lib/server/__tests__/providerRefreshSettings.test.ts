import assert from 'node:assert/strict';
import test from 'node:test';

import { __deleteAppStateFileForTests, __resetAppStateForTests } from '../appStateStore.ts';
import {
  defaultProviderRefreshSettings,
  getProviderRefreshSettings,
  isAutoRefreshAllowed,
  setDatasetAutoRefreshEnabled,
  setGlobalPause,
} from '../providerRefreshSettings.ts';

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

test('defaults: nothing paused, every dataset enabled (preserves current behavior)', async () => {
  const settings = await getProviderRefreshSettings();
  assert.equal(settings.globalPause, false);
  for (const dataset of Object.keys(defaultProviderRefreshSettings().datasets)) {
    assert.equal(settings.datasets[dataset as keyof typeof settings.datasets].enabled, true);
  }
});

test('global pause blocks noncritical automatic refresh (game-stats)', async () => {
  assert.equal(await isAutoRefreshAllowed('game-stats'), true);
  await setGlobalPause(true);
  assert.equal(await isAutoRefreshAllowed('game-stats'), false);
  await setGlobalPause(false);
  assert.equal(await isAutoRefreshAllowed('game-stats'), true);
});

test('per-dataset disable blocks only that dataset', async () => {
  await setDatasetAutoRefreshEnabled('game-stats', false);
  assert.equal(await isAutoRefreshAllowed('game-stats'), false);
  // Other datasets unaffected.
  assert.equal(await isAutoRefreshAllowed('scores'), true);
  await setDatasetAutoRefreshEnabled('game-stats', true);
  assert.equal(await isAutoRefreshAllowed('game-stats'), true);
});

// PLATFORM-086E1B: `isAutoRefreshAllowed` STRICTLY evaluates the noncritical
// settings — the descriptor-based lifecycle bypass is removed. Lifecycle-critical
// operations (season transition/rollover, the weekly cron's postseason-boundary
// maintenance) stay exempt by never CALLING the helper, not by a bypass inside it.

test('schedule honors the global pause (no descriptor-based lifecycle bypass)', async () => {
  assert.equal(await isAutoRefreshAllowed('schedule'), true);
  await setGlobalPause(true);
  assert.equal(await isAutoRefreshAllowed('schedule'), false, 'global pause gates schedule');
  await setGlobalPause(false);
  assert.equal(await isAutoRefreshAllowed('schedule'), true);
});

test('schedule honors its own dataset toggle', async () => {
  await setDatasetAutoRefreshEnabled('schedule', false);
  assert.equal(await isAutoRefreshAllowed('schedule'), false, 'toggle gates schedule');
  // Other datasets unaffected.
  assert.equal(await isAutoRefreshAllowed('scores'), true);
  await setDatasetAutoRefreshEnabled('schedule', true);
  assert.equal(await isAutoRefreshAllowed('schedule'), true);
});

test('lifecycle routes remain exempt because they do not call the helper', async () => {
  // The exemption seam is STRUCTURAL: the season-transition and season-rollover
  // crons never consult `isAutoRefreshAllowed`, so no settings state can gate
  // them. Pin that with a source scan (the same style as the repo's other
  // structural guards) so a future edit cannot silently wire the lifecycle
  // routes through the operator gate.
  const { readFile } = await import('node:fs/promises');
  for (const route of [
    'src/app/api/cron/season-transition/route.ts',
    'src/app/api/cron/season-rollover/route.ts',
  ]) {
    const source = await readFile(route, 'utf8');
    assert.ok(
      !source.includes('isAutoRefreshAllowed'),
      `${route} must not consult the noncritical settings gate`
    );
  }
});

test('settings persist across reads', async () => {
  await setGlobalPause(true);
  await setDatasetAutoRefreshEnabled('odds', false);
  const settings = await getProviderRefreshSettings();
  assert.equal(settings.globalPause, true);
  assert.equal(settings.datasets.odds.enabled, false);
  assert.equal(settings.datasets.scores.enabled, true);
});

test('concurrent global-pause and dataset-toggle both persist — no lost update (rereview finding #7)', async () => {
  // Fire both mutations concurrently. Each is a read-modify-write of the whole
  // settings record; without the in-process lock they would both read the same
  // prior value and the later write would silently discard the other's change.
  await Promise.all([setGlobalPause(true), setDatasetAutoRefreshEnabled('game-stats', false)]);

  const settings = await getProviderRefreshSettings();
  assert.equal(settings.globalPause, true, 'the global-pause change survived');
  assert.equal(
    settings.datasets['game-stats'].enabled,
    false,
    'the dataset-toggle change survived'
  );
});

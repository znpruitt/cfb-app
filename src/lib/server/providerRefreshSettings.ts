/**
 * Durable operational settings for automatic provider refresh (PLATFORM-086A).
 *
 * Two operator-controllable knobs, persisted so they survive restarts and are
 * shared across instances:
 *   - `globalPause`: pauses NONCRITICAL automatic provider polling. It does NOT
 *     block manual admin refresh, and it does NOT block lifecycle-critical
 *     OPERATIONS (the season-transition/rollover crons and the weekly schedule
 *     cron's postseason-boundary maintenance) — those are exempt by never
 *     consulting `isAutoRefreshAllowed`, which itself carries no bypass.
 *   - per-dataset `enabled`: enables/disables AUTOMATIC refresh for one dataset.
 *     It never deletes prior-good data and never blocks manual repair.
 *
 * Deliberately NOT here: editable cron expressions or arbitrary numeric cadence
 * fields. Cadence stays fixed in code / `vercel.json`.
 *
 * Defaults preserve current behavior: nothing paused, every dataset's automatic
 * refresh "enabled". The game-stats, live-scores (Scores plus the independently
 * gated Team records refresh), Odds, rankings, and weekly-schedule jobs consume
 * these settings; conferences persists an intent no job reads yet.
 */

import { getAppState, setAppState } from './appStateStore.ts';
import { PROVIDER_DATASETS, type ProviderDataset } from '../providerDatasets.ts';

export const PROVIDER_REFRESH_SETTINGS_SCOPE = 'provider-refresh-settings';
export const PROVIDER_REFRESH_SETTINGS_KEY = 'global';

export type ProviderDatasetSetting = {
  enabled: boolean;
};

export type ProviderRefreshSettings = {
  globalPause: boolean;
  datasets: Record<ProviderDataset, ProviderDatasetSetting>;
};

export function defaultProviderRefreshSettings(): ProviderRefreshSettings {
  const datasets = {} as Record<ProviderDataset, ProviderDatasetSetting>;
  for (const dataset of PROVIDER_DATASETS) {
    datasets[dataset] = { enabled: true };
  }
  return { globalPause: false, datasets };
}

function normalizeSettings(
  value: Partial<ProviderRefreshSettings> | null | undefined
): ProviderRefreshSettings {
  const base = defaultProviderRefreshSettings();
  if (!value || typeof value !== 'object') return base;
  const merged: ProviderRefreshSettings = {
    globalPause: value.globalPause === true,
    datasets: base.datasets,
  };
  for (const dataset of PROVIDER_DATASETS) {
    const stored = value.datasets?.[dataset];
    merged.datasets[dataset] = {
      // Missing/invalid entries default to enabled (current behavior).
      enabled: stored?.enabled !== false,
    };
  }
  return merged;
}

export async function getProviderRefreshSettings(): Promise<ProviderRefreshSettings> {
  const record = await getAppState<ProviderRefreshSettings>(
    PROVIDER_REFRESH_SETTINGS_SCOPE,
    PROVIDER_REFRESH_SETTINGS_KEY
  );
  return normalizeSettings(record?.value);
}

// In-process serialization of the settings read-modify-write (rereview finding
// #7). Both setters read the whole record, mutate one field, and write it back;
// without serialization two concurrent operator mutations (e.g. a global pause
// and a dataset toggle submitted together) can each read the same prior value and
// the later write silently discards the other's change. Both setters share ONE
// chain because they mutate the same durable key. Cross-instance last-writer-win
// remains (the store has no compare-and-set) — acceptable for rarely-changed
// operator settings that are re-read on the next panel load.
let settingsMutationChain: Promise<unknown> = Promise.resolve();
function withSettingsLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = settingsMutationChain.then(fn, fn);
  settingsMutationChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

export async function setGlobalPause(paused: boolean): Promise<ProviderRefreshSettings> {
  return withSettingsLock(async () => {
    const current = await getProviderRefreshSettings();
    const next: ProviderRefreshSettings = { ...current, globalPause: paused };
    await setAppState(PROVIDER_REFRESH_SETTINGS_SCOPE, PROVIDER_REFRESH_SETTINGS_KEY, next);
    return next;
  });
}

export async function setDatasetAutoRefreshEnabled(
  dataset: ProviderDataset,
  enabled: boolean
): Promise<ProviderRefreshSettings> {
  return withSettingsLock(async () => {
    const current = await getProviderRefreshSettings();
    const next: ProviderRefreshSettings = {
      ...current,
      datasets: { ...current.datasets, [dataset]: { enabled } },
    };
    await setAppState(PROVIDER_REFRESH_SETTINGS_SCOPE, PROVIDER_REFRESH_SETTINGS_KEY, next);
    return next;
  });
}

/**
 * Whether NONCRITICAL automatic refresh is currently allowed for a dataset:
 *
 *   global pause enabled  → false
 *   dataset toggle off    → false
 *   otherwise             → true
 *
 * Contract (PLATFORM-086E1B): this helper STRICTLY evaluates the operator
 * settings — it carries NO lifecycle exemption. Lifecycle-critical OPERATIONS
 * (the season-transition cron, the season-rollover cron, and the weekly cron's
 * postseason-boundary schedule maintenance) remain exempt by intentionally NOT
 * calling this helper, not by a bypass inside it. A caller that mixes ordinary
 * and lifecycle-critical operations over one dataset (the weekly schedule cron)
 * consults this only for its ORDINARY operations. A settings-store read failure
 * propagates — noncritical callers fail closed (`settings-unavailable`) rather
 * than assuming an open gate.
 */
export async function isAutoRefreshAllowed(dataset: ProviderDataset): Promise<boolean> {
  const settings = await getProviderRefreshSettings();
  return isAutoRefreshAllowedBySettings(settings, dataset);
}

/** Evaluate one dataset against an already-loaded settings snapshot. */
export function isAutoRefreshAllowedBySettings(
  settings: ProviderRefreshSettings,
  dataset: ProviderDataset
): boolean {
  if (settings.globalPause) return false;
  return settings.datasets[dataset]?.enabled !== false;
}

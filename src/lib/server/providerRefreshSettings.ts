/**
 * Durable operational settings for automatic provider refresh (PLATFORM-086A).
 *
 * Two operator-controllable knobs, persisted so they survive restarts and are
 * shared across instances:
 *   - `globalPause`: pauses NONCRITICAL automatic provider polling. It does NOT
 *     block manual admin refresh, and it does NOT block lifecycle-critical
 *     automation (the season-transition cron is exempt — see
 *     `isAutoRefreshAllowed`).
 *   - per-dataset `enabled`: enables/disables AUTOMATIC refresh for one dataset.
 *     It never deletes prior-good data and never blocks manual repair.
 *
 * Deliberately NOT here: editable cron expressions or arbitrary numeric cadence
 * fields. Cadence stays fixed in code / `vercel.json`.
 *
 * Defaults preserve current behavior: nothing paused, every dataset's automatic
 * refresh "enabled". Today only the game-stats cron consumes its setting; the
 * other datasets have no automatic job yet, so their setting is a persisted
 * intent that future PLATFORM-086B–086E jobs will read via `isAutoRefreshAllowed`.
 */

import { getAppState, setAppState } from './appStateStore.ts';
import {
  PROVIDER_DATASETS,
  getProviderDatasetDescriptor,
  type ProviderDataset,
} from '../providerDatasets.ts';

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

export async function setGlobalPause(paused: boolean): Promise<ProviderRefreshSettings> {
  const current = await getProviderRefreshSettings();
  const next: ProviderRefreshSettings = { ...current, globalPause: paused };
  await setAppState(PROVIDER_REFRESH_SETTINGS_SCOPE, PROVIDER_REFRESH_SETTINGS_KEY, next);
  return next;
}

export async function setDatasetAutoRefreshEnabled(
  dataset: ProviderDataset,
  enabled: boolean
): Promise<ProviderRefreshSettings> {
  const current = await getProviderRefreshSettings();
  const next: ProviderRefreshSettings = {
    ...current,
    datasets: { ...current.datasets, [dataset]: { enabled } },
  };
  await setAppState(PROVIDER_REFRESH_SETTINGS_SCOPE, PROVIDER_REFRESH_SETTINGS_KEY, next);
  return next;
}

/**
 * Whether NONCRITICAL automatic refresh is currently allowed for a dataset,
 * factoring both the global pause and the dataset's own enable flag.
 *
 * Contract: lifecycle-critical automation (the season-transition cron) must NOT
 * call this — it is exempt from the global pause and always runs. This helper is
 * for noncritical data-ingestion jobs (game-stats today; scores/odds/etc. in
 * future PLATFORM-086 tasks). It is safe to call even for datasets whose
 * automatic job does not exist yet — those jobs simply don't call it until they
 * ship.
 */
export async function isAutoRefreshAllowed(dataset: ProviderDataset): Promise<boolean> {
  const descriptor = getProviderDatasetDescriptor(dataset);
  if (descriptor.lifecycleCritical) {
    // Defensive: lifecycle-critical datasets are exempt; never gate them here.
    return true;
  }
  const settings = await getProviderRefreshSettings();
  if (settings.globalPause) return false;
  return settings.datasets[dataset]?.enabled !== false;
}

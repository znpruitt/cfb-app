/**
 * Shared catalog of provider-backed datasets (PLATFORM-086A).
 *
 * This module is intentionally free of server-only imports so it can be shared
 * by the refresh-status/settings stores, the admin API, the admin panel, and
 * any client-side freshness UI. It is the single source of truth for:
 *   - the `ProviderDataset` union used everywhere refresh status/settings key by
 *     dataset;
 *   - human-facing labels, provider names, and the CURRENT vs PLANNED automation
 *     description for each dataset.
 *
 * IMPORTANT (honesty rule): `currentAutomation` describes what actually runs in
 * `vercel.json` today; `plannedPolicy` describes the future PLATFORM-086B–086E
 * cadence that is NOT active yet. The admin panel must present these distinctly
 * so operators are never told a planned job is already running.
 */

export type ProviderDataset =
  | 'scores'
  | 'schedule'
  | 'odds'
  | 'rankings'
  | 'conferences'
  | 'game-stats';

export const PROVIDER_DATASETS: readonly ProviderDataset[] = [
  'scores',
  'schedule',
  'odds',
  'rankings',
  'conferences',
  'game-stats',
] as const;

export function isProviderDataset(value: unknown): value is ProviderDataset {
  return typeof value === 'string' && PROVIDER_DATASETS.includes(value as ProviderDataset);
}

export type ProviderName = 'CFBD' | 'The Odds API';

export type ProviderDatasetDescriptor = {
  dataset: ProviderDataset;
  /** Short human label for panels and freshness chips. */
  label: string;
  provider: ProviderName;
  /**
   * Whether an automatic refresh job for this dataset exists in versioned
   * deployment config (`vercel.json`) TODAY. `false` means manual/API-only.
   */
  hasActiveAutomation: boolean;
  /** Truthful description of the automation that runs today (or its absence). */
  currentAutomation: string;
  /**
   * Read-only description of the fixed PLATFORM-086 cadence PLANNED for this
   * dataset. Not active in this task — never render this as if it were running.
   */
  plannedPolicy: string;
  /**
   * Lifecycle-critical automation (drives preseason→season/season→offseason
   * transitions) is EXEMPT from the global noncritical auto-refresh pause. Only
   * the season-transition cron (schedule dataset) is lifecycle-critical today.
   */
  lifecycleCritical: boolean;
  /**
   * Whether an EXISTING automatic job consumes this dataset's auto-refresh
   * enable/disable setting in this task. Only `game-stats` does today; the
   * others persist a setting that future 086B–086E jobs will consume. The panel
   * uses this to avoid implying a toggle has an effect it does not yet have.
   */
  autoRefreshSettingConsumed: boolean;
};

export const PROVIDER_DATASET_DESCRIPTORS: Record<ProviderDataset, ProviderDatasetDescriptor> = {
  scores: {
    dataset: 'scores',
    label: 'Scores',
    provider: 'CFBD',
    hasActiveAutomation: false,
    currentAutomation: 'Manual admin refresh only — no automatic job today.',
    plannedPolicy:
      'Planned (PLATFORM-086B): schedule-armed ~3-minute polling while expected games remain unresolved.',
    lifecycleCritical: false,
    autoRefreshSettingConsumed: false,
  },
  schedule: {
    dataset: 'schedule',
    label: 'Schedule',
    provider: 'CFBD',
    hasActiveAutomation: true,
    currentAutomation:
      'Preseason transition probe only (season-transition cron); no in-season automatic refresh.',
    plannedPolicy: 'Planned (PLATFORM-086C): fixed weekly in-season refresh.',
    // The only automation touching schedule today is the lifecycle-critical
    // season-transition cron, which is exempt from the global pause.
    lifecycleCritical: true,
    autoRefreshSettingConsumed: false,
  },
  odds: {
    dataset: 'odds',
    label: 'Odds',
    provider: 'The Odds API',
    hasActiveAutomation: false,
    currentAutomation: 'No automatic job and no operator UI today (authorized API refresh only).',
    plannedPolicy:
      'Planned (PLATFORM-086B): fixed baseline cadence with modest pre-kickoff priority.',
    lifecycleCritical: false,
    autoRefreshSettingConsumed: false,
  },
  rankings: {
    dataset: 'rankings',
    label: 'Rankings',
    provider: 'CFBD',
    hasActiveAutomation: false,
    currentAutomation: 'Manual/API refresh only — no automatic job today.',
    plannedPolicy: 'Planned (PLATFORM-086C): Sunday and CFP-release refresh.',
    lifecycleCritical: false,
    autoRefreshSettingConsumed: false,
  },
  conferences: {
    dataset: 'conferences',
    label: 'Conferences',
    provider: 'CFBD',
    hasActiveAutomation: false,
    currentAutomation: 'Manual/API refresh only — bundled snapshot floor; rarely changes.',
    plannedPolicy: 'Planned: remain manual (reference data, changes infrequently).',
    lifecycleCritical: false,
    autoRefreshSettingConsumed: false,
  },
  'game-stats': {
    dataset: 'game-stats',
    label: 'Game stats',
    provider: 'CFBD',
    hasActiveAutomation: true,
    currentAutomation: 'Weekly ingestion cron (Mondays 11:00 UTC).',
    plannedPolicy: 'Planned (PLATFORM-086C): weekly ingestion plus missing-week recovery.',
    lifecycleCritical: false,
    autoRefreshSettingConsumed: true,
  },
};

export function getProviderDatasetDescriptor(dataset: ProviderDataset): ProviderDatasetDescriptor {
  return PROVIDER_DATASET_DESCRIPTORS[dataset];
}

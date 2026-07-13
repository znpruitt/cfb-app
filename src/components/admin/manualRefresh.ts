/**
 * Pure helpers for the admin Provider Data Status panel's manual refresh +
 * honest-controls logic (PLATFORM-086A remediation). Kept free of React so they
 * are unit-testable without a DOM.
 */

import { type ProviderDataset, type ProviderDatasetDescriptor } from '@/lib/providerDatasets';

export type ManualRefreshParams = {
  year: number;
  /** Required for game-stats (which is week-scoped). */
  week?: number;
  /** Required for game-stats — postseason must reach the postseason cache key. */
  seasonType?: 'regular' | 'postseason';
  /**
   * Applicable score partitions for this year, derived cache-only from the
   * schedule by the status feed (rereview finding #1). When provided, the scores
   * refresh fans out ONLY over these — so a mid-regular-season refresh does not
   * fire a doomed postseason request before bowls are published. Defaults to both
   * partitions when omitted (backward compatible).
   */
  scoreSeasonTypes?: Array<'regular' | 'postseason'>;
};

/**
 * The request URL(s) one manual refresh issues for a dataset. Scores fans out
 * over the APPLICABLE partitions (regular + postseason once bowls exist);
 * game-stats includes BOTH the week AND the season type so a postseason repair
 * reaches the postseason cache partition rather than defaulting to
 * `seasonType=regular`.
 */
export function manualRefreshUrls(dataset: ProviderDataset, params: ManualRefreshParams): string[] {
  const { year, week, seasonType } = params;
  switch (dataset) {
    case 'scores': {
      const partitions =
        params.scoreSeasonTypes && params.scoreSeasonTypes.length > 0
          ? params.scoreSeasonTypes
          : (['regular', 'postseason'] as const);
      return partitions.map((st) => `/api/scores?seasonType=${st}&year=${year}&refresh=1`);
    }
    case 'schedule':
      return [`/api/schedule?bypassCache=1&year=${year}`];
    case 'odds':
      return [`/api/odds?year=${year}&refresh=1`];
    case 'rankings':
      return [`/api/rankings?year=${year}&bypassCache=1`];
    case 'conferences':
      return [`/api/conferences?bypassCache=1`];
    case 'game-stats':
      return [
        `/api/game-stats?year=${year}&week=${week ?? 1}&seasonType=${seasonType ?? 'regular'}&bypassCache=1`,
      ];
  }
}

export type RefreshOutcome =
  | { ok: true }
  | { ok: false; kind: 'http'; status: number }
  | { ok: false; kind: 'fallback'; source?: string };

/**
 * Interpret a manual-refresh response. A non-2xx is a failure; a 2xx that a route
 * returns while serving a bundled/prior-good fallback (`meta.fallbackUsed` or
 * `meta.source === 'local_snapshot'` — the conferences route does this on a
 * provider error) is ALSO a failure, so the panel never reports "Refresh
 * complete" over a provider failure (finding #6).
 */
export async function interpretRefreshResponse(res: Response): Promise<RefreshOutcome> {
  if (!res.ok) return { ok: false, kind: 'http', status: res.status };
  let body: unknown = null;
  try {
    body = await res.clone().json();
  } catch {
    // Non-JSON 2xx — treat as success (nothing signals a fallback).
    return { ok: true };
  }
  const meta =
    body && typeof body === 'object' ? (body as { meta?: Record<string, unknown> }).meta : null;
  if (meta && (meta.fallbackUsed === true || meta.source === 'local_snapshot')) {
    return {
      ok: false,
      kind: 'fallback',
      source: typeof meta.source === 'string' ? meta.source : undefined,
    };
  }
  return { ok: true };
}

/** Combine multiple per-request outcomes into one (any failure → failure). */
export function combineOutcomes(outcomes: RefreshOutcome[]): RefreshOutcome {
  const firstFailure = outcomes.find((o) => !o.ok);
  return firstFailure ?? { ok: true };
}

export type DatasetControlMode = 'interactive' | 'lifecycle-exempt' | 'planned';

/**
 * Whether a dataset's auto-refresh toggle should be an INTERACTIVE control or
 * read-only future-intent/exempt language (finding #7). Only a dataset whose
 * setting is consumed by a live job today (`autoRefreshSettingConsumed`) gets an
 * interactive toggle; the lifecycle-critical season-transition schedule is
 * exempt; everything else is planned.
 */
export function datasetControlMode(descriptor: ProviderDatasetDescriptor): DatasetControlMode {
  if (descriptor.autoRefreshSettingConsumed) return 'interactive';
  if (descriptor.lifecycleCritical) return 'lifecycle-exempt';
  return 'planned';
}

/** Read-only label for a non-interactive control mode. */
export function controlModeLabel(mode: DatasetControlMode): string {
  switch (mode) {
    case 'lifecycle-exempt':
      return 'Lifecycle transition remains active and is exempt from provider polling pause controls.';
    case 'planned':
      return 'Planned automation — control not active yet.';
    case 'interactive':
      return '';
  }
}

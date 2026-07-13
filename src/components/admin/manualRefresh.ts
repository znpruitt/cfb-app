/**
 * Pure helpers for the admin Provider Data Status panel's manual refresh +
 * honest-controls logic (PLATFORM-086A remediation). Kept free of React so they
 * are unit-testable without a DOM.
 */

import { type ProviderDataset, type ProviderDatasetDescriptor } from '@/lib/providerDatasets';

/**
 * Composite key for year-scoped manual-refresh action state (hotfix requirement
 * 10). Keying manual pending/success/failure state by `${year}:${dataset}`
 * (not by dataset alone) is what stops a 2025 "Refresh complete" from appearing
 * on a 2026 card, or a year-A in-progress spinner from showing on year B.
 */
export function manualActionKey(year: number, dataset: ProviderDataset): string {
  return `${year}:${dataset}`;
}

/**
 * Whether a year-scoped async operation (a load, a post-action reload, or a
 * result application) is still for the CURRENTLY selected year (hotfix
 * requirements 7–9). A captured callback for year A must not start a load,
 * abort an active request, or mutate feed/error/loading state when year B is
 * now selected.
 */
export function isSelectedYear(requestedYear: number, currentYear: number): boolean {
  return requestedYear === currentYear;
}

/**
 * Whether a resolved provider-status response should be committed to the visible
 * feed. Extends {@link isCurrentStatusResponse} (seq + echoed-year) with the
 * required additional guard that the request year still equals the CURRENTLY
 * selected year (requirement 7): validating only `requestedYear === responseYear`
 * is insufficient, because an in-flight request for a since-abandoned year can
 * echo its own (matching) year and still be stale relative to the user's current
 * selection.
 */
export function shouldApplyStatusResponse(params: {
  requestSeq: number;
  latestSeq: number;
  requestedYear: number;
  responseYear: number;
  currentYear: number;
}): boolean {
  return (
    isCurrentStatusResponse({
      requestSeq: params.requestSeq,
      latestSeq: params.latestSeq,
      requestedYear: params.requestedYear,
      responseYear: params.responseYear,
    }) && params.requestedYear === params.currentYear
  );
}

export type ManualRefreshParams = {
  year: number;
  /** Required for game-stats (which is week-scoped). */
  week?: number;
  /** Required for game-stats — postseason must reach the postseason cache key. */
  seasonType?: 'regular' | 'postseason';
};

/**
 * The single aggregate scores-refresh URL under ONE server-side provider-refresh
 * attempt, so the whole operator action resolves as one truthful `scores` status
 * and no partition's no-op/success can erase another partition's failure
 * (6th-review finding #4). An ORDINARY refresh omits `seasonTypes` so the SERVER
 * derives the applicable partitions cache-only from the schedule (7th-review
 * finding #1) — a mid-regular-season refresh never fires a doomed postseason
 * request, and the client cannot force an unnecessary partition. Passing
 * `seasonTypes` is an explicit targeted repair (e.g. postseason only). Callers
 * issue exactly ONE request.
 */
export function scoresAggregateRefreshUrl(
  year: number,
  seasonTypes?: Array<'regular' | 'postseason'>
): string {
  const base = `/api/scores?year=${year}&refresh=1&aggregate=1`;
  return seasonTypes && seasonTypes.length > 0
    ? `${base}&seasonTypes=${seasonTypes.join(',')}`
    : base;
}

/**
 * The request URL(s) one manual refresh issues for a dataset. Scores issues a
 * SINGLE ordinary aggregate request (server derives applicable partitions, finding
 * #1); game-stats includes BOTH the week AND the season type so a postseason
 * repair reaches the postseason cache partition rather than defaulting to
 * `seasonType=regular`.
 */
export function manualRefreshUrls(dataset: ProviderDataset, params: ManualRefreshParams): string[] {
  const { year, week, seasonType } = params;
  switch (dataset) {
    case 'scores':
      return [scoresAggregateRefreshUrl(year)];
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
 * Whether a 2xx response's `meta` signals the route did NOT commit fresh provider
 * data and is instead serving a bundled/prior-good/stale fallback. Shared, typed
 * classifier (finding #5 / prior finding #6) so the panel treats every fallback
 * marker the routes actually emit as a failure rather than "Refresh complete":
 *   - `fallbackUsed` / `source: 'local_snapshot'` — conferences bundled fallback
 *     on a provider error (200 + fallback body);
 *   - `stale` / `rebuildRequired` — a refresh that REJECTED an empty/drifted
 *     replacement and is serving prior-good data (the rankings loader returns
 *     HTTP 200 with these when it declines to overwrite good rankings with
 *     nothing). These must not read as success even though the HTTP status is ok.
 */
function metaSignalsFallback(meta: Record<string, unknown> | null | undefined): boolean {
  if (!meta) return false;
  return (
    meta.fallbackUsed === true ||
    meta.stale === true ||
    meta.rebuildRequired === true ||
    meta.source === 'local_snapshot'
  );
}

/**
 * Interpret a manual-refresh response. A non-2xx is a failure; a 2xx that a route
 * returns while serving a bundled/prior-good/stale fallback (see
 * {@link metaSignalsFallback}) is ALSO a failure, so the panel never reports
 * "Refresh complete" over a provider failure or a rejected replacement.
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
  if (metaSignalsFallback(meta)) {
    return {
      ok: false,
      kind: 'fallback',
      source: meta && typeof meta.source === 'string' ? meta.source : undefined,
    };
  }
  return { ok: true };
}

/** Combine multiple per-request outcomes into one (any failure → failure). */
export function combineOutcomes(outcomes: RefreshOutcome[]): RefreshOutcome {
  const firstFailure = outcomes.find((o) => !o.ok);
  return firstFailure ?? { ok: true };
}

/**
 * Whether a resolved provider-status response should be committed to state, or
 * dropped as superseded (7th-review finding #2). A response is applied ONLY when
 * it is the newest issued request (`requestSeq === latestSeq`) AND the year the
 * server echoed matches the year this request was issued for. This prevents an
 * older year's response, resolving after a newer year selection, from overwriting
 * the feed — which would otherwise pair the visible year with another year's
 * diagnostics and score-partition applicability.
 */
export function isCurrentStatusResponse(params: {
  requestSeq: number;
  latestSeq: number;
  requestedYear: number;
  responseYear: number;
}): boolean {
  return params.requestSeq === params.latestSeq && params.requestedYear === params.responseYear;
}

export type PanelFeedRenderState = 'ready' | 'loading' | 'unavailable';

/**
 * What the Provider Data Status panel should render for the currently selected
 * year (final-truthfulness remediation finding #1). Dataset cards + feed-derived
 * controls render ONLY from a successful feed whose year matches the selection;
 * otherwise the panel shows an explicit loading or unavailable state rather than
 * placeholder rows or a previous year's feed.
 *
 *   ready       → a valid feed exists for the selected year
 *   loading     → no valid feed yet, a request is in flight
 *   unavailable → no valid feed and no request in flight (initial/refresh failure)
 */
export function panelFeedRenderState(params: {
  feedYear: number | null;
  selectedYear: number;
  loading: boolean;
}): PanelFeedRenderState {
  const hasValidFeed = params.feedYear !== null && params.feedYear === params.selectedYear;
  if (hasValidFeed) return 'ready';
  return params.loading ? 'loading' : 'unavailable';
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

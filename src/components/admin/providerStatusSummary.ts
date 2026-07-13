/**
 * Pure "what state is this dataset in" summary for the Provider Data Status panel
 * (PLATFORM-086A rereview finding #8). Kept free of React so the state-transition
 * logic is unit-testable.
 *
 * The summary is driven by the EXPLICIT latest-attempt outcome, never inferred
 * from the historical `lastSuccessAt`/`lastError` fields — so an in-flight,
 * interrupted, or valid-no-op attempt is never mislabeled as a success or failure
 * left over from a prior attempt. Records written before the outcome field
 * existed (`latestAttemptOutcome == null`) fall back to the old inference.
 */

import { describeFreshness } from '@/lib/freshness';
import type { ProviderDatasetDescriptor } from '@/lib/providerDatasets';
import type { ProviderCacheAvailability } from '@/lib/server/providerCacheState';
import type { ProviderRefreshStatus } from '@/lib/server/providerRefreshStatus';

export type SummaryTone = 'ok' | 'warn' | 'bad' | 'muted';
export type StateSummary = { label: string; tone: SummaryTone };

/**
 * An in-progress attempt older than this is treated as interrupted (the process
 * likely died mid-refresh and never resolved it). Fixed in code — not an
 * operator-editable value (per the task constraint).
 */
export const INTERRUPTED_ATTEMPT_AFTER_MS = 10 * 60 * 1000;

export function summarizeProviderState(
  status: ProviderRefreshStatus,
  descriptor: ProviderDatasetDescriptor,
  opts: {
    globalPause: boolean;
    enabled: boolean;
    now: number;
    /**
     * Cache-only availability of this dataset's data for the selected year. Only
     * consulted when NO refresh-status history exists, to distinguish "no
     * PLATFORM-086A history yet" from "no data at all". Defaults to `unknown`
     * (conservative: never asserts absence).
     */
    cacheState?: ProviderCacheAvailability;
  }
): StateSummary {
  const { globalPause, enabled, now, cacheState = 'unknown' } = opts;

  // Pause/disabled only mean something for a dataset whose setting a live job
  // actually consumes (game-stats today). Showing them for planned/exempt
  // datasets would imply a runtime effect that does not exist.
  const consumed = descriptor.autoRefreshSettingConsumed;
  if (consumed && globalPause) return { label: 'Automatic refresh paused (global)', tone: 'warn' };
  if (consumed && !enabled) return { label: 'Automatic refresh disabled', tone: 'warn' };

  // No PLATFORM-086A refresh-status record. "Never refreshed" would be a lie when
  // cached data already exists (it predates the instrumentation), so distinguish
  // the three cases by cache-only availability (requirement 6). Missing
  // observability history is never equated with missing data.
  if (status.lastAttemptAt == null && status.lastSuccessAt == null) {
    if (cacheState === 'available') {
      return { label: 'Serving cached data · no refresh history recorded', tone: 'muted' };
    }
    if (cacheState === 'absent') {
      return { label: 'No cached data or refresh history', tone: 'muted' };
    }
    return { label: 'No refresh history recorded', tone: 'muted' };
  }

  const outcome = status.latestAttemptOutcome;

  // Explicit-outcome path (records written by the current status model).
  if (outcome != null) {
    switch (outcome) {
      case 'in-progress': {
        const startedMs = status.lastAttemptAt ? Date.parse(status.lastAttemptAt) : NaN;
        const interrupted =
          Number.isFinite(startedMs) && now - startedMs > INTERRUPTED_ATTEMPT_AFTER_MS;
        return interrupted
          ? { label: 'Attempt appears interrupted', tone: 'warn' }
          : { label: 'Refresh in progress', tone: 'muted' };
      }
      case 'failed':
        return { label: 'Last attempt failed — prior-good data still serving', tone: 'bad' };
      case 'partial':
        return { label: 'Partial refresh — some partitions missing', tone: 'warn' };
      case 'no-op':
        return { label: 'Last attempt completed — no applicable data', tone: 'muted' };
      case 'succeeded':
        return describeSuccess(status, now, descriptor.staleAfterMs);
    }
  }

  // Legacy fallback (pre-outcome records): infer from historical fields.
  if (status.lastError != null) {
    return { label: 'Last attempt failed — prior-good data still serving', tone: 'bad' };
  }
  if (status.partialFailure) return { label: 'Partial coverage', tone: 'warn' };
  if (status.lastSuccessAt) return describeSuccess(status, now, descriptor.staleAfterMs);
  return { label: 'Refresh attempted', tone: 'muted' };
}

function describeSuccess(
  status: ProviderRefreshStatus,
  now: number,
  staleAfterMs: number
): StateSummary {
  if (!status.lastSuccessAt) return { label: 'Successfully refreshed', tone: 'ok' };
  // The stale window is per-dataset (rereview finding #8): a weekly dataset is not
  // flagged stale after two days, nor near-live scores held fresh for far too long.
  const fresh = describeFreshness(status.lastSuccessAt, { now, staleAfterMs });
  if (fresh.tone === 'stale')
    return { label: 'Successfully refreshed but now stale', tone: 'warn' };
  return { label: 'Successfully refreshed', tone: 'ok' };
}

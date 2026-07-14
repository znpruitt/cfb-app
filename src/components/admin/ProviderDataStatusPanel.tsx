'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

import { requireAdminAuthHeaders } from '@/lib/adminAuth';
import { fetchCfbdUsageSnapshot, type CfbdUsageSnapshot } from '@/lib/apiUsage';
import { formatQuotaSummary } from '@/lib/api/providerQuota';
import { formatRelativeTimestamp } from '@/lib/freshness';
import { seasonYearForToday } from '@/lib/scores/normalizers';
import type { ProviderDataset, ProviderDatasetDescriptor } from '@/lib/providerDatasets';
import type { ProviderCacheAvailability } from '@/lib/server/providerCacheState';
import type { ProviderRefreshStatus } from '@/lib/server/providerRefreshStatus';
import type { ProviderDiagnostic } from '@/lib/server/providerDataDiagnostics';
import type { OddsUsageSnapshot } from '@/lib/api/oddsUsage';
import {
  combineOutcomes,
  controlModeLabel,
  datasetControlMode,
  interpretRefreshResponse,
  isSelectedYear,
  manualActionKey,
  manualRefreshUrls,
  panelFeedRenderState,
  shouldApplyStatusResponse,
} from './manualRefresh';
import { summarizeProviderState, type SummaryTone } from './providerStatusSummary';

type DatasetRow = {
  dataset: ProviderDataset;
  descriptor: ProviderDatasetDescriptor;
  status: ProviderRefreshStatus;
  setting: { enabled: boolean };
  diagnostics: ProviderDiagnostic[];
};

type StatusFeed = {
  generatedAt: string;
  year: number;
  globalPause: boolean;
  datasets: DatasetRow[];
  diagnostics: ProviderDiagnostic[];
  /** Applicable score partitions for manual refresh (rereview finding #1). */
  scoreSeasonTypes: Array<'regular' | 'postseason'>;
  /** Cache-only availability per dataset, to distinguish no-history from no-data. */
  cacheStates: Record<ProviderDataset, ProviderCacheAvailability>;
  oddsUsage: OddsUsageSnapshot | null;
};

const sectionClass =
  'rounded-lg border border-gray-200 bg-white p-5 space-y-4 dark:border-zinc-700 dark:bg-zinc-900';
const cardClass =
  'rounded-md border border-gray-200 bg-gray-50 p-4 space-y-2 dark:border-zinc-700 dark:bg-zinc-950';
const buttonClass =
  'rounded border border-gray-300 bg-white px-3 py-1 text-xs text-gray-900 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700';

/** Human note on the provider cost of one manual refresh (from PLAN-003 audit). */
const MANUAL_REFRESH_COST: Record<ProviderDataset, string> = {
  scores: '≈2 CFBD requests (regular + postseason)',
  schedule: '≈2 CFBD requests (regular + postseason)',
  odds: '1 Odds API request (≈3 billing units)',
  rankings: '≈2 CFBD requests (regular + postseason)',
  conferences: '1 CFBD request',
  'game-stats': '1 CFBD request (one week)',
};

type ActionState = { status: 'idle' | 'loading' | 'success' | 'error'; message?: string };

function toneClass(severity: ProviderDiagnostic['severity']): string {
  if (severity === 'error') return 'text-red-700 dark:text-red-400';
  if (severity === 'warning') return 'text-amber-700 dark:text-amber-300';
  return 'text-gray-500 dark:text-zinc-400';
}

const STATE_TONE_CLASS: Record<SummaryTone, string> = {
  ok: 'text-green-700 dark:text-green-400',
  warn: 'text-amber-700 dark:text-amber-300',
  bad: 'text-red-700 dark:text-red-400',
  muted: 'text-gray-500 dark:text-zinc-400',
};

export default function ProviderDataStatusPanel({
  defaultYear,
}: { defaultYear?: number } = {}): React.ReactElement {
  const [year, setYear] = useState(defaultYear ?? seasonYearForToday());
  const [feed, setFeed] = useState<StatusFeed | null>(null);
  const [loadError, setLoadError] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [cfbdUsage, setCfbdUsage] = useState<CfbdUsageSnapshot | null>(null);
  const [actions, setActions] = useState<Record<string, ActionState>>({});
  const [gameStatsWeek, setGameStatsWeek] = useState<number>(1);
  const [gameStatsSeasonType, setGameStatsSeasonType] = useState<'regular' | 'postseason'>(
    'regular'
  );
  const [now, setNow] = useState<number>(() => Date.now());
  // Year-race guards (hotfix requirements 7–11): a monotonic request seq + an
  // AbortController so an older year's response can never overwrite a newer
  // year's feed, PLUS an authoritative ref to the currently selected year so a
  // captured callback for a since-abandoned year can neither start a stale load
  // nor apply a response under a different current year. `yearRef` is kept in
  // sync every render so async callbacks always read the LIVE selection, not the
  // year captured when the callback closure was created.
  const requestSeqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const yearRef = useRef(year);
  yearRef.current = year;

  // `load` is intentionally stable (no `year` dependency): it always loads the
  // CURRENTLY selected year (`yearRef.current`) at call time. That makes it
  // correct as the status-button handler, the year-change effect, and the
  // post-action reload — the settings mutation reloads whatever year is selected
  // at completion, and a stale manual-refresh callback cannot start an old-year
  // load because there is no old-year load to start.
  const load = useCallback(async () => {
    const requestedYear = yearRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const seq = ++requestSeqRef.current;
    setLoading(true);
    setLoadError('');
    try {
      const res = await fetch(`/api/admin/provider-status?year=${requestedYear}`, {
        cache: 'no-store',
        headers: requireAdminAuthHeaders() as Record<string, string>,
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Status ${res.status}${text ? `: ${text.slice(0, 160)}` : ''}`);
      }
      const data = (await res.json()) as StatusFeed;
      // Drop a superseded (aborted / not-latest), year-mismatched, or
      // no-longer-selected response so it cannot pair the visible year with
      // another year's diagnostics/applicability/cache-state.
      if (
        controller.signal.aborted ||
        !shouldApplyStatusResponse({
          requestSeq: seq,
          latestSeq: requestSeqRef.current,
          requestedYear,
          responseYear: data.year,
          currentYear: yearRef.current,
        })
      ) {
        return;
      }
      setFeed(data);
      setNow(Date.now());
    } catch (err) {
      // Aborted/superseded requests must not surface a stale error or spinner.
      if (controller.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
        return;
      }
      if (seq !== requestSeqRef.current || requestedYear !== yearRef.current) return;
      setLoadError(err instanceof Error ? err.message : 'Failed to load provider status');
    } finally {
      if (seq === requestSeqRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [year, load]);

  // CFBD live usage is an authoritative provider read (kept separate from the
  // cache-only status feed). Best-effort — its failure never blocks the panel.
  useEffect(() => {
    void fetchCfbdUsageSnapshot()
      .then(setCfbdUsage)
      .catch(() => setCfbdUsage(null));
  }, []);

  const setAction = (key: string, state: ActionState) =>
    setActions((prev) => ({ ...prev, [key]: state }));

  const mutateSettings = useCallback(
    async (body: Record<string, unknown>, actionKey: string) => {
      setAction(actionKey, { status: 'loading' });
      try {
        const res = await fetch('/api/admin/provider-status', {
          method: 'POST',
          cache: 'no-store',
          headers: {
            'Content-Type': 'application/json',
            ...(requireAdminAuthHeaders() as Record<string, string>),
          },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(`Error ${res.status}${text ? `: ${text.slice(0, 120)}` : ''}`);
        }
        setAction(actionKey, { status: 'success' });
        await load();
      } catch (err) {
        setAction(actionKey, {
          status: 'error',
          message: err instanceof Error ? err.message : 'Failed',
        });
      }
    },
    [load]
  );

  const runManualRefresh = useCallback(
    async (dataset: ProviderDataset) => {
      // Capture the exact partition this action is for. State is keyed by
      // `${actionYear}:${dataset}` — and for game-stats also by week + season type
      // (v2 finding #2) — so a completed result never appears on another year, and
      // a Week 1 regular result/spinner never shows beside Week 2 or postseason.
      const actionYear = yearRef.current;
      const actionWeek = gameStatsWeek;
      const actionSeasonType = gameStatsSeasonType;
      const key = manualActionKey(
        actionYear,
        dataset,
        dataset === 'game-stats' ? { week: actionWeek, seasonType: actionSeasonType } : undefined
      );
      setAction(key, { status: 'loading' });
      const headers = requireAdminAuthHeaders() as Record<string, string>;
      const opts = { cache: 'no-store' as const, headers };
      try {
        const urls = manualRefreshUrls(dataset, {
          year: actionYear,
          week: actionWeek,
          seasonType: actionSeasonType,
        });
        // Interpret each response: a non-2xx OR a 2xx that served a bundled/
        // prior-good fallback (conferences on provider failure) is a failure, so
        // the panel never reports success over a provider failure (finding #6).
        const outcomes = await Promise.all(
          urls.map((url) => fetch(url, opts).then(interpretRefreshResponse))
        );
        const combined = combineOutcomes(outcomes);
        if (combined.ok) {
          setAction(key, { status: 'success' });
        } else if (combined.kind === 'fallback') {
          setAction(key, {
            status: 'error',
            message: 'Provider refresh failed; fallback data is still serving.',
          });
        } else {
          setAction(key, { status: 'error', message: `HTTP ${combined.status}` });
        }
      } catch (err) {
        setAction(key, {
          status: 'error',
          message: err instanceof Error ? err.message : 'Failed',
        });
      }
      // Reload only if the action's year is still selected (requirement 9). If the
      // operator moved to another year, do not reload the old year or disturb the
      // current year's in-flight request. The keyed result stays under actionYear.
      if (isSelectedYear(actionYear, yearRef.current)) {
        await load();
      }
    },
    [gameStatsWeek, gameStatsSeasonType, load]
  );

  // Authoritative, reconciled CFBD quota shared with the legacy API Usage panel
  // (both render `normalized`, so they can never disagree or show an impossible
  // "remaining of limit" combination). This is an independent per-mount CFBD read
  // (not year-scoped), so it stays visible regardless of the status-feed state.
  const cfbdQuota = cfbdUsage ? formatQuotaSummary(cfbdUsage.normalized) : null;

  // Feed-derived UI (dataset cards, global pause, odds quota, diagnostics) renders
  // ONLY from a successful feed for the CURRENTLY selected year (finding #1). A
  // stale prior-year feed or a null feed after a failed load must never be shown
  // as current-year state — the panel shows an explicit loading/unavailable state
  // instead of placeholder rows or another year's data.
  const renderState = panelFeedRenderState({
    feedYear: feed?.year ?? null,
    selectedYear: year,
    loading,
  });
  const hasValidFeed = renderState === 'ready';

  return (
    <section className={sectionClass}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-medium text-gray-900 dark:text-zinc-100">
            Provider Data Status
          </h2>
          <p className="mt-1 text-xs text-gray-500 dark:text-zinc-400">
            Freshness, failures, and quota for each provider-backed dataset. Status is cache-only;
            it never spends provider quota.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500 dark:text-zinc-400">Year</label>
          <input
            type="number"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            min={2000}
            step={1}
            className="w-20 rounded border border-gray-300 bg-gray-50 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          />
          <button className={buttonClass} onClick={() => void load()} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh status'}
          </button>
        </div>
      </div>

      {/* Selected-year feed state: loading / unavailable / (ready + latest-refresh
          error). Dataset cards and feed-derived controls below render only when a
          valid feed exists for the selected year. */}
      {renderState === 'loading' && (
        <p className="text-xs text-gray-500 dark:text-zinc-400">
          Loading provider status for {year}…
        </p>
      )}
      {renderState === 'unavailable' && (
        <p className="text-xs text-red-700 dark:text-red-400">
          Provider status unavailable for {year}
          {loadError ? `: ${loadError}` : '.'}
        </p>
      )}
      {renderState === 'ready' && loadError && (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          Latest status refresh failed: {loadError}. Showing the last successful {year} status.
        </p>
      )}

      {/* Global pause control. Its displayed state (On/Off) is only known from the
          status feed, so it renders only alongside a valid selected-year feed —
          never from stale metadata. */}
      {hasValidFeed && feed && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-zinc-700 dark:bg-zinc-950">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-800 dark:text-zinc-200">
                Global provider pause:
              </span>
              {feed.globalPause ? (
                <span className="text-xs font-medium text-amber-700 dark:text-amber-300">On</span>
              ) : (
                <span className="text-xs font-medium text-green-700 dark:text-green-400">Off</span>
              )}
            </div>
            <p className="text-[11px] text-gray-500 dark:text-zinc-400">
              When On, noncritical automatic provider polling is paused. Manual admin refresh and
              the lifecycle-critical season transition always keep running, and most provider jobs
              (scores, Odds, schedule, rankings) are still planned rather than active.
            </p>
          </div>
          <button
            className={buttonClass}
            disabled={actions['global-pause']?.status === 'loading'}
            onClick={() =>
              void mutateSettings(
                { action: 'set-global-pause', paused: !feed.globalPause },
                'global-pause'
              )
            }
          >
            {feed.globalPause ? 'Resume automation' : 'Pause automation'}
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 text-xs text-gray-600 dark:text-zinc-400 sm:grid-cols-2">
        <div className="rounded border border-gray-200 bg-white p-2 dark:border-zinc-700 dark:bg-zinc-800">
          <span className="font-medium text-gray-800 dark:text-zinc-200">CFBD quota</span>{' '}
          {cfbdQuota && cfbdUsage ? (
            <>
              {cfbdQuota.text}{' '}
              <span className="text-gray-400 dark:text-zinc-500">
                (tier {cfbdUsage.patronLevel} · live provider observation)
              </span>
              {cfbdQuota.inconsistent && cfbdQuota.detail && (
                <span className="mt-0.5 block text-amber-700 dark:text-amber-300">
                  Raw provider values inconsistent ({cfbdQuota.detail}); showing the reconciled Tier
                  value.
                </span>
              )}
            </>
          ) : (
            'unavailable'
          )}
        </div>
        <div className="rounded border border-gray-200 bg-white p-2 dark:border-zinc-700 dark:bg-zinc-800">
          <span className="font-medium text-gray-800 dark:text-zinc-200">Odds quota</span>{' '}
          {/* Odds usage is delivered via the year-scoped feed, so it renders only
              with a valid selected-year feed — never a stale year's snapshot. */}
          {!hasValidFeed ? (
            'unavailable'
          ) : feed?.oddsUsage ? (
            <>
              {feed.oddsUsage.remaining} remaining of {feed.oddsUsage.limit} (snapshot{' '}
              {formatRelativeTimestamp(feed.oddsUsage.capturedAt, now) ?? 'n/a'})
            </>
          ) : (
            'no snapshot yet'
          )}
        </div>
      </div>

      {/* Per-dataset cards — ONLY from a valid feed for the selected year. Never
          synthesize placeholder "no history" rows or render another year's feed
          (finding #1); the loading/unavailable banner above covers those states. */}
      <div className="space-y-3">
        {hasValidFeed &&
          feed &&
          feed.datasets.map((row) => {
            const state = summarizeProviderState(row.status, row.descriptor, {
              globalPause: feed.globalPause,
              enabled: row.setting.enabled,
              now,
              cacheState: feed.cacheStates?.[row.dataset] ?? 'unknown',
            });
            const successRel = formatRelativeTimestamp(row.status.lastSuccessAt, now);
            const attemptRel = formatRelativeTimestamp(row.status.lastAttemptAt, now);
            // Manual-refresh state is keyed by (year, dataset) — and for game-stats
            // also by the CURRENT week + season type (v2 finding #2) — so a result
            // never leaks across years or partitions. Toggles stay globally keyed.
            const refreshKey = manualActionKey(
              year,
              row.dataset,
              row.dataset === 'game-stats'
                ? { week: gameStatsWeek, seasonType: gameStatsSeasonType }
                : undefined
            );
            const toggleKey = `toggle:${row.dataset}`;
            const controlMode = datasetControlMode(row.descriptor);
            return (
              <div key={row.dataset} className={cardClass}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <span className="text-sm font-semibold text-gray-900 dark:text-zinc-100">
                      {row.descriptor.label}
                    </span>
                    <span className="ml-2 text-[11px] text-gray-400 dark:text-zinc-500">
                      {row.descriptor.provider}
                    </span>
                    <div className={`text-xs font-medium ${STATE_TONE_CLASS[state.tone]}`}>
                      {state.label}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      className={buttonClass}
                      disabled={actions[refreshKey]?.status === 'loading'}
                      onClick={() => void runManualRefresh(row.dataset)}
                      title={MANUAL_REFRESH_COST[row.dataset]}
                    >
                      {actions[refreshKey]?.status === 'loading' ? 'Refreshing…' : 'Manual refresh'}
                    </button>
                    {/* Honest controls (finding #7): only an interactive toggle when
                      a live job actually consumes the setting; otherwise read-only
                      future-intent / lifecycle-exempt language. */}
                    {controlMode === 'interactive' ? (
                      <label className="flex items-center gap-1 text-[11px] text-gray-500 dark:text-zinc-400">
                        <input
                          type="checkbox"
                          checked={row.setting.enabled}
                          disabled={actions[toggleKey]?.status === 'loading'}
                          onChange={(e) =>
                            void mutateSettings(
                              {
                                action: 'set-dataset-enabled',
                                dataset: row.dataset,
                                enabled: e.target.checked,
                              },
                              toggleKey
                            )
                          }
                        />
                        auto
                      </label>
                    ) : (
                      <span
                        className="max-w-[10rem] text-[10px] italic text-gray-400 dark:text-zinc-500"
                        title={controlModeLabel(controlMode)}
                      >
                        {controlMode === 'lifecycle-exempt' ? 'auto: exempt' : 'auto: planned'}
                      </span>
                    )}
                  </div>
                </div>

                {row.dataset === 'game-stats' && (
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-500 dark:text-zinc-400">
                    <label>Week</label>
                    <input
                      type="number"
                      min={0}
                      value={gameStatsWeek}
                      onChange={(e) => setGameStatsWeek(Number(e.target.value))}
                      className="w-16 rounded border border-gray-300 bg-white px-1.5 py-0.5 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                    />
                    {/* Season type (finding #2): postseason repair must reach the
                      postseason cache key, not default to regular. */}
                    <label>Season</label>
                    <select
                      value={gameStatsSeasonType}
                      onChange={(e) =>
                        setGameStatsSeasonType(
                          e.target.value === 'postseason' ? 'postseason' : 'regular'
                        )
                      }
                      className="rounded border border-gray-300 bg-white px-1.5 py-0.5 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                    >
                      <option value="regular">regular</option>
                      <option value="postseason">postseason</option>
                    </select>
                    <span>for manual refresh</span>
                  </div>
                )}

                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-gray-600 dark:text-zinc-400 sm:grid-cols-3">
                  <Field label="Last success" value={successRel ?? '—'} />
                  <Field label="Last attempt" value={attemptRel ?? '—'} />
                  <Field
                    label="Rows"
                    value={
                      row.status.rowsCommitted != null ? String(row.status.rowsCommitted) : '—'
                    }
                  />
                  <Field label="Source" value={row.status.source ?? '—'} />
                  <Field
                    label="Partial"
                    value={
                      row.status.partialFailure
                        ? row.status.failedPartitions?.join(', ') || 'yes'
                        : 'no'
                    }
                  />
                  <Field
                    label="Duration"
                    value={row.status.durationMs != null ? `${row.status.durationMs}ms` : '—'}
                  />
                </dl>

                {row.status.lastError && (
                  <p className="text-[11px] text-red-700 dark:text-red-400">
                    Last error: {row.status.lastError.message}
                    {row.status.lastError.status ? ` (${row.status.lastError.status})` : ''}
                  </p>
                )}

                {actions[refreshKey]?.status === 'error' && (
                  <p className="text-[11px] text-red-700 dark:text-red-400">
                    Refresh failed: {actions[refreshKey]?.message}
                  </p>
                )}
                {actions[refreshKey]?.status === 'success' && (
                  <p className="text-[11px] text-green-700 dark:text-green-400">
                    Refresh complete.
                  </p>
                )}

                {row.diagnostics.length > 0 && (
                  <ul className="space-y-0.5">
                    {row.diagnostics.map((d, i) => (
                      <li key={i} className={`text-[11px] ${toneClass(d.severity)}`}>
                        • {d.message}
                      </li>
                    ))}
                  </ul>
                )}

                <div className="border-t border-gray-200 pt-2 text-[11px] text-gray-400 dark:border-zinc-700 dark:text-zinc-500">
                  <div>
                    <span className="font-medium">Current:</span> {row.descriptor.currentAutomation}
                  </div>
                  <div>
                    <span className="font-medium">Policy:</span> {row.descriptor.plannedPolicy}
                  </div>
                </div>
              </div>
            );
          })}
      </div>

      <p className="text-[11px] text-gray-400 dark:text-zinc-500">
        Cadence is fixed in code / vercel.json and is not editable here. &ldquo;Policy&rdquo; lines
        describe PLANNED PLATFORM-086 cadence — not automation that is running today.
        {hasValidFeed && feed
          ? ` Status generated ${formatRelativeTimestamp(feed.generatedAt, now) ?? 'just now'}.`
          : ''}
      </p>
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div>
      <dt className="text-gray-400 dark:text-zinc-500">{label}</dt>
      <dd className="text-gray-700 dark:text-zinc-300">{value}</dd>
    </div>
  );
}

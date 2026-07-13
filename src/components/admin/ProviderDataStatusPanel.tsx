'use client';

import React, { useCallback, useEffect, useState } from 'react';

import { requireAdminAuthHeaders } from '@/lib/adminAuth';
import { fetchCfbdUsageSnapshot, type CfbdUsageSnapshot } from '@/lib/apiUsage';
import { describeFreshness, formatRelativeTimestamp } from '@/lib/freshness';
import { seasonYearForToday } from '@/lib/scores/normalizers';
import {
  PROVIDER_DATASETS,
  getProviderDatasetDescriptor,
  type ProviderDataset,
  type ProviderDatasetDescriptor,
} from '@/lib/providerDatasets';
import type { ProviderRefreshStatus } from '@/lib/server/providerRefreshStatus';
import type { ProviderDiagnostic } from '@/lib/server/providerDataDiagnostics';
import type { OddsUsageSnapshot } from '@/lib/api/oddsUsage';

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

/** One-line "what state is this dataset in" summary. */
function summarizeState(
  row: DatasetRow,
  globalPause: boolean,
  now: number
): { label: string; tone: 'ok' | 'warn' | 'bad' | 'muted' } {
  const { status, setting, descriptor } = row;
  const pausedByGlobal = globalPause && !descriptor.lifecycleCritical;
  if (pausedByGlobal) return { label: 'Automatic refresh paused (global)', tone: 'warn' };
  if (!setting.enabled) return { label: 'Automatic refresh disabled', tone: 'warn' };
  if (status.lastAttemptAt == null && status.lastSuccessAt == null)
    return { label: 'Never refreshed', tone: 'muted' };
  if (status.lastError != null)
    return { label: 'Last attempt failed — prior-good data still serving', tone: 'bad' };
  if (status.partialFailure) return { label: 'Partial coverage', tone: 'warn' };
  if (status.lastSuccessAt) {
    const fresh = describeFreshness(status.lastSuccessAt, { now, staleAfterMs: 2 * 86_400_000 });
    if (fresh.tone === 'stale')
      return { label: 'Successfully refreshed but now stale', tone: 'warn' };
    return { label: 'Successfully refreshed', tone: 'ok' };
  }
  return { label: 'Refresh attempted', tone: 'muted' };
}

const STATE_TONE_CLASS: Record<'ok' | 'warn' | 'bad' | 'muted', string> = {
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
  const [now, setNow] = useState<number>(() => Date.now());

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const res = await fetch(`/api/admin/provider-status?year=${year}`, {
        cache: 'no-store',
        headers: requireAdminAuthHeaders() as Record<string, string>,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Status ${res.status}${text ? `: ${text.slice(0, 160)}` : ''}`);
      }
      setFeed((await res.json()) as StatusFeed);
      setNow(Date.now());
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load provider status');
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => {
    void load();
  }, [load]);

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
      const key = `refresh:${dataset}`;
      setAction(key, { status: 'loading' });
      const headers = requireAdminAuthHeaders() as Record<string, string>;
      const opts = { cache: 'no-store' as const, headers };
      try {
        let requests: Promise<Response>[] = [];
        switch (dataset) {
          case 'scores':
            requests = [
              fetch(`/api/scores?seasonType=regular&year=${year}&refresh=1`, opts),
              fetch(`/api/scores?seasonType=postseason&year=${year}&refresh=1`, opts),
            ];
            break;
          case 'schedule':
            requests = [fetch(`/api/schedule?bypassCache=1&year=${year}`, opts)];
            break;
          case 'odds':
            requests = [fetch(`/api/odds?year=${year}&refresh=1`, opts)];
            break;
          case 'rankings':
            requests = [fetch(`/api/rankings?year=${year}&bypassCache=1`, opts)];
            break;
          case 'conferences':
            requests = [fetch(`/api/conferences?bypassCache=1`, opts)];
            break;
          case 'game-stats':
            requests = [
              fetch(`/api/game-stats?year=${year}&week=${gameStatsWeek}&bypassCache=1`, opts),
            ];
            break;
        }
        const responses = await Promise.all(requests);
        const failed = responses.filter((r) => !r.ok);
        if (failed.length > 0) {
          setAction(key, {
            status: 'error',
            message: `${failed.map((r) => r.status).join(', ')}`,
          });
        } else {
          setAction(key, { status: 'success' });
        }
      } catch (err) {
        setAction(key, {
          status: 'error',
          message: err instanceof Error ? err.message : 'Failed',
        });
      }
      await load();
    },
    [year, gameStatsWeek, load]
  );

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

      {loadError && (
        <p className="text-xs text-red-700 dark:text-red-400">Status error: {loadError}</p>
      )}

      {/* Global pause + provider quota summary */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-zinc-700 dark:bg-zinc-950">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-800 dark:text-zinc-200">
              Global automatic refresh
            </span>
            {feed?.globalPause ? (
              <span className="text-xs font-medium text-amber-700 dark:text-amber-300">PAUSED</span>
            ) : (
              <span className="text-xs font-medium text-green-700 dark:text-green-400">Active</span>
            )}
          </div>
          <p className="text-[11px] text-gray-500 dark:text-zinc-400">
            Pause halts noncritical automatic polling. Manual refresh and the lifecycle-critical
            season transition keep running.
          </p>
        </div>
        <button
          className={buttonClass}
          disabled={!feed || actions['global-pause']?.status === 'loading'}
          onClick={() =>
            void mutateSettings(
              { action: 'set-global-pause', paused: !(feed?.globalPause ?? false) },
              'global-pause'
            )
          }
        >
          {feed?.globalPause ? 'Resume automation' : 'Pause automation'}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 text-xs text-gray-600 dark:text-zinc-400 sm:grid-cols-2">
        <div className="rounded border border-gray-200 bg-white p-2 dark:border-zinc-700 dark:bg-zinc-800">
          <span className="font-medium text-gray-800 dark:text-zinc-200">CFBD quota</span>{' '}
          {cfbdUsage ? (
            <>
              {cfbdUsage.remaining} remaining of {cfbdUsage.limit} (tier {cfbdUsage.patronLevel},
              live provider read)
            </>
          ) : (
            'unavailable'
          )}
        </div>
        <div className="rounded border border-gray-200 bg-white p-2 dark:border-zinc-700 dark:bg-zinc-800">
          <span className="font-medium text-gray-800 dark:text-zinc-200">Odds quota</span>{' '}
          {feed?.oddsUsage ? (
            <>
              {feed.oddsUsage.remaining} remaining of {feed.oddsUsage.limit} (snapshot{' '}
              {formatRelativeTimestamp(feed.oddsUsage.capturedAt, now) ?? 'n/a'})
            </>
          ) : (
            'no snapshot yet'
          )}
        </div>
      </div>

      {/* Per-dataset cards */}
      <div className="space-y-3">
        {(feed?.datasets ?? PROVIDER_DATASETS.map(placeholderRow)).map((row) => {
          const state = summarizeState(row, feed?.globalPause ?? false, now);
          const successRel = formatRelativeTimestamp(row.status.lastSuccessAt, now);
          const attemptRel = formatRelativeTimestamp(row.status.lastAttemptAt, now);
          const refreshKey = `refresh:${row.dataset}`;
          const toggleKey = `toggle:${row.dataset}`;
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
                </div>
              </div>

              {row.dataset === 'game-stats' && (
                <div className="flex items-center gap-2 text-[11px] text-gray-500 dark:text-zinc-400">
                  <label>Week</label>
                  <input
                    type="number"
                    min={0}
                    value={gameStatsWeek}
                    onChange={(e) => setGameStatsWeek(Number(e.target.value))}
                    className="w-16 rounded border border-gray-300 bg-white px-1.5 py-0.5 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                  />
                  <span>for manual refresh</span>
                </div>
              )}

              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-gray-600 dark:text-zinc-400 sm:grid-cols-3">
                <Field label="Last success" value={successRel ?? '—'} />
                <Field label="Last attempt" value={attemptRel ?? '—'} />
                <Field
                  label="Rows"
                  value={row.status.rowsCommitted != null ? String(row.status.rowsCommitted) : '—'}
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
                <p className="text-[11px] text-green-700 dark:text-green-400">Refresh complete.</p>
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
        {feed
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

function placeholderRow(dataset: ProviderDataset): DatasetRow {
  return {
    dataset,
    descriptor: getProviderDatasetDescriptor(dataset),
    status: {
      dataset,
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastError: null,
      source: null,
      rowsCommitted: null,
      partialFailure: false,
    },
    setting: { enabled: true },
    diagnostics: [],
  };
}

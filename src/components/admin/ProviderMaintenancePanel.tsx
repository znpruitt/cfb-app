'use client';

import React, { useState } from 'react';

import { requireAdminAuthHeaders } from '@/lib/adminAuth';
import { seasonYearForToday } from '@/lib/scores/normalizers';
import MaintenanceActionDetails from './MaintenanceActionDetails';
import { interpretRefreshResponse, manualRefreshUrls } from './manualRefresh';

/**
 * PLATFORM-086F2D1 — the Data Maintenance & Recovery surface for the manual
 * Odds and Rankings refreshes relocated from System Health. Requests use the
 * SAME URL authority the old Diagnostics buttons used (`manualRefreshUrls`),
 * and the same truthful outcome interpreter: a non-2xx OR a 2xx serving a
 * bundled/prior-good/stale fallback never renders as success.
 */

type SectionStatus = 'idle' | 'loading' | 'success' | 'error';

const sectionClass =
  'rounded-lg border border-gray-200 bg-white p-5 space-y-3 dark:border-zinc-700 dark:bg-zinc-900';
const buttonClass =
  'rounded border border-gray-300 bg-gray-50 px-4 py-1.5 text-sm text-gray-900 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700';

function StatusBadge({ status, error }: { status: SectionStatus; error?: string }) {
  if (status === 'loading')
    return <span className="text-xs text-gray-500 dark:text-zinc-400">Working…</span>;
  if (status === 'success')
    return <span className="text-xs text-green-600 dark:text-green-400">Done</span>;
  if (status === 'error')
    return <span className="text-xs text-red-600 dark:text-red-400">{error ?? 'Failed'}</span>;
  return null;
}

export default function ProviderMaintenancePanel({
  defaultYear,
}: { defaultYear?: number } = {}): React.ReactElement {
  const [year, setYear] = useState(defaultYear ?? seasonYearForToday());

  const [oddsStatus, setOddsStatus] = useState<SectionStatus>('idle');
  const [oddsError, setOddsError] = useState<string | undefined>();

  const [rankingsStatus, setRankingsStatus] = useState<SectionStatus>('idle');
  const [rankingsError, setRankingsError] = useState<string | undefined>();

  async function runRefresh(
    dataset: 'odds' | 'rankings',
    setStatus: (s: SectionStatus) => void,
    setError: (e: string | undefined) => void
  ) {
    setStatus('loading');
    setError(undefined);
    try {
      const [url] = manualRefreshUrls(dataset, { year });
      const outcome = await fetch(url!, {
        cache: 'no-store',
        headers: requireAdminAuthHeaders() as Record<string, string>,
      }).then(interpretRefreshResponse);
      if (!outcome.ok) {
        setError(
          outcome.kind === 'http'
            ? `Error ${outcome.status}`
            : 'Provider refresh failed; fallback data is still serving.'
        );
        setStatus('error');
        return;
      }
      setStatus('success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unexpected error');
      setStatus('error');
    }
  }

  return (
    <>
      <section className={sectionClass}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-medium text-gray-900 dark:text-zinc-100">
              Odds &amp; Rankings
            </h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-zinc-400">
              Manual recovery refreshes for the automation-owned Odds and Rankings datasets. Use
              when the hourly/publication schedules missed a window or a repair is needed.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-500 dark:text-zinc-400">
              Season year
            </label>
            <input
              type="number"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              min={2000}
              step={1}
              className="w-24 rounded border border-gray-300 bg-gray-50 px-2 py-1 text-sm text-gray-900 focus:border-gray-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-zinc-500"
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => void runRefresh('odds', setOddsStatus, setOddsError)}
            disabled={oddsStatus === 'loading'}
            className={buttonClass}
          >
            {oddsStatus === 'loading' ? 'Refreshing…' : 'Refresh Odds'}
          </button>
          <StatusBadge status={oddsStatus} error={oddsError} />
        </div>
        <MaintenanceActionDetails action="odds-refresh" targetScope={`${year} canonical odds`} />

        <div className="flex items-center gap-3">
          <button
            onClick={() => void runRefresh('rankings', setRankingsStatus, setRankingsError)}
            disabled={rankingsStatus === 'loading'}
            className={buttonClass}
          >
            {rankingsStatus === 'loading' ? 'Refreshing…' : 'Refresh Rankings'}
          </button>
          <StatusBadge status={rankingsStatus} error={rankingsError} />
        </div>
        <MaintenanceActionDetails
          action="rankings-refresh"
          targetScope={`${year} season (regular + postseason polls)`}
        />
      </section>
    </>
  );
}

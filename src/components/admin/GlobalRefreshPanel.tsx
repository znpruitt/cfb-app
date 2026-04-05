'use client';

import React, { useState } from 'react';

import { requireAdminAuthHeaders } from '@/lib/adminAuth';
import { seasonYearForToday } from '@/lib/scores/normalizers';

type SectionStatus = 'idle' | 'loading' | 'success' | 'error';

function StatusBadge({ status, error }: { status: SectionStatus; error?: string }) {
  if (status === 'loading') return <span className="text-xs text-zinc-400">Working…</span>;
  if (status === 'success') return <span className="text-xs text-green-400">Done</span>;
  if (status === 'error') return <span className="text-xs text-red-400">{error ?? 'Failed'}</span>;
  return null;
}

const sectionClass = 'rounded-lg border border-zinc-700 bg-zinc-900 p-5 space-y-3';
const buttonClass =
  'rounded border border-zinc-600 bg-zinc-800 px-4 py-1.5 text-sm text-zinc-100 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed';

export default function GlobalRefreshPanel(): React.ReactElement {
  const [year, setYear] = useState(seasonYearForToday());

  const [scheduleStatus, setScheduleStatus] = useState<SectionStatus>('idle');
  const [scheduleError, setScheduleError] = useState<string | undefined>();

  const [scoresStatus, setScoresStatus] = useState<SectionStatus>('idle');
  const [scoresError, setScoresError] = useState<string | undefined>();

  async function handleRebuildSchedule() {
    setScheduleStatus('loading');
    setScheduleError(undefined);
    try {
      const res = await fetch(`/api/schedule?bypassCache=1&year=${year}`, {
        cache: 'no-store',
        headers: requireAdminAuthHeaders() as Record<string, string>,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        setScheduleError(`Error ${res.status}${text ? `: ${text.slice(0, 120)}` : ''}`);
        setScheduleStatus('error');
        return;
      }
      setScheduleStatus('success');
    } catch (err) {
      setScheduleError(err instanceof Error ? err.message : 'Unexpected error');
      setScheduleStatus('error');
    }
  }

  async function handleRefreshScores() {
    setScoresStatus('loading');
    setScoresError(undefined);
    try {
      const [regularRes, postseasonRes] = await Promise.all([
        fetch(`/api/scores?seasonType=regular&year=${year}`, { cache: 'no-store' }),
        fetch(`/api/scores?seasonType=postseason&year=${year}`, { cache: 'no-store' }),
      ]);
      const failed = [
        !regularRes.ok ? `regular ${regularRes.status}` : null,
        !postseasonRes.ok ? `postseason ${postseasonRes.status}` : null,
      ].filter(Boolean);
      if (failed.length > 0) {
        setScoresError(`Error: ${failed.join(', ')}`);
        setScoresStatus('error');
        return;
      }
      setScoresStatus('success');
    } catch (err) {
      setScoresError(err instanceof Error ? err.message : 'Unexpected error');
      setScoresStatus('error');
    }
  }

  return (
    <>
      <div className="flex items-center gap-3">
        <label className="text-xs font-medium text-zinc-400">Season year</label>
        <input
          type="number"
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          min={2000}
          step={1}
          className="w-24 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-100 focus:border-zinc-500 focus:outline-none"
        />
      </div>

      <section className={sectionClass}>
        <div>
          <h2 className="text-base font-medium text-zinc-100">Schedule</h2>
          <p className="mt-1 text-sm text-zinc-400">
            Fetch the latest schedule from the data provider. Run when games appear missing or
            incorrect.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => void handleRebuildSchedule()}
            disabled={scheduleStatus === 'loading'}
            className={buttonClass}
          >
            {scheduleStatus === 'loading' ? 'Rebuilding…' : 'Rebuild Schedule'}
          </button>
          <StatusBadge status={scheduleStatus} error={scheduleError} />
        </div>
      </section>

      <section className={sectionClass}>
        <div>
          <h2 className="text-base font-medium text-zinc-100">Scores</h2>
          <p className="mt-1 text-sm text-zinc-400">
            Fetch the latest scores from the data provider for regular season and postseason.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => void handleRefreshScores()}
            disabled={scoresStatus === 'loading'}
            className={buttonClass}
          >
            {scoresStatus === 'loading' ? 'Refreshing…' : 'Refresh Scores'}
          </button>
          <StatusBadge status={scoresStatus} error={scoresError} />
        </div>
      </section>
    </>
  );
}

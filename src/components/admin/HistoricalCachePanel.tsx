'use client';

import { useState } from 'react';

import { getAdminAuthHeaders } from '@/lib/adminAuth';
import type { League } from '@/lib/league';

type Props = {
  leagues: League[];
};

type CacheResult = {
  success?: boolean;
  alreadyCached?: boolean;
  year?: number;
  gameCount?: number;
  scoreCount?: number;
  cachedAt?: string;
  error?: string;
};

export default function HistoricalCachePanel({ leagues }: Props) {
  const currentYear = new Date().getUTCFullYear();
  const [year, setYear] = useState(currentYear - 1);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scoresLoading, setScoresLoading] = useState(false);
  const [scheduleResult, setScheduleResult] = useState<CacheResult | null>(null);
  const [scoresResult, setScoresResult] = useState<CacheResult | null>(null);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [scoresError, setScoresError] = useState<string | null>(null);

  async function cacheSchedule() {
    setScheduleLoading(true);
    setScheduleResult(null);
    setScheduleError(null);
    try {
      const res = await fetch('/api/admin/cache-historical-schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAdminAuthHeaders() },
        body: JSON.stringify({ year, force: false }),
      });
      const data: CacheResult = await res.json();
      if (!res.ok) {
        setScheduleError(data.error ?? `Error ${res.status}`);
      } else {
        setScheduleResult(data);
      }
    } catch (err) {
      setScheduleError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setScheduleLoading(false);
    }
  }

  async function cacheScores() {
    setScoresLoading(true);
    setScoresResult(null);
    setScoresError(null);
    try {
      const res = await fetch('/api/admin/cache-historical-scores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAdminAuthHeaders() },
        body: JSON.stringify({ year, force: false }),
      });
      const data: CacheResult = await res.json();
      if (!res.ok) {
        setScoresError(data.error ?? `Error ${res.status}`);
      } else {
        setScoresResult(data);
      }
    } catch (err) {
      setScoresError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setScoresLoading(false);
    }
  }

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-5 space-y-4">
      <div>
        <h2 className="text-base font-semibold text-zinc-100">Historical Data Cache</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Cache schedule and scores for past seasons. Required before backfilling historical archives.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <label className="text-sm text-zinc-300">
          Year
          <input
            type="number"
            value={year}
            min={2000}
            max={currentYear - 1}
            onChange={(e) => setYear(Number(e.target.value))}
            className="ml-2 w-24 rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-zinc-500"
          />
        </label>
        {leagues.length > 0 && (
          <span className="text-xs text-zinc-500">{leagues.map((l) => l.slug).join(', ')}</span>
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="flex flex-col gap-1">
          <button
            onClick={cacheSchedule}
            disabled={scheduleLoading}
            className="rounded bg-zinc-700 px-4 py-2 text-sm font-medium text-zinc-100 hover:bg-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {scheduleLoading ? 'Caching…' : 'Cache Historical Schedule'}
          </button>
          {scheduleError && (
            <p className="text-xs text-red-400">{scheduleError}</p>
          )}
          {scheduleResult && (
            <p className="text-xs text-zinc-400">
              {scheduleResult.alreadyCached
                ? `Already cached for ${scheduleResult.year}`
                : `Cached ${scheduleResult.gameCount} games for ${scheduleResult.year}`}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <button
            onClick={cacheScores}
            disabled={scoresLoading}
            className="rounded bg-zinc-700 px-4 py-2 text-sm font-medium text-zinc-100 hover:bg-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {scoresLoading ? 'Caching…' : 'Cache Historical Scores'}
          </button>
          {scoresError && (
            <p className="text-xs text-red-400">{scoresError}</p>
          )}
          {scoresResult && (
            <p className="text-xs text-zinc-400">
              {scoresResult.alreadyCached
                ? `Already cached for ${scoresResult.year}`
                : `Cached ${scoresResult.scoreCount} scores for ${scoresResult.year}`}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

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
  const now = new Date();
  // CFB season starts in late August. Month >= 6 (Jul) means the current year is the active season
  // to cover preseason setup which begins before August.
  const currentSeasonYear = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  const defaultHistoricalYear = currentSeasonYear - 1;
  const [year, setYear] = useState(defaultHistoricalYear);
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
    <div className="rounded-lg border border-gray-200 bg-white p-5 space-y-4 dark:border-zinc-700 dark:bg-zinc-900">
      <div>
        <h2 className="text-base font-medium text-gray-900 dark:text-zinc-100">Historical Data Cache</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-zinc-400">
          Download and save schedule and score data for past seasons. Required before archiving historical seasons.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <label className="text-sm text-gray-600 dark:text-zinc-300">
          Year
          <input
            type="number"
            value={year}
            min={2000}
            max={defaultHistoricalYear}
            onChange={(e) => setYear(Number(e.target.value))}
            className="ml-2 w-24 rounded border border-gray-300 bg-gray-50 px-2 py-1 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-400 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:ring-zinc-500"
          />
        </label>
        {leagues.length > 0 && (
          <span className="text-xs text-gray-400 dark:text-zinc-500">{leagues.map((l) => l.slug).join(', ')}</span>
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="flex flex-col gap-1">
          <button
            onClick={cacheSchedule}
            disabled={scheduleLoading}
            className="rounded bg-gray-100 px-4 py-2 text-sm font-medium text-gray-900 transition-colors hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-600"
          >
            {scheduleLoading ? 'Caching…' : 'Cache Historical Schedule'}
          </button>
          {scheduleError && (
            <p className="text-xs text-red-600 dark:text-red-400">{scheduleError}</p>
          )}
          {scheduleResult && (
            <p className="text-xs text-gray-500 dark:text-zinc-400">
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
            className="rounded bg-gray-100 px-4 py-2 text-sm font-medium text-gray-900 transition-colors hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-600"
          >
            {scoresLoading ? 'Caching…' : 'Cache Historical Scores'}
          </button>
          {scoresError && (
            <p className="text-xs text-red-600 dark:text-red-400">{scoresError}</p>
          )}
          {scoresResult && (
            <p className="text-xs text-gray-500 dark:text-zinc-400">
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

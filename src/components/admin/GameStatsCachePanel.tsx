'use client';

import React, { useState } from 'react';

import { requireAdminAuthHeaders } from '@/lib/adminAuth';
import { seasonYearForToday } from '@/lib/scores/normalizers';

const buttonClass =
  'rounded border border-gray-300 bg-gray-50 px-4 py-1.5 text-sm text-gray-900 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700';

type Status = 'idle' | 'loading' | 'success' | 'error';

type GameStatsResult = {
  year: number;
  week: number;
  seasonType: string;
  fetchedAt: string;
  games: unknown[];
};

export default function GameStatsCachePanel({ defaultYear }: { defaultYear?: number } = {}) {
  const [year, setYear] = useState(defaultYear ?? seasonYearForToday());
  const [week, setWeek] = useState(1);
  const [seasonType, setSeasonType] = useState<'regular' | 'postseason'>('regular');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | undefined>();
  const [result, setResult] = useState<GameStatsResult | null>(null);

  async function handleRefresh() {
    setStatus('loading');
    setError(undefined);
    setResult(null);
    try {
      const params = new URLSearchParams({
        year: String(year),
        week: String(week),
        seasonType,
        bypassCache: '1',
      });
      const res = await fetch(`/api/game-stats?${params.toString()}`, {
        cache: 'no-store',
        headers: requireAdminAuthHeaders() as Record<string, string>,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        setError(`Error ${res.status}${text ? `: ${text.slice(0, 160)}` : ''}`);
        setStatus('error');
        return;
      }
      const data = (await res.json()) as GameStatsResult;
      setResult(data);
      setStatus('success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unexpected error');
      setStatus('error');
    }
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5 space-y-3 dark:border-zinc-700 dark:bg-zinc-900">
      <div>
        <h2 className="text-base font-medium text-gray-900 dark:text-zinc-100">Game Stats Cache</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-zinc-400">
          Fetch and cache team stats for a specific week. Run after each game week completes.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-zinc-400">
          Year
          <input
            type="number"
            value={year}
            onChange={(e) => { setYear(Number(e.target.value)); setResult(null); setError(undefined); }}
            min={2001}
            step={1}
            className="w-24 rounded border border-gray-300 bg-gray-50 px-2 py-1 text-sm text-gray-900 focus:border-gray-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-zinc-500"
          />
        </label>

        <label className="flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-zinc-400">
          Week
          <input
            type="number"
            value={week}
            onChange={(e) => { setWeek(Number(e.target.value)); setResult(null); setError(undefined); }}
            min={1}
            max={15}
            step={1}
            className="w-20 rounded border border-gray-300 bg-gray-50 px-2 py-1 text-sm text-gray-900 focus:border-gray-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-zinc-500"
          />
        </label>

        <label className="flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-zinc-400">
          Season type
          <select
            value={seasonType}
            onChange={(e) => { setSeasonType(e.target.value as 'regular' | 'postseason'); setResult(null); setError(undefined); }}
            className="rounded border border-gray-300 bg-gray-50 px-2 py-1 text-sm text-gray-900 focus:border-gray-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-zinc-500"
          >
            <option value="regular">Regular</option>
            <option value="postseason">Postseason</option>
          </select>
        </label>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => void handleRefresh()}
          disabled={status === 'loading'}
          className={buttonClass}
        >
          {status === 'loading' ? 'Fetching…' : 'Refresh Game Stats'}
        </button>
        {status === 'loading' && (
          <span className="text-xs text-gray-500 dark:text-zinc-400">Working…</span>
        )}
        {status === 'success' && result && (
          <span className="text-xs text-green-600 dark:text-green-400">
            Cached {result.games.length} game{result.games.length !== 1 ? 's' : ''} for week {result.week} ({result.seasonType})
          </span>
        )}
        {status === 'error' && (
          <span className="text-xs text-red-600 dark:text-red-400">{error ?? 'Failed'}</span>
        )}
      </div>
    </section>
  );
}

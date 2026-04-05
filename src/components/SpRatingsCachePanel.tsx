'use client';

import React, { useState } from 'react';
import { requireAdminAuthHeaders } from '@/lib/adminAuth';

const controlButtonClass =
  'px-3 py-2 rounded border border-gray-300 bg-white text-sm text-gray-900 transition-colors hover:bg-gray-50 hover:border-gray-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700/60';
const primaryButtonClass =
  'px-4 py-2 rounded border border-blue-600 bg-blue-600 text-sm font-medium text-white transition-colors hover:bg-blue-700 hover:border-blue-700 dark:border-blue-500 dark:bg-blue-600 dark:hover:bg-blue-700';

type CacheResult = {
  success?: boolean;
  alreadyCached?: boolean;
  status?: 'cached' | 'awaiting-ratings';
  year?: number;
  teamCount?: number;
  cachedAt?: string;
};

function defaultYear(): number {
  const now = new Date();
  const month = now.getUTCMonth();
  return month >= 7 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}

export default function SpRatingsCachePanel() {
  const [year, setYear] = useState<number>(defaultYear);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CacheResult | null>(null);

  async function handleCache(force: boolean) {
    setError(null);
    setLoading(true);
    try {
      const authHeaders = requireAdminAuthHeaders() as Record<string, string>;
      const res = await fetch('/api/admin/cache-sp-ratings', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeaders },
        body: JSON.stringify({ year, force }),
      });
      if (!res.ok) {
        const text = await res.text();
        setError(text || `POST /api/admin/cache-sp-ratings ${res.status}`);
        return;
      }
      const data = (await res.json()) as CacheResult;
      setResult(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
      <h2 className="mb-3 text-base font-medium text-gray-900 dark:text-zinc-100">
        SP+ Ratings Cache
      </h2>
      <p className="mb-3 text-sm text-gray-500 dark:text-zinc-400">
        Download and save SP+ power ratings for a season. Run this once before the draft.
      </p>

      <div className="mb-3 flex items-center gap-2">
        <label className="text-sm text-gray-700 dark:text-zinc-300">
          Year
          <input
            type="number"
            value={year}
            min={2000}
            onChange={(e) => {
              setResult(null);
              setError(null);
              setYear(Number(e.target.value));
            }}
            className="ml-2 w-24 rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
          />
        </label>
      </div>

      {result ? (
        <div className="space-y-2">
          {result.alreadyCached ? (
            <div className="text-sm text-gray-600 dark:text-zinc-400">
              SP+ ratings for {result.year ?? year} already cached ({result.teamCount} teams).{' '}
              <button
                className={controlButtonClass}
                onClick={() => void handleCache(true)}
                disabled={loading}
              >
                {loading ? 'Refreshing…' : 'Force refresh'}
              </button>
            </div>
          ) : result.status === 'awaiting-ratings' ? (
            <p className="text-sm text-amber-700 dark:text-amber-400">
              Ratings not yet available for {result.year ?? year}. Try again later.
            </p>
          ) : (
            <p className="text-sm text-green-700 dark:text-green-400">
              Cached {result.teamCount} teams for {result.year ?? year} (
              {result.cachedAt ? new Date(result.cachedAt).toLocaleString() : ''}).
            </p>
          )}
          <button
            className={controlButtonClass}
            onClick={() => {
              setResult(null);
              setError(null);
            }}
          >
            Reset
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <button
            className={primaryButtonClass}
            onClick={() => void handleCache(false)}
            disabled={loading}
          >
            {loading ? 'Caching…' : 'Cache SP+ Ratings'}
          </button>
          {error && <p className="text-sm text-red-700 dark:text-red-400">{error}</p>}
        </div>
      )}
    </section>
  );
}

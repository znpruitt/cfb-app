'use client';

import React, { useCallback, useState } from 'react';

import { fetchApiUsageSnapshot, type ApiUsageSnapshot } from '../lib/apiUsage';

function percentUsed(used: number, budget: number): string {
  if (!Number.isFinite(used) || !Number.isFinite(budget) || budget <= 0) return '0.0';
  return ((used / budget) * 100).toFixed(1);
}

type Props = {
  className?: string;
};

export default function AdminUsagePanel({ className }: Props): React.ReactElement {
  const [usage, setUsage] = useState<ApiUsageSnapshot | null>(null);
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);

  const loadUsage = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const snapshot = await fetchApiUsageSnapshot();
      setUsage(snapshot);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <details className={className}>
      <summary className="cursor-pointer text-sm font-medium text-gray-700 dark:text-zinc-300">
        Admin diagnostics: API usage
      </summary>
      <div className="mt-3 space-y-3 rounded border border-gray-200 bg-gray-50 p-3 text-sm dark:border-zinc-700 dark:bg-zinc-900">
        <p className="text-xs text-gray-600 dark:text-zinc-400">
          Exact per-process counters (not estimates). Resets when the server process restarts.
        </p>

        <button
          className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
          onClick={() => void loadUsage()}
          disabled={loading}
        >
          {loading ? 'Refreshing usage…' : 'Refresh usage'}
        </button>

        {error && <p className="text-xs text-red-700 dark:text-red-400">Usage error: {error}</p>}

        {usage && (
          <>
            <p className="text-xs text-gray-600 dark:text-zinc-400">
              Tracking started: {new Date(usage.startedAt).toLocaleString()}
            </p>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded border border-gray-200 bg-white p-2 dark:border-zinc-700 dark:bg-zinc-800">
                <h3 className="font-medium">Upstream monthly budgets</h3>
                <p className="text-xs text-gray-600 dark:text-zinc-400">
                  CFBD: {usage.upstreamCalls.cfbd}/{usage.budgets.cfbd} (
                  {percentUsed(usage.upstreamCalls.cfbd, usage.budgets.cfbd)}%)
                </p>
                <p className="text-xs text-gray-600 dark:text-zinc-400">
                  Odds API: {usage.upstreamCalls['odds-api']}/{usage.budgets['odds-api']} (
                  {percentUsed(usage.upstreamCalls['odds-api'], usage.budgets['odds-api'])}%)
                </p>
              </div>

              <div className="rounded border border-gray-200 bg-white p-2 dark:border-zinc-700 dark:bg-zinc-800">
                <h3 className="font-medium">Route request volume</h3>
                <p className="text-xs text-gray-600 dark:text-zinc-400">
                  schedule: {usage.routeRequests.schedule}
                </p>
                <p className="text-xs text-gray-600 dark:text-zinc-400">
                  scores: {usage.routeRequests.scores}
                </p>
                <p className="text-xs text-gray-600 dark:text-zinc-400">
                  odds: {usage.routeRequests.odds}
                </p>
              </div>
            </div>

            <div className="rounded border border-gray-200 bg-white p-2 dark:border-zinc-700 dark:bg-zinc-800">
              <h3 className="font-medium">Route cache outcomes</h3>
              <p className="text-xs text-gray-600 dark:text-zinc-400">
                schedule: hit {usage.routeCache.schedule.hit}, miss {usage.routeCache.schedule.miss}
              </p>
              <p className="text-xs text-gray-600 dark:text-zinc-400">
                scores: hit {usage.routeCache.scores.hit}, miss {usage.routeCache.scores.miss}
              </p>
              <p className="text-xs text-gray-600 dark:text-zinc-400">
                odds: hit {usage.routeCache.odds.hit}, miss {usage.routeCache.odds.miss}
              </p>
            </div>
          </>
        )}
      </div>
    </details>
  );
}

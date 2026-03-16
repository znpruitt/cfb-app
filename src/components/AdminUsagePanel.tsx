'use client';

import React, { useCallback, useState } from 'react';

import { fetchCfbdUsageSnapshot, type CfbdUsageSnapshot } from '../lib/apiUsage';

type Props = {
  className?: string;
};

export default function AdminUsagePanel({ className }: Props): React.ReactElement {
  const [usage, setUsage] = useState<CfbdUsageSnapshot | null>(null);
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);

  const loadUsage = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const snapshot = await fetchCfbdUsageSnapshot();
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
          CFBD usage is fetched from the official /info endpoint and cached for 10 minutes.
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
          <div className="rounded border border-gray-200 bg-white p-2 dark:border-zinc-700 dark:bg-zinc-800">
            <h3 className="font-medium">CFBD API Usage</h3>
            <p className="text-xs text-gray-600 dark:text-zinc-400">Used: {usage.used}</p>
            <p className="text-xs text-gray-600 dark:text-zinc-400">Remaining: {usage.remaining}</p>
            <p className="text-xs text-gray-600 dark:text-zinc-400">Limit: {usage.limit}</p>
            <p className="text-xs text-gray-600 dark:text-zinc-400">
              Patron level: {usage.patronLevel}
            </p>
          </div>
        )}
      </div>
    </details>
  );
}

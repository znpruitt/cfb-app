'use client';

import React, { useEffect, useState } from 'react';

type StorageStatusResponse = {
  storage?: {
    mode?: 'postgres' | 'file-fallback' | 'production-misconfigured';
    isProduction?: boolean;
    databaseConfigured?: boolean;
    filePath?: string;
  };
  adminTokenConfigured?: boolean;
  diagnostics?: {
    appState?: {
      persistence?: string;
      authoritative?: boolean;
    };
    routeCounters?: {
      persistence?: string;
      authoritative?: boolean;
    };
  };
};

export default function AdminStorageStatusPanel(): React.ReactElement {
  const [status, setStatus] = useState<StorageStatusResponse | null>(null);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    let cancelled = false;

    void fetch('/api/admin/storage', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error(`storage status ${response.status}`);
        return (await response.json()) as StorageStatusResponse;
      })
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const mode = status?.storage?.mode ?? 'unknown';

  return (
    <details>
      <summary className="cursor-pointer text-sm font-medium text-gray-700 dark:text-zinc-300">
        Storage Status
      </summary>
      <div className="mt-3 space-y-2 rounded border border-gray-200 bg-gray-50 p-3 text-sm dark:border-zinc-700 dark:bg-zinc-900">
        {error ? (
          <p className="text-xs text-red-700 dark:text-red-400">Status error: {error}</p>
        ) : null}
        <p className="text-xs text-gray-600 dark:text-zinc-400">Mode: {mode}</p>
        <p className="text-xs text-gray-600 dark:text-zinc-400">
          Environment: {status?.storage?.isProduction ? 'production' : 'local/dev'}
        </p>
        <p className="text-xs text-gray-600 dark:text-zinc-400">
          Database configured: {status?.storage?.databaseConfigured ? 'Yes' : 'No'}
        </p>
        <p className="text-xs text-gray-600 dark:text-zinc-400">
          Admin token configured on server: {status?.adminTokenConfigured ? 'Yes' : 'No'}
        </p>
        <p className="text-xs text-gray-600 dark:text-zinc-400">
          Authoritative shared state: {status?.diagnostics?.appState?.persistence ?? 'unknown'} (
          {status?.diagnostics?.appState?.authoritative ? 'authoritative' : 'not authoritative'})
        </p>
        <p className="text-xs text-gray-600 dark:text-zinc-400">
          Route counters: {status?.diagnostics?.routeCounters?.persistence ?? 'unknown'} (
          {status?.diagnostics?.routeCounters?.authoritative
            ? 'authoritative'
            : 'debug-only / ephemeral'}
          )
        </p>
        {mode === 'production-misconfigured' ? (
          <p className="text-xs text-red-700 dark:text-red-400">
            Production is misconfigured: shared durable storage is unavailable until DATABASE_URL is
            set.
          </p>
        ) : null}
      </div>
    </details>
  );
}

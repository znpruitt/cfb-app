'use client';

import React, { useState } from 'react';

import { syncTeamDatabase, type TeamDatabaseSyncResponse } from '../lib/api/teamDatabase';

export default function AdminTeamDatabasePanel(): React.ReactElement {
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [result, setResult] = useState<TeamDatabaseSyncResponse | null>(null);

  async function handleSync(): Promise<void> {
    setLoading(true);
    setError('');
    try {
      const next = await syncTeamDatabase();
      setResult(next);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <details>
      <summary className="cursor-pointer text-sm font-medium text-gray-700 dark:text-zinc-300">
        Admin diagnostics: team database
      </summary>
      <div className="mt-3 space-y-3 rounded border border-gray-200 bg-gray-50 p-3 text-sm dark:border-zinc-700 dark:bg-zinc-900">
        <p className="text-xs text-gray-600 dark:text-zinc-400">
          Manual-only CFBD team reference sync. This updates the local durable team database for
          future UI reads without adding any runtime fetches to page load or live refresh flows.
        </p>

        <button
          className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
          onClick={() => void handleSync()}
          disabled={loading}
        >
          {loading ? 'Updating team database…' : 'Update Team Database'}
        </button>

        {error ? (
          <p className="text-xs text-red-700 dark:text-red-400">Sync error: {error}</p>
        ) : null}

        {result ? (
          <div className="rounded border border-gray-200 bg-white p-2 dark:border-zinc-700 dark:bg-zinc-800">
            <h3 className="font-medium">Latest sync summary</h3>
            <p className="text-xs text-gray-600 dark:text-zinc-400">
              Updated: {new Date(result.updatedAt).toLocaleString()}
            </p>
            <p className="text-xs text-gray-600 dark:text-zinc-400">
              Fetched: {result.summary.fetchedCount}
            </p>
            <p className="text-xs text-gray-600 dark:text-zinc-400">
              Written: {result.summary.writtenCount}
            </p>
            <p className="text-xs text-gray-600 dark:text-zinc-400">
              Updated/new: {result.summary.updatedCount}
            </p>
            <p className="text-xs text-gray-600 dark:text-zinc-400">
              With primary color: {result.summary.withColorCount}
            </p>
            <p className="text-xs text-gray-600 dark:text-zinc-400">
              With alternate color: {result.summary.withAltColorCount}
            </p>
            <p className="text-xs text-gray-600 dark:text-zinc-400">
              Missing primary color: {result.summary.missingColorCount}
            </p>
            <p className="text-xs text-gray-600 dark:text-zinc-400">
              Skipped rows: {result.summary.skippedCount}
            </p>
            {result.summary.errors.length > 0 ? (
              <div className="mt-2 space-y-1">
                <p className="text-xs font-medium text-amber-700 dark:text-amber-300">
                  Normalization notes
                </p>
                <ul className="list-disc pl-5 text-xs text-amber-700 dark:text-amber-300">
                  {result.summary.errors.map((entry) => (
                    <li key={entry}>{entry}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-xs text-green-700 dark:text-green-400">No skipped rows.</p>
            )}
          </div>
        ) : null}
      </div>
    </details>
  );
}

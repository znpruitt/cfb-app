'use client';

import React, { useState } from 'react';

import { requireAdminAuthHeaders } from '@/lib/adminAuth';
import { syncTeamDatabase, type TeamDatabaseSyncResponse } from '@/lib/api/teamDatabase';
import MaintenanceActionDetails from './MaintenanceActionDetails';
import { interpretRefreshResponse, manualRefreshUrls } from './manualRefresh';

/**
 * PLATFORM-086F2D1 — the Reference Data section of Data Maintenance &
 * Recovery: the global Conferences refresh (relocated from System Health) and
 * the Team Database sync (relocated + renamed from the Diagnostics drill-down).
 * Both are routine, manual-only, year-independent reference mutations. The
 * conferences request uses the SAME URL authority and truthful outcome
 * interpreter the old Diagnostics button used (a 2xx serving the bundled
 * fallback never renders as success).
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

export default function ReferenceDataPanel(): React.ReactElement {
  const [conferencesStatus, setConferencesStatus] = useState<SectionStatus>('idle');
  const [conferencesError, setConferencesError] = useState<string | undefined>();

  const [syncLoading, setSyncLoading] = useState(false);
  const [syncError, setSyncError] = useState<string>('');
  const [syncResult, setSyncResult] = useState<TeamDatabaseSyncResponse | null>(null);

  async function handleConferencesRefresh() {
    setConferencesStatus('loading');
    setConferencesError(undefined);
    try {
      const [url] = manualRefreshUrls('conferences', { year: 0 });
      const outcome = await fetch(url!, {
        cache: 'no-store',
        headers: requireAdminAuthHeaders() as Record<string, string>,
      }).then(interpretRefreshResponse);
      if (!outcome.ok) {
        setConferencesError(
          outcome.kind === 'http'
            ? `Error ${outcome.status}`
            : 'Provider refresh failed; fallback data is still serving.'
        );
        setConferencesStatus('error');
        return;
      }
      setConferencesStatus('success');
    } catch (err) {
      setConferencesError(err instanceof Error ? err.message : 'Unexpected error');
      setConferencesStatus('error');
    }
  }

  async function handleTeamDatabaseSync(): Promise<void> {
    setSyncLoading(true);
    setSyncError('');
    try {
      const next = await syncTeamDatabase();
      setSyncResult(next);
    } catch (err) {
      setSyncError((err as Error).message);
    } finally {
      setSyncLoading(false);
    }
  }

  return (
    <section className={sectionClass}>
      <div>
        <h3 className="text-base font-medium text-gray-900 dark:text-zinc-100">
          Conference catalog &amp; team database
        </h3>
        <p className="mt-1 text-sm text-gray-500 dark:text-zinc-400">
          Global, year-independent reference datasets: the conference catalog and the canonical team
          database. Manual-only — no automation owns these.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => void handleConferencesRefresh()}
          disabled={conferencesStatus === 'loading'}
          className={buttonClass}
        >
          {conferencesStatus === 'loading' ? 'Refreshing…' : 'Refresh Conferences'}
        </button>
        <StatusBadge status={conferencesStatus} error={conferencesError} />
      </div>
      <MaintenanceActionDetails
        action="conferences-refresh"
        targetScope="Global conference reference data (year-independent)"
      />

      <div className="flex items-center gap-3">
        <button
          onClick={() => void handleTeamDatabaseSync()}
          disabled={syncLoading}
          className={buttonClass}
        >
          {syncLoading ? 'Updating team database…' : 'Update Team Database'}
        </button>
        {syncError && (
          <span className="text-xs text-red-600 dark:text-red-400">Sync error: {syncError}</span>
        )}
      </div>
      <MaintenanceActionDetails
        action="team-database-sync"
        targetScope="Global team catalog (all seasons)"
      />

      {syncResult && (
        <div className="rounded border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">
          <h4 className="font-medium text-gray-800 dark:text-zinc-200">Latest sync summary</h4>
          <p>Updated: {new Date(syncResult.updatedAt).toLocaleString()}</p>
          <p>Fetched: {syncResult.summary.fetchedCount}</p>
          <p>Written: {syncResult.summary.writtenCount}</p>
          <p>Updated/new: {syncResult.summary.updatedCount}</p>
          <p>With primary color: {syncResult.summary.withColorCount}</p>
          <p>With alternate color: {syncResult.summary.withAltColorCount}</p>
          <p>Missing primary color: {syncResult.summary.missingColorCount}</p>
          <p>Skipped rows: {syncResult.summary.skippedCount}</p>
          {syncResult.summary.errors.length > 0 ? (
            <div className="mt-2 space-y-1">
              <p className="font-medium text-amber-700 dark:text-amber-300">Normalization notes</p>
              <ul className="list-disc pl-5 text-amber-700 dark:text-amber-300">
                {syncResult.summary.errors.map((entry) => (
                  <li key={entry}>{entry}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-green-700 dark:text-green-400">No skipped rows.</p>
          )}
        </div>
      )}
    </section>
  );
}

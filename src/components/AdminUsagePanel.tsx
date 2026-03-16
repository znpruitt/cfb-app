'use client';

import React, { useCallback, useEffect, useState } from 'react';

import {
  fetchCfbdUsageSnapshot,
  fetchLatestOddsUsageSnapshot,
  type CfbdUsageSnapshot,
  type OddsUsageSnapshot,
} from '../lib/apiUsage';
import { getOddsQuotaGuardState } from '../lib/api/oddsUsage';

type Props = {
  className?: string;
  initialCfbdUsage?: CfbdUsageSnapshot | null;
  initialOddsUsage?: OddsUsageSnapshot | null;
};

export default function AdminUsagePanel({
  className,
  initialCfbdUsage = null,
  initialOddsUsage = null,
}: Props): React.ReactElement {
  const [cfbdUsage, setCfbdUsage] = useState<CfbdUsageSnapshot | null>(initialCfbdUsage);
  const [oddsUsage, setOddsUsage] = useState<OddsUsageSnapshot | null>(initialOddsUsage);
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);

  const loadUsage = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [cfbdSnapshot, oddsSnapshot] = await Promise.all([
        fetchCfbdUsageSnapshot(),
        fetchLatestOddsUsageSnapshot(),
      ]);
      setCfbdUsage(cfbdSnapshot);
      setOddsUsage(oddsSnapshot);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUsage();
  }, [loadUsage]);

  const quota = getOddsQuotaGuardState(oddsUsage?.remaining);

  return (
    <details className={className}>
      <summary className="cursor-pointer text-sm font-medium text-gray-700 dark:text-zinc-300">
        Admin diagnostics: API usage
      </summary>
      <div className="mt-3 space-y-3 rounded border border-gray-200 bg-gray-50 p-3 text-sm dark:border-zinc-700 dark:bg-zinc-900">
        <p className="text-xs text-gray-600 dark:text-zinc-400">
          CFBD usage is fetched from /api/admin/usage. Odds usage comes from the latest known
          server-side snapshot derived from Odds API response headers.
        </p>

        <button
          className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
          onClick={() => void loadUsage()}
          disabled={loading}
        >
          {loading ? 'Refreshing usage…' : 'Refresh usage'}
        </button>

        {error && <p className="text-xs text-red-700 dark:text-red-400">Usage error: {error}</p>}

        {cfbdUsage && (
          <div className="rounded border border-gray-200 bg-white p-2 dark:border-zinc-700 dark:bg-zinc-800">
            <h3 className="font-medium">CFBD API Usage</h3>
            <p className="text-xs text-gray-600 dark:text-zinc-400">Used: {cfbdUsage.used}</p>
            <p className="text-xs text-gray-600 dark:text-zinc-400">
              Remaining: {cfbdUsage.remaining}
            </p>
            <p className="text-xs text-gray-600 dark:text-zinc-400">Limit: {cfbdUsage.limit}</p>
            <p className="text-xs text-gray-600 dark:text-zinc-400">
              Patron level: {cfbdUsage.patronLevel}
            </p>
          </div>
        )}

        <div className="rounded border border-gray-200 bg-white p-2 dark:border-zinc-700 dark:bg-zinc-800">
          <h3 className="font-medium">Odds API Usage (latest known snapshot)</h3>
          {oddsUsage ? (
            <>
              <p className="text-xs text-gray-600 dark:text-zinc-400">Used: {oddsUsage.used}</p>
              <p className="text-xs text-gray-600 dark:text-zinc-400">
                Remaining: {oddsUsage.remaining}
              </p>
              <p className="text-xs text-gray-600 dark:text-zinc-400">
                Last Call Cost: {oddsUsage.lastCost}
              </p>
              <p className="text-xs text-gray-600 dark:text-zinc-400">Limit: {oddsUsage.limit}</p>
              <p className="text-xs text-gray-600 dark:text-zinc-400">
                Last Updated: {new Date(oddsUsage.capturedAt).toLocaleString()}
              </p>
              <p className="text-xs text-gray-600 dark:text-zinc-400">Source: {oddsUsage.source}</p>
              {oddsUsage.source === 'quota-error-fallback' && (
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  Note: this snapshot is a conservative fallback generated from a quota error
                  response when authoritative usage headers were unavailable.
                </p>
              )}
              <p className="text-xs text-gray-600 dark:text-zinc-400">
                Context: sport={oddsUsage.sportKey ?? 'n/a'}, markets=
                {(oddsUsage.markets ?? []).join(',') || 'n/a'}, regions=
                {(oddsUsage.regions ?? []).join(',') || 'n/a'}, endpoint=
                {oddsUsage.endpointType ?? 'n/a'}, cache={oddsUsage.cacheStatus ?? 'unknown'}
              </p>
              {quota.warning && (
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  Warning: low remaining Odds API credits ({oddsUsage.remaining}).
                </p>
              )}
              {quota.disableAutoRefresh && (
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  Auto odds refresh is disabled at remaining ≤ 10.
                </p>
              )}
              {quota.manualWarningOnly && (
                <p className="text-xs text-red-700 dark:text-red-300">
                  Critical quota: remaining ≤ 5. Manual odds refresh only with caution.
                </p>
              )}
            </>
          ) : (
            <p className="text-xs text-gray-600 dark:text-zinc-400">
              No odds usage snapshot yet. Run an odds refresh.
            </p>
          )}
        </div>
      </div>
    </details>
  );
}

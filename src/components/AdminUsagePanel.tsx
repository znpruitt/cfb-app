'use client';

import React, { useCallback, useEffect, useState } from 'react';

import {
  fetchCfbdUsageSnapshot,
  fetchLatestOddsUsageSnapshot,
  type CfbdUsageSnapshot,
  type OddsUsageSnapshot,
} from '../lib/apiUsage';
import { getOddsQuotaGuardState } from '../lib/api/oddsUsage';
import { formatQuotaSummary } from '../lib/api/providerQuota';

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
  // Authoritative reconciled CFBD quota — the SAME normalized object the Provider
  // Data Status panel renders, so the two surfaces cannot disagree. Raw provider
  // fields are shown only as clearly-labeled diagnostic detail below.
  const cfbdQuota = cfbdUsage ? formatQuotaSummary(cfbdUsage.normalized) : null;

  return (
    <details className={className}>
      <summary className="cursor-pointer text-sm font-medium text-gray-700 dark:text-zinc-300">
        API Usage
      </summary>
      <div className="mt-3 space-y-3 rounded border border-gray-200 bg-gray-50 p-3 text-sm dark:border-zinc-700 dark:bg-zinc-900">
        <p className="text-xs text-gray-600 dark:text-zinc-400">
          CFBD usage is an authoritative provider response at request time. Odds usage is the latest
          known shared durable snapshot captured from Odds API response headers. In-memory route
          counters are separate debug-only signals and are not shown here.
        </p>

        <button
          className="rounded border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
          onClick={() => void loadUsage()}
          disabled={loading}
        >
          {loading ? 'Refreshing usage…' : 'Refresh usage'}
        </button>
        <p className="text-[11px] text-gray-500 dark:text-zinc-500">
          “Refresh usage” issues one CFBD <code>/info</code> request (cached ~10 min) plus a durable
          odds-snapshot read; the odds snapshot itself spends no Odds API quota.
        </p>

        {error && <p className="text-xs text-red-700 dark:text-red-400">Usage error: {error}</p>}

        {cfbdUsage && cfbdQuota && (
          <div className="rounded border border-gray-200 bg-white p-2 dark:border-zinc-700 dark:bg-zinc-800">
            <h3 className="font-medium">CFBD API Usage</h3>
            <p className="text-xs text-gray-600 dark:text-zinc-400">Quota: {cfbdQuota.text}</p>
            <p className="text-xs text-gray-600 dark:text-zinc-400">
              Patron level: {cfbdUsage.patronLevel} (
              {cfbdUsage.normalized.source ?? 'provider read'})
            </p>
            {cfbdQuota.inconsistent && cfbdQuota.detail && (
              <p className="text-xs text-amber-700 dark:text-amber-300">
                Raw provider values are internally inconsistent ({cfbdQuota.detail}); the reconciled
                Tier value above is authoritative.
              </p>
            )}
            <p className="text-[11px] text-gray-500 dark:text-zinc-500">
              Raw provider response (diagnostic detail): used {cfbdUsage.used}, remaining{' '}
              {cfbdUsage.remaining}, limit {cfbdUsage.limit}.
            </p>
            <p className="text-xs text-gray-600 dark:text-zinc-400">
              Classification: authoritative provider read (ephemeral per request).
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
              <p className="text-xs text-gray-600 dark:text-zinc-400">
                Classification: shared durable snapshot (authoritative for last captured value, not
                a live provider read).
              </p>
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

'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { getAdminAuthHeaders } from '@/lib/adminAuth';
import type { LeagueStatus } from '@/lib/league';
import {
  buildManualRolloverRequest,
  describeManualRolloverReason,
  describeManualRolloverRefusal,
  parseManualRolloverStatusResponse,
  type ManualRolloverExecuteResponse,
  type ManualRolloverPreviewResponse,
  type ManualRolloverYearStatus,
} from '@/lib/manualRollover';

const sectionClass =
  'rounded-lg border border-gray-200 bg-white p-5 space-y-3 dark:border-zinc-700 dark:bg-zinc-900';
const buttonClass =
  'rounded border border-gray-300 bg-gray-50 px-4 py-1.5 text-sm text-gray-900 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700';
const destructiveButtonClass =
  'rounded border border-red-400 bg-red-50 px-4 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed dark:border-red-800 dark:bg-red-950 dark:text-red-300 dark:hover:bg-red-900';

function formatStatus(status: LeagueStatus | undefined): string {
  if (!status) return 'unknown';
  if (status.state === 'offseason') return 'offseason';
  if (status.state === 'preseason') return `preseason ${status.year}`;
  return `season ${status.year}`;
}

function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * PLATFORM-086F2B — one lifecycle year's row in the maintenance panel. Each
 * year renders its own instance (keyed by year) so preview/confirmation state
 * can never cross-wire between years; every request carries this row's
 * explicit year, and execute controls exist only while the year is eligible.
 */
function YearRow({
  status,
  onCompleted,
}: {
  status: ManualRolloverYearStatus;
  onCompleted: () => Promise<void>;
}) {
  const router = useRouter();
  const { year } = status;
  const leagueCount = status.leagues.length;

  const [previewLoading, setPreviewLoading] = useState(false);
  const [executeLoading, setExecuteLoading] = useState(false);
  const [preview, setPreview] = useState<ManualRolloverPreviewResponse['preview'] | null>(null);
  const [executeResult, setExecuteResult] = useState<ManualRolloverExecuteResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const busy = previewLoading || executeLoading;
  const eligible = status.eligibility === 'eligible';

  async function refusalMessage(res: Response): Promise<string> {
    const payload: unknown = await res.json().catch(() => null);
    return describeManualRolloverRefusal(payload) ?? `Error ${res.status}`;
  }

  async function handlePreview() {
    setPreviewLoading(true);
    setError(null);
    setExecuteResult(null);
    try {
      const res = await fetch('/api/admin/rollover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAdminAuthHeaders() },
        body: JSON.stringify(buildManualRolloverRequest(year, false)),
      });
      if (!res.ok) {
        setError(await refusalMessage(res));
        await onCompleted();
        return;
      }
      const data = (await res.json()) as ManualRolloverPreviewResponse;
      setPreview(data.preview);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unexpected error');
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleExecute() {
    const ok = window.confirm(
      `This will archive the ${year} season and transition ${leagueCount} league${leagueCount !== 1 ? 's' : ''} to offseason. This cannot be undone. Continue?`
    );
    if (!ok) return;

    setExecuteLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/rollover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAdminAuthHeaders() },
        body: JSON.stringify(buildManualRolloverRequest(year, true)),
      });
      if (!res.ok) {
        setError(await refusalMessage(res));
        // The gate refused after a previously eligible preview — drop the
        // stale preview and resync the per-year status.
        setPreview(null);
        await onCompleted();
        return;
      }
      const data = (await res.json()) as ManualRolloverExecuteResponse;
      setExecuteResult(data);
      setPreview(null);
      // Refresh the RSC tree and reload per-year status so admin/league
      // surfaces reflect the archived season.
      router.refresh();
      await onCompleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unexpected error');
    } finally {
      setExecuteLoading(false);
    }
  }

  return (
    <div className="rounded border border-gray-200 bg-gray-50 p-3 dark:border-zinc-700 dark:bg-zinc-800">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-gray-900 dark:text-zinc-100">Season {year}</span>
        <span className="text-xs text-gray-500 dark:text-zinc-400">
          {leagueCount} league{leagueCount !== 1 ? 's' : ''}
        </span>
        {eligible ? (
          <span className="ml-auto rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-950 dark:text-green-300">
            Eligible for rollover
          </span>
        ) : status.eligibility === 'unavailable' ? (
          <span className="ml-auto rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
            Eligibility unavailable
          </span>
        ) : (
          <span className="ml-auto rounded bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-700 dark:bg-zinc-700 dark:text-zinc-300">
            Not eligible
          </span>
        )}
      </div>

      {!eligible && (
        <p className="mt-2 text-xs text-gray-600 dark:text-zinc-300">
          {describeManualRolloverReason(status.reason)}
        </p>
      )}

      {eligible && status.rolloverDate && (
        <p className="mt-2 text-xs text-gray-500 dark:text-zinc-400">
          Championship played {formatDate(status.championshipDate) ?? '—'}; automatic rollover due{' '}
          {formatDate(status.rolloverDate) ?? '—'}.
        </p>
      )}

      {eligible && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button onClick={() => void handlePreview()} disabled={busy} className={buttonClass}>
            {previewLoading ? 'Loading preview…' : preview ? 'Refresh Preview' : 'Preview Rollover'}
          </button>
          {preview && !executeResult && (
            <button
              onClick={() => void handleExecute()}
              disabled={busy}
              className={destructiveButtonClass}
            >
              {executeLoading ? 'Executing…' : `Execute Rollover (${year})`}
            </button>
          )}
        </div>
      )}
      {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}

      {preview && !executeResult && (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-gray-500 dark:text-zinc-400">
            Previewing rollover for season <span className="font-medium">{preview.year}</span>.{' '}
            {preview.leagues.length} league{preview.leagues.length !== 1 ? 's' : ''} affected.
          </p>
          <ul className="space-y-3">
            {preview.leagues.map((league) => (
              <li
                key={league.leagueSlug}
                className="rounded border border-gray-200 bg-white p-3 text-sm dark:border-zinc-600 dark:bg-zinc-900"
              >
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-medium text-gray-900 dark:text-zinc-100">
                    {league.displayName}
                  </span>
                  <span className="text-xs text-gray-500 dark:text-zinc-400">
                    ({league.leagueSlug})
                  </span>
                  <span className="ml-auto text-xs text-gray-500 dark:text-zinc-400">
                    {formatStatus(league.status)}
                  </span>
                </div>
                {league.error ? (
                  <p className="mt-1 text-xs text-red-600 dark:text-red-400">{league.error}</p>
                ) : (
                  <div className="mt-2 space-y-1 text-xs text-gray-600 dark:text-zinc-300">
                    {league.champion ? (
                      <p>
                        Champion: <span className="font-medium">{league.champion}</span>
                      </p>
                    ) : (
                      <p className="text-gray-500 dark:text-zinc-400">Champion: (no standings)</p>
                    )}
                    {league.top3.length > 0 && (
                      <ol className="ml-4 list-decimal space-y-0.5">
                        {league.top3.map((row) => (
                          <li key={row.owner}>
                            {row.owner} — {row.wins}-{row.losses}
                            {row.ties > 0 ? `-${row.ties}` : ''}
                          </li>
                        ))}
                      </ol>
                    )}
                    <p className="pt-1">
                      Archive:{' '}
                      <span className="font-medium">
                        {league.hasExistingArchive ? 'exists (will overwrite)' : 'new'}
                      </span>
                    </p>
                    {league.diff && (
                      <p className="text-gray-500 dark:text-zinc-400">
                        Diff vs. existing: {league.diff.scoresChanged} score changes,{' '}
                        {league.diff.outcomesFlipped} outcome flips
                        {league.diff.standingsOrderChanged ? ', standings order changed' : ''}
                      </p>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {executeResult && (
        <div className="mt-3 space-y-2">
          {executeResult.success ? (
            <p className="rounded border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-300">
              Rollover complete — the {executeResult.year} season was archived and{' '}
              {executeResult.rolledOverLeagues.length} league
              {executeResult.rolledOverLeagues.length !== 1 ? 's' : ''} transitioned to offseason.
            </p>
          ) : (
            <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
              {executeResult.message ?? 'Rollover failed.'}
            </p>
          )}
          {executeResult.rolledOverLeagues.length > 0 && (
            <ul className="space-y-0.5 text-xs text-gray-600 dark:text-zinc-300">
              {executeResult.rolledOverLeagues.map((slug) => (
                <li key={slug}>✓ {slug}</li>
              ))}
            </ul>
          )}
          {executeResult.errors.length > 0 && (
            <ul className="space-y-0.5 text-xs text-red-600 dark:text-red-400">
              {executeResult.errors.map((err) => (
                <li key={`${err.stage}:${err.leagueSlug}`}>
                  ✗ {err.leagueSlug} ({err.stage}): {err.error}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default function SeasonRolloverPanel({
  nextRolloverDate,
}: {
  nextRolloverDate?: string | null;
} = {}): React.ReactElement {
  const [years, setYears] = useState<ManualRolloverYearStatus[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch('/api/admin/rollover', {
        cache: 'no-store',
        headers: getAdminAuthHeaders(),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        setLoadError(text || `GET /api/admin/rollover ${res.status}`);
        return;
      }
      const data = parseManualRolloverStatusResponse(await res.json());
      if (!data) {
        setLoadError('Unexpected rollover status response shape.');
        return;
      }
      setYears(data.years);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Unexpected error');
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const rolloverDateDisplay = formatDate(nextRolloverDate);

  return (
    <section className={sectionClass}>
      <div>
        <h2 className="text-base font-medium text-gray-900 dark:text-zinc-100">Season Rollover</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-zinc-400">
          Archive a completed season and transition its non-test leagues to offseason. Each active
          season year is evaluated independently against the same strict eligibility gate the
          automatic rollover uses (structured CFP national championship, confirmed final, seven-day
          waiting period) — manual rollover cannot bypass it.
        </p>
      </div>

      {rolloverDateDisplay && (
        <p className="text-xs text-gray-500 dark:text-zinc-400">
          Next automatic rollover: <span className="font-medium">{rolloverDateDisplay}</span>
        </p>
      )}

      {loadError && <p className="text-xs text-red-600 dark:text-red-400">{loadError}</p>}
      {!loadError && years === null && (
        <p className="text-xs text-gray-500 dark:text-zinc-400">Loading rollover status…</p>
      )}
      {years !== null && years.length === 0 && (
        <p className="text-xs text-gray-500 dark:text-zinc-400">
          No production league is currently in season — nothing to roll over.
        </p>
      )}

      {years !== null && years.length > 0 && (
        <div className="space-y-3">
          {years.map((yearStatus) => (
            <YearRow key={yearStatus.year} status={yearStatus} onCompleted={loadStatus} />
          ))}
        </div>
      )}
    </section>
  );
}

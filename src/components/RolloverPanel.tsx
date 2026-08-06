'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { requireAdminAuthHeaders } from '@/lib/adminAuth';
import {
  buildManualRolloverRequest,
  describeManualRolloverRefusal,
  parseManualRolloverStatusResponse,
  type ManualRolloverExecuteResponse,
  type ManualRolloverPreviewResponse,
  type ManualRolloverYearStatus,
} from '@/lib/manualRollover';

const controlButtonClass =
  'px-3 py-2 rounded border border-gray-300 bg-white text-sm text-gray-900 transition-colors hover:bg-gray-50 hover:border-gray-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700/60';
const primaryButtonClass =
  'px-4 py-2 rounded border border-blue-600 bg-blue-600 text-sm font-medium text-white transition-colors hover:bg-blue-700 hover:border-blue-700 dark:border-blue-500 dark:bg-blue-600 dark:hover:bg-blue-700';
const dangerButtonClass =
  'px-4 py-2 rounded border border-red-600 bg-red-600 text-sm font-medium text-white transition-colors hover:bg-red-700 hover:border-red-700 dark:border-red-500 dark:bg-red-600 dark:hover:bg-red-700';

type PreviewData = ManualRolloverPreviewResponse['preview'];

/**
 * PLATFORM-086F2B — one eligible year's preview/confirm flow. Each eligible
 * year renders its own section instance (keyed by year), so preview and
 * confirmation state can never cross-wire between years, and every request
 * carries this section's explicit year. Execute RESULTS are reported up to the
 * panel (not held here): a successful rollover removes this year from the
 * eligible list, unmounting this section on the post-success status reload.
 */
function EligibleYearSection({
  status,
  onRefused,
  onExecuted,
}: {
  status: ManualRolloverYearStatus;
  onRefused: () => Promise<void>;
  onExecuted: (result: ManualRolloverExecuteResponse) => Promise<void>;
}) {
  const { year } = status;
  const leagueCount = status.leagues.length;

  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  async function refusalMessage(res: Response): Promise<string> {
    const payload: unknown = await res.json().catch(() => null);
    return describeManualRolloverRefusal(payload) ?? `POST /api/admin/rollover ${res.status}`;
  }

  async function handlePreview() {
    setPreviewError(null);
    setConfirmError(null);
    setPreview(null);
    setPreviewing(true);
    try {
      const authHeaders = requireAdminAuthHeaders() as Record<string, string>;
      const res = await fetch('/api/admin/rollover', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeaders },
        body: JSON.stringify(buildManualRolloverRequest(year, false)),
      });
      if (!res.ok) {
        setPreviewError(await refusalMessage(res));
        // A refusal means eligibility changed since load — resync the status.
        await onRefused();
        return;
      }
      const data = (await res.json()) as ManualRolloverPreviewResponse;
      setPreview(data.preview);
    } catch (err) {
      setPreviewError((err as Error).message);
    } finally {
      setPreviewing(false);
    }
  }

  async function handleConfirm() {
    setConfirmError(null);
    setConfirming(true);
    try {
      const authHeaders = requireAdminAuthHeaders() as Record<string, string>;
      const res = await fetch('/api/admin/rollover', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeaders },
        body: JSON.stringify(buildManualRolloverRequest(year, true)),
      });
      if (!res.ok) {
        setConfirmError(await refusalMessage(res));
        // The gate refused after a previously eligible preview — the preview is
        // stale authorization for nothing. Drop it and resync.
        setPreview(null);
        await onRefused();
        return;
      }
      const data = (await res.json()) as ManualRolloverExecuteResponse;
      setPreview(null);
      // Report up: the panel renders the result banner (this section may
      // unmount on the reload) and reloads the per-year status.
      await onExecuted(data);
    } catch (err) {
      setConfirmError((err as Error).message);
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div className="mb-4 rounded-2xl border border-amber-300 bg-amber-50/80 p-4 shadow-sm dark:border-amber-700/60 dark:bg-amber-950/20">
      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700 dark:text-amber-400">
          Season Rollover
        </p>
        <h2 className="text-xl font-semibold text-gray-950 dark:text-zinc-50">
          Season {year} is complete — ready to archive
        </h2>
        <p className="max-w-2xl text-sm text-gray-600 dark:text-zinc-300">
          The CFP National Championship has been played. Clicking <strong>Preview Rollover</strong>{' '}
          will show what will be archived for each of the {leagueCount} league
          {leagueCount !== 1 ? 's' : ''} in the {year} season. Clicking{' '}
          <strong>Confirm Rollover</strong> will archive the {year} season for{' '}
          {leagueCount !== 1 ? `those ${leagueCount} leagues` : 'that league'} and set{' '}
          {leagueCount !== 1 ? 'them' : 'it'} to offseason status.
        </p>
      </div>

      <div className="mt-4 space-y-4">
        {!preview && (
          <div className="flex items-center gap-3">
            <button
              className={primaryButtonClass}
              onClick={() => void handlePreview()}
              disabled={previewing}
            >
              {previewing ? 'Building preview…' : 'Preview Rollover'}
            </button>
            {(previewError ?? confirmError) && (
              <p className="text-sm text-red-700 dark:text-red-400">
                {previewError ?? confirmError}
              </p>
            )}
          </div>
        )}

        {preview && (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">
              Rollover preview — {preview.year} season
            </h3>

            <div className="space-y-3">
              {preview.leagues.map((league) => (
                <div
                  key={league.leagueSlug}
                  className="rounded-lg border border-gray-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900"
                >
                  <p className="text-sm font-medium text-gray-900 dark:text-zinc-100">
                    {league.displayName}{' '}
                    <span className="font-mono text-xs text-gray-500 dark:text-zinc-400">
                      ({league.leagueSlug})
                    </span>
                  </p>

                  {league.error ? (
                    <p className="mt-1 text-xs text-red-700 dark:text-red-400">
                      Error: {league.error}
                    </p>
                  ) : league.hasExistingArchive && league.diff ? (
                    <div className="mt-2 space-y-1 text-xs text-gray-600 dark:text-zinc-400">
                      <p className="font-medium text-amber-700 dark:text-amber-400">
                        Existing {preview.year} archive will be overwritten
                      </p>
                      <p>
                        Score changes: {league.diff.scoresChanged} owner records affected
                        {league.diff.scoresChanged === 0 ? ' (none)' : ''}
                      </p>
                      <p>
                        Outcome flips: {league.diff.outcomesFlipped} owner records affected
                        {league.diff.outcomesFlipped > 0 &&
                          league.diff.ownersAffectedByFlip.length > 0 && (
                            <> — {league.diff.ownersAffectedByFlip.join(', ')}</>
                          )}
                      </p>
                      <p>
                        Final standings order:{' '}
                        {league.diff.standingsOrderChanged ? (
                          <>
                            changed —{' '}
                            {league.diff.standingsMovement
                              .map((m) => `${m.ownerName} ${m.previousPosition}→${m.newPosition}`)
                              .join(', ')}
                          </>
                        ) : (
                          'unchanged'
                        )}
                      </p>
                    </div>
                  ) : (
                    <p className="mt-1 text-xs text-green-700 dark:text-green-400">
                      New archive — {preview.year} season will be written fresh
                    </p>
                  )}
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                className={dangerButtonClass}
                onClick={() => void handleConfirm()}
                disabled={confirming}
              >
                {confirming
                  ? 'Archiving…'
                  : `Confirm Rollover — archive the ${preview.year} season (${leagueCount} league${leagueCount !== 1 ? 's' : ''})`}
              </button>
              <button
                className={controlButtonClass}
                onClick={() => {
                  setPreview(null);
                  setConfirmError(null);
                }}
                disabled={confirming}
              >
                Cancel
              </button>
              {confirmError && (
                <p className="text-sm text-red-700 dark:text-red-400">{confirmError}</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** The persistent execute-result banner — survives the executed year leaving the eligible list. */
function ResultBanner({ result }: { result: ManualRolloverExecuteResponse }) {
  return (
    <div className="mb-4 rounded-2xl border border-gray-300 bg-gray-50/80 p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-900/60">
      <div className="space-y-3">
        {result.success ? (
          <p className="text-sm font-medium text-green-700 dark:text-green-400">
            Season {result.year} archived. {result.rolledOverLeagues.length} league
            {result.rolledOverLeagues.length !== 1 ? 's' : ''} set to offseason.
          </p>
        ) : (
          <p className="text-sm font-medium text-red-700 dark:text-red-400">
            {result.message ?? 'Rollover did not fully complete.'}
          </p>
        )}
        {result.rolledOverLeagues.length > 0 && (
          <p className="text-sm text-gray-600 dark:text-zinc-400">
            Rolled over: {result.rolledOverLeagues.join(', ')}
          </p>
        )}
        {result.errors.length > 0 && (
          <div className="space-y-1">
            {result.errors.map((e) => (
              <p
                key={`${e.stage}:${e.leagueSlug}`}
                className="text-sm text-red-700 dark:text-red-400"
              >
                {e.leagueSlug} ({e.stage}): {e.error}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function RolloverPanel() {
  const [years, setYears] = useState<ManualRolloverYearStatus[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<ManualRolloverExecuteResponse | null>(null);

  const loadStatus = useCallback(async () => {
    setLoadError(null);
    try {
      let authHeaders: Record<string, string>;
      try {
        authHeaders = requireAdminAuthHeaders() as Record<string, string>;
      } catch {
        setLoadError('No admin token found — please enter your admin token above.');
        return;
      }
      const res = await fetch('/api/admin/rollover', {
        cache: 'no-store',
        headers: authHeaders,
      });
      if (!res.ok) {
        // The GET can now answer with a typed refusal (409 registry-malformed).
        // `res.text()` rendered that JSON body verbatim as prose; the
        // operator-readable string already exists for exactly this case.
        //
        // This panel deliberately still HIDES when no year is eligible: it owns
        // execute controls only, and ineligible/unavailable years surface on
        // SeasonRolloverPanel, which R4 made truthful about refused records.
        const payload: unknown = await res.json().catch(() => null);
        setLoadError(
          describeManualRolloverRefusal(payload) ?? `GET /api/admin/rollover ${res.status}`
        );
        return;
      }
      const data = parseManualRolloverStatusResponse(await res.json());
      if (!data) {
        setLoadError('Unexpected rollover status response shape.');
        return;
      }
      setYears(data.years);
    } catch (err) {
      setLoadError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const handleExecuted = useCallback(
    async (result: ManualRolloverExecuteResponse) => {
      setLastResult(result);
      await loadStatus();
    },
    [loadStatus]
  );

  if (loadError) {
    return (
      <div className="mb-4 rounded-2xl border border-gray-300 bg-gray-50/80 p-4 text-sm text-red-700 shadow-sm dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-red-400">
        Season rollover status unavailable: {loadError}
      </div>
    );
  }

  // Execute controls exist ONLY for eligible years; this panel stays hidden
  // until at least one active season year passes the strict gate (ineligible
  // and unavailable years surface on the Season Management per-year status
  // panel — SeasonRolloverPanel, PLATFORM-086F2C). A just-executed rollover
  // keeps its result banner visible even after the executed year drops out of
  // the eligible list.
  const eligibleYears = (years ?? []).filter((y) => y.eligibility === 'eligible');
  if (eligibleYears.length === 0 && !lastResult) return null;

  return (
    <>
      {lastResult && <ResultBanner result={lastResult} />}
      {eligibleYears.map((yearStatus) => (
        <EligibleYearSection
          key={yearStatus.year}
          status={yearStatus}
          onRefused={loadStatus}
          onExecuted={handleExecuted}
        />
      ))}
    </>
  );
}

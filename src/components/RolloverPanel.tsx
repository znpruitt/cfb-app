'use client';

import React, { useEffect, useState } from 'react';
import { requireAdminAuthHeaders } from '@/lib/adminAuth';
import type { PublicLeague } from '@/lib/league';
import type { SeasonArchiveDiff } from '@/lib/seasonArchive';

const controlButtonClass =
  'px-3 py-2 rounded border border-gray-300 bg-white text-sm text-gray-900 transition-colors hover:bg-gray-50 hover:border-gray-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700/60';
const primaryButtonClass =
  'px-4 py-2 rounded border border-blue-600 bg-blue-600 text-sm font-medium text-white transition-colors hover:bg-blue-700 hover:border-blue-700 dark:border-blue-500 dark:bg-blue-600 dark:hover:bg-blue-700';
const dangerButtonClass =
  'px-4 py-2 rounded border border-red-600 bg-red-600 text-sm font-medium text-white transition-colors hover:bg-red-700 hover:border-red-700 dark:border-red-500 dark:bg-red-600 dark:hover:bg-red-700';

type StatusData = {
  seasonComplete: boolean;
  currentYear: number;
  leagues: PublicLeague[];
};

type LeaguePreview = {
  leagueSlug: string;
  displayName: string;
  hasExistingArchive: boolean;
  diff: SeasonArchiveDiff | null;
  error: string | null;
};

type PreviewData = {
  currentYear: number;
  leagues: LeaguePreview[];
};

type RolloverResult = {
  success: boolean;
  archivedLeagues: string[];
  errors: Array<{ leagueSlug: string; error: string }>;
};

export default function RolloverPanel() {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [result, setResult] = useState<RolloverResult | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  useEffect(() => {
    void loadStatus();
  }, []);

  async function loadStatus() {
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
        const text = await res.text();
        setLoadError(text || `GET /api/admin/rollover ${res.status}`);
        return;
      }
      const data = (await res.json()) as StatusData;
      setStatus(data);
    } catch (err) {
      setLoadError((err as Error).message);
    }
  }

  async function handlePreview() {
    setPreviewError(null);
    setPreview(null);
    setResult(null);
    setPreviewing(true);
    try {
      const authHeaders = requireAdminAuthHeaders() as Record<string, string>;
      const res = await fetch('/api/admin/rollover', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeaders },
        body: JSON.stringify({ confirmed: false }),
      });
      if (!res.ok) {
        const text = await res.text();
        setPreviewError(text || `POST /api/admin/rollover ${res.status}`);
        return;
      }
      const data = (await res.json()) as { preview: PreviewData };
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
        body: JSON.stringify({ confirmed: true }),
      });
      if (!res.ok) {
        const text = await res.text();
        setConfirmError(text || `POST /api/admin/rollover ${res.status}`);
        return;
      }
      const data = (await res.json()) as RolloverResult;
      setResult(data);
      setPreview(null);
      // Reload status to reflect new year
      await loadStatus();
    } catch (err) {
      setConfirmError((err as Error).message);
    } finally {
      setConfirming(false);
    }
  }

  if (loadError) {
    return (
      <div className="mb-4 rounded-2xl border border-gray-300 bg-gray-50/80 p-4 text-sm text-red-700 shadow-sm dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-red-400">
        Season rollover status unavailable: {loadError}
      </div>
    );
  }

  if (!status || !status.seasonComplete) return null;

  const { currentYear } = status;

  return (
    <div className="mb-4 rounded-2xl border border-amber-300 bg-amber-50/80 p-4 shadow-sm dark:border-amber-700/60 dark:bg-amber-950/20">
      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700 dark:text-amber-400">
          Season Rollover
        </p>
        <h2 className="text-xl font-semibold text-gray-950 dark:text-zinc-50">
          Season {currentYear} is complete — ready to archive
        </h2>
        <p className="max-w-2xl text-sm text-gray-600 dark:text-zinc-300">
          The CFP National Championship has been played. Clicking <strong>Preview Rollover</strong>{' '}
          will show what will be archived for each league. Clicking{' '}
          <strong>Confirm Rollover</strong> will archive the {currentYear} season for all leagues
          and set them to offseason status.
        </p>
      </div>

      {result ? (
        <div className="mt-4 space-y-3">
          <p className="text-sm font-medium text-green-700 dark:text-green-400">
            Season {currentYear} archived. All leagues set to offseason.
          </p>
          {result.archivedLeagues.length > 0 && (
            <p className="text-sm text-gray-600 dark:text-zinc-400">
              Archived: {result.archivedLeagues.join(', ')}
            </p>
          )}
          {result.errors.length > 0 && (
            <div className="space-y-1">
              {result.errors.map((e) => (
                <p key={e.leagueSlug} className="text-sm text-red-700 dark:text-red-400">
                  {e.leagueSlug}: {e.error}
                </p>
              ))}
            </div>
          )}
        </div>
      ) : (
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
              {previewError && (
                <p className="text-sm text-red-700 dark:text-red-400">{previewError}</p>
              )}
            </div>
          )}

          {preview && (
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">
                Rollover preview — {preview.currentYear} season
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
                          Existing {preview.currentYear} archive will be overwritten
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
                        New archive — {preview.currentYear} season will be written fresh
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
                    : `Confirm Rollover — archive ${preview.currentYear} season`}
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
      )}
    </div>
  );
}

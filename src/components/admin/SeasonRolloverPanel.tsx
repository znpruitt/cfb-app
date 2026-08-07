'use client';

import React, { useCallback, useEffect, useState } from 'react';

import { getAdminAuthHeaders } from '@/lib/adminAuth';
import type { LeagueStatus } from '@/lib/league';
import {
  buildManualRolloverRequest,
  describeManualRolloverReason,
  describeManualRolloverRefusal,
  parseManualRolloverStatusResponse,
  type ManualRolloverPreviewResponse,
  type ManualRolloverYearStatus,
} from '@/lib/manualRollover';

const sectionClass =
  'rounded-lg border border-gray-200 bg-white p-5 space-y-3 dark:border-zinc-700 dark:bg-zinc-900';
const buttonClass =
  'rounded border border-gray-300 bg-gray-50 px-4 py-1.5 text-sm text-gray-900 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700';

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
 * PLATFORM-086F2B — one lifecycle year's row. Each year renders its own instance
 * (keyed by year) so preview state can never cross-wire between years, and every
 * request carries this row's explicit year.
 *
 * PLATFORM-086F2H3A — this row has no execute control. Manual rollover execution
 * is retired; the daily cron is the only executor. The preview survives because
 * it is the only place an operator can see which owners' final standings would
 * flip BEFORE anything is written, and the cron has no equivalent. It is an
 * INSPECTION REPORT, not a confirmation screen.
 */
function YearRow({
  status,
  onRefused,
}: {
  status: ManualRolloverYearStatus;
  onRefused: () => Promise<void>;
}) {
  const { year } = status;
  const leagueCount = status.leagues.length;

  const [previewLoading, setPreviewLoading] = useState(false);
  const [preview, setPreview] = useState<ManualRolloverPreviewResponse['preview'] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const eligible = status.eligibility === 'eligible';

  async function refusalMessage(res: Response): Promise<string> {
    const payload: unknown = await res.json().catch(() => null);
    return describeManualRolloverRefusal(payload) ?? `Error ${res.status}`;
  }

  async function handlePreview() {
    setPreviewLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/rollover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAdminAuthHeaders() },
        body: JSON.stringify(buildManualRolloverRequest(year)),
      });
      if (!res.ok) {
        setError(await refusalMessage(res));
        await onRefused();
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

      {/* Preview is DELIBERATE — it never loads on render. Building it walks the
          full scored season for every league in the group, and an inspection an
          operator did not ask for is work nobody reads. */}
      {eligible && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            onClick={() => void handlePreview()}
            disabled={previewLoading}
            className={buttonClass}
          >
            {previewLoading
              ? 'Loading preview…'
              : preview
                ? 'Refresh archive preview'
                : 'Preview archive changes'}
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}

      {preview && (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-gray-500 dark:text-zinc-400">
            Previewing rollover for season <span className="font-medium">{preview.year}</span>.{' '}
            {preview.leagues.length} league{preview.leagues.length !== 1 ? 's' : ''} affected. This
            is a read-only inspection — nothing is written.
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

                    {/* PLATFORM-086F2H3A — ported from the retired RolloverPanel,
                        which was the ONLY surface naming the owners whose outcomes
                        flip and the standings positions that move. This panel
                        previously showed bare counts, so consolidating by deletion
                        would have destroyed the preview's most specific
                        information — the audit's reason for merging by capability
                        rather than picking a survivor. */}
                    {league.hasExistingArchive && league.diff ? (
                      <div className="space-y-1 pt-1">
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
                      <p className="pt-1 text-green-700 dark:text-green-400">
                        New archive — the {preview.year} season would be written fresh.
                      </p>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function SeasonRolloverPanel(): React.ReactElement {
  const [years, setYears] = useState<ManualRolloverYearStatus[] | null>(null);
  // PLATFORM-086F2H1R4 — production records the server refused for an unusable
  // lifecycle year. Without it an all-refused registry renders "No production
  // leagues are waiting for rollover", which is FALSE: leagues are in season,
  // they are merely unusable. That is the exact falsehood class this campaign
  // has refused to ship since F2H1T2.
  const [invalidLifecycleTargets, setInvalidLifecycleTargets] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch('/api/admin/rollover', {
        cache: 'no-store',
        headers: getAdminAuthHeaders(),
      });
      if (!res.ok) {
        // The GET can answer with a typed refusal (409 registry-malformed).
        // Rendering the raw JSON body as prose would show an operator a blob;
        // the operator-readable string already exists for exactly this case.
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
      setInvalidLifecycleTargets(data.invalidLifecycleTargets);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Unexpected error');
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  // PLATFORM-086F2H3A — production leagues normally follow the same college
  // football season, so more than one in-season year group is a DISAGREEMENT,
  // not a feature. It appears temporarily after a partial rollover, a lifecycle
  // failure, stale stored data, or a league created while another is still
  // finishing rollover. Derived here rather than added to the response: the
  // groups already carry the fact, and a second encoding of one truth drifts.
  //
  // Scoped to leagues in `season` — a production league in preseason or
  // offseason is not represented here and is not part of this claim.
  const yearGroups = years ?? [];
  const yearsDisagree = yearGroups.length > 1;

  return (
    <section className={sectionClass}>
      <div>
        <h2 className="text-base font-medium text-gray-900 dark:text-zinc-100">Season Rollover</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-zinc-400">
          Rollover readiness for production leagues. The daily rollover cron archives a completed
          season and transitions its leagues to offseason; each active season year is evaluated
          against the same strict eligibility gate (structured CFP national championship, confirmed
          final, seven-day waiting period). Previewing below is read-only and writes nothing.
        </p>
      </div>

      {loadError && <p className="text-xs text-red-600 dark:text-red-400">{loadError}</p>}
      {!loadError && years === null && (
        <p className="text-xs text-gray-500 dark:text-zinc-400">Loading rollover status…</p>
      )}

      {/* The empty state stays VISIBLE rather than hiding the section — it is the
          operator's confirmation that the check ran and succeeded. The demo
          league is excluded upstream by `groupRolloverTargets` and is never
          mentioned here; the backend keeps its own `no-automatic-season-leagues`
          reason for cron events, receipts, and diagnostics. */}
      {years !== null && yearGroups.length === 0 && (
        <p className="text-xs text-gray-500 dark:text-zinc-400">
          {invalidLifecycleTargets > 0
            ? `${invalidLifecycleTargets} league record(s) in season carry an unusable season year and were refused — repair those records before rolling over.`
            : 'No production leagues are waiting for rollover.'}
        </p>
      )}

      {/* Composes with the refusal message above: a registry can hold both a
          year disagreement and refused records, and each is separately
          actionable. */}
      {yearsDisagree && (
        <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
          Production leagues disagree on their season year — {yearGroups.length} different years are
          active at once ({yearGroups.map((y) => y.year).join(', ')}). This is not a normal state.
          Each year is shown separately below so the inconsistency can be diagnosed.
        </p>
      )}

      {years !== null && yearGroups.length > 0 && (
        <div className="space-y-3">
          {yearGroups.map((yearStatus) => (
            <YearRow key={yearStatus.year} status={yearStatus} onRefused={loadStatus} />
          ))}
        </div>
      )}
    </section>
  );
}

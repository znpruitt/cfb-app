'use client';

import React, { useState } from 'react';

import { getAdminAuthHeaders } from '@/lib/adminAuth';
import type { LeagueStatus } from '@/lib/league';

type TopStandingEntry = {
  position: number;
  owner: string;
  wins: number;
  losses: number;
  ties: number;
};

type LeagueSummary = {
  leagueSlug: string;
  displayName: string;
  status: LeagueStatus | undefined;
  hasExistingArchive: boolean;
  champion: string | null;
  top3: TopStandingEntry[];
  diff: {
    scoresChanged: number;
    outcomesFlipped: number;
    ownersAffectedByFlip: string[];
    standingsOrderChanged: boolean;
    standingsMovement: Array<{
      ownerName: string;
      previousPosition: number;
      newPosition: number;
    }>;
  } | null;
  error: string | null;
};

type PreviewResponse = {
  preview: {
    currentYear: number;
    leagues: LeagueSummary[];
  };
};

type ExecuteError = { leagueSlug: string; error: string };

type ExecuteResponse = {
  success: boolean;
  archivedLeagues: string[];
  errors: ExecuteError[];
  message?: string;
};

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

export default function SeasonRolloverPanel({
  nextRolloverDate,
}: {
  nextRolloverDate?: string | null;
} = {}): React.ReactElement {
  const [previewLoading, setPreviewLoading] = useState(false);
  const [executeLoading, setExecuteLoading] = useState(false);
  const [preview, setPreview] = useState<PreviewResponse['preview'] | null>(null);
  const [executeResult, setExecuteResult] = useState<ExecuteResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const busy = previewLoading || executeLoading;
  const alreadyOffseason = preview?.leagues.some((l) => l.status?.state === 'offseason') ?? false;

  async function handlePreview() {
    setPreviewLoading(true);
    setError(null);
    setExecuteResult(null);
    try {
      const res = await fetch('/api/admin/rollover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAdminAuthHeaders() },
        body: JSON.stringify({ confirmed: false }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        setError(`Error ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`);
        return;
      }
      const data = (await res.json()) as PreviewResponse;
      setPreview(data.preview);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unexpected error');
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleExecute() {
    const ok = window.confirm(
      'This will archive the current season and transition all leagues to offseason. This cannot be undone. Continue?'
    );
    if (!ok) return;

    setExecuteLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/rollover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAdminAuthHeaders() },
        body: JSON.stringify({ confirmed: true }),
      });
      const data = (await res.json().catch(() => null)) as ExecuteResponse | null;
      if (!res.ok || !data) {
        setError(`Error ${res.status}`);
        return;
      }
      setExecuteResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unexpected error');
    } finally {
      setExecuteLoading(false);
    }
  }

  const rolloverDateDisplay = formatDate(nextRolloverDate);

  return (
    <section className={sectionClass}>
      <div>
        <h2 className="text-base font-medium text-gray-900 dark:text-zinc-100">Season Rollover</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-zinc-400">
          Archive the current season and transition all non-test leagues to offseason. Runs
          automatically 7 days after the national championship — use this panel to trigger manually
          or recover from a failed automatic rollover.
        </p>
      </div>

      {rolloverDateDisplay && (
        <p className="text-xs text-gray-500 dark:text-zinc-400">
          Next automatic rollover: <span className="font-medium">{rolloverDateDisplay}</span>
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => void handlePreview()} disabled={busy} className={buttonClass}>
          {previewLoading ? 'Loading preview…' : preview ? 'Refresh Preview' : 'Preview Rollover'}
        </button>
        {preview && !executeResult && (
          <button
            onClick={() => void handleExecute()}
            disabled={busy}
            className={destructiveButtonClass}
          >
            {executeLoading ? 'Executing…' : 'Execute Rollover'}
          </button>
        )}
        {error && <span className="text-xs text-red-600 dark:text-red-400">{error}</span>}
      </div>

      {preview && !executeResult && (
        <div className="space-y-3">
          <p className="text-xs text-gray-500 dark:text-zinc-400">
            Previewing rollover for season{' '}
            <span className="font-medium">{preview.currentYear}</span>. {preview.leagues.length}{' '}
            league
            {preview.leagues.length !== 1 ? 's' : ''} affected.
          </p>
          {alreadyOffseason && (
            <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
              Warning: one or more leagues are already in offseason. Running rollover again will
              overwrite archives for those leagues.
            </p>
          )}
          <ul className="space-y-3">
            {preview.leagues.map((league) => (
              <li
                key={league.leagueSlug}
                className="rounded border border-gray-200 bg-gray-50 p-3 text-sm dark:border-zinc-700 dark:bg-zinc-800"
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
        <div className="space-y-2">
          {executeResult.success ? (
            <p className="rounded border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-300">
              Rollover complete — {executeResult.archivedLeagues.length} league
              {executeResult.archivedLeagues.length !== 1 ? 's' : ''} transitioned to offseason.
            </p>
          ) : (
            <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
              {executeResult.message ?? 'Rollover failed.'}
            </p>
          )}
          {executeResult.archivedLeagues.length > 0 && (
            <ul className="space-y-0.5 text-xs text-gray-600 dark:text-zinc-300">
              {executeResult.archivedLeagues.map((slug) => (
                <li key={slug}>✓ {slug}</li>
              ))}
            </ul>
          )}
          {executeResult.errors.length > 0 && (
            <ul className="space-y-0.5 text-xs text-red-600 dark:text-red-400">
              {executeResult.errors.map((err) => (
                <li key={err.leagueSlug}>
                  ✗ {err.leagueSlug}: {err.error}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

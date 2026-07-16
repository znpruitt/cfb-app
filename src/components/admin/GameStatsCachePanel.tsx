'use client';

import React, { useState } from 'react';

import { requireAdminAuthHeaders } from '@/lib/adminAuth';
import { seasonYearForToday } from '@/lib/scores/normalizers';

const buttonClass =
  'rounded border border-gray-300 bg-gray-50 px-4 py-1.5 text-sm text-gray-900 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700';

type Status = 'idle' | 'loading' | 'success' | 'error';

type GameStatsRefreshMeta = {
  outcome?: 'committed' | 'noop';
  noopReason?: 'no-provider-rows' | 'no-new-rows';
  rowsCommitted?: number;
  rowsCached?: number;
};

type GameStatsResult = {
  year: number;
  week: number;
  seasonType: string;
  fetchedAt: string | null;
  games: unknown[];
  meta?: GameStatsRefreshMeta;
};

/**
 * Truthful wording for a manual game-stats refresh outcome (PLATFORM-086H
 * finding #1). The server reports an explicit outcome: a valid no-op (provider
 * had nothing, or nothing new) must never render as "Cached 0 games" — that
 * inferred success-from-`games.length` wording is kept only as a legacy fallback
 * for a response without the outcome contract.
 */
export function describeGameStatsRefreshResult(result: GameStatsResult): string {
  const slate = `week ${result.week} (${result.seasonType})`;
  const outcome = result.meta?.outcome;
  if (outcome === 'noop') {
    return result.meta?.noopReason === 'no-new-rows'
      ? `${slate} is already up to date — the provider returned no new stats (${result.meta?.rowsCached ?? 0} cached)`
      : `No game stats available yet for ${slate} — nothing was cached or overwritten`;
  }
  if (outcome === 'committed') {
    const committed = result.meta?.rowsCommitted ?? result.games.length;
    const cached = result.meta?.rowsCached ?? result.games.length;
    return `Committed ${committed} new or updated game${committed !== 1 ? 's' : ''} for ${slate} — ${cached} total cached`;
  }
  return `Cached ${result.games.length} game${result.games.length !== 1 ? 's' : ''} for ${slate}`;
}

type BackfillStatus = 'idle' | 'running' | 'done';

type BackfillStep = { week: number; seasonType: 'regular' | 'postseason' };

const BACKFILL_STEPS: BackfillStep[] = [
  ...Array.from({ length: 15 }, (_, i) => ({ week: i + 1, seasonType: 'regular' as const })),
  ...Array.from({ length: 4 }, (_, i) => ({ week: i + 1, seasonType: 'postseason' as const })),
];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function GameStatsCachePanel({ defaultYear }: { defaultYear?: number } = {}) {
  const [year, setYear] = useState(defaultYear ?? seasonYearForToday());
  const [week, setWeek] = useState(1);
  const [seasonType, setSeasonType] = useState<'regular' | 'postseason'>('regular');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | undefined>();
  const [result, setResult] = useState<GameStatsResult | null>(null);

  const [backfillStatus, setBackfillStatus] = useState<BackfillStatus>('idle');
  const [backfillProgress, setBackfillProgress] = useState('');
  const [backfillSummary, setBackfillSummary] = useState('');
  const [backfillErrors, setBackfillErrors] = useState<string[]>([]);

  const busy = status === 'loading' || backfillStatus === 'running';

  async function handleRefresh() {
    setStatus('loading');
    setError(undefined);
    setResult(null);
    try {
      const params = new URLSearchParams({
        year: String(year),
        week: String(week),
        seasonType,
        bypassCache: '1',
      });
      const res = await fetch(`/api/game-stats?${params.toString()}`, {
        cache: 'no-store',
        headers: requireAdminAuthHeaders() as Record<string, string>,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        setError(`Error ${res.status}${text ? `: ${text.slice(0, 160)}` : ''}`);
        setStatus('error');
        return;
      }
      const data = (await res.json()) as GameStatsResult;
      setResult(data);
      setStatus('success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unexpected error');
      setStatus('error');
    }
  }

  async function handleBackfill() {
    setBackfillStatus('running');
    setBackfillProgress('');
    setBackfillSummary('');
    setBackfillErrors([]);
    setResult(null);
    setError(undefined);

    const errors: string[] = [];
    let updated = 0;
    let noData = 0;
    const authHeaders = requireAdminAuthHeaders() as Record<string, string>;
    const total = BACKFILL_STEPS.length;

    for (let i = 0; i < total; i++) {
      const step = BACKFILL_STEPS[i];
      setBackfillProgress(`Fetching ${step.seasonType} week ${step.week} (${i + 1} of ${total})…`);
      try {
        const params = new URLSearchParams({
          year: String(year),
          week: String(step.week),
          seasonType: step.seasonType,
          bypassCache: '1',
        });
        const res = await fetch(`/api/game-stats?${params.toString()}`, {
          cache: 'no-store',
          headers: authHeaders,
        });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          errors.push(
            `${step.seasonType} wk ${step.week}: ${res.status}${text ? ` — ${text.slice(0, 80)}` : ''}`
          );
        } else {
          // A valid no-op (no stats available / nothing new) is not an "updated"
          // week — count it truthfully instead of as a cached success.
          const data = (await res.json().catch(() => null)) as GameStatsResult | null;
          if (data?.meta?.outcome === 'noop') noData++;
          else updated++;
        }
      } catch (err) {
        errors.push(
          `${step.seasonType} wk ${step.week}: ${err instanceof Error ? err.message : 'unknown error'}`
        );
      }
      if (i < total - 1) await delay(500);
    }

    setBackfillErrors(errors);
    setBackfillSummary(
      `Backfill complete — ${updated} week${updated !== 1 ? 's' : ''} updated` +
        `${noData > 0 ? `, ${noData} with no stats available` : ''}` +
        `${errors.length > 0 ? `, ${errors.length} failed` : ''}`
    );
    setBackfillProgress('');
    setBackfillStatus('done');
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5 space-y-3 dark:border-zinc-700 dark:bg-zinc-900">
      <div>
        <h2 className="text-base font-medium text-gray-900 dark:text-zinc-100">Game Stats Cache</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-zinc-400">
          Fetch and cache team stats for a specific week. Run after each game week completes.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-zinc-400">
          Year
          <input
            type="number"
            value={year}
            onChange={(e) => {
              setYear(Number(e.target.value));
              setResult(null);
              setError(undefined);
              setBackfillSummary('');
              setBackfillErrors([]);
            }}
            min={2001}
            step={1}
            disabled={busy}
            className="w-24 rounded border border-gray-300 bg-gray-50 px-2 py-1 text-sm text-gray-900 focus:border-gray-500 focus:outline-none disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-zinc-500"
          />
        </label>

        <label className="flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-zinc-400">
          Week
          <input
            type="number"
            value={week}
            onChange={(e) => {
              setWeek(Number(e.target.value));
              setResult(null);
              setError(undefined);
            }}
            min={1}
            max={15}
            step={1}
            disabled={busy}
            className="w-20 rounded border border-gray-300 bg-gray-50 px-2 py-1 text-sm text-gray-900 focus:border-gray-500 focus:outline-none disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-zinc-500"
          />
        </label>

        <label className="flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-zinc-400">
          Season type
          <select
            value={seasonType}
            onChange={(e) => {
              setSeasonType(e.target.value as 'regular' | 'postseason');
              setResult(null);
              setError(undefined);
            }}
            disabled={busy}
            className="rounded border border-gray-300 bg-gray-50 px-2 py-1 text-sm text-gray-900 focus:border-gray-500 focus:outline-none disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-zinc-500"
          >
            <option value="regular">Regular</option>
            <option value="postseason">Postseason</option>
          </select>
        </label>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={() => void handleRefresh()} disabled={busy} className={buttonClass}>
          {status === 'loading' ? 'Fetching…' : 'Refresh Game Stats'}
        </button>
        {status === 'loading' && (
          <span className="text-xs text-gray-500 dark:text-zinc-400">Working…</span>
        )}
        {status === 'success' && result && (
          <span className="text-xs text-green-600 dark:text-green-400">
            {describeGameStatsRefreshResult(result)}
          </span>
        )}
        {status === 'error' && (
          <span className="text-xs text-red-600 dark:text-red-400">{error ?? 'Failed'}</span>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <button onClick={() => void handleBackfill()} disabled={busy} className={buttonClass}>
            {backfillStatus === 'running' ? 'Backfilling…' : 'Backfill Full Season'}
          </button>
          {backfillProgress && (
            <span className="text-xs text-gray-500 dark:text-zinc-400">{backfillProgress}</span>
          )}
          {backfillStatus === 'done' && backfillSummary && (
            <span
              className={`text-xs ${backfillErrors.length > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400'}`}
            >
              {backfillSummary}
            </span>
          )}
        </div>
        {backfillErrors.length > 0 && (
          <ul className="space-y-0.5 text-xs text-red-600 dark:text-red-400">
            {backfillErrors.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

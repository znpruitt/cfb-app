'use client';

import React, { useState } from 'react';

import { getAdminAuthHeaders } from '@/lib/adminAuth';
import type { League } from '@/lib/league';

type Props = {
  leagues: League[];
};

type BackfillSuccess = {
  success: true;
  leagueSlug: string;
  year: number;
  archivedAt: string;
  replaced: boolean;
};

type BackfillConfirmationRequired = {
  requiresConfirmation: true;
  leagueSlug: string;
  year: number;
  diff: unknown;
};

const primaryButtonClass =
  'px-4 py-2 rounded border border-blue-600 bg-blue-600 text-sm font-medium text-white transition-colors hover:bg-blue-700 hover:border-blue-700 dark:border-blue-500 dark:bg-blue-600 dark:hover:bg-blue-700';
const controlButtonClass =
  'px-3 py-2 rounded border border-gray-300 bg-gray-50 text-sm text-gray-900 transition-colors hover:bg-gray-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700';

export default function BackfillPanel({ leagues }: Props) {
  const [selectedSlug, setSelectedSlug] = useState(leagues[0]?.slug ?? '');
  const [year, setYear] = useState<number>(new Date().getUTCFullYear() - 1);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<BackfillConfirmationRequired | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<BackfillSuccess | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handlePreview() {
    setError(null);
    setPreview(null);
    setResult(null);
    setPreviewing(true);
    try {
      const res = await fetch('/api/admin/backfill', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...getAdminAuthHeaders() },
        body: JSON.stringify({ leagueSlug: selectedSlug, year, confirmed: false }),
      });
      if (!res.ok) {
        setError((await res.text()) || `POST /api/admin/backfill ${res.status}`);
        return;
      }
      const data = (await res.json()) as BackfillSuccess | BackfillConfirmationRequired;
      if ('success' in data && data.success) {
        setResult(data);
      } else {
        setPreview(data as BackfillConfirmationRequired);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPreviewing(false);
    }
  }

  async function handleConfirm() {
    setError(null);
    setConfirming(true);
    try {
      const res = await fetch('/api/admin/backfill', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...getAdminAuthHeaders() },
        body: JSON.stringify({ leagueSlug: selectedSlug, year, confirmed: true }),
      });
      if (!res.ok) {
        setError((await res.text()) || `POST /api/admin/backfill ${res.status}`);
        return;
      }
      const data = (await res.json()) as BackfillSuccess;
      setResult(data);
      setPreview(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setConfirming(false);
    }
  }

  if (leagues.length === 0) return null;

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
      <h2 className="mb-2 text-base font-medium text-gray-900 dark:text-zinc-100">
        Archive a Past Season
      </h2>
      <p className="mb-4 text-sm text-gray-500 dark:text-zinc-400">
        Save a completed past season to the history archive without advancing the active season
        year.
      </p>

      <div className="mb-4 flex flex-wrap gap-4">
        <label className="flex flex-col gap-1 text-sm text-gray-600 dark:text-zinc-300">
          League
          <select
            value={selectedSlug}
            onChange={(e) => {
              setSelectedSlug(e.target.value);
              setPreview(null);
              setResult(null);
              setError(null);
            }}
            className="rounded border border-gray-300 bg-gray-50 px-2 py-1 text-sm text-gray-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          >
            {leagues.map((l) => (
              <option key={l.slug} value={l.slug}>
                {l.displayName}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm text-gray-600 dark:text-zinc-300">
          Year
          <input
            type="number"
            value={year}
            min={2000}
            onChange={(e) => {
              setYear(Number(e.target.value));
              setPreview(null);
              setResult(null);
              setError(null);
            }}
            className="w-24 rounded border border-gray-300 bg-gray-50 px-2 py-1 text-sm text-gray-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          />
        </label>
      </div>

      {result ? (
        <div className="space-y-2">
          <p className="text-sm text-green-600 dark:text-green-400">
            Season {result.year} archived for {result.leagueSlug}.
          </p>
          <button
            className={controlButtonClass}
            onClick={() => {
              setResult(null);
              setError(null);
            }}
          >
            Backfill another
          </button>
        </div>
      ) : preview ? (
        <div className="space-y-3">
          <p className="text-sm text-gray-600 dark:text-zinc-300">
            An existing {year} archive for {selectedSlug} will be overwritten.
          </p>
          <div className="flex gap-2">
            <button
              className={primaryButtonClass}
              onClick={() => void handleConfirm()}
              disabled={confirming}
            >
              {confirming ? 'Archiving…' : 'Confirm Backfill'}
            </button>
            <button
              className={controlButtonClass}
              onClick={() => {
                setPreview(null);
                setError(null);
              }}
              disabled={confirming}
            >
              Cancel
            </button>
          </div>
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <button
            className={primaryButtonClass}
            onClick={() => void handlePreview()}
            disabled={previewing}
          >
            {previewing ? 'Checking…' : 'Preview Backfill'}
          </button>
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        </div>
      )}
    </section>
  );
}

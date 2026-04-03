'use client';

import React, { useState } from 'react';
import { requireAdminAuthHeaders } from '@/lib/adminAuth';

const primaryButtonClass =
  'px-4 py-2 rounded border border-blue-600 bg-blue-600 text-sm font-medium text-white transition-colors hover:bg-blue-700 hover:border-blue-700 dark:border-blue-500 dark:bg-blue-600 dark:hover:bg-blue-700';
const controlButtonClass =
  'px-3 py-2 rounded border border-gray-300 bg-white text-sm text-gray-900 transition-colors hover:bg-gray-50 hover:border-gray-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700/60';

type UploadResult = {
  success: boolean;
  year: number;
  resolvedCount: number;
  unresolvedTeams: string[];
};

function defaultYear(): number {
  const now = new Date();
  const month = now.getUTCMonth();
  return month >= 7 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}

export default function WinTotalsUploadPanel() {
  const [year, setYear] = useState<number>(defaultYear);
  const [csvText, setCsvText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);

  async function handleUpload() {
    setError(null);
    if (!csvText.trim()) {
      setError('Paste CSV content before uploading.');
      return;
    }
    setLoading(true);
    try {
      const authHeaders = requireAdminAuthHeaders() as Record<string, string>;
      const res = await fetch(`/api/admin/win-totals?year=${encodeURIComponent(year)}`, {
        method: 'POST',
        headers: { 'content-type': 'text/plain', ...authHeaders },
        body: csvText,
      });
      if (!res.ok) {
        const text = await res.text();
        setError(text || `POST /api/admin/win-totals ${res.status}`);
        return;
      }
      const data = (await res.json()) as UploadResult;
      setResult(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
      <h2 className="mb-3 text-base font-semibold text-gray-900 dark:text-zinc-100">
        Win Total Upload
      </h2>
      <p className="mb-3 text-sm text-gray-500 dark:text-zinc-400">
        Upload projected win totals (over/under lines) for draft cards. CSV format:{' '}
        <code className="rounded bg-gray-100 px-1 text-xs dark:bg-zinc-800">
          Team, WinTotalLow, WinTotalHigh
        </code>
        . Header row required.
      </p>

      {result ? (
        <div className="space-y-2">
          <p className="text-sm text-green-700 dark:text-green-400">
            Uploaded {result.resolvedCount} teams for {result.year}.
          </p>
          {result.unresolvedTeams.length > 0 && (
            <div>
              <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                {result.unresolvedTeams.length} unresolved team
                {result.unresolvedTeams.length > 1 ? 's' : ''} (skipped):
              </p>
              <ul className="mt-1 list-disc pl-5 text-xs text-amber-700 dark:text-amber-400">
                {result.unresolvedTeams.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
          )}
          <button
            className={controlButtonClass}
            onClick={() => {
              setResult(null);
              setError(null);
              setCsvText('');
            }}
          >
            Upload another
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-700 dark:text-zinc-300">
              Year
              <input
                type="number"
                value={year}
                min={2000}
                onChange={(e) => {
                  setError(null);
                  setYear(Number(e.target.value));
                }}
                className="ml-2 w-24 rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
              />
            </label>
          </div>

          <textarea
            value={csvText}
            onChange={(e) => {
              setError(null);
              setCsvText(e.target.value);
            }}
            placeholder={'Team, WinTotalLow, WinTotalHigh\nAlabama, 10.5, 10.5\nOhio State, 10, 11'}
            rows={8}
            className="w-full rounded border border-gray-300 bg-white px-3 py-2 font-mono text-xs text-gray-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
          />

          <div className="flex items-center gap-2">
            <button
              className={primaryButtonClass}
              onClick={() => void handleUpload()}
              disabled={loading}
            >
              {loading ? 'Uploading…' : 'Upload Win Totals'}
            </button>
            {error && <p className="text-sm text-red-700 dark:text-red-400">{error}</p>}
          </div>
        </div>
      )}
    </section>
  );
}

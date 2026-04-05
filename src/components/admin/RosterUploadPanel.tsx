'use client';

import { useRef, useState } from 'react';

import { getAdminAuthHeaders } from '@/lib/adminAuth';
import type { League } from '@/lib/league';
import { seasonYearForToday } from '@/lib/scores/normalizers';

type Props = {
  leagues: League[];
};

export default function RosterUploadPanel({ leagues }: Props) {
  const [slug, setSlug] = useState(leagues[0]?.slug ?? '');
  const [year, setYear] = useState(seasonYearForToday());
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleUpload() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError('Select a CSV file first.');
      return;
    }
    if (!slug) {
      setError('Select a league.');
      return;
    }

    setLoading(true);
    setSuccess(null);
    setError(null);

    try {
      const csvText = await file.text();
      const res = await fetch(`/api/owners?league=${encodeURIComponent(slug)}&year=${year}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getAdminAuthHeaders() },
        body: JSON.stringify({ csvText }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { detail?: string; error?: string } | null;
        setError(data?.detail ?? data?.error ?? `Upload failed (${res.status})`);
        return;
      }

      const data = (await res.json()) as { csvText?: string };
      const ownerCount = data.csvText
        ? new Set(
            data.csvText
              .split('\n')
              .slice(1)
              .map((line: string) => {
                const idx = line.indexOf(',');
                return idx === -1 ? '' : line.slice(idx + 1).trim();
              })
              .filter(Boolean)
          ).size
        : 0;
      setSuccess(`Uploaded successfully — ${ownerCount} owner${ownerCount !== 1 ? 's' : ''} loaded`);
      if (fileRef.current) fileRef.current.value = '';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unexpected error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-5 space-y-4">
      <div>
        <h2 className="text-base font-semibold text-zinc-100">Owner Roster CSV Upload</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Upload team-owner assignments. Format: Team, Owner (one row per team). This is the
          authoritative roster for the selected league and season.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-zinc-400">League</label>
          <select
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            className="rounded border border-zinc-600 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100"
          >
            {leagues.map((l) => (
              <option key={l.slug} value={l.slug}>
                {l.displayName}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-zinc-400">Year</label>
          <input
            type="number"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="w-24 rounded border border-zinc-600 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-zinc-400">CSV File</label>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="text-sm text-zinc-300 file:mr-3 file:rounded file:border-0 file:bg-zinc-700 file:px-3 file:py-1 file:text-xs file:text-zinc-200 hover:file:bg-zinc-600"
          />
        </div>
      </div>

      <button
        onClick={handleUpload}
        disabled={loading || leagues.length === 0}
        className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? 'Uploading…' : 'Upload Roster'}
      </button>

      {success && <p className="text-sm text-green-400">{success}</p>}
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}

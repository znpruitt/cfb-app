'use client';

import React, { useState } from 'react';

import { requireAdminAuthHeaders } from '@/lib/adminAuth';

type Status = 'idle' | 'loading' | 'success' | 'error';

export default function LeagueSettingsForm({
  slug,
  initialDisplayName,
  initialYear,
}: {
  slug: string;
  initialDisplayName: string;
  initialYear: number;
}): React.ReactElement {
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [year, setYear] = useState(String(initialYear));
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | undefined>();

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setStatus('loading');
    setError(undefined);

    const yearNum = Number(year);
    if (!Number.isFinite(yearNum) || yearNum < 2000) {
      setError('Year must be a valid season year (2000 or later)');
      setStatus('error');
      return;
    }
    if (!displayName.trim()) {
      setError('Display name cannot be empty');
      setStatus('error');
      return;
    }

    try {
      const res = await fetch(`/api/admin/leagues/${encodeURIComponent(slug)}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          ...(requireAdminAuthHeaders() as Record<string, string>),
        },
        body: JSON.stringify({ displayName: displayName.trim(), year: yearNum }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        setError(`Error ${res.status}${text ? `: ${text.slice(0, 120)}` : ''}`);
        setStatus('error');
        return;
      }
      setStatus('success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unexpected error');
      setStatus('error');
    }
  }

  const inputClass =
    'w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-500 focus:border-zinc-500 focus:outline-none disabled:opacity-40';
  const labelClass = 'block text-xs font-medium text-zinc-400 mb-1';

  return (
    <section className="rounded-lg border border-zinc-700 bg-zinc-900 p-5 space-y-4">
      <h2 className="text-base font-medium text-zinc-100">League Settings</h2>
      <form onSubmit={(e) => void handleSave(e)} className="space-y-4">
        <div>
          <label className={labelClass}>Slug (read-only)</label>
          <input
            type="text"
            value={slug}
            readOnly
            className={`${inputClass} cursor-default text-zinc-500`}
          />
        </div>
        <div>
          <label className={labelClass}>Display Name</label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            disabled={status === 'loading'}
            className={inputClass}
            placeholder="e.g. My Fantasy League"
          />
        </div>
        <div>
          <label className={labelClass}>Season Year</label>
          <input
            type="number"
            value={year}
            onChange={(e) => setYear(e.target.value)}
            disabled={status === 'loading'}
            className={inputClass}
            min={2000}
            step={1}
            placeholder="e.g. 2025"
          />
        </div>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={status === 'loading'}
            className="rounded border border-zinc-600 bg-zinc-800 px-4 py-1.5 text-sm text-zinc-100 hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {status === 'loading' ? 'Saving…' : 'Save'}
          </button>
          {status === 'success' && <span className="text-xs text-green-400">Saved</span>}
          {status === 'error' && (
            <span className="text-xs text-red-400">{error ?? 'Failed'}</span>
          )}
        </div>
      </form>
    </section>
  );
}

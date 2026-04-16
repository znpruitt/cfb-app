'use client';

import React, { useState } from 'react';

import { requireAdminAuthHeaders } from '@/lib/adminAuth';

type Status = 'idle' | 'loading' | 'success' | 'error';

export default function LeagueSettingsForm({
  slug,
  initialDisplayName,
  initialYear,
  initialFoundedYear,
}: {
  slug: string;
  initialDisplayName: string;
  initialYear: number;
  initialFoundedYear?: number;
}): React.ReactElement {
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [foundedYear, setFoundedYear] = useState(
    String(initialFoundedYear ?? new Date().getFullYear())
  );
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | undefined>();

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setStatus('loading');
    setError(undefined);

    if (!displayName.trim()) {
      setError('Display name cannot be empty');
      setStatus('error');
      return;
    }
    const foundedYearNum = Number(foundedYear);
    if (
      !Number.isFinite(foundedYearNum) ||
      foundedYearNum < 1900 ||
      foundedYearNum > new Date().getFullYear()
    ) {
      setError('Founded year must be between 1900 and the current year');
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
        body: JSON.stringify({ displayName: displayName.trim(), foundedYear: foundedYearNum }),
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
    'w-full rounded border border-gray-300 bg-gray-50 px-3 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-gray-500 focus:outline-none disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500 dark:focus:border-zinc-500';
  const labelClass = 'block text-xs font-medium text-gray-500 dark:text-zinc-400 mb-1';

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5 space-y-4 dark:border-zinc-700 dark:bg-zinc-900">
      <h2 className="text-base font-medium text-gray-900 dark:text-zinc-100">League Settings</h2>
      <form onSubmit={(e) => void handleSave(e)} className="space-y-4">
        <div>
          <label className={labelClass}>Slug (read-only)</label>
          <input
            type="text"
            value={slug}
            readOnly
            className={`${inputClass} cursor-default text-gray-400 dark:text-zinc-500`}
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
            type="text"
            value={initialYear}
            readOnly
            className={`${inputClass} cursor-default text-gray-400 dark:text-zinc-500`}
          />
        </div>
        <div>
          <label className={labelClass}>Founded Year</label>
          <input
            type="number"
            value={foundedYear}
            onChange={(e) => setFoundedYear(e.target.value)}
            disabled={status === 'loading'}
            className={inputClass}
            min={1900}
            max={new Date().getFullYear()}
            step={1}
            placeholder={String(new Date().getFullYear())}
          />
        </div>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={status === 'loading'}
            className="rounded border border-gray-300 bg-gray-50 px-4 py-1.5 text-sm text-gray-900 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
          >
            {status === 'loading' ? 'Saving…' : 'Save'}
          </button>
          {status === 'success' && (
            <span className="text-xs text-green-600 dark:text-green-400">Saved</span>
          )}
          {status === 'error' && (
            <span className="text-xs text-red-600 dark:text-red-400">{error ?? 'Failed'}</span>
          )}
        </div>
      </form>
    </section>
  );
}

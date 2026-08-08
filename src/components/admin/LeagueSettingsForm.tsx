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
  // PLATFORM-086F2J — display only; there is no setter because the value is
  // frozen at creation and this form no longer submits it.
  //
  // NO fallback to the current year. While the field was editable, that fallback
  // was a DEFAULT an operator could correct; making the field read-only turned
  // the same expression into a fabricated immutable fact — a record predating the
  // field would report "Founded Year 2026" with no way to fix it, while
  // `/league/<slug>` correctly renders no `Est.` line at all for the same record.
  // Absent is shown as absent.
  const foundedYear = initialFoundedYear == null ? '' : String(initialFoundedYear);
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
    try {
      const res = await fetch(`/api/admin/leagues/${encodeURIComponent(slug)}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          ...(requireAdminAuthHeaders() as Record<string, string>),
        },
        // PLATFORM-086F2J — `foundedYear` is NOT sent. It is frozen at creation,
        // and the route answers `league-founded-year-immutable` for a body that
        // carries it, so including it would refuse every save.
        body: JSON.stringify({ displayName: displayName.trim() }),
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
          {/* PLATFORM-086F2J — every label on this form is now associated with
              its input. They were plain `<label>` elements with no `htmlFor`, so
              a screen reader announced four unlabelled text boxes and no test
              could address a field by name. */}
          <label className={labelClass} htmlFor="league-slug">
            Slug (read-only)
          </label>
          <input
            id="league-slug"
            type="text"
            value={slug}
            readOnly
            className={`${inputClass} cursor-default text-gray-400 dark:text-zinc-500`}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="league-display-name">
            Display Name
          </label>
          <input
            id="league-display-name"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            disabled={status === 'loading'}
            className={inputClass}
            placeholder="e.g. My Fantasy League"
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="league-season-year">
            Season Year
          </label>
          <input
            id="league-season-year"
            type="text"
            value={initialYear}
            readOnly
            className={`${inputClass} cursor-default text-gray-400 dark:text-zinc-500`}
          />
        </div>
        <div>
          {/* PLATFORM-086F2J — read-only, matching how Season Year is already
              presented one field above. The row is kept rather than deleted: the
              value is meaningful to an operator, and showing it is what makes
              "you cannot change this" legible instead of the field silently
              disappearing. */}
          <label className={labelClass} htmlFor="founded-year">
            Founded Year
          </label>
          <input
            id="founded-year"
            type="text"
            value={foundedYear}
            readOnly
            placeholder="Not recorded"
            aria-label="Founded year"
            className={`${inputClass} cursor-default text-gray-400 dark:text-zinc-500`}
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

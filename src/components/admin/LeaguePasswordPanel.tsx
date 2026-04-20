'use client';

import React, { useState } from 'react';

import { requireAdminAuthHeaders } from '@/lib/adminAuth';

type Status = 'idle' | 'saving' | 'success' | 'error';

export default function LeaguePasswordPanel({
  slug,
  initialHasPassword,
}: {
  slug: string;
  initialHasPassword: boolean;
}): React.ReactElement {
  const [hasPassword, setHasPassword] = useState(initialHasPassword);
  const [editing, setEditing] = useState(!initialHasPassword);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState<string | null>(null);

  function reset(nextHas: boolean) {
    setHasPassword(nextHas);
    setEditing(!nextHas);
    setPassword('');
    setConfirm('');
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (password.length < 4) {
      setStatus('error');
      setMessage('Password must be at least 4 characters.');
      return;
    }
    if (password !== confirm) {
      setStatus('error');
      setMessage('Passwords do not match.');
      return;
    }
    setStatus('saving');
    try {
      const res = await fetch(`/api/admin/leagues/${encodeURIComponent(slug)}/password`, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          ...(requireAdminAuthHeaders() as Record<string, string>),
        },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        setStatus('error');
        setMessage(`Error ${res.status}${text ? `: ${text.slice(0, 120)}` : ''}`);
        return;
      }
      setStatus('success');
      setMessage('Password saved.');
      reset(true);
    } catch (err) {
      setStatus('error');
      setMessage(err instanceof Error ? err.message : 'Unexpected error');
    }
  }

  async function handleRemove() {
    if (
      !window.confirm(
        'Remove the league password? The league will become publicly accessible to anyone with the URL.'
      )
    ) {
      return;
    }
    setStatus('saving');
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/leagues/${encodeURIComponent(slug)}/password`, {
        method: 'DELETE',
        headers: { ...(requireAdminAuthHeaders() as Record<string, string>) },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        setStatus('error');
        setMessage(`Error ${res.status}${text ? `: ${text.slice(0, 120)}` : ''}`);
        return;
      }
      setStatus('success');
      setMessage('Password removed. League is now public.');
      reset(false);
    } catch (err) {
      setStatus('error');
      setMessage(err instanceof Error ? err.message : 'Unexpected error');
    }
  }

  const inputClass =
    'w-full rounded border border-gray-300 bg-gray-50 px-3 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-gray-500 focus:outline-none disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500 dark:focus:border-zinc-500';
  const labelClass = 'block text-xs font-medium text-gray-500 dark:text-zinc-400 mb-1';
  const buttonClass =
    'rounded border border-gray-300 bg-gray-50 px-3 py-1.5 text-sm text-gray-900 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700';

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5 space-y-4 dark:border-zinc-700 dark:bg-zinc-900">
      <div className="space-y-1">
        <h2 className="text-base font-medium text-gray-900 dark:text-zinc-100">League Password</h2>
        <p className="text-xs text-gray-500 dark:text-zinc-400">
          When a password is set, only people who enter it (and platform admins) can view this
          league. Leave unset to keep the league public.
        </p>
      </div>

      {hasPassword && !editing && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/40 dark:text-green-300">
            Password set
          </span>
          <button
            type="button"
            onClick={() => {
              setEditing(true);
              setStatus('idle');
              setMessage(null);
            }}
            className={buttonClass}
          >
            Change password
          </button>
          <button
            type="button"
            onClick={() => void handleRemove()}
            disabled={status === 'saving'}
            className={`${buttonClass} text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/30`}
          >
            Remove password
          </button>
        </div>
      )}

      {editing && (
        <form onSubmit={(e) => void handleSave(e)} className="space-y-3">
          <div>
            <label htmlFor="lpp-password" className={labelClass}>
              {hasPassword ? 'New password' : 'Set league password'}
            </label>
            <input
              id="lpp-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={status === 'saving'}
              className={inputClass}
              placeholder="At least 4 characters"
            />
          </div>
          <div>
            <label htmlFor="lpp-confirm" className={labelClass}>
              Confirm password
            </label>
            <input
              id="lpp-confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              disabled={status === 'saving'}
              className={inputClass}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={status === 'saving' || password.length === 0 || confirm.length === 0}
              className={buttonClass}
            >
              {status === 'saving' ? 'Saving…' : 'Save password'}
            </button>
            {hasPassword && (
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setStatus('idle');
                  setMessage(null);
                  setPassword('');
                  setConfirm('');
                }}
                disabled={status === 'saving'}
                className={`${buttonClass} text-gray-600 dark:text-zinc-300`}
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      )}

      {message && (
        <p
          className={
            status === 'success'
              ? 'text-xs text-green-600 dark:text-green-400'
              : status === 'error'
                ? 'text-xs text-red-600 dark:text-red-400'
                : 'text-xs text-gray-500 dark:text-zinc-400'
          }
        >
          {message}
        </p>
      )}
    </section>
  );
}

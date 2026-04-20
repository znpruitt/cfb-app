'use client';

import React, { useEffect, useRef, useState } from 'react';

type Status = 'idle' | 'submitting' | 'error';

export default function LeaguePasswordGate({
  slug,
  leagueDisplayName,
}: {
  slug: string;
  leagueDisplayName: string;
}): React.ReactElement {
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (errorTimer.current) clearTimeout(errorTimer.current);
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (status === 'submitting') return;
    setStatus('submitting');
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/league/${encodeURIComponent(slug)}/auth`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        window.location.reload();
        return;
      }
      setStatus('error');
      setErrorMessage('Incorrect password');
      if (errorTimer.current) clearTimeout(errorTimer.current);
      errorTimer.current = setTimeout(() => {
        setErrorMessage(null);
        setStatus('idle');
      }, 4000);
    } catch {
      setStatus('error');
      setErrorMessage('Could not reach the server. Try again.');
    }
  }

  return (
    <main className="flex min-h-[80vh] items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-6 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
        <div className="mb-5 space-y-1.5 text-center">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-zinc-400">
            Private League
          </p>
          <h1 className="text-xl font-semibold text-gray-950 dark:text-zinc-50">
            {leagueDisplayName}
          </h1>
          <p className="text-xs text-gray-500 dark:text-zinc-400">
            Enter the league password to continue.
          </p>
        </div>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3">
          <div>
            <label
              htmlFor="league-password"
              className="mb-1 block text-xs font-medium text-gray-600 dark:text-zinc-300"
            >
              Password
            </label>
            <input
              id="league-password"
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={status === 'submitting'}
              className="w-full rounded border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-gray-500 focus:outline-none disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500 dark:focus:border-zinc-500"
            />
          </div>
          <button
            type="submit"
            disabled={status === 'submitting' || password.length === 0}
            className="w-full rounded border border-gray-300 bg-gray-50 px-4 py-2 text-sm font-medium text-gray-900 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
          >
            {status === 'submitting' ? 'Checking…' : 'Enter'}
          </button>
          <div className="min-h-[1.25rem] text-center text-xs text-red-600 dark:text-red-400">
            {errorMessage ?? ' '}
          </div>
        </form>
        <p className="mt-4 text-center text-[11px] text-gray-500 dark:text-zinc-500">
          Forgot the password? Contact your league commissioner.
        </p>
      </div>
    </main>
  );
}

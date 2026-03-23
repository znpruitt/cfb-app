'use client';

import React, { useEffect, useState } from 'react';

import { getStoredAdminToken, hasStoredAdminToken, setStoredAdminToken } from '../lib/adminAuth';

export default function AdminAuthPanel(): React.ReactElement {
  const [token, setToken] = useState<string>('');
  const [saved, setSaved] = useState<boolean>(false);

  useEffect(() => {
    setToken(getStoredAdminToken());
  }, []);

  const hasToken = hasStoredAdminToken();

  function handleSave(): void {
    setStoredAdminToken(token);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1200);
  }

  function handleClear(): void {
    setToken('');
    setStoredAdminToken('');
    setSaved(false);
  }

  return (
    <details>
      <summary className="cursor-pointer text-sm font-medium text-gray-700 dark:text-zinc-300">
        Admin access token
      </summary>
      <div className="mt-3 space-y-3 rounded border border-gray-200 bg-gray-50 p-3 text-sm dark:border-zinc-700 dark:bg-zinc-900">
        <p className="text-xs text-gray-600 dark:text-zinc-400">
          Enter the server-side admin token to enable mutating commissioner actions such as alias
          saves, owner uploads, team database sync, and forced refreshes. The token is stored only
          in this browser session.
        </p>
        <input
          type="password"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder="Paste ADMIN_API_TOKEN"
          className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
            onClick={handleSave}
            type="button"
          >
            Save token
          </button>
          <button
            className="rounded border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
            onClick={handleClear}
            type="button"
          >
            Clear token
          </button>
          {saved ? (
            <span className="text-xs text-green-700 dark:text-green-400">Token saved.</span>
          ) : hasToken ? (
            <span className="text-xs text-gray-600 dark:text-zinc-400">
              Token present in this session.
            </span>
          ) : (
            <span className="text-xs text-amber-700 dark:text-amber-300">
              No token saved in this browser session.
            </span>
          )}
        </div>
      </div>
    </details>
  );
}

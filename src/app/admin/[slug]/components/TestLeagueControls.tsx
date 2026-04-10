'use client';

import { useTransition } from 'react';
import { setTestLeagueStatus } from '../actions';

const btnClass =
  'px-3 py-1.5 rounded border border-gray-300 bg-white text-sm text-gray-900 transition-colors hover:bg-gray-50 hover:border-gray-400 disabled:opacity-50 disabled:cursor-not-allowed dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700/60';

export default function TestLeagueControls() {
  const [pending, startTransition] = useTransition();

  function handle(state: 'season' | 'offseason' | 'preseason') {
    startTransition(async () => {
      await setTestLeagueStatus(state);
    });
  }

  return (
    <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-5 space-y-3 dark:border-zinc-700 dark:bg-zinc-900">
      <div>
        <h2 className="text-base font-medium">Test Controls</h2>
        <p className="text-sm text-gray-500 dark:text-zinc-400">
          Sandbox controls — not available in production leagues
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button className={btnClass} disabled={pending} onClick={() => handle('season')}>
          Set: Season
        </button>
        <button className={btnClass} disabled={pending} onClick={() => handle('offseason')}>
          Set: Offseason
        </button>
        <button className={btnClass} disabled={pending} onClick={() => handle('preseason')}>
          Set: Pre-Season
        </button>
      </div>
    </div>
  );
}

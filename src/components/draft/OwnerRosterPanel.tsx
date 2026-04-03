'use client';

import React from 'react';
import type { DraftState } from '@/lib/draft';

type OwnerRosterPanelProps = {
  draft: DraftState;
};

export default function OwnerRosterPanel({ draft }: OwnerRosterPanelProps): React.ReactElement {
  const { draftOrder } = draft.settings;

  // Group picks by owner
  const picksByOwner = new Map<string, string[]>();
  for (const owner of draftOrder) {
    picksByOwner.set(owner, []);
  }
  for (const pick of draft.picks) {
    const list = picksByOwner.get(pick.owner);
    if (list) list.push(pick.team);
  }

  const currentOwnerIdx =
    draft.phase === 'live' || draft.phase === 'paused'
      ? (() => {
          const n = draftOrder.length;
          const idx = draft.currentPickIndex;
          const round = Math.floor(idx / n);
          const posInRound = idx % n;
          return round % 2 === 0 ? posInRound : n - 1 - posInRound;
        })()
      : -1;

  return (
    <div className="space-y-3">
      {draftOrder.map((owner, ownerIdx) => {
        const teams = picksByOwner.get(owner) ?? [];
        const isOnClock = ownerIdx === currentOwnerIdx;
        return (
          <div
            key={owner}
            className={`rounded-xl border p-3 ${
              isOnClock
                ? 'border-blue-300 bg-blue-50/60 dark:border-blue-700 dark:bg-blue-950/20'
                : 'border-gray-200 bg-gray-50/40 dark:border-zinc-700 dark:bg-zinc-800/30'
            }`}
          >
            <div className="flex items-center justify-between">
              <p
                className={`text-sm font-semibold ${
                  isOnClock
                    ? 'text-blue-800 dark:text-blue-300'
                    : 'text-gray-900 dark:text-zinc-100'
                }`}
              >
                {owner}
                {isOnClock && (
                  <span className="ml-2 text-xs font-normal text-blue-600 dark:text-blue-400">
                    ← picking
                  </span>
                )}
              </p>
              <span className="text-xs text-gray-400 dark:text-zinc-500">
                {teams.length} team{teams.length !== 1 ? 's' : ''}
              </span>
            </div>
            {teams.length > 0 && (
              <ul className="mt-2 space-y-0.5">
                {teams.map((team, i) => (
                  <li key={`${team}-${i}`} className="text-xs text-gray-700 dark:text-zinc-300">
                    {team}
                  </li>
                ))}
              </ul>
            )}
            {teams.length === 0 && (
              <p className="mt-1 text-xs text-gray-400 dark:text-zinc-500">No teams yet</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

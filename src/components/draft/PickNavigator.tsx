'use client';

import React from 'react';
import type { DraftState } from '@/lib/draft';

type PickNavigatorProps = {
  draft: DraftState;
};

function getPickOwner(draftOrder: string[], pickIndex: number): string | null {
  if (draftOrder.length === 0) return null;
  const n = draftOrder.length;
  const round = Math.floor(pickIndex / n);
  const posInRound = pickIndex % n;
  const ownerIdx = round % 2 === 0 ? posInRound : n - 1 - posInRound;
  return draftOrder[ownerIdx] ?? null;
}

export default function PickNavigator({ draft }: PickNavigatorProps): React.ReactElement {
  const { draftOrder, totalRounds } = draft.settings;
  const n = draftOrder.length;
  const totalPicks = totalRounds * n;
  const idx = draft.currentPickIndex;

  if (draft.phase === 'complete') {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50/60 px-4 py-3 dark:border-green-800/40 dark:bg-green-950/20">
        <p className="text-sm font-semibold text-green-800 dark:text-green-300">
          Draft complete — all {totalPicks} picks made
        </p>
      </div>
    );
  }

  if (idx >= totalPicks) {
    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 dark:border-zinc-700 dark:bg-zinc-800/40">
        <p className="text-sm text-gray-600 dark:text-zinc-400">No picks remaining</p>
      </div>
    );
  }

  const currentRound = Math.floor(idx / n) + 1;
  const currentPick = (idx % n) + 1;
  const currentOwner = getPickOwner(draftOrder, idx);

  const nextIdx = idx + 1;
  const nextOwner = nextIdx < totalPicks ? getPickOwner(draftOrder, nextIdx) : null;
  const nextRound = Math.floor(nextIdx / n) + 1;
  const nextPick = (nextIdx % n) + 1;

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50/60 px-4 py-3 dark:border-blue-800/40 dark:bg-blue-950/20">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-blue-600 dark:text-blue-400">
            On the clock
          </p>
          <p className="mt-0.5 text-lg font-bold text-gray-900 dark:text-zinc-50">
            {currentOwner}
          </p>
          <p className="text-xs text-gray-500 dark:text-zinc-400">
            Round {currentRound}, Pick {currentPick} (Overall #{idx + 1})
          </p>
        </div>
        {nextOwner && (
          <div className="text-right">
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-gray-400 dark:text-zinc-500">
              On deck
            </p>
            <p className="mt-0.5 text-sm font-semibold text-gray-700 dark:text-zinc-300">
              {nextOwner}
            </p>
            <p className="text-xs text-gray-400 dark:text-zinc-500">
              R{nextRound} P{nextPick}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

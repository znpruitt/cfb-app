'use client';

import React, { useEffect, useState } from 'react';
import type { DraftState } from '@/lib/draft';

type TimerDisplayProps = {
  draft: DraftState;
};

export default function TimerDisplay({ draft }: TimerDisplayProps): React.ReactElement | null {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    if (draft.timerState !== 'running' || !draft.timerExpiresAt) {
      setSecondsLeft(null);
      return;
    }

    function tick() {
      const remaining = Math.max(0, new Date(draft.timerExpiresAt!).getTime() - Date.now());
      setSecondsLeft(Math.ceil(remaining / 1000));
    }

    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [draft.timerState, draft.timerExpiresAt]);

  if (!draft.settings.pickTimerSeconds) return null;

  if (draft.timerState === 'off') return null;

  if (draft.timerState === 'paused') {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-2 dark:border-amber-700/40 dark:bg-amber-950/20">
        <span className="text-sm font-medium text-amber-700 dark:text-amber-400">Timer paused</span>
      </div>
    );
  }

  if (draft.timerState === 'expired') {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50/60 px-4 py-2 dark:border-red-800/40 dark:bg-red-950/20">
        <span className="text-sm font-medium text-red-700 dark:text-red-400">Time expired</span>
      </div>
    );
  }

  // running
  const secs = secondsLeft ?? 0;
  const isUrgent = secs <= 10;
  const totalSecs = draft.settings.pickTimerSeconds ?? 60;
  const pct = totalSecs > 0 ? Math.min(1, secs / totalSecs) : 0;

  return (
    <div
      className={`rounded-lg border px-4 py-2 ${
        isUrgent
          ? 'border-red-200 bg-red-50/60 dark:border-red-800/40 dark:bg-red-950/20'
          : 'border-gray-200 bg-gray-50/60 dark:border-zinc-700 dark:bg-zinc-800/40'
      }`}
    >
      <div className="flex items-center justify-between">
        <span
          className={`text-2xl font-mono font-bold tabular-nums ${
            isUrgent ? 'text-red-700 dark:text-red-400' : 'text-gray-900 dark:text-zinc-50'
          }`}
        >
          {secs}s
        </span>
        <span className="text-xs text-gray-500 dark:text-zinc-400">On the clock</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-200 dark:bg-zinc-700">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            isUrgent ? 'bg-red-500' : 'bg-blue-500'
          }`}
          style={{ width: `${Math.round(pct * 100)}%` }}
        />
      </div>
    </div>
  );
}

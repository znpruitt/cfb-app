'use client';

import React, { useEffect, useState } from 'react';
import type { DraftState } from '@/lib/draft';

type DraftHeaderAreaProps = {
  draft: DraftState;
  /** If true, show commissioner controls row (Pause/Resume, Undo, Settings gear). */
  isAdmin?: boolean;
  onPause?: () => void;
  onResume?: () => void;
  onUndo?: () => void;
  onAutoPick?: () => void;
  onSelectManually?: () => void;
  onStartRound?: () => void;
  settingsHref?: string;
  controlsLoading?: boolean;
};

function getPickOwner(draftOrder: string[], pickIndex: number): string | null {
  if (draftOrder.length === 0) return null;
  const n = draftOrder.length;
  const round = Math.floor(pickIndex / n);
  const posInRound = pickIndex % n;
  const ownerIdx = round % 2 === 0 ? posInRound : n - 1 - posInRound;
  return draftOrder[ownerIdx] ?? null;
}

const CIRCUMFERENCE = 2 * Math.PI * 32; // r=32 → ~201.06

export default function DraftHeaderArea({
  draft,
  isAdmin,
  onPause,
  onResume,
  onUndo,
  onAutoPick,
  onSelectManually,
  onStartRound,
  settingsHref,
  controlsLoading,
}: DraftHeaderAreaProps): React.ReactElement {
  const { draftOrder, totalRounds, pickTimerSeconds } = draft.settings;
  const n = draftOrder.length;
  const totalPicks = totalRounds * n;
  const idx = draft.currentPickIndex;

  // Timer countdown
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

  // Complete state
  if (draft.phase === 'complete') {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50/60 px-4 py-3 dark:border-green-800/40 dark:bg-green-950/20">
        <p className="text-sm font-semibold text-green-800 dark:text-green-300">
          Draft complete — all {totalPicks} picks made
        </p>
      </div>
    );
  }

  // Derived pick data
  const currentRound = Math.floor(idx / n) + 1;
  const activeOwner = getPickOwner(draftOrder, idx) ?? '—';
  const overallPickNumber = idx + 1;

  const nextIdx = idx + 1;
  const nextOwner = nextIdx < totalPicks ? getPickOwner(draftOrder, nextIdx) : null;
  const nextPickRound = Math.floor(nextIdx / n) + 1;

  const lastPick = draft.picks.length > 0 ? draft.picks[draft.picks.length - 1]! : null;
  const previousRound = lastPick ? lastPick.round + 1 : null; // lastPick.round is 0-based

  // Round boundary detection
  const isFirstPickOfRound = idx > 0 && idx % n === 0;
  const isLastPickOfRound = nextIdx < totalPicks && nextIdx % n === 0;

  // Paused states
  const isPaused = draft.phase === 'paused' || (draft.phase === 'live' && draft.timerState === 'paused');
  const isExpired = draft.timerState === 'expired';
  const isRoundPause = draft.phase === 'paused' && idx > 0 && idx % n === 0 && idx < totalPicks && !isExpired;

  // Timer values for the circular clock
  const totalSecs = pickTimerSeconds ?? 60;
  let displaySeconds: number;
  let timerFraction: number;

  if (draft.timerState === 'running' && secondsLeft !== null) {
    displaySeconds = secondsLeft;
    timerFraction = totalSecs > 0 ? secondsLeft / totalSecs : 1;
  } else if (draft.timerState === 'paused' && draft.timerExpiresAt) {
    // When paused, show the frozen time
    const remaining = Math.max(0, new Date(draft.timerExpiresAt).getTime() - Date.now());
    displaySeconds = Math.ceil(remaining / 1000);
    // If paused timer shows 0 or negative, use last known from picks context
    if (displaySeconds <= 0 && pickTimerSeconds) displaySeconds = pickTimerSeconds;
    timerFraction = totalSecs > 0 ? displaySeconds / totalSecs : 1;
  } else if (pickTimerSeconds) {
    displaySeconds = pickTimerSeconds;
    timerFraction = 1;
  } else {
    displaySeconds = 0;
    timerFraction = 1;
  }

  const dashOffset = CIRCUMFERENCE * (1 - Math.max(0, Math.min(1, timerFraction)));
  const showClock = !!pickTimerSeconds;
  const isPausedVisual = isPaused || isRoundPause || isExpired;

  return (
    <div>
      {/* Round header */}
      <div className="mb-2.5 flex items-center gap-3">
        <span className="whitespace-nowrap text-[11px] font-medium uppercase tracking-[0.1em] text-blue-400">
          Round {currentRound}
        </span>
        <div className="h-px flex-1 bg-gray-800" />
      </div>

      {/* Three-card grid: previous / active / on-deck */}
      <div className="grid grid-cols-[1fr_3fr_1fr] gap-2 items-stretch">
        {/* Left: previous pick */}
        <div className="rounded-[10px] border border-gray-800 bg-[#161d2a] px-3 py-2 flex flex-col gap-0.5">
          {isFirstPickOfRound && previousRound && (
            <span className="mb-0.5 self-start rounded bg-[#1e3a5f] px-1.5 py-0.5 text-[9px] tracking-[0.04em] text-blue-700">
              End of Round {previousRound}
            </span>
          )}
          <span className="text-[10px] uppercase tracking-[0.06em] text-gray-700">Previous</span>
          {lastPick ? (
            <>
              <span className="text-xs font-medium text-gray-500">{lastPick.team}</span>
              <span className="text-[11px] text-gray-700">{lastPick.owner}</span>
            </>
          ) : (
            <span className="text-[11px] text-gray-700">—</span>
          )}
        </div>

        {/* Center: active pick with clock */}
        <div
          className={`rounded-[10px] border px-4 py-3 flex items-center gap-4 ${
            isPausedVisual
              ? 'border-gray-700 bg-[#1a1f2a]'
              : 'border-blue-600 bg-[#1a2540]'
          }`}
        >
          {showClock && (
            <div className="relative flex shrink-0 items-center justify-center">
              <svg width="76" height="76" viewBox="0 0 76 76" className="block">
                {/* Track */}
                <circle cx="38" cy="38" r="32" fill="none" stroke={isPausedVisual ? '#1f2937' : '#1e3a5f'} strokeWidth="5" />
                {/* Progress */}
                <circle
                  cx="38" cy="38" r="32" fill="none"
                  stroke={isPausedVisual ? '#d97706' : '#2563eb'}
                  strokeWidth="5"
                  strokeDasharray={CIRCUMFERENCE}
                  strokeDashoffset={dashOffset}
                  strokeLinecap="round"
                  transform="rotate(-90 38 38)"
                />
                {/* Time text */}
                <text
                  x="38" y="44" textAnchor="middle"
                  fontSize="22" fontWeight="500"
                  fill={isPausedVisual ? '#374151' : '#f9fafb'}
                >
                  {displaySeconds}
                </text>
              </svg>
              {/* Pause icon overlay */}
              {isPausedVisual && (
                <div className="absolute inset-0 flex items-center justify-center gap-1">
                  <div className="h-[18px] w-[5px] rounded-sm bg-amber-600" />
                  <div className="h-[18px] w-[5px] rounded-sm bg-amber-600" />
                </div>
              )}
            </div>
          )}
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className={`text-[10px] font-medium uppercase tracking-[0.08em] ${isPausedVisual ? 'text-gray-500' : 'text-blue-400'}`}>
              On the clock
            </span>
            <span className={`text-[26px] font-medium leading-tight ${isPausedVisual ? 'text-gray-500' : 'text-gray-50'}`}>
              {activeOwner}
            </span>
            <span className={`mt-0.5 text-xs ${isPausedVisual ? 'text-gray-700' : 'text-gray-500'}`}>
              Pick {overallPickNumber}
            </span>
          </div>
        </div>

        {/* Right: on deck */}
        <div className="rounded-[10px] border border-gray-800 bg-[#161d2a] px-3 py-2 flex flex-col items-end gap-0.5">
          {isLastPickOfRound && nextPickRound !== currentRound && (
            <span className="mb-0.5 self-end rounded bg-[#1e3a5f] px-1.5 py-0.5 text-[9px] tracking-[0.04em] text-blue-700">
              Round {nextPickRound}
            </span>
          )}
          <span className="text-[10px] uppercase tracking-[0.06em] text-gray-700">On deck</span>
          {nextOwner ? (
            <span className="text-xs font-medium text-gray-500">{nextOwner}</span>
          ) : (
            <span className="text-[11px] text-gray-700">—</span>
          )}
        </div>
      </div>

      {/* Round pause banner */}
      {isRoundPause && isAdmin && onStartRound && (
        <div className="mt-2.5 flex items-center gap-3 rounded-lg border border-blue-800/40 bg-blue-950/30 px-4 py-2.5">
          <span className="text-sm font-semibold text-blue-300">
            Round {currentRound - 1} complete
          </span>
          <button
            type="button"
            onClick={onStartRound}
            disabled={controlsLoading}
            className="ml-auto rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Start Round {currentRound}
          </button>
        </div>
      )}
      {isRoundPause && !isAdmin && (
        <div className="mt-2.5 rounded-lg border border-blue-800/40 bg-blue-950/30 px-4 py-2.5">
          <span className="text-sm font-semibold text-blue-300">
            Round {currentRound} starting soon…
          </span>
        </div>
      )}

      {/* Timer-expired overlay */}
      {isExpired && draft.phase === 'paused' && isAdmin && (
        <div className="mt-2.5 flex items-center gap-2 rounded-lg border border-amber-700/40 bg-amber-950/30 px-4 py-2.5">
          <span className="text-sm font-semibold text-amber-300">Timer expired</span>
          <div className="ml-auto flex gap-2">
            {onAutoPick && (
              <button
                type="button"
                onClick={onAutoPick}
                disabled={controlsLoading}
                className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                Auto-pick
              </button>
            )}
            {onSelectManually && (
              <button
                type="button"
                onClick={onSelectManually}
                disabled={controlsLoading}
                className="rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 hover:bg-zinc-700 disabled:opacity-50"
              >
                Select manually
              </button>
            )}
          </div>
        </div>
      )}

      {/* Controls row — admin only */}
      {isAdmin && !isRoundPause && !(isExpired && draft.phase === 'paused') && (
        <div className="mt-2.5 flex items-center gap-2">
          {/* Pause / Resume */}
          {draft.phase === 'live' && draft.timerState === 'running' && onPause && (
            <button
              type="button"
              onClick={onPause}
              disabled={controlsLoading}
              className="rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 hover:bg-zinc-700 disabled:opacity-50"
            >
              Pause
            </button>
          )}
          {((draft.phase === 'paused' && !isExpired && !isRoundPause) ||
            (draft.phase === 'live' && draft.timerState === 'paused')) && onResume && (
            <button
              type="button"
              onClick={onResume}
              disabled={controlsLoading}
              className="rounded bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
            >
              Resume
            </button>
          )}
          {/* Start timer (no timer running yet) */}
          {draft.phase === 'live' && draft.timerState === 'off' && pickTimerSeconds && onResume && (
            <button
              type="button"
              onClick={onResume}
              disabled={controlsLoading}
              className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Start timer
            </button>
          )}
          {/* Undo */}
          {draft.picks.length > 0 && onUndo && (
            <button
              type="button"
              onClick={onUndo}
              disabled={controlsLoading}
              className="rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 hover:bg-zinc-700 disabled:opacity-50"
            >
              Undo
            </button>
          )}
          {/* Settings gear — right-aligned */}
          {settingsHref && (
            <a
              href={settingsHref}
              className="ml-auto flex h-8 w-8 items-center justify-center rounded border border-zinc-700 bg-zinc-800 text-zinc-400 transition hover:bg-zinc-700 hover:text-zinc-200"
              title="Settings"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M7.068 1a1 1 0 0 0-.98.804l-.264 1.32a5.53 5.53 0 0 0-.952.55l-1.27-.43a1 1 0 0 0-1.194.46l-.932 1.614a1 1 0 0 0 .214 1.264l1.006.89a5.6 5.6 0 0 0 0 1.1l-1.006.89a1 1 0 0 0-.214 1.264l.932 1.614a1 1 0 0 0 1.194.46l1.27-.43c.294.214.613.4.952.55l.264 1.32a1 1 0 0 0 .98.804h1.864a1 1 0 0 0 .98-.804l.264-1.32c.34-.15.658-.336.952-.55l1.27.43a1 1 0 0 0 1.194-.46l.932-1.614a1 1 0 0 0-.214-1.264l-1.006-.89a5.6 5.6 0 0 0 0-1.1l1.006-.89a1 1 0 0 0 .214-1.264l-.932-1.614a1 1 0 0 0-1.194-.46l-1.27.43a5.53 5.53 0 0 0-.952-.55l-.264-1.32A1 1 0 0 0 8.932 1H7.068ZM8 10.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5Z" />
              </svg>
            </a>
          )}
        </div>
      )}
    </div>
  );
}

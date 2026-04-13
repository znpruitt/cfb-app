'use client';

import React, { useEffect, useRef, useState } from 'react';
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

  // --- Crossfade slot tracking (useRef to avoid re-render timing issues) ---
  const activeSlotRef = useRef<'a' | 'b'>('a');
  const prevIdxRef = useRef(idx);
  const slotARef = useRef({ owner: '', pickNum: 0 });
  const slotBRef = useRef({ owner: '', pickNum: 0 });

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
    const remaining = Math.max(0, new Date(draft.timerExpiresAt).getTime() - Date.now());
    displaySeconds = Math.ceil(remaining / 1000);
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

  // --- Crossfade slot content update ---
  if (idx !== prevIdxRef.current) {
    // Pick index changed (advance or undo) — flip to inactive slot with new content
    const newSlot = activeSlotRef.current === 'a' ? 'b' : 'a';
    if (newSlot === 'a') {
      slotARef.current = { owner: activeOwner, pickNum: overallPickNumber };
    } else {
      slotBRef.current = { owner: activeOwner, pickNum: overallPickNumber };
    }
    activeSlotRef.current = newSlot;
    prevIdxRef.current = idx;
  } else {
    // No idx change — keep active slot content in sync with current state
    if (activeSlotRef.current === 'a') {
      slotARef.current = { owner: activeOwner, pickNum: overallPickNumber };
    } else {
      slotBRef.current = { owner: activeOwner, pickNum: overallPickNumber };
    }
  }

  const slotA = slotARef.current;
  const slotB = slotBRef.current;
  const isSlotA = activeSlotRef.current === 'a';

  // --- Card data for flanking positions (with team name for completed picks) ---
  function getCardData(pickIdx: number) {
    if (pickIdx < 0 || pickIdx >= totalPicks) return null;
    const owner = getPickOwner(draftOrder, pickIdx) ?? '—';
    const pickNum = pickIdx + 1;
    const team = pickIdx < draft.picks.length ? (draft.picks[pickIdx]?.team ?? null) : null;
    return { owner, pickNum, team };
  }

  const farLeft = getCardData(idx - 2);
  const nearLeft = getCardData(idx - 1);
  const nearRight = getCardData(idx + 1);
  const farRight = getCardData(idx + 2);

  // --- Text colors for center card (dimmed when paused) ---
  const labelColor = isPausedVisual ? '#4b5563' : '#6b7280';
  const ownerColor = isPausedVisual ? '#4b5563' : '#f9fafb';
  const pickNumColor = isPausedVisual ? '#374151' : '#6b7280';

  // --- Round boundary sidebar ---
  function isRoundStart(pickIdx: number): boolean {
    return pickIdx >= 0 && pickIdx < totalPicks && pickIdx % n === 0;
  }

  function renderRoundSidebar(pickIdx: number) {
    const round = Math.floor(pickIdx / n) + 1;
    return (
      <div style={{
        width: 16, flexShrink: 0,
        borderRight: '1px solid rgba(255,255,255,0.12)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <span style={{
          writingMode: 'vertical-rl' as const,
          transform: 'rotate(180deg)',
          fontSize: 9,
          letterSpacing: '0.1em',
          textTransform: 'uppercase' as const,
          color: 'rgba(255,255,255,0.3)',
          whiteSpace: 'nowrap' as const,
        }}>
          Rd {round}
        </span>
      </div>
    );
  }

  const sidebarFarLeft = isRoundStart(idx - 2);
  const sidebarNearLeft = isRoundStart(idx - 1);
  const sidebarCenter = isRoundStart(idx);
  const sidebarNearRight = isRoundStart(idx + 1);
  const sidebarFarRight = isRoundStart(idx + 2);

  return (
    <div>
      {/* Round header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
        <span style={{ whiteSpace: 'nowrap', fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#60a5fa' }}>
          Round {currentRound}
        </span>
        <div style={{ height: 1, flex: 1, background: '#1f2937' }} />
      </div>

      {/* Five-card landscape strip — full content width */}
      <div style={{ display: 'flex', width: '100%', maxWidth: 900, marginLeft: 'auto', marginRight: 'auto', alignItems: 'stretch', gap: 8 }}>

        {/* Far-left card (idx-2) */}
        <div style={{
          flex: '0.65', minWidth: 0,
          background: '#111111', border: '0.5px solid #1f2937', borderRadius: 10,
          opacity: 0.5,
          display: 'flex', alignItems: 'stretch', overflow: 'hidden',
        }}>
          {sidebarFarLeft && renderRoundSidebar(idx - 2)}
          <div style={{
            flex: 1, minWidth: 0,
            padding: sidebarFarLeft ? '9px 10px 9px 6px' : '9px 10px',
            display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 2,
          }}>
            {farLeft ? (
              <>
                <span style={{ fontSize: 10, color: '#374151', textTransform: 'uppercase' }}>Pick {farLeft.pickNum}</span>
                <span style={{ fontSize: 12, fontWeight: 500, color: '#4b5563', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{farLeft.owner}</span>
                <span style={{ fontSize: 10, color: '#374151' }}>{farLeft.team ?? '—'}</span>
              </>
            ) : (
              <span style={{ fontSize: 13, color: '#374151' }}>—</span>
            )}
          </div>
        </div>

        {/* Near-left card (idx-1) */}
        <div style={{
          flex: '0.85', minWidth: 0,
          background: '#161616', border: '0.5px solid #252525', borderRadius: 10,
          opacity: 0.75,
          display: 'flex', alignItems: 'stretch', overflow: 'hidden',
        }}>
          {sidebarNearLeft && renderRoundSidebar(idx - 1)}
          <div style={{
            flex: 1, minWidth: 0,
            padding: sidebarNearLeft ? '11px 12px 11px 6px' : '11px 12px',
            display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 2,
          }}>
            {nearLeft ? (
              <>
                <span style={{ fontSize: 10, color: '#374151', textTransform: 'uppercase' }}>Pick {nearLeft.pickNum}</span>
                <span style={{ fontSize: 14, fontWeight: 500, color: '#6b7280', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{nearLeft.owner}</span>
                <span style={{ fontSize: 12, color: '#4b5563' }}>{nearLeft.team ?? '—'}</span>
              </>
            ) : (
              <span style={{ fontSize: 13, color: '#374151' }}>—</span>
            )}
          </div>
        </div>

        {/* Center card — active pick with clock + crossfade content */}
        <div style={{
          flex: '2', minWidth: 0,
          background: '#1f2937',
          border: `0.5px solid ${isPausedVisual ? '#374151' : '#2563eb'}`,
          borderRadius: 10,
          display: 'flex', alignItems: 'stretch', overflow: 'hidden',
        }}>
          {sidebarCenter && renderRoundSidebar(idx)}
          <div style={{
            flex: 1, minWidth: 0,
            padding: sidebarCenter ? '13px 16px 13px 8px' : '13px 16px',
            display: 'flex', alignItems: 'center', gap: 12,
          }}>
            {showClock && (
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="76" height="76" viewBox="0 0 76 76" style={{ display: 'block' }}>
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
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                    <div style={{ height: 18, width: 5, borderRadius: 2, background: '#d97706' }} />
                    <div style={{ height: 18, width: 5, borderRadius: 2, background: '#d97706' }} />
                  </div>
                )}
              </div>
            )}
            {/* Text column: static label + crossfade owner/pick */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
              <span style={{ fontSize: 10, color: labelColor, textTransform: 'uppercase', fontWeight: 500, letterSpacing: '0.07em' }}>On the clock</span>
              {/* Crossfade area — grid overlay for owner + pick number */}
              <div style={{ display: 'grid' }}>
                {/* Slot A */}
                <div style={{
                  gridRow: 1, gridColumn: 1,
                  display: 'flex', flexDirection: 'column', gap: 1,
                  opacity: isSlotA ? 1 : 0,
                  pointerEvents: isSlotA ? 'auto' : 'none',
                  transition: 'opacity 0.2s ease',
                }}>
                  <span style={{ fontSize: 22, fontWeight: 500, color: ownerColor, whiteSpace: 'nowrap' }}>{slotA.owner}</span>
                  <span style={{ fontSize: 12, color: pickNumColor }}>Pick {slotA.pickNum}</span>
                </div>
                {/* Slot B */}
                <div style={{
                  gridRow: 1, gridColumn: 1,
                  display: 'flex', flexDirection: 'column', gap: 1,
                  opacity: isSlotA ? 0 : 1,
                  pointerEvents: isSlotA ? 'none' : 'auto',
                  transition: 'opacity 0.2s ease',
                }}>
                  <span style={{ fontSize: 22, fontWeight: 500, color: ownerColor, whiteSpace: 'nowrap' }}>{slotB.owner}</span>
                  <span style={{ fontSize: 12, color: pickNumColor }}>Pick {slotB.pickNum}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Near-right card (idx+1) */}
        <div style={{
          flex: '0.85', minWidth: 0,
          background: '#161616', border: '0.5px solid #252525', borderRadius: 10,
          opacity: 0.75,
          display: 'flex', alignItems: 'stretch', overflow: 'hidden',
        }}>
          {sidebarNearRight && renderRoundSidebar(idx + 1)}
          <div style={{
            flex: 1, minWidth: 0,
            padding: sidebarNearRight ? '11px 12px 11px 6px' : '11px 12px',
            display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 2,
          }}>
            {nearRight ? (
              <>
                <span style={{ fontSize: 10, color: '#374151', textTransform: 'uppercase' }}>Pick {nearRight.pickNum}</span>
                <span style={{ fontSize: 14, fontWeight: 500, color: '#6b7280', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{nearRight.owner}</span>
                <span style={{ fontSize: 12, color: '#4b5563' }}>{nearRight.team ?? '—'}</span>
              </>
            ) : (
              <span style={{ fontSize: 13, color: '#374151' }}>—</span>
            )}
          </div>
        </div>

        {/* Far-right card (idx+2) */}
        <div style={{
          flex: '0.65', minWidth: 0,
          background: '#111111', border: '0.5px solid #1f2937', borderRadius: 10,
          opacity: 0.5,
          display: 'flex', alignItems: 'stretch', overflow: 'hidden',
        }}>
          {sidebarFarRight && renderRoundSidebar(idx + 2)}
          <div style={{
            flex: 1, minWidth: 0,
            padding: sidebarFarRight ? '9px 10px 9px 6px' : '9px 10px',
            display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 2,
          }}>
            {farRight ? (
              <>
                <span style={{ fontSize: 10, color: '#374151', textTransform: 'uppercase' }}>Pick {farRight.pickNum}</span>
                <span style={{ fontSize: 12, fontWeight: 500, color: '#4b5563', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{farRight.owner}</span>
                <span style={{ fontSize: 10, color: '#374151' }}>{farRight.team ?? '—'}</span>
              </>
            ) : (
              <span style={{ fontSize: 13, color: '#374151' }}>—</span>
            )}
          </div>
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

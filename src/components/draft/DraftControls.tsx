'use client';

import React, { useState } from 'react';
import { requireAdminAuthHeaders } from '@/lib/adminAuth';
import type { DraftState } from '@/lib/draft';

type DraftControlsProps = {
  slug: string;
  year: number;
  draft: DraftState;
  onUpdate: (draft: DraftState) => void;
};

export default function DraftControls({
  slug,
  year,
  draft,
  onUpdate,
}: DraftControlsProps): React.ReactElement {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const baseUrl = `/api/draft/${encodeURIComponent(slug)}/${year}`;

  async function callPut(body: Record<string, unknown>) {
    setError(null);
    setLoading(true);
    try {
      const authHeaders = requireAdminAuthHeaders() as Record<string, string>;
      const res = await fetch(baseUrl, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', ...authHeaders },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { draft?: DraftState; error?: string };
      if (!res.ok || !data.draft) {
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      onUpdate(data.draft);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function callPost(path: string, body?: Record<string, unknown>) {
    setError(null);
    setLoading(true);
    try {
      const authHeaders = requireAdminAuthHeaders() as Record<string, string>;
      const res = await fetch(`${baseUrl}/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeaders },
        body: JSON.stringify(body ?? {}),
      });
      const data = (await res.json()) as { draft?: DraftState; error?: string };
      if (!res.ok || !data.draft) {
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      onUpdate(data.draft);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function handleStartTimer() {
    void callPut({ timerAction: 'start' });
  }

  function handlePauseTimer() {
    void callPut({ timerAction: 'pause' });
  }

  function handleResumeTimer() {
    void callPut({ timerAction: 'resume' });
  }

  function handleUnpick() {
    void callPost('unpick');
  }

  function handleAutoPick() {
    void callPut({ timerAction: 'expire' });
  }

  function handleReset() {
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    setConfirmReset(false);
    void callPost('reset');
  }

  const { phase, timerState } = draft;
  const hasTimer = !!draft.settings.pickTimerSeconds;
  const hasPicks = draft.picks.length > 0;
  const isExpired = timerState === 'expired';

  return (
    <div className="space-y-3">
      {/* Pause-and-prompt overlay */}
      {phase === 'paused' && isExpired && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-4 dark:border-amber-700/40 dark:bg-amber-950/30">
          <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
            Timer expired — pick required
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleAutoPick}
              disabled={loading}
              className="rounded border border-blue-600 bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Auto-pick
            </button>
            <button
              type="button"
              onClick={() => void callPut({ phase: 'live' })}
              disabled={loading}
              className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 hover:bg-gray-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            >
              Select manually
            </button>
          </div>
        </div>
      )}

      {/* Main controls */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Timer controls */}
        {hasTimer && phase === 'live' && timerState === 'off' && (
          <button
            type="button"
            onClick={handleStartTimer}
            disabled={loading}
            className="rounded border border-blue-600 bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Start timer
          </button>
        )}
        {hasTimer && phase === 'live' && timerState === 'running' && (
          <button
            type="button"
            onClick={handlePauseTimer}
            disabled={loading}
            className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 hover:bg-gray-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          >
            Pause timer
          </button>
        )}
        {hasTimer && phase === 'live' && timerState === 'paused' && (
          <button
            type="button"
            onClick={handleResumeTimer}
            disabled={loading}
            className="rounded border border-blue-600 bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Resume timer
          </button>
        )}

        {/* Unpick */}
        {hasPicks && (phase === 'live' || phase === 'paused' || phase === 'complete') && (
          <button
            type="button"
            onClick={handleUnpick}
            disabled={loading}
            className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 hover:bg-gray-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          >
            Undo last pick
          </button>
        )}

        {/* Reset */}
        {(phase === 'live' || phase === 'paused' || phase === 'complete' || phase === 'preview') && (
          <button
            type="button"
            onClick={handleReset}
            disabled={loading}
            className={`rounded border px-3 py-1.5 text-sm disabled:opacity-50 ${
              confirmReset
                ? 'border-red-600 bg-red-600 font-medium text-white hover:bg-red-700'
                : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400'
            }`}
          >
            {confirmReset ? 'Confirm reset?' : 'Reset draft'}
          </button>
        )}
        {confirmReset && (
          <button
            type="button"
            onClick={() => setConfirmReset(false)}
            className="text-xs text-gray-400 hover:text-gray-600 dark:text-zinc-500"
          >
            Cancel
          </button>
        )}
      </div>

      {error && <p className="text-sm text-red-700 dark:text-red-400">{error}</p>}
    </div>
  );
}

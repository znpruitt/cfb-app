'use client';

import React, { useEffect, useState, useRef } from 'react';
import { requireAdminAuthHeaders } from '@/lib/adminAuth';
import type { DraftState } from '@/lib/draft';
import DraftSettingsPanel from './DraftSettingsPanel';

const TIMER_OPTIONS: { label: string; value: number | null }[] = [
  { label: 'No timer', value: null },
  { label: '30 seconds', value: 30 },
  { label: '60 seconds', value: 60 },
  { label: '90 seconds', value: 90 },
  { label: '2 minutes', value: 120 },
];

type DraftSetupShellProps = {
  slug: string;
  year: number;
  draftState: DraftState | null;
  priorOwners: string[];
  priorChampOrder: string[] | null;
  fbsTeamCount: number;
};

export default function DraftSetupShell({
  slug,
  year,
  draftState: initialDraftState,
  priorOwners,
  priorChampOrder,
  fbsTeamCount,
}: DraftSetupShellProps): React.ReactElement {
  const [draftState, setDraftState] = useState<DraftState | null>(initialDraftState);
  const [backLoading, setBackLoading] = useState(false);
  const [backError, setBackError] = useState<string | null>(null);
  const [autoAdvancing, setAutoAdvancing] = useState(false);
  const autoAdvancedRef = useRef(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  const phase = draftState?.phase ?? 'setup';

  // Auto-advance: when phase is 'setup' or draft is null, auto-create/advance to settings
  // using preseason owners (or existing draft owners as fallback).
  useEffect(() => {
    if (autoAdvancedRef.current) return;
    if (phase !== 'setup' && draftState !== null) return;

    const owners =
      priorOwners.length >= 2
        ? priorOwners
        : draftState?.owners && draftState.owners.length >= 2
          ? draftState.owners
          : null;

    if (!owners) return; // Not enough owners to auto-advance — will show settings with empty state

    autoAdvancedRef.current = true;
    setAutoAdvancing(true);

    void (async () => {
      try {
        const authHeaders = requireAdminAuthHeaders() as Record<string, string>;

        // Create draft if it doesn't exist
        if (!draftState) {
          const createRes = await fetch(`/api/draft/${encodeURIComponent(slug)}/${year}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...authHeaders },
            body: JSON.stringify({ owners }),
          });
          if (!createRes.ok && createRes.status !== 409) {
            setAutoAdvancing(false);
            return;
          }
        }

        // Advance to settings phase
        const putRes = await fetch(`/api/draft/${encodeURIComponent(slug)}/${year}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json', ...authHeaders },
          body: JSON.stringify({ owners, phase: 'settings' }),
        });
        if (putRes.ok) {
          const data = (await putRes.json()) as { draft: DraftState };
          setDraftState(data.draft);
        }
      } catch {
        // Non-fatal — user can still interact with settings
      } finally {
        setAutoAdvancing(false);
      }
    })();
  }, [phase, draftState, priorOwners, slug, year]);

  async function handleBackToSettings() {
    setBackError(null);
    setBackLoading(true);
    try {
      const authHeaders = requireAdminAuthHeaders() as Record<string, string>;
      const res = await fetch(`/api/draft/${encodeURIComponent(slug)}/${year}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', ...authHeaders },
        body: JSON.stringify({ phase: 'settings' }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setBackError(data.error ?? `Failed to go back (${res.status})`);
        return;
      }
      const data = (await res.json()) as { draft: DraftState };
      setDraftState(data.draft);
    } catch (err) {
      setBackError((err as Error).message);
    } finally {
      setBackLoading(false);
    }
  }

  async function handleTimerUpdate(newTimer: number | null) {
    setSettingsError(null);
    setSettingsLoading(true);
    try {
      const authHeaders = requireAdminAuthHeaders() as Record<string, string>;
      const res = await fetch(`/api/draft/${encodeURIComponent(slug)}/${year}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', ...authHeaders },
        body: JSON.stringify({ settings: { pickTimerSeconds: newTimer } }),
      });
      if (res.ok) {
        const data = (await res.json()) as { draft: DraftState };
        setDraftState(data.draft);
      } else {
        const data = (await res.json()) as { error?: string };
        setSettingsError(data.error ?? 'Failed to update timer');
      }
    } catch (err) {
      setSettingsError((err as Error).message);
    } finally {
      setSettingsLoading(false);
    }
  }

  async function handleResetDraft() {
    if (!resetConfirm) {
      setResetConfirm(true);
      return;
    }
    setResetConfirm(false);
    setSettingsError(null);
    setSettingsLoading(true);
    try {
      const authHeaders = requireAdminAuthHeaders() as Record<string, string>;
      const res = await fetch(`/api/draft/${encodeURIComponent(slug)}/${year}/reset`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeaders },
        body: '{}',
      });
      const data = (await res.json()) as { draft?: DraftState; error?: string };
      if (res.ok && data.draft) {
        setDraftState(data.draft);
      } else {
        setSettingsError(data.error ?? 'Failed to reset draft');
      }
    } catch (err) {
      setSettingsError((err as Error).message);
    } finally {
      setSettingsLoading(false);
    }
  }

  if (phase === 'live' || phase === 'paused' || phase === 'complete') {
    const currentTimer = draftState?.settings.pickTimerSeconds ?? null;
    return (
      <div className="space-y-6">
        <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-zinc-700 dark:bg-zinc-900">
          <h2 className="text-xs font-bold uppercase tracking-[0.15em] text-gray-500 dark:text-zinc-400">
            Draft Settings
          </h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-zinc-400">
            Draft is {phase === 'live' ? 'in progress' : phase}.
            {phase !== 'complete' && ' Changes apply to future picks.'}
          </p>

          {/* Pick timer selector */}
          <div className="mt-5">
            <label className="block text-sm font-medium text-gray-700 dark:text-zinc-300">
              Pick timer
            </label>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {TIMER_OPTIONS.map((opt) => (
                <button
                  key={opt.label}
                  type="button"
                  disabled={settingsLoading}
                  onClick={() => void handleTimerUpdate(opt.value)}
                  className={`rounded border px-3 py-1.5 text-sm disabled:opacity-50 ${
                    currentTimer === opt.value
                      ? 'border-blue-600 bg-blue-600 font-medium text-white'
                      : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {settingsError && (
            <p className="mt-3 text-sm text-red-700 dark:text-red-400">{settingsError}</p>
          )}

          {/* Actions */}
          <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-gray-200 pt-4 dark:border-zinc-700">
            <a
              href={`/league/${slug}/draft`}
              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Go to Draft Board
            </a>
            {phase !== 'complete' && (
              <>
                <button
                  type="button"
                  onClick={() => void handleResetDraft()}
                  disabled={settingsLoading}
                  className={`rounded border px-3 py-1.5 text-sm disabled:opacity-50 ${
                    resetConfirm
                      ? 'border-red-600 bg-red-600 font-medium text-white hover:bg-red-700'
                      : 'border-red-300 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/30'
                  }`}
                >
                  {resetConfirm ? 'Confirm reset — all picks will be lost' : 'Reset Draft'}
                </button>
                {resetConfirm && (
                  <button
                    type="button"
                    onClick={() => setResetConfirm(false)}
                    className="text-xs text-gray-400 hover:text-gray-600 dark:text-zinc-500"
                  >
                    Cancel
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Show loading state while auto-advancing from setup → settings
  if (autoAdvancing || (!autoAdvancedRef.current && phase === 'setup' && priorOwners.length >= 2)) {
    return (
      <div className="rounded-2xl border border-gray-300 bg-white p-6 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
        <p className="text-sm text-gray-500 dark:text-zinc-400">Loading draft settings…</p>
      </div>
    );
  }

  if (phase === 'setup' || phase === 'settings' || draftState === null) {
    // Build a synthetic draft state for the settings panel when we have no draft yet
    // or when the draft is still in 'setup' phase (no preseason owners available)
    const effectiveDraftState: DraftState = draftState ?? {
      leagueSlug: slug,
      year,
      phase: 'settings',
      owners: priorOwners.length >= 2 ? priorOwners : [],
      settings: {
        style: 'snake',
        draftOrder: priorOwners.length >= 2 ? priorOwners : [],
        pickTimerSeconds: 60,
        timerExpiryBehavior: 'pause-and-prompt',
        autoPickMetric: null,
        totalRounds: 1,
        scheduledAt: null,
      },
      picks: [],
      currentPickIndex: 0,
      timerState: 'off',
      timerExpiresAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    return (
      <DraftSettingsPanel
        slug={slug}
        year={year}
        draftState={effectiveDraftState}
        priorOwners={priorOwners}
        priorChampOrder={priorChampOrder}
        fbsTeamCount={fbsTeamCount}
        onAdvance={(updated) => setDraftState(updated)}
      />
    );
  }

  if (phase === 'preview') {
    const scheduledAt = draftState.settings.scheduledAt;
    return (
      <div className="space-y-6">
        <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-6 dark:border-amber-700/40 dark:bg-amber-950/20">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700 dark:text-amber-400">
            Draft Scheduled
          </p>
          {scheduledAt ? (
            <p className="mt-1 text-lg font-semibold text-gray-900 dark:text-zinc-50">
              {new Date(scheduledAt).toLocaleString()}
            </p>
          ) : (
            <p className="mt-1 text-lg font-semibold text-gray-900 dark:text-zinc-50">
              Ready to start
            </p>
          )}
          <p className="mt-2 text-sm text-gray-600 dark:text-zinc-400">
            {draftState.owners.length} owners · {draftState.settings.totalRounds} round
            {draftState.settings.totalRounds !== 1 ? 's' : ''} ·{' '}
            {draftState.settings.pickTimerSeconds
              ? `${draftState.settings.pickTimerSeconds}s timer`
              : 'No timer'}
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              className="rounded border border-blue-600 bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              onClick={() => {
                window.location.href = `/league/${slug}/draft`;
              }}
            >
              Start Draft
            </button>
            <button
              type="button"
              className="rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 hover:bg-gray-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
              onClick={() => void handleBackToSettings()}
              disabled={backLoading}
            >
              {backLoading ? 'Going back…' : 'Back to Settings'}
            </button>
          </div>
          {backError && (
            <p className="mt-2 text-sm text-red-700 dark:text-red-400">{backError}</p>
          )}
        </div>

        <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-4 dark:border-zinc-700 dark:bg-zinc-800/40">
          <p className="mb-2 text-xs font-semibold text-gray-500 dark:text-zinc-400">Draft Order</p>
          <ol className="space-y-1">
            {draftState.settings.draftOrder.map((owner, i) => (
              <li key={owner} className="text-sm text-gray-900 dark:text-zinc-100">
                <span className="mr-2 text-gray-400 dark:text-zinc-500">{i + 1}.</span>
                {owner}
              </li>
            ))}
          </ol>
        </div>
      </div>
    );
  }

  return <></>;
}

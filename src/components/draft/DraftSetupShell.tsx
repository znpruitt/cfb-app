'use client';

import React, { useState } from 'react';
import { requireAdminAuthHeaders } from '@/lib/adminAuth';
import type { DraftState } from '@/lib/draft';
import RosterSetupPanel from './RosterSetupPanel';
import DraftSettingsPanel from './DraftSettingsPanel';

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

  const phase = draftState?.phase ?? 'setup';

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

  if (phase === 'live' || phase === 'paused' || phase === 'complete') {
    return (
      <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-6 dark:border-blue-800/40 dark:bg-blue-950/20">
        <p className="font-semibold text-blue-900 dark:text-blue-100">
          Draft is {phase === 'live' ? 'in progress' : phase}.
        </p>
        <a
          href={`/league/${slug}/draft`}
          className="mt-3 inline-block rounded border border-blue-600 bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Go to Draft Board
        </a>
      </div>
    );
  }

  if (phase === 'setup' || draftState === null) {
    return (
      <RosterSetupPanel
        slug={slug}
        year={year}
        draftState={draftState}
        priorOwners={priorOwners}
        onAdvance={(updated) => setDraftState(updated)}
      />
    );
  }

  if (phase === 'settings') {
    return (
      <DraftSettingsPanel
        slug={slug}
        year={year}
        draftState={draftState}
        priorChampOrder={priorChampOrder}
        fbsTeamCount={fbsTeamCount}
        onBack={(updated) => setDraftState(updated)}
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

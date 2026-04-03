'use client';

import React, { useEffect, useState } from 'react';
import { hasStoredAdminToken, requireAdminAuthHeaders } from '@/lib/adminAuth';
import type { DraftState, DraftPick } from '@/lib/draft';
import InterestingFactsPanel from './InterestingFactsPanel';

type DraftSummaryClientProps = {
  slug: string;
  year: number;
  initialDraft: DraftState;
  /** All FBS canonical team names (NoClaim excluded) for the inline team picker. */
  allTeamNames: string[];
  /** Pre-derived interesting fact strings from the server page. */
  facts: string[];
};

export default function DraftSummaryClient({
  slug,
  year,
  initialDraft,
  allTeamNames,
  facts,
}: DraftSummaryClientProps): React.ReactElement {
  const [draft, setDraft] = useState(initialDraft);
  const [isAdmin] = useState(() => hasStoredAdminToken());

  // Edit state
  const [editingPickNumber, setEditingPickNumber] = useState<number | null>(null);
  const [editSearch, setEditSearch] = useState('');
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Confirm state
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  // Reopen state
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenLoading, setReopenLoading] = useState(false);
  const [reopenError, setReopenError] = useState<string | null>(null);

  // Redirect non-admins to draft board
  useEffect(() => {
    if (!isAdmin) {
      window.location.replace(`/league/${slug}/draft`);
    }
  }, [isAdmin, slug]);

  if (!isAdmin) return <></>;

  // -------------------------------------------------------------------------
  // Derived state
  // -------------------------------------------------------------------------

  // Group picks by owner preserving draftOrder
  const ownerOrder = draft.settings.draftOrder;
  const picksByOwner = new Map<string, DraftPick[]>();
  for (const owner of ownerOrder) {
    picksByOwner.set(owner, []);
  }
  for (const pick of draft.picks) {
    if (!picksByOwner.has(pick.owner)) picksByOwner.set(pick.owner, []);
    picksByOwner.get(pick.owner)!.push(pick);
  }
  for (const picks of picksByOwner.values()) {
    picks.sort((a, b) => a.pickNumber - b.pickNumber);
  }
  const owners = ownerOrder.filter((o) => (picksByOwner.get(o)?.length ?? 0) > 0);

  // The pick currently being edited (if any)
  const editingPick =
    editingPickNumber !== null
      ? (draft.picks.find((p) => p.pickNumber === editingPickNumber) ?? null)
      : null;

  // Teams already assigned to other picks (the replaced pick remains selectable)
  const pickedTeamsLower = new Set(
    draft.picks
      .filter((p) => p.pickNumber !== editingPickNumber)
      .map((p) => p.team.toLowerCase())
  );

  // Available teams for the inline picker: not drafted by another pick, optionally filtered by search
  const searchLower = editSearch.toLowerCase();
  const availableForPicker = allTeamNames.filter((name) => {
    if (pickedTeamsLower.has(name.toLowerCase())) return false;
    if (searchLower && !name.toLowerCase().includes(searchLower)) return false;
    return true;
  });

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  async function handleEdit(teamName: string) {
    if (editingPickNumber === null) return;
    setEditError(null);
    setEditLoading(true);
    try {
      const authHeaders = requireAdminAuthHeaders() as Record<string, string>;
      const res = await fetch(
        `/api/draft/${encodeURIComponent(slug)}/${year}/pick/${editingPickNumber}`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json', ...authHeaders },
          body: JSON.stringify({ team: teamName }),
        }
      );
      const data = (await res.json()) as { draft?: DraftState; error?: string };
      if (!res.ok || !data.draft) {
        setEditError(data.error ?? `Edit failed (${res.status})`);
        return;
      }
      setDraft(data.draft);
      setEditingPickNumber(null);
      setEditSearch('');
    } catch (err) {
      setEditError((err as Error).message);
    } finally {
      setEditLoading(false);
    }
  }

  async function handleConfirm() {
    setConfirmError(null);
    setConfirmLoading(true);
    try {
      const authHeaders = requireAdminAuthHeaders() as Record<string, string>;
      const res = await fetch(`/api/draft/${encodeURIComponent(slug)}/${year}/confirm`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeaders },
      });
      const data = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !data.success) {
        setConfirmError(data.error ?? `Confirmation failed (${res.status})`);
        setConfirmLoading(false);
        return;
      }
      window.location.href = `/league/${slug}/overview`;
    } catch (err) {
      setConfirmError((err as Error).message);
      setConfirmLoading(false);
    }
  }

  async function handleReopen() {
    setReopenError(null);
    setReopenLoading(true);
    try {
      const authHeaders = requireAdminAuthHeaders() as Record<string, string>;
      const res = await fetch(`/api/draft/${encodeURIComponent(slug)}/${year}/confirm`, {
        method: 'DELETE',
        headers: { ...authHeaders },
      });
      const data = (await res.json()) as { draft?: DraftState; error?: string };
      if (!res.ok || !data.draft) {
        setReopenError(data.error ?? `Reopen failed (${res.status})`);
        setReopenLoading(false);
        return;
      }
      setDraft(data.draft);
      setReopenOpen(false);
    } catch (err) {
      setReopenError((err as Error).message);
      setReopenLoading(false);
    }
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="space-y-10">
      {/* Owner Roster Cards */}
      <section>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.15em] text-gray-500 dark:text-zinc-400">
          Owner Rosters
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {owners.map((owner) => {
            const picks = picksByOwner.get(owner) ?? [];
            return (
              <div
                key={owner}
                className="rounded-lg border border-gray-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900"
              >
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="font-semibold text-gray-900 dark:text-zinc-100">{owner}</h3>
                  <span className="text-xs text-gray-500 dark:text-zinc-400">
                    {picks.length} pick{picks.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <ol className="space-y-1.5">
                  {picks.map((pick) => (
                    <li key={pick.pickNumber} className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <span className="text-xs text-gray-400 dark:text-zinc-500">
                          R{pick.round + 1}.{pick.roundPick + 1}{' '}
                        </span>
                        <span className="text-sm text-gray-800 dark:text-zinc-200">
                          {pick.team}
                        </span>
                        {pick.autoSelected && (
                          <span className="ml-1 text-xs text-amber-600 dark:text-amber-400">
                            (auto)
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingPickNumber(pick.pickNumber);
                          setEditSearch('');
                          setEditError(null);
                        }}
                        className="shrink-0 text-xs text-blue-600 hover:underline dark:text-blue-400"
                      >
                        Edit
                      </button>
                    </li>
                  ))}
                </ol>
              </div>
            );
          })}
        </div>
      </section>

      {/* Inline Team Picker */}
      {editingPickNumber !== null && (
        <section className="rounded-lg border border-blue-300 bg-blue-50 p-4 dark:border-blue-700 dark:bg-blue-950">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-medium text-blue-900 dark:text-blue-100">
              Editing pick #{editingPickNumber}
              {editingPick != null && ` — currently: ${editingPick.team}`}
            </p>
            <button
              type="button"
              onClick={() => {
                setEditingPickNumber(null);
                setEditSearch('');
                setEditError(null);
              }}
              className="text-xs text-blue-700 hover:underline dark:text-blue-300"
            >
              Cancel
            </button>
          </div>
          <input
            type="search"
            placeholder="Search teams…"
            value={editSearch}
            onChange={(e) => setEditSearch(e.target.value)}
            className="mb-3 w-full rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
          />
          {editError && (
            <p className="mb-2 text-sm text-red-700 dark:text-red-400">{editError}</p>
          )}
          <div className="max-h-52 overflow-y-auto rounded border border-gray-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
            {availableForPicker.length === 0 ? (
              <p className="px-3 py-2 text-sm text-gray-400 dark:text-zinc-500">
                {editSearch ? 'No teams match.' : 'No available teams.'}
              </p>
            ) : (
              availableForPicker.map((teamName) => (
                <button
                  key={teamName}
                  type="button"
                  disabled={editLoading}
                  onClick={() => void handleEdit(teamName)}
                  className="w-full px-3 py-1.5 text-left text-sm text-gray-800 hover:bg-blue-50 disabled:opacity-50 dark:text-zinc-200 dark:hover:bg-blue-900"
                >
                  {teamName}
                </button>
              ))
            )}
          </div>
        </section>
      )}

      {/* Interesting Facts */}
      <InterestingFactsPanel facts={facts} />

      {/* Confirm Draft — only shown when draft is not yet confirmed */}
      {draft.phase !== 'complete' && (
        <section className="border-t border-gray-200 pt-8 dark:border-zinc-700">
          {confirmError && (
            <p className="mb-3 text-sm text-red-700 dark:text-red-400">{confirmError}</p>
          )}
          {confirmOpen ? (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950">
              <p className="mb-3 text-sm text-amber-900 dark:text-amber-100">
                This will write all owner rosters to the league for the {year} season. This cannot
                be undone without starting a new draft or uploading a CSV override.
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  disabled={confirmLoading}
                  onClick={() => void handleConfirm()}
                  className="rounded bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-60"
                >
                  {confirmLoading ? 'Confirming…' : 'Confirm'}
                </button>
                <button
                  type="button"
                  disabled={confirmLoading}
                  onClick={() => setConfirmOpen(false)}
                  className="rounded border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              className="rounded bg-green-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-green-700"
            >
              Confirm Draft — Write Rosters to League
            </button>
          )}
        </section>
      )}

      {/* Reopen Draft — only shown when draft is confirmed (phase === 'complete') */}
      {draft.phase === 'complete' && (
        <section className="border-t border-gray-200 pt-8 dark:border-zinc-700">
          {reopenError && (
            <p className="mb-3 text-sm text-red-700 dark:text-red-400">{reopenError}</p>
          )}
          {reopenOpen ? (
            <div className="rounded-lg border border-gray-300 bg-gray-50 p-4 dark:border-zinc-600 dark:bg-zinc-800">
              <p className="mb-3 text-sm text-gray-700 dark:text-zinc-300">
                Reopen this draft for editing? The previously confirmed rosters will remain in
                effect until you confirm again.
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  disabled={reopenLoading}
                  onClick={() => void handleReopen()}
                  className="rounded border border-gray-400 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-100 disabled:opacity-60 dark:border-zinc-500 dark:bg-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-600"
                >
                  {reopenLoading ? 'Reopening…' : 'Reopen Draft'}
                </button>
                <button
                  type="button"
                  disabled={reopenLoading}
                  onClick={() => setReopenOpen(false)}
                  className="rounded border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setReopenOpen(true)}
              className="rounded border border-gray-300 bg-white px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
            >
              Reopen Draft
            </button>
          )}
        </section>
      )}
    </div>
  );
}

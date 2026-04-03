'use client';

import React, { useEffect, useState } from 'react';
import { requireAdminAuthHeaders } from '@/lib/adminAuth';
import type { DraftState } from '@/lib/draft';

type RosterSetupPanelProps = {
  slug: string;
  year: number;
  draftState: DraftState | null;
  priorOwners: string[];
  onAdvance: (draft: DraftState) => void;
};

export default function RosterSetupPanel({
  slug,
  year,
  draftState,
  priorOwners,
  onAdvance,
}: RosterSetupPanelProps): React.ReactElement {
  const [owners, setOwners] = useState<string[]>(() => {
    if (draftState?.owners && draftState.owners.length > 0) return draftState.owners;
    return priorOwners.length > 0 ? priorOwners : [''];
  });
  const [newOwner, setNewOwner] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!draftState && priorOwners.length > 0) {
      setOwners(priorOwners);
    }
  }, [draftState, priorOwners]);

  function handleRemove(idx: number) {
    setOwners((prev) => prev.filter((_, i) => i !== idx));
  }

  function handleMoveUp(idx: number) {
    if (idx === 0) return;
    setOwners((prev) => {
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx]!, next[idx - 1]!];
      return next;
    });
  }

  function handleMoveDown(idx: number) {
    setOwners((prev) => {
      if (idx >= prev.length - 1) return prev;
      const next = [...prev];
      [next[idx], next[idx + 1]] = [next[idx + 1]!, next[idx]!];
      return next;
    });
  }

  function handleAddOwner() {
    const trimmed = newOwner.trim();
    if (!trimmed || owners.includes(trimmed)) return;
    setOwners((prev) => [...prev, trimmed]);
    setNewOwner('');
  }

  function handleEditOwner(idx: number, value: string) {
    setOwners((prev) => prev.map((o, i) => (i === idx ? value : o)));
  }

  async function handleContinue() {
    setError(null);
    const trimmedOwners = owners.map((o) => o.trim()).filter(Boolean);
    if (trimmedOwners.length < 2) {
      setError('At least 2 owners are required.');
      return;
    }

    setLoading(true);
    try {
      const authHeaders = requireAdminAuthHeaders() as Record<string, string>;

      let draft: DraftState;

      if (!draftState) {
        // Create the draft
        const createRes = await fetch(`/api/draft/${encodeURIComponent(slug)}/${year}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...authHeaders },
          body: JSON.stringify({ owners: trimmedOwners }),
        });

        if (createRes.status === 409) {
          // Draft already exists — fetch it and continue
          const getRes = await fetch(`/api/draft/${encodeURIComponent(slug)}/${year}`, {
            cache: 'no-store',
          });
          if (!getRes.ok) {
            setError('Draft conflict — failed to load existing draft.');
            return;
          }
          const data = (await getRes.json()) as { draft: DraftState };
          draft = data.draft;
        } else if (!createRes.ok) {
          const data = (await createRes.json()) as { error?: string };
          setError(data.error ?? `Failed to create draft (${createRes.status})`);
          return;
        } else {
          const data = (await createRes.json()) as { draft: DraftState };
          draft = data.draft;
        }
      } else {
        draft = draftState;
      }

      // Update owners and advance to settings phase
      const putRes = await fetch(`/api/draft/${encodeURIComponent(slug)}/${year}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', ...authHeaders },
        body: JSON.stringify({ owners: trimmedOwners, phase: 'settings' }),
      });

      if (!putRes.ok) {
        const data = (await putRes.json()) as { error?: string };
        setError(data.error ?? `Failed to advance draft (${putRes.status})`);
        return;
      }

      const data = (await putRes.json()) as { draft: DraftState };
      void draft; // used above; now replaced by latest
      onAdvance(data.draft);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const trimmedOwners = owners.map((o) => o.trim()).filter(Boolean);
  const canContinue = trimmedOwners.length >= 2 && !loading;

  return (
    <div className="rounded-2xl border border-gray-300 bg-white p-6 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
      <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-zinc-400">
        Step 1 of 2
      </p>
      <h2 className="mb-1 text-lg font-semibold text-gray-950 dark:text-zinc-50">
        League Roster
      </h2>
      {priorOwners.length > 0 && !draftState && (
        <p className="mb-4 text-sm text-gray-500 dark:text-zinc-400">
          Auto-populated from last season. Remove or add owners as needed.
        </p>
      )}
      {(!priorOwners.length || draftState) && (
        <p className="mb-4 text-sm text-gray-500 dark:text-zinc-400">
          Add all owners participating in the {year} draft. Minimum 2.
        </p>
      )}

      {/* Owner list */}
      <ul className="mb-4 space-y-2">
        {owners.map((owner, idx) => (
          <li key={idx} className="flex items-center gap-2">
            <span className="w-5 shrink-0 text-right text-xs text-gray-400 dark:text-zinc-500">
              {idx + 1}.
            </span>
            <input
              type="text"
              value={owner}
              onChange={(e) => handleEditOwner(idx, e.target.value)}
              className="min-w-0 flex-1 rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
              placeholder="Owner name"
            />
            <button
              type="button"
              onClick={() => handleMoveUp(idx)}
              disabled={idx === 0}
              className="rounded px-1.5 py-0.5 text-xs text-gray-500 hover:bg-gray-100 disabled:opacity-30 dark:text-zinc-400 dark:hover:bg-zinc-700"
              title="Move up"
            >
              ↑
            </button>
            <button
              type="button"
              onClick={() => handleMoveDown(idx)}
              disabled={idx === owners.length - 1}
              className="rounded px-1.5 py-0.5 text-xs text-gray-500 hover:bg-gray-100 disabled:opacity-30 dark:text-zinc-400 dark:hover:bg-zinc-700"
              title="Move down"
            >
              ↓
            </button>
            <button
              type="button"
              onClick={() => handleRemove(idx)}
              disabled={owners.length <= 1}
              className="rounded px-1.5 py-0.5 text-xs text-red-600 hover:bg-red-50 disabled:opacity-30 dark:text-red-400 dark:hover:bg-red-950/30"
              title="Remove"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>

      {/* Add owner */}
      <div className="mb-6 flex gap-2">
        <input
          type="text"
          value={newOwner}
          onChange={(e) => setNewOwner(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleAddOwner();
          }}
          placeholder="Add owner…"
          className="min-w-0 flex-1 rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
        />
        <button
          type="button"
          onClick={handleAddOwner}
          disabled={!newOwner.trim()}
          className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 hover:bg-gray-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700/60"
        >
          Add
        </button>
      </div>

      {error && (
        <p className="mb-4 text-sm text-red-700 dark:text-red-400">{error}</p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void handleContinue()}
          disabled={!canContinue}
          className="rounded border border-blue-600 bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? 'Saving…' : 'Continue to Settings'}
        </button>
        {trimmedOwners.length < 2 && (
          <p className="text-xs text-gray-500 dark:text-zinc-400">At least 2 owners required.</p>
        )}
      </div>
    </div>
  );
}

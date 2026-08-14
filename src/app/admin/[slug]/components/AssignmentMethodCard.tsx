'use client';

import { useState, useTransition } from 'react';
import { setAssignmentMethod } from '../actions';

type Method = 'draft' | 'manual';

const OPTIONS: { value: Method; label: string; desc: string }[] = [
  {
    value: 'draft',
    label: 'Run a Draft',
    desc: 'Owners pick teams in a live draft sequence',
  },
  {
    value: 'manual',
    label: 'Assign Manually',
    desc: 'Commissioner assigns teams directly',
  },
];

export default function AssignmentMethodCard({
  slug,
  currentMethod,
  draftHasPicks = false,
}: {
  slug: string;
  currentMethod: Method | null;
  /**
   * Whether a draft for this season has picks that switching away would throw
   * away. Server-supplied: the client cannot see the draft record.
   */
  draftHasPicks?: boolean;
}) {
  const [editing, setEditing] = useState(currentMethod === null);
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState<Method | null>(null);
  const [error, setError] = useState<string | null>(null);

  function commit(method: Method) {
    setError(null);
    startTransition(async () => {
      try {
        await setAssignmentMethod(slug, method);
        setConfirming(null);
        setEditing(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not change the assignment method.');
      }
    });
  }

  // PLATFORM-095 — switching away from a draft that has already made picks
  // discards them, so it asks first. Inline disclosure rather than a modal:
  // that is this codebase's established pattern for a destructive admin action
  // (`DraftControls` arms its Reset, `DraftSummaryClient` opens an amber box
  // before writing rosters), and there is no modal anywhere to be consistent
  // with.
  //
  // This is the courtesy, NOT the guard. `setAssignmentMethod` refuses a draft
  // whose picks are all in regardless of what the client sends.
  function select(method: Method) {
    // Only warn when moving AWAY from a draft that has picks. Returning TO
    // `draft` reactivates those same picks — warning "this discards the draft"
    // there said the opposite of what happens.
    if (method !== currentMethod && method !== 'draft' && draftHasPicks) {
      setConfirming(method);
      return;
    }
    commit(method);
  }

  // Confirmed state — show selection with edit link
  if (!editing && currentMethod) {
    const selected = OPTIONS.find((o) => o.value === currentMethod)!;
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-5 dark:border-zinc-700 dark:bg-zinc-900">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-500 dark:text-zinc-400">Assignment method</p>
            <p className="text-sm font-medium text-gray-900 dark:text-zinc-100">{selected.label}</p>
          </div>
          <button
            onClick={() => setEditing(true)}
            className="text-sm text-blue-600 hover:text-blue-500 transition-colors dark:text-blue-400 dark:hover:text-blue-300"
          >
            Change
          </button>
        </div>
      </div>
    );
  }

  // Selection state — show both options as radio-style cards
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-5 space-y-3 dark:border-zinc-700 dark:bg-zinc-900">
      <h3 className="text-base font-medium">How will teams be assigned this season?</h3>

      {error && <p className="text-sm text-red-700 dark:text-red-400">{error}</p>}

      {confirming && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950/40">
          <p className="mb-3 text-sm text-red-900 dark:text-red-100">
            This season&rsquo;s draft has already made picks. While teams are assigned manually that
            draft will not assign anyone — its picks are kept, and switching back to a draft
            restores them.
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              disabled={pending}
              onClick={() => commit(confirming)}
              className="rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
            >
              {pending ? 'Changing…' : 'Assign manually'}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setConfirming(null)}
              className="rounded border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        {OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => select(opt.value)}
            disabled={pending}
            className={[
              'rounded-lg border p-4 text-left transition-colors disabled:opacity-50',
              currentMethod === opt.value
                ? 'border-blue-600 bg-blue-50 dark:border-blue-400 dark:bg-blue-950/30'
                : 'border-gray-200 bg-white hover:border-gray-400 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-zinc-500',
            ].join(' ')}
          >
            <p className="text-sm font-medium text-gray-900 dark:text-zinc-100">{opt.label}</p>
            <p className="mt-1 text-xs text-gray-500 dark:text-zinc-400">{opt.desc}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

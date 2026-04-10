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
}: {
  slug: string;
  currentMethod: Method | null;
}) {
  const [editing, setEditing] = useState(currentMethod === null);
  const [pending, startTransition] = useTransition();

  function select(method: Method) {
    startTransition(async () => {
      await setAssignmentMethod(slug, method);
      setEditing(false);
    });
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

'use client';

import { useState, useTransition } from 'react';
import { confirmPreseasonOwners } from '../../actions';

const btnClass =
  'px-3 py-1.5 rounded border border-gray-300 bg-white text-sm text-gray-900 transition-colors hover:bg-gray-50 hover:border-gray-400 disabled:opacity-50 disabled:cursor-not-allowed dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700/60';

type Props = {
  slug: string;
  year: number;
  initialOwners: string[];
};

export default function OwnerConfirmationShell({ slug, year, initialOwners }: Props) {
  const [owners, setOwners] = useState<string[]>(initialOwners);
  const [addInput, setAddInput] = useState('');
  const [addError, setAddError] = useState('');
  const [pending, startTransition] = useTransition();

  function handleAdd() {
    const name = addInput.trim();
    if (!name) {
      setAddError('Name cannot be empty.');
      return;
    }
    if (owners.some((o) => o.toLowerCase() === name.toLowerCase())) {
      setAddError('That owner is already in the list.');
      return;
    }
    setOwners((prev) => [...prev, name]);
    setAddInput('');
    setAddError('');
  }

  function handleRemove(name: string) {
    setOwners((prev) => prev.filter((o) => o !== name));
  }

  function handleSave() {
    startTransition(async () => {
      await confirmPreseasonOwners(slug, year, owners);
    });
  }

  function handleCancel() {
    // Navigate back without saving — use window.location for simplicity since
    // this is a plain redirect, not a state mutation.
    window.location.href = `/admin/${slug}/preseason`;
  }

  const canSave = owners.length >= 2;

  return (
    <div className="space-y-6">
      {/* Owner list */}
      <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 dark:divide-zinc-800 dark:border-zinc-700">
        {owners.length === 0 && (
          <li className="px-4 py-3 text-sm text-gray-400 dark:text-zinc-500">
            No owners yet. Add at least 2.
          </li>
        )}
        {owners.map((owner) => (
          <li key={owner} className="flex items-center justify-between px-4 py-2.5 text-sm">
            <span className="text-gray-800 dark:text-zinc-200">{owner}</span>
            <button
              type="button"
              onClick={() => handleRemove(owner)}
              disabled={pending}
              className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50 dark:text-red-400 dark:hover:text-red-300"
            >
              Remove
            </button>
          </li>
        ))}
      </ul>

      {/* Add owner */}
      <div className="space-y-1">
        <div className="flex gap-2">
          <input
            type="text"
            value={addInput}
            onChange={(e) => {
              setAddInput(e.target.value);
              setAddError('');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleAdd();
              }
            }}
            placeholder="Owner name"
            disabled={pending}
            className="flex-1 rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-gray-400 focus:outline-none disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500 dark:focus:border-zinc-500"
          />
          <button type="button" onClick={handleAdd} disabled={pending} className={btnClass}>
            Add
          </button>
        </div>
        {addError && <p className="text-xs text-red-500 dark:text-red-400">{addError}</p>}
      </div>

      {/* Save / Cancel */}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={!canSave || pending}
          className={
            canSave && !pending
              ? 'px-4 py-2 rounded border border-blue-600 bg-blue-600 text-sm font-medium text-white transition-colors hover:bg-blue-700 hover:border-blue-700 disabled:opacity-50 dark:border-blue-500 dark:bg-blue-600 dark:hover:bg-blue-700'
              : 'px-4 py-2 rounded border border-gray-200 bg-gray-100 text-sm text-gray-400 cursor-not-allowed dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-500'
          }
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={handleCancel} disabled={pending} className={btnClass}>
          Cancel
        </button>
      </div>

      {!canSave && (
        <p className="text-xs text-gray-400 dark:text-zinc-500">
          Add at least 2 owners before saving.
        </p>
      )}
    </div>
  );
}

import React from 'react';

type DraftRow = { key: string; value: string };

type AliasEditorPanelProps = {
  open: boolean;
  season: number;
  draft: DraftRow[];
  onClose: () => void;
  onAddRow: () => void;
  onSave: () => void;
  onUpdateKey: (idx: number, value: string) => void;
  onUpdateValue: (idx: number, value: string) => void;
  onRemoveRow: (idx: number) => void;
};

export default function AliasEditorPanel({
  open,
  season,
  draft,
  onClose,
  onAddRow,
  onSave,
  onUpdateKey,
  onUpdateValue,
  onRemoveRow,
}: AliasEditorPanelProps): React.ReactElement | null {
  if (!open) return null;

  return (
    <section className="rounded border border-gray-300 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{season > 0 ? `Team Alias Editor (Season ${season})` : 'Team Alias Editor'}</h2>
        <div className="flex gap-2">
          <button
            className="px-3 py-1 rounded border border-gray-300 bg-white text-gray-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            onClick={onClose}
          >
            Close
          </button>
          <button
            className="px-3 py-1 rounded border border-gray-300 bg-white text-gray-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            onClick={onAddRow}
          >
            Add Row
          </button>
          <button
            className="px-3 py-1 rounded border border-gray-300 bg-white text-gray-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            onClick={onSave}
          >
            Save
          </button>
        </div>
      </div>

      <div className="text-xs text-gray-600 dark:text-zinc-400">
        Left column is the <em>input form</em> (lowercased, accents removed). Right column is the{' '}
        <em>canonical team name</em> to use for data.
      </div>

      <div className="max-h-[360px] overflow-auto border border-gray-200 dark:border-zinc-700 rounded">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 dark:bg-zinc-800">
            <tr>
              <th className="text-left p-2 border-b dark:border-zinc-700">Input (alias)</th>
              <th className="text-left p-2 border-b dark:border-zinc-700">Canonical (school)</th>
              <th className="text-left p-2 border-b dark:border-zinc-700 w-10"> </th>
            </tr>
          </thead>
          <tbody>
            {draft.map((row, i) => (
              <tr key={`${i}-${row.key}`}>
                <td className="p-2 border-b dark:border-zinc-700">
                  <input
                    className="w-full border border-gray-300 rounded px-2 py-1 bg-white text-gray-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                    value={row.key}
                    onChange={(e) => onUpdateKey(i, e.target.value)}
                    placeholder="e.g., app state"
                  />
                </td>
                <td className="p-2 border-b dark:border-zinc-700">
                  <input
                    className="w-full border border-gray-300 rounded px-2 py-1 bg-white text-gray-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                    value={row.value}
                    onChange={(e) => onUpdateValue(i, e.target.value)}
                    placeholder="e.g., Appalachian State"
                  />
                </td>
                <td className="p-2 border-b dark:border-zinc-700">
                  <button
                    className="px-2 py-1 rounded border border-gray-300 bg-white text-gray-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                    onClick={() => onRemoveRow(i)}
                    title="Remove"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
            {draft.length === 0 && (
              <tr>
                <td className="p-2 text-sm text-gray-600 dark:text-zinc-400" colSpan={3}>
                  No aliases yet. Click “Add Row” to create one.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

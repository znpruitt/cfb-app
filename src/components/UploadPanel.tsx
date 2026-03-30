import React from 'react';

type UploadPanelProps = {
  gamesCount: number;
  weeksCount: number;
  conferencesCount: number;
  ownersCount: number;
  ownersLoadedFromCache: boolean;
  hasCachedOwners: boolean;
  scheduleLoaded: boolean;
  onOwnersFile: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onClearCachedOwners: () => void;
};

export default function UploadPanel({
  gamesCount,
  weeksCount,
  conferencesCount,
  ownersCount,
  ownersLoadedFromCache,
  hasCachedOwners,
  scheduleLoaded,
  onOwnersFile,
  onClearCachedOwners,
}: UploadPanelProps): React.ReactElement {
  return (
    <section className="rounded border border-gray-300 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900 space-y-3">
      <div className="text-xs text-gray-600 dark:text-zinc-400">
        Schedule source:{' '}
        <strong className="text-gray-900 dark:text-zinc-100">
          {scheduleLoaded ? 'api' : 'unavailable'}
        </strong>
      </div>

      <div className="grid md:grid-cols-1 gap-4">
        <div>
          <div className="text-sm font-medium mb-1">Owners CSV</div>
          <div className="mb-2 flex items-center gap-2 text-xs text-gray-600 dark:text-zinc-400">
            <span>Loaded from cache: {ownersLoadedFromCache ? 'Yes' : 'No'}</span>
            <button
              className="px-3 py-1.5 rounded border border-gray-300 bg-white text-gray-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 disabled:opacity-50"
              onClick={onClearCachedOwners}
              disabled={!hasCachedOwners}
              title="Clear cached owners CSV from localStorage"
            >
              Clear cached owners CSV
            </button>
          </div>
          <input
            type="file"
            accept=".csv"
            onChange={onOwnersFile}
            className="text-sm file:mr-2 file:rounded file:border file:px-2 file:py-1 file:bg-white file:border-gray-300 dark:file:bg-zinc-800 dark:file:border-zinc-700"
          />
          <div className="text-xs text-gray-600 dark:text-zinc-400 mt-1">
            Columns: <code>Team, Owner</code>. Use a unique owner identifier even if two
            participants share a surname.
          </div>
        </div>
      </div>
      <div className="text-xs text-gray-600 dark:text-zinc-400">
        Loaded — Games: <strong className="text-gray-900 dark:text-zinc-100">{gamesCount}</strong> |
        Weeks: <strong className="text-gray-900 dark:text-zinc-100">{weeksCount}</strong> |
        Conferences:{' '}
        <strong className="text-gray-900 dark:text-zinc-100">{conferencesCount}</strong> | Owners:{' '}
        <strong className="text-gray-900 dark:text-zinc-100">{ownersCount}</strong>
      </div>
    </section>
  );
}

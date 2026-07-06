import React from 'react';
import Link from 'next/link';

import AdminAuthPanel from './AdminAuthPanel';
import FeedbackPanel from './FeedbackPanel';
import AdminStorageStatusPanel from './AdminStorageStatusPanel';
import AdminUsagePanel from './AdminUsagePanel';
import AdminTeamDatabasePanel from './AdminTeamDatabasePanel';
import ScoreAttachmentDebugPanel from './ScoreAttachmentDebugPanel';
import IssuesPanel from './IssuesPanel';
import UploadPanel from './UploadPanel';
import type { DiagEntry } from '../lib/diagnostics';
import type { AppGame, ScheduleFetchMeta } from '../lib/schedule';
import type { OwnerRow } from '../lib/parseOwnersCsv';
import { pillClass } from '../lib/gameUi';

const controlButtonClass =
  'px-3 py-2 rounded border border-gray-300 bg-white text-gray-900 transition-colors hover:bg-gray-50 hover:border-gray-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700/60';
const secondaryButtonClass =
  'px-3 py-2 rounded border border-gray-200 bg-gray-50 text-gray-700 transition-colors hover:bg-gray-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800';

type AdminDebugSurfaceProps = {
  conferences: string[];
  diag: DiagEntry[];
  games: AppGame[];
  hasCachedOwners: boolean;
  issues: string[];
  lastOddsRefreshAt: string;
  lastScheduleRefreshAt: string;
  lastScoresRefreshAt: string;
  loadingLive: boolean;
  loadingSchedule: boolean;
  oddsCacheState: 'hit' | 'miss' | 'unknown';
  ownersLoadedFromCache: boolean;
  roster: OwnerRow[];
  scheduleLoaded: boolean;
  scheduleMeta: ScheduleFetchMeta;
  season: number;
  weeks: number[];
  onClearCachedOwners: () => void;
  onOwnersFile: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onRefreshData: () => void;
  onRebuildSchedule: () => void;
};

export default function AdminDebugSurface({
  conferences,
  diag,
  games,
  hasCachedOwners,
  issues,
  lastOddsRefreshAt,
  lastScheduleRefreshAt,
  lastScoresRefreshAt,
  loadingLive,
  loadingSchedule,
  oddsCacheState,
  ownersLoadedFromCache,
  roster,
  scheduleLoaded,
  scheduleMeta,
  season,
  weeks,
  onClearCachedOwners,
  onOwnersFile,
  onRefreshData,
  onRebuildSchedule,
}: AdminDebugSurfaceProps): React.ReactElement {
  return (
    <section className="space-y-6 rounded-2xl border border-gray-300 bg-gray-50/80 p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-900/60">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-zinc-400">
            Admin / Debug
          </p>
          <h2 className="text-xl font-semibold text-gray-950 dark:text-zinc-50">
            Commissioner tools and diagnostics
          </h2>
          <p className="max-w-3xl text-sm text-gray-600 dark:text-zinc-300">
            Refresh provider data, repair aliases, manage owner CSV uploads, and inspect API or
            score-attachment diagnostics away from the league-facing landing experience.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            className={`${controlButtonClass} ${loadingLive ? 'opacity-60' : ''}`}
            onClick={onRefreshData}
            disabled={loadingLive || games.length === 0}
            title={
              games.length === 0
                ? 'Schedule load failed'
                : 'Refresh scores and context-relevant odds'
            }
          >
            {loadingLive ? 'Refreshing…' : 'Refresh data'}
          </button>
          <button
            className={secondaryButtonClass}
            onClick={onRebuildSchedule}
            disabled={loadingSchedule}
            title="Force a schedule rebuild from CFBD"
          >
            {loadingSchedule ? 'Rebuilding…' : 'Rebuild schedule'}
          </button>
          <Link
            href="/admin/leagues"
            className={secondaryButtonClass}
            title="Manage leagues and season configuration"
          >
            League Management
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 text-xs text-gray-600 dark:text-zinc-400">
        <span>
          Schedule: {lastScheduleRefreshAt || 'not loaded'} ({scheduleMeta.cache ?? 'unknown'}{' '}
          cache)
        </span>
        <span>Scores: {lastScoresRefreshAt || 'not refreshed'}</span>
        <span>
          Odds: {lastOddsRefreshAt || 'manual / policy-gated'} ({oddsCacheState} cache)
        </span>
      </div>

      <p className="text-xs text-gray-600 dark:text-zinc-400">
        Conservative refresh policy: schedule rebuilds are manual, scores may auto-refresh on focus
        for active views, and odds remain policy-gated to protect monthly API quotas.
      </p>

      <FeedbackPanel className="mb-2" />
      <AdminAuthPanel />
      <AdminStorageStatusPanel />
      <AdminUsagePanel />
      <AdminTeamDatabasePanel />
      <ScoreAttachmentDebugPanel
        season={season}
        onStageAlias={() => {
          // Alias staging requires the full alias editor on the Aliases page.
          alert('To stage alias repairs, use the Aliases page (/admin/aliases).');
        }}
      />

      <IssuesPanel issues={issues} diag={diag} pillClass={pillClass} />

      <UploadPanel
        gamesCount={games.length}
        weeksCount={weeks.length}
        conferencesCount={conferences.length > 0 ? conferences.length - 1 : 0}
        ownersCount={roster.length}
        ownersLoadedFromCache={ownersLoadedFromCache}
        hasCachedOwners={hasCachedOwners}
        scheduleLoaded={scheduleLoaded}
        onOwnersFile={onOwnersFile}
        onClearCachedOwners={onClearCachedOwners}
      />
    </section>
  );
}

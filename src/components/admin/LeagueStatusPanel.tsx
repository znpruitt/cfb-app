import React from 'react';

import { draftScope, type DraftPhase } from '@/lib/draft';
import { getAppState } from '@/lib/server/appStateStore';

function formatAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-block h-2 w-2 flex-shrink-0 rounded-full ${ok ? 'bg-green-500' : 'bg-amber-400'}`}
    />
  );
}

const PHASE_COLOR: Record<DraftPhase, string> = {
  setup: 'text-gray-500 dark:text-zinc-400',
  settings: 'text-gray-500 dark:text-zinc-400',
  preview: 'text-blue-600 dark:text-blue-400',
  live: 'text-green-600 dark:text-green-400',
  paused: 'text-amber-600 dark:text-amber-400',
  complete: 'text-gray-600 dark:text-zinc-300',
};

export default async function LeagueStatusPanel({
  slug,
  year,
}: {
  slug: string;
  year: number;
}): Promise<React.ReactElement | null> {
  let rosterRecord: Awaited<ReturnType<typeof getAppState<string>>> = null;
  let scheduleRecord: Awaited<ReturnType<typeof getAppState<unknown>>> = null;
  let scoresRecord: Awaited<ReturnType<typeof getAppState<unknown>>> = null;
  let draftRecord: Awaited<ReturnType<typeof getAppState<{ phase: DraftPhase }>>> = null;

  try {
    [rosterRecord, scheduleRecord, scoresRecord, draftRecord] = await Promise.all([
      getAppState<string>(`owners:${slug}:${year}`, 'csv'),
      // Check combined key first (default seasonType=all), fall back to regular-only key
      getAppState<unknown>('schedule', `${year}-all-all`).then(
        (r) => r ?? getAppState<unknown>('schedule', `${year}-all-regular`)
      ),
      getAppState<unknown>('scores', `${year}-all-regular`),
      getAppState<{ phase: DraftPhase }>(draftScope(slug), String(year)),
    ]);
  } catch {
    // Storage not available (e.g. production-misconfigured); skip panel
    return null;
  }

  const csvText = typeof rosterRecord?.value === 'string' ? rosterRecord.value : '';
  const hasRoster = csvText.trim().length > 0;

  const hasSchedule = Boolean(scheduleRecord);
  const hasScores = Boolean(scoresRecord);
  const draftPhase = draftRecord?.value?.phase ?? null;

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5 space-y-3 dark:border-zinc-700 dark:bg-zinc-900">
      <h2 className="text-base font-medium text-gray-900 dark:text-zinc-100">Status</h2>
      <div className="space-y-2 text-sm">
        {/* Roster */}
        <div className="flex items-center gap-2">
          <StatusDot ok={hasRoster} />
          <span className="w-20 text-gray-600 dark:text-zinc-300">Roster</span>
          {hasRoster ? (
            <span className="text-gray-500 dark:text-zinc-400">Roster set</span>
          ) : (
            <span className="text-amber-600 dark:text-amber-400">Not configured</span>
          )}
        </div>

        {/* Schedule */}
        <div className="flex items-center gap-2">
          <StatusDot ok={hasSchedule} />
          <span className="w-20 text-gray-600 dark:text-zinc-300">Schedule</span>
          {hasSchedule ? (
            <span className="text-gray-500 dark:text-zinc-400">{formatAge(scheduleRecord!.updatedAt)}</span>
          ) : (
            <span className="text-amber-600 dark:text-amber-400">not cached</span>
          )}
        </div>

        {/* Scores */}
        <div className="flex items-center gap-2">
          <StatusDot ok={hasScores} />
          <span className="w-20 text-gray-600 dark:text-zinc-300">Scores</span>
          {hasScores ? (
            <span className="text-gray-500 dark:text-zinc-400">{formatAge(scoresRecord!.updatedAt)}</span>
          ) : (
            <span className="text-amber-600 dark:text-amber-400">not cached</span>
          )}
        </div>

        {/* Draft */}
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 flex-shrink-0 rounded-full bg-gray-200 dark:bg-zinc-600" />
          <span className="w-20 text-gray-600 dark:text-zinc-300">Draft</span>
          {draftPhase ? (
            <span className={`font-mono text-xs ${PHASE_COLOR[draftPhase]}`}>{draftPhase}</span>
          ) : (
            <span className="text-gray-400 dark:text-zinc-500">not started</span>
          )}
        </div>
      </div>
    </section>
  );
}

import React from 'react';

import type { OwnerViewSnapshot } from '../lib/ownerView';
import { getPresentationTimeZone } from '../lib/weekPresentation';

function formatWinPct(value: number): string {
  return value.toFixed(3);
}

function formatDiff(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function formatKickoff(date: string | null, timeZone: string): string {
  if (!date) return 'TBD';
  const kickoff = new Date(date);
  if (Number.isNaN(kickoff.getTime())) return 'TBD';

  return kickoff.toLocaleString(undefined, {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function toneClasses(status: 'final' | 'inprogress' | 'scheduled' | 'unknown'): string {
  if (status === 'inprogress') {
    return 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300';
  }
  if (status === 'final') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300';
  }
  return 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300';
}

function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="rounded border border-gray-300 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight text-gray-950 dark:text-zinc-50">
          {title}
        </h2>
        <p className="text-sm text-gray-600 dark:text-zinc-300">{description}</p>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function EmptyState({ message }: { message: string }): React.ReactElement {
  return (
    <div className="rounded border border-dashed border-gray-300 bg-gray-50/80 px-4 py-4 text-sm text-gray-600 dark:border-zinc-700 dark:bg-zinc-950/70 dark:text-zinc-300">
      {message}
    </div>
  );
}

function OwnerGamesTable({
  rows,
  emptyMessage,
  timeZone,
}: {
  rows: OwnerViewSnapshot['rosterRows'];
  emptyMessage: string;
  timeZone: string;
}): React.ReactElement {
  if (rows.length === 0) {
    return <EmptyState message={emptyMessage} />;
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-[56rem] border-separate border-spacing-0 text-sm sm:min-w-full">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-[0.16em] text-gray-500 dark:text-zinc-500">
            {['Team', 'Opponent', 'Owner matchup', 'Status', 'Score', 'Kickoff'].map((label) => (
              <th
                key={label}
                className="whitespace-nowrap border-b border-gray-200 px-2 py-2 font-semibold sm:px-3 dark:border-zinc-700"
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={`${row.gameKey}-${row.ownerTeamSide}`}
              className="odd:bg-gray-50/70 even:bg-white dark:odd:bg-zinc-950/70 dark:even:bg-zinc-900"
            >
              <td className="border-b border-gray-100 px-2 py-2 font-semibold text-gray-950 sm:px-3 dark:border-zinc-800 dark:text-zinc-50">
                <div>{row.teamName}</div>
                <div className="text-xs font-normal text-gray-500 dark:text-zinc-400">
                  {row.matchupLabel}
                </div>
              </td>
              <td className="border-b border-gray-100 px-2 py-2 text-gray-700 sm:px-3 dark:border-zinc-800 dark:text-zinc-300">
                {row.opponentTeamName}
              </td>
              <td className="whitespace-nowrap border-b border-gray-100 px-2 py-2 text-gray-700 sm:px-3 dark:border-zinc-800 dark:text-zinc-300">
                {row.opponentOwner ? `vs ${row.opponentOwner}` : 'Unowned / non-league'}
              </td>
              <td className="whitespace-nowrap border-b border-gray-100 px-2 py-2 sm:px-3 dark:border-zinc-800">
                <span
                  className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${toneClasses(row.status)}`}
                >
                  {row.statusLabel}
                </span>
              </td>
              <td className="whitespace-nowrap border-b border-gray-100 px-2 py-2 text-gray-700 sm:px-3 dark:border-zinc-800 dark:text-zinc-300">
                {row.scoreLine}
              </td>
              <td className="whitespace-nowrap border-b border-gray-100 px-2 py-2 text-gray-500 sm:px-3 dark:border-zinc-800 dark:text-zinc-400">
                {formatKickoff(row.kickoff, timeZone)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type OwnerPanelProps = {
  snapshot: OwnerViewSnapshot;
  selectedWeekLabel: string;
  displayTimeZone?: string;
  onOwnerChange: (owner: string) => void;
};

export default function OwnerPanel({
  snapshot,
  selectedWeekLabel,
  displayTimeZone,
  onOwnerChange,
}: OwnerPanelProps): React.ReactElement {
  const timeZone = displayTimeZone ?? getPresentationTimeZone();

  return (
    <div className="space-y-4">
      <section className="rounded border border-gray-300 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-zinc-400">
              Owner view
            </div>
            {snapshot.header ? (
              <div className="space-y-2">
                <h2 className="text-2xl font-semibold tracking-tight text-gray-950 dark:text-zinc-50 sm:text-3xl">
                  {snapshot.header.owner}
                </h2>
                <div className="grid gap-2 text-sm text-gray-600 sm:grid-cols-2 xl:flex xl:flex-wrap xl:gap-x-4 xl:gap-y-1 dark:text-zinc-300">
                  <span>Rank #{snapshot.header.rank}</span>
                  <span>Record {snapshot.header.record}</span>
                  <span>Win % {formatWinPct(snapshot.header.winPct)}</span>
                  <span>Diff {formatDiff(snapshot.header.pointDifferential)}</span>
                </div>
              </div>
            ) : (
              <div className="space-y-1">
                <h2 className="text-2xl font-semibold tracking-tight text-gray-950 dark:text-zinc-50">
                  Owner dashboard
                </h2>
                <p className="text-sm text-gray-600 dark:text-zinc-300">
                  Upload owners to populate owner-specific league context.
                </p>
              </div>
            )}
          </div>

          <label className="flex w-full flex-col gap-1 text-sm font-medium text-gray-700 dark:text-zinc-200 lg:max-w-xs">
            <span>Select owner</span>
            <select
              className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              value={snapshot.selectedOwner ?? ''}
              onChange={(event) => onOwnerChange(event.target.value)}
            >
              {snapshot.ownerOptions.length === 0 ? (
                <option value="">No owners loaded</option>
              ) : null}
              {snapshot.ownerOptions.map((owner) => (
                <option key={owner} value={owner}>
                  {owner}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <SectionCard
        title="Roster"
        description="Every team on this owner's roster with opponent, game state, and score context."
      >
        <OwnerGamesTable
          rows={snapshot.rosterRows}
          emptyMessage="This owner does not have any scheduled league-relevant games yet."
          timeZone={timeZone}
        />
      </SectionCard>

      <SectionCard
        title="Live games"
        description="Teams currently in progress for the selected owner."
      >
        <OwnerGamesTable
          rows={snapshot.liveRows}
          emptyMessage="No live games for this owner right now."
          timeZone={timeZone}
        />
      </SectionCard>

      <SectionCard
        title={`${selectedWeekLabel} slate`}
        description="Active-week status for the selected owner, including remaining games and owner-vs-owner context."
      >
        {snapshot.weekSummary ? (
          <div className="mb-4 grid gap-2 rounded border border-gray-200 bg-gray-50/80 px-3 py-3 text-sm text-gray-700 sm:grid-cols-2 xl:flex xl:flex-wrap xl:gap-x-4 xl:gap-y-2 dark:border-zinc-800 dark:bg-zinc-950/70 dark:text-zinc-300">
            <span>{snapshot.weekSummary.performanceSummary}</span>
            <span>{snapshot.weekSummary.performanceDetail}</span>
            <span>{snapshot.weekSummary.liveGames} live</span>
            <span>{snapshot.weekSummary.scheduledGames} scheduled</span>
            <span>{snapshot.weekSummary.finalGames} final</span>
            <span>
              Opponents:{' '}
              {snapshot.weekSummary.opponentOwners.length > 0
                ? snapshot.weekSummary.opponentOwners.join(', ')
                : 'Unowned / non-league only'}
            </span>
          </div>
        ) : null}
        <OwnerGamesTable
          rows={snapshot.weekRows}
          emptyMessage="No games for this owner are attached to the selected week."
          timeZone={timeZone}
        />
      </SectionCard>
    </div>
  );
}

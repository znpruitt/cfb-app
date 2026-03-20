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
      <table className="min-w-full border-separate border-spacing-0 text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-[0.16em] text-gray-500 dark:text-zinc-500">
            {['Team', 'Opponent', 'Owner matchup', 'Status', 'Score', 'Kickoff'].map((label) => (
              <th
                key={label}
                className="border-b border-gray-200 px-3 py-2 font-semibold dark:border-zinc-700"
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
              <td className="border-b border-gray-100 px-3 py-2 font-semibold text-gray-950 dark:border-zinc-800 dark:text-zinc-50">
                <div>{row.teamName}</div>
                <div className="text-xs font-normal text-gray-500 dark:text-zinc-400">
                  {row.matchupLabel}
                </div>
              </td>
              <td className="border-b border-gray-100 px-3 py-2 text-gray-700 dark:border-zinc-800 dark:text-zinc-300">
                {row.opponentTeamName}
              </td>
              <td className="border-b border-gray-100 px-3 py-2 text-gray-700 dark:border-zinc-800 dark:text-zinc-300">
                {row.opponentOwner ? `vs ${row.opponentOwner}` : 'Unowned / non-league'}
              </td>
              <td className="border-b border-gray-100 px-3 py-2 dark:border-zinc-800">
                <span
                  className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${toneClasses(row.status)}`}
                >
                  {row.statusLabel}
                </span>
              </td>
              <td className="border-b border-gray-100 px-3 py-2 text-gray-700 dark:border-zinc-800 dark:text-zinc-300">
                {row.scoreLine}
              </td>
              <td className="border-b border-gray-100 px-3 py-2 text-gray-500 dark:border-zinc-800 dark:text-zinc-400">
                {formatKickoff(row.kickoff, timeZone)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type OwnerPickerProps = {
  ownerOptions: string[];
  selectedOwner: string | null;
  onOwnerChange: (owner: string) => void;
};

function OwnerPicker({
  ownerOptions,
  selectedOwner,
  onOwnerChange,
}: OwnerPickerProps): React.ReactElement | null {
  const [isOpen, setIsOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  const listId = React.useId();

  React.useEffect(() => {
    setIsOpen(false);
  }, [selectedOwner]);

  React.useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    function handlePointerDown(event: MouseEvent): void {
      if (!menuRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  if (ownerOptions.length === 0 || !selectedOwner) {
    return null;
  }

  const selectedIndex = Math.max(ownerOptions.indexOf(selectedOwner), 0);
  const previousOwner = ownerOptions.at(
    (selectedIndex - 1 + ownerOptions.length) % ownerOptions.length
  );
  const nextOwner = ownerOptions.at((selectedIndex + 1) % ownerOptions.length);

  return (
    <div ref={menuRef} className="relative inline-flex items-center gap-2 self-start lg:self-auto">
      <button
        type="button"
        className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-gray-300 bg-white text-lg font-semibold text-gray-700 shadow-sm transition hover:border-gray-400 hover:text-gray-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:border-zinc-500 dark:hover:text-zinc-50"
        onClick={() => previousOwner && onOwnerChange(previousOwner)}
        aria-label={`Previous owner: ${previousOwner ?? selectedOwner}`}
      >
        <span aria-hidden="true">←</span>
      </button>

      <div className="relative">
        <button
          type="button"
          className="inline-flex items-center gap-3 rounded-xl border border-transparent px-3 py-2 text-left transition hover:border-gray-300 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:border-zinc-700 dark:hover:bg-zinc-950"
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-controls={listId}
          onClick={() => setIsOpen((current) => !current)}
        >
          <span className="text-2xl font-semibold tracking-tight text-gray-950 dark:text-zinc-50">
            {selectedOwner}
          </span>
          <span className="text-sm font-medium text-gray-500 dark:text-zinc-400" aria-hidden="true">
            ▾
          </span>
        </button>

        {isOpen ? (
          <div className="absolute left-0 top-full z-20 mt-2 min-w-[240px] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-950">
            <ul
              id={listId}
              role="listbox"
              aria-label="Select owner"
              className="max-h-72 overflow-y-auto py-1"
            >
              {ownerOptions.map((owner) => {
                const isSelected = owner === selectedOwner;
                return (
                  <li key={owner} role="option" aria-selected={isSelected}>
                    <button
                      type="button"
                      className={`flex w-full items-center justify-between px-4 py-2 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 ${
                        isSelected
                          ? 'bg-blue-50 font-semibold text-blue-900 dark:bg-blue-950/50 dark:text-blue-100'
                          : 'text-gray-700 hover:bg-gray-50 dark:text-zinc-200 dark:hover:bg-zinc-900'
                      }`}
                      onClick={() => onOwnerChange(owner)}
                    >
                      <span>{owner}</span>
                      {isSelected ? (
                        <span className="text-xs uppercase tracking-[0.16em] text-blue-700 dark:text-blue-300">
                          Selected
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </div>

      <button
        type="button"
        className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-gray-300 bg-white text-lg font-semibold text-gray-700 shadow-sm transition hover:border-gray-400 hover:text-gray-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:border-zinc-500 dark:hover:text-zinc-50"
        onClick={() => nextOwner && onOwnerChange(nextOwner)}
        aria-label={`Next owner: ${nextOwner ?? selectedOwner}`}
      >
        <span aria-hidden="true">→</span>
      </button>
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
              <div className="space-y-1">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
                  <OwnerPicker
                    ownerOptions={snapshot.ownerOptions}
                    selectedOwner={snapshot.selectedOwner}
                    onOwnerChange={onOwnerChange}
                  />
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600 dark:text-zinc-300">
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
          <div className="mb-4 flex flex-wrap gap-x-4 gap-y-2 rounded border border-gray-200 bg-gray-50/80 px-3 py-3 text-sm text-gray-700 dark:border-zinc-800 dark:bg-zinc-950/70 dark:text-zinc-300">
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

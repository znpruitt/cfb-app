import React from 'react';

import type { OwnerRosterRow, OwnerViewSnapshot } from '../lib/ownerView';
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

function toneClasses(status: OwnerRosterRow['currentStatus']): string {
  if (status === 'Live') {
    return 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300';
  }
  if (status === 'Final') {
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
    <section className="rounded-xl border border-gray-300 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
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
    <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50/80 px-4 py-4 text-sm text-gray-600 dark:border-zinc-700 dark:bg-zinc-950/70 dark:text-zinc-300">
      {message}
    </div>
  );
}

function renderNextGameCell(row: OwnerRosterRow, timeZone: string): React.ReactElement {
  if (row.currentStatus === 'Final' && !row.nextOpponent) {
    return (
      <div>
        <div className="font-medium text-gray-700 dark:text-zinc-200">Season complete</div>
      </div>
    );
  }

  return (
    <div>
      <div className="font-medium text-gray-700 dark:text-zinc-200">
        vs {row.nextOpponent ?? 'TBD'}
      </div>
      <div className="text-xs text-gray-500 dark:text-zinc-400">
        {row.currentStatus === 'Live' && row.currentScore
          ? row.currentScore
          : formatKickoff(row.nextKickoff, timeZone)}
      </div>
    </div>
  );
}

function OwnerRosterTable({
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
    <div className="-mx-1 overflow-x-auto px-1">
      <table className="min-w-full border-separate border-spacing-0 text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-[0.16em] text-gray-500 dark:text-zinc-500">
            {['Team', 'Record', 'Next Game', 'Status'].map((label) => (
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
              key={row.teamName}
              className="odd:bg-gray-50/70 even:bg-white dark:odd:bg-zinc-950/70 dark:even:bg-zinc-900"
            >
              <td className="border-b border-gray-100 px-2 py-2 font-semibold text-gray-950 sm:px-3 dark:border-zinc-800 dark:text-zinc-50">
                {row.teamName}
              </td>
              <td className="border-b border-gray-100 px-2 py-2 text-gray-700 sm:px-3 dark:border-zinc-800 dark:text-zinc-300">
                {row.record}
              </td>
              <td className="border-b border-gray-100 px-2 py-2 sm:px-3 dark:border-zinc-800">
                {renderNextGameCell(row, timeZone)}
              </td>
              <td className="border-b border-gray-100 px-2 py-2 sm:px-3 dark:border-zinc-800">
                <span
                  className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${toneClasses(row.currentStatus)}`}
                >
                  {row.currentStatus}
                </span>
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
    <div ref={menuRef} className="relative flex items-center gap-3 self-start lg:self-auto">
      <button
        type="button"
        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-gray-300 bg-white text-lg font-semibold text-gray-700 shadow-sm transition hover:border-gray-400 hover:text-gray-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:border-zinc-500 dark:hover:text-zinc-50"
        onClick={() => previousOwner && onOwnerChange(previousOwner)}
        aria-label={`Previous owner: ${previousOwner ?? selectedOwner}`}
      >
        <span aria-hidden="true">←</span>
      </button>

      <div className="relative min-w-0">
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-xl border border-transparent px-3 py-2 text-left transition hover:border-gray-300 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:border-zinc-700 dark:hover:bg-zinc-950"
          aria-label={`Choose ${selectedOwner}`}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-controls={listId}
          onClick={() => setIsOpen((current) => !current)}
        >
          <span className="truncate text-3xl font-semibold tracking-tight text-gray-950 dark:text-zinc-50">
            {selectedOwner}
          </span>
          <span className="text-sm font-medium text-gray-500 dark:text-zinc-400" aria-hidden="true">
            ▾
          </span>
        </button>

        {isOpen ? (
          <div className="absolute left-0 top-full z-20 mt-2 w-full min-w-[240px] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg sm:w-auto dark:border-zinc-700 dark:bg-zinc-950">
            <ul
              id={listId}
              role="listbox"
              aria-label="Choose owner"
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
      <section className="rounded-xl border border-gray-300 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            {snapshot.header ? (
              <>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                  <div className="space-y-1">
                    <OwnerPicker
                      ownerOptions={snapshot.ownerOptions}
                      selectedOwner={snapshot.selectedOwner}
                      onOwnerChange={onOwnerChange}
                    />
                    <p className="text-sm text-gray-600 dark:text-zinc-300">
                      Roster • Live • This week
                    </p>
                  </div>
                </div>
                <div className="grid gap-2 text-sm text-gray-600 sm:grid-cols-2 xl:grid-cols-4 dark:text-zinc-300">
                  <span className="rounded-lg border border-gray-200 bg-gray-50/80 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950/60">
                    Rank #{snapshot.header.rank}
                  </span>
                  <span className="rounded-lg border border-gray-200 bg-gray-50/80 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950/60">
                    Record {snapshot.header.record}
                  </span>
                  <span className="rounded-lg border border-gray-200 bg-gray-50/80 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950/60">
                    Win % {formatWinPct(snapshot.header.winPct)}
                  </span>
                  <span className="rounded-lg border border-gray-200 bg-gray-50/80 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950/60">
                    Diff {formatDiff(snapshot.header.pointDifferential)}
                  </span>
                </div>
              </>
            ) : (
              <div className="space-y-1">
                <h2 className="text-2xl font-semibold tracking-tight text-gray-950 dark:text-zinc-50">
                  Teams
                </h2>
                <p className="text-sm text-gray-600 dark:text-zinc-300">
                  Upload owner data to populate league context.
                </p>
              </div>
            )}
          </div>
        </div>
      </section>

      <SectionCard
        title="Roster"
        description="One row per team with season record, live status, and next scheduled opponent."
      >
        <OwnerRosterTable
          rows={snapshot.rosterRows}
          emptyMessage="No teams are attached to this selection yet."
          timeZone={timeZone}
        />
      </SectionCard>

      <SectionCard
        title="Live games"
        description="Teams currently in progress for the selected entry."
      >
        <OwnerRosterTable
          rows={snapshot.liveRows}
          emptyMessage="No live games for this selection right now."
          timeZone={timeZone}
        />
      </SectionCard>

      <SectionCard
        title={`${selectedWeekLabel} slate`}
        description="Team-by-team status for the selected week, including live overrides and completed results."
      >
        {snapshot.weekSummary ? (
          <div className="mb-4 grid gap-2 rounded-lg border border-gray-200 bg-gray-50/80 px-3 py-3 text-sm text-gray-700 sm:grid-cols-2 xl:grid-cols-3 dark:border-zinc-800 dark:bg-zinc-950/70 dark:text-zinc-300">
            <span className="rounded-md bg-white/80 px-2.5 py-2 dark:bg-zinc-900/70">
              {snapshot.weekSummary.performanceSummary}
            </span>
            <span className="rounded-md bg-white/80 px-2.5 py-2 dark:bg-zinc-900/70">
              {snapshot.weekSummary.performanceDetail}
            </span>
            <span className="rounded-md bg-white/80 px-2.5 py-2 dark:bg-zinc-900/70">
              {snapshot.weekSummary.liveGames} live
            </span>
            <span className="rounded-md bg-white/80 px-2.5 py-2 dark:bg-zinc-900/70">
              {snapshot.weekSummary.scheduledGames} scheduled
            </span>
            <span className="rounded-md bg-white/80 px-2.5 py-2 dark:bg-zinc-900/70">
              {snapshot.weekSummary.finalGames} final
            </span>
            <span className="rounded-md bg-white/80 px-2.5 py-2 dark:bg-zinc-900/70">
              Opponents:{' '}
              {snapshot.weekSummary.opponentOwners.length > 0
                ? snapshot.weekSummary.opponentOwners.join(', ')
                : 'Unowned / non-league only'}
            </span>
          </div>
        ) : null}
        <OwnerRosterTable
          rows={snapshot.weekRows}
          emptyMessage="No teams from this selection are attached to the selected week."
          timeZone={timeZone}
        />
      </SectionCard>
    </div>
  );
}

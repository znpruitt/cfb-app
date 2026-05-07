'use client';

import React from 'react';
import type { RankedRecord, RankedRecordRow, RecordId } from '@/lib/selectors/leagueRecords';

const PODIUM_SIZE = 3;

const TINT_BY_RANK: Record<number, string> = {
  1: 'text-yellow-600 dark:text-amber-300',
  2: 'text-slate-500 dark:text-slate-200',
  3: 'text-orange-900 dark:text-[#d4915c]',
};

const EYEBROW_BY_ID: Partial<Record<RecordId, string>> = {
  closest_title_race: 'TITLE RACE',
  biggest_collapse: 'COLLAPSE',
  biggest_climb: 'CLIMB',
};

type RecordEventListProps = {
  record: RankedRecord;
};

/**
 * Renders an event-shaped record (closest_title_race, biggest_collapse,
 * biggest_climb) as a single horizontal row matching the owner-ranked
 * layout: label | 3 podium cells | actions. Year column carries the
 * gold/silver/bronze tint instead of a rank number. Show all expands
 * single-column across the podium + actions span below the row.
 */
export function RecordEventList({ record }: RecordEventListProps): React.ReactElement {
  const [showAll, setShowAll] = React.useState<boolean>(false);

  const podium = record.rows.slice(0, PODIUM_SIZE);
  const overflow = record.rows.slice(PODIUM_SIZE);
  const hasOverflow = overflow.length > 0;
  const isEmpty = record.rows.length === 0;
  const expanded = showAll && hasOverflow;
  const eyebrow = EYEBROW_BY_ID[record.id] ?? '';

  return (
    <article
      id={record.id}
      data-testid="record-row"
      className={`grid scroll-mt-20 grid-cols-[200px_repeat(3,minmax(0,1fr))_80px] items-center gap-x-6 py-3.5 ${
        expanded ? '' : 'border-b border-gray-100 dark:border-zinc-800'
      }`}
    >
      {/* Label cell */}
      <div className="flex flex-col">
        <span
          data-testid="record-eyebrow"
          className="text-[11px] font-medium uppercase tracking-[0.06em] text-gray-500 dark:text-zinc-500"
        >
          {eyebrow}
        </span>
        <span className="mt-0.5 text-xs text-gray-700 dark:text-zinc-300">{record.label}</span>
      </div>

      {/* Podium cells (or empty placeholder spanning 3 columns) */}
      {isEmpty ? (
        <div
          data-testid="record-empty"
          className="col-start-2 col-span-3 text-[12px] italic text-gray-500 dark:text-zinc-500"
        >
          No events yet.
        </div>
      ) : (
        [0, 1, 2].map((i) => {
          const row = podium[i];
          if (!row) return <div key={i} aria-hidden="true" />;
          return (
            <EventCell
              key={`${row.rank}-${row.contextString ?? ''}-${row.owners.join('-')}`}
              row={row}
              recordId={record.id}
            />
          );
        })
      )}

      {/* Actions cell */}
      <div className="flex flex-col items-end gap-2">
        {hasOverflow ? (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className={`text-[11px] ${
              showAll ? 'text-gray-900 dark:text-zinc-100' : 'text-gray-500 dark:text-zinc-400'
            } hover:text-gray-700 dark:hover:text-zinc-200`}
          >
            {showAll ? 'Hide' : 'Show all'}
          </button>
        ) : null}
      </div>

      {/* Show all expansion: single-column list across columns 2..-1 */}
      {expanded ? (
        <div
          data-testid="record-overflow"
          className="col-start-2 col-end-[-1] mt-2 border-b border-gray-100 dark:border-zinc-800"
        >
          <ol className="divide-y divide-gray-100 dark:divide-zinc-800">
            {overflow.map((row) => (
              <li
                key={`${row.rank}-${row.contextString ?? ''}-${row.owners.join('-')}`}
                className="flex items-center gap-3 py-1.5 text-[13px]"
              >
                <span className="w-20 flex-none overflow-hidden text-right tabular-nums text-gray-500 dark:text-zinc-400">
                  {row.contextString ?? '—'}
                </span>
                <span className="min-w-0 flex-1 text-gray-900 dark:text-zinc-100">
                  {renderHoldersPhrase(row, record.id)}
                </span>
                <span className="flex-none font-medium tabular-nums text-gray-900 dark:text-zinc-100">
                  {row.formattedValue}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </article>
  );
}

type EventCellProps = {
  row: RankedRecordRow;
  recordId: string;
};

function EventCell({ row, recordId }: EventCellProps): React.ReactElement {
  const tintClass = TINT_BY_RANK[row.rank] ?? 'text-gray-500 dark:text-zinc-400';
  return (
    <div
      data-testid="podium-cell"
      className="grid min-w-0 grid-cols-[64px_1fr] items-center gap-x-2.5"
    >
      <span
        data-testid="event-year"
        className={`overflow-hidden text-[13px] font-medium tabular-nums ${tintClass}`}
      >
        {row.contextString ?? '—'}
      </span>
      <div className="flex min-w-0 flex-col">
        <span className="text-[13px] text-gray-900 dark:text-zinc-100">
          {renderHoldersPhrase(row, recordId)}
        </span>
        <span className="mt-px text-sm font-medium tabular-nums text-gray-900 dark:text-zinc-100">
          {row.formattedValue}
        </span>
      </div>
    </div>
  );
}

function renderHoldersPhrase(row: RankedRecordRow, recordId: string): React.ReactNode {
  if (recordId === 'closest_title_race' && row.champion && row.runnerUp) {
    return (
      <>
        <strong className="font-medium">{row.champion}</strong> over {row.runnerUp}
      </>
    );
  }
  if (
    (recordId === 'biggest_collapse' || recordId === 'biggest_climb') &&
    row.fromRank !== undefined &&
    row.toRank !== undefined &&
    row.owners[0]
  ) {
    return (
      <>
        <strong className="font-medium">{row.owners[0]}</strong> finished {ordinal(row.fromRank)},
        then {ordinal(row.toRank)}
      </>
    );
  }
  return <span className="font-medium">{row.owners.join(' & ')}</span>;
}

/** Renders 1 → "1st", 2 → "2nd", 3 → "3rd", 4 → "4th", … with proper teen handling. */
function ordinal(n: number): string {
  const lastTwo = n % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

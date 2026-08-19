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
 * biggest_climb) in the same responsive structure as owner-ranked records.
 * Year context carries the gold/silver/bronze tint instead of a rank number.
 * Show all expands as a single-column list below the podium.
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
      className={`grid scroll-mt-20 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-2 py-4 lg:grid-cols-[200px_minmax(0,1fr)_80px] lg:items-center lg:gap-x-6 lg:gap-y-0 lg:py-3.5 ${
        expanded ? '' : 'border-b border-gray-100 dark:border-zinc-800'
      }`}
    >
      {/* Label cell */}
      <div className="col-start-1 row-start-1 flex min-w-0 flex-col">
        <span
          data-testid="record-eyebrow"
          className="text-[11px] font-medium uppercase tracking-[0.06em] text-gray-500 dark:text-zinc-500"
        >
          {eyebrow}
        </span>
        <span className="mt-0.5 text-xs text-gray-700 dark:text-zinc-300">{record.label}</span>
      </div>

      {/*
        Responsive priority: label/actions stay visible first; the defining
        top-three events stack below the lg viewport breakpoint, where the
        existing three-column podium returns.
      */}
      <div
        data-testid="record-podium"
        className="col-span-2 row-start-2 mt-1 grid grid-cols-1 divide-y divide-gray-100 dark:divide-zinc-800 lg:col-span-1 lg:col-start-2 lg:row-start-1 lg:mt-0 lg:grid-cols-3 lg:gap-x-6 lg:divide-y-0"
      >
        {isEmpty ? (
          <div
            data-testid="record-empty"
            className="py-2 text-[12px] italic text-gray-500 dark:text-zinc-500 lg:col-span-3 lg:py-0"
          >
            No events yet.
          </div>
        ) : (
          podium.map((row) => (
            <EventCell
              key={`${row.rank}-${row.contextString ?? ''}-${row.owners.join('-')}`}
              row={row}
              recordId={record.id}
            />
          ))
        )}
      </div>

      {/* Actions cell */}
      <div className="col-start-2 row-start-1 flex flex-row items-center justify-end gap-1 lg:col-start-3 lg:flex-col lg:items-end lg:gap-2">
        {hasOverflow ? (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className={`-mr-2 min-h-11 touch-manipulation rounded-md px-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-500 lg:mr-0 lg:min-h-0 lg:px-0 lg:text-[11px] lg:font-normal ${
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
          className="col-span-2 row-start-3 mt-1 border-b border-gray-100 dark:border-zinc-800 lg:col-start-2 lg:row-start-2 lg:mt-2"
        >
          <ol className="divide-y divide-gray-100 dark:divide-zinc-800">
            {overflow.map((row) => (
              <li
                key={`${row.rank}-${row.contextString ?? ''}-${row.owners.join('-')}`}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 py-2 text-[13px] lg:grid-cols-[80px_minmax(0,1fr)_auto] lg:items-center"
              >
                <span className="col-span-2 row-start-2 mt-0.5 overflow-hidden text-[11px] tabular-nums text-gray-500 dark:text-zinc-400 lg:col-span-1 lg:col-start-1 lg:row-start-1 lg:mt-0 lg:text-right lg:text-[13px]">
                  {row.contextString ?? '—'}
                </span>
                <span className="col-start-1 row-start-1 min-w-0 break-words text-gray-900 dark:text-zinc-100 lg:col-start-2">
                  {renderHoldersPhrase(row, record.id)}
                </span>
                <span className="col-start-2 row-start-1 whitespace-nowrap text-right font-medium tabular-nums text-gray-900 dark:text-zinc-100 lg:col-start-3">
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
      className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 py-2 lg:grid-cols-[96px_minmax(0,1fr)] lg:items-center lg:gap-x-2.5 lg:py-0"
    >
      <span
        data-testid="event-year"
        className={`col-span-2 col-start-1 row-start-2 mt-0.5 overflow-hidden text-[11px] font-medium tabular-nums lg:col-span-1 lg:row-start-1 lg:mt-0 lg:text-[13px] ${tintClass}`}
      >
        {row.contextString ?? '—'}
      </span>
      <div className="contents lg:col-start-2 lg:row-start-1 lg:flex lg:min-w-0 lg:flex-col">
        <span className="col-start-1 row-start-1 min-w-0 break-words text-[13px] text-gray-900 dark:text-zinc-100">
          {renderHoldersPhrase(row, recordId)}
        </span>
        <span className="col-start-2 row-start-1 whitespace-nowrap text-right text-sm font-medium tabular-nums text-gray-900 dark:text-zinc-100 lg:mt-px lg:text-left">
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

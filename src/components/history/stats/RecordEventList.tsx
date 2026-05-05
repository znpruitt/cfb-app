'use client';

import React from 'react';
import type { RankedRecord, RankedRecordRow } from '@/lib/selectors/leagueRecords';

const PODIUM_SIZE = 3;

const TINT_BY_RANK: Record<number, string> = {
  1: 'text-yellow-600 dark:text-amber-300',
  2: 'text-slate-500 dark:text-slate-200',
  3: 'text-orange-900 dark:text-[#d4915c]',
};

type RecordEventListProps = {
  record: RankedRecord;
};

/**
 * Renders an event-shaped record (closest_title_race, biggest_collapse,
 * biggest_climb). Year column on the left, holders phrase in the middle,
 * value on the right. No active/all toggle — events have no Active semantic.
 *
 * GAP NOTE — for `closest_title_race`, the selector returns owners as
 * lex-sorted [champion, runnerUp]; champion/runnerUp distinction is not
 * surfaced structurally on the row. For `biggest_collapse` / `biggest_climb`,
 * fromRank/toRank are likewise not exposed. v1 falls back to displaying
 * `owners.join(' & ')` and `formattedValue` directly. A selector extension
 * would be required to render the richer "{champion} over {runnerUp}" or
 * "{owner} finished Xth, then Yth" copy from the spec.
 */
export function RecordEventList({ record }: RecordEventListProps): React.ReactElement {
  const [showAll, setShowAll] = React.useState<boolean>(false);
  const visibleRows = showAll ? record.rows : record.rows.slice(0, PODIUM_SIZE);
  const hasOverflow = record.rows.length > PODIUM_SIZE;

  return (
    <article id={record.id} className="scroll-mt-20 py-4">
      <header className="pb-2">
        <h3 className="text-[15px] font-medium text-gray-900 dark:text-zinc-100">{record.label}</h3>
      </header>

      {record.rows.length === 0 ? (
        <p className="py-2 text-sm text-gray-500 dark:text-zinc-400">No events yet.</p>
      ) : (
        <ol className="divide-y divide-gray-100 dark:divide-zinc-800">
          {visibleRows.map((row) => (
            <EventRow
              key={`${row.rank}-${row.contextString ?? row.owners.join(',')}`}
              row={row}
              showAll={showAll}
            />
          ))}
        </ol>
      )}

      {hasOverflow ? (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="mt-2 text-[13px] text-gray-500 hover:text-gray-700 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          {showAll ? 'Show less' : `Show all ${record.rows.length}`}
        </button>
      ) : null}
    </article>
  );
}

type EventRowProps = {
  row: RankedRecordRow;
  showAll: boolean;
};

function EventRow({ row, showAll }: EventRowProps): React.ReactElement {
  const tintClass =
    !showAll && row.rank <= 3 ? TINT_BY_RANK[row.rank] : 'text-gray-500 dark:text-zinc-400';
  return (
    <li className="flex items-start gap-3 py-[9px]">
      <span className={`w-16 flex-none text-sm font-medium tabular-nums ${tintClass}`}>
        {row.contextString ?? '—'}
      </span>
      <span className="min-w-0 flex-1 text-sm font-medium text-gray-900 dark:text-zinc-100">
        {row.owners.join(' & ')}
      </span>
      <span className="flex-none text-sm font-medium tabular-nums text-gray-900 dark:text-zinc-100">
        {row.formattedValue}
      </span>
    </li>
  );
}

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
 * Holders phrase rendering keys off recordId via row fields the selector
 * surfaces structurally (champion/runnerUp for title race, fromRank/toRank
 * for collapse/climb). When those fields are absent, falls back to
 * `owners.join(' & ')` defensively.
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
              key={`${row.rank}-${row.contextString ?? ''}-${row.owners.join('-')}`}
              row={row}
              recordId={record.id}
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
  recordId: string;
};

function EventRow({ row, recordId }: EventRowProps): React.ReactElement {
  // Podium tint follows row.rank, not slice index — ranks 1/2/3 (including
  // tied) stay gold/silver/bronze when Show all expands.
  const tintClass = TINT_BY_RANK[row.rank] ?? 'text-gray-500 dark:text-zinc-400';
  return (
    <li className="flex items-start gap-3 py-[9px]">
      {/* w-24 (96px) accommodates year-pair strings like "2024→2025" (~80px
          at 14px tabular-nums weight 500). Single years like "2024" still fit
          cleanly. overflow-hidden is defensive — content is confidently
          shorter than the column at supported font sizes. */}
      <span
        className={`w-24 flex-none overflow-hidden text-sm font-medium tabular-nums ${tintClass}`}
      >
        {row.contextString ?? '—'}
      </span>
      <span className="min-w-0 flex-1 text-sm text-gray-900 dark:text-zinc-100">
        {renderHoldersPhrase(row, recordId)}
      </span>
      <span className="flex-none text-sm font-medium tabular-nums text-gray-900 dark:text-zinc-100">
        {row.formattedValue}
      </span>
    </li>
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

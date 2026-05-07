'use client';

import React from 'react';
import FormerOwnerBadge from '@/components/history/FormerOwnerBadge';
import type { RankedRecord, RankedRecordRow } from '@/lib/selectors/leagueRecords';
import { ActiveOnlyToggle } from './ActiveOnlyToggle';

const PODIUM_SIZE = 3;

type RecordRankingProps = {
  record: RankedRecord;
  /** When true, the "Active only" filter is forced on and the toggle is hidden. */
  lockedActiveOnly?: boolean;
  /** Optional italic note rendered below the ranking (e.g. "Min. 3 seasons — Hardiman excluded"). */
  qualifierNote?: string;
};

const RANK_TINT: Record<number, string> = {
  1: 'text-yellow-600 dark:text-amber-300',
  2: 'text-slate-500 dark:text-slate-200',
  3: 'text-orange-900 dark:text-[#d4915c]',
};

function rankLabel(rank: number, isTied: boolean): string {
  return isTied ? `T-${rank}` : `${rank}`;
}

function buildTieMap(rows: RankedRecordRow[]): Map<number, boolean> {
  const counts = new Map<number, number>();
  for (const row of rows) {
    counts.set(row.rank, (counts.get(row.rank) ?? 0) + 1);
  }
  const tied = new Map<number, boolean>();
  for (const [rank, count] of counts) tied.set(rank, count > 1);
  return tied;
}

export function RecordRanking({
  record,
  lockedActiveOnly = false,
  qualifierNote,
}: RecordRankingProps): React.ReactElement {
  const [activeOnly, setActiveOnly] = React.useState<boolean>(lockedActiveOnly);
  const [showAll, setShowAll] = React.useState<boolean>(false);

  const sourceRows = record.rows;
  const filteredRows = React.useMemo(
    () => (activeOnly || lockedActiveOnly ? sourceRows.filter((r) => !r.isFormer) : sourceRows),
    [sourceRows, activeOnly, lockedActiveOnly]
  );
  const tieMap = React.useMemo(() => buildTieMap(filteredRows), [filteredRows]);
  const visibleRows = showAll ? filteredRows : filteredRows.slice(0, PODIUM_SIZE);
  const hasOverflow = filteredRows.length > PODIUM_SIZE;

  return (
    <article id={record.id} className="scroll-mt-20 py-4">
      <header className="flex items-center justify-between gap-3 pb-2">
        <h3 className="text-[15px] font-medium text-gray-900 dark:text-zinc-100">{record.label}</h3>
        {lockedActiveOnly ? (
          <span className="text-[11px] italic text-gray-500 dark:text-zinc-400">Active only</span>
        ) : (
          <ActiveOnlyToggle activeOnly={activeOnly} onChange={setActiveOnly} />
        )}
      </header>

      {filteredRows.length === 0 ? (
        <p className="py-2 text-sm text-gray-500 dark:text-zinc-400">No qualifying entries.</p>
      ) : (
        <ol className="divide-y divide-gray-100 dark:divide-zinc-800">
          {visibleRows.map((row) => {
            const tied = tieMap.get(row.rank) ?? false;
            // Podium tint follows row.rank, not slice index — ranks 1/2/3
            // (including tied) stay gold/silver/bronze when Show all expands.
            const tintClass = RANK_TINT[row.rank] ?? 'text-gray-500 dark:text-zinc-400';
            return (
              <li
                key={`${row.rank}-${row.owners.join(',')}`}
                className="flex items-start gap-3 py-[9px]"
              >
                <span
                  className={`w-8 flex-none text-right text-sm font-medium tabular-nums ${tintClass}`}
                >
                  {rankLabel(row.rank, tied)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-900 dark:text-zinc-100">
                      {row.owners.join(' & ')}
                    </span>
                    {row.isFormer ? <FormerOwnerBadge /> : null}
                  </div>
                  {row.contextString ? (
                    <p className="mt-0.5 text-xs text-gray-500 dark:text-zinc-400">
                      {row.contextString}
                    </p>
                  ) : null}
                </div>
                <span className="flex-none text-sm font-medium tabular-nums text-gray-900 dark:text-zinc-100">
                  {row.formattedValue}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      {hasOverflow ? (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="mt-2 text-[13px] text-gray-500 hover:text-gray-700 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          {showAll ? 'Show less' : `Show all ${filteredRows.length}`}
        </button>
      ) : null}

      {qualifierNote ? (
        <p className="mt-2 text-[11px] italic text-gray-500 dark:text-zinc-500">{qualifierNote}</p>
      ) : null}
    </article>
  );
}

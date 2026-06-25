'use client';

import React from 'react';
import FormerOwnerBadge from '@/components/history/FormerOwnerBadge';
import type { RankedRecord, RankedRecordRow, RecordId } from '@/lib/selectors/leagueRecords';
import { ActiveOnlyToggle } from './ActiveOnlyToggle';

const PODIUM_SIZE = 3;

const RANK_TINT: Record<number, string> = {
  1: 'text-yellow-600 dark:text-amber-300',
  2: 'text-slate-500 dark:text-slate-200',
  3: 'text-orange-900 dark:text-[#d4915c]',
};

const EYEBROW_BY_ID: Partial<Record<RecordId, string>> = {
  career_points: 'POINTS',
  career_wins: 'WINS',
  career_win_pct: 'WIN %',
  career_titles: 'TITLES',
  career_avg_finish: 'AVG FINISH',
  career_consistency: 'TOP-3s',
  career_drought: 'DROUGHT',
  career_dynasty: 'DYNASTY',
  single_season_points_high: 'SEASON HIGH',
  single_season_points_low: 'SEASON LOW',
  single_season_high_score: 'WEEK HIGH',
  single_season_blowout: 'BLOWOUT',
};

type RecordRankingProps = {
  record: RankedRecord;
  /** When true, "Active only" filter is forced on and the toggle is hidden. */
  lockedActiveOnly?: boolean;
  /** Optional italic note rendered below the label (e.g. "Min. 3 seasons"). */
  qualifierNote?: string;
};

export function RecordRanking({
  record,
  lockedActiveOnly = false,
  qualifierNote,
}: RecordRankingProps): React.ReactElement {
  const [activeOnly, setActiveOnly] = React.useState<boolean>(lockedActiveOnly);
  const [showAll, setShowAll] = React.useState<boolean>(false);

  const filteredRows = React.useMemo(
    () => (activeOnly || lockedActiveOnly ? record.rows.filter((r) => !r.isFormer) : record.rows),
    [record.rows, activeOnly, lockedActiveOnly]
  );
  const tieMap = React.useMemo(() => buildTieMap(filteredRows), [filteredRows]);

  const podium = filteredRows.slice(0, PODIUM_SIZE);
  const overflow = filteredRows.slice(PODIUM_SIZE);
  const hasOverflow = overflow.length > 0;
  const isEmpty = filteredRows.length === 0;
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
        {qualifierNote ? (
          <span
            data-testid="record-qualifier"
            className="mt-1 text-[10px] italic text-gray-500 dark:text-zinc-500"
          >
            {qualifierNote}
          </span>
        ) : null}
      </div>

      {/* Podium cells (or empty placeholder spanning 3 columns) */}
      {isEmpty ? (
        <div
          data-testid="record-empty"
          className="col-start-2 col-span-3 text-[12px] italic text-gray-500 dark:text-zinc-500"
        >
          No qualifying entries.
        </div>
      ) : (
        [0, 1, 2].map((i) => {
          const row = podium[i];
          if (!row) return <div key={i} aria-hidden="true" />;
          return (
            <PodiumCell
              key={`${row.rank}-${row.owners.join('-')}`}
              row={row}
              tied={tieMap.get(row.rank) ?? false}
            />
          );
        })
      )}

      {/* Actions cell */}
      <div className="flex flex-col items-end gap-2">
        {lockedActiveOnly ? (
          <span className="text-[11px] italic text-gray-500 dark:text-zinc-400">Active only</span>
        ) : (
          <ActiveOnlyToggle activeOnly={activeOnly} onChange={setActiveOnly} />
        )}
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
            {overflow.map((row) => {
              const tied = tieMap.get(row.rank) ?? false;
              return (
                <li
                  key={`${row.rank}-${row.owners.join('-')}`}
                  className="flex items-center gap-3 py-1.5 text-[13px]"
                >
                  <span className="w-7 flex-none text-right tabular-nums text-gray-500 dark:text-zinc-400">
                    {tied ? `T-${row.rank}` : row.rank}
                  </span>
                  <span className="flex flex-1 items-center gap-2">
                    <span className="font-medium text-gray-900 dark:text-zinc-100">
                      {row.owners.join(' & ')}
                    </span>
                    {row.isFormer ? <FormerOwnerBadge /> : null}
                  </span>
                  <span className="flex-none tabular-nums text-gray-900 dark:text-zinc-100">
                    {row.formattedValue}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}
    </article>
  );
}

function buildTieMap(rows: RankedRecordRow[]): Map<number, boolean> {
  const counts = new Map<number, number>();
  for (const row of rows) counts.set(row.rank, (counts.get(row.rank) ?? 0) + 1);
  const tied = new Map<number, boolean>();
  for (const [rank, count] of counts) tied.set(rank, count > 1);
  return tied;
}

type PodiumCellProps = {
  row: RankedRecordRow;
  tied: boolean;
};

function PodiumCell({ row, tied }: PodiumCellProps): React.ReactElement {
  const tintClass = RANK_TINT[row.rank] ?? 'text-gray-500 dark:text-zinc-400';
  const rankLabel = tied ? `T-${row.rank}` : `${row.rank}`;
  return (
    <div
      data-testid="podium-cell"
      className="grid min-w-0 grid-cols-[28px_1fr] items-center gap-x-2.5"
    >
      <span
        data-testid="podium-rank"
        className={`text-[18px] font-medium tabular-nums ${tintClass}`}
      >
        {rankLabel}
      </span>
      <div className="flex min-w-0 flex-col">
        <span className="flex items-center gap-1 text-[13px] font-medium text-gray-900 dark:text-zinc-100">
          {row.owners.join(' & ')}
          {row.isFormer ? <FormerOwnerBadge /> : null}
        </span>
        <span className="mt-px text-sm font-medium tabular-nums text-gray-900 dark:text-zinc-100">
          {row.formattedValue}
        </span>
        {row.contextString ? (
          <span className="mt-0.5 text-[11px] text-gray-500 dark:text-zinc-400">
            {row.contextString}
          </span>
        ) : null}
      </div>
    </div>
  );
}

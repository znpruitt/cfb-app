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
        {qualifierNote ? (
          <span
            data-testid="record-qualifier"
            className="mt-1 text-[10px] italic text-gray-500 dark:text-zinc-500"
          >
            {qualifierNote}
          </span>
        ) : null}
      </div>

      {/*
        Responsive priority: label/actions stay visible first; the defining
        top-three ranking stacks below the lg viewport breakpoint, where the
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
            No qualifying entries.
          </div>
        ) : (
          podium.map((row) => (
            <PodiumCell
              key={`${row.rank}-${row.owners.join('-')}`}
              row={row}
              tied={tieMap.get(row.rank) ?? false}
            />
          ))
        )}
      </div>

      {/* Actions cell */}
      <div className="col-start-2 row-start-1 flex flex-col items-end gap-2 lg:col-start-3">
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
          className="col-span-2 row-start-3 mt-1 border-b border-gray-100 dark:border-zinc-800 lg:col-start-2 lg:row-start-2 lg:mt-2"
        >
          <ol className="divide-y divide-gray-100 dark:divide-zinc-800">
            {overflow.map((row) => {
              const tied = tieMap.get(row.rank) ?? false;
              return (
                <li
                  key={`${row.rank}-${row.owners.join('-')}`}
                  className="grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-x-3 py-2 text-[13px]"
                >
                  <span className="text-right tabular-nums text-gray-500 dark:text-zinc-400">
                    {tied ? `T-${row.rank}` : row.rank}
                  </span>
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="break-words font-medium text-gray-900 dark:text-zinc-100">
                      {row.owners.join(' & ')}
                    </span>
                    {row.isFormer ? <FormerOwnerBadge /> : null}
                  </span>
                  <span className="whitespace-nowrap text-right tabular-nums text-gray-900 dark:text-zinc-100">
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
      className="grid min-w-0 grid-cols-[32px_minmax(0,1fr)_auto] items-baseline gap-x-2.5 py-2 lg:grid-cols-[28px_minmax(0,1fr)] lg:items-center lg:py-0"
    >
      <span
        data-testid="podium-rank"
        className={`row-span-2 self-start pt-0.5 text-[18px] font-medium tabular-nums lg:row-span-1 lg:self-auto lg:pt-0 ${tintClass}`}
      >
        {rankLabel}
      </span>
      <div className="contents lg:col-start-2 lg:row-start-1 lg:flex lg:min-w-0 lg:flex-col">
        <span className="col-start-2 row-start-1 flex min-w-0 items-center gap-1 break-words text-[13px] font-medium text-gray-900 dark:text-zinc-100">
          {row.owners.join(' & ')}
          {row.isFormer ? <FormerOwnerBadge /> : null}
        </span>
        <span className="col-start-3 row-start-1 whitespace-nowrap text-right text-sm font-medium tabular-nums text-gray-900 dark:text-zinc-100 lg:mt-px lg:text-left">
          {row.formattedValue}
        </span>
        {row.contextString ? (
          <span className="col-span-2 col-start-2 row-start-2 mt-0.5 text-[11px] text-gray-500 dark:text-zinc-400">
            {row.contextString}
          </span>
        ) : null}
      </div>
    </div>
  );
}

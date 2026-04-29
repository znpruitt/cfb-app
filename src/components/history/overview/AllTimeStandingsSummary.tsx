import React from 'react';
import Link from 'next/link';
import type { AllTimeStandingRow } from '@/lib/selectors/historySelectors';
import SectionHead from './SectionHead';
import FormerOwnerBadge from '../FormerOwnerBadge';

/*
 * Responsive column degradation (per DESIGN.md `## Responsive column degradation`):
 * The standings dashboard summary degrades column-by-column as its container
 * narrows. This table sits in the dashboard's first (1.4fr) column and is
 * sized to fit ~620px at desktop full width, with sidebar/narrow browser
 * widths shedding columns through container queries.
 *
 * Priority order (always-show → drop-last):
 *   1. rank, owner, record       (always-show)
 *   2. avg-finish                (drop first, hidden ≤ 560px container)
 *   3. seasons                   (drop next,  hidden ≤ 500px container)
 *   4. titles                    (drop next,  hidden ≤ 440px container)
 *   5. diff                      (drop next,  hidden ≤ 400px container)
 *   6. pts                       (drop next,  hidden ≤ 340px container)
 *   7. win%                      (drop last,  hidden ≤ 280px container)
 *
 * Pixel thresholds are tuned for the dashboard's 1.4fr column allocation
 * and may need further refinement on preview.
 */

type Props = {
  rows: AllTimeStandingRow[];
  slug: string;
  activeOwners: Set<string>;
  limit?: number;
};

function formatPercent(winPct: number): string {
  return `${(winPct * 100).toFixed(1)}%`;
}

function formatAvgFinish(avgFinish: number): string {
  return avgFinish.toFixed(1);
}

function formatPoints(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}

function formatSignedDiff(value: number): string {
  const rounded = Math.round(value);
  if (rounded === 0) return '0';
  const sign = rounded > 0 ? '+' : '−';
  return `${sign}${Math.abs(rounded).toLocaleString('en-US')}`;
}

function ownerHref(slug: string, owner: string): string {
  return `/league/${slug}/history/owner/${encodeURIComponent(owner)}`;
}

const HEADER_BASE =
  'pb-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-400 dark:text-zinc-500';
const NUM_HEADER = `${HEADER_BASE} pl-1.5 text-right`;
const TEXT_HEADER = `${HEADER_BASE} pr-2 text-left`;

const CELL_BASE = 'overflow-hidden text-ellipsis whitespace-nowrap pb-2 tabular-nums';
const NUM_CELL = `${CELL_BASE} pl-1.5 text-right`;

export default function AllTimeStandingsSummary({
  rows,
  slug,
  activeOwners,
  limit = 8,
}: Props): React.ReactElement {
  const visible = rows.slice(0, limit);

  return (
    <div className="@container">
      <SectionHead
        title="All-time standings"
        delegationHref={`/league/${slug}/history/stats`}
        delegationLabel="Full standings →"
      />
      {visible.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-zinc-400">No standings yet.</p>
      ) : (
        <table className="w-full table-fixed border-collapse">
          <colgroup>
            <col className="w-[24px]" />
            <col />
            <col className="w-[72px]" />
            <col className="w-[50px] @max-[280px]:hidden" />
            <col className="w-[60px] @max-[340px]:hidden" />
            <col className="w-[58px] @max-[400px]:hidden" />
            <col className="w-[36px] @max-[440px]:hidden" />
            <col className="w-[44px] @max-[500px]:hidden" />
            <col className="w-[40px] @max-[560px]:hidden" />
          </colgroup>
          <thead>
            <tr className="border-b border-gray-200 dark:border-zinc-700">
              <th className={`${TEXT_HEADER}`} aria-label="Rank" />
              <th className={TEXT_HEADER}>Owner</th>
              <th className={NUM_HEADER}>Record</th>
              <th className={`${NUM_HEADER} @max-[280px]:hidden`}>Win%</th>
              <th className={`${NUM_HEADER} @max-[340px]:hidden`}>Pts</th>
              <th className={`${NUM_HEADER} @max-[400px]:hidden`}>Diff</th>
              <th className={`${NUM_HEADER} @max-[440px]:hidden`}>Titles</th>
              <th className={`${NUM_HEADER} @max-[500px]:hidden`}>Seasons</th>
              <th className={`${NUM_HEADER} @max-[560px]:hidden`}>Avg</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row, idx) => {
              const isFormer = !activeOwners.has(row.owner);
              const hasTitles = row.championships > 0;
              const topPad = idx === 0 ? 'pt-3' : 'pt-2';
              return (
                <tr key={row.owner}>
                  <td className={`${CELL_BASE} ${topPad} pr-2 text-gray-400 dark:text-zinc-500`}>
                    {idx + 1}
                  </td>
                  <td className={`${CELL_BASE} ${topPad} pr-2`}>
                    <span className="inline-flex items-baseline gap-1.5 font-medium text-gray-900 dark:text-zinc-100">
                      <Link href={ownerHref(slug, row.owner)} className="hover:underline">
                        {row.owner}
                      </Link>
                      {isFormer && <FormerOwnerBadge />}
                    </span>
                  </td>
                  <td className={`${NUM_CELL} ${topPad} text-gray-700 dark:text-zinc-300`}>
                    {row.totalWins}–{row.totalLosses}
                  </td>
                  <td
                    className={`${NUM_CELL} ${topPad} text-gray-700 @max-[280px]:hidden dark:text-zinc-300`}
                  >
                    {formatPercent(row.winPct)}
                  </td>
                  <td
                    className={`${NUM_CELL} ${topPad} text-gray-700 @max-[340px]:hidden dark:text-zinc-300`}
                  >
                    {formatPoints(row.totalPoints)}
                  </td>
                  <td
                    className={`${NUM_CELL} ${topPad} text-gray-700 @max-[400px]:hidden dark:text-zinc-300`}
                  >
                    {formatSignedDiff(row.totalPointDifferential)}
                  </td>
                  <td
                    className={`${NUM_CELL} ${topPad} @max-[440px]:hidden ${
                      hasTitles
                        ? 'font-medium text-amber-600 dark:text-amber-400'
                        : 'text-gray-400 dark:text-zinc-500'
                    }`}
                  >
                    {hasTitles ? row.championships : '—'}
                  </td>
                  <td
                    className={`${NUM_CELL} ${topPad} text-gray-700 @max-[500px]:hidden dark:text-zinc-300`}
                  >
                    {row.seasonsPlayed}
                  </td>
                  <td
                    className={`${NUM_CELL} ${topPad} text-gray-700 @max-[560px]:hidden dark:text-zinc-300`}
                  >
                    {formatAvgFinish(row.avgFinish)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

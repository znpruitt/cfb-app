import React from 'react';
import Link from 'next/link';
import type { RecentFinish, StandingRowWithRecentFinishes } from '@/lib/selectors/historyOverview';
import SectionHead from './SectionHead';
import FormerOwnerBadge from '../FormerOwnerBadge';

/*
 * Responsive column degradation (per DESIGN.md `## Responsive column degradation`):
 * The standings dashboard summary degrades column-by-column as its container
 * narrows. Table is `table-auto` (default) — column widths are content-driven,
 * not fixed; cells do not truncate. The container queries below hide columns
 * by priority order as the standings @container shrinks.
 *
 * Existing 9-column priority order (always-show → drop-last):
 *   1. rank, owner, record       (always-show)
 *   2. avg-finish                (drop first, hidden ≤ 560px container)
 *   3. seasons                   (drop next,  hidden ≤ 500px container)
 *   4. titles                    (drop next,  hidden ≤ 440px container)
 *   5. diff                      (drop next,  hidden ≤ 400px container)
 *   6. pts                       (drop next,  hidden ≤ 340px container)
 *   7. win%                      (drop last,  hidden ≤ 280px container)
 *
 * Recent-finish trend cells (added in P7-...-STANDINGS-TREND-COLUMN-v1) drop
 * oldest-first as the @container narrows. Thresholds are indexed by
 * position-from-newest (0 = newest, drops last):
 *   0 (newest): hidden ≤ 560px
 *   1:          hidden ≤ 640px
 *   2:          hidden ≤ 720px
 *   3:          hidden ≤ 800px
 *   4 (oldest): hidden ≤ 880px
 * The "Recent Finish" group header hides at the same threshold as the newest
 * trend cell — the column disappears as a unit only when the last cell drops.
 */

type Props = {
  rows: StandingRowWithRecentFinishes[];
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
const NUM_HEADER = `${HEADER_BASE} pl-5 text-right`;
const TEXT_HEADER = `${HEADER_BASE} pr-3 text-left`;

const CELL_BASE = 'pb-2 tabular-nums';
const NUM_CELL = `${CELL_BASE} pl-5 text-right`;

const TREND_GROUP_HEADER = `${HEADER_BASE} px-1.5 text-center`;
const TREND_YEAR_SUB_HEADER =
  'pt-0.5 pb-2 px-1.5 text-center text-[9px] font-semibold uppercase tracking-[0.1em] text-gray-400 opacity-70 dark:text-zinc-500';
const TREND_CELL = 'pb-2 px-1.5 text-center';

// Static class strings keyed by position-from-newest (Tailwind JIT cannot
// detect dynamically-built `@max-[Xpx]:hidden` classes — see DESIGN.md).
const TREND_HIDE_BY_POSITION_FROM_NEWEST = [
  '@max-[560px]:hidden',
  '@max-[640px]:hidden',
  '@max-[720px]:hidden',
  '@max-[800px]:hidden',
  '@max-[880px]:hidden',
] as const;

function trendHideClass(positionFromNewest: number): string {
  return TREND_HIDE_BY_POSITION_FROM_NEWEST[positionFromNewest] ?? '';
}

type ChipTier = 'gold' | 'silver' | 'bronze' | 'default' | 'bottom';

function chipTier(rank: number): ChipTier {
  if (rank === 1) return 'gold';
  if (rank === 2) return 'silver';
  if (rank === 3) return 'bronze';
  if (rank >= 8) return 'bottom';
  return 'default';
}

const CHIP_BASE =
  'inline-block min-w-[22px] rounded-[3px] border bg-transparent px-[5px] py-px text-center text-[11px] font-medium tabular-nums';

const CHIP_TIER_CLASSES: Record<ChipTier, string> = {
  gold: 'border-yellow-500 text-yellow-600 font-semibold dark:border-amber-300 dark:text-amber-300',
  silver: 'border-slate-500 text-slate-600 dark:border-slate-300 dark:text-slate-200',
  bronze: 'border-orange-900 text-orange-900 dark:border-[#d4915c] dark:text-[#d4915c]',
  default: 'border-black/10 text-gray-500 dark:border-white/[0.08] dark:text-zinc-400',
  bottom: 'border-transparent text-gray-400 dark:text-zinc-500',
};

function FinishChip({ finish }: { finish: RecentFinish }): React.ReactElement {
  if (finish.rank === null) {
    return (
      <span
        className="text-[12px] text-gray-400 opacity-40 dark:text-zinc-500"
        aria-label="Did not play"
      >
        —
      </span>
    );
  }
  const tier = chipTier(finish.rank);
  return <span className={`${CHIP_BASE} ${CHIP_TIER_CLASSES[tier]}`}>{finish.rank}</span>;
}

export default function AllTimeStandingsSummary({
  rows,
  slug,
  activeOwners,
  limit = 8,
}: Props): React.ReactElement {
  const visible = rows.slice(0, limit);
  const trendWindow = visible[0]?.recentFinishes ?? [];
  const trendCount = trendWindow.length;
  const hasTrend = trendCount > 0;

  return (
    <div className="@container">
      <SectionHead
        title="All-time standings"
        delegationHref={`/league/${slug}/history/stats#career_points`}
        delegationLabel="Full standings →"
      />
      {visible.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-zinc-400">No standings yet.</p>
      ) : (
        <table className="border-collapse">
          <thead>
            <tr className={hasTrend ? '' : 'border-b border-gray-200 dark:border-zinc-700'}>
              <th className={`${TEXT_HEADER}`} aria-label="Rank" />
              <th className={TEXT_HEADER}>Owner</th>
              <th className={NUM_HEADER}>Record</th>
              <th className={`${NUM_HEADER} @max-[280px]:hidden`}>Win%</th>
              <th className={`${NUM_HEADER} @max-[340px]:hidden`}>Pts</th>
              <th className={`${NUM_HEADER} @max-[400px]:hidden`}>Diff</th>
              <th className={`${NUM_HEADER} @max-[440px]:hidden`}>Titles</th>
              <th className={`${NUM_HEADER} @max-[500px]:hidden`}>Seasons</th>
              <th className={`${NUM_HEADER} @max-[560px]:hidden`}>Avg</th>
              {hasTrend && (
                <th colSpan={trendCount} className={`${TREND_GROUP_HEADER} @max-[560px]:hidden`}>
                  Recent Finish
                </th>
              )}
            </tr>
            {hasTrend && (
              <tr className="border-b border-gray-200 dark:border-zinc-700">
                <th colSpan={9} aria-hidden="true" />
                {trendWindow.map((finish, idx) => {
                  const positionFromNewest = trendCount - 1 - idx;
                  return (
                    <th
                      key={finish.year}
                      className={`${TREND_YEAR_SUB_HEADER} ${trendHideClass(positionFromNewest)}`}
                    >
                      &apos;{String(finish.year).slice(-2)}
                    </th>
                  );
                })}
              </tr>
            )}
          </thead>
          <tbody>
            {visible.map((row, idx) => {
              const isFormer = !activeOwners.has(row.owner);
              const hasTitles = row.championships > 0;
              const topPad = idx === 0 ? 'pt-3' : 'pt-2';
              return (
                <tr key={row.owner}>
                  <td className={`${CELL_BASE} ${topPad} pr-3 text-gray-400 dark:text-zinc-500`}>
                    {idx + 1}
                  </td>
                  <td className={`${CELL_BASE} ${topPad} pr-3`}>
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
                  {row.recentFinishes.map((finish, finishIdx) => {
                    const positionFromNewest = trendCount - 1 - finishIdx;
                    return (
                      <td
                        key={finish.year}
                        className={`${TREND_CELL} ${topPad} ${trendHideClass(positionFromNewest)}`}
                      >
                        <FinishChip finish={finish} />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

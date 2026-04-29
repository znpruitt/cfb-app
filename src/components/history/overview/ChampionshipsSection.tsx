import React from 'react';
import Link from 'next/link';
import type {
  ChampionshipRowWithContext,
  ChampionshipSummaryStats,
} from '@/lib/selectors/historyOverview';
import FormerOwnerBadge from '../FormerOwnerBadge';

type Props = {
  rows: ChampionshipRowWithContext[];
  summary: ChampionshipSummaryStats;
  slug: string;
  activeOwners: Set<string>;
};

function ownerHref(slug: string, owner: string): string {
  return `/league/${slug}/history/owner/${encodeURIComponent(owner)}`;
}

function formatPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export default function ChampionshipsSection({
  rows,
  summary,
  slug,
  activeOwners,
}: Props): React.ReactElement {
  return (
    <section>
      <div className="mb-5 flex items-baseline justify-between gap-4">
        <h2 className="text-[15px] font-medium text-gray-900 dark:text-zinc-100">Championships</h2>
        <p className="text-[13px] text-gray-500 dark:text-zinc-400">
          {summary.championCount > 0 ? (
            <>
              <strong className="font-medium text-gray-900 dark:text-zinc-100">
                {summary.championCount} champion{summary.championCount === 1 ? '' : 's'}
              </strong>{' '}
              across{' '}
              <strong className="font-medium text-gray-900 dark:text-zinc-100">
                {summary.seasonCount} season{summary.seasonCount === 1 ? '' : 's'}
              </strong>
              {summary.stillChasingCount > 0 && (
                <>
                  {' · '}
                  {summary.stillChasingCount} still chasing
                </>
              )}
            </>
          ) : (
            'No champions yet'
          )}
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-zinc-400">
          No champions yet — the league has not completed a season.
        </p>
      ) : (
        <ul className="space-y-4">
          {rows.map((row) => {
            const isFormer = !activeOwners.has(row.owner);
            return (
              <li key={row.owner} className="space-y-0.5">
                {/* Line 1 */}
                <div className="flex items-baseline gap-5 text-sm tabular-nums">
                  <span className="flex items-baseline gap-1.5 font-medium text-gray-900 dark:text-zinc-100">
                    <Link href={ownerHref(slug, row.owner)} className="hover:underline">
                      {row.owner}
                    </Link>
                    {isFormer && <FormerOwnerBadge />}
                  </span>
                  <span className="text-amber-600 dark:text-amber-400">
                    {row.titleCount} title{row.titleCount === 1 ? '' : 's'}
                  </span>
                  <span className="text-amber-600 dark:text-amber-400">{row.years.join(', ')}</span>
                  {row.isReigning && (
                    <span className="ml-auto text-[10px] font-semibold uppercase tracking-[0.1em] text-amber-600 dark:text-amber-400">
                      Reigning
                    </span>
                  )}
                </div>
                {/* Line 2 */}
                <div className="text-xs text-gray-500 dark:text-zinc-400">
                  {row.seasonsPlayed} season{row.seasonsPlayed === 1 ? '' : 's'} played ·{' '}
                  {formatPct(row.careerWinPct)} career win%
                  {row.editorialTag !== null && (
                    <>
                      {' · '}
                      <span className="font-medium text-gray-700 dark:text-zinc-300">
                        {row.editorialTag}
                      </span>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

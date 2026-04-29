import React from 'react';
import Link from 'next/link';
import type {
  ChampionshipOwnerRow,
  ChampionshipSummaryStats,
} from '@/lib/selectors/historyOverview';
import FormerOwnerBadge from '../FormerOwnerBadge';

type Props = {
  rows: ChampionshipOwnerRow[];
  summary: ChampionshipSummaryStats;
  slug: string;
  activeOwners: Set<string>;
};

function ownerHref(slug: string, owner: string): string {
  return `/league/${slug}/history/owner/${encodeURIComponent(owner)}`;
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
        <div className="grid gap-2">
          {rows.map((row) => {
            const isFormer = !activeOwners.has(row.owner);
            return (
              <div
                key={row.owner}
                className="flex items-baseline gap-5 py-1.5 text-sm tabular-nums"
              >
                <span className="flex w-[140px] shrink-0 items-baseline gap-1.5 font-medium text-gray-900 dark:text-zinc-100">
                  <Link href={ownerHref(slug, row.owner)} className="hover:underline">
                    {row.owner}
                  </Link>
                  {isFormer && <FormerOwnerBadge />}
                </span>
                <span className="w-[68px] shrink-0 text-amber-600 dark:text-amber-400">
                  {row.titleCount} title{row.titleCount === 1 ? '' : 's'}
                </span>
                <span className="text-amber-600 dark:text-amber-400">{row.years.join(', ')}</span>
                {row.isReigning && (
                  <span className="ml-auto text-[10px] font-semibold uppercase tracking-[0.1em] text-amber-600 dark:text-amber-400">
                    Reigning
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

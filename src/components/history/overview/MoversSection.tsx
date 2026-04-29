import React from 'react';
import Link from 'next/link';
import type { MostImprovedEntry } from '@/lib/selectors/historySelectors';
import type { MoversBuckets } from '@/lib/selectors/historyOverview';
import SectionHead from './SectionHead';

type Props = {
  buckets: MoversBuckets;
  slug: string;
};

function ownerHref(slug: string, owner: string): string {
  return `/league/${slug}/history/owner/${encodeURIComponent(owner)}`;
}

function MoverList({
  entries,
  variant,
  slug,
}: {
  entries: MostImprovedEntry[];
  variant: 'climb' | 'drop';
  slug: string;
}): React.ReactElement {
  const label = variant === 'climb' ? 'Biggest climbs' : 'Biggest drops';

  return (
    <div>
      <p className="mb-5 text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-400 dark:text-zinc-500">
        {label}
      </p>
      {entries.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-zinc-400">
          {variant === 'climb' ? 'No notable climbs.' : 'No notable drops.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {entries.map((entry) => {
            const sign = entry.improvement > 0 ? '+' : '−';
            const magnitude = Math.abs(entry.improvement);
            const deltaClass =
              variant === 'climb'
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-rose-600 dark:text-rose-400';
            return (
              <li
                key={`${entry.owner}-${entry.fromYear}-${entry.toYear}`}
                className="flex items-baseline gap-3.5 py-1.5 text-sm tabular-nums"
              >
                <span className="w-[90px] shrink-0 font-medium text-gray-900 dark:text-zinc-100">
                  <Link href={ownerHref(slug, entry.owner)} className="hover:underline">
                    {entry.owner}
                  </Link>
                </span>
                <span className="text-xs text-gray-400 dark:text-zinc-500">
                  {entry.fromYear}→{entry.toYear}
                </span>
                <span className="text-[13px] text-gray-600 dark:text-zinc-400">
                  #{entry.fromFinish} → #{entry.toFinish}
                </span>
                <span className={`ml-auto text-[13px] font-medium ${deltaClass}`}>
                  {sign}
                  {magnitude}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function MoversSection({ buckets, slug }: Props): React.ReactElement {
  return (
    <section>
      <SectionHead
        title="Season-over-season movement"
        delegationHref={`/league/${slug}/history/stats`}
        delegationLabel="Full mover history →"
      />
      <div className="grid grid-cols-1 gap-x-14 gap-y-8 md:grid-cols-2">
        <MoverList entries={buckets.climbs} variant="climb" slug={slug} />
        <MoverList entries={buckets.drops} variant="drop" slug={slug} />
      </div>
    </section>
  );
}

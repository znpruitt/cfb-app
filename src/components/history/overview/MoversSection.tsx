import React from 'react';
import Link from 'next/link';
import type {
  MoverRowWithContext,
  MoversBucketsWithContext,
} from '@/lib/selectors/historyOverview';
import SectionHead from './SectionHead';

type Props = {
  buckets: MoversBucketsWithContext;
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
  entries: MoverRowWithContext[];
  variant: 'climb' | 'drop';
  slug: string;
}): React.ReactElement {
  const label = variant === 'climb' ? 'Biggest climbs' : 'Biggest drops';
  const deltaClass =
    variant === 'climb'
      ? 'text-emerald-600 dark:text-emerald-400'
      : 'text-rose-600 dark:text-rose-400';

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
        <ul className="space-y-4">
          {entries.map((entry) => {
            const sign = entry.improvement > 0 ? '+' : '−';
            const magnitude = Math.abs(entry.improvement);
            return (
              <li key={`${entry.owner}-${entry.fromYear}-${entry.toYear}`} className="space-y-0.5">
                {/* Line 1 */}
                <div className="flex items-baseline gap-3.5 text-sm tabular-nums">
                  <span className="font-medium text-gray-900 dark:text-zinc-100">
                    <Link href={ownerHref(slug, entry.owner)} className="hover:underline">
                      {entry.owner}
                    </Link>
                  </span>
                  <span className={`ml-auto font-medium ${deltaClass}`}>
                    {sign}
                    {magnitude}
                  </span>
                </div>
                {/* Line 2 */}
                <div className="text-xs text-gray-500 tabular-nums dark:text-zinc-400">
                  {entry.fromYear} → {entry.toYear} · finished #{entry.fromFinish}, then #
                  {entry.toFinish}
                  {entry.wonTitle && (
                    <span className="text-amber-600 dark:text-amber-400">{' (won title)'}</span>
                  )}
                </div>
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

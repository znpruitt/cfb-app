import React from 'react';
import Link from 'next/link';
import type { SeasonArchiveItem } from '@/lib/selectors/historyOverview';
import SectionHead from './SectionHead';

type Props = {
  items: SeasonArchiveItem[];
  slug: string;
};

export default function SeasonArchiveStrip({ items, slug }: Props): React.ReactElement {
  return (
    <section>
      <SectionHead
        title="Season archive"
        delegationHref={`/league/${slug}/history/archive`}
        delegationLabel="All seasons →"
      />
      {items.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-zinc-400">No archived seasons yet.</p>
      ) : (
        <div className="flex flex-wrap gap-x-8 gap-y-6">
          {items.map((item) => (
            <Link
              key={item.year}
              href={`/league/${slug}/history/${item.year}`}
              className="group block"
            >
              <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-gray-400 tabular-nums dark:text-zinc-500">
                {item.year}
              </p>
              <p className="text-sm font-medium text-amber-600 group-hover:underline dark:text-amber-400">
                {item.champion === 'Unknown' ? '—' : item.champion}
              </p>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

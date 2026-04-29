import React from 'react';
import Link from 'next/link';
import type { ChampionshipEntry } from '@/lib/selectors/historySelectors';
import FormerOwnerBadge from './FormerOwnerBadge';

type Props = {
  championships: ChampionshipEntry[];
  slug: string;
  activeOwners: Set<string>;
};

export default function TitleTimeline({
  championships,
  slug,
  activeOwners,
}: Props): React.ReactElement {
  if (championships.length === 0) {
    return (
      <section className="space-y-3">
        <h2 className="text-[15px] font-medium text-gray-900 dark:text-zinc-100">Title Timeline</h2>
        <p className="text-sm text-gray-500 dark:text-zinc-400">No champions yet.</p>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <h2 className="text-[15px] font-medium text-gray-900 dark:text-zinc-100">Title Timeline</h2>
      <ol className="space-y-1.5">
        {championships.map((entry) => {
          const isFormer = entry.champion !== 'Unknown' && !activeOwners.has(entry.champion);
          return (
            <li key={entry.year} className="flex items-baseline gap-4 text-sm">
              <span className="w-12 shrink-0 tabular-nums text-gray-400 dark:text-zinc-500">
                {entry.year}
              </span>
              {entry.champion === 'Unknown' ? (
                <span className="text-gray-400 dark:text-zinc-500">Unknown</span>
              ) : (
                <Link
                  href={`/league/${slug}/history/owner/${encodeURIComponent(entry.champion)}`}
                  className="font-medium text-gray-900 hover:underline dark:text-zinc-100"
                >
                  {entry.champion}
                </Link>
              )}
              {isFormer && <FormerOwnerBadge />}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

import React from 'react';
import Link from 'next/link';
import type { PodiumBlock } from '@/lib/selectors/historyOverview';
import SectionHead from './SectionHead';

type Props = {
  blocks: PodiumBlock[];
  slug: string;
};

function ownerHref(slug: string, owner: string): string {
  return `/league/${slug}/history/owner/${encodeURIComponent(owner)}`;
}

function nameClass(place: 1 | 2 | 3): string {
  if (place === 1) return 'font-medium text-gray-900 dark:text-zinc-100';
  if (place === 2) return 'text-gray-600 dark:text-zinc-300';
  return 'text-gray-400 dark:text-zinc-500';
}

function metaClass(place: 1 | 2 | 3): string {
  if (place === 1) return 'text-gray-500 dark:text-zinc-400';
  return 'text-gray-400 dark:text-zinc-500';
}

function placeClass(place: 1 | 2 | 3): string {
  if (place === 1) return 'text-amber-600 dark:text-amber-400';
  return 'text-gray-400 dark:text-zinc-500';
}

export default function RecentPodiumsColumn({ blocks, slug }: Props): React.ReactElement {
  return (
    <div>
      <SectionHead
        title="Recent podiums"
        delegationHref={`/league/${slug}/history/stats`}
        delegationLabel="Full history →"
      />
      {blocks.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-zinc-400">No completed seasons yet.</p>
      ) : (
        <div className="space-y-5">
          {blocks.map((block) => (
            <div key={block.year}>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400 dark:text-zinc-500">
                {block.year} season
              </p>
              {block.slots.length === 0 ? (
                <p className="text-sm text-gray-400 dark:text-zinc-500">No standings recorded.</p>
              ) : (
                <ol className="space-y-0.5">
                  {block.slots.map((slot) => (
                    <li
                      key={slot.place}
                      className="grid grid-cols-[18px_1fr_auto] items-baseline gap-2.5 py-0.5 text-sm tabular-nums"
                    >
                      <span className={`text-[11px] font-semibold ${placeClass(slot.place)}`}>
                        {slot.place}
                      </span>
                      <span className={nameClass(slot.place)}>
                        <Link href={ownerHref(slug, slot.owner)} className="hover:underline">
                          {slot.owner}
                        </Link>
                      </span>
                      <span className={`text-[11px] ${metaClass(slot.place)}`}>
                        {slot.place === 1 ? `${slot.wins} W` : `${slot.gamesBack} GB`}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

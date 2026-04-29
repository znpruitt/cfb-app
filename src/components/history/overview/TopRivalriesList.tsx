import React from 'react';
import Link from 'next/link';
import type { AllTimeHeadToHeadEntry } from '@/lib/selectors/historySelectors';
import SectionHead from './SectionHead';
import FormerOwnerBadge from '../FormerOwnerBadge';

type Props = {
  rivalries: AllTimeHeadToHeadEntry[];
  slug: string;
  activeOwners: Set<string>;
};

function ownerHref(slug: string, owner: string): string {
  return `/league/${slug}/history/owner/${encodeURIComponent(owner)}`;
}

export default function TopRivalriesList({
  rivalries,
  slug,
  activeOwners,
}: Props): React.ReactElement {
  return (
    <div>
      <SectionHead
        title="Top rivalries"
        delegationHref={`/league/${slug}/history/rivalries`}
        delegationLabel="All matchups →"
      />
      {rivalries.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-zinc-400">No rivalries yet.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {rivalries.map((entry) => {
            const aFormer = !activeOwners.has(entry.ownerA);
            const bFormer = !activeOwners.has(entry.ownerB);
            const totalGames = entry.wins + entry.losses;
            return (
              <li
                key={`${entry.ownerA}::${entry.ownerB}`}
                className="flex items-baseline gap-4 py-2 text-sm"
              >
                <span className="flex flex-wrap items-baseline gap-1.5">
                  <Link
                    href={ownerHref(slug, entry.ownerA)}
                    className="text-gray-900 hover:underline dark:text-zinc-100"
                  >
                    {entry.ownerA}
                  </Link>
                  {aFormer && <FormerOwnerBadge />}
                  <span className="text-gray-400 dark:text-zinc-500">vs</span>
                  <Link
                    href={ownerHref(slug, entry.ownerB)}
                    className="text-gray-900 hover:underline dark:text-zinc-100"
                  >
                    {entry.ownerB}
                  </Link>
                  {bFormer && <FormerOwnerBadge />}
                </span>
                <span className="ml-auto font-medium text-gray-900 tabular-nums dark:text-zinc-100">
                  {entry.wins}–{entry.losses}
                </span>
                <span className="text-xs text-gray-500 tabular-nums dark:text-zinc-400">
                  {totalGames} game{totalGames === 1 ? '' : 's'} · {entry.seasons} season
                  {entry.seasons === 1 ? '' : 's'}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

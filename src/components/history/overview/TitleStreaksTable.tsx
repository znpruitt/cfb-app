import React from 'react';
import Link from 'next/link';
import type { TitleStreakRow } from '@/lib/selectors/historyOverview';
import SectionHead from './SectionHead';

type Props = {
  streaks: TitleStreakRow[];
  slug: string;
};

function ownerHref(slug: string, owner: string): string {
  return `/league/${slug}/history/owner/${encodeURIComponent(owner)}`;
}

export default function TitleStreaksTable({ streaks, slug }: Props): React.ReactElement {
  return (
    <div>
      <SectionHead
        title="Title streaks"
        delegationHref={`/league/${slug}/history/stats`}
        delegationLabel="Full streak history →"
      />
      {streaks.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-zinc-400">No title streaks yet.</p>
      ) : (
        <table className="w-full table-fixed border-collapse">
          <colgroup>
            <col />
            <col className="w-[100px]" />
            <col className="w-[110px]" />
          </colgroup>
          <thead>
            <tr className="border-b border-gray-200 dark:border-zinc-700">
              <th className="pb-2 pr-2 text-left text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-400 dark:text-zinc-500">
                Owner
              </th>
              <th className="pb-2 pl-2 text-right text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-400 dark:text-zinc-500">
                Streak
              </th>
              <th className="pb-2 pl-2 text-right text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-400 dark:text-zinc-500">
                Years
              </th>
            </tr>
          </thead>
          <tbody>
            {streaks.map((row, idx) => (
              <tr key={row.owner}>
                <td
                  className={`overflow-hidden text-ellipsis whitespace-nowrap pr-2 font-medium text-gray-900 dark:text-zinc-100 ${idx === 0 ? 'pt-3' : 'pt-2'} pb-2`}
                >
                  <Link href={ownerHref(slug, row.owner)} className="hover:underline">
                    {row.owner}
                  </Link>
                </td>
                <td
                  className={`overflow-hidden text-ellipsis whitespace-nowrap pl-2 text-right font-medium text-amber-600 tabular-nums dark:text-amber-400 ${idx === 0 ? 'pt-3' : 'pt-2'} pb-2`}
                >
                  {row.streak} in a row
                </td>
                <td
                  className={`overflow-hidden text-ellipsis whitespace-nowrap pl-2 text-right text-gray-600 tabular-nums dark:text-zinc-400 ${idx === 0 ? 'pt-3' : 'pt-2'} pb-2`}
                >
                  {row.years.join(', ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

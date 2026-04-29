import React from 'react';
import Link from 'next/link';
import type { AllTimeStandingRow } from '@/lib/selectors/historySelectors';
import SectionHead from './SectionHead';
import FormerOwnerBadge from '../FormerOwnerBadge';

type Props = {
  rows: AllTimeStandingRow[];
  slug: string;
  activeOwners: Set<string>;
  limit?: number;
};

function formatPercent(winPct: number): string {
  return `${(winPct * 100).toFixed(1)}%`;
}

function ownerHref(slug: string, owner: string): string {
  return `/league/${slug}/history/owner/${encodeURIComponent(owner)}`;
}

export default function AllTimeStandingsSummary({
  rows,
  slug,
  activeOwners,
  limit = 8,
}: Props): React.ReactElement {
  const visible = rows.slice(0, limit);

  return (
    <div>
      <SectionHead
        title="All-time standings"
        delegationHref={`/league/${slug}/history/stats`}
        delegationLabel="Full standings →"
      />
      {visible.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-zinc-400">No standings yet.</p>
      ) : (
        <table className="w-full table-fixed border-collapse">
          <colgroup>
            <col className="w-[24px]" />
            <col />
            <col className="w-[78px]" />
            <col className="w-[56px]" />
            <col className="w-[44px]" />
          </colgroup>
          <thead>
            <tr className="border-b border-gray-200 dark:border-zinc-700">
              <th className="pb-2 pr-2 text-left text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-400 dark:text-zinc-500"></th>
              <th className="pb-2 pr-2 text-left text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-400 dark:text-zinc-500">
                Owner
              </th>
              <th className="pb-2 pl-2 text-right text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-400 dark:text-zinc-500">
                Record
              </th>
              <th className="pb-2 pl-2 text-right text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-400 dark:text-zinc-500">
                Win%
              </th>
              <th className="pb-2 pl-2 text-right text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-400 dark:text-zinc-500">
                Titles
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row, idx) => {
              const isFormer = !activeOwners.has(row.owner);
              const hasTitles = row.championships > 0;
              return (
                <tr key={row.owner}>
                  <td
                    className={`overflow-hidden text-ellipsis whitespace-nowrap pr-2 text-gray-400 tabular-nums dark:text-zinc-500 ${idx === 0 ? 'pt-3' : 'pt-2'} pb-2`}
                  >
                    {idx + 1}
                  </td>
                  <td
                    className={`overflow-hidden text-ellipsis whitespace-nowrap pr-2 ${idx === 0 ? 'pt-3' : 'pt-2'} pb-2`}
                  >
                    <span className="inline-flex items-baseline gap-1.5 font-medium text-gray-900 dark:text-zinc-100">
                      <Link href={ownerHref(slug, row.owner)} className="hover:underline">
                        {row.owner}
                      </Link>
                      {isFormer && <FormerOwnerBadge />}
                    </span>
                  </td>
                  <td
                    className={`overflow-hidden text-ellipsis whitespace-nowrap pl-2 text-right tabular-nums text-gray-700 dark:text-zinc-300 ${idx === 0 ? 'pt-3' : 'pt-2'} pb-2`}
                  >
                    {row.totalWins}–{row.totalLosses}
                  </td>
                  <td
                    className={`overflow-hidden text-ellipsis whitespace-nowrap pl-2 text-right tabular-nums text-gray-700 dark:text-zinc-300 ${idx === 0 ? 'pt-3' : 'pt-2'} pb-2`}
                  >
                    {formatPercent(row.winPct)}
                  </td>
                  <td
                    className={`overflow-hidden text-ellipsis whitespace-nowrap pl-2 text-right tabular-nums ${idx === 0 ? 'pt-3' : 'pt-2'} pb-2 ${
                      hasTitles
                        ? 'font-medium text-amber-600 dark:text-amber-400'
                        : 'text-gray-400 dark:text-zinc-500'
                    }`}
                  >
                    {hasTitles ? row.championships : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

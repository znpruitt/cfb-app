import React from 'react';
import Link from 'next/link';
import type {
  StreaksOrDroughts,
  TitleDroughtRowWithContext,
  TitleStreakRow,
} from '@/lib/selectors/historyOverview';
import SectionHead from './SectionHead';

type Props = {
  data: StreaksOrDroughts;
  /** Enriched droughts; required when data.mode is 'droughts'. */
  droughtsWithContext?: TitleDroughtRowWithContext[];
  slug: string;
};

function ownerHref(slug: string, owner: string): string {
  return `/league/${slug}/history/owner/${encodeURIComponent(owner)}`;
}

function StreaksTable({
  rows,
  slug,
}: {
  rows: TitleStreakRow[];
  slug: string;
}): React.ReactElement {
  // Streaks mode is rendered as a compact data-table per spec; line-2
  // enrichment for streaks is deferred (see Section 6 of the prompt).
  return (
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
        {rows.map((row, idx) => (
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
  );
}

function DroughtsList({
  rows,
  slug,
}: {
  rows: TitleDroughtRowWithContext[];
  slug: string;
}): React.ReactElement {
  return (
    <ul className="space-y-4">
      {rows.map((row) => (
        <li key={row.owner} className="space-y-0.5">
          {/* Line 1 */}
          <div className="flex items-baseline gap-4 text-sm">
            <span className="font-medium text-gray-900 dark:text-zinc-100">
              <Link href={ownerHref(slug, row.owner)} className="hover:underline">
                {row.owner}
              </Link>
            </span>
            <span className="ml-auto font-medium text-amber-600 tabular-nums dark:text-amber-400">
              {row.drought} season{row.drought === 1 ? '' : 's'}
            </span>
          </div>
          {/* Line 2 */}
          <div className="text-xs text-gray-500 tabular-nums dark:text-zinc-400">
            {row.top3Count} top-3 finish{row.top3Count === 1 ? '' : 'es'}
            {row.bestRank !== null && row.bestRankYear !== null && (
              <>
                {' · best #'}
                {row.bestRank} ({row.bestRankYear})
              </>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function TitleStreaksTable({
  data,
  droughtsWithContext,
  slug,
}: Props): React.ReactElement {
  const isStreaks = data.mode === 'streaks';
  const title = isStreaks ? 'Title streaks' : 'Title droughts';
  const isEmpty = data.rows.length === 0;

  return (
    <div>
      <SectionHead
        title={title}
        delegationHref={`/league/${slug}/history/stats#${isStreaks ? 'career_dynasty' : 'career_drought'}`}
        delegationLabel={isStreaks ? 'Full streak history →' : 'Full drought history →'}
      />
      {isEmpty ? (
        <p className="text-sm text-gray-500 dark:text-zinc-400">
          {isStreaks ? 'No title streaks yet.' : 'No title droughts yet.'}
        </p>
      ) : data.mode === 'streaks' ? (
        <StreaksTable rows={data.rows} slug={slug} />
      ) : (
        <DroughtsList rows={droughtsWithContext ?? []} slug={slug} />
      )}
    </div>
  );
}

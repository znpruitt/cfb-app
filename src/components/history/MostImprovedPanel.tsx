import React from 'react';
import Link from 'next/link';
import type { MostImprovedEntry } from '@/lib/selectors/historySelectors';

type Props = {
  entries: MostImprovedEntry[];
  slug: string;
  limit?: number;
};

export default function MostImprovedPanel({ entries, slug, limit = 5 }: Props): React.ReactElement {
  const topGainers = entries.filter((e) => e.improvement > 0).slice(0, limit);
  const topDecliners = entries
    .filter((e) => e.improvement < 0)
    .slice(-limit)
    .reverse();

  return (
    <section className="space-y-3">
      <h2 className="text-[15px] font-medium text-gray-900 dark:text-zinc-100">Most Improved</h2>
      <div className="space-y-4">
        {topGainers.length > 0 && (
          <div>
            <p className="mb-1.5 text-[13px] font-medium text-gray-500 dark:text-zinc-500">
              Biggest climbs
            </p>
            <ul className="divide-y divide-gray-100 dark:divide-zinc-800">
              {topGainers.map((e) => (
                <li
                  key={`${e.owner}-${e.fromYear}-${e.toYear}`}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2 text-sm"
                >
                  <Link
                    href={`/league/${slug}/history/owner/${encodeURIComponent(e.owner)}/`}
                    className="font-semibold text-gray-900 hover:text-blue-600 hover:underline dark:text-zinc-50 dark:hover:text-blue-400"
                  >
                    {e.owner}
                  </Link>
                  <span className="text-xs text-gray-500 dark:text-zinc-400">
                    {e.fromYear}→{e.toYear}
                  </span>
                  <span className="tabular-nums text-gray-600 dark:text-zinc-300">
                    #{e.fromFinish} → #{e.toFinish}
                  </span>
                  <span className="font-semibold text-green-700 dark:text-green-400">
                    +{e.improvement} spot{e.improvement !== 1 ? 's' : ''}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {topDecliners.length > 0 && (
          <div>
            <p className="mb-1.5 text-[13px] font-medium text-gray-500 dark:text-zinc-500">
              Biggest drops
            </p>
            <ul className="divide-y divide-gray-100 dark:divide-zinc-800">
              {topDecliners.map((e) => (
                <li
                  key={`${e.owner}-${e.fromYear}-${e.toYear}`}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2 text-sm"
                >
                  <Link
                    href={`/league/${slug}/history/owner/${encodeURIComponent(e.owner)}/`}
                    className="font-semibold text-gray-900 hover:text-blue-600 hover:underline dark:text-zinc-50 dark:hover:text-blue-400"
                  >
                    {e.owner}
                  </Link>
                  <span className="text-xs text-gray-500 dark:text-zinc-400">
                    {e.fromYear}→{e.toYear}
                  </span>
                  <span className="tabular-nums text-gray-600 dark:text-zinc-300">
                    #{e.fromFinish} → #{e.toFinish}
                  </span>
                  <span className="font-semibold text-red-600 dark:text-red-400">
                    {e.improvement} spot{Math.abs(e.improvement) !== 1 ? 's' : ''}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {topGainers.length === 0 && topDecliners.length === 0 && (
          <p className="text-sm text-gray-500 dark:text-zinc-400">
            At least two seasons required to compute improvement.
          </p>
        )}
      </div>
    </section>
  );
}

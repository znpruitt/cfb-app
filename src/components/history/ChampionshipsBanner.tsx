import React from 'react';
import Link from 'next/link';
import type { ChampionshipEntry } from '@/lib/selectors/historySelectors';

type Props = {
  history: ChampionshipEntry[];
  slug: string;
  currentSeasonYear?: number;
  currentLeader?: string;
};

type OwnerChampInfo = {
  owner: string;
  count: number;
  years: number[];
};

function groupByOwner(history: ChampionshipEntry[]): OwnerChampInfo[] {
  const map = new Map<string, OwnerChampInfo>();
  for (const entry of history) {
    if (!map.has(entry.champion)) {
      map.set(entry.champion, { owner: entry.champion, count: 0, years: [] });
    }
    const info = map.get(entry.champion)!;
    info.count++;
    info.years.push(entry.year);
  }
  return Array.from(map.values()).sort(
    (a, b) => b.count - a.count || a.owner.localeCompare(b.owner)
  );
}

export default function ChampionshipsBanner({
  history,
  slug,
  currentSeasonYear,
  currentLeader,
}: Props): React.ReactElement {
  if (history.length === 0) {
    return (
      <section className="space-y-2">
        <h2 className="text-[15px] font-medium text-gray-900 dark:text-zinc-100">Championships</h2>
        <p className="text-sm text-gray-500 dark:text-zinc-400">No champions yet.</p>
      </section>
    );
  }

  const champions = groupByOwner(history);
  const latestChamp = history[history.length - 1];

  return (
    <section className="rounded-xl border border-amber-300 bg-amber-50 p-3 shadow-sm sm:p-4 dark:border-amber-700 dark:bg-amber-950/30">
      <h2 className="mb-3 text-[15px] font-medium text-amber-900 dark:text-amber-200">
        Championships
      </h2>

      {currentSeasonYear !== undefined && currentLeader !== undefined && (
        <div className="mb-3 rounded-lg border border-gray-300 bg-white/70 px-3 py-2.5 dark:border-zinc-600 dark:bg-zinc-800/60">
          <p className="text-[10px] font-medium uppercase tracking-widest text-gray-500 dark:text-zinc-400">
            {currentSeasonYear} Season — Current Leader
          </p>
          <p className="mt-0.5 text-base font-semibold text-gray-900 dark:text-zinc-100">
            <Link
              href={`/league/${slug}/history/owner/${encodeURIComponent(currentLeader)}/`}
              className="hover:underline"
            >
              {currentLeader}
            </Link>
          </p>
        </div>
      )}

      {latestChamp && (
        <div className="mb-4 rounded-lg bg-amber-100 px-3 py-2.5 dark:bg-amber-900/40">
          <p className="text-[10px] font-medium uppercase tracking-widest text-amber-700 dark:text-amber-400">
            Most Recent Champion ({latestChamp.year})
          </p>
          <p className="mt-0.5 text-base font-semibold text-amber-950 dark:text-amber-100">
            <Link
              href={`/league/${slug}/history/owner/${encodeURIComponent(latestChamp.champion)}/`}
              className="hover:underline"
            >
              {latestChamp.champion}
            </Link>
          </p>
        </div>
      )}

      <ul className="divide-y divide-amber-200 dark:divide-amber-800">
        {champions.map((c) => (
          <li
            key={c.owner}
            className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2 text-sm"
          >
            <Link
              href={`/league/${slug}/history/owner/${encodeURIComponent(c.owner)}/`}
              className="font-semibold text-amber-900 hover:underline dark:text-amber-100"
            >
              {c.owner}
            </Link>
            <span className="tabular-nums text-amber-700 dark:text-amber-400">
              {c.count} title{c.count !== 1 ? 's' : ''}
            </span>
            <span className="text-xs text-amber-600 dark:text-amber-500">{c.years.join(', ')}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

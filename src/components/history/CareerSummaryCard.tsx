import React from 'react';
import type { OwnerCareerResult } from '@/lib/selectors/historySelectors';

type Props = {
  career: OwnerCareerResult;
};

export default function CareerSummaryCard({ career }: Props): React.ReactElement {
  const winPct =
    career.totalWins + career.totalLosses > 0
      ? ((career.totalWins / (career.totalWins + career.totalLosses)) * 100).toFixed(1)
      : '—';

  return (
    <section className="rounded-xl border border-gray-300 bg-white p-3 shadow-sm sm:p-4 dark:border-zinc-700 dark:bg-zinc-900">
      <h2 className="mb-3 text-xl font-semibold tracking-tight text-gray-950 dark:text-zinc-50">
        Career Summary
      </h2>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-zinc-400">
            Record
          </dt>
          <dd className="mt-0.5 text-xl font-bold tabular-nums text-gray-950 dark:text-zinc-50">
            {career.totalWins}–{career.totalLosses}
          </dd>
          <dd className="text-xs text-gray-500 dark:text-zinc-400">{winPct}% win rate</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-zinc-400">
            Championships
          </dt>
          <dd className="mt-0.5 text-xl font-bold tabular-nums text-amber-700 dark:text-amber-400">
            {career.championships > 0 ? career.championships : '—'}
          </dd>
          {career.championships > 0 && (
            <dd className="text-xs text-amber-600 dark:text-amber-500">
              {career.seasonHistory
                .filter((s) => s.isChampion)
                .map((s) => s.year)
                .join(', ')}
            </dd>
          )}
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-zinc-400">
            Avg Finish
          </dt>
          <dd className="mt-0.5 text-xl font-bold tabular-nums text-gray-950 dark:text-zinc-50">
            #{career.avgFinish.toFixed(1)}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-zinc-400">
            Seasons
          </dt>
          <dd className="mt-0.5 text-xl font-bold tabular-nums text-gray-950 dark:text-zinc-50">
            {career.seasonsPlayed}
          </dd>
        </div>
      </dl>
    </section>
  );
}

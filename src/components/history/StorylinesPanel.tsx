import React from 'react';
import type { Insight } from '@/lib/selectors/insights';
import AllInsightsRow from '@/app/league/[slug]/insights/AllInsightsRow';

type Props = {
  insights: Insight[];
  slug: string;
  year: number;
};

export default function StorylinesPanel({ insights, slug, year }: Props): React.ReactElement {
  if (insights.length === 0) {
    return (
      <section className="space-y-3">
        <h2 className="text-[15px] font-medium text-gray-900 dark:text-zinc-100">Storylines</h2>
        <p className="text-sm text-gray-500 dark:text-zinc-400">
          No historical storylines available yet.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <h2 className="text-[15px] font-medium text-gray-900 dark:text-zinc-100">Storylines</h2>
      <div className="rounded-xl border border-gray-200 dark:border-zinc-700">
        {insights.map((insight) => (
          <AllInsightsRow key={insight.id} insight={insight} leagueSlug={slug} panelYear={year} />
        ))}
      </div>
    </section>
  );
}

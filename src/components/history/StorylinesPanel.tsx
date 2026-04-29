import React from 'react';
import type { Insight, InsightType } from '@/lib/selectors/insights';
import AllInsightsRow from '@/app/league/[slug]/insights/AllInsightsRow';

type Props = {
  insights: Insight[];
  slug: string;
  year: number;
};

export const MULTI_SEASON_INSIGHT_TYPES: ReadonlySet<InsightType> = new Set<InsightType>([
  'dynasty',
  'drought',
  'consistency',
  'volatility',
  'title_chaser',
  'never_last',
  'lopsided_rivalry',
  'dominance_streak',
  'improvement',
  'greatest_season',
]);

export const STORYLINES_LIMIT = 5;

export function selectMultiSeasonStorylines(
  insights: Insight[],
  limit: number = STORYLINES_LIMIT
): Insight[] {
  return insights
    .filter((insight) => MULTI_SEASON_INSIGHT_TYPES.has(insight.type))
    .sort((a, b) => b.priorityScore - a.priorityScore)
    .slice(0, limit);
}

export default function StorylinesPanel({ insights, slug, year }: Props): React.ReactElement {
  const storylines = selectMultiSeasonStorylines(insights);

  if (storylines.length === 0) {
    return (
      <section className="space-y-3">
        <h2 className="text-[15px] font-medium text-gray-900 dark:text-zinc-100">Storylines</h2>
        <p className="text-sm text-gray-500 dark:text-zinc-400">
          No multi-season storylines available yet.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <h2 className="text-[15px] font-medium text-gray-900 dark:text-zinc-100">Storylines</h2>
      <div className="rounded-xl border border-gray-200 dark:border-zinc-700">
        {storylines.map((insight) => (
          <AllInsightsRow key={insight.id} insight={insight} leagueSlug={slug} panelYear={year} />
        ))}
      </div>
    </section>
  );
}

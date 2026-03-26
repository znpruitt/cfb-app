import React from 'react';

import type { OverviewViewModel } from '../lib/selectors/overview';

type MatchupInsights = OverviewViewModel['matchupInsights'];

function ownersLabel(owners: [string, string]): string {
  return `${owners[0]} vs ${owners[1]}`;
}

export default function MatchupInsightsCard({
  insights,
  onViewMatchups,
}: {
  insights: MatchupInsights;
  onViewMatchups?: () => void;
}): React.ReactElement {
  const rows = [
    insights.mostFrequent
      ? {
          id: 'most-frequent',
          text: `Most frequent: ${ownersLabel(insights.mostFrequent.owners)} (${insights.mostFrequent.gameCount} games)`,
        }
      : null,
    insights.mostCompetitive
      ? {
          id: 'most-competitive',
          text: `Most competitive: ${ownersLabel(insights.mostCompetitive.owners)} (${insights.mostCompetitive.record}${
            insights.mostCompetitive.remainingGames > 0
              ? `, ${insights.mostCompetitive.remainingGames} remaining`
              : ''
          })`,
        }
      : null,
    insights.mostUnbalanced
      ? {
          id: 'most-unbalanced',
          text: `Most unbalanced: ${ownersLabel(insights.mostUnbalanced.owners)} (${insights.mostUnbalanced.record})`,
        }
      : null,
    insights.mostActiveOwner
      ? {
          id: 'most-active-owner',
          text: `Most active owner: ${insights.mostActiveOwner.owner} (${insights.mostActiveOwner.totalMatchups} total matchups)`,
        }
      : null,
  ]
    .filter((row): row is { id: string; text: string } => row !== null)
    .slice(0, 4);

  return (
    <div>
      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50/80 px-4 py-3 text-sm text-gray-600 dark:border-zinc-700 dark:bg-zinc-950/70 dark:text-zinc-300">
          Matchup insights will appear once owner-vs-owner games are in the slate.
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li
              key={row.id}
              className="rounded-lg border border-gray-200 bg-white/90 px-3 py-2 text-sm text-gray-800 dark:border-zinc-800 dark:bg-zinc-950/70 dark:text-zinc-200"
            >
              {row.text}
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        className="mt-3 inline-flex rounded-md border border-blue-300 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-800 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-200 dark:hover:bg-blue-950/60"
        onClick={onViewMatchups}
      >
        View weekly matchups
      </button>
    </div>
  );
}

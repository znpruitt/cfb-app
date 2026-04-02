import React from 'react';
import type { SeasonSuperlatives } from '@/lib/selectors/historySelectors';

type Props = {
  superlatives: SeasonSuperlatives;
};

type CardProps = {
  label: string;
  value: string | null;
  detail?: string | null;
};

function SuperlativeCard({ label, value, detail }: CardProps): React.ReactElement {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50/60 px-4 py-3 dark:border-zinc-700 dark:bg-zinc-800/60">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-zinc-400">
        {label}
      </p>
      {value !== null ? (
        <>
          <p className="mt-1 text-base font-semibold text-gray-900 dark:text-zinc-50">{value}</p>
          {detail ? (
            <p className="mt-0.5 text-xs text-gray-500 dark:text-zinc-400">{detail}</p>
          ) : null}
        </>
      ) : (
        <p className="mt-1 text-sm italic text-gray-400 dark:text-zinc-500">Not available</p>
      )}
    </div>
  );
}

export default function SuperlativesPanel({ superlatives }: Props): React.ReactElement {
  const {
    highestWeeklyScore,
    biggestBlowout,
    closestMatchup,
    biggestUpset,
    mostDominantStretch,
    mostImproved,
  } = superlatives;

  return (
    <section className="rounded-xl border border-gray-300 bg-white p-3 shadow-sm sm:p-4 dark:border-zinc-700 dark:bg-zinc-900">
      <h2 className="mb-3 text-xl font-semibold tracking-tight text-gray-950 dark:text-zinc-50">
        Season Superlatives
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <SuperlativeCard
          label="Highest single-week score"
          value={
            highestWeeklyScore
              ? `${highestWeeklyScore.ownerName} — ${highestWeeklyScore.score}`
              : null
          }
          detail={highestWeeklyScore ? `Week ${highestWeeklyScore.week}` : null}
        />
        <SuperlativeCard
          label="Biggest blowout"
          value={biggestBlowout}
          detail={null}
        />
        <SuperlativeCard
          label="Closest matchup"
          value={closestMatchup}
          detail={null}
        />
        <SuperlativeCard
          label="Biggest upset"
          value={biggestUpset}
          detail={null}
        />
        <SuperlativeCard
          label="Most dominant stretch"
          value={
            mostDominantStretch
              ? `${mostDominantStretch.ownerName} — ${mostDominantStretch.consecutiveWins} straight`
              : null
          }
          detail={
            mostDominantStretch
              ? `Weeks ${mostDominantStretch.weekStart}–${mostDominantStretch.weekEnd}`
              : null
          }
        />
        <SuperlativeCard
          label="Most improved"
          value={
            mostImproved
              ? `${mostImproved.ownerName}`
              : null
          }
          detail={
            mostImproved && mostImproved.improvement > 0
              ? `Climbed from #${mostImproved.week1Rank} to #${mostImproved.finalRank}`
              : mostImproved
                ? `#${mostImproved.week1Rank} to #${mostImproved.finalRank}`
                : null
          }
        />
      </div>
    </section>
  );
}

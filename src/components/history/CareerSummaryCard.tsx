import React from 'react';
import type { OwnerCareerResult } from '@/lib/selectors/historySelectors';

type Props = {
  career: OwnerCareerResult;
};

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(Math.round(value));
}

function formatSigned(value: number): string {
  if (value > 0) return `+${formatNumber(value)}`;
  if (value < 0) return `−${formatNumber(Math.abs(value))}`;
  return '0';
}

type StatProps = {
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
  id?: string;
  emphasis?: 'champion' | 'positive' | 'negative' | 'neutral';
};

function Stat({ label, value, detail, id, emphasis = 'neutral' }: StatProps): React.ReactElement {
  const valueClass =
    emphasis === 'champion'
      ? 'text-amber-700 dark:text-amber-400'
      : emphasis === 'positive'
        ? 'text-green-700 dark:text-green-400'
        : emphasis === 'negative'
          ? 'text-red-600 dark:text-red-400'
          : 'text-gray-950 dark:text-zinc-50';

  return (
    <div id={id} className="scroll-mt-20">
      <dt className="text-xs font-medium uppercase tracking-widest text-gray-500 dark:text-zinc-400">
        {label}
      </dt>
      <dd className={`mt-0.5 text-[18px] font-semibold tabular-nums ${valueClass}`}>{value}</dd>
      {detail !== undefined && detail !== null && detail !== '' ? (
        <dd className="text-xs text-gray-500 dark:text-zinc-400">{detail}</dd>
      ) : null}
    </div>
  );
}

export default function CareerSummaryCard({ career }: Props): React.ReactElement {
  const totalGames = career.totalWins + career.totalLosses;
  const winPct = totalGames > 0 ? ((career.totalWins / totalGames) * 100).toFixed(1) : null;
  const championshipYears = career.seasonHistory
    .filter((s) => s.isChampion)
    .map((s) => s.year)
    .join(', ');
  const diffEmphasis: StatProps['emphasis'] =
    career.totalPointDifferential > 0
      ? 'positive'
      : career.totalPointDifferential < 0
        ? 'negative'
        : 'neutral';
  const turnoverEmphasis: StatProps['emphasis'] =
    career.totalTurnoverMargin === null
      ? 'neutral'
      : career.totalTurnoverMargin > 0
        ? 'positive'
        : career.totalTurnoverMargin < 0
          ? 'negative'
          : 'neutral';

  return (
    <section className="space-y-3">
      <h2 className="text-[15px] font-medium text-gray-900 dark:text-zinc-100">Career Summary</h2>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4">
        <Stat
          label="Record"
          value={`${career.totalWins}–${career.totalLosses}`}
          detail={winPct !== null ? `${winPct}% win rate` : null}
        />
        <Stat
          label="Championships"
          value={career.championships > 0 ? career.championships : '—'}
          detail={career.championships > 0 ? championshipYears : null}
          emphasis={career.championships > 0 ? 'champion' : 'neutral'}
        />
        <Stat label="Avg Finish" value={`#${career.avgFinish.toFixed(1)}`} />
        <Stat
          label="Seasons"
          value={career.seasonsPlayed}
          detail={career.firstSeason !== null ? `Since ${career.firstSeason}` : null}
        />
        <Stat
          id="career-points"
          label="Career Points"
          value={formatNumber(career.totalPoints)}
          detail={
            career.totalPointsAgainst > 0
              ? `${formatNumber(career.totalPointsAgainst)} allowed`
              : null
          }
        />
        <Stat
          label="Point Differential"
          value={formatSigned(career.totalPointDifferential)}
          emphasis={diffEmphasis}
        />
        <Stat
          id="turnover-margin"
          label="Turnover Margin"
          value={
            career.totalTurnoverMargin === null ? '—' : formatSigned(career.totalTurnoverMargin)
          }
          detail={career.totalTurnoverMargin === null ? 'Not yet available' : null}
          emphasis={turnoverEmphasis}
        />
        {career.totalYards !== null ? (
          <Stat label="Total Yards" value={formatNumber(career.totalYards)} />
        ) : null}
      </dl>
    </section>
  );
}

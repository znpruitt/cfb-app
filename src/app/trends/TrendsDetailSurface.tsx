'use client';

import React from 'react';

import { type SeasonContext } from '../../lib/selectors/seasonContext';
import { selectGamesBackTrend, selectWinBars, selectWinPctTrend } from '../../lib/selectors/trends';
import type { StandingsHistory } from '../../lib/standingsHistory';

type MetricKind = 'games-back' | 'win-pct';

type TrendRowData = {
  ownerId: string;
  ownerName: string;
  points: Array<{ week: number; value: number }>;
  latest: number | null;
};

type HoverState = {
  ownerId: string;
  ownerName: string;
  metric: MetricKind;
  week: number;
  value: number;
};

export function toggleSelectedOwner(current: string | null, ownerId: string): string | null {
  return current === ownerId ? null : ownerId;
}

function formatWinPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatMetricValue(metric: MetricKind, value: number): string {
  if (metric === 'win-pct') return formatWinPct(value);
  return value.toFixed(1);
}

function latestTrendValue(series: { points: { value: number }[] }): number | null {
  const point = series.points[series.points.length - 1];
  return point ? point.value : null;
}

function seasonContextLabel(context: SeasonContext | null): string {
  if (context === 'final') return 'Final standings';
  if (context === 'postseason') return 'Postseason in progress';
  if (context === 'in-season') return 'In season';
  return 'Context unavailable';
}

export function formatHoverSummary(
  hoverState: {
    ownerName: string;
    metric: MetricKind;
    week: number;
    value: number;
  } | null
): string | null {
  if (!hoverState) return null;
  return `${hoverState.ownerName} · Week ${hoverState.week} · ${formatMetricValue(hoverState.metric, hoverState.value)}`;
}

function buildSparklinePoints(points: Array<{ week: number; value: number }>): string {
  if (points.length === 0) return '';
  if (points.length === 1) return '0,12';

  const min = Math.min(...points.map((point) => point.value));
  const max = Math.max(...points.map((point) => point.value));
  const range = max - min;

  return points
    .map((point, index) => {
      const x = (index / (points.length - 1)) * 112;
      const normalized = range === 0 ? 0.5 : (point.value - min) / range;
      const y = 20 - normalized * 16;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

function TrendList({
  rows,
  metric,
  selectedOwnerId,
  onSelectOwner,
  onHover,
  onHoverLeave,
}: {
  rows: TrendRowData[];
  metric: MetricKind;
  selectedOwnerId: string | null;
  onSelectOwner: (ownerId: string) => void;
  onHover: (payload: HoverState) => void;
  onHoverLeave: () => void;
}): React.ReactElement {
  if (rows.length === 0) {
    return <p className="text-sm text-gray-500 dark:text-zinc-400">No trend data available yet.</p>;
  }

  return (
    <ul className="space-y-2 text-sm">
      {rows.map((row) => {
        const selected = selectedOwnerId === row.ownerId;
        const muted = selectedOwnerId != null && !selected;
        const sparklinePoints = buildSparklinePoints(row.points);
        const weeks = row.points.map((point) => point.week);
        const values = row.points.map((point) => point.value);
        const minWeek = weeks.length > 0 ? Math.min(...weeks) : null;
        const maxWeek = weeks.length > 0 ? Math.max(...weeks) : null;
        const minValue = values.length > 0 ? Math.min(...values) : null;
        const maxValue = values.length > 0 ? Math.max(...values) : null;

        return (
          <li
            key={row.ownerId}
            className={`rounded-md border px-2.5 py-2 transition ${
              selected
                ? 'border-blue-400 bg-blue-50/80 dark:border-blue-500 dark:bg-blue-950/30'
                : 'border-gray-200 bg-white dark:border-zinc-700 dark:bg-zinc-900'
            } ${muted ? 'opacity-50' : ''}`}
          >
            <button
              type="button"
              className="flex w-full items-center justify-between text-left"
              onClick={() => onSelectOwner(row.ownerId)}
              data-selected={selected ? 'true' : 'false'}
            >
              <span className="font-medium text-gray-900 dark:text-zinc-100">{row.ownerName}</span>
              <span className="text-gray-600 dark:text-zinc-300">
                {row.latest == null ? '—' : formatMetricValue(metric, row.latest)}
              </span>
            </button>

            {row.points.length > 0 ? (
              <div className="mt-2 space-y-1">
                <svg
                  viewBox="0 0 112 24"
                  className="h-7 w-full"
                  role="img"
                  aria-label={`${row.ownerName} ${metric} trend`}
                >
                  <polyline
                    points={sparklinePoints}
                    fill="none"
                    className={`${selected ? 'stroke-blue-600 dark:stroke-blue-300' : 'stroke-emerald-600 dark:stroke-emerald-300'} ${selected ? 'stroke-[2.4]' : 'stroke-[1.8]'}`}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  {row.points.map((point, index) => {
                    const x = row.points.length === 1 ? 0 : (index / (row.points.length - 1)) * 112;
                    const min = minValue ?? point.value;
                    const max = maxValue ?? point.value;
                    const range = max - min;
                    const normalized = range === 0 ? 0.5 : (point.value - min) / range;
                    const y = 20 - normalized * 16;

                    return (
                      <circle
                        key={`${row.ownerId}-${point.week}`}
                        cx={x}
                        cy={y}
                        r={selected ? 2.4 : 2}
                        className={
                          selected
                            ? 'fill-blue-600 dark:fill-blue-300'
                            : 'fill-emerald-600 dark:fill-emerald-300'
                        }
                        onMouseEnter={() =>
                          onHover({
                            ownerId: row.ownerId,
                            ownerName: row.ownerName,
                            metric,
                            week: point.week,
                            value: point.value,
                          })
                        }
                        onMouseLeave={onHoverLeave}
                      />
                    );
                  })}
                </svg>
                <p className="text-[11px] text-gray-500 dark:text-zinc-400">
                  W{minWeek ?? '—'} → W{maxWeek ?? '—'} · Min{' '}
                  {minValue == null ? '—' : formatMetricValue(metric, minValue)} · Max{' '}
                  {maxValue == null ? '—' : formatMetricValue(metric, maxValue)}
                </p>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export default function TrendsDetailSurface({
  standingsHistory,
  season,
  seasonContext,
  issues,
}: {
  standingsHistory: StandingsHistory | null;
  season: number;
  seasonContext: SeasonContext | null;
  issues: string[];
}): React.ReactElement {
  const [selectedOwnerId, setSelectedOwnerId] = React.useState<string | null>(null);
  const [hoverState, setHoverState] = React.useState<HoverState | null>(null);

  const gamesBackTrend = standingsHistory ? selectGamesBackTrend({ standingsHistory }) : [];
  const winPctTrend = standingsHistory ? selectWinPctTrend({ standingsHistory }) : [];
  const winBars = standingsHistory ? selectWinBars({ standingsHistory }) : [];

  const gamesBackRows: TrendRowData[] = gamesBackTrend
    .map((entry) => ({
      ownerId: entry.ownerId,
      ownerName: entry.ownerName,
      points: entry.points,
      latest: latestTrendValue(entry),
    }))
    .sort((left, right) => {
      const leftValue = left.latest ?? Number.POSITIVE_INFINITY;
      const rightValue = right.latest ?? Number.POSITIVE_INFINITY;
      if (leftValue !== rightValue) return leftValue - rightValue;
      return left.ownerName.localeCompare(right.ownerName);
    });

  const winPctRows: TrendRowData[] = winPctTrend
    .map((entry) => ({
      ownerId: entry.ownerId,
      ownerName: entry.ownerName,
      points: entry.points,
      latest: latestTrendValue(entry),
    }))
    .sort((left, right) => {
      const leftValue = left.latest ?? Number.NEGATIVE_INFINITY;
      const rightValue = right.latest ?? Number.NEGATIVE_INFINITY;
      if (leftValue !== rightValue) return rightValue - leftValue;
      return left.ownerName.localeCompare(right.ownerName);
    });

  return (
    <main className="mx-auto w-full max-w-5xl space-y-4 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-gray-950 dark:text-zinc-50">
          League Trends Detail
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-zinc-300">
          Season {season} · {seasonContextLabel(seasonContext)}
        </p>
      </header>

      {formatHoverSummary(hoverState) ? (
        <section className="rounded-lg border border-blue-300 bg-blue-50/80 px-3 py-2 text-xs text-blue-900 dark:border-blue-700 dark:bg-blue-950/30 dark:text-blue-100">
          {formatHoverSummary(hoverState)}
        </section>
      ) : null}

      {issues.length > 0 ? (
        <section className="rounded-xl border border-amber-300 bg-amber-50/70 p-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200">
          <p className="font-semibold">Data notes</p>
          <ul className="mt-1 list-inside list-disc space-y-0.5">
            {issues.slice(0, 5).map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="rounded-xl border border-gray-200 bg-gray-50/70 p-4 dark:border-zinc-800 dark:bg-zinc-900/60">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-600 dark:text-zinc-300">
          Games Back
        </h2>
        <div className="mt-2">
          <TrendList
            rows={gamesBackRows}
            metric="games-back"
            selectedOwnerId={selectedOwnerId}
            onSelectOwner={(ownerId) =>
              setSelectedOwnerId((current) => toggleSelectedOwner(current, ownerId))
            }
            onHover={setHoverState}
            onHoverLeave={() => setHoverState(null)}
          />
        </div>
      </section>

      <section className="rounded-xl border border-gray-200 bg-gray-50/70 p-4 dark:border-zinc-800 dark:bg-zinc-900/60">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-600 dark:text-zinc-300">
          Win %
        </h2>
        <div className="mt-2">
          <TrendList
            rows={winPctRows}
            metric="win-pct"
            selectedOwnerId={selectedOwnerId}
            onSelectOwner={(ownerId) =>
              setSelectedOwnerId((current) => toggleSelectedOwner(current, ownerId))
            }
            onHover={setHoverState}
            onHoverLeave={() => setHoverState(null)}
          />
        </div>
      </section>

      <section className="rounded-xl border border-gray-200 bg-gray-50/70 p-4 dark:border-zinc-800 dark:bg-zinc-900/60">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-600 dark:text-zinc-300">
          Win Bars
        </h2>
        {winBars.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500 dark:text-zinc-400">
            No win bar data available yet.
          </p>
        ) : (
          <ul className="mt-2 space-y-1.5 text-sm">
            {winBars.map((row) => {
              const selected = selectedOwnerId === row.ownerId;
              const muted = selectedOwnerId != null && !selected;
              return (
                <li
                  key={row.ownerId}
                  className={`rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-gray-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 ${
                    selected ? 'ring-1 ring-blue-400 dark:ring-blue-500' : ''
                  } ${muted ? 'opacity-50' : ''}`}
                >
                  <button
                    type="button"
                    className="w-full text-left"
                    onClick={() =>
                      setSelectedOwnerId((current) => toggleSelectedOwner(current, row.ownerId))
                    }
                    data-selected={selected ? 'true' : 'false'}
                  >
                    <span className="font-medium">{row.ownerName}</span>: {row.wins}-{row.losses}
                    {row.ties > 0 ? `-${row.ties}` : ''} ({formatWinPct(row.winPct)})
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-gray-200 bg-gray-50/70 p-4 dark:border-zinc-800 dark:bg-zinc-900/60">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-600 dark:text-zinc-300">
          Latest snapshot
        </h2>
        {winBars.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500 dark:text-zinc-400">
            Snapshot will populate after standings history is available.
          </p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-gray-600 dark:text-zinc-300">
                  <th className="px-2 py-1">Owner</th>
                  <th className="px-2 py-1">Wins</th>
                  <th className="px-2 py-1">Win %</th>
                  <th className="px-2 py-1">Games back</th>
                </tr>
              </thead>
              <tbody>
                {winBars.map((row) => (
                  <tr key={`snapshot-${row.ownerId}`} className="text-gray-800 dark:text-zinc-100">
                    <td className="px-2 py-1">{row.ownerName}</td>
                    <td className="px-2 py-1">{row.wins}</td>
                    <td className="px-2 py-1">{formatWinPct(row.winPct)}</td>
                    <td className="px-2 py-1">{row.gamesBack.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

import React from 'react';

import { buildOwnerColorMap } from '../app/trends/presentationColors';
import { selectGamesBackTrend, selectWinPctTrend } from '../lib/selectors/trends';
import type { StandingsHistory } from '../lib/standingsHistory';

const CHART_H = 150;
const LABEL_H = 18;
const VIEWBOX_W = 220;
const TOTAL_H = CHART_H + LABEL_H;

type SeriesPoint = { week: number; value: number };
type Series = { ownerId: string; ownerName: string; points: SeriesPoint[] };

function buildGeometry(allSeries: Series[]): { valueMin: number; valueMax: number } {
  const allValues = allSeries.flatMap((s) => s.points.map((p) => p.value));
  if (allValues.length === 0) return { valueMin: 0, valueMax: 1 };
  return { valueMin: Math.min(...allValues), valueMax: Math.max(...allValues) };
}

function buildPath(
  points: SeriesPoint[],
  weeks: number[],
  plotW: number,
  plotH: number,
  valueMin: number,
  valueMax: number,
  invertY: boolean
): string {
  if (points.length === 0) return '';
  const spread = Math.max(0.001, valueMax - valueMin);
  const totalWeeks = weeks.length;
  const weekIndexMap = new Map(weeks.map((w, i) => [w, i]));

  return points
    .map((p, i) => {
      const xi = weekIndexMap.get(p.week) ?? 0;
      const x = totalWeeks <= 1 ? plotW / 2 : (xi / (totalWeeks - 1)) * plotW;
      const norm = (p.value - valueMin) / spread;
      const y = invertY ? norm * plotH : plotH - norm * plotH;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

function formatGamesBack(value: number): string {
  if (value === 0) return '—';
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatWinPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

type MiniChartProps = {
  title: string;
  allSeries: Series[];
  weeks: number[];
  colorMap: Map<string, string>;
  invertY: boolean;
  formatValue: (v: number) => string;
};

function MiniChart({
  title,
  allSeries,
  weeks,
  colorMap,
  invertY,
  formatValue,
}: MiniChartProps): React.ReactElement {
  const { valueMin, valueMax } = buildGeometry(allSeries);

  return (
    <div>
      <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-zinc-400">
        {title}
      </h4>
      <svg
        viewBox={`0 0 ${VIEWBOX_W} ${TOTAL_H}`}
        className="w-full"
        style={{ height: TOTAL_H }}
        aria-hidden="true"
      >
        {[0.25, 0.5, 0.75].map((t) => {
          const y = invertY ? t * CHART_H : (1 - t) * CHART_H;
          return (
            <line
              key={t}
              x1={0}
              y1={y}
              x2={VIEWBOX_W}
              y2={y}
              stroke="currentColor"
              strokeOpacity={0.08}
              strokeWidth={1}
            />
          );
        })}

        {allSeries.map((series) => {
          const color = colorMap.get(series.ownerId) ?? '#888';
          const d = buildPath(
            series.points,
            weeks,
            VIEWBOX_W,
            CHART_H,
            valueMin,
            valueMax,
            invertY
          );
          return d ? (
            <path
              key={series.ownerId}
              d={d}
              fill="none"
              stroke={color}
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : null;
        })}

        {weeks.map((week, i) => {
          const x = weeks.length <= 1 ? VIEWBOX_W / 2 : (i / (weeks.length - 1)) * VIEWBOX_W;
          return (
            <text
              key={week}
              x={x}
              y={CHART_H + LABEL_H - 2}
              textAnchor="middle"
              fontSize={9}
              fill="currentColor"
              fillOpacity={0.4}
            >
              W{week}
            </text>
          );
        })}
      </svg>

      <div className="mt-1.5 flex flex-wrap gap-x-2.5 gap-y-1">
        {allSeries.map((series) => {
          const color = colorMap.get(series.ownerId) ?? '#888';
          const latest = series.points.at(-1);
          return (
            <span
              key={series.ownerId}
              className="flex items-center gap-1 text-[10px] text-gray-600 dark:text-zinc-400"
            >
              <span
                className="h-2 w-2 flex-shrink-0 rounded-full"
                style={{ backgroundColor: color }}
              />
              <span className="max-w-[5rem] truncate">{series.ownerName}</span>
              {latest != null ? (
                <span className="tabular-nums text-gray-400 dark:text-zinc-500">
                  {formatValue(latest.value)}
                </span>
              ) : null}
            </span>
          );
        })}
      </div>
    </div>
  );
}

type Props = {
  standingsHistory: StandingsHistory;
};

export default function MiniTrendsGrid({ standingsHistory }: Props): React.ReactElement | null {
  const gamesBackSeries = React.useMemo(
    () => selectGamesBackTrend({ standingsHistory }),
    [standingsHistory]
  );
  const winPctSeries = React.useMemo(
    () => selectWinPctTrend({ standingsHistory }),
    [standingsHistory]
  );
  const orderedOwners = React.useMemo(
    () => gamesBackSeries.map((s) => s.ownerId),
    [gamesBackSeries]
  );
  const colorMap = React.useMemo(() => buildOwnerColorMap(orderedOwners), [orderedOwners]);

  const weeks = standingsHistory.weeks;
  if (weeks.length === 0) return null;

  return (
    <div className="grid grid-cols-2 gap-4">
      <MiniChart
        title="Games Back"
        allSeries={gamesBackSeries}
        weeks={weeks}
        colorMap={colorMap}
        invertY
        formatValue={formatGamesBack}
      />
      <MiniChart
        title="Win %"
        allSeries={winPctSeries}
        weeks={weeks}
        colorMap={colorMap}
        invertY={false}
        formatValue={formatWinPct}
      />
    </div>
  );
}

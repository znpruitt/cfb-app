import React from 'react';

import { buildOwnerColorMap } from '../lib/ownerColors';
import { selectGamesBackTrend } from '../lib/selectors/trends';
import type { StandingsHistory } from '../lib/standingsHistory';

const CHART_H = 160;
const LABEL_H = 20;
const VIEWBOX_W = 470;
const PLOT_W = VIEWBOX_W;
const TOTAL_H = CHART_H + LABEL_H;
const X_PAD = PLOT_W * 0.015;

type SeriesPoint = { week: number; value: number };

function xOfWeek(weekIndex: number, totalWeeks: number): number {
  const xRange = PLOT_W - 2 * X_PAD;
  return totalWeeks <= 1 ? PLOT_W / 2 : X_PAD + (weekIndex / (totalWeeks - 1)) * xRange;
}

function yOfGb(gb: number, maxGb: number): number {
  return (gb / Math.max(0.1, maxGb)) * CHART_H;
}

function buildPath(points: SeriesPoint[], weeks: number[], maxGb: number): string {
  if (points.length === 0) return '';
  const weekIndexMap = new Map(weeks.map((w, i) => [w, i]));
  return points
    .map((p, i) => {
      const xi = weekIndexMap.get(p.week) ?? 0;
      const x = xOfWeek(xi, weeks.length);
      const y = yOfGb(p.value, maxGb);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

type Props = {
  standingsHistory: StandingsHistory;
  /** Optional label override — e.g. "Bowl", "CFP", "CCG" for postseason weeks. */
  weekLabel?: (week: number) => string;
};

export default function MiniTrendsGrid({
  standingsHistory,
  weekLabel,
}: Props): React.ReactElement | null {
  const allSeries = React.useMemo(
    () => selectGamesBackTrend({ standingsHistory }),
    [standingsHistory]
  );
  const series = allSeries;

  const weeks = standingsHistory.weeks;
  if (weeks.length === 0 || series.length === 0) return null;

  const ownerColorMap = React.useMemo(
    () => buildOwnerColorMap(series.map((s) => s.ownerName)),
    [series]
  );

  // Y scale: max GB across all owners + 10% padding
  const maxGb = Math.max(1, ...series.flatMap((s) => s.points.map((p) => p.value)));
  const paddedMax = maxGb * 1.1;

  const defaultWeekLabel = (w: number) => `W${w}`;
  const labelFn = weekLabel ?? defaultWeekLabel;

  return (
    <svg
      viewBox={`0 0 ${VIEWBOX_W} ${TOTAL_H}`}
      className="w-full"
      style={{ height: 'auto' }}
      fontFamily="inherit"
      aria-hidden="true"
    >
      {/* Bounding lines (chart area only) */}
      <line
        x1={0}
        y1={0}
        x2={PLOT_W}
        y2={0}
        stroke="currentColor"
        strokeOpacity={0.15}
        strokeWidth={1}
      />
      <line
        x1={0}
        y1={CHART_H}
        x2={PLOT_W}
        y2={CHART_H}
        stroke="currentColor"
        strokeOpacity={0.15}
        strokeWidth={1}
      />

      {/* Y-axis anchors */}
      <text x={2} y={11} fontSize={7} fill="currentColor" fillOpacity={0.35}>
        0 GB
      </text>
      <text x={2} y={CHART_H - 3} fontSize={7} fill="currentColor" fillOpacity={0.35}>
        {Math.round(maxGb)} GB
      </text>

      {/* Vertical grid lines at each week */}
      {weeks.map((week, i) => {
        const x = xOfWeek(i, weeks.length);
        return (
          <line
            key={`vg-${week}`}
            x1={x}
            y1={0}
            x2={x}
            y2={CHART_H}
            stroke="currentColor"
            strokeOpacity={0.06}
            strokeWidth={1}
          />
        );
      })}

      {/* Series paths — leader slightly thicker */}
      {series.map((s, i) => {
        const color = ownerColorMap.get(s.ownerName) ?? '#888';
        const d = buildPath(s.points, weeks, paddedMax);
        return d ? (
          <path
            key={s.ownerId}
            d={d}
            fill="none"
            stroke={color}
            strokeOpacity={0.9}
            strokeWidth={i === 0 ? 1.75 : 1.25}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null;
      })}

      {/* Week labels on x-axis */}
      {weeks.map((week, i) => {
        const x = xOfWeek(i, weeks.length);
        const anchor = i === 0 ? 'start' : i === weeks.length - 1 ? 'end' : 'middle';
        return (
          <text
            key={`xl-${week}`}
            x={x}
            y={CHART_H + LABEL_H - 4}
            textAnchor={anchor}
            fontSize={8}
            fill="currentColor"
            fillOpacity={0.4}
          >
            {labelFn(week)}
          </text>
        );
      })}
    </svg>
  );
}

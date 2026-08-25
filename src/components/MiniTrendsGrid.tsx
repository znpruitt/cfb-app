import React from 'react';

import { isDrawableTrendSeries, selectGamesBackTrend } from '../lib/selectors/trends';
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

/**
 * POLISH-014 — this chart's x-domain is the season ORIGIN followed by the weeks.
 *
 * The origin is not a week and carries no week number (see `GamesBackSeries.origin`),
 * so it lives at column 0 here and every week shifts one column right. That is
 * what makes ONE resolved week an ordinary two-point segment instead of a
 * moveto-only path SVG refuses to draw.
 */
const ORIGIN_COLUMN = 0;

function columnCount(weeks: number[]): number {
  return weeks.length + 1;
}

function buildPath(
  points: SeriesPoint[],
  origin: number | null,
  weeks: number[],
  maxGb: number
): string {
  const weekIndexMap = new Map(weeks.map((w, i) => [w, i + 1]));
  const total = columnCount(weeks);

  const coords: Array<{ x: number; y: number }> = [];
  if (origin !== null) {
    coords.push({ x: xOfWeek(ORIGIN_COLUMN, total), y: yOfGb(origin, maxGb) });
  }
  for (const point of points) {
    const column = weekIndexMap.get(point.week);
    // A point whose week is not in the domain is DROPPED, not silently placed at
    // column 0. The previous `?? 0` collapsed such a point onto the first column,
    // which is the shape of bug this file has produced twice.
    if (column === undefined) continue;
    coords.push({ x: xOfWeek(column, total), y: yOfGb(point.value, maxGb) });
  }

  if (coords.length === 0) return '';
  return coords
    .map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`)
    .join(' ');
}

type Props = {
  standingsHistory: StandingsHistory;
  /** Optional label override — e.g. "Bowl", "CFP", "CCG" for postseason weeks. */
  weekLabel?: (week: number) => string;
  ownerColorMap: Record<string, string>;
};

export default function MiniTrendsGrid({
  standingsHistory,
  weekLabel,
  ownerColorMap,
}: Props): React.ReactElement | null {
  const allSeries = React.useMemo(
    () => selectGamesBackTrend({ standingsHistory }),
    [standingsHistory]
  );
  const CONTENDERS = 5;
  const series = allSeries.slice(0, CONTENDERS);

  const weeks = standingsHistory.weeks;
  // POLISH-014: ONE drawability authority, shared with the Overview guard and
  // `SeasonArcChart`. This file used to render whenever a series existed, which
  // is how a one-point series produced an empty box with axes.
  if (weeks.length === 0 || !series.some(isDrawableTrendSeries)) return null;

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
      {[null, ...weeks].map((week, i) => {
        const x = xOfWeek(i, columnCount(weeks));
        return (
          <line
            key={`vg-${week ?? 'origin'}`}
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
        const color = ownerColorMap[s.ownerName] ?? '#888';
        const d = buildPath(s.points, s.origin, weeks, paddedMax);
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
        // Column 0 is the origin and is deliberately UNLABELLED (owner decision,
        // 2026-08-25): it is not a week, and naming it would imply one.
        const column = i + 1;
        const x = xOfWeek(column, columnCount(weeks));
        const anchor = i === weeks.length - 1 ? 'end' : 'middle';
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

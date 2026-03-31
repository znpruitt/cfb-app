import React from 'react';

import { buildOwnerColorMap } from '../app/trends/presentationColors';
import { selectRankTrend } from '../lib/selectors/trends';
import type { StandingsHistory } from '../lib/standingsHistory';

const CHART_H = 220;
const LABEL_H = 20;
const LABEL_W = 95; // right-side lane for inline end labels
const VIEWBOX_W = 560;
const PLOT_W = VIEWBOX_W - LABEL_W; // 465 — actual plot area
const TOTAL_H = CHART_H + LABEL_H;
const X_PAD = PLOT_W * 0.015;
const MIN_LABEL_GAP = 10;

type SeriesPoint = { week: number; value: number };
type LabelItem = { ownerId: string; ownerName: string; y: number; display: string; color: string };

/** Map rank 1..N to y coordinate. Rank 1 at top, rank N at bottom. */
function yOfRank(rank: number, ownerCount: number): number {
  return ((rank - 0.5) / ownerCount) * CHART_H;
}

function xOfWeek(weekIndex: number, totalWeeks: number): number {
  const xRange = PLOT_W - 2 * X_PAD;
  return totalWeeks <= 1 ? PLOT_W / 2 : X_PAD + (weekIndex / (totalWeeks - 1)) * xRange;
}

function buildPath(points: SeriesPoint[], weeks: number[], ownerCount: number): string {
  if (points.length === 0) return '';
  const weekIndexMap = new Map(weeks.map((w, i) => [w, i]));
  return points
    .map((p, i) => {
      const xi = weekIndexMap.get(p.week) ?? 0;
      const x = xOfWeek(xi, weeks.length);
      const y = yOfRank(p.value, ownerCount);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

function deconflictLabels(labels: LabelItem[]): LabelItem[] {
  if (labels.length === 0) return [];
  const sorted = [...labels].sort((a, b) => a.y - b.y);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].y < sorted[i - 1].y + MIN_LABEL_GAP) {
      sorted[i] = { ...sorted[i], y: sorted[i - 1].y + MIN_LABEL_GAP };
    }
  }
  const lastY = sorted[sorted.length - 1].y;
  if (lastY > CHART_H) {
    const shift = lastY - CHART_H;
    return sorted.map((l) => ({ ...l, y: l.y - shift }));
  }
  return sorted;
}

type Props = { standingsHistory: StandingsHistory };

export default function MiniTrendsGrid({ standingsHistory }: Props): React.ReactElement | null {
  const rankSeries = React.useMemo(() => selectRankTrend({ standingsHistory }), [standingsHistory]);
  const orderedOwners = React.useMemo(() => rankSeries.map((s) => s.ownerId), [rankSeries]);
  const colorMap = React.useMemo(() => buildOwnerColorMap(orderedOwners), [orderedOwners]);

  const weeks = standingsHistory.weeks;
  if (weeks.length === 0 || rankSeries.length === 0) return null;

  const ownerCount = rankSeries.length;
  const weekIndexMap = new Map(weeks.map((w, i) => [w, i]));

  const rawLabels: LabelItem[] = rankSeries.flatMap((series) => {
    const lastPoint = series.points.at(-1);
    if (!lastPoint) return [];
    const y = yOfRank(lastPoint.value, ownerCount);
    const name =
      series.ownerName.length > 8 ? `${series.ownerName.slice(0, 7)}\u2026` : series.ownerName;
    return [
      {
        ownerId: series.ownerId,
        ownerName: series.ownerName,
        y,
        display: `${name} #${lastPoint.value}`,
        color: colorMap.get(series.ownerId) ?? '#888',
      },
    ];
  });

  const endLabels = deconflictLabels(rawLabels);

  return (
    <svg
      viewBox={`0 0 ${VIEWBOX_W} ${TOTAL_H}`}
      className="w-full"
      style={{ height: 'auto' }}
      fontFamily="inherit"
      aria-hidden="true"
    >
      {/* Horizontal grid line at each rank position */}
      {Array.from({ length: ownerCount }, (_, i) => i + 1).map((rank) => {
        const y = yOfRank(rank, ownerCount);
        return (
          <line
            key={`hg-${rank}`}
            x1={0}
            y1={y}
            x2={PLOT_W}
            y2={y}
            stroke="currentColor"
            strokeOpacity={0.06}
            strokeWidth={1}
          />
        );
      })}

      {/* Vertical grid line at each week */}
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
            strokeOpacity={0.07}
            strokeWidth={1}
          />
        );
      })}

      {/* Series paths */}
      {rankSeries.map((series, idx) => {
        const color = colorMap.get(series.ownerId) ?? '#888';
        const d = buildPath(series.points, weeks, ownerCount);
        return d ? (
          <path
            key={series.ownerId}
            d={d}
            fill="none"
            stroke={color}
            strokeWidth={idx === 0 ? 2 : 1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null;
      })}

      {/* Dot at final data point */}
      {rankSeries.map((series) => {
        const lastPoint = series.points.at(-1);
        if (!lastPoint) return null;
        const xi = weekIndexMap.get(lastPoint.week) ?? 0;
        const cx = xOfWeek(xi, weeks.length);
        const cy = yOfRank(lastPoint.value, ownerCount);
        const color = colorMap.get(series.ownerId) ?? '#888';
        return <circle key={`dot-${series.ownerId}`} cx={cx} cy={cy} r={2.5} fill={color} />;
      })}

      {/* Inline end labels */}
      {endLabels.map((label) => (
        <text
          key={`lbl-${label.ownerId}`}
          x={PLOT_W + 6}
          y={label.y + 3.5}
          fontSize={9}
          fill={label.color}
          fontWeight={500}
        >
          {label.display}
        </text>
      ))}

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
            fontSize={9}
            fill="currentColor"
            fillOpacity={0.4}
          >
            W{week}
          </text>
        );
      })}
    </svg>
  );
}

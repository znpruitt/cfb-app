import React from 'react';

import { selectRankTrend } from '../lib/selectors/trends';
import type { StandingsHistory } from '../lib/standingsHistory';

const CHART_H = 220;
const LABEL_H = 20;
const LABEL_W = 95;
const VIEWBOX_W = 560;
const PLOT_W = VIEWBOX_W - LABEL_W;
const TOTAL_H = CHART_H + LABEL_H;
const X_PAD = PLOT_W * 0.015;
const MIN_LABEL_GAP = 10;

// Colors tuned for dark backgrounds: moderate saturation (58%), higher
// lightness (65–76%) so lines read clearly without being neon.
function ownerColor(index: number, total: number): string {
  const hue = ((index / Math.max(1, total)) * 360).toFixed(2);
  const lightness = 65 + (index % 4) * 3;
  return `hsl(${hue}, 58%, ${lightness}%)`;
}

type SeriesPoint = { week: number; value: number };
type LabelItem = { ownerId: string; ownerName: string; y: number; display: string; color: string };

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
  const coords = points.map((p) => {
    const xi = weekIndexMap.get(p.week) ?? 0;
    return { x: xOfWeek(xi, weeks.length), y: yOfRank(p.value, ownerCount) };
  });
  return coords
    .map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`)
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

  const weeks = standingsHistory.weeks;
  if (weeks.length === 0 || rankSeries.length === 0) return null;

  const ownerCount = rankSeries.length;
  const colorMap = new Map(rankSeries.map((s, i) => [s.ownerId, ownerColor(i, ownerCount)]));

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
      {/* Vertical grid line at each week only — horizontal rank lines removed */}
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
            strokeOpacity={0.85}
            strokeWidth={idx === 0 ? 1.5 : 1}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null;
      })}

      {/* Inline end labels: colored dot + neutral text */}
      {endLabels.map((label) => (
        <g key={`lbl-${label.ownerId}`}>
          <circle cx={PLOT_W + 5} cy={label.y} r={2} fill={label.color} />
          <text
            x={PLOT_W + 11}
            y={label.y + 3}
            fontSize={8}
            fill="currentColor"
            fillOpacity={0.7}
            fontWeight={400}
          >
            {label.display}
          </text>
        </g>
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
            fontSize={8}
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

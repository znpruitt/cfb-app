import React from 'react';

import { selectGamesBackTrend } from '../lib/selectors/trends';
import type { StandingsHistory } from '../lib/standingsHistory';

const CHART_H = 160;
const LABEL_H = 20;
const LABEL_W = 105;
const VIEWBOX_W = 560;
const PLOT_W = VIEWBOX_W - LABEL_W;
const TOTAL_H = CHART_H + LABEL_H;
const X_PAD = PLOT_W * 0.015;
const CONTENDERS = 5;
const MIN_LABEL_GAP = 10;

// Curated palette for a small set of lines — warm gold for the leader
// (connects to the champion card above), then distinct supporting colors.
const CONTENDER_COLORS = [
  'hsl(45, 85%, 62%)', // gold — leader (echoes champion card)
  'hsl(220, 75%, 65%)', // blue
  'hsl(150, 70%, 58%)', // green
  'hsl(280, 65%, 65%)', // purple
  'hsl(25, 80%, 62%)', // orange
  'hsl(180, 70%, 58%)', // teal
];

const LABEL_Y_MIN = 6; // prevent labels clipping at SVG top edge

type SeriesPoint = { week: number; value: number };
type LabelItem = { ownerId: string; y: number; display: string; color: string };

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

function deconflictLabels(labels: LabelItem[]): LabelItem[] {
  if (labels.length === 0) return [];
  const sorted = [...labels].sort((a, b) => a.y - b.y);
  // Clamp first label to minimum y so it isn't clipped at the SVG top edge
  sorted[0] = { ...sorted[0], y: Math.max(sorted[0].y, LABEL_Y_MIN) };
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
  const allSeries = React.useMemo(
    () => selectGamesBackTrend({ standingsHistory }),
    [standingsHistory]
  );
  const series = allSeries.slice(0, CONTENDERS);

  const weeks = standingsHistory.weeks;
  if (weeks.length === 0 || series.length === 0) return null;

  // Y scale: max GB across contenders + 10% padding
  const maxGb = Math.max(1, ...series.flatMap((s) => s.points.map((p) => p.value)));
  const paddedMax = maxGb * 1.1;

  const rawLabels: LabelItem[] = series.flatMap((s, i) => {
    const lastPoint = s.points.at(-1);
    if (!lastPoint) return [];
    const y = yOfGb(lastPoint.value, paddedMax);
    const color = CONTENDER_COLORS[i] ?? '#888';
    const name = s.ownerName.length > 9 ? `${s.ownerName.slice(0, 8)}\u2026` : s.ownerName;
    const gbLabel =
      lastPoint.value === 0
        ? 'Leader'
        : Number.isInteger(lastPoint.value)
          ? `${lastPoint.value} GB`
          : `${lastPoint.value.toFixed(1)} GB`;
    return [{ ownerId: s.ownerId, y, display: `${name}  ${gbLabel}`, color }];
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
      {/* Bounding lines */}
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

      {/* Label lane separator */}
      <line
        x1={PLOT_W}
        y1={0}
        x2={PLOT_W}
        y2={CHART_H}
        stroke="currentColor"
        strokeOpacity={0.12}
        strokeWidth={1}
      />

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
        const color = CONTENDER_COLORS[i] ?? '#888';
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

      {/* End labels */}
      {endLabels.map((label) => (
        <g key={`lbl-${label.ownerId}`}>
          <circle cx={PLOT_W + 5} cy={label.y} r={2} fill={label.color} />
          <text
            x={PLOT_W + 11}
            y={label.y + 3}
            fontSize={8}
            fill="currentColor"
            fillOpacity={0.75}
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

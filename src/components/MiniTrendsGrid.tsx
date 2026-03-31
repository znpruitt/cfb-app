import React from 'react';

import { buildOwnerColorMap } from '../app/trends/presentationColors';
import { selectGamesBackTrend, selectWinPctTrend } from '../lib/selectors/trends';
import type { StandingsHistory } from '../lib/standingsHistory';

const CHART_H = 160;
const LABEL_H = 20;
const LABEL_W = 108; // right-side lane for inline end labels
const VIEWBOX_W = 560; // total SVG width
const PLOT_W = VIEWBOX_W - LABEL_W; // 452 — actual plot area
const TOTAL_H = CHART_H + LABEL_H;
const X_PAD = PLOT_W * 0.015; // horizontal inset so first/last labels aren't clipped
const Y_PAD_FRAC = 0.08; // vertical padding as fraction of value range
const MIN_LABEL_GAP = 10; // minimum px between label y-centers

type SeriesPoint = { week: number; value: number };
type Series = { ownerId: string; ownerName: string; points: SeriesPoint[] };
type LabelItem = { ownerId: string; ownerName: string; y: number; display: string; color: string };

function buildGeometry(allSeries: Series[]): { valueMin: number; valueMax: number } {
  const allValues = allSeries.flatMap((s) => s.points.map((p) => p.value));
  if (allValues.length === 0) return { valueMin: 0, valueMax: 1 };
  const rawMin = Math.min(...allValues);
  const rawMax = Math.max(...allValues);
  const range = Math.max(0.001, rawMax - rawMin);
  return { valueMin: rawMin - range * Y_PAD_FRAC, valueMax: rawMax + range * Y_PAD_FRAC };
}

function xOfWeek(weekIndex: number, totalWeeks: number): number {
  const xRange = PLOT_W - 2 * X_PAD;
  return totalWeeks <= 1 ? PLOT_W / 2 : X_PAD + (weekIndex / (totalWeeks - 1)) * xRange;
}

function yOfValue(value: number, valueMin: number, valueMax: number, invertY: boolean): number {
  const spread = Math.max(0.001, valueMax - valueMin);
  const norm = (value - valueMin) / spread;
  return invertY ? norm * CHART_H : CHART_H - norm * CHART_H;
}

function buildPath(
  points: SeriesPoint[],
  weeks: number[],
  valueMin: number,
  valueMax: number,
  invertY: boolean
): string {
  if (points.length === 0) return '';
  const weekIndexMap = new Map(weeks.map((w, i) => [w, i]));
  return points
    .map((p, i) => {
      const xi = weekIndexMap.get(p.week) ?? 0;
      const x = xOfWeek(xi, weeks.length);
      const y = yOfValue(p.value, valueMin, valueMax, invertY);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

function deconflictLabels(labels: LabelItem[]): LabelItem[] {
  if (labels.length === 0) return [];
  const sorted = [...labels].sort((a, b) => a.y - b.y);

  // Forward pass: push down overlapping labels
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].y < sorted[i - 1].y + MIN_LABEL_GAP) {
      sorted[i] = { ...sorted[i], y: sorted[i - 1].y + MIN_LABEL_GAP };
    }
  }

  // If last label overflows, shift everything up by the overflow amount
  const lastY = sorted[sorted.length - 1].y;
  if (lastY > CHART_H) {
    const shift = lastY - CHART_H;
    return sorted.map((l) => ({ ...l, y: l.y - shift }));
  }

  return sorted;
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
  const weekIndexMap = new Map(weeks.map((w, i) => [w, i]));

  // Build end labels at the final data point of each series
  const rawLabels: LabelItem[] = allSeries.flatMap((series) => {
    const lastPoint = series.points.at(-1);
    if (!lastPoint) return [];
    const y = yOfValue(lastPoint.value, valueMin, valueMax, invertY);
    const name =
      series.ownerName.length > 8 ? `${series.ownerName.slice(0, 7)}\u2026` : series.ownerName;
    return [
      {
        ownerId: series.ownerId,
        ownerName: series.ownerName,
        y,
        display: `${name} ${formatValue(lastPoint.value)}`,
        color: colorMap.get(series.ownerId) ?? '#888',
      },
    ];
  });

  const endLabels = deconflictLabels(rawLabels);

  return (
    <div>
      <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-zinc-400">
        {title}
      </h4>
      <svg
        viewBox={`0 0 ${VIEWBOX_W} ${TOTAL_H}`}
        className="w-full"
        style={{ height: 'auto' }}
        aria-hidden="true"
      >
        {/* Subtle vertical grid lines at each week */}
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

        {/* Subtle horizontal grid lines */}
        {[0.25, 0.5, 0.75].map((t) => {
          const y = invertY ? t * CHART_H : (1 - t) * CHART_H;
          return (
            <line
              key={t}
              x1={0}
              y1={y}
              x2={PLOT_W}
              y2={y}
              stroke="currentColor"
              strokeOpacity={0.07}
              strokeWidth={1}
            />
          );
        })}

        {/* Series paths */}
        {allSeries.map((series, idx) => {
          const color = colorMap.get(series.ownerId) ?? '#888';
          const d = buildPath(series.points, weeks, valueMin, valueMax, invertY);
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
        {allSeries.map((series) => {
          const lastPoint = series.points.at(-1);
          if (!lastPoint) return null;
          const xi = weekIndexMap.get(lastPoint.week) ?? 0;
          const cx = xOfWeek(xi, weeks.length);
          const cy = yOfValue(lastPoint.value, valueMin, valueMax, invertY);
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
          return (
            <text
              key={`xl-${week}`}
              x={x}
              y={CHART_H + LABEL_H - 4}
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

'use client';

import React from 'react';

import { selectOwnerMomentum } from '../../lib/selectors/momentum';
import { type SeasonContext } from '../../lib/selectors/seasonContext';
import { selectGamesBackTrend, selectWinBars, selectWinPctTrend } from '../../lib/selectors/trends';
import type { StandingsHistory } from '../../lib/standingsHistory';
import { deriveFocusedOwners, type FocusMode } from '../../lib/trendsFocus';

type MetricKind = 'games-back' | 'win-pct';
type LayoutMode = 'standalone' | 'embedded';
const TOP_FOCUS_COUNT = 5;

type TrendRowData = {
  ownerId: string;
  ownerName: string;
  points: Array<{ week: number; value: number }>;
  latest: number | null;
};

type HoverState = {
  x: number;
  y: number;
  ownerName: string;
  metric: MetricKind;
  week: number;
  value: number;
};

type OwnerVisualState = {
  selected: boolean;
  muted: boolean;
  emphasized: boolean;
};

type EndpointLabelInput = {
  owner: string;
  text: string;
  endpointX: number;
  endpointY: number;
  color: string;
};

type EndpointLabelPlacement = EndpointLabelInput & {
  lane: number;
  labelX: number;
  labelY: number;
  estimatedWidth: number;
  connectorPoints: Array<{ x: number; y: number }>;
};

export function toggleSelectedOwner(current: string | null, ownerId: string): string | null {
  return current === ownerId ? null : ownerId;
}

export function deriveDynamicPlotWidth({
  containerWidth,
  weekCount,
  pxPerWeek,
}: {
  containerWidth: number;
  weekCount: number;
  pxPerWeek: number;
}): number {
  const minimumFromWeeks = Math.max(320, weekCount * pxPerWeek);
  if (containerWidth <= 0) return minimumFromWeeks;
  return Math.max(containerWidth, minimumFromWeeks);
}

type ResponsiveTrendLayout = {
  isMobile: boolean;
  chartHeight: number;
  chartHeightClass: string;
  pxPerWeek: number;
  tickStep: number;
  showRightEdgeLabels: boolean;
  labelLaneWidth: number;
  compactWinBars: boolean;
  chartPaddingClass: string;
};

export function deriveResponsiveTrendLayout({
  viewportWidth,
  weekCount,
}: {
  viewportWidth: number;
  weekCount: number;
}): ResponsiveTrendLayout {
  const isMobile = viewportWidth < 640;
  const tickStep = isMobile ? (weekCount > 12 ? 4 : 3) : weekCount > 12 ? 2 : 3;
  return {
    isMobile,
    chartHeight: isMobile ? 308 : 420,
    chartHeightClass: isMobile ? 'h-[310px]' : 'h-[420px]',
    pxPerWeek: isMobile ? 56 : 48,
    tickStep,
    showRightEdgeLabels: !isMobile,
    labelLaneWidth: isMobile ? 16 : 176,
    compactWinBars: isMobile,
    chartPaddingClass: isMobile ? 'p-0.5' : 'p-1',
  };
}

export function deriveAdaptiveWeekTicks(
  weeks: number[],
  tickStep: number
): { value: number; label: string }[] {
  return weeks
    .filter((_, index) => index === 0 || index === weeks.length - 1 || index % tickStep === 0)
    .map((week) => ({ value: week, label: `W${week}` }));
}

export function deriveAllWeekTicks(weeks: number[]): { value: number; label: string }[] {
  return weeks.map((week) => ({ value: week, label: `W${week}` }));
}

function formatWinPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatMetricValue(metric: MetricKind, value: number): string {
  if (metric === 'win-pct') return formatWinPct(value);
  return value.toFixed(1);
}

function formatSignedMetricValue(metric: MetricKind, value: number): string {
  const base = formatMetricValue(metric, Math.abs(value));
  if (value > 0) return `+${base}`;
  if (value < 0) return `-${base}`;
  return base;
}

function formatRank(rank: number): string {
  const mod100 = rank % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${rank}th`;
  const mod10 = rank % 10;
  if (mod10 === 1) return `${rank}st`;
  if (mod10 === 2) return `${rank}nd`;
  if (mod10 === 3) return `${rank}rd`;
  return `${rank}th`;
}

function hslAlpha(hsl: string, alpha: number): string {
  return hsl.replace(/^hsl\(/, 'hsla(').replace(/\)$/, `, ${alpha})`);
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

function formatTrendTooltip(hoverState: HoverState): {
  weekLabel: string;
  valueLabel: string;
} {
  return {
    weekLabel: `W${hoverState.week}`,
    valueLabel:
      hoverState.metric === 'games-back'
        ? `GB: ${hoverState.value.toFixed(1)}`
        : `Win %: ${formatWinPct(hoverState.value)}`,
  };
}

function buildSharedChartGeometry(rows: TrendRowData[]): {
  weekMin: number;
  weekMax: number;
  valueMin: number;
  valueMax: number;
} | null {
  const points = rows.flatMap((row) => row.points);
  if (points.length === 0) return null;

  return {
    weekMin: Math.min(...points.map((point) => point.week)),
    weekMax: Math.max(...points.map((point) => point.week)),
    valueMin: Math.min(...points.map((point) => point.value)),
    valueMax: Math.max(...points.map((point) => point.value)),
  };
}

function buildSeriesPath(params: {
  points: Array<{ week: number; value: number }>;
  geometry: { weekMin: number; weekMax: number; valueMin: number; valueMax: number };
  width: number;
  height: number;
  invertYAxis?: boolean;
}): string {
  const { points, geometry, width, height, invertYAxis = false } = params;
  const weekSpread = Math.max(1, geometry.weekMax - geometry.weekMin);
  const valueSpread = Math.max(0.0001, geometry.valueMax - geometry.valueMin);

  return points
    .map((point, index) => {
      const x = ((point.week - geometry.weekMin) / weekSpread) * width;
      const y = invertYAxis
        ? ((point.value - geometry.valueMin) / valueSpread) * height
        : height - ((point.value - geometry.valueMin) / valueSpread) * height;
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');
}

function pointPosition(params: {
  point: { week: number; value: number };
  geometry: { weekMin: number; weekMax: number; valueMin: number; valueMax: number };
  width: number;
  height: number;
  invertYAxis?: boolean;
}): { x: number; y: number } {
  const { point, geometry, width, height, invertYAxis = false } = params;
  const weekSpread = Math.max(1, geometry.weekMax - geometry.weekMin);
  const valueSpread = Math.max(0.0001, geometry.valueMax - geometry.valueMin);
  const x = ((point.week - geometry.weekMin) / weekSpread) * width;
  const y = invertYAxis
    ? ((point.value - geometry.valueMin) / valueSpread) * height
    : height - ((point.value - geometry.valueMin) / valueSpread) * height;
  return { x, y };
}

function resolveLeaderIds(metric: MetricKind, rows: TrendRowData[]): Set<string> {
  const candidates = rows.filter((row) => row.latest != null);
  if (candidates.length === 0) return new Set();

  const sorted = [...candidates].sort((left, right) => {
    const leftValue = left.latest ?? 0;
    const rightValue = right.latest ?? 0;
    if (leftValue !== rightValue) {
      return metric === 'games-back' ? leftValue - rightValue : rightValue - leftValue;
    }
    return left.ownerName.localeCompare(right.ownerName);
  });

  return new Set(sorted.slice(0, 3).map((row) => row.ownerId));
}

function resolveLaneLabelOffsets(
  entries: Array<{ ownerId: string; y: number }>,
  minSpacing: number,
  minY: number,
  maxY: number
): Map<string, number> {
  const adjusted = entries.map((entry) => ({ ...entry, adjustedY: entry.y }));

  for (let index = 0; index < adjusted.length; index += 1) {
    const previous = adjusted[index - 1];
    const nextY = previous
      ? Math.max(adjusted[index].y, previous.adjustedY + minSpacing)
      : adjusted[index].y;
    adjusted[index].adjustedY = nextY;
  }

  for (let index = adjusted.length - 2; index >= 0; index -= 1) {
    const next = adjusted[index + 1];
    const nextY = Math.min(adjusted[index].adjustedY, next.adjustedY - minSpacing);
    adjusted[index].adjustedY = nextY;
  }

  const first = adjusted[0];
  if (first && first.adjustedY < minY) {
    const shift = minY - first.adjustedY;
    for (const entry of adjusted) {
      entry.adjustedY += shift;
    }
  }

  const last = adjusted[adjusted.length - 1];
  if (last && last.adjustedY > maxY) {
    const shift = last.adjustedY - maxY;
    for (const entry of adjusted) {
      entry.adjustedY -= shift;
    }
  }

  const offsets = new Map<string, number>();
  for (const entry of adjusted) {
    const clampedY = Math.min(maxY, Math.max(minY, entry.adjustedY));
    offsets.set(entry.ownerId, clampedY - entry.y);
  }

  return offsets;
}

export function estimateEndpointLabelWidth(text: string): number {
  const base = 16;
  const perChar = 7;
  return base + text.length * perChar;
}

export function deriveEndpointLabelLayout(params: {
  entries: EndpointLabelInput[];
  chartWidth: number;
  chartHeight: number;
  labelAreaWidth: number;
  laneCount: number;
  minVerticalSpacing: number;
}): EndpointLabelPlacement[] {
  const { entries, chartWidth, chartHeight, labelAreaWidth, laneCount, minVerticalSpacing } =
    params;
  if (entries.length === 0) return [];
  const safeLaneCount = Math.max(1, laneCount);
  const laneWidth = labelAreaWidth / safeLaneCount;
  const minY = 10;
  const maxY = chartHeight - 10;
  const laneAssignments = new Map<string, number>();
  const laneOccupancy = new Array(safeLaneCount).fill(0);
  const laneLastEndpointY = new Array(safeLaneCount).fill(Number.NEGATIVE_INFINITY);
  const sortedByY = [...entries].sort((left, right) => {
    if (left.endpointY !== right.endpointY) return left.endpointY - right.endpointY;
    return left.owner.localeCompare(right.owner);
  });

  for (const entry of sortedByY) {
    const estimatedWidth = estimateEndpointLabelWidth(entry.text);
    let bestLane = 0;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let lane = 0; lane < safeLaneCount; lane += 1) {
      const overflowPenalty = Math.max(0, estimatedWidth - (laneWidth - 12)) * 2;
      const occupancyPenalty = laneOccupancy[lane] * minVerticalSpacing;
      const localDensityPenalty = Math.max(
        0,
        minVerticalSpacing - Math.abs(entry.endpointY - laneLastEndpointY[lane])
      );
      const laneDistancePenalty = lane * 4;
      const score = overflowPenalty + occupancyPenalty + localDensityPenalty * 3 + laneDistancePenalty;
      if (score < bestScore) {
        bestScore = score;
        bestLane = lane;
      }
    }
    laneAssignments.set(entry.owner, bestLane);
    laneOccupancy[bestLane] += 1;
    laneLastEndpointY[bestLane] = entry.endpointY;
  }

  const laneOffsets = new Map<string, number>();
  for (let lane = 0; lane < safeLaneCount; lane += 1) {
    const laneEntries = sortedByY
      .filter((entry) => laneAssignments.get(entry.owner) === lane)
      .map((entry) => ({ ownerId: entry.owner, y: entry.endpointY }));
    const offsets = resolveLaneLabelOffsets(laneEntries, minVerticalSpacing, minY, maxY);
    for (const [ownerId, offset] of offsets) {
      laneOffsets.set(ownerId, offset);
    }
  }

  return sortedByY.map((entry) => {
    const lane = laneAssignments.get(entry.owner) ?? 0;
    const estimatedWidth = estimateEndpointLabelWidth(entry.text);
    const labelX = chartWidth + 10 + lane * laneWidth;
    const labelY = Math.min(
      maxY,
      Math.max(minY, entry.endpointY + (laneOffsets.get(entry.owner) ?? 0))
    );
    const doglegX = labelX - Math.max(8, Math.min(20, laneWidth * 0.22));
    const connectorStartX = Math.max(0, Math.min(entry.endpointX + 2, doglegX - 2));
    // Exit the chart horizontally before bending toward the staggered label Y,
    // so that clustered lines fan out cleanly rather than crossing diagonally.
    const exitX = Math.min(chartWidth + 4, doglegX - 4);
    return {
      ...entry,
      lane,
      labelX,
      labelY,
      estimatedWidth,
      connectorPoints:
        Math.abs(labelY - entry.endpointY) > 2
          ? [
              { x: connectorStartX, y: entry.endpointY },
              { x: exitX, y: entry.endpointY },
              { x: doglegX, y: labelY },
              { x: labelX - 2, y: labelY },
            ]
          : [
              { x: connectorStartX, y: entry.endpointY },
              { x: labelX - 2, y: labelY },
            ],
    };
  });
}

function resolveOwnerVisualState(params: {
  ownerId: string;
  selectedOwnerId: string | null;
  focusMode: FocusMode;
  topOwnerIds: Set<string>;
}): OwnerVisualState {
  const { ownerId, selectedOwnerId, focusMode, topOwnerIds } = params;
  const selected = selectedOwnerId === ownerId;

  if (focusMode === 'selected') {
    if (!selectedOwnerId) return { selected, muted: false, emphasized: true };
    return { selected, muted: !selected, emphasized: selected };
  }

  if (focusMode === 'top') {
    const emphasized = selected || topOwnerIds.has(ownerId);
    return { selected, muted: !emphasized, emphasized };
  }

  const muted = selectedOwnerId != null && !selected;
  return { selected, muted, emphasized: !muted };
}

/**
 * Extends resolveOwnerVisualState with hover highlight:
 * - When a line is locked (selectedOwnerId set), hover has no effect.
 * - When hovering only, the hovered line is highlighted and others are dimmed to 20%.
 */
function resolveChartVisualState(params: {
  ownerId: string;
  selectedOwnerId: string | null;
  hoveredOwnerId: string | null;
  focusMode: FocusMode;
  topOwnerIds: Set<string>;
}): OwnerVisualState {
  const { ownerId, selectedOwnerId, hoveredOwnerId, focusMode, topOwnerIds } = params;

  // Lock takes precedence — hover does not override a selection.
  if (selectedOwnerId != null) {
    return resolveOwnerVisualState({ ownerId, selectedOwnerId, focusMode, topOwnerIds });
  }

  // Hover highlight: hovered owner prominent, all others dimmed.
  if (hoveredOwnerId != null) {
    const isHovered = ownerId === hoveredOwnerId;
    return { selected: isHovered, muted: !isHovered, emphasized: isHovered };
  }

  return resolveOwnerVisualState({ ownerId, selectedOwnerId: null, focusMode, topOwnerIds });
}

function resolveEmbeddedVisualState(params: {
  ownerId: string;
  hoveredOwnerId: string | null;
  selectedOwnerSet: Set<string>;
}): OwnerVisualState {
  const { ownerId, hoveredOwnerId, selectedOwnerSet } = params;
  const isHovered = ownerId === hoveredOwnerId;
  const isSelected = selectedOwnerSet.has(ownerId);
  const hasAnyHighlight = hoveredOwnerId !== null || selectedOwnerSet.size > 0;
  if (isHovered || isSelected) {
    return { selected: true, muted: false, emphasized: true };
  }
  if (hasAnyHighlight) {
    return { selected: false, muted: true, emphasized: false };
  }
  return { selected: false, muted: false, emphasized: true };
}

function resolveTrendVisualStyle(params: {
  visualState: OwnerVisualState;
  isLeader: boolean;
  isSeriesHovered: boolean;
}) {
  const { visualState, isLeader, isSeriesHovered } = params;
  if (visualState.selected) {
    return {
      strokeWidth: 5.2,
      lineOpacity: 1,
      dotRadius: 4.8,
      dotOpacity: 1,
      anchorDotRadius: 4.2,
    };
  }
  if (visualState.muted) {
    return {
      strokeWidth: isSeriesHovered ? 2.3 : 1.6,
      lineOpacity: 0.18,
      dotRadius: isSeriesHovered ? 2.8 : 2.2,
      dotOpacity: 0.28,
      anchorDotRadius: 2.2,
    };
  }
  return {
    strokeWidth: isSeriesHovered ? 3.4 : isLeader ? 3.1 : 2.6,
    lineOpacity: isLeader ? 0.94 : 0.78,
    dotRadius: isSeriesHovered ? 3.8 : 3,
    dotOpacity: 0.92,
    anchorDotRadius: isLeader ? 3 : 2.6,
  };
}

function MobileLegend({
  rows,
  hoveredOwnerId,
  selectedOwnerSet,
  onToggle,
  getColor,
  chartHeight,
}: {
  rows: TrendRowData[];
  hoveredOwnerId: string | null;
  selectedOwnerSet: Set<string>;
  onToggle: ((ownerId: string) => void) | undefined;
  getColor: (ownerId: string) => string;
  chartHeight: number;
}): React.ReactElement {
  const hasHighlight = hoveredOwnerId !== null || selectedOwnerSet.size > 0;
  return (
    <div
      className="w-[80px] shrink-0 overflow-y-auto pr-1 sm:hidden"
      style={{ maxHeight: chartHeight }}
      aria-label="Owner legend"
    >
      {rows.map((row) => {
        const isSelected = selectedOwnerSet.has(row.ownerId);
        const isHovered = hoveredOwnerId === row.ownerId;
        const isActive = isSelected || isHovered;
        const color = getColor(row.ownerId);
        return (
          <button
            key={row.ownerId}
            type="button"
            className="flex w-full items-center gap-1.5 rounded px-1 py-1 text-left"
            style={{
              backgroundColor: isActive ? hslAlpha(color, 0.15) : undefined,
              opacity: hasHighlight && !isActive ? 0.2 : 1,
            }}
            onClick={() => onToggle?.(row.ownerId)}
            aria-label={row.ownerName}
          >
            <span
              className="h-[7px] w-[7px] shrink-0 rounded-full"
              style={{ backgroundColor: color }}
              aria-hidden="true"
            />
            <span className="truncate text-[11px] text-gray-800 dark:text-zinc-200">
              {row.ownerName}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function SharedTrendChart({
  title,
  metric,
  rows,
  focusedOwnerIds,
  selectedOwnerId,
  onSelectOwner,
  viewportWidth,
  getOwnerTrendColor,
  heightScale = 1.0,
  focusMode = 'all',
  multiSelectedOwnerIds,
  onMultiSelectToggle,
  hideLegend = false,
  hideTitle = false,
  externalHoveredOwnerId,
  onHoverChange,
}: {
  title: string;
  metric: MetricKind;
  rows: TrendRowData[];
  focusedOwnerIds: Set<string>;
  selectedOwnerId: string | null;
  onSelectOwner: (ownerId: string) => void;
  viewportWidth: number;
  getOwnerTrendColor: (ownerId: string) => string;
  heightScale?: number;
  focusMode?: FocusMode;
  multiSelectedOwnerIds?: Set<string>;
  onMultiSelectToggle?: (ownerId: string) => void;
  hideLegend?: boolean;
  hideTitle?: boolean;
  externalHoveredOwnerId?: string | null;
  onHoverChange?: (ownerId: string | null) => void;
}): React.ReactElement {
  const [hoverState, setHoverState] = React.useState<HoverState | null>(null);
  const [hoveredOwnerId, setHoveredOwnerId] = React.useState<string | null>(null);
const effectiveHoveredOwnerId = externalHoveredOwnerId ?? hoveredOwnerId;
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const hasScrolledRef = React.useRef(false);
  const [containerWidth, setContainerWidth] = React.useState(0);

  if (rows.length === 0) {
    return (
      <section className="rounded-xl border border-gray-200 bg-gray-50/70 p-4 dark:border-zinc-800 dark:bg-zinc-900/60">
        {!hideTitle ? (
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-600 dark:text-zinc-300">
            {title}
          </h2>
        ) : null}
        <p className="mt-2 text-sm text-gray-500 dark:text-zinc-400">
          No trend data available yet.
        </p>
      </section>
    );
  }

  const rawGeometry = buildSharedChartGeometry(rows);
  const geometry = (() => {
    if (!rawGeometry || metric !== 'win-pct') return rawGeometry;

    // Build a week-ordered list of all data points so we can find the first week
    // where win% values have converged enough to use as the domain baseline.
    // Early weeks (e.g. W1 where owners are 1-0 or 0-1) cause extreme spread that
    // would make the Y-axis span [0, 1] for the rest of the season.
    const weekSet = Array.from(
      new Set(rows.flatMap((row) => row.points.map((p) => p.week)))
    ).sort((a, b) => a - b);

    // Build a lookup: week → list of values for that week
    const valuesByWeek = new Map<number, number[]>();
    for (const row of rows) {
      for (const point of row.points) {
        const existing = valuesByWeek.get(point.week);
        if (existing) {
          existing.push(point.value);
        } else {
          valuesByWeek.set(point.week, [point.value]);
        }
      }
    }

    // Find the first week where spread (max - min) across all owners drops below 0.35.
    const CONVERGENCE_THRESHOLD = 0.35;
    let convergedFromWeek: number | null = null;
    for (const week of weekSet) {
      const vals = valuesByWeek.get(week) ?? [];
      if (vals.length < 2) continue;
      const spread = Math.max(...vals) - Math.min(...vals);
      if (spread < CONVERGENCE_THRESHOLD) {
        convergedFromWeek = week;
        break;
      }
    }

    // Use converged weeks for domain calculation; fall back to all weeks if never converged.
    const domainWeeks =
      convergedFromWeek !== null
        ? weekSet.filter((w) => w >= convergedFromWeek!)
        : weekSet;

    const domainPoints = rows.flatMap((row) =>
      row.points.filter((p) => domainWeeks.includes(p.week))
    );
    const domainMin =
      domainPoints.length > 0 ? Math.min(...domainPoints.map((p) => p.value)) : rawGeometry.valueMin;
    const domainMax =
      domainPoints.length > 0 ? Math.max(...domainPoints.map((p) => p.value)) : rawGeometry.valueMax;

    return {
      ...rawGeometry,
      valueMin: Math.max(0, domainMin - 0.01),
      valueMax: Math.min(1, domainMax + 0.01),
    };
  })();
  const invertYAxis = metric === 'games-back';
  const weeks = Array.from(
    new Set(rows.flatMap((row) => row.points.map((point) => point.week)))
  ).sort((left, right) => left - right);
  const responsiveLayout = deriveResponsiveTrendLayout({
    viewportWidth,
    weekCount: weeks.length,
  });
  const chartHeight = Math.round(responsiveLayout.chartHeight * heightScale);
  const plotHeight = chartHeight - 26;
  const pxPerWeek = responsiveLayout.pxPerWeek;
  const chartWidth = deriveDynamicPlotWidth({
    containerWidth,
    weekCount: weeks.length,
    pxPerWeek,
  });
  const totalChartWidth = chartWidth + 32;
  const leaderIds = resolveLeaderIds(metric, rows);
  const topOwnerIds = React.useMemo(
    () =>
      new Set(
        [...rows]
          .sort((left, right) => {
            const leftValue = left.latest ?? 0;
            const rightValue = right.latest ?? 0;
            if (leftValue !== rightValue) {
              return metric === 'games-back' ? leftValue - rightValue : rightValue - leftValue;
            }
            return left.ownerName.localeCompare(right.ownerName);
          })
          .slice(0, TOP_FOCUS_COUNT)
          .map((row) => row.ownerId)
      ),
    [metric, rows]
  );
  const weekTicks = deriveAllWeekTicks(weeks);

  React.useEffect(() => {
    const target = containerRef.current;
    if (!target || typeof window === 'undefined') return;

    const measure = () => {
      const width = target.getBoundingClientRect().width;
      if (width > 0) setContainerWidth(width);
    };
    measure();

    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setContainerWidth(entry.contentRect.width);
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  React.useEffect(() => {
    if (hasScrolledRef.current) return;
    const container = containerRef.current;
    if (!container) return;
    const maxScroll = container.scrollWidth - container.clientWidth;
    if (maxScroll <= 0) return;
    container.scrollLeft = maxScroll;
    hasScrolledRef.current = true;
  }, [chartWidth]);
  return (
    <section className="rounded-xl border border-gray-200 bg-gray-50/70 p-4 dark:border-zinc-800 dark:bg-zinc-900/60">
      {!hideTitle ? (
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-600 dark:text-zinc-300">
          {title}
        </h2>
      ) : null}

      <div className="mt-3 flex items-start sm:block">
        <MobileLegend
          rows={rows}
          hoveredOwnerId={effectiveHoveredOwnerId}
          selectedOwnerSet={multiSelectedOwnerIds ?? new Set()}
          onToggle={(ownerId) =>
            hideLegend || focusMode === 'selected'
              ? onMultiSelectToggle?.(ownerId)
              : onSelectOwner(ownerId)
          }
          getColor={getOwnerTrendColor}
          chartHeight={chartHeight}
        />

        <div
          ref={containerRef}
          data-trend-scroll-container={metric}
          className={`min-w-0 flex-1 overflow-x-auto rounded-md border border-gray-200 bg-white ${responsiveLayout.chartPaddingClass} dark:border-zinc-700 dark:bg-zinc-900 sm:flex-none`}
          onMouseLeave={() => { setHoveredOwnerId(null); onHoverChange?.(null); }}
        >
        {focusMode === 'selected' && focusedOwnerIds.size === 0 ? (
          <div
            className="flex items-center justify-center text-sm text-gray-400 dark:text-zinc-500"
            style={{ height: `${chartHeight}px` }}
            data-chart-empty-selected
          >
            Select owners from the legend below
          </div>
        ) : geometry ? (
          <div
            style={{ width: `${totalChartWidth}px` }}
            data-plot-width={chartWidth}
            data-container-width={containerWidth}
            data-chart-height={chartHeight}
            data-tick-step={responsiveLayout.tickStep}
            data-show-right-labels={responsiveLayout.showRightEdgeLabels ? 'true' : 'false'}
          >
            <svg
              viewBox={`0 0 ${totalChartWidth} ${chartHeight}`}
              className="w-full"
              style={{ height: `${chartHeight}px` }}
              role="img"
              aria-label={`${title} shared trend chart`}
              data-y-domain={invertYAxis ? JSON.stringify([geometry.valueMax, 0]) : 'auto'}
            >
              {weekTicks.map((tick) => {
                const x =
                  ((tick.value - geometry.weekMin) /
                    Math.max(1, geometry.weekMax - geometry.weekMin)) *
                  chartWidth;
                return (
                  <line
                    key={`${metric}-grid-${tick.value}`}
                    x1={x}
                    y1={0}
                    x2={x}
                    y2={plotHeight}
                    stroke="currentColor"
                    opacity={0.15}
                    data-week-grid-line={tick.label}
                  />
                );
              })}
              {/* Per-week invisible hit zones — spans full column width */}
              {weeks.map((week) => {
                const x =
                  ((week - geometry.weekMin) /
                    Math.max(1, geometry.weekMax - geometry.weekMin)) *
                  chartWidth;
                const colWidth = Math.max(8, pxPerWeek * 0.9);
                return (
                  <rect
                    key={`${metric}-week-hit-${week}`}
                    x={x - colWidth / 2}
                    y={0}
                    width={colWidth}
                    height={plotHeight}
                    fill="transparent"
                    pointerEvents="all"
                    style={{ cursor: 'crosshair' }}
                    data-week-hit-zone={week}
                  />
                );
              })}
              {weekTicks.map((tick) => {
                const x =
                  ((tick.value - geometry.weekMin) /
                    Math.max(1, geometry.weekMax - geometry.weekMin)) *
                  chartWidth;
                return (
                  <g
                    key={`${metric}-tick-${tick.value}`}
                    data-week-tick={tick.label}
                    style={{ cursor: 'crosshair' }}
                  >
                    <line
                      x1={x}
                      y1={chartHeight - 24}
                      x2={x}
                      y2={chartHeight - 18}
                      stroke="currentColor"
                      opacity={0.5}
                    />
                    <text
                      x={x}
                      y={chartHeight - 6}
                      textAnchor="middle"
                      fontSize="10"
                      fill="currentColor"
                      opacity={0.7}
                    >
                      {tick.value === weeks[weeks.length - 1] ? 'Final' : tick.label}
                    </text>
                  </g>
                );
              })}
              {rows.map((row) => {
                const isFocused = focusedOwnerIds.has(row.ownerId);
                if (!isFocused) return null;
                const visualState = hideLegend
                  ? resolveEmbeddedVisualState({ ownerId: row.ownerId, hoveredOwnerId: effectiveHoveredOwnerId, selectedOwnerSet: multiSelectedOwnerIds ?? new Set() })
                  : resolveChartVisualState({
                      ownerId: row.ownerId,
                      selectedOwnerId,
                      hoveredOwnerId,
                      focusMode,
                      topOwnerIds,
                    });
                const isLeader = leaderIds.has(row.ownerId);
                const isSeriesHovered = hoverState?.ownerName === row.ownerName || effectiveHoveredOwnerId === row.ownerId;
                const trendStyle = resolveTrendVisualStyle({
                  visualState,
                  isLeader,
                  isSeriesHovered,
                });
                return (
                  <path
                    key={`${metric}-line-${row.ownerId}`}
                    d={buildSeriesPath({
                      points: row.points,
                      geometry,
                      width: chartWidth,
                      height: plotHeight,
                      invertYAxis,
                    })}
                    fill="none"
                    stroke={getOwnerTrendColor(row.ownerId)}
                    strokeWidth={trendStyle.strokeWidth}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity={trendStyle.lineOpacity}
                    data-leader-emphasis={isLeader ? 'true' : 'false'}
                    data-owner-id={row.ownerId}
                    data-selected={visualState.selected ? 'true' : 'false'}
                    data-muted={visualState.muted ? 'true' : 'false'}
                    data-emphasized={visualState.emphasized ? 'true' : 'false'}
                  />
                );
              })}
              {/* Wide transparent overlay paths for per-line hover and click */}
              {rows.map((row) => {
                if (!focusedOwnerIds.has(row.ownerId)) return null;
                const seriesPath = buildSeriesPath({
                  points: row.points,
                  geometry,
                  width: chartWidth,
                  height: plotHeight,
                  invertYAxis,
                });
                return (
                  <path
                    key={`${metric}-hover-overlay-${row.ownerId}`}
                    d={seriesPath}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={16}
                    pointerEvents="stroke"
                    style={{ cursor: 'pointer' }}
                    onMouseEnter={() => { setHoveredOwnerId(row.ownerId); onHoverChange?.(row.ownerId); }}
                    onMouseLeave={() => { setHoveredOwnerId(null); onHoverChange?.(null); }}
                    onClick={() => (hideLegend || focusMode === 'selected') ? onMultiSelectToggle?.(row.ownerId) : onSelectOwner(row.ownerId)}
                    data-hover-line={row.ownerId}
                  />
                );
              })}
              {rows.flatMap((row) => {
                const isFocused = focusedOwnerIds.has(row.ownerId);
                if (!isFocused) return [];
                const visualState = hideLegend
                  ? resolveEmbeddedVisualState({ ownerId: row.ownerId, hoveredOwnerId: effectiveHoveredOwnerId, selectedOwnerSet: multiSelectedOwnerIds ?? new Set() })
                  : resolveChartVisualState({
                      ownerId: row.ownerId,
                      selectedOwnerId,
                      hoveredOwnerId,
                      focusMode,
                      topOwnerIds,
                    });
                return row.points.map((point) => {
                  const pos = pointPosition({
                    point,
                    geometry,
                    width: chartWidth,
                    height: plotHeight,
                    invertYAxis,
                  });
                  const isPointHovered =
                    hoverState?.ownerName === row.ownerName &&
                    hoverState.week === point.week &&
                    hoverState.metric === metric;
                  const trendStyle = resolveTrendVisualStyle({
                    visualState,
                    isLeader: leaderIds.has(row.ownerId),
                    isSeriesHovered: isPointHovered,
                  });
                  return (
                    <g key={`${metric}-${row.ownerId}-point-${point.week}`}>
                      <circle
                        cx={pos.x}
                        cy={pos.y}
                        r={10}
                        fill="transparent"
                        pointerEvents="all"
                        data-hover-target={`${metric}-${row.ownerId}-${point.week}`}
                        onMouseEnter={() => {
                          setHoverState({ x: pos.x, y: pos.y, ownerName: row.ownerName, metric, week: point.week, value: point.value });
                          setHoveredOwnerId(row.ownerId);
                          onHoverChange?.(row.ownerId);
                        }}
                        onMouseLeave={() => { setHoverState(null); setHoveredOwnerId(null); onHoverChange?.(null); }}
                        onClick={() => {
                          setHoverState({ x: pos.x, y: pos.y, ownerName: row.ownerName, metric, week: point.week, value: point.value });
                        }}
                        onTouchStart={() => {
                          setHoverState({ x: pos.x, y: pos.y, ownerName: row.ownerName, metric, week: point.week, value: point.value });
                          setHoveredOwnerId(row.ownerId);
                        }}
                      />
                      <circle
                        cx={pos.x}
                        cy={pos.y}
                        r={isPointHovered ? trendStyle.dotRadius + 1.8 : trendStyle.dotRadius}
                        fill={getOwnerTrendColor(row.ownerId)}
                        opacity={trendStyle.dotOpacity}
                        pointerEvents="none"
                      />
                    </g>
                  );
                });
              })}

              {hoverState ? (
                <g data-trend-tooltip={metric} pointerEvents="none">
                  {(() => {
                    const tooltip = formatTrendTooltip(hoverState);
                    const tooltipWidth = 136;
                    const tooltipHeight = 52;
                    const x = Math.min(
                      totalChartWidth - tooltipWidth - 4,
                      Math.max(4, hoverState.x + 10)
                    );
                    const y = Math.min(
                      plotHeight - tooltipHeight - 4,
                      Math.max(4, hoverState.y - tooltipHeight / 2)
                    );
                    return (
                      <>
                        <rect
                          x={x}
                          y={y}
                          width={tooltipWidth}
                          height={tooltipHeight}
                          rx={6}
                          ry={6}
                          fill="rgb(24 24 27 / 0.95)"
                          stroke="rgb(63 63 70)"
                        />
                        <text x={x + 8} y={y + 14} fontSize="10" fill="rgb(161 161 170)">
                          {tooltip.weekLabel}
                        </text>
                        <text x={x + 8} y={y + 29} fontSize="11" fill="white" fontWeight={600}>
                          {hoverState.ownerName}
                        </text>
                        <text x={x + 8} y={y + 44} fontSize="10" fill="rgb(228 228 231)">
                          {tooltip.valueLabel}
                        </text>
                      </>
                    );
                  })()}
                </g>
              ) : null}
            </svg>
          </div>
        ) : null}
        </div>
      </div>

    </section>
  );
}

export default function TrendsDetailSurface({
  standingsHistory,
  season,
  seasonContext,
  issues,
  ownerColorMap = {},
  layoutMode = 'standalone',
  compact = false,
  showMomentum = true,
  externalHoveredOwnerId,
  externalSelectedOwnerSet,
  onExternalHoverChange,
  onExternalToggleOwner,
}: {
  standingsHistory: StandingsHistory | null;
  season: number;
  seasonContext: SeasonContext | null;
  issues: string[];
  ownerColorMap?: Record<string, string>;
  layoutMode?: LayoutMode;
  compact?: boolean;
  showMomentum?: boolean;
  externalHoveredOwnerId?: string | null;
  externalSelectedOwnerSet?: Set<string>;
  onExternalHoverChange?: (ownerId: string | null) => void;
  onExternalToggleOwner?: (ownerId: string) => void;
}): React.ReactElement {
  const [selectedOwnerId, setSelectedOwnerId] = React.useState<string | null>(null);
  const [selectedOwnerSet, setSelectedOwnerSet] = React.useState<Set<string>>(() => new Set());
  const [focusMode, setFocusMode] = React.useState<FocusMode>('all');
  const [activeMetric, setActiveMetric] = React.useState<MetricKind>('games-back');
  const [viewportWidth, setViewportWidth] = React.useState(() =>
    typeof window === 'undefined' ? 1024 : window.innerWidth
  );
  const isControlled = externalSelectedOwnerSet !== undefined;

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const gamesBackTrend = standingsHistory ? selectGamesBackTrend({ standingsHistory }) : [];
  const winPctTrend = standingsHistory ? selectWinPctTrend({ standingsHistory }) : [];
  const winBars = standingsHistory ? selectWinBars({ standingsHistory }) : [];
  const momentum = standingsHistory ? selectOwnerMomentum({ standingsHistory, windowSize: 3 }) : [];

  const gamesBackRows: TrendRowData[] = gamesBackTrend
    .filter((entry) => entry.ownerId !== 'NoClaim')
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
    .filter((entry) => entry.ownerId !== 'NoClaim')
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

  const topMomentum = momentum.slice(0, 3);
  const topMomentumOwnerIds = new Set(topMomentum.map((entry) => entry.ownerId));
  const bottomMomentum = [...momentum]
    .filter((entry) => !topMomentumOwnerIds.has(entry.ownerId))
    .reverse()
    .slice(0, 3);
  const selectedWinBar = selectedOwnerId
    ? winBars.find((row) => row.ownerId === selectedOwnerId)
    : null;
  const selectedGamesBack = selectedOwnerId
    ? (gamesBackRows.find((row) => row.ownerId === selectedOwnerId)?.latest ?? null)
    : null;
  const selectedWinPct = selectedOwnerId
    ? (winPctRows.find((row) => row.ownerId === selectedOwnerId)?.latest ?? null)
    : null;
  const selectedMomentum = selectedOwnerId
    ? (momentum.find((row) => row.ownerId === selectedOwnerId) ?? null)
    : null;
  const selectedRank = selectedOwnerId
    ? Math.max(1, winBars.findIndex((row) => row.ownerId === selectedOwnerId) + 1)
    : null;
  const topOwnerIds = React.useMemo(
    () => new Set(winBars.slice(0, TOP_FOCUS_COUNT).map((row) => row.ownerId)),
    [winBars]
  );
  const orderedOwners = React.useMemo(() => winBars.map((row) => row.ownerId), [winBars]);
  const getOwnerTrendColor = React.useCallback(
    (ownerId: string) => ownerColorMap[ownerId] ?? '#888',
    [ownerColorMap]
  );
  const focusedOwners = React.useMemo(() => {
    if (isControlled) return orderedOwners;
    if (focusMode === 'selected') {
      return Array.from(selectedOwnerSet);
    }
    return deriveFocusedOwners({
      focusMode,
      selectedOwners: selectedOwnerId ? new Set([selectedOwnerId]) : new Set<string>(),
      orderedOwners,
      topN: TOP_FOCUS_COUNT,
    });
  }, [focusMode, isControlled, orderedOwners, selectedOwnerId, selectedOwnerSet]);
  const focusedOwnerIdSet = React.useMemo(() => new Set(focusedOwners), [focusedOwners]);
  const compactWinBars = compact || viewportWidth < 640;
  const handleOwnerToggle = React.useCallback((ownerId: string) => {
    setSelectedOwnerId((current) => toggleSelectedOwner(current, ownerId));
  }, []);
  const handleSelectedSetToggle = React.useCallback((ownerId: string) => {
    setSelectedOwnerSet((current) => {
      const next = new Set(current);
      if (next.has(ownerId)) {
        next.delete(ownerId);
      } else {
        next.add(ownerId);
      }
      return next;
    });
  }, []);
  const handleFocusModeChange = React.useCallback((mode: FocusMode) => {
    setFocusMode(mode);
    setSelectedOwnerId(null);
  }, []);

  const WrapperTag = layoutMode === 'standalone' ? 'main' : 'div';

  return (
    <WrapperTag
      className={
        layoutMode === 'standalone'
          ? `mx-auto w-full max-w-5xl space-y-4 ${compact ? 'p-3 sm:p-4' : 'p-4 sm:p-6'}`
          : compact
            ? 'space-y-3'
            : 'space-y-4'
      }
    >
      {layoutMode === 'standalone' ? (
        <header>
          <h1 className="text-2xl font-bold tracking-tight text-gray-950 dark:text-zinc-50">
            League Trends Detail
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-zinc-300">
            Season {season} · {seasonContextLabel(seasonContext)}
          </p>
        </header>
      ) : isControlled ? null : (
        <header>
          <h3 className="text-lg font-semibold tracking-tight text-gray-950 dark:text-zinc-50">
            Trends
          </h3>
          <p className="mt-1 text-xs text-gray-600 dark:text-zinc-300">
            Season {season} · {seasonContextLabel(seasonContext)}
          </p>
        </header>
      )}

      {!isControlled && selectedOwnerId && selectedWinBar && selectedRank != null ? (
        <section
          className="rounded-xl border border-blue-300 bg-blue-50/80 p-3 dark:border-blue-700 dark:bg-blue-950/30"
          data-owner-focus="true"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-800 dark:text-blue-200">
            Owner Focus
          </p>
          <div className="mt-1.5 flex items-center gap-2">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: getOwnerTrendColor(selectedOwnerId) }}
              aria-hidden="true"
            />
            <p
              className="text-sm font-semibold text-blue-900 dark:text-blue-100"
              data-owner-focus-name
            >
              {selectedOwnerId}
            </p>
          </div>
          <p className="mt-1 text-xs text-blue-900 dark:text-blue-100">
            Rank: {formatRank(selectedRank)} · Games Back:{' '}
            {selectedGamesBack == null ? '—' : selectedGamesBack.toFixed(1)} · Win %:{' '}
            {selectedWinPct == null ? '—' : formatWinPct(selectedWinPct)}
          </p>
          <p className="mt-1 text-xs text-blue-900 dark:text-blue-100" data-owner-focus-momentum>
            Last 3 weeks:{' '}
            {selectedMomentum
              ? `${selectedMomentum.deltaWins >= 0 ? '+' : ''}${selectedMomentum.deltaWins} wins, ${formatSignedMetricValue('games-back', selectedMomentum.deltaGamesBack)} GB`
              : 'No momentum data'}
          </p>
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

      {!isControlled ? (
        <section className="rounded-lg border border-gray-300 bg-gray-50/80 p-2 dark:border-zinc-700 dark:bg-zinc-900/70">
          <div
            className="inline-flex rounded-md border border-gray-200 bg-gray-50 p-1 dark:border-zinc-700 dark:bg-zinc-900"
            role="group"
            aria-label="Chart focus mode controls"
          >
            {(
              [
                { mode: 'all', label: 'All' },
                { mode: 'top', label: `Top ${TOP_FOCUS_COUNT}` },
                {
                  mode: 'selected',
                  label: selectedOwnerSet.size > 0 ? `Selected (${selectedOwnerSet.size})` : 'Selected',
                },
              ] as const
            ).map(({ mode, label }) => (
              <button
                key={mode}
                type="button"
                className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                  focusMode === mode
                    ? 'bg-white text-gray-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100'
                    : 'text-gray-600 hover:text-gray-900 dark:text-zinc-300 dark:hover:text-zinc-100'
                }`}
                aria-pressed={focusMode === mode}
                onClick={() => handleFocusModeChange(mode)}
                data-focus-mode-control={mode}
              >
                {label}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {!isControlled ? (
        <p className="text-xs text-gray-500 dark:text-zinc-400">Click lines to compare</p>
      ) : null}

      <div>
        <nav
          className="mb-3 flex items-center gap-6 border-b border-gray-200 dark:border-zinc-700"
          aria-label="Chart metric tabs"
        >
          {(
            [
              { metric: 'games-back' as MetricKind, label: 'Games Back' },
              { metric: 'win-pct' as MetricKind, label: 'Win %' },
            ] as const
          ).map(({ metric: m, label }) => {
            const isActive = activeMetric === m;
            return (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveMetric(m)}
                className={`pb-2.5 -mb-px text-sm font-medium transition-colors whitespace-nowrap border-b-[1.5px] ${
                  isActive
                    ? 'border-gray-800 text-gray-900 dark:border-zinc-100 dark:text-zinc-100'
                    : 'border-transparent text-gray-400 hover:text-gray-600 dark:text-zinc-500 dark:hover:text-zinc-300'
                }`}
                data-chart-tab={m}
              >
                {label}
              </button>
            );
          })}
        </nav>

        {activeMetric === 'games-back' ? (
          <SharedTrendChart
            title="Games Back"
            metric="games-back"
            rows={gamesBackRows}
            focusedOwnerIds={focusedOwnerIdSet}
            selectedOwnerId={selectedOwnerId}
            viewportWidth={viewportWidth}
            onSelectOwner={handleOwnerToggle}
            getOwnerTrendColor={getOwnerTrendColor}
            heightScale={1.6}
            focusMode={focusMode}
            multiSelectedOwnerIds={isControlled ? externalSelectedOwnerSet : selectedOwnerSet}
            onMultiSelectToggle={isControlled ? onExternalToggleOwner : handleSelectedSetToggle}
            hideLegend={isControlled}
            hideTitle
            externalHoveredOwnerId={isControlled ? (externalHoveredOwnerId ?? null) : undefined}
            onHoverChange={isControlled ? onExternalHoverChange : undefined}
          />
        ) : (
          <SharedTrendChart
            title="Win %"
            metric="win-pct"
            rows={winPctRows}
            focusedOwnerIds={focusedOwnerIdSet}
            selectedOwnerId={selectedOwnerId}
            viewportWidth={viewportWidth}
            onSelectOwner={handleOwnerToggle}
            getOwnerTrendColor={getOwnerTrendColor}
            heightScale={1.6}
            focusMode={focusMode}
            multiSelectedOwnerIds={isControlled ? externalSelectedOwnerSet : selectedOwnerSet}
            onMultiSelectToggle={isControlled ? onExternalToggleOwner : handleSelectedSetToggle}
            hideLegend={isControlled}
            hideTitle
            externalHoveredOwnerId={isControlled ? (externalHoveredOwnerId ?? null) : undefined}
            onHoverChange={isControlled ? onExternalHoverChange : undefined}
          />
        )}
      </div>

      {showMomentum ? (
        <section
          className={`rounded-xl border border-gray-200 bg-gray-50/70 ${compactWinBars ? 'p-3' : 'p-3.5'} dark:border-zinc-800 dark:bg-zinc-900/60`}
        >
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-600 dark:text-zinc-300">
            Recent Momentum
          </h2>
          {momentum.length === 0 ? (
            <p className="mt-2 text-sm text-gray-500 dark:text-zinc-400">
              No momentum data available yet.
            </p>
          ) : (
            <div className="mt-2 grid gap-3 md:grid-cols-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-zinc-400">
                  Top gainers (last 3 weeks)
                </p>
                <ul className="mt-1.5 space-y-1.5 text-sm">
                  {topMomentum.map((entry) => {
                    const visualState = resolveOwnerVisualState({
                      ownerId: entry.ownerId,
                      selectedOwnerId,
                      focusMode,
                      topOwnerIds,
                    });
                    return (
                      <li
                        key={`momentum-top-${entry.ownerId}`}
                        className={`rounded-md border border-gray-200 bg-white px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-900 ${visualState.muted ? 'opacity-45' : ''} ${visualState.selected ? 'ring-1 ring-blue-400 dark:ring-blue-500' : ''}`}
                        data-momentum-owner={entry.ownerId}
                        data-selected={visualState.selected ? 'true' : 'false'}
                        data-muted={visualState.muted ? 'true' : 'false'}
                        data-emphasized={visualState.emphasized ? 'true' : 'false'}
                      >
                        <button
                          type="button"
                          className="flex w-full items-center justify-between gap-2 text-left"
                          onClick={() => handleOwnerToggle(entry.ownerId)}
                        >
                          <span className="flex items-center gap-2">
                            <span
                              aria-hidden="true"
                              className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                              style={{ backgroundColor: getOwnerTrendColor(entry.ownerId) }}
                            />
                            <span className="font-medium">{entry.ownerId}</span>
                          </span>
                          <span>
                            {entry.deltaWins >= 0 ? '+' : ''}
                            {entry.deltaWins} wins · GB{' '}
                            {formatSignedMetricValue('games-back', entry.deltaGamesBack)}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-zinc-400">
                  Cooldowns (last 3 weeks)
                </p>
                <ul className="mt-1.5 space-y-1.5 text-sm">
                  {bottomMomentum.map((entry) => {
                    const visualState = resolveOwnerVisualState({
                      ownerId: entry.ownerId,
                      selectedOwnerId,
                      focusMode,
                      topOwnerIds,
                    });
                    return (
                      <li
                        key={`momentum-bottom-${entry.ownerId}`}
                        className={`rounded-md border border-gray-200 bg-white px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-900 ${visualState.muted ? 'opacity-45' : ''} ${visualState.selected ? 'ring-1 ring-blue-400 dark:ring-blue-500' : ''}`}
                        data-momentum-owner={entry.ownerId}
                        data-selected={visualState.selected ? 'true' : 'false'}
                        data-muted={visualState.muted ? 'true' : 'false'}
                        data-emphasized={visualState.emphasized ? 'true' : 'false'}
                      >
                        <button
                          type="button"
                          className="flex w-full items-center justify-between gap-2 text-left"
                          onClick={() => handleOwnerToggle(entry.ownerId)}
                        >
                          <span className="flex items-center gap-2">
                            <span
                              aria-hidden="true"
                              className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                              style={{ backgroundColor: getOwnerTrendColor(entry.ownerId) }}
                            />
                            <span className="font-medium">{entry.ownerId}</span>
                          </span>
                          <span>
                            {entry.deltaWins >= 0 ? '+' : ''}
                            {entry.deltaWins} wins · Win%{' '}
                            {formatSignedMetricValue('win-pct', entry.deltaWinPct)}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          )}
        </section>
      ) : null}
    </WrapperTag>
  );
}

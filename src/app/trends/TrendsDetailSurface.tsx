'use client';

import React from 'react';

import { selectOwnerMomentum } from '../../lib/selectors/momentum';
import { type SeasonContext } from '../../lib/selectors/seasonContext';
import { selectGamesBackTrend, selectWinBars, selectWinPctTrend } from '../../lib/selectors/trends';
import type { StandingsHistory } from '../../lib/standingsHistory';
import { getOwnerTrendColor } from './presentationColors';

type MetricKind = 'games-back' | 'win-pct';
type LayoutMode = 'standalone' | 'embedded';
type FocusMode = 'all' | 'top' | 'selected';

const TOP_FOCUS_COUNT = 5;

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

type OwnerVisualState = {
  selected: boolean;
  muted: boolean;
  emphasized: boolean;
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

function formatMetricLabelValue(metric: MetricKind, value: number | null): string {
  if (value == null) return '—';
  return formatMetricValue(metric, value);
}

function formatLabelOwnerName(ownerName: string): string {
  const maxLength = 12;
  if (ownerName.length <= maxLength) return ownerName;
  return `${ownerName.slice(0, maxLength - 1)}…`;
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
}): string {
  const { points, geometry, width, height } = params;
  const weekSpread = Math.max(1, geometry.weekMax - geometry.weekMin);
  const valueSpread = Math.max(0.0001, geometry.valueMax - geometry.valueMin);

  return points
    .map((point, index) => {
      const x = ((point.week - geometry.weekMin) / weekSpread) * width;
      const y = height - ((point.value - geometry.valueMin) / valueSpread) * height;
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');
}

function pointPosition(params: {
  point: { week: number; value: number };
  geometry: { weekMin: number; weekMax: number; valueMin: number; valueMax: number };
  width: number;
  height: number;
}): { x: number; y: number } {
  const { point, geometry, width, height } = params;
  const weekSpread = Math.max(1, geometry.weekMax - geometry.weekMin);
  const valueSpread = Math.max(0.0001, geometry.valueMax - geometry.valueMin);
  const x = ((point.week - geometry.weekMin) / weekSpread) * width;
  const y = height - ((point.value - geometry.valueMin) / valueSpread) * height;
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

function resolveLatestLabelOffsets(
  rows: TrendRowData[],
  geometry: {
    weekMin: number;
    weekMax: number;
    valueMin: number;
    valueMax: number;
  }
): Map<string, number> {
  const chartHeight = 232;
  const entries = rows
    .map((row) => {
      const latestPoint = row.points[row.points.length - 1];
      if (!latestPoint) return null;
      return {
        ownerId: row.ownerId,
        y: pointPosition({ point: latestPoint, geometry, width: 640, height: chartHeight }).y,
      };
    })
    .filter((entry): entry is { ownerId: string; y: number } => entry != null)
    .sort((left, right) => left.y - right.y);

  const minSpacing = 16;
  const minY = 12;
  const maxY = chartHeight - 12;
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

function SharedTrendChart({
  title,
  metric,
  rows,
  selectedOwnerId,
  focusMode,
  topOwnerIds,
  onSelectOwner,
  onHover,
  onHoverLeave,
}: {
  title: string;
  metric: MetricKind;
  rows: TrendRowData[];
  selectedOwnerId: string | null;
  focusMode: FocusMode;
  topOwnerIds: Set<string>;
  onSelectOwner: (ownerId: string) => void;
  onHover: (payload: HoverState) => void;
  onHoverLeave: () => void;
}): React.ReactElement {
  if (rows.length === 0) {
    return (
      <section className="rounded-xl border border-gray-200 bg-gray-50/70 p-4 dark:border-zinc-800 dark:bg-zinc-900/60">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-600 dark:text-zinc-300">
          {title}
        </h2>
        <p className="mt-2 text-sm text-gray-500 dark:text-zinc-400">
          No trend data available yet.
        </p>
      </section>
    );
  }

  const geometry = buildSharedChartGeometry(rows);
  const chartWidth = 640;
  const chartHeight = 232;
  const labelLaneWidth = 212;
  const leaderIds = resolveLeaderIds(metric, rows);
  const labelOffsets = geometry
    ? resolveLatestLabelOffsets(rows, geometry)
    : new Map<string, number>();
  const rankByOwnerId = new Map(rows.map((row, index) => [row.ownerId, index + 1]));

  return (
    <section className="rounded-xl border border-gray-200 bg-gray-50/70 p-4 dark:border-zinc-800 dark:bg-zinc-900/60">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-600 dark:text-zinc-300">
        {title}
      </h2>

      <div className="mt-3 overflow-x-auto rounded-md border border-gray-200 bg-white p-2 dark:border-zinc-700 dark:bg-zinc-900">
        {geometry ? (
          <svg
            viewBox={`0 0 ${chartWidth + labelLaneWidth} ${chartHeight}`}
            className="h-56 min-w-[760px] w-full"
            role="img"
            aria-label={`${title} shared trend chart`}
          >
            {rows.map((row) => {
              const visualState = resolveOwnerVisualState({
                ownerId: row.ownerId,
                selectedOwnerId,
                focusMode,
                topOwnerIds,
              });
              const isLeader = leaderIds.has(row.ownerId);
              return (
                <path
                  key={`${metric}-line-${row.ownerId}`}
                  d={buildSeriesPath({
                    points: row.points,
                    geometry,
                    width: chartWidth,
                    height: chartHeight,
                  })}
                  fill="none"
                  stroke={getOwnerTrendColor(row.ownerId)}
                  strokeWidth={visualState.selected ? 4.4 : isLeader ? 3.4 : 2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={
                    visualState.muted ? 'opacity-20' : isLeader ? 'opacity-100' : 'opacity-80'
                  }
                  data-leader-emphasis={isLeader ? 'true' : 'false'}
                  data-owner-id={row.ownerId}
                  data-selected={visualState.selected ? 'true' : 'false'}
                  data-muted={visualState.muted ? 'true' : 'false'}
                  data-emphasized={visualState.emphasized ? 'true' : 'false'}
                />
              );
            })}
            {rows.flatMap((row) => {
              const visualState = resolveOwnerVisualState({
                ownerId: row.ownerId,
                selectedOwnerId,
                focusMode,
                topOwnerIds,
              });
              return row.points.map((point) => {
                const pos = pointPosition({
                  point,
                  geometry,
                  width: chartWidth,
                  height: chartHeight,
                });
                return (
                  <circle
                    key={`${metric}-${row.ownerId}-point-${point.week}`}
                    cx={pos.x}
                    cy={pos.y}
                    r={visualState.selected ? 4 : 3}
                    fill={getOwnerTrendColor(row.ownerId)}
                    className={visualState.muted ? 'opacity-30' : 'opacity-95'}
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
              });
            })}

            {rows.map((row) => {
              const latestPoint = row.points[row.points.length - 1];
              if (!latestPoint) return null;
              const visualState = resolveOwnerVisualState({
                ownerId: row.ownerId,
                selectedOwnerId,
                focusMode,
                topOwnerIds,
              });
              const latestPos = pointPosition({
                point: latestPoint,
                geometry,
                width: chartWidth,
                height: chartHeight,
              });
              const y = latestPos.y + (labelOffsets.get(row.ownerId) ?? 0);
              return (
                <g
                  key={`${metric}-label-${row.ownerId}`}
                  className={visualState.muted ? 'opacity-30' : 'opacity-100'}
                  data-owner-id={row.ownerId}
                  data-selected={visualState.selected ? 'true' : 'false'}
                  data-muted={visualState.muted ? 'true' : 'false'}
                  data-emphasized={visualState.emphasized ? 'true' : 'false'}
                >
                  <circle
                    cx={latestPos.x}
                    cy={latestPos.y}
                    r={visualState.selected ? 3.2 : 2.4}
                    fill={getOwnerTrendColor(row.ownerId)}
                    opacity={0.75}
                    data-label-anchor-dot={row.ownerId}
                  />
                  <line
                    x1={latestPos.x + 4}
                    y1={latestPos.y}
                    x2={chartWidth + 12}
                    y2={y}
                    stroke={getOwnerTrendColor(row.ownerId)}
                    strokeWidth={visualState.selected ? 1.8 : 1.2}
                    strokeDasharray="1.5 2.5"
                    opacity={0.68}
                    data-label-connector={row.ownerId}
                  />
                  <text
                    x={chartWidth + 16}
                    y={y + 4}
                    fill={getOwnerTrendColor(row.ownerId)}
                    fontSize="11"
                    fontWeight={visualState.selected ? 700 : 600}
                    data-right-edge-label={row.ownerId}
                  >
                    #{rankByOwnerId.get(row.ownerId) ?? rows.length}{' '}
                    {formatLabelOwnerName(row.ownerName)}{' '}
                    {formatMetricLabelValue(metric, row.latest)}
                  </text>
                </g>
              );
            })}
          </svg>
        ) : null}
      </div>

      <ul className="mt-3 grid gap-1.5 text-xs text-gray-700 dark:text-zinc-300 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((row) => {
          const visualState = resolveOwnerVisualState({
            ownerId: row.ownerId,
            selectedOwnerId,
            focusMode,
            topOwnerIds,
          });
          return (
            <li
              key={`${metric}-legend-${row.ownerId}`}
              className={`rounded-md border px-2 py-1 ${visualState.selected ? 'border-blue-300 bg-blue-50/60 dark:border-blue-700 dark:bg-blue-950/20' : 'border-gray-200 bg-white dark:border-zinc-700 dark:bg-zinc-900'} ${visualState.muted ? 'opacity-45' : ''}`}
            >
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 text-left"
                onClick={() => onSelectOwner(row.ownerId)}
                data-selected={visualState.selected ? 'true' : 'false'}
                data-muted={visualState.muted ? 'true' : 'false'}
                data-emphasized={visualState.emphasized ? 'true' : 'false'}
                data-legend-owner={row.ownerId}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: getOwnerTrendColor(row.ownerId) }}
                  />
                  <span className="truncate font-medium">{row.ownerName}</span>
                </span>
                <span>{row.latest == null ? '—' : formatMetricValue(metric, row.latest)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default function TrendsDetailSurface({
  standingsHistory,
  season,
  seasonContext,
  issues,
  layoutMode = 'standalone',
}: {
  standingsHistory: StandingsHistory | null;
  season: number;
  seasonContext: SeasonContext | null;
  issues: string[];
  layoutMode?: LayoutMode;
}): React.ReactElement {
  const [selectedOwnerId, setSelectedOwnerId] = React.useState<string | null>(null);
  const [hoverState, setHoverState] = React.useState<HoverState | null>(null);
  const [focusMode, setFocusMode] = React.useState<FocusMode>('all');

  const gamesBackTrend = standingsHistory ? selectGamesBackTrend({ standingsHistory }) : [];
  const winPctTrend = standingsHistory ? selectWinPctTrend({ standingsHistory }) : [];
  const winBars = standingsHistory ? selectWinBars({ standingsHistory }) : [];
  const momentum = standingsHistory ? selectOwnerMomentum({ standingsHistory, windowSize: 3 }) : [];

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

  const WrapperTag = layoutMode === 'standalone' ? 'main' : 'div';

  return (
    <WrapperTag
      className={
        layoutMode === 'standalone' ? 'mx-auto w-full max-w-5xl space-y-4 p-4 sm:p-6' : 'space-y-4'
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
      ) : (
        <header>
          <h3 className="text-lg font-semibold tracking-tight text-gray-950 dark:text-zinc-50">
            Trends
          </h3>
          <p className="mt-1 text-xs text-gray-600 dark:text-zinc-300">
            Season {season} · {seasonContextLabel(seasonContext)}
          </p>
        </header>
      )}

      {selectedOwnerId && selectedWinBar && selectedRank != null ? (
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

      {formatHoverSummary(hoverState) ? (
        <section
          className="rounded-lg border border-blue-300 bg-blue-50/80 px-3 py-2 text-xs text-blue-900 dark:border-blue-700 dark:bg-blue-950/30 dark:text-blue-100"
          data-hover-summary
        >
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

      <section className="rounded-lg border border-gray-200 bg-white/80 p-2 dark:border-zinc-700 dark:bg-zinc-900/70">
        <div
          className="inline-flex rounded-md border border-gray-200 bg-gray-50 p-1 dark:border-zinc-700 dark:bg-zinc-900"
          role="group"
          aria-label="Chart focus mode controls"
        >
          {(
            [
              { mode: 'all', label: 'All' },
              { mode: 'top', label: `Top ${TOP_FOCUS_COUNT}` },
              { mode: 'selected', label: 'Selected' },
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
              onClick={() => setFocusMode(mode)}
              data-focus-mode-control={mode}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <SharedTrendChart
        title="Games Back"
        metric="games-back"
        rows={gamesBackRows}
        selectedOwnerId={selectedOwnerId}
        focusMode={focusMode}
        topOwnerIds={topOwnerIds}
        onSelectOwner={(ownerId) =>
          setSelectedOwnerId((current) => toggleSelectedOwner(current, ownerId))
        }
        onHover={setHoverState}
        onHoverLeave={() => setHoverState(null)}
      />

      <SharedTrendChart
        title="Win %"
        metric="win-pct"
        rows={winPctRows}
        selectedOwnerId={selectedOwnerId}
        focusMode={focusMode}
        topOwnerIds={topOwnerIds}
        onSelectOwner={(ownerId) =>
          setSelectedOwnerId((current) => toggleSelectedOwner(current, ownerId))
        }
        onHover={setHoverState}
        onHoverLeave={() => setHoverState(null)}
      />

      <section className="rounded-xl border border-gray-200 bg-gray-50/70 p-4 dark:border-zinc-800 dark:bg-zinc-900/60">
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
                        onClick={() =>
                          setSelectedOwnerId((current) =>
                            toggleSelectedOwner(current, entry.ownerId)
                          )
                        }
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
                        onClick={() =>
                          setSelectedOwnerId((current) =>
                            toggleSelectedOwner(current, entry.ownerId)
                          )
                        }
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
              const visualState = resolveOwnerVisualState({
                ownerId: row.ownerId,
                selectedOwnerId,
                focusMode,
                topOwnerIds,
              });
              return (
                <li
                  key={row.ownerId}
                  className={`rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-gray-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 ${
                    visualState.selected ? 'ring-1 ring-blue-400 dark:ring-blue-500' : ''
                  } ${visualState.muted ? 'opacity-45' : ''}`}
                  data-winbar-owner={row.ownerId}
                  data-selected={visualState.selected ? 'true' : 'false'}
                  data-muted={visualState.muted ? 'true' : 'false'}
                  data-emphasized={visualState.emphasized ? 'true' : 'false'}
                >
                  <button
                    type="button"
                    className="w-full text-left"
                    onClick={() =>
                      setSelectedOwnerId((current) => toggleSelectedOwner(current, row.ownerId))
                    }
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
    </WrapperTag>
  );
}

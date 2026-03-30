import React from 'react';
import Link from 'next/link';

import TrendsDetailSurface from '../app/trends/TrendsDetailSurface';
import {
  deriveLeagueInsights,
  deriveStandingsInsights,
  type Insight,
} from '../lib/selectors/insights';
import type { SeasonContext } from '../lib/selectors/seasonContext';
import { deriveStandingsMovementByOwner } from '../lib/selectors/standingsMovement';
import type { OwnerStandingsRow, StandingsCoverage } from '../lib/standings';
import type { StandingsHistory } from '../lib/standingsHistory';

export type StandingsSubview = 'table' | 'trends';

type StandingsPanelProps = {
  rows: OwnerStandingsRow[];
  season: number;
  coverage: StandingsCoverage;
  onOwnerSelect?: (owner: string) => void;
  focusedOwner?: string | null;
  standingsHistory?: StandingsHistory | null;
  seasonContext?: SeasonContext | null;
  trendIssues?: string[];
  initialSubview?: StandingsSubview;
};

type FocusableElement = {
  scrollIntoView: (options?: ScrollIntoViewOptions) => void;
};

function insightHref(target?: Insight['navigationTarget']): string | null {
  if (!target) return null;
  if (target === 'standings') return '/standings';
  if (target === 'trends') return '/standings?view=trends#trends';
  if (target === 'matchup') return '/?view=matchups';
  return null;
}

export function scrollFocusedStandingsOwnerIntoView(params: {
  focusedOwner: string | null;
  refsByOwner: Map<string, FocusableElement>;
}): boolean {
  const { focusedOwner, refsByOwner } = params;
  if (!focusedOwner) return false;
  const row = refsByOwner.get(focusedOwner);
  if (!row) return false;
  row.scrollIntoView({ block: 'center', behavior: 'smooth' });
  return true;
}

function formatWinPct(value: number): string {
  return value.toFixed(3);
}

function formatGamesBack(value: number): string {
  return value === 0 ? '—' : String(value);
}

function formatDiff(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function deriveMovementPresentation(rankDelta: number | null): {
  text: string;
  className: string;
  label: string;
} {
  const formatSpotCopy = (value: number) => `${value} spot${value === 1 ? '' : 's'}`;

  if (rankDelta == null) {
    return {
      text: '—',
      className: 'text-gray-400 dark:text-zinc-500',
      label: 'No prior week comparison available',
    };
  }
  if (rankDelta > 0) {
    return {
      text: `↑${rankDelta}`,
      className: 'text-emerald-700 dark:text-emerald-400',
      label: `Moved up ${formatSpotCopy(rankDelta)} from last week`,
    };
  }
  if (rankDelta < 0) {
    const downAmount = Math.abs(rankDelta);
    return {
      text: `↓${downAmount}`,
      className: 'text-rose-700 dark:text-rose-400',
      label: `Moved down ${formatSpotCopy(downAmount)} from last week`,
    };
  }
  return {
    text: '→0',
    className: 'text-gray-500 dark:text-zinc-400',
    label: 'No change from last week',
  };
}

export default function StandingsPanel({
  rows,
  season,
  coverage,
  onOwnerSelect,
  focusedOwner = null,
  standingsHistory = null,
  seasonContext = null,
  trendIssues = [],
  initialSubview = 'table',
}: StandingsPanelProps): React.ReactElement {
  const ownerRowRefs = React.useRef<Map<string, HTMLTableRowElement>>(new Map());
  const trendsPanelRef = React.useRef<HTMLDivElement | null>(null);
  const [trendsHighlighted, setTrendsHighlighted] = React.useState(false);
  const movementByOwner = React.useMemo(
    () =>
      deriveStandingsMovementByOwner({
        rows,
        standingsHistory,
      }),
    [rows, standingsHistory]
  );
  const standingsInsights = React.useMemo(
    () =>
      deriveStandingsInsights(
        deriveLeagueInsights({
          rows,
          standingsHistory,
          seasonContext,
        })
      ),
    [rows, seasonContext, standingsHistory]
  );

  React.useEffect(() => {
    scrollFocusedStandingsOwnerIntoView({
      focusedOwner,
      refsByOwner: ownerRowRefs.current,
    });
  }, [focusedOwner]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const viewParam = new URLSearchParams(window.location.search).get('view');
    const shouldFocusTrends =
      initialSubview === 'trends' ||
      viewParam === 'trends' ||
      window.location.hash.toLowerCase() === '#trends';
    if (!shouldFocusTrends) return;
    if (typeof trendsPanelRef.current?.scrollIntoView === 'function') {
      trendsPanelRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    setTrendsHighlighted(true);
    const timeoutId = window.setTimeout(() => setTrendsHighlighted(false), 1800);
    return () => window.clearTimeout(timeoutId);
  }, [initialSubview]);

  return (
    <section className="space-y-3 rounded-xl border border-gray-300 bg-white p-3 shadow-sm sm:p-4 dark:border-zinc-700 dark:bg-zinc-900">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight text-gray-950 dark:text-zinc-50">
          {season} Standings
        </h2>
        {coverage.message ? (
          <p
            className={`text-sm ${
              coverage.state === 'error'
                ? 'text-amber-700 dark:text-amber-300'
                : 'text-gray-600 dark:text-zinc-300'
            }`}
          >
            {coverage.message}
          </p>
        ) : null}
      </div>

      <div
        className="grid grid-cols-1 gap-4 md:gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1.7fr)]"
        data-layout="standings-trends-split"
      >
        <div className="space-y-3">
          {rows.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-sm text-gray-600 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300">
              Upload surnames to populate league standings.
            </div>
          ) : (
            <>
              <div className="-mx-1 overflow-x-auto px-1">
                <table
                  className="min-w-max border-separate border-spacing-0 text-sm"
                  data-standings-layout="tight"
                >
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-widest text-gray-500 dark:text-zinc-500">
                      {['Rank', 'Move', 'Team', 'Record', 'Win %', 'PF', 'PA', 'Diff', 'GB'].map(
                        (label) => {
                          const isNumericMetric =
                            label === 'PF' || label === 'PA' || label === 'Diff' || label === 'GB';
                          const isCompact = label === 'Rank' || label === 'Move';
                          const isTeam = label === 'Team';
                          const isDeEmphasized = label === 'PA' || label === 'GB';
                          return (
                            <th
                              key={label}
                              className={`whitespace-nowrap border-b border-gray-200 px-1.5 py-2 font-semibold sm:px-2 dark:border-zinc-700 ${isCompact ? 'w-[2.8rem]' : ''} ${isTeam ? 'min-w-[9.5rem]' : ''} ${isNumericMetric ? 'w-[4.2rem] text-right text-xs text-gray-400 dark:text-zinc-500' : ''} ${isDeEmphasized ? 'hidden sm:table-cell' : ''}`}
                              data-standings-column={label.toLowerCase().replace(/\s+/gu, '-')}
                            >
                              {label}
                            </th>
                          );
                        }
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, index) => {
                      const winPctWidth = Math.max(0, Math.min(100, row.winPct * 100)).toFixed(1);
                      const movement = movementByOwner[row.owner];
                      const movementPresentation = deriveMovementPresentation(
                        movement?.rankDelta ?? null
                      );
                      return (
                        <tr
                          key={row.owner}
                          ref={(element) => {
                            if (!element) {
                              ownerRowRefs.current.delete(row.owner);
                              return;
                            }
                            ownerRowRefs.current.set(row.owner, element);
                          }}
                          className={`odd:bg-gray-50/70 even:bg-white dark:odd:bg-zinc-950/70 dark:even:bg-zinc-900 ${
                            focusedOwner === row.owner
                              ? 'ring-1 ring-inset ring-blue-400 dark:ring-blue-600'
                              : ''
                          }`}
                          style={{
                            backgroundImage: `linear-gradient(to right, rgba(59, 130, 246, 0.12) ${winPctWidth}%, transparent ${winPctWidth}%)`,
                          }}
                          data-standings-owner={row.owner}
                          data-winbar-background={`${winPctWidth}%`}
                        >
                          <td className="w-[2.8rem] border-b border-gray-100 px-1.5 py-2 text-base font-semibold tabular-nums text-gray-900 sm:px-2 dark:border-zinc-800 dark:text-zinc-100">
                            {index + 1}
                          </td>
                          <td
                            className={`w-[2.8rem] whitespace-nowrap border-b border-gray-100 px-1.5 py-2 text-xs font-semibold tabular-nums sm:px-2 dark:border-zinc-800 ${movementPresentation.className}`}
                            title={movementPresentation.label}
                            aria-label={movementPresentation.label}
                            data-standings-move={movementPresentation.text}
                          >
                            {movementPresentation.text}
                          </td>
                          <td className="min-w-[9.5rem] border-b border-gray-100 px-1.5 py-2 text-[0.95rem] font-semibold text-gray-950 sm:px-2 dark:border-zinc-800 dark:text-zinc-50">
                            <div className="min-w-[8rem] truncate sm:min-w-0">
                              {onOwnerSelect ? (
                                <button
                                  type="button"
                                  className="text-left underline decoration-gray-300 underline-offset-2 hover:decoration-gray-500 dark:decoration-zinc-600 dark:hover:decoration-zinc-300"
                                  onClick={() => onOwnerSelect(row.owner)}
                                >
                                  {row.owner}
                                </button>
                              ) : (
                                row.owner
                              )}
                            </div>
                          </td>
                          <td className="whitespace-nowrap border-b border-gray-100 px-1.5 py-2 font-semibold tabular-nums text-gray-900 sm:px-2 dark:border-zinc-800 dark:text-zinc-100">
                            {row.wins}–{row.losses}
                          </td>
                          <td className="whitespace-nowrap border-b border-gray-100 px-1.5 py-2 tabular-nums text-gray-600 sm:px-2 dark:border-zinc-800 dark:text-zinc-300">
                            {formatWinPct(row.winPct)}
                          </td>
                          <td className="w-[4.2rem] whitespace-nowrap border-b border-gray-100 px-1.5 py-2 text-right tabular-nums text-gray-500 sm:px-2 dark:border-zinc-800 dark:text-zinc-400">
                            {row.pointsFor}
                          </td>
                          <td className="hidden sm:table-cell w-[4.2rem] whitespace-nowrap border-b border-gray-100 px-1.5 py-2 text-right tabular-nums text-gray-500 sm:px-2 dark:border-zinc-800 dark:text-zinc-400">
                            {row.pointsAgainst}
                          </td>
                          <td className="w-[4.2rem] whitespace-nowrap border-b border-gray-100 px-1.5 py-2 text-right tabular-nums text-gray-500 sm:px-2 dark:border-zinc-800 dark:text-zinc-400">
                            {formatDiff(row.pointDifferential)}
                          </td>
                          <td className="hidden sm:table-cell w-[4.2rem] whitespace-nowrap border-b border-gray-100 px-1.5 py-2 text-right tabular-nums text-gray-500 sm:px-2 dark:border-zinc-800 dark:text-zinc-400">
                            {formatGamesBack(row.gamesBack)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {standingsInsights.length > 0 ? (
            <section
              className="rounded-xl border border-gray-200 bg-gray-50/70 p-3.5 dark:border-zinc-800 dark:bg-zinc-900/60"
              data-standings-section="contextual-insights"
            >
              <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-600 dark:text-zinc-300">
                Standings insights
              </h3>
              <div className="mt-2 space-y-2">
                {standingsInsights.map((insight) => {
                  const href = insightHref(insight.navigationTarget);
                  return (
                    <article
                      key={insight.id}
                      className="rounded-md border border-gray-200 bg-white px-2.5 py-2 dark:border-zinc-700 dark:bg-zinc-900"
                      data-standings-insight-type={insight.type}
                    >
                      <p className="text-sm font-semibold text-gray-900 dark:text-zinc-100">
                        {insight.title}
                      </p>
                      <p className="mt-1 text-sm text-gray-700 dark:text-zinc-300">
                        {insight.description}
                      </p>
                      {href ? (
                        <Link
                          href={href}
                          className="mt-2 inline-flex rounded-md border border-blue-300 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-800 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-200 dark:hover:bg-blue-950/60"
                        >
                          Open insight
                        </Link>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            </section>
          ) : null}
        </div>

        <div
          id="trends"
          ref={trendsPanelRef}
          className={`w-full scroll-mt-20 rounded-lg transition ${
            trendsHighlighted ? 'ring-2 ring-blue-300 dark:ring-blue-600' : ''
          }`}
          data-standings-subview="trends"
        >
          <TrendsDetailSurface
            standingsHistory={standingsHistory}
            season={season}
            seasonContext={seasonContext}
            issues={trendIssues}
            layoutMode="embedded"
            compact
            showMomentum={false}
          />
        </div>
      </div>
    </section>
  );
}

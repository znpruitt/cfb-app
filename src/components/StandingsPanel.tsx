import React from 'react';

import TrendsDetailSurface from '../app/trends/TrendsDetailSurface';
import { selectOwnerMomentum } from '../lib/selectors/momentum';
import type { SeasonContext } from '../lib/selectors/seasonContext';
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

function formatSignedOneDecimal(value: number): string {
  const base = Math.abs(value).toFixed(1);
  if (value > 0) return `+${base}`;
  if (value < 0) return `-${base}`;
  return base;
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
  const momentum = standingsHistory ? selectOwnerMomentum({ standingsHistory, windowSize: 3 }) : [];
  const topMomentum = momentum.slice(0, 3);
  const topMomentumOwnerIds = new Set(topMomentum.map((entry) => entry.ownerId));
  const bottomMomentum = [...momentum]
    .filter((entry) => !topMomentumOwnerIds.has(entry.ownerId))
    .reverse()
    .slice(0, 3);

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
                <table className="min-w-max border-separate border-spacing-0 text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-[0.16em] text-gray-500 dark:text-zinc-500">
                      {['Rank', 'Team', 'Record', 'Win %', 'PF', 'PA', 'Diff', 'GB'].map(
                        (label) => (
                          <th
                            key={label}
                            className={`whitespace-nowrap border-b border-gray-200 px-2 py-2 font-semibold sm:px-3 dark:border-zinc-700 ${label === 'PF' || label === 'PA' || label === 'Diff' || label === 'GB' ? 'text-[11px] sm:text-xs text-gray-400 dark:text-zinc-500' : ''}`}
                          >
                            {label}
                          </th>
                        )
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, index) => {
                      const winPctWidth = Math.max(0, Math.min(100, row.winPct * 100)).toFixed(1);
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
                          <td className="border-b border-gray-100 px-2 py-2 text-base font-semibold tabular-nums text-gray-900 sm:px-3 dark:border-zinc-800 dark:text-zinc-100">
                            {index + 1}
                          </td>
                          <td className="border-b border-gray-100 px-2 py-2 text-[0.95rem] font-semibold text-gray-950 sm:px-3 dark:border-zinc-800 dark:text-zinc-50">
                            <div className="min-w-[8.5rem] truncate sm:min-w-0">
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
                          <td className="whitespace-nowrap border-b border-gray-100 px-2 py-2 font-semibold tabular-nums text-gray-900 sm:px-3 dark:border-zinc-800 dark:text-zinc-100">
                            {row.wins}–{row.losses}
                          </td>
                          <td className="whitespace-nowrap border-b border-gray-100 px-2 py-2 tabular-nums text-gray-600 sm:px-3 dark:border-zinc-800 dark:text-zinc-300">
                            {formatWinPct(row.winPct)}
                          </td>
                          <td className="whitespace-nowrap border-b border-gray-100 px-2 py-2 tabular-nums text-gray-500 sm:px-3 dark:border-zinc-800 dark:text-zinc-400">
                            {row.pointsFor}
                          </td>
                          <td className="whitespace-nowrap border-b border-gray-100 px-2 py-2 tabular-nums text-gray-500 sm:px-3 dark:border-zinc-800 dark:text-zinc-400">
                            {row.pointsAgainst}
                          </td>
                          <td className="whitespace-nowrap border-b border-gray-100 px-2 py-2 tabular-nums text-gray-500 sm:px-3 dark:border-zinc-800 dark:text-zinc-400">
                            {formatDiff(row.pointDifferential)}
                          </td>
                          <td className="whitespace-nowrap border-b border-gray-100 px-2 py-2 tabular-nums text-gray-500 sm:px-3 dark:border-zinc-800 dark:text-zinc-400">
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

          <section
            className="rounded-xl border border-gray-200 bg-gray-50/70 p-3.5 dark:border-zinc-800 dark:bg-zinc-900/60"
            data-standings-section="recent-momentum"
          >
            <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-600 dark:text-zinc-300">
              Recent Momentum
            </h3>
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
                    {topMomentum.map((entry) => (
                      <li
                        key={`momentum-top-${entry.ownerId}`}
                        className="rounded-md border border-gray-200 bg-white px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-900"
                        data-momentum-owner={entry.ownerId}
                      >
                        <div className="flex w-full items-center justify-between gap-2 text-left">
                          <span className="font-medium">{entry.ownerId}</span>
                          <span>
                            {entry.deltaWins >= 0 ? '+' : ''}
                            {entry.deltaWins} wins · GB{' '}
                            {formatSignedOneDecimal(entry.deltaGamesBack)}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-zinc-400">
                    Cooldowns (last 3 weeks)
                  </p>
                  <ul className="mt-1.5 space-y-1.5 text-sm">
                    {bottomMomentum.map((entry) => (
                      <li
                        key={`momentum-bottom-${entry.ownerId}`}
                        className="rounded-md border border-gray-200 bg-white px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-900"
                        data-momentum-owner={entry.ownerId}
                      >
                        <div className="flex w-full items-center justify-between gap-2 text-left">
                          <span className="font-medium">{entry.ownerId}</span>
                          <span>
                            {entry.deltaWins >= 0 ? '+' : ''}
                            {entry.deltaWins} wins · Win%{' '}
                            {formatSignedOneDecimal(entry.deltaWinPct * 100)}%
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </section>
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

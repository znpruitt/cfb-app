import React from 'react';
import Link from 'next/link';

import MiniTrendsGrid from './MiniTrendsGrid';
import CompactGameScoreboard from './CompactGameScoreboard';
import ViewMoreLink, { viewMoreLinkClass } from './navigation/ViewMoreLink';
import { selectResolvedStandingsWeeks } from '@/lib/selectors/historyResolution';
import { TREND_EMPTY_MESSAGE } from '@/lib/trendEmptyState';
import {
  isDrawableTrendSeries,
  seasonOriginApplies,
  selectGamesBackTrend,
  selectPositionDeltas,
} from '../lib/selectors/trends';
import { buildWeekLabelMap, formatWeekLabel } from '../lib/weekLabel';
import { formatExpandedKickoff } from '../lib/gameCardPresentation';
import {
  formatGameMatchupLabel,
  gameStateFromScore,
  gameStatusLabelPresentation,
} from '../lib/gameUi';
import { normalizeStatusTokens } from '../lib/gameStatus';
import type { HighlightDrilldownTarget } from '../lib/highlightDrilldown';
import {
  deriveLeagueInsights,
  deriveOverviewInsights,
  type Insight,
} from '../lib/selectors/insights';
import { getCategoryConfig } from '../lib/insightCategories';
import { OVERVIEW_INSIGHT_SLOTS, OVERVIEW_INSIGHT_SLOTS_WITH_RECAP } from '../lib/insights/limits';
import type { LifecycleState } from '../lib/insights/types';
import { isDarkTheme } from '../lib/ownerColors';
import {
  deriveResolvedMovementStandings,
  resolveOverviewCanonicalInputs,
  selectOverviewViewModel,
  type PrioritizedOverviewItem,
} from '../lib/selectors/overview';
import {
  selectOverviewGameSections,
  type OverviewGamePresentation,
  type OverviewGameRouteStatus,
  type OverviewSectionItem,
} from '../lib/selectors/overviewGameSections';
import type { SeasonContext } from '../lib/selectors/seasonContext';
import type { CanonicalStandings } from '../lib/selectors/leagueStandings';
import {
  selectOwnerPendingDelta,
  selectOwnersWithInProgressGames,
} from '../lib/selectors/liveDelta';
import type { LiveDelta } from '../lib/selectors/liveDelta';
import type { OverviewContext, OverviewGameItem, OwnerMatchupMatrix } from '../lib/overview';
import {
  getTeamRanking,
  type TeamRankingEnrichment,
  type RankingsResponse,
  type RankingsWeek,
  type CanonicalPollEntry,
  type RankSource,
} from '../lib/rankings';
import { getGameParticipantTeamId, type AppGame } from '../lib/schedule';
import type { ScorePack } from '../lib/scores';
import { NO_CLAIM_OWNER, standingsCoverageNoticeWithSubject } from '../lib/standings';
import type { OwnerStandingsRow, StandingsCoverage } from '../lib/standings';
import type { StandingsHistory } from '../lib/standingsHistory';
import { getPresentationTimeZone } from '../lib/weekPresentation';
import RankedTeamName from './RankedTeamName';

/**
 * The last `n` weeks that are RESOLVED — played, with a usable snapshot.
 *
 * PLATFORM-105 — this used to take the last `n` weeks of the SCHEDULE, which was
 * harmless only while every future week counted as resolved: the chart drew
 * cumulative standings carried forward, so the columns were wrong but full. Now
 * that unplayed weeks are correctly unresolved, taking scheduled weeks renders
 * future week labels with no series behind them — an empty GB Race for the first
 * ten weeks of every season. Review caught it; my tests did not, because none of
 * them look at this surface.
 *
 * Resolved rather than merely played: a played week whose coverage is incomplete
 * is dropped by the trend selectors, so slicing on `played` alone still leaves a
 * labelled column with no series behind it.
 */
export function sliceStandingsHistoryToRecentWeeks(
  history: StandingsHistory,
  n: number
): StandingsHistory {
  // RESOLVED, not merely played. A played week whose coverage is incomplete is
  // dropped by `selectGamesBackTrend`, so slicing on `played` alone still leaves
  // a labelled column with no series behind it. Resolved is the domain the trend
  // selectors actually populate — and it is the shared predicate rather than a
  // fourth hand-rolled copy of it.
  const recentWeeks = selectResolvedStandingsWeeks(history).resolvedWeeks.slice(-n);
  const weekSet = new Set(recentWeeks);
  return {
    weeks: recentWeeks,
    byWeek: Object.fromEntries(
      Object.entries(history.byWeek).filter(([w]) => weekSet.has(Number(w)))
    ),
    byOwner: Object.fromEntries(
      Object.entries(history.byOwner).map(([owner, pts]) => [
        owner,
        pts.filter((p) => weekSet.has(p.week)),
      ])
    ),
  };
}

function deltaTextColor(delta: number | null): string {
  if (delta == null || delta === 0) return 'text-gray-400 dark:text-zinc-500';
  if (delta > 0) return 'text-emerald-600 dark:text-emerald-400';
  return 'text-red-500 dark:text-red-400';
}

function deltaLabel(delta: number | null): string {
  if (delta == null) return '·';
  if (delta === 0) return '—';
  return delta > 0 ? `+${delta}` : String(delta);
}

function formatWinPct(value: number): string {
  return value.toFixed(3);
}

function formatDiff(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function renderMatchupLabel(
  item: OverviewGameItem,
  rankingsByTeamId: Map<string, TeamRankingEnrichment>
): React.ReactElement {
  const game = item.bucket.game;
  const plainLabel = formatGameMatchupLabel(game, { homeAwaySeparator: '@' });
  const separator = plainLabel.slice(game.csvAway.length, plainLabel.length - game.csvHome.length);
  const awayTeamId = getGameParticipantTeamId(game, 'away') ?? game.canAway;
  const homeTeamId = getGameParticipantTeamId(game, 'home') ?? game.canHome;

  return (
    <>
      <RankedTeamName
        teamName={game.csvAway}
        ranking={getTeamRanking(rankingsByTeamId, awayTeamId)}
      />
      {separator}
      <RankedTeamName
        teamName={game.csvHome}
        ranking={getTeamRanking(rankingsByTeamId, homeTeamId)}
      />
    </>
  );
}

function summarizeLeagueAngle(
  item: OverviewGameItem,
  rankingsByTeamId: Map<string, TeamRankingEnrichment>
): React.ReactNode {
  const { awayOwner, homeOwner, game } = item.bucket;
  const awayTeamId = getGameParticipantTeamId(game, 'away') ?? game.canAway;
  const homeTeamId = getGameParticipantTeamId(game, 'home') ?? game.canHome;
  if (awayOwner && homeOwner) {
    return `${awayOwner} vs ${homeOwner}`;
  }

  if (awayOwner) {
    return (
      <>
        {awayOwner}:{' '}
        <RankedTeamName teamName={game.csvAway} ranking={rankingsByTeamId.get(awayTeamId)} />
      </>
    );
  }

  if (homeOwner) {
    return (
      <>
        {homeOwner}:{' '}
        <RankedTeamName teamName={game.csvHome} ranking={rankingsByTeamId.get(homeTeamId)} />
      </>
    );
  }

  return renderMatchupLabel(item, rankingsByTeamId);
}

function deriveFeaturedGameBadge(game: AppGame): { label: string; classes: string } | null {
  const role = game.postseasonRole;

  if (role === 'national_championship' || role === 'playoff') {
    const round = game.playoffRound;
    // playoffRound is more specific than postseasonRole — trust it for the label.
    // This guards against misclassified postseasonRole (e.g., inferBowlPostseasonRole
    // matching "national championship" in bowl notes when the game is really a semifinal).
    // Fallback: if round is generic 'playoff' or null and the game is non-neutral-site,
    // it is a first-round campus game (all QF/SF/Championship games are at neutral sites).
    let label: string;
    if (round === 'semifinal') {
      label = 'CFP Semifinal';
    } else if (round === 'quarterfinal') {
      label = 'CFP Quarterfinal';
    } else if (round === 'first-round' || (round != null && /first.?round/i.test(round))) {
      label = 'CFP First Round';
    } else if (round === 'national_championship' || role === 'national_championship') {
      label = 'CFP Championship';
    } else if ((round == null || round === 'playoff') && !game.neutral) {
      // Campus game without an explicit round — only first-round games are non-neutral
      label = 'CFP First Round';
    } else {
      label = 'CFP';
    }
    return {
      label,
      classes:
        'border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-600 dark:bg-slate-800/50 dark:text-slate-300',
    };
  }

  if (role === 'conference_championship') {
    const conf = game.conference?.trim();
    const label = conf ? `${conf} Champ` : 'Conf. Champ';
    return {
      label,
      classes:
        'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300',
    };
  }

  return null;
}

function EmptyState({
  message,
  compact = false,
}: {
  message: string;
  compact?: boolean;
}): React.ReactElement {
  return (
    <div
      className={`rounded-lg border border-dashed border-gray-300 bg-gray-50/80 px-4 text-sm text-gray-600 dark:border-zinc-700 dark:bg-zinc-950/70 dark:text-zinc-300 ${
        compact ? 'py-2.5' : 'py-4'
      }`}
    >
      {message}
    </div>
  );
}

const GB_NAME_W = '4.5rem';
const GB_COL_W = '2rem';

function gbDeltaColor(delta: number | null): string {
  if (delta == null || delta === 0) return 'text-gray-400 dark:text-zinc-500';
  // Negative delta = gaining ground (good), positive = falling behind (bad)
  if (delta < 0) return 'text-emerald-600 dark:text-emerald-400';
  return 'text-red-500 dark:text-red-400';
}

function formatGbDelta(delta: number | null): string {
  if (delta == null) return '·';
  if (delta === 0) return '—';
  if (delta > 0) return `+${Number.isInteger(delta) ? delta : delta.toFixed(1)}`;
  return Number.isInteger(delta) ? String(delta) : delta.toFixed(1);
}

function formatGbValue(gb: number): string {
  if (gb === 0) return '—';
  return Number.isInteger(gb) ? String(gb) : gb.toFixed(1);
}

type GbChangeRow = {
  ownerId: string;
  ownerName: string;
  deltas: (number | null)[];
  currentGb: number;
};

type GbChangeData = {
  weeks: number[];
  rows: GbChangeRow[];
};

function GbChangeTable({
  standingsHistory,
  standingsLeaders,
  weekLabel,
  ownerColorMap,
}: {
  standingsHistory: StandingsHistory;
  standingsLeaders: OwnerStandingsRow[];
  weekLabel?: (week: number) => string;
  ownerColorMap: Record<string, string>;
}): React.ReactElement | null {
  const data = React.useMemo((): GbChangeData | null => {
    const allSeries = selectGamesBackTrend({ standingsHistory });
    // The SAME resolved-week domain the chart beside it uses. This table kept
    // slicing the schedule, so at week 3 of a 15-week season it rendered five
    // future-week headers with a placeholder in every cell — the identical
    // defect fixed one column over, which is what happens when a call site is
    // fixed by name instead of by class.
    const weeks = selectResolvedStandingsWeeks(standingsHistory).resolvedWeeks;
    if (weeks.length === 0 || allSeries.length === 0) return null;

    const recentWeeks = weeks.slice(-5);
    // Build a lookup from live standings for the authoritative GB value.
    const liveGbByOwner = new Map(standingsLeaders.map((r) => [r.owner, r.gamesBack]));
    const rows: GbChangeRow[] = allSeries.map((s) => {
      const pointByWeek = new Map(s.points.map((p) => [p.week, p.value]));
      const allWeeks = weeks;
      const deltas: (number | null)[] = recentWeeks.map((w) => {
        const wIdx = allWeeks.indexOf(w);
        const prevWeek = wIdx > 0 ? allWeeks[wIdx - 1] : null;
        const current = pointByWeek.get(w);
        const previous = prevWeek != null ? pointByWeek.get(prevWeek) : undefined;
        if (current == null || previous == null) return null;
        return current - previous;
      });
      // Use live standings GB — not the last trend point.
      const currentGb = liveGbByOwner.get(s.ownerName) ?? liveGbByOwner.get(s.ownerId) ?? 0;
      return { ownerId: s.ownerId, ownerName: s.ownerName, deltas, currentGb };
    });

    return { weeks: recentWeeks, rows };
  }, [standingsHistory, standingsLeaders]);

  if (!data) return null;

  const labelFn = weekLabel ?? ((w: number) => `W${w}`);

  return (
    <div>
      {/* Column headers */}
      <div className="mb-px flex items-center">
        <span style={{ width: GB_NAME_W, flexShrink: 0 }} />
        {data.weeks.map((w) => (
          <span
            key={w}
            className="shrink-0 text-center text-[8px] font-medium text-gray-400 dark:text-zinc-500"
            style={{ width: GB_COL_W }}
          >
            {labelFn(w)}
          </span>
        ))}
        <span
          className="shrink-0 text-center text-[8px] font-semibold text-gray-500 dark:text-zinc-400"
          style={{ width: GB_COL_W }}
        >
          GB
        </span>
      </div>
      {/* Owner rows */}
      {data.rows.map((row, i) => {
        const nameColor = ownerColorMap[row.ownerName] ?? '#888';
        return (
          <div
            key={row.ownerId}
            className={`flex items-center py-[3px] ${
              i % 2 !== 0 ? 'rounded-sm bg-gray-50/60 dark:bg-zinc-800/30' : ''
            }`}
          >
            <span
              className="shrink-0 truncate text-[11px] font-medium"
              style={{ width: GB_NAME_W, color: nameColor }}
            >
              {row.ownerName}
            </span>
            {row.deltas.map((delta, di) => (
              <span
                key={data.weeks[di]}
                className={`shrink-0 text-center text-[11px] font-medium tabular-nums ${gbDeltaColor(delta)}`}
                style={{ width: GB_COL_W }}
              >
                {formatGbDelta(delta)}
              </span>
            ))}
            <span
              className="shrink-0 text-center text-[11px] font-semibold tabular-nums text-gray-700 dark:text-zinc-200"
              style={{ width: GB_COL_W }}
            >
              {formatGbValue(row.currentGb)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function SectionDivider(): React.ReactElement {
  return <hr className="border-t border-gray-200/60 dark:border-zinc-800/60" />;
}

function SectionHeader({
  title,
  action,
}: {
  title: string;
  action?: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex items-center justify-between gap-2">
      <h2 className="text-[15px] font-medium text-gray-950 dark:text-zinc-50">{title}</h2>
      {action ?? null}
    </div>
  );
}

function PodiumCard({
  row,
  rank,
  label,
  isChampion,
}: {
  row: OwnerStandingsRow;
  rank: number;
  label: string;
  isChampion: boolean;
}): React.ReactElement {
  return (
    <article
      className={`rounded-xl border px-3 py-3 ${
        isChampion
          ? 'border-[1.5px] border-[#BA7517]/60 bg-gradient-to-b from-amber-50/80 to-white dark:border-[#BA7517]/50 dark:from-amber-950/25 dark:to-zinc-900'
          : 'border-gray-300/60 bg-gray-50 dark:border-zinc-800/60 dark:bg-zinc-900'
      }`}
    >
      <p
        className={`text-[10px] font-semibold uppercase tracking-wider ${
          isChampion ? 'text-amber-700 dark:text-amber-400' : 'text-gray-400 dark:text-zinc-500'
        }`}
      >
        {isChampion ? `#${rank} · ${label}` : `#${rank}`}
      </p>
      <div className="mt-1.5 flex items-start justify-between gap-2">
        <p className="text-base font-bold text-gray-950 dark:text-zinc-50">{row.owner}</p>
        <p className="shrink-0 text-base font-bold tabular-nums text-gray-950 dark:text-zinc-50">
          {row.wins}–{row.losses}
        </p>
      </div>
      <p className="mt-0.5 text-xs text-gray-600 dark:text-zinc-300">
        Win% {formatWinPct(row.winPct)} · Diff {formatDiff(row.pointDifferential)}
      </p>
    </article>
  );
}

function LeagueSummaryHero({
  summary,
  heroMode,
  podiumLeaders,
  standingsLeaders,
  leader,
  leagueSlug,
}: {
  summary: ReturnType<typeof selectOverviewViewModel>['championSummary'];
  heroMode: ReturnType<typeof selectOverviewViewModel>['heroMode'];
  podiumLeaders: ReturnType<typeof selectOverviewViewModel>['podiumLeaders'];
  standingsLeaders: OwnerStandingsRow[];
  leader: OwnerStandingsRow | undefined;
  leagueSlug?: string;
}): React.ReactElement {
  if (!leader) {
    return (
      <section className="rounded-xl border border-gray-300 bg-gray-50/90 px-4 py-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/60 sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-zinc-400">
          League summary
        </p>
        <p className="mt-2 text-sm text-gray-700 dark:text-zinc-200">
          Your league isn&apos;t set up yet.
        </p>
        <p className="mt-1 text-sm text-gray-500 dark:text-zinc-400">
          Add your owners and configure your draft to get started.
        </p>
        {leagueSlug ? (
          <Link
            href={`/admin/${leagueSlug}`}
            className="mt-3 inline-block rounded-md bg-gray-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-gray-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            Set up your league
          </Link>
        ) : null}
      </section>
    );
  }

  if (!summary) return <></>;

  const isComplete = summary.phase === 'complete';
  const top3 =
    heroMode === 'podium' && podiumLeaders.length === 3
      ? podiumLeaders
      : standingsLeaders.slice(0, 3);

  const rankLabels = isComplete
    ? ['CHAMPION', '2ND', '3RD']
    : summary.phase === 'postseason'
      ? ['LEADER', '2ND', '3RD']
      : ['LEADER', '2ND', '3RD'];

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {top3.map((row, i) => (
        <PodiumCard
          key={row.owner}
          row={row}
          rank={i + 1}
          label={rankLabels[i]}
          isChampion={i === 0 && isComplete}
        />
      ))}
    </div>
  );
}

function formatGb(gb: number): string {
  if (gb === 0) return '—';
  return Number.isInteger(gb) ? String(gb) : gb.toFixed(1);
}

function CondensedStandingsTable({
  rows,
  onOwnerSelect,
  previousRows,
  ownersWithInProgressGames,
  liveDelta,
  deltaWeeks,
  deltasByOwner,
  weekLabel,
}: {
  rows: OwnerStandingsRow[];
  onOwnerSelect?: (owner: string) => void;
  previousRows?: OwnerStandingsRow[] | null;
  ownersWithInProgressGames?: ReadonlySet<string>;
  liveDelta?: LiveDelta | null;
  deltaWeeks?: number[];
  deltasByOwner?: Map<string, Map<number, number | null>>;
  weekLabel?: (week: number) => string;
}): React.ReactElement {
  const previousRankLookup = new Map(
    (previousRows ?? []).map((row, index) => [row.owner, index + 1] as const)
  );
  const hasDeltaCols = deltaWeeks && deltaWeeks.length > 0 && deltasByOwner;
  const labelFn = weekLabel ?? ((w: number) => `W${w}`);
  const deltaCount = hasDeltaCols ? deltaWeeks.length : 0;
  // Grid template: flexible content column + fixed-width delta columns (1.75rem each)
  const gridCols =
    deltaCount > 0 ? `minmax(0, 1fr) repeat(${deltaCount}, 1.75rem)` : 'minmax(0, 1fr)';
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <div
        className="min-w-full text-sm"
        style={{ display: 'grid', gridTemplateColumns: gridCols }}
      >
        {/* Week header row for delta columns */}
        {hasDeltaCols ? (
          <>
            <span className="border-b border-gray-100 px-2 py-1 dark:border-zinc-800" />
            {deltaWeeks.map((w) => (
              <span
                key={w}
                className="border-b border-gray-100 py-1 text-center text-[9px] font-medium text-gray-400 dark:border-zinc-800 dark:text-zinc-500"
              >
                {labelFn(w)}
              </span>
            ))}
          </>
        ) : null}
        {rows.map((row, index) => {
          const livePending = ownersWithInProgressGames?.has(row.owner)
            ? selectOwnerPendingDelta(liveDelta, row.owner)
            : null;
          const livePendingLabel = livePending
            ? `Live this week: ${livePending.pendingWins}–${livePending.pendingLosses}`
            : null;
          const ownerDeltas = hasDeltaCols ? deltasByOwner.get(row.owner) : null;
          return (
            <React.Fragment key={row.owner}>
              {/* Content cell */}
              <div className="border-b border-gray-100 px-2 py-2 dark:border-zinc-800">
                {/* Primary line: rank · name · record · GB */}
                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                  <span className="text-sm tabular-nums text-gray-400 dark:text-zinc-500">
                    {index + 1}
                    {(() => {
                      const previousRank = previousRankLookup.get(row.owner);
                      if (!previousRank || previousRank === index + 1) return null;
                      const movedUp = previousRank > index + 1;
                      return (
                        <span
                          className={`ml-0.5 text-xs font-semibold ${
                            movedUp
                              ? 'text-emerald-700 dark:text-emerald-300'
                              : 'text-amber-700 dark:text-amber-300'
                          }`}
                          aria-label={movedUp ? 'Moved up in standings' : 'Dropped in standings'}
                        >
                          {movedUp ? '↑' : '↓'}
                        </span>
                      );
                    })()}
                  </span>
                  <span className="min-w-0 truncate font-semibold text-gray-950 dark:text-zinc-50">
                    {onOwnerSelect ? (
                      <button
                        type="button"
                        className="max-w-full truncate text-left underline decoration-gray-300 underline-offset-2 hover:decoration-gray-500 dark:decoration-zinc-600 dark:hover:decoration-zinc-300"
                        onClick={() => onOwnerSelect(row.owner)}
                      >
                        {row.owner}
                      </button>
                    ) : (
                      row.owner
                    )}
                  </span>
                  <span className="text-sm font-semibold tabular-nums text-gray-900 dark:text-zinc-100">
                    {row.wins}–{row.losses}
                  </span>
                  {livePending && livePendingLabel ? (
                    <span
                      className="inline-flex items-center rounded-sm bg-emerald-100 px-1 py-0.5 text-[0.6rem] font-medium tracking-tight text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
                      title={livePendingLabel}
                      aria-label={livePendingLabel}
                      data-overview-live-pending={`${livePending.pendingWins}-${livePending.pendingLosses}`}
                    >
                      +{livePending.pendingWins}–{livePending.pendingLosses}
                    </span>
                  ) : null}
                  <span className="text-xs tabular-nums text-gray-400 dark:text-zinc-500">
                    {index === 0 ? formatGb(row.gamesBack) : `${formatGb(row.gamesBack)} GB`}
                  </span>
                </div>
                {/* Secondary line: Win% · Diff */}
                <div className="mt-0.5 flex items-center gap-x-2 text-xs text-gray-400 dark:text-zinc-500">
                  <span>Win% {formatWinPct(row.winPct)}</span>
                  <span>Diff {formatDiff(row.pointDifferential)}</span>
                </div>
              </div>
              {/* Delta cells — one per week column, aligned to grid */}
              {hasDeltaCols && ownerDeltas
                ? deltaWeeks.map((w) => {
                    const d = ownerDeltas.get(w) ?? null;
                    return (
                      <span
                        key={w}
                        className={`flex items-center justify-center border-b border-gray-100 text-[11px] font-medium tabular-nums dark:border-zinc-800 ${deltaTextColor(d)}`}
                      >
                        {deltaLabel(d)}
                      </span>
                    );
                  })
                : hasDeltaCols
                  ? deltaWeeks.map((w) => (
                      <span key={w} className="border-b border-gray-100 dark:border-zinc-800" />
                    ))
                  : null}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

const SCOREBOARD_ISO_DATE_PREFIX_RE = /^\d{4}-\d{2}-\d{2}[t\s]\d{2}:\d{2}/i;
const SCOREBOARD_ISO_UTC_SUFFIX_RE = /z$/i;

function liveScoreboardClock(score: ScorePack | null | undefined): string {
  const status = score?.status.trim() ?? '';
  const statusTokens = normalizeStatusTokens(status);
  const hasGenericLiveStatus =
    statusTokens === 'in progress' ||
    statusTokens === 'inprogress' ||
    statusTokens === 'status in progress' ||
    statusTokens === 'live' ||
    statusTokens === 'status live';

  const scoreTime = score?.time?.trim() ?? '';
  const looksLikeKickoffTimestamp =
    scoreTime.length > 0 &&
    (SCOREBOARD_ISO_DATE_PREFIX_RE.test(scoreTime) ||
      SCOREBOARD_ISO_UTC_SUFFIX_RE.test(scoreTime)) &&
    Number.isFinite(Date.parse(scoreTime));
  const clock = looksLikeKickoffTimestamp ? '' : scoreTime;

  if (hasGenericLiveStatus) return clock;
  if (!status) return clock;
  if (!clock || status.toLocaleLowerCase().includes(clock.toLocaleLowerCase())) return status;
  return `${status} ${clock}`;
}

function GameCardList({
  items,
  rankingsByTeamId,
  timeZone,
}: {
  items: OverviewSectionItem[];
  rankingsByTeamId: Map<string, TeamRankingEnrichment>;
  timeZone: string;
}): React.ReactElement {
  const isFinalList = items[0]?.routeStatus.kind === 'final';

  return (
    <div
      className="grid grid-cols-2 gap-x-10 @max-[760.01px]:grid-cols-1"
      data-live-scoreboard-grid={isFinalList ? undefined : true}
      data-recent-finals-scoreboard-grid={isFinalList ? true : undefined}
    >
      {items.map((item) => {
        const game = item.bucket.game;
        const isFinal = item.routeStatus.kind === 'final';
        const isAwaitingScore = item.routeStatus.kind === 'awaiting-score';
        const awayTeamId = getGameParticipantTeamId(game, 'away') ?? game.canAway;
        const homeTeamId = getGameParticipantTeamId(game, 'home') ?? game.canHome;
        const awayRanking = getTeamRanking(rankingsByTeamId, awayTeamId);
        const homeRanking = getTeamRanking(rankingsByTeamId, homeTeamId);

        return (
          <CompactGameScoreboard
            key={game.key}
            state={isFinal ? 'final' : 'live'}
            clock={
              isFinal
                ? formatExpandedKickoff(game.date, timeZone, game.startTimeTBD)
                : isAwaitingScore
                  ? item.routeStatus.label
                  : liveScoreboardClock(item.score)
            }
            matchupLabel={formatGameMatchupLabel(game)}
            away={{
              teamName: game.csvAway,
              owner: item.bucket.awayOwner === NO_CLAIM_OWNER ? null : item.bucket.awayOwner,
              rank: awayRanking.rank,
              rankSource: awayRanking.rankSource,
              score: isAwaitingScore ? null : (item.score?.away.score ?? null),
            }}
            home={{
              teamName: game.csvHome,
              owner: item.bucket.homeOwner === NO_CLAIM_OWNER ? null : item.bucket.homeOwner,
              rank: homeRanking.rank,
              rankSource: homeRanking.rankSource,
              score: isAwaitingScore ? null : (item.score?.home.score ?? null),
            }}
          />
        );
      })}
    </div>
  );
}

function GameSummaryList({
  prioritizedItems,
  emptyMessage,
  timeZone,
  rankingsByTeamId,
  routeStatusByGameKey,
  density = 'compact',
}: {
  prioritizedItems: PrioritizedOverviewItem[];
  emptyMessage: string;
  timeZone: string;
  rankingsByTeamId: Map<string, TeamRankingEnrichment>;
  routeStatusByGameKey?: ReadonlyMap<string, OverviewGameRouteStatus>;
  density?: 'compact' | 'featured';
}): React.ReactElement {
  if (prioritizedItems.length === 0) {
    return <EmptyState message={emptyMessage} compact />;
  }

  return (
    <div className={density === 'featured' ? 'space-y-2.5' : 'space-y-1.5'}>
      {prioritizedItems.map((prioritized) => {
        const item = prioritized.item;
        const score = item.score;
        const awayScore = score?.away.score ?? '—';
        const homeScore = score?.home.score ?? '—';
        const routeStatus = routeStatusByGameKey?.get(item.bucket.game.key);
        const status = routeStatus?.label ?? score?.status ?? 'Scheduled';
        const state =
          routeStatus?.kind === 'live' || routeStatus?.kind === 'awaiting-score'
            ? 'inprogress'
            : routeStatus?.kind === 'final'
              ? 'final'
              : gameStateFromScore(score);
        const statusLabel = gameStatusLabelPresentation(state === 'inprogress' ? 'live' : state);
        const kickoff = formatExpandedKickoff(
          item.bucket.game.date,
          timeZone,
          item.bucket.game.startTimeTBD
        );
        const ownerLabel =
          item.bucket.awayOwner && item.bucket.homeOwner
            ? `${item.bucket.awayOwner} vs ${item.bucket.homeOwner}`
            : summarizeLeagueAngle(item, rankingsByTeamId);
        const highlightTags = prioritized.highlightTags;

        return (
          <article
            key={item.bucket.game.key}
            className={`rounded-lg border ${
              prioritized.hasPriorityHighlight
                ? 'border-blue-300/80 bg-blue-50/40 dark:border-blue-900/70 dark:bg-blue-950/15'
                : 'border-gray-300 bg-gray-50/80 dark:border-zinc-800 dark:bg-zinc-950/70'
            } ${density === 'featured' ? 'p-3.5 sm:p-4' : 'p-2.5 sm:p-3'}`}
          >
            <div className="grid grid-cols-[minmax(0,1fr)_3.8rem] gap-x-2 sm:grid-cols-[minmax(0,1fr)_4rem]">
              <div className="min-w-0 space-y-1 leading-tight">
                <div className="inline-flex min-w-0 items-center gap-1.5">
                  <p className="min-w-0 truncate text-sm font-semibold text-gray-950 dark:text-zinc-50">
                    {renderMatchupLabel(item, rankingsByTeamId)}
                  </p>
                  {highlightTags.length > 0 ? (
                    <div className="inline-flex flex-wrap items-center gap-1">
                      {highlightTags.map((tag) => (
                        <span
                          key={tag.id}
                          className="inline-flex rounded-full border border-gray-300 bg-white px-1.5 py-0.5 text-xs font-semibold text-gray-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
                        >
                          {tag.text}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
                <p className="text-xs leading-snug text-gray-600 dark:text-zinc-300">
                  {ownerLabel}
                </p>
                {prioritized.highlightLabel ? (
                  <p className="text-xs font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300">
                    {prioritized.highlightLabel}
                  </p>
                ) : null}
                <div className="mt-0.5 flex items-center gap-2 text-xs text-gray-500 dark:text-zinc-400">
                  <span className={statusLabel.className}>
                    {statusLabel.dotClassName ? (
                      <span className={statusLabel.dotClassName} aria-hidden="true" />
                    ) : null}
                    {status}
                  </span>
                  <span aria-hidden="true">•</span>
                  <span>{kickoff}</span>
                </div>
              </div>
              <div className="flex items-start justify-end pt-0.5">
                <span className="w-[3.7rem] rounded-md border border-gray-300 bg-white px-1 py-1 text-center text-sm font-semibold tabular-nums text-gray-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 sm:w-[4rem]">
                  {awayScore}–{homeScore}
                </span>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function FeaturedGamesList({
  prioritizedItems,
  emptyMessage,
  timeZone,
  rankingsByTeamId,
}: {
  prioritizedItems: PrioritizedOverviewItem[];
  emptyMessage: string;
  timeZone: string;
  rankingsByTeamId: Map<string, TeamRankingEnrichment>;
}): React.ReactElement {
  if (prioritizedItems.length === 0) {
    return <EmptyState message={emptyMessage} compact />;
  }

  return (
    <div
      className="grid grid-cols-2 gap-x-10 @max-[760.01px]:grid-cols-1"
      data-featured-scoreboard-grid
    >
      {prioritizedItems.map((prioritized) => {
        const item = prioritized.item;
        const game = item.bucket.game;
        const score = item.score;
        const gameBadge = deriveFeaturedGameBadge(game);
        const awayTeamId = getGameParticipantTeamId(game, 'away') ?? game.canAway;
        const homeTeamId = getGameParticipantTeamId(game, 'home') ?? game.canHome;
        const awayRanking = getTeamRanking(rankingsByTeamId, awayTeamId);
        const homeRanking = getTeamRanking(rankingsByTeamId, homeTeamId);

        return (
          <CompactGameScoreboard
            key={game.key}
            state="final"
            clock={formatExpandedKickoff(game.date, timeZone, game.startTimeTBD)}
            matchupLabel={formatGameMatchupLabel(game)}
            contextSlot={
              gameBadge ? (
                <span
                  className={`inline-flex rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${gameBadge.classes}`}
                >
                  {gameBadge.label}
                </span>
              ) : undefined
            }
            away={{
              teamName: game.csvAway,
              owner: item.bucket.awayOwner === NO_CLAIM_OWNER ? null : item.bucket.awayOwner,
              rank: awayRanking.rank,
              rankSource: awayRanking.rankSource,
              score: score?.away.score ?? null,
            }}
            home={{
              teamName: game.csvHome,
              owner: item.bucket.homeOwner === NO_CLAIM_OWNER ? null : item.bucket.homeOwner,
              rank: homeRanking.rank,
              rankSource: homeRanking.rankSource,
              score: score?.home.score ?? null,
            }}
          />
        );
      })}
    </div>
  );
}

export function insightHref(
  target: Insight['navigationTarget'] | undefined,
  leagueSlug?: string,
  insight?: Insight,
  panelYear?: number
): string | null {
  const base = leagueSlug ? `/league/${leagueSlug}` : '';

  // A recap served from an archive describes a season the reader is NOT viewing
  // and carries it on `insight.season`. EVERY one of its targets must follow the
  // card rather than the page: the champion card would open the current year's
  // history, and the chase, collapse and throne cards would open a trends view
  // for a season in which nobody has played. `season` is absent whenever the
  // card describes the season on screen, so live routing is untouched.
  const archivedSeason =
    insight?.category === 'season_wrap' &&
    typeof insight.season === 'number' &&
    Number.isFinite(insight.season)
      ? insight.season
      : null;
  if (archivedSeason !== null) return `${base}/history/${archivedSeason}`;

  if (target === 'standings') {
    if (
      // `failed_chase` no longer reaches here — `deriveClosingChaseInsight` routes
      // to `trends` — so only the champion card can take this arm.
      insight?.category === 'season_wrap' &&
      insight.type === 'champion_margin' &&
      typeof panelYear === 'number' &&
      Number.isFinite(panelYear)
    ) {
      return `${base}/history/${panelYear}`;
    }
    return `${base}/standings`;
  }
  if (target === 'trends') return `${base}/standings?view=trends#trends`;
  if (target === 'matchup') return `${base}/matchups`;
  if (target === 'history') return `${base}/history`;
  if (!target && insight) {
    return resolveHistoryHref(insight, base);
  }
  return null;
}

function resolveHistoryHref(insight: Insight, base: string): string | null {
  const category = insight.category;
  if (category !== 'historical' && category !== 'rivalry') return null;

  const primary = insight.owner ?? insight.owners?.[0];
  const ownerSegment = primary ? encodeURIComponent(primary) : null;

  switch (insight.type) {
    // drought/dynasty/rivalry insights deep-link to Overview anchors rather
    // than the /history/stats and /history/rivalries subtabs. Those subtabs
    // currently render "Coming in Phase 3" placeholders, so routing there
    // would dead-end. Re-point at the subtabs once Phase 3 ships their content.
    case 'drought':
      return `${base}/history#dynasty-drought`;
    case 'dynasty':
      return `${base}/history#championships`;
    case 'improvement':
    case 'consistency':
    case 'volatility':
    case 'never_last':
    case 'title_chaser':
    case 'rookie_benchmark':
    case 'trending_up':
    case 'trending_down':
      return ownerSegment ? `${base}/history/owner/${ownerSegment}` : null;
    case 'greatest_season': {
      const year = parseYearFromInsightId(insight.id);
      return year ? `${base}/history/${year}` : `${base}/history`;
    }
    case 'perfect_against':
    case 'lopsided_rivalry':
    case 'even_rivalry':
    case 'dominance_streak':
      return `${base}/history#rivalries`;
    case 'milestone_watch': {
      if (!ownerSegment) return null;
      const kind = parseMilestoneKind(insight.id);
      if (kind === 'wins') return `${base}/history/owner/${ownerSegment}`;
      if (kind === 'points') return `${base}/history/owner/${ownerSegment}#career-points`;
      return null;
    }
    case 'career_points_leader':
      return ownerSegment ? `${base}/history/owner/${ownerSegment}#career-points` : null;
    case 'career_turnover_margin':
      return ownerSegment ? `${base}/history/owner/${ownerSegment}#turnover-margin` : null;
    default:
      return null;
  }
}

function parseYearFromInsightId(id: string): number | null {
  const match = id.match(/-(\d{4})$/);
  if (!match) return null;
  const year = Number(match[1]);
  return Number.isFinite(year) ? year : null;
}

function parseMilestoneKind(id: string): 'wins' | 'points' | null {
  if (id.startsWith('milestone-wins-')) return 'wins';
  if (id.startsWith('milestone-points-')) return 'points';
  return null;
}

function InsightRow({
  insight,
  leagueSlug,
  isDark,
  panelYear,
}: {
  insight: Insight;
  leagueSlug?: string;
  isDark: boolean;
  panelYear?: number;
}): React.ReactElement {
  const href = insightHref(insight.navigationTarget, leagueSlug, insight, panelYear);
  const categoryConfig = getCategoryConfig(insight.category);
  const categoryColor = isDark ? categoryConfig.darkColor : categoryConfig.lightColor;

  const body = (
    <div className="flex min-h-[44px] items-start gap-3">
      <div className="min-w-0 flex-1">
        <p
          className="text-[10px] font-semibold uppercase"
          style={{ letterSpacing: '0.08em', color: categoryColor }}
        >
          {categoryConfig.label}
        </p>
        <p className="text-[14px] font-medium text-gray-950 dark:text-zinc-50">{insight.title}</p>
        <p className="mt-0.5 text-[13px] text-gray-500 dark:text-zinc-400">{insight.description}</p>
      </div>
      {href ? (
        <span
          aria-hidden="true"
          className="shrink-0 pt-1 text-[13px] text-gray-500 dark:text-zinc-500"
        >
          →
        </span>
      ) : null}
    </div>
  );

  const rowClasses = 'block border-b border-gray-200 py-2 last:border-b-0 dark:border-zinc-800';

  if (href) {
    return (
      <Link href={href} className={`${rowClasses} hover:bg-gray-50/60 dark:hover:bg-zinc-800/40`}>
        {body}
      </Link>
    );
  }
  return <div className={rowClasses}>{body}</div>;
}

function SeasonRecapRow({
  leagueSlug,
  currentYear,
  isFirst,
}: {
  leagueSlug?: string;
  currentYear: number;
  isFirst: boolean;
}): React.ReactElement {
  const href = `${leagueSlug ? `/league/${leagueSlug}` : ''}/history`;
  const titleSize = isFirst ? 'text-[15px]' : 'text-[14px]';
  const rowPadding = isFirst ? 'py-2.5' : 'py-2';

  return (
    <Link
      href={href}
      className={`block border-b border-gray-200 ${rowPadding} hover:bg-gray-50/60 dark:border-zinc-800 dark:hover:bg-zinc-800/40`}
    >
      <div className="flex min-h-[44px] items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className={`${titleSize} font-semibold text-gray-950 dark:text-zinc-50`}>
            {currentYear} Season Recap
          </p>
          <p className="mt-0.5 text-[13px] text-gray-500 dark:text-zinc-400">
            Review the full {currentYear} season — champion, standings, and highlights.
          </p>
        </div>
        <span
          aria-hidden="true"
          className="shrink-0 pt-1 text-[13px] text-gray-500 dark:text-zinc-500"
        >
          →
        </span>
      </div>
    </Link>
  );
}

function InsightsList({
  insights,
  leagueSlug,
  lifecycleState,
  currentYear,
}: {
  insights: Insight[];
  leagueSlug?: string;
  lifecycleState?: LifecycleState;
  currentYear?: number;
}): React.ReactElement | null {
  const isDark = isDarkTheme();
  const isFreshOffseason = lifecycleState === 'fresh_offseason';
  const showRecap = isFreshOffseason && typeof currentYear === 'number';

  const rows = insights.slice(
    0,
    showRecap ? OVERVIEW_INSIGHT_SLOTS_WITH_RECAP : OVERVIEW_INSIGHT_SLOTS
  );
  if (!showRecap && rows.length === 0) return null;

  return (
    <div>
      {showRecap ? (
        <SeasonRecapRow leagueSlug={leagueSlug} currentYear={currentYear!} isFirst={true} />
      ) : null}
      {rows.map((insight) => (
        <InsightRow
          key={insight.id}
          insight={insight}
          leagueSlug={leagueSlug}
          isDark={isDark}
          panelYear={currentYear}
        />
      ))}
    </div>
  );
}

type PollSnapshotEntry = {
  rank: number;
  teamName: string;
  teamId: string;
  delta: number | 'new' | null;
};

type PollSnapshot = {
  pollName: string;
  entries: PollSnapshotEntry[];
};

function derivePollSnapshot(
  rankings: RankingsResponse | null,
  phase: 'inSeason' | 'postseason' | 'complete'
): PollSnapshot | null {
  if (!rankings || !rankings.latestWeek) return null;

  const weeks = rankings.weeks;
  const latestWeek = rankings.latestWeek;

  // Determine which poll source to show based on season phase
  const pollSource: RankSource = phase === 'postseason' ? 'cfp' : 'ap';
  const pollName = phase === 'postseason' ? 'CFP Rankings' : 'AP Poll';

  const currentEntries = latestWeek.polls[pollSource] ?? [];
  if (currentEntries.length === 0) {
    // Fall back to AP if CFP not available
    const fallback = latestWeek.polls['ap'] ?? [];
    if (fallback.length === 0) return null;
    return derivePollSnapshotFromEntries('AP Poll', fallback, weeks, latestWeek);
  }

  return derivePollSnapshotFromEntries(pollName, currentEntries, weeks, latestWeek);
}

function derivePollSnapshotFromEntries(
  pollName: string,
  currentEntries: CanonicalPollEntry[],
  weeks: RankingsWeek[],
  latestWeek: RankingsWeek
): PollSnapshot {
  // Find the previous week for delta computation.
  // Use the second-to-last week in the array since latestWeek corresponds
  // to the final entry. indexOf may fail on reference inequality, so match
  // by week/season identity instead.
  const latestIdx = weeks.findIndex(
    (w) =>
      w.season === latestWeek.season &&
      w.week === latestWeek.week &&
      w.seasonType === latestWeek.seasonType
  );
  const previousWeek =
    latestIdx > 0 ? weeks[latestIdx - 1] : weeks.length >= 2 ? weeks[weeks.length - 2] : null;
  const pollSource = currentEntries[0]?.rankSource ?? 'ap';
  const previousEntries = previousWeek?.polls[pollSource] ?? [];
  const prevByTeam = new Map(previousEntries.map((e) => [e.teamId, e.rank]));
  const hasPreviousData = previousEntries.length > 0;

  const top10 = currentEntries.slice(0, 10);

  return {
    pollName,
    entries: top10.map((entry) => {
      // No previous week data at all → show — (not NR)
      if (!hasPreviousData) {
        return { rank: entry.rank, teamName: entry.teamName, teamId: entry.teamId, delta: null };
      }
      const prevRank = prevByTeam.get(entry.teamId);
      // Team was not ranked in previous week → NR
      if (prevRank == null) {
        return {
          rank: entry.rank,
          teamName: entry.teamName,
          teamId: entry.teamId,
          delta: 'new' as const,
        };
      }
      // Compute delta: positive = moved up, negative = moved down
      const delta = prevRank === entry.rank ? null : prevRank - entry.rank;
      return { rank: entry.rank, teamName: entry.teamName, teamId: entry.teamId, delta };
    }),
  };
}

function PollMovementBadge({ delta }: { delta: number | 'new' | null }): React.ReactElement {
  if (delta === 'new') {
    return (
      <span className="w-7 text-right text-[11px] font-medium text-gray-400 dark:text-zinc-500">
        NR
      </span>
    );
  }
  if (delta === null || delta === 0) {
    return <span className="w-7 text-right text-[11px] text-gray-400 dark:text-zinc-500">—</span>;
  }
  if (delta > 0) {
    return (
      <span className="w-7 text-right text-[11px] font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
        ↑{delta}
      </span>
    );
  }
  return (
    <span className="w-7 text-right text-[11px] font-semibold tabular-nums text-red-500 dark:text-red-400">
      ↓{Math.abs(delta)}
    </span>
  );
}

function PollSnapshotColumn({
  snapshot,
  rankingsHref,
}: {
  snapshot: PollSnapshot | null;
  rankingsHref: string;
}): React.ReactElement {
  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[15px] font-medium text-gray-950 dark:text-zinc-50">
          {snapshot?.pollName ?? 'FBS Poll'}
        </p>
        <ViewMoreLink href={rankingsHref}>Full rankings</ViewMoreLink>
      </div>
      {!snapshot || snapshot.entries.length === 0 ? (
        <p className="py-2 text-sm text-gray-400 dark:text-zinc-500">Rankings unavailable</p>
      ) : (
        <div className="text-sm">
          {snapshot.entries.map((entry) => (
            <div
              key={entry.teamId}
              className="flex items-center gap-1.5 border-b border-gray-100 px-1 py-1.5 dark:border-zinc-800"
            >
              <span className="w-5 shrink-0 text-right text-xs font-semibold tabular-nums text-gray-400 dark:text-zinc-500">
                {entry.rank}
              </span>
              <span className="min-w-0 flex-1 truncate font-medium text-gray-900 dark:text-zinc-100">
                {entry.teamName}
              </span>
              <PollMovementBadge delta={entry.delta} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type OverviewPanelProps = {
  games?: AppGame[];
  scoresByKey?: Record<string, ScorePack>;
  rosterByTeam?: Map<string, string>;
  ownerColorMap?: Record<string, string>;
  canonicalStandings?: CanonicalStandings;
  /**
   * Client-derived live overlay (in-progress games, pending W/L). Phase 1
   * passes this through but does not yet consume it visually; later phases
   * will render badges/annotations driven by these deltas.
   */
  liveDelta?: LiveDelta | null;
  standingsLeaders: OwnerStandingsRow[];
  standingsCoverage: StandingsCoverage;
  matchupMatrix: OwnerMatchupMatrix;
  liveItems: OverviewGameItem[];
  keyMatchups: OverviewGameItem[];
  sectionItems?: OverviewGameItem[];
  nowMs: number;
  gamePresentation: Pick<
    OverviewGamePresentation,
    'phase' | 'recapGameKeys' | 'pendingRecapWeek' | 'expiredFinalWeeks'
  >;
  context: OverviewContext;
  displayTimeZone?: string;
  onOwnerSelect?: (owner: string) => void;
  onViewSchedule?: () => void;
  onViewMatchups?: (displayedGame?: AppGame) => void;
  onOpenHighlightTarget?: (target: HighlightDrilldownTarget) => void;
  rankingsByTeamId?: Map<string, TeamRankingEnrichment>;
  rankings?: RankingsResponse | null;
  standingsHistory?: StandingsHistory | null;
  /**
   * PLATFORM-109 — server-derived, see the matching note on `CFBScheduleApp`.
   *
   * Defaults to `in-season`, which is what this component used to compute for an
   * absent or empty history. It is NOT a general reproduction of the old
   * behavior: an isolated render that supplies a history and omits this prop now
   * gets `in-season` where it would once have derived something else. An earlier
   * version of this comment claimed otherwise and review caught it. Every
   * production render passes the prop — `CFBScheduleApp` always supplies it.
   */
  seasonContext?: SeasonContext;
  leagueSlug?: string;
  engineInsights?: Insight[];
  lifecycleState?: LifecycleState;
  currentYear?: number;
};

export default function OverviewPanel({
  games = [],
  scoresByKey = {},
  rosterByTeam = new Map(),
  ownerColorMap = {},
  canonicalStandings,
  liveDelta = null,
  standingsLeaders,
  standingsCoverage,
  matchupMatrix,
  liveItems,
  keyMatchups,
  sectionItems,
  nowMs,
  gamePresentation,
  context,
  displayTimeZone,
  onOwnerSelect,
  onViewSchedule,
  onViewMatchups,
  rankingsByTeamId = new Map(),
  rankings = null,
  standingsHistory = null,
  seasonContext = 'in-season',
  leagueSlug,
  engineInsights = [],
  lifecycleState,
  currentYear,
}: OverviewPanelProps): React.ReactElement {
  // Canonical owns the resolved-week snapshot for Overview: rows, standings
  // history, and color order all flow from it directly. The client-derived
  // overlay (in-progress games, pending W/L) is passed separately as
  // `liveDelta`. Phase 1 wires the overlay through as data only — the visual
  // integration (badges, "leading right now" chips, etc.) lands in later
  // phases per surface.
  //
  // The fallback to `standingsLeaders` / `standingsHistory` covers isolated
  // surfaces (e.g. unit tests rendering OverviewPanel without canonical).
  // It is not a merge predicate: when canonical is present it always wins.
  // (Resolution centralized in resolveOverviewCanonicalInputs — see its tests
  // for the pinned canonical-vs-local contract.)
  const {
    rows: rowsForRender,
    history: historyForRender,
    coverage: coverageForRender,
  } = resolveOverviewCanonicalInputs({
    canonicalStandings,
    standingsLeaders,
    standingsHistory,
    standingsCoverage,
  });
  // POLISH-011 round 4: one field decides both visibility and text — see the
  // matching note in StandingsPanel.
  const coverageNotice = standingsCoverageNoticeWithSubject(coverageForRender);
  // POLISH-013 — ask the SAME selector the children ask; POLISH-014 — ask it of
  // the SAME INPUT they get.
  //
  // The original guard asked whether any week carried owner rows, and
  // `deriveStandingsHistory` builds a cumulative standings table for every week
  // regardless of `played` — so in preseason every week carried a full 0-0 table
  // and the answer was yes, while both children returned null: heading, divider
  // and link over nothing.
  //
  // Asking the right selector was necessary and not sufficient. The parent asked
  // it of the FULL history, where the origin is always present, while the chart
  // re-asked it of a recent WINDOW with the origin withheld — so the two could
  // still disagree, which review found.
  //
  // They now agree because they are given the SAME INPUTS — the same sliced
  // history and the same origin decision — not because they share a value: the
  // child re-derives, and additionally caps at its own `CONTENDERS` limit, which
  // the parent does not apply. An earlier version of this comment claimed one
  // series "derived once and handed to the child", which is not the mechanism.
  // No divergence is reachable today (`deriveStandings` emits a row per roster
  // owner every week, so drawability is uniform across series), but the guarantee
  // is input equality, and that is what a future change has to preserve.
  // A series must be DRAWABLE, not merely present. `MiniTrendsGrid` builds a path
  // by joining points with `L`, so a one-point series emits a moveto-only path
  // ("M235.0,0.0") and SVG renders nothing for it — the guard would say "draw"
  // and the section would be an empty box with axes, which is the defect this
  // slice exists to close arriving one week later.
  //
  // POLISH-014 landed the real fix: the series carry a season ORIGIN (every owner
  // starts 0-0 and 0 games back), so one resolved week is an ordinary two-point
  // segment. `isDrawableTrendSeries` is the one authority all three surfaces ask
  // — this guard, `SeasonArcChart`, and `MiniTrendsGrid` itself — because
  // POLISH-013 shipped the answer in two of the three and the third kept
  // rendering an empty box.
  // POLISH-014 remediation: this section charts the last five RESOLVED weeks, so
  // once a season passes five the window no longer begins at the season's start
  // and the origin would sit one interval before (say) W11 — compressing the
  // whole omitted season into that interval and showing a divergence from level
  // that never happened. Review caught it. The origin is drawn only when NO GAME
  // HAS CONCLUDED before the first plotted week — `seasonOriginApplies` reads
  // `finalGames` from the standings rather than trusting a week flag, because two
  // rounds of review showed both polarities of `played` get this wrong.
  const gbRaceChartHistory = React.useMemo(
    () => (historyForRender ? sliceStandingsHistoryToRecentWeeks(historyForRender, 5) : null),
    [historyForRender]
  );
  const gbRaceStartsAtSeasonStart =
    historyForRender !== null &&
    gbRaceChartHistory !== null &&
    seasonOriginApplies(historyForRender, gbRaceChartHistory.weeks[0]);
  const gbRaceChartSeries = React.useMemo(() => {
    if (!gbRaceChartHistory) return [];
    const series = selectGamesBackTrend({ standingsHistory: gbRaceChartHistory });
    return gbRaceStartsAtSeasonStart ? series : series.map((entry) => ({ ...entry, origin: null }));
  }, [gbRaceChartHistory, gbRaceStartsAtSeasonStart]);
  // The guard must ask about the series the CHILD will actually draw — same
  // history, same origin decision. Review caught the parent asking about the full
  // history (origin always present) while the child re-asked on the window with
  // the origin stripped, which is the POLISH-013 empty-box defect returning
  // through a new seam.
  const gbRaceHasTrendData = gbRaceChartSeries.some(isDrawableTrendSeries);
  // OWNER DECISION (2026-08-23, remediation): the section applies whenever the
  // league HAS owners, history or not. A league with confirmed preseason owners
  // and no draft yet has canonical source `preseason-names` and therefore NO
  // standings history at all, so gating on history alone still made the section
  // appear out of nowhere — the same layout jump the decision rejected, just
  // moved from week one to the draft. A league with no owners keeps the section
  // hidden: "add owners" is the real blocker there, and the standings panel
  // above already says so.
  const gbRaceSectionApplies = rowsForRender.length > 0;
  const timeZone = displayTimeZone ?? getPresentationTimeZone();
  const weekLabelFn = React.useMemo(() => {
    const labelMap = buildWeekLabelMap(games);
    return (week: number) => formatWeekLabel(week, labelMap);
  }, [games]);
  const ownersWithInProgressGames = React.useMemo(
    () => selectOwnersWithInProgressGames({ games, scoresByKey, rosterByTeam }),
    [games, scoresByKey, rosterByTeam]
  );
  const viewModel = React.useMemo(
    () =>
      selectOverviewViewModel({
        standingsLeaders: rowsForRender,
        standingsHistory: historyForRender,
        standingsCoverage: coverageForRender,
        context,
        liveItems,
        keyMatchups,
        matchupMatrix,
        rankingsByTeamId,
        // PLATFORM-109 remediation: the history this component holds has had
        // `pending` stripped, so the view model must NOT re-derive the season
        // context from it. Both independent reviews found this call reclassifying
        // a live season as `final`. The server already derived the answer from
        // the unstripped snapshot; pass it rather than asking again.
        seasonContext,
      }),
    [
      rowsForRender,
      historyForRender,
      coverageForRender,
      context,
      liveItems,
      keyMatchups,
      matchupMatrix,
      rankingsByTeamId,
      seasonContext,
    ]
  );
  const routedSectionItems = React.useMemo(
    () => sectionItems ?? [...liveItems, ...keyMatchups],
    [keyMatchups, liveItems, sectionItems]
  );
  const eligibleWatchlistKeys = React.useMemo(
    () => new Set(viewModel.watchlistCandidates.map(({ item }) => item.bucket.game.key)),
    [viewModel.watchlistCandidates]
  );
  const featuredGameKeys = React.useMemo(
    () => new Set(viewModel.recentResults.map(({ item }) => item.bucket.game.key)),
    [viewModel.recentResults]
  );
  const gameSections = React.useMemo(
    () =>
      selectOverviewGameSections({
        items: routedSectionItems,
        eligibleWatchlistKeys,
        featuredGameKeys,
        presentation: gamePresentation,
        now: new Date(nowMs),
      }),
    [eligibleWatchlistKeys, featuredGameKeys, gamePresentation, nowMs, routedSectionItems]
  );
  const watchlistByKey = React.useMemo(
    () =>
      new Map(
        viewModel.watchlistCandidates.map((prioritized) => [
          prioritized.item.bucket.game.key,
          prioritized,
        ])
      ),
    [viewModel.watchlistCandidates]
  );
  const scheduledItems = React.useMemo(
    () =>
      gameSections.scheduled.flatMap((item) => {
        const prioritized = watchlistByKey.get(item.bucket.game.key);
        return prioritized ? [prioritized] : [];
      }),
    [gameSections.scheduled, watchlistByKey]
  );
  const scheduledStatusByKey = React.useMemo(
    () => new Map(gameSections.scheduled.map((item) => [item.bucket.game.key, item.routeStatus])),
    [gameSections.scheduled]
  );
  const liveTitle = `Live · ${gameSections.live.length}`;
  const sharedInsights = React.useMemo(() => {
    // Insight narratives compare against historyForRender's resolved weeks. If
    // we feed deriveLeagueInsights raw rowsForRender during a partial week, the
    // current snapshot reflects unresolved game state while the history deltas
    // do not — race/surge narratives can then contradict the week-level history.
    // Anchor the rows input to the latest resolved week when available; fall
    // back to rowsForRender only when no resolved history exists (preseason,
    // cold start) so insights still have something to describe.
    const { latest: latestResolvedStandings } = deriveResolvedMovementStandings(historyForRender);
    const insightRows = latestResolvedStandings ?? rowsForRender;

    const existing = deriveOverviewInsights(
      deriveLeagueInsights({
        rows: insightRows,
        standingsHistory: historyForRender,
        seasonContext,
      })
    );

    // INSIGHTS-029 — the loader serves up to MAX_INSIGHTS (10); this panel shows
    // 5, so ranks 6-10 are dropped here and never render. Suppression used to
    // churn that tail into view as a side effect of hiding what it had already
    // shown; nothing does now. Rotation is the real answer and is deferred
    // behind INSIGHTS-023 (see the INSIGHTS-029 / 018 / 023 items in docs/next-tasks.md).
    //
    // The `existing` filler below is NOT dead: it still fires whenever the
    // engine returns fewer than 5, which a young league does. Before 029 the
    // drained feed made it the main source; now it is a genuine fallback.
    const ranked = [...engineInsights].sort((a, b) => b.priorityScore - a.priorityScore);
    const seen = new Set(ranked.map((i) => i.id));
    const merged: Insight[] = [...ranked];
    for (const insight of existing) {
      if (merged.length >= OVERVIEW_INSIGHT_SLOTS) break;
      if (seen.has(insight.id)) continue;
      seen.add(insight.id);
      merged.push(insight);
    }
    return merged.slice(0, OVERVIEW_INSIGHT_SLOTS);
  }, [historyForRender, rowsForRender, engineInsights, seasonContext]);

  const positionDeltaData = React.useMemo(() => {
    if (!historyForRender) return null;
    const { weeks, owners } = selectPositionDeltas({
      standingsHistory: historyForRender,
      maxWeeks: 5,
    });
    if (weeks.length === 0) return null;
    const byOwner = new Map<string, Map<number, number | null>>();
    for (const owner of owners) {
      const deltaMap = new Map<number, number | null>();
      for (const d of owner.deltas) {
        deltaMap.set(d.week, d.delta);
      }
      byOwner.set(owner.ownerName, deltaMap);
    }
    return { weeks, byOwner };
  }, [historyForRender]);

  const pollSnapshot = React.useMemo(() => {
    const phase = viewModel.championSummary?.phase ?? 'inSeason';
    return derivePollSnapshot(rankings, phase);
  }, [rankings, viewModel.championSummary]);

  const standingsHref = `${leagueSlug ? `/league/${leagueSlug}` : ''}/standings`;
  const rankingsHref = `${leagueSlug ? `/league/${leagueSlug}` : ''}/standings`;

  return (
    <div className="space-y-5">
      {/* Podium / Hero */}
      <LeagueSummaryHero
        summary={viewModel.championSummary}
        heroMode={viewModel.heroMode}
        podiumLeaders={viewModel.podiumLeaders}
        standingsLeaders={rowsForRender}
        leader={rowsForRender[0]}
        leagueSlug={leagueSlug}
      />

      <SectionDivider />

      {/* Standings · FBS Polls · Insights */}
      <section>
        {/* POLISH-011: this notice sits above standings, FBS polls and insights
            together under a tab reading "Overview", so it names its subject.
            `StandingsPanel` uses the short form because it is already inside the
            standings view — it has no heading of its own. Neither surface renders
            a raw `partial` message: coverage is durable and cached, so retired
            copy must never reach a member. Other states pass through — see the
            scope note on `standingsCoverageNotice`. */}
        {coverageNotice ? (
          <p
            className={`mb-3 text-sm ${
              coverageForRender.state === 'error'
                ? 'text-amber-700 dark:text-amber-300'
                : 'text-gray-600 dark:text-zinc-300'
            }`}
          >
            {coverageNotice}
          </p>
        ) : null}
        {viewModel.standingsTopN.length === 0 ? (
          <EmptyState message="Add owners to populate standings." compact />
        ) : (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-[1fr_1fr_2fr] md:items-start">
            {/* Column 1: Standings table with inline deltas */}
            <div className="min-w-0">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-[15px] font-medium text-gray-950 dark:text-zinc-50">Standings</p>
                <ViewMoreLink href={standingsHref}>Full standings</ViewMoreLink>
              </div>
              <CondensedStandingsTable
                rows={viewModel.standingsTopN}
                onOwnerSelect={onOwnerSelect}
                previousRows={viewModel.previousStandingsLeaders}
                ownersWithInProgressGames={ownersWithInProgressGames}
                liveDelta={liveDelta}
                deltaWeeks={positionDeltaData?.weeks}
                deltasByOwner={positionDeltaData?.byOwner}
                weekLabel={weekLabelFn}
              />
            </div>
            {/* Column 2: FBS Polls snapshot */}
            <PollSnapshotColumn snapshot={pollSnapshot} rankingsHref={rankingsHref} />
            {/* Column 3: Insights */}
            {sharedInsights.length > 0 || lifecycleState === 'fresh_offseason' ? (
              <div className="min-w-0">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-[15px] font-medium text-gray-950 dark:text-zinc-50">
                    Insights
                  </p>
                  <ViewMoreLink href={`${leagueSlug ? `/league/${leagueSlug}` : ''}/insights`}>
                    See all
                  </ViewMoreLink>
                </div>
                <InsightsList
                  insights={sharedInsights}
                  leagueSlug={leagueSlug}
                  lifecycleState={lifecycleState}
                  currentYear={currentYear}
                />
              </div>
            ) : null}
          </div>
        )}
      </section>

      <SectionDivider />

      {/* Featured games */}
      <section className="@container">
        <SectionHeader
          title="Featured games"
          action={
            <button type="button" className={viewMoreLinkClass} onClick={onViewSchedule}>
              All results →
            </button>
          }
        />
        <div className="mt-2.5">
          <FeaturedGamesList
            prioritizedItems={viewModel.recentResults}
            emptyMessage="No recent results yet."
            timeZone={timeZone}
            rankingsByTeamId={rankingsByTeamId}
          />
        </div>
      </section>

      {/* Upcoming watchlist */}
      {scheduledItems.length > 0 ? (
        <>
          <SectionDivider />
          <section>
            <SectionHeader
              title="Upcoming watchlist"
              action={
                <button
                  type="button"
                  className={viewMoreLinkClass}
                  onClick={() => onViewMatchups?.()}
                >
                  All matchups →
                </button>
              }
            />
            <div className="mt-2.5">
              <GameSummaryList
                prioritizedItems={scheduledItems}
                emptyMessage="No featured matchups yet for this slate."
                timeZone={timeZone}
                rankingsByTeamId={rankingsByTeamId}
                routeStatusByGameKey={scheduledStatusByKey}
                density="featured"
              />
            </div>
          </section>
        </>
      ) : null}

      {/* Live games */}
      {gameSections.live.length > 0 ? (
        <>
          <SectionDivider />
          <section className="@container">
            <SectionHeader
              title={liveTitle}
              action={
                <button
                  type="button"
                  className={viewMoreLinkClass}
                  onClick={() => onViewMatchups?.(gameSections.live[0]?.bucket.game)}
                >
                  All matchups →
                </button>
              }
            />
            <div className="mt-2.5">
              <GameCardList
                items={gameSections.live}
                rankingsByTeamId={rankingsByTeamId}
                timeZone={timeZone}
              />
            </div>
          </section>
        </>
      ) : null}

      {/* Recent finals */}
      {gameSections.recentFinals.length > 0 ? (
        <>
          <SectionDivider />
          <section className="@container">
            <SectionHeader
              title="Recent finals"
              action={
                <button type="button" className={viewMoreLinkClass} onClick={onViewSchedule}>
                  All results →
                </button>
              }
            />
            <div className="mt-2.5">
              <GameCardList
                items={gameSections.recentFinals}
                rankingsByTeamId={rankingsByTeamId}
                timeZone={timeZone}
              />
            </div>
          </section>
        </>
      ) : null}

      {/* GB Race */}
      {gbRaceSectionApplies ? (
        <>
          <SectionDivider />
          <section>
            <SectionHeader
              title="GB Race"
              action={
                <ViewMoreLink href={`${standingsHref}?view=trends#trends`}>
                  Full standings
                </ViewMoreLink>
              }
            />
            {gbRaceHasTrendData && historyForRender && gbRaceChartHistory ? (
              <div className="mt-2.5 flex flex-col gap-3 sm:flex-row">
                <div className="min-w-0 flex-1">
                  <MiniTrendsGrid
                    standingsHistory={gbRaceChartHistory}
                    weekLabel={weekLabelFn}
                    ownerColorMap={ownerColorMap}
                    startsAtSeasonStart={gbRaceStartsAtSeasonStart}
                  />
                </div>
                <div className="shrink-0">
                  <GbChangeTable
                    standingsHistory={historyForRender}
                    standingsLeaders={rowsForRender}
                    weekLabel={weekLabelFn}
                    ownerColorMap={ownerColorMap}
                  />
                </div>
              </div>
            ) : (
              // OWNER DECISION (2026-08-23): keep the section and explain the
              // gap. Hiding it makes the page jump when week one resolves, and
              // the convention one row up on this same page is an explained
              // empty state rather than a disappearing section. No axes — a
              // preseason week axis would silently reshape once the postseason
              // bracket populates (`schedule.ts` remaps postseason weeks).
              <div className="mt-2.5">
                <EmptyState message={TREND_EMPTY_MESSAGE} compact />
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}

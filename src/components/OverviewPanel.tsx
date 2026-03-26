import React from 'react';

import { formatGameMatchupLabel, gameStateFromScore } from '../lib/gameUi';
import {
  computeStandings,
  deriveOverviewHighlightSignals,
  deriveLeagueInsights,
} from '../lib/leagueInsights';
import {
  deriveLeagueSummaryViewModel,
  deriveStandingsContextLabel,
  prioritizeOverviewItems,
} from '../lib/selectors/overview';
import type { OverviewContext, OverviewGameItem, OwnerMatchupMatrix } from '../lib/overview';
import type { TeamRankingEnrichment } from '../lib/rankings';
import { getGameParticipantTeamId, type AppGame } from '../lib/schedule';
import type { ScorePack } from '../lib/scores';
import type { OwnerStandingsRow, StandingsCoverage } from '../lib/standings';
import { getPresentationTimeZone } from '../lib/weekPresentation';
import RankedTeamName from './RankedTeamName';

function formatWinPct(value: number): string {
  return value.toFixed(3);
}

function formatDiff(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function formatKickoff(date: string | null, timeZone: string): string {
  if (!date) return 'TBD';
  const kickoff = new Date(date);
  if (Number.isNaN(kickoff.getTime())) return 'TBD';

  return kickoff.toLocaleString(undefined, {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
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
      <RankedTeamName teamName={game.csvAway} ranking={rankingsByTeamId.get(awayTeamId)} />
      {separator}
      <RankedTeamName teamName={game.csvHome} ranking={rankingsByTeamId.get(homeTeamId)} />
    </>
  );
}

function formatScoreLine(item: OverviewGameItem): string {
  const score = item.score;
  if (!score) return 'Awaiting score';

  const awayScore = score.away.score ?? '—';
  const homeScore = score.home.score ?? '—';
  return `${formatGameMatchupLabel(item.bucket.game)} · ${awayScore}-${homeScore}`;
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

function stateBadgeClasses(state: 'final' | 'inprogress' | 'scheduled' | 'unknown'): string {
  if (state === 'inprogress') {
    return 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300';
  }
  if (state === 'final') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300';
  }
  return 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300';
}

function SectionCard({
  title,
  children,
  tone = 'default',
  headingClassName,
  compact = false,
}: {
  title: string;
  children: React.ReactNode;
  tone?: 'default' | 'live' | 'weekly' | 'secondary';
  headingClassName?: string;
  compact?: boolean;
}): React.ReactElement {
  const toneClasses =
    tone === 'live'
      ? 'border-amber-200/80 bg-gradient-to-br from-amber-50/90 to-white dark:border-amber-900/60 dark:from-amber-950/25 dark:to-zinc-900'
      : tone === 'weekly'
        ? 'border-blue-200/70 bg-gradient-to-br from-blue-50/70 to-white dark:border-blue-900/60 dark:from-blue-950/20 dark:to-zinc-900'
        : tone === 'secondary'
          ? 'border-gray-200 bg-gray-50/80 dark:border-zinc-800 dark:bg-zinc-950/60'
          : 'border-gray-300 bg-white dark:border-zinc-700 dark:bg-zinc-900';

  return (
    <section
      className={`rounded-xl border shadow-sm ${compact ? 'p-2.5 sm:p-3.5' : 'p-3 sm:p-4.5'} ${toneClasses}`}
    >
      <h2
        className={`text-lg font-semibold tracking-tight text-gray-950 dark:text-zinc-50 ${headingClassName ?? ''}`.trim()}
      >
        {title}
      </h2>
      <div className={`${compact ? 'mt-2' : 'mt-2.5'}`}>{children}</div>
    </section>
  );
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

function LeagueSummaryHero({
  standingsLeaders,
  context,
  liveItems,
  keyMatchups,
  standingsCoverage,
}: {
  standingsLeaders: OwnerStandingsRow[];
  context: OverviewContext;
  liveItems: OverviewGameItem[];
  keyMatchups: OverviewGameItem[];
  standingsCoverage: StandingsCoverage;
}): React.ReactElement {
  const leader = standingsLeaders[0];

  if (!leader) {
    return (
      <section className="rounded-2xl border border-gray-200 bg-gray-50/90 px-4 py-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/60 sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-zinc-400">
          League summary
        </p>
        <p className="mt-2 text-sm text-gray-700 dark:text-zinc-200">
          Upload surnames to unlock league leader tracking.
        </p>
      </section>
    );
  }

  const summary = deriveLeagueSummaryViewModel({
    standingsLeaders,
    context,
    liveItems,
    keyMatchups,
    standingsCoverage,
  });
  if (!summary) return <></>;

  const toneClasses =
    summary.phase === 'complete'
      ? 'border-emerald-300/80 from-emerald-100/80 dark:border-emerald-900/70 dark:from-emerald-950/30'
      : 'border-blue-200 dark:border-blue-900/70 from-blue-100/90 dark:from-blue-950/35';

  return (
    <section
      className={`rounded-2xl border bg-gradient-to-r via-white to-white px-4 py-4 shadow-sm dark:via-zinc-900 dark:to-zinc-900 sm:px-6 sm:py-5 ${toneClasses}`}
    >
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-600 dark:text-zinc-300">
        League summary
      </p>
      <p className="mt-1.5 text-xl font-bold tracking-tight text-gray-950 dark:text-zinc-50 sm:text-2xl">
        {summary.headline}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-gray-700 dark:text-zinc-200">
        <span className="rounded-full border border-gray-300 bg-white/85 px-2 py-0.5 font-semibold text-gray-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100">
          {leader.wins}–{leader.losses}
        </span>
        <span className="font-medium">Win% {formatWinPct(leader.winPct)}</span>
        <span className="text-gray-500 dark:text-zinc-400">•</span>
        <span className="font-medium">{summary.metricSignal}</span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-600 dark:text-zinc-300">
        <span>{summary.supportingCopy}</span>
        {summary.placementSummary ? (
          <>
            <span className="text-gray-500 dark:text-zinc-400">•</span>
            <span>{summary.progressSignal}</span>
          </>
        ) : null}
      </div>
    </section>
  );
}

function CondensedStandingsTable({
  rows,
  onOwnerSelect,
  previousRows,
  liveCountByOwner,
}: {
  rows: OwnerStandingsRow[];
  onOwnerSelect?: (owner: string) => void;
  previousRows?: OwnerStandingsRow[] | null;
  liveCountByOwner?: Map<string, number>;
}): React.ReactElement {
  const previousRankLookup = new Map(
    (previousRows ?? []).map((row, index) => [row.owner, index + 1] as const)
  );
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <div className="min-w-full text-sm sm:text-[0.92rem]">
        <div className="grid grid-cols-[2.2rem_minmax(0,1fr)] items-center gap-x-2 border-b border-gray-200 px-2 py-1.5 text-xs uppercase tracking-[0.14em] text-gray-500 dark:border-zinc-700 dark:text-zinc-500">
          <span className="font-semibold">Rank</span>
          <span className="font-semibold">Owner · Record · Metrics</span>
        </div>

        {rows.map((row, index) => {
          const isTopThree = index < 3;
          const liveCount = liveCountByOwner?.get(row.owner) ?? 0;
          return (
            <div
              key={row.owner}
              className={`grid grid-cols-[2.2rem_minmax(0,1fr)] items-center gap-x-2 border-b border-gray-100 px-2 py-2 dark:border-zinc-800 ${
                index === 0
                  ? 'bg-blue-100/90 ring-1 ring-inset ring-blue-300 dark:bg-blue-950/40 dark:ring-blue-800'
                  : isTopThree
                    ? 'bg-blue-50/60 dark:bg-blue-950/15'
                    : 'odd:bg-gray-50/70 even:bg-white dark:odd:bg-zinc-950/70 dark:even:bg-zinc-900'
              }`}
            >
              <span className="text-base font-semibold tabular-nums text-gray-900 dark:text-zinc-100">
                {index + 1}
                {(() => {
                  const previousRank = previousRankLookup.get(row.owner);
                  if (!previousRank || previousRank === index + 1) return null;
                  const movedUp = previousRank > index + 1;
                  return (
                    <span
                      className={`ml-1 text-[11px] font-semibold ${
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
              <div className={`min-w-0 ${index > 2 ? 'text-gray-800 dark:text-zinc-200' : ''}`}>
                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                  <span
                    className={`min-w-0 truncate ${
                      index === 0
                        ? 'font-extrabold text-gray-950 dark:text-zinc-50'
                        : isTopThree
                          ? 'font-bold text-gray-950 dark:text-zinc-50'
                          : 'font-semibold text-gray-900 dark:text-zinc-100'
                    }`}
                  >
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
                  {index === 0 ? (
                    <span className="rounded-full border border-blue-300 bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-800 dark:border-blue-800 dark:bg-blue-900/40 dark:text-blue-200">
                      Leader
                    </span>
                  ) : null}
                  <span className="text-sm font-semibold tabular-nums text-gray-900 dark:text-zinc-100">
                    {row.wins}–{row.losses}
                  </span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-gray-500 dark:text-zinc-400">
                  <span>Win% {formatWinPct(row.winPct)}</span>
                  <span>Diff {formatDiff(row.pointDifferential)}</span>
                  {liveCount > 0 ? (
                    <span className="rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 font-medium text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                      {liveCount} live
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TeamMatchupMatrixTable({ matrix }: { matrix: OwnerMatchupMatrix }): React.ReactElement {
  if (matrix.owners.length === 0) {
    return <EmptyState message="Upload surnames to map weekly head-to-head game counts." compact />;
  }

  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <div className="mb-2 text-xs text-gray-500 dark:text-zinc-400 sm:hidden">
        Scroll sideways to compare every surname.
      </div>
      <table className="min-w-max border-separate border-spacing-0 text-center text-sm">
        <thead>
          <tr className="text-xs uppercase tracking-[0.16em] text-gray-500 dark:text-zinc-500">
            <th className="sticky left-0 z-10 whitespace-nowrap border-b border-gray-200 bg-white px-2 py-1.5 text-left font-semibold dark:border-zinc-700 dark:bg-zinc-900">
              Team
            </th>
            {matrix.owners.map((owner) => (
              <th
                key={owner}
                className="w-10 whitespace-nowrap border-b border-gray-200 px-2 py-1.5 font-semibold dark:border-zinc-700"
              >
                {owner}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.rows.map((row) => (
            <tr
              key={row.owner}
              className="odd:bg-gray-50/70 even:bg-white dark:odd:bg-zinc-950/70 dark:even:bg-zinc-900"
            >
              <th className="sticky left-0 z-10 whitespace-nowrap border-b border-gray-100 bg-inherit px-2 py-1.5 text-left font-semibold leading-tight text-gray-950 dark:border-zinc-800 dark:text-zinc-50">
                {row.owner}
              </th>
              {row.cells.map((cell) => {
                const isDiagonal = cell.owner === row.owner;
                const hasGames = cell.gameCount > 0;
                return (
                  <td
                    key={`${row.owner}-${cell.owner}`}
                    className={`w-10 border-b border-gray-100 px-2 py-1.5 align-middle leading-tight dark:border-zinc-800 ${
                      isDiagonal
                        ? 'bg-gray-100/80 dark:bg-zinc-800/70'
                        : hasGames
                          ? 'bg-blue-50/70 font-semibold text-gray-900 dark:bg-blue-950/20 dark:text-zinc-100'
                          : 'text-gray-400 dark:text-zinc-600'
                    }`}
                  >
                    {hasGames ? (
                      <div className="flex flex-col items-center leading-tight">
                        <span>{cell.gameCount}</span>
                        {cell.record ? (
                          <span className="text-[11px] font-medium text-gray-500 dark:text-zinc-400">
                            {cell.record}
                          </span>
                        ) : null}
                      </div>
                    ) : (
                      <span>{isDiagonal ? '—' : ''}</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GameCardList({
  items,
  timeZone,
  rankingsByTeamId,
}: {
  items: OverviewGameItem[];
  timeZone: string;
  rankingsByTeamId: Map<string, TeamRankingEnrichment>;
}): React.ReactElement {
  if (items.length === 0) {
    return <p className="text-sm text-gray-500 dark:text-zinc-400">No live games.</p>;
  }

  return (
    <div className="space-y-3 sm:space-y-3">
      {items.map((item) => {
        const state = gameStateFromScore(item.score);
        return (
          <article
            key={item.bucket.game.key}
            className="rounded-lg border border-amber-200/80 bg-white/85 p-3 sm:p-4 dark:border-amber-900/70 dark:bg-zinc-950/70"
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-gray-950 dark:text-zinc-50">
                  {renderMatchupLabel(item, rankingsByTeamId)}
                </div>
                <div className="text-sm text-gray-600 dark:text-zinc-300">
                  {summarizeLeagueAngle(item, rankingsByTeamId)}
                </div>
              </div>
              <span
                className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${stateBadgeClasses(state)}`}
              >
                {item.score?.status ?? 'Scheduled'}
              </span>
            </div>
            <div className="mt-2 text-sm font-medium text-gray-800 dark:text-zinc-100">
              {formatScoreLine(item)}
            </div>
            <div className="mt-1 text-xs text-gray-500 dark:text-zinc-400">
              {formatKickoff(item.bucket.game.date, timeZone)}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function GameSummaryList({
  items,
  emptyMessage,
  timeZone,
  rankingsByTeamId,
  topOwnerNames,
  highlightSignals,
}: {
  items: OverviewGameItem[];
  emptyMessage: string;
  timeZone: string;
  rankingsByTeamId: Map<string, TeamRankingEnrichment>;
  topOwnerNames: Set<string>;
  highlightSignals: {
    topMatchupKey: string | null;
    upsetWatchKeys: string[];
    rankedHighlightKey: string | null;
  };
}): React.ReactElement {
  if (items.length === 0) {
    return <EmptyState message={emptyMessage} compact />;
  }

  const prioritizedItems = prioritizeOverviewItems({
    items,
    highlightSignals,
    rankingsByTeamId,
    topOwnerNames,
  });

  return (
    <div className="space-y-1.5">
      {prioritizedItems.map((prioritized) => {
        const item = prioritized.item;
        const score = item.score;
        const awayScore = score?.away.score ?? '—';
        const homeScore = score?.home.score ?? '—';
        const status = score?.status ?? 'Scheduled';
        const state = gameStateFromScore(score);
        const kickoff = formatKickoff(item.bucket.game.date, timeZone);
        const ownerLabel =
          item.bucket.awayOwner && item.bucket.homeOwner
            ? `${item.bucket.awayOwner} vs ${item.bucket.homeOwner}`
            : summarizeLeagueAngle(item, rankingsByTeamId);
        const highlightTags = prioritized.highlightTags;

        return (
          <article
            key={item.bucket.game.key}
            className={`rounded-lg border p-3 ${
              prioritized.hasPriorityHighlight
                ? 'border-blue-300/80 bg-blue-50/40 dark:border-blue-900/70 dark:bg-blue-950/15'
                : 'border-gray-200 bg-white/80 dark:border-zinc-800 dark:bg-zinc-950/70'
            }`}
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
                          className="inline-flex rounded-full border border-gray-300 bg-white/85 px-1.5 py-0.5 text-xs font-semibold text-gray-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
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
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300">
                    {prioritized.highlightLabel}
                  </p>
                ) : null}
                <div className="mt-0.5 flex items-center gap-2 text-[11px] text-gray-500 dark:text-zinc-400">
                  <span
                    className={`inline-flex rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${stateBadgeClasses(state)}`}
                  >
                    {status}
                  </span>
                  <span aria-hidden="true">•</span>
                  <span>{kickoff}</span>
                </div>
              </div>
              <div className="flex items-start justify-end pt-0.5">
                <span className="w-[3.7rem] rounded-md border border-gray-200 bg-white/85 px-1 py-1 text-center text-sm font-semibold tabular-nums text-gray-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 sm:w-[4rem]">
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

function InsightStrip({
  insights,
}: {
  insights: { id: string; text: string }[];
}): React.ReactElement | null {
  if (insights.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-lg border border-gray-200/80 bg-gray-50/70 px-2.5 py-1.5 text-xs text-gray-600 dark:border-zinc-800 dark:bg-zinc-950/60 dark:text-zinc-300">
      {insights.map((insight, index) => (
        <React.Fragment key={insight.id}>
          {index > 0 ? <span aria-hidden="true">•</span> : null}
          <span className="font-medium">{insight.text}</span>
        </React.Fragment>
      ))}
    </div>
  );
}

type OverviewPanelProps = {
  games?: AppGame[];
  scoresByKey?: Record<string, ScorePack>;
  rosterByTeam?: Map<string, string>;
  standingsLeaders: OwnerStandingsRow[];
  standingsCoverage: StandingsCoverage;
  matchupMatrix: OwnerMatchupMatrix;
  liveItems: OverviewGameItem[];
  keyMatchups: OverviewGameItem[];
  context: OverviewContext;
  displayTimeZone?: string;
  onOwnerSelect?: (owner: string) => void;
  rankingsByTeamId?: Map<string, TeamRankingEnrichment>;
  previousStandingsLeaders?: OwnerStandingsRow[] | null;
};

export default function OverviewPanel({
  games = [],
  scoresByKey = {},
  rosterByTeam = new Map(),
  standingsLeaders,
  standingsCoverage,
  matchupMatrix,
  liveItems,
  keyMatchups,
  context,
  displayTimeZone,
  onOwnerSelect,
  rankingsByTeamId = new Map(),
  previousStandingsLeaders = null,
}: OverviewPanelProps): React.ReactElement {
  const [isMobileMatrixExpanded, setIsMobileMatrixExpanded] = React.useState(false);
  const timeZone = displayTimeZone ?? getPresentationTimeZone();
  const liveTitle = liveItems.length === 0 ? 'Live · none' : `Live · ${liveItems.length}`;
  const topOwnerNames = React.useMemo(
    () => new Set(standingsLeaders.slice(0, 3).map((row) => row.owner)),
    [standingsLeaders]
  );
  const insights = React.useMemo(
    () =>
      deriveLeagueInsights({
        standings: standingsLeaders,
        previousStandings: previousStandingsLeaders,
        recentResults: keyMatchups,
        liveGames: liveItems,
        rankingsByTeamId,
      }),
    [standingsLeaders, previousStandingsLeaders, keyMatchups, liveItems, rankingsByTeamId]
  );
  const leagueStandings = React.useMemo(
    () => computeStandings(games, scoresByKey, rosterByTeam),
    [games, scoresByKey, rosterByTeam]
  );
  const liveCountByOwner = React.useMemo(
    () => new Map(leagueStandings.map((row) => [row.owner, row.liveGames] as const)),
    [leagueStandings]
  );
  const highlightSignals = React.useMemo(
    () =>
      deriveOverviewHighlightSignals({
        keyMatchups,
        rankingsByTeamId,
      }),
    [keyMatchups, rankingsByTeamId]
  );
  const standingsContext = React.useMemo(
    () => deriveStandingsContextLabel(standingsLeaders),
    [standingsLeaders]
  );

  return (
    <div className="space-y-3">
      <LeagueSummaryHero
        standingsLeaders={standingsLeaders}
        context={context}
        liveItems={liveItems}
        keyMatchups={keyMatchups}
        standingsCoverage={standingsCoverage}
      />
      <InsightStrip insights={insights} />

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <SectionCard title="League standings" headingClassName="text-lg sm:text-xl" compact>
          {standingsContext ? (
            <p className="mb-2 text-xs font-medium text-gray-600 dark:text-zinc-300">
              {standingsContext}
            </p>
          ) : null}
          {standingsCoverage.message ? (
            <p
              className={`mb-3 text-sm ${
                standingsCoverage.state === 'error'
                  ? 'text-amber-700 dark:text-amber-300'
                  : 'text-gray-600 dark:text-zinc-300'
              }`}
            >
              {standingsCoverage.message}
            </p>
          ) : null}
          {standingsLeaders.length === 0 ? (
            <EmptyState message="Upload surnames to populate league standings." compact />
          ) : (
            <CondensedStandingsTable
              rows={standingsLeaders}
              onOwnerSelect={onOwnerSelect}
              previousRows={previousStandingsLeaders}
              liveCountByOwner={liveCountByOwner}
            />
          )}
        </SectionCard>

        <div className="space-y-3">
          <SectionCard title={context.highlightsTitle} tone="weekly" compact>
            <GameSummaryList
              items={keyMatchups}
              emptyMessage="No league-relevant games are scheduled for this view."
              timeZone={timeZone}
              rankingsByTeamId={rankingsByTeamId}
              topOwnerNames={topOwnerNames}
              highlightSignals={highlightSignals}
            />
          </SectionCard>

          {liveItems.length > 0 ? (
            <SectionCard title={liveTitle} tone="live" compact>
              <GameCardList
                items={liveItems}
                timeZone={timeZone}
                rankingsByTeamId={rankingsByTeamId}
              />
            </SectionCard>
          ) : (
            <p className="px-1 text-xs text-gray-500 dark:text-zinc-400">
              No live games right now.
            </p>
          )}
        </div>
      </div>

      <SectionCard
        title="Head-to-head matrix"
        tone="secondary"
        headingClassName="text-sm sm:text-base"
        compact
      >
        <details
          className="group sm:hidden"
          data-testid="head-to-head-details"
          onToggle={(event) => {
            setIsMobileMatrixExpanded((event.currentTarget as HTMLDetailsElement).open);
          }}
        >
          <summary className="cursor-pointer list-none text-xs font-medium text-gray-500 group-open:mb-2 dark:text-zinc-400">
            Head-to-head (tap to expand)
          </summary>
          {isMobileMatrixExpanded ? <TeamMatchupMatrixTable matrix={matchupMatrix} /> : null}
        </details>
        <div className="hidden sm:block">
          <TeamMatchupMatrixTable matrix={matchupMatrix} />
        </div>
      </SectionCard>
    </div>
  );
}

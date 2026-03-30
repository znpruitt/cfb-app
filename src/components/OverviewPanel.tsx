import React from 'react';
import Link from 'next/link';

import { formatGameMatchupLabel, gameStateFromScore } from '../lib/gameUi';
import type { HighlightDrilldownTarget } from '../lib/highlightDrilldown';
import {
  deriveLeagueInsights,
  deriveOverviewInsights,
  type Insight,
} from '../lib/selectors/insights';
import { selectOverviewViewModel, type PrioritizedOverviewItem } from '../lib/selectors/overview';
import { selectSeasonContext } from '../lib/selectors/seasonContext';
import { selectResolvedStandingsWeeks } from '../lib/selectors/historyResolution';
import type { OverviewContext, OverviewGameItem, OwnerMatchupMatrix } from '../lib/overview';
import type { TeamRankingEnrichment } from '../lib/rankings';
import { getGameParticipantTeamId, type AppGame } from '../lib/schedule';
import type { ScorePack } from '../lib/scores';
import type { OwnerStandingsRow, StandingsCoverage } from '../lib/standings';
import type { StandingsHistory } from '../lib/standingsHistory';
import { getPresentationTimeZone } from '../lib/weekPresentation';
import RankedTeamName from './RankedTeamName';

function formatWinPct(value: number): string {
  return value.toFixed(3);
}

function formatWinPctPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
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
  action,
}: {
  title: string;
  children: React.ReactNode;
  tone?: 'default' | 'live' | 'weekly' | 'secondary';
  headingClassName?: string;
  compact?: boolean;
  action?: React.ReactNode;
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
      <div className="flex items-center justify-between gap-2">
        <h2
          className={`text-lg font-semibold tracking-tight text-gray-950 dark:text-zinc-50 ${headingClassName ?? ''}`.trim()}
        >
          {title}
        </h2>
        {action ?? null}
      </div>
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
  summary,
  narrative,
  heroMode,
  podiumLeaders,
  leader,
}: {
  summary: ReturnType<typeof selectOverviewViewModel>['championSummary'];
  narrative: ReturnType<typeof selectOverviewViewModel>['heroNarrative'];
  heroMode: ReturnType<typeof selectOverviewViewModel>['heroMode'];
  podiumLeaders: ReturnType<typeof selectOverviewViewModel>['podiumLeaders'];
  leader: OwnerStandingsRow | undefined;
}): React.ReactElement {
  if (!leader) {
    return (
      <section className="rounded-xl border border-gray-200 bg-gray-50/90 px-4 py-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/60 sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-zinc-400">
          League summary
        </p>
        <p className="mt-2 text-sm text-gray-700 dark:text-zinc-200">
          Upload surnames to unlock league leader tracking.
        </p>
      </section>
    );
  }

  if (!summary) return <></>;

  if (heroMode === 'podium' && podiumLeaders.length === 3) {
    const [first, second, third] = podiumLeaders;
    const cards: Array<{
      rank: 1 | 2 | 3;
      row: OwnerStandingsRow;
      className: string;
      labelClassName: string;
      rankLabel: string;
    }> = [
      {
        rank: 1,
        row: first,
        className:
          'border-amber-400/70 bg-gradient-to-b from-amber-100/80 to-white ring-1 ring-amber-300/50 dark:border-amber-600/50 dark:from-amber-950/40 dark:to-zinc-900 dark:ring-amber-700/40',
        labelClassName: 'text-amber-700 dark:text-amber-400',
        rankLabel: '#1 · Champion',
      },
      {
        rank: 2,
        row: second,
        className:
          'border-slate-300/80 bg-gradient-to-b from-slate-100/90 to-white dark:border-slate-600/60 dark:from-slate-800/50 dark:to-zinc-900',
        labelClassName: 'text-slate-500 dark:text-slate-400',
        rankLabel: '#2',
      },
      {
        rank: 3,
        row: third,
        className:
          'border-orange-300/70 bg-gradient-to-b from-orange-100/70 to-white dark:border-orange-700/50 dark:from-orange-950/30 dark:to-zinc-900',
        labelClassName: 'text-orange-700 dark:text-orange-400',
        rankLabel: '#3',
      },
    ];

    return (
      <section className="rounded-xl border border-gray-200 bg-white px-4 py-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/80 sm:px-7 sm:py-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-600 dark:text-zinc-300">
          Final standings
        </p>
        <p className="mt-1.5 text-xl font-bold tracking-tight text-gray-950 dark:text-zinc-50 sm:text-2xl">
          Season podium
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {cards.map((card) => (
            <article
              key={card.rank}
              className={`rounded-xl border px-3 py-3 shadow-sm ${card.className} ${
                card.rank === 1 ? 'sm:-translate-y-1.5 sm:py-4' : ''
              }`}
            >
              <p
                className={`text-xs font-semibold uppercase tracking-wider ${card.labelClassName}`}
              >
                {card.rankLabel}
              </p>
              <p
                className={`mt-1 text-base ${
                  card.rank === 1 ? 'font-extrabold' : 'font-bold'
                } text-gray-950 dark:text-zinc-50`}
              >
                {card.row.owner}
              </p>
              <p
                className={`mt-1 font-semibold tabular-nums ${
                  card.rank === 1
                    ? 'text-xl text-gray-950 dark:text-zinc-50'
                    : 'text-sm text-gray-900 dark:text-zinc-100'
                }`}
              >
                {card.row.wins}–{card.row.losses}
                {card.rank === 1 ? null : (
                  <span className="font-bold"> ({formatWinPct(card.row.winPct)})</span>
                )}
              </p>
              {card.rank === 1 ? (
                <p className="text-sm text-gray-600 dark:text-zinc-300">
                  {formatWinPct(card.row.winPct)} · Diff {formatDiff(card.row.pointDifferential)}
                </p>
              ) : (
                <p className="text-xs text-gray-600 dark:text-zinc-300">
                  Diff {formatDiff(card.row.pointDifferential)}
                </p>
              )}
            </article>
          ))}
        </div>
      </section>
    );
  }

  const toneClasses =
    summary.phase === 'complete'
      ? 'border-emerald-300/80 from-emerald-100/80 dark:border-emerald-900/70 dark:from-emerald-950/30'
      : 'border-blue-300 dark:border-blue-900/70 from-blue-200/95 dark:from-blue-950/45';

  return (
    <section
      className={`rounded-xl border bg-gradient-to-r via-white to-white px-4 py-5 shadow-sm dark:via-zinc-900 dark:to-zinc-900 sm:px-7 sm:py-6 ${toneClasses}`}
    >
      <p className="text-xs font-semibold uppercase tracking-widest text-gray-600 dark:text-zinc-300">
        League summary
      </p>
      <p className="mt-1.5 text-xl font-bold tracking-tight text-gray-950 dark:text-zinc-50 sm:text-2xl">
        {summary.headline}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-gray-700 dark:text-zinc-200">
        <span className="rounded-full border border-gray-300 bg-white/85 px-2 py-0.5 font-semibold text-gray-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100">
          {leader.wins}–{leader.losses}
        </span>
        <span className="font-bold">Win% {formatWinPct(leader.winPct)}</span>
        <span className="text-gray-500 dark:text-zinc-400">•</span>
        <span className="font-medium">{summary.metricSignal}</span>
      </div>
      {narrative ? (
        <p className="mt-2 text-sm text-gray-600 dark:text-zinc-300">{narrative}</p>
      ) : null}
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
  leaderLabel = 'Leader',
}: {
  rows: OwnerStandingsRow[];
  onOwnerSelect?: (owner: string) => void;
  previousRows?: OwnerStandingsRow[] | null;
  liveCountByOwner?: Map<string, number>;
  leaderLabel?: string;
}): React.ReactElement {
  const previousRankLookup = new Map(
    (previousRows ?? []).map((row, index) => [row.owner, index + 1] as const)
  );
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <div className="min-w-full text-sm sm:text-[0.92rem]">
        <div className="grid grid-cols-[2.2rem_minmax(0,1fr)] items-center gap-x-2 border-b border-gray-200 px-2 py-1.5 text-xs uppercase tracking-wider text-gray-500 dark:border-zinc-700 dark:text-zinc-500">
          <span className="font-semibold">Rank</span>
          <span className="font-semibold">Owner · Record · Metrics</span>
        </div>

        {rows.map((row, index) => {
          const isTopThree = index < 3;
          const liveCount = liveCountByOwner?.get(row.owner) ?? 0;
          return (
            <div
              key={row.owner}
              className={`grid grid-cols-[2.2rem_minmax(0,1fr)] items-center gap-x-2 border-b border-gray-100 px-2 py-2.5 dark:border-zinc-800 ${
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
                      className={`ml-1 text-xs font-semibold ${
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
                    <span className="rounded-full border border-blue-300 bg-blue-100 px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-blue-800 dark:border-blue-800 dark:bg-blue-900/40 dark:text-blue-200">
                      {leaderLabel}
                    </span>
                  ) : null}
                  <span className="text-sm font-semibold tabular-nums text-gray-900 dark:text-zinc-100">
                    {row.wins}–{row.losses}
                  </span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-500 dark:text-zinc-400">
                  <span>Win% {formatWinPct(row.winPct)}</span>
                  <span className="text-gray-400 dark:text-zinc-500">
                    Diff {formatDiff(row.pointDifferential)}
                  </span>
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
                className={`rounded-full border px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${stateBadgeClasses(state)}`}
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
  prioritizedItems,
  emptyMessage,
  timeZone,
  rankingsByTeamId,
  density = 'compact',
}: {
  prioritizedItems: PrioritizedOverviewItem[];
  emptyMessage: string;
  timeZone: string;
  rankingsByTeamId: Map<string, TeamRankingEnrichment>;
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
            className={`rounded-lg border ${
              prioritized.hasPriorityHighlight
                ? 'border-blue-300/80 bg-blue-50/40 dark:border-blue-900/70 dark:bg-blue-950/15'
                : 'border-gray-200 bg-white/80 dark:border-zinc-800 dark:bg-zinc-950/70'
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
                  <p className="text-xs font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300">
                    {prioritized.highlightLabel}
                  </p>
                ) : null}
                <div className="mt-0.5 flex items-center gap-2 text-xs text-gray-500 dark:text-zinc-400">
                  <span
                    className={`inline-flex rounded-full border px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${stateBadgeClasses(state)}`}
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

function insightHref(target?: Insight['navigationTarget']): string | null {
  if (!target) return null;
  if (target === 'standings') return '/standings';
  if (target === 'trends') return '/standings?view=trends#trends';
  if (target === 'matchup') return '/?view=matchups';
  return null;
}

function HighlightList({
  insights,
  scopeDetail,
}: {
  insights: Insight[];
  scopeDetail?: string | null;
}): React.ReactElement | null {
  if (insights.length === 0) return null;

  return (
    <div>
      {scopeDetail ? (
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-zinc-400">
          {scopeDetail}
        </p>
      ) : null}
      {insights.map((insight) => {
        const href = insightHref(insight.navigationTarget);
        return (
          <article
            key={insight.id}
            className="border-b border-gray-100 py-2 last:border-b-0 dark:border-zinc-800"
          >
            {href ? (
              <Link
                href={href}
                className="text-sm font-semibold text-gray-900 underline-offset-2 hover:underline dark:text-zinc-100"
              >
                {insight.title}
              </Link>
            ) : (
              <p className="text-sm font-semibold text-gray-900 dark:text-zinc-100">
                {insight.title}
              </p>
            )}
            <p className="mt-0.5 text-sm text-gray-600 dark:text-zinc-300">{insight.description}</p>
          </article>
        );
      })}
    </div>
  );
}

function LeagueStorylines({
  items,
}: {
  items: ReturnType<typeof selectOverviewViewModel>['storylines'];
}): React.ReactElement | null {
  if (items.length === 0) return null;

  return (
    <SectionCard title="Storylines" tone="secondary" compact>
      <ul className="space-y-2 text-sm text-gray-800 dark:text-zinc-100">
        {items.slice(0, 3).map((item) => (
          <li key={item.id} className="list-inside list-disc leading-snug">
            {item.text}
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

function GamesBackTrend({
  series,
}: {
  series: ReturnType<typeof selectOverviewViewModel>['gamesBackTrend'];
}): React.ReactElement {
  if (series.length === 0) {
    return (
      <p className="text-xs text-gray-500 dark:text-zinc-400">
        Games Back trend will appear after standings history is available.
      </p>
    );
  }

  const trendRows = series
    .map((entry) => ({ ...entry, latest: entry.points[entry.points.length - 1]?.value ?? 0 }))
    .sort((left, right) => {
      if (left.latest !== right.latest) return left.latest - right.latest;
      return left.ownerName.localeCompare(right.ownerName);
    })
    .slice(0, 5);

  return (
    <div className="space-y-2">
      {trendRows.map((entry) => {
        const values = entry.points.map((point) => point.value);
        const min = Math.min(...values);
        const max = Math.max(...values);
        const spread = Math.max(1, max - min);
        const width = 116;
        const height = 24;
        const coordinates = entry.points
          .map((point, index) => {
            const x =
              entry.points.length > 1 ? (index / (entry.points.length - 1)) * width : width / 2;
            const normalized = (point.value - min) / spread;
            const y = height - normalized * height;
            return `${x},${y}`;
          })
          .join(' ');

        return (
          <div
            key={entry.ownerId}
            className="flex items-center justify-between gap-3 rounded-md border border-gray-200 bg-white px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-900"
          >
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-gray-800 dark:text-zinc-100">
                {entry.ownerName}
              </p>
              <p className="text-xs text-gray-500 dark:text-zinc-400">
                Latest: {entry.latest.toFixed(1)} GB
              </p>
            </div>
            <svg
              viewBox={`0 0 ${width} ${height}`}
              className="h-6 w-28 shrink-0 text-blue-600 dark:text-blue-300"
              role="img"
              aria-label={`${entry.ownerName} games back trend`}
            >
              <polyline
                points={coordinates}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        );
      })}
    </div>
  );
}

function WinPctTrend({
  series,
}: {
  series: ReturnType<typeof selectOverviewViewModel>['winPctTrend'];
}): React.ReactElement {
  if (series.length === 0) {
    return (
      <p className="text-xs text-gray-500 dark:text-zinc-400">
        Win % trend will appear after standings history is available.
      </p>
    );
  }

  const trendRows = series
    .map((entry) => ({ ...entry, latest: entry.points[entry.points.length - 1]?.value ?? 0 }))
    .slice(0, 5);

  return (
    <div className="space-y-2">
      {trendRows.map((entry) => {
        const values = entry.points.map((point) => point.value);
        const min = Math.min(...values);
        const max = Math.max(...values);
        const spread = Math.max(0.0001, max - min);
        const width = 116;
        const height = 24;
        const coordinates = entry.points
          .map((point, index) => {
            const x =
              entry.points.length > 1 ? (index / (entry.points.length - 1)) * width : width / 2;
            const normalized = (point.value - min) / spread;
            const y = height - normalized * height;
            return `${x},${y}`;
          })
          .join(' ');

        return (
          <div
            key={entry.ownerId}
            className="flex items-center justify-between gap-3 rounded-md border border-gray-200 bg-white px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-900"
          >
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-gray-800 dark:text-zinc-100">
                {entry.ownerName}
              </p>
              <p className="text-xs text-gray-500 dark:text-zinc-400">
                Latest: {formatWinPctPercent(entry.latest)}
              </p>
            </div>
            <svg
              viewBox={`0 0 ${width} ${height}`}
              className="h-6 w-28 shrink-0 text-emerald-600 dark:text-emerald-300"
              role="img"
              aria-label={`${entry.ownerName} win percentage trend`}
            >
              <polyline
                points={coordinates}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        );
      })}
    </div>
  );
}

function WinBars({
  rows,
  variant = 'full',
}: {
  rows: ReturnType<typeof selectOverviewViewModel>['winBars'];
  variant?: 'compact' | 'full';
}): React.ReactElement {
  if (rows.length === 0) {
    return (
      <p className="text-xs text-gray-500 dark:text-zinc-400">
        Win bars will appear after standings history is available.
      </p>
    );
  }

  const visibleRows = rows.slice(0, 5);
  const maxWinPct = Math.max(0.001, ...visibleRows.map((row) => row.winPct));

  return (
    <div className="space-y-2">
      {visibleRows.map((row) => {
        const widthPct = Math.max(8, (row.winPct / maxWinPct) * 100);
        return (
          <div
            key={row.ownerId}
            className={
              variant === 'compact'
                ? 'py-1'
                : 'rounded-md border border-gray-200 bg-white px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-900'
            }
          >
            <div className="mb-1 flex items-center justify-between gap-2">
              <p className="truncate text-xs font-semibold text-gray-800 dark:text-zinc-100">
                {row.ownerName}
              </p>
              <p className="text-xs text-gray-500 dark:text-zinc-400">
                {row.wins}W · {formatWinPctPercent(row.winPct)}
              </p>
            </div>
            <div className="h-2 w-full rounded-full bg-gray-100 dark:bg-zinc-800">
              <div
                className="h-full rounded-full bg-gray-700 dark:bg-zinc-400"
                style={{ width: `${widthPct}%` }}
              />
            </div>
          </div>
        );
      })}
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
  onViewStandings?: () => void;
  onViewSchedule?: () => void;
  onViewMatchups?: () => void;
  onOpenHighlightTarget?: (target: HighlightDrilldownTarget) => void;
  rankingsByTeamId?: Map<string, TeamRankingEnrichment>;
  standingsHistory?: StandingsHistory | null;
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
  onViewStandings,
  onViewSchedule,
  onViewMatchups,
  rankingsByTeamId = new Map(),
  standingsHistory = null,
}: OverviewPanelProps): React.ReactElement {
  const timeZone = displayTimeZone ?? getPresentationTimeZone();
  const liveTitle = `Live · ${liveItems.length}`;
  const liveCountByOwner = React.useMemo(() => {
    const standings = new Map<string, number>();
    for (const game of games) {
      const score = scoresByKey[game.key];
      if (gameStateFromScore(score) !== 'inprogress') continue;
      const awayOwner = rosterByTeam.get(game.csvAway);
      const homeOwner = rosterByTeam.get(game.csvHome);
      if (awayOwner) standings.set(awayOwner, (standings.get(awayOwner) ?? 0) + 1);
      if (homeOwner) standings.set(homeOwner, (standings.get(homeOwner) ?? 0) + 1);
    }
    return standings;
  }, [games, scoresByKey, rosterByTeam]);
  const viewModel = React.useMemo(
    () =>
      selectOverviewViewModel({
        standingsLeaders,
        standingsHistory,
        standingsCoverage,
        context,
        liveItems,
        keyMatchups,
        matchupMatrix,
        rankingsByTeamId,
      }),
    [
      standingsLeaders,
      standingsHistory,
      standingsCoverage,
      context,
      liveItems,
      keyMatchups,
      matchupMatrix,
      rankingsByTeamId,
    ]
  );
  const sharedInsights = React.useMemo(() => {
    const resolvedWeeks = standingsHistory
      ? selectResolvedStandingsWeeks(standingsHistory).resolvedWeeks
      : [];
    const latestResolvedWeek = resolvedWeeks[resolvedWeeks.length - 1] ?? null;
    const currentStandings =
      latestResolvedWeek != null
        ? (standingsHistory?.byWeek[latestResolvedWeek]?.standings ?? standingsLeaders)
        : standingsLeaders;
    const seasonContext = selectSeasonContext({ standingsHistory });

    return deriveOverviewInsights(
      deriveLeagueInsights({
        rows: currentStandings,
        standingsHistory,
        seasonContext,
      })
    );
  }, [standingsHistory, standingsLeaders]);

  return (
    <div className="space-y-4">
      <LeagueSummaryHero
        summary={viewModel.championSummary}
        narrative={viewModel.heroNarrative}
        heroMode={viewModel.heroMode}
        podiumLeaders={viewModel.podiumLeaders}
        leader={standingsLeaders[0]}
      />

      {viewModel.heroMode === 'podium' && viewModel.heroNarrative ? (
        <div className="rounded-xl border border-gray-200 bg-gray-50/80 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/60">
          <p className="text-sm font-medium leading-relaxed text-gray-700 dark:text-zinc-200">
            {viewModel.heroNarrative}
          </p>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Standings (Top 5)" headingClassName="text-lg sm:text-xl" compact>
          {viewModel.standingsContext ? (
            <p className="mb-2 text-xs font-medium text-gray-600 dark:text-zinc-300">
              {viewModel.standingsContext}
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
          {viewModel.standingsTopN.length === 0 ? (
            <EmptyState message="Upload surnames to populate league standings." compact />
          ) : (
            <CondensedStandingsTable
              rows={viewModel.standingsTopN}
              onOwnerSelect={onOwnerSelect}
              previousRows={viewModel.previousStandingsLeaders}
              liveCountByOwner={liveCountByOwner}
              leaderLabel={viewModel.heroMode === 'podium' ? 'Champion' : 'Leader'}
            />
          )}
          <button
            type="button"
            className="mt-2 inline-flex rounded-md border border-blue-300 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-800 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-200 dark:hover:bg-blue-950/60"
            onClick={onViewStandings}
          >
            View full standings
          </button>
        </SectionCard>

        <SectionCard title="Win % Leaders" tone="secondary" compact>
          <WinBars rows={viewModel.winBars} variant="compact" />
        </SectionCard>
      </div>

      {sharedInsights.length > 0 ? (
        <SectionCard title="Insights" tone="secondary" compact>
          <HighlightList insights={sharedInsights} scopeDetail={context.scopeDetail} />
        </SectionCard>
      ) : null}

      <LeagueStorylines items={viewModel.storylines} />

      <SectionCard
        title="Recent results"
        tone="secondary"
        compact
        action={
          <button
            type="button"
            className="text-xs font-semibold text-blue-700 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-200"
            onClick={onViewSchedule}
          >
            All results ↗
          </button>
        }
      >
        <GameSummaryList
          prioritizedItems={viewModel.recentResults}
          emptyMessage="No recent results yet—completed games will appear here."
          timeZone={timeZone}
          rankingsByTeamId={rankingsByTeamId}
        />
      </SectionCard>

      {viewModel.shouldShowFeaturedMatchups ? (
        <SectionCard
          title="Upcoming watchlist"
          tone="weekly"
          compact
          action={
            <button
              type="button"
              className="text-xs font-semibold text-blue-700 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-200"
              onClick={onViewMatchups}
            >
              All matchups ↗
            </button>
          }
        >
          <GameSummaryList
            prioritizedItems={viewModel.featuredMatchups}
            emptyMessage="No featured matchups yet for this slate."
            timeZone={timeZone}
            rankingsByTeamId={rankingsByTeamId}
            density="featured"
          />
        </SectionCard>
      ) : null}

      {liveItems.length > 0 ? (
        <SectionCard title={liveTitle} tone="live" compact>
          <GameCardList items={liveItems} timeZone={timeZone} rankingsByTeamId={rankingsByTeamId} />
        </SectionCard>
      ) : null}

      <SectionCard
        title="Trends"
        tone="secondary"
        compact
        action={
          <Link
            href="/standings?view=trends#trends"
            className="text-xs font-semibold text-blue-700 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-200"
          >
            See full trends ↗
          </Link>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-zinc-400">
              Games Back
            </p>
            <GamesBackTrend series={viewModel.gamesBackTrend} />
          </div>
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-zinc-400">
              Win %
            </p>
            <WinPctTrend series={viewModel.winPctTrend} />
          </div>
        </div>
      </SectionCard>
    </div>
  );
}

import React from 'react';

import { formatGameMatchupLabel, gameStateFromScore } from '../lib/gameUi';
import type { HighlightDrilldownTarget } from '../lib/highlightDrilldown';
import { selectOverviewViewModel, type PrioritizedOverviewItem } from '../lib/selectors/overview';
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

  if (!summary) return <></>;

  if (heroMode === 'podium' && podiumLeaders.length === 3) {
    const [first, second, third] = podiumLeaders;
    const cards: Array<{ rank: 1 | 2 | 3; row: OwnerStandingsRow; className: string }> = [
      {
        rank: 1,
        row: first,
        className:
          'border-amber-300/90 bg-gradient-to-b from-amber-100/85 to-white ring-1 ring-amber-300/60 dark:border-amber-700 dark:from-amber-900/40 dark:to-zinc-900 dark:ring-amber-700/60',
      },
      {
        rank: 2,
        row: second,
        className:
          'border-slate-300/90 bg-gradient-to-b from-slate-100/85 to-white dark:border-slate-700 dark:from-slate-900/70 dark:to-zinc-900',
      },
      {
        rank: 3,
        row: third,
        className:
          'border-orange-300/80 bg-gradient-to-b from-orange-100/70 to-white dark:border-orange-800 dark:from-orange-950/30 dark:to-zinc-900',
      },
    ];

    return (
      <section className="rounded-2xl border border-amber-200/80 bg-gradient-to-r from-amber-50/85 via-white to-white px-4 py-5 shadow-sm dark:border-amber-900/50 dark:from-amber-950/20 dark:via-zinc-900 dark:to-zinc-900 sm:px-7 sm:py-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-600 dark:text-zinc-300">
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
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-600 dark:text-zinc-300">
                #{card.rank}
              </p>
              <p
                className={`mt-1 text-base ${
                  card.rank === 1 ? 'font-extrabold' : 'font-bold'
                } text-gray-950 dark:text-zinc-50`}
              >
                {card.row.owner}
              </p>
              <p className="mt-1 text-sm font-semibold text-gray-900 dark:text-zinc-100">
                {card.row.wins}–{card.row.losses}{' '}
                <span className="font-bold">({formatWinPct(card.row.winPct)})</span>
              </p>
              <p className="text-xs text-gray-600 dark:text-zinc-300">
                Diff {formatDiff(card.row.pointDifferential)}
              </p>
            </article>
          ))}
        </div>
        {narrative ? (
          <p className="mt-2.5 text-sm text-gray-600 dark:text-zinc-300">{narrative}</p>
        ) : null}
      </section>
    );
  }

  const toneClasses =
    summary.phase === 'complete'
      ? 'border-emerald-300/80 from-emerald-100/80 dark:border-emerald-900/70 dark:from-emerald-950/30'
      : 'border-blue-300 dark:border-blue-900/70 from-blue-200/95 dark:from-blue-950/45';

  return (
    <section
      className={`rounded-2xl border bg-gradient-to-r via-white to-white px-4 py-5 shadow-sm dark:via-zinc-900 dark:to-zinc-900 sm:px-7 sm:py-6 ${toneClasses}`}
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

function HighlightList({
  highlights,
  scopeDetail,
  onOpenHighlightTarget,
}: {
  highlights: ReturnType<typeof selectOverviewViewModel>['leagueHighlights'];
  scopeDetail?: string | null;
  onOpenHighlightTarget?: (target: HighlightDrilldownTarget) => void;
}): React.ReactElement {
  const iconByType: Record<(typeof highlights)[number]['type'], string> = {
    biggest_blowout: '🔥',
    closest_finish: '😬',
    top_ranked_matchup: '🏆',
    biggest_gain: '📈',
    most_games_owner: '🧠',
    split_owner_matchup: '🤝',
    heavy_owner_collision: '⚔️',
  };

  if (highlights.length === 0) {
    return (
      <EmptyState
        message="Highlights will appear once this slate has meaningful outcomes or matchup signals."
        compact
      />
    );
  }

  return (
    <div className="space-y-2.5">
      {scopeDetail ? (
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-gray-500 dark:text-zinc-400">
          {scopeDetail}
        </p>
      ) : null}
      {highlights.map((highlight) => (
        <div
          key={highlight.id}
          className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white/80 px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-950/70"
        >
          <p className="min-w-0 text-sm text-gray-800 dark:text-zinc-100">
            <span className="mr-1.5" aria-hidden="true">
              {iconByType[highlight.type]}
            </span>
            <span className="mr-1.5 inline-flex rounded-full border border-gray-300 bg-gray-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
              {highlight.label}
            </span>
            {highlight.text}
          </p>
          <button
            type="button"
            className="shrink-0 rounded-md border border-blue-300 bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-800 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-200 dark:hover:bg-blue-950/60"
            onClick={() => onOpenHighlightTarget?.(highlight.drilldownTarget)}
          >
            {highlight.ctaLabel}
          </button>
        </div>
      ))}
    </div>
  );
}

function LeaguePulse({
  items,
}: {
  items: ReturnType<typeof selectOverviewViewModel>['leaguePulse'];
}): React.ReactElement | null {
  if (items.length === 0) return null;
  const rowSpacingClass = items.length <= 2 ? 'space-y-2' : 'space-y-2.5';

  const derivePulsePresentation = (
    item: (typeof items)[number]
  ): {
    icon: string;
    label: string;
    text: string;
  } => {
    const id = item.id.toLowerCase();

    if (id === 'season-complete') {
      return {
        icon: '🏁',
        label: 'Season',
        text: item.text.replace(/^Season complete:\s*/i, ''),
      };
    }

    if (id.startsWith('leader-gap')) {
      return {
        icon: '🏆',
        label: 'Leader',
        text: item.text,
      };
    }

    if (id.startsWith('biggest-gain')) {
      return {
        icon: '📈',
        label: 'Biggest Gain',
        text: item.text,
      };
    }

    if (id.startsWith('biggest-drop')) {
      return {
        icon: '📉',
        label: 'Biggest Drop',
        text: item.text,
      };
    }

    if (id.startsWith('standings-context')) {
      return {
        icon: '📊',
        label: 'Standings',
        text: item.text.replace(/^Closest race:\s*/i, ''),
      };
    }

    if (id.includes('most-games') || /most games/i.test(item.text)) {
      return {
        icon: '🧠',
        label: 'Most Games',
        text: item.text.replace(/^Most games(?: this week)?:\s*/i, ''),
      };
    }

    if (id.startsWith('rank-movement')) {
      return {
        icon: '🔄',
        label: 'Rank Move',
        text: item.text,
      };
    }

    return {
      icon: '📌',
      label: 'Pulse',
      text: item.text,
    };
  };

  return (
    <SectionCard title="League pulse" tone="secondary" compact>
      <div className={rowSpacingClass}>
        {items.map((item) => {
          const presentation = derivePulsePresentation(item);
          return (
            <article
              key={item.id}
              className="rounded-lg border border-gray-200 bg-white/80 px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-950/70"
            >
              <p className="min-w-0 text-sm text-gray-800 dark:text-zinc-100">
                <span
                  className="mr-1.5 inline-block align-middle text-[15px] leading-none"
                  aria-hidden="true"
                >
                  {presentation.icon}
                </span>
                <span className="mr-1.5 inline-flex rounded-full border border-gray-300 bg-gray-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                  {presentation.label}
                </span>
                {presentation.text}
              </p>
            </article>
          );
        })}
      </div>
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
              <p className="text-[11px] text-gray-500 dark:text-zinc-400">
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
  onOpenHighlightTarget,
  rankingsByTeamId = new Map(),
  standingsHistory = null,
}: OverviewPanelProps): React.ReactElement {
  const timeZone = displayTimeZone ?? getPresentationTimeZone();
  const liveTitle = liveItems.length === 0 ? 'Live · none' : `Live · ${liveItems.length}`;
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

  return (
    <div className="space-y-4">
      <LeagueSummaryHero
        summary={viewModel.championSummary}
        narrative={viewModel.heroNarrative}
        heroMode={viewModel.heroMode}
        podiumLeaders={viewModel.podiumLeaders}
        leader={standingsLeaders[0]}
      />
      {viewModel.shouldShowLeaguePulse ? <LeaguePulse items={viewModel.leaguePulse} /> : null}
      <SectionCard title="League Trends" tone="secondary" compact>
        <GamesBackTrend series={viewModel.gamesBackTrend} />
      </SectionCard>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        <SectionCard title="League standings (Top 5)" headingClassName="text-lg sm:text-xl" compact>
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

        <div className="space-y-4">
          <SectionCard title="League highlights" tone="secondary" compact>
            <HighlightList
              highlights={viewModel.leagueHighlights}
              scopeDetail={context.scopeDetail}
              onOpenHighlightTarget={onOpenHighlightTarget}
            />
          </SectionCard>

          <SectionCard title="Recent results" tone="secondary" compact>
            <GameSummaryList
              prioritizedItems={viewModel.recentResults}
              emptyMessage="No recent results yet—completed games will appear here."
              timeZone={timeZone}
              rankingsByTeamId={rankingsByTeamId}
            />
            <button
              type="button"
              className="mt-2 inline-flex rounded-md border border-blue-300 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-800 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-200 dark:hover:bg-blue-950/60"
              onClick={onViewSchedule}
            >
              View all results
            </button>
          </SectionCard>

          {viewModel.shouldShowFeaturedMatchups ? (
            <SectionCard title="Upcoming watchlist" tone="weekly" compact>
              <GameSummaryList
                prioritizedItems={viewModel.featuredMatchups}
                emptyMessage="No featured matchups yet for this slate."
                timeZone={timeZone}
                rankingsByTeamId={rankingsByTeamId}
                density="featured"
              />
              <button
                type="button"
                className="mt-2 inline-flex rounded-md border border-blue-300 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-800 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-200 dark:hover:bg-blue-950/60"
                onClick={onViewMatchups}
              >
                View weekly matchups
              </button>
            </SectionCard>
          ) : null}

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
    </div>
  );
}

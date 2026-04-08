import React from 'react';
import Link from 'next/link';

import MiniTrendsGrid from './MiniTrendsGrid';
import { buildOwnerColorMap } from '../lib/ownerColors';
import { selectGamesBackTrend, selectPositionDeltas } from '../lib/selectors/trends';
import { buildWeekLabelMap, formatWeekLabel } from '../lib/weekLabel';
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
import { getTeamRanking, type TeamRankingEnrichment, type RankingsResponse, type RankingsWeek, type CanonicalPollEntry, type RankSource } from '../lib/rankings';
import { getGameParticipantTeamId, type AppGame } from '../lib/schedule';
import type { ScorePack } from '../lib/scores';
import type { OwnerStandingsRow, StandingsCoverage } from '../lib/standings';
import type { StandingsHistory } from '../lib/standingsHistory';
import { getPresentationTimeZone } from '../lib/weekPresentation';
import RankedTeamName from './RankedTeamName';

function sliceStandingsHistoryToRecentWeeks(
  history: StandingsHistory,
  n: number
): StandingsHistory {
  const recentWeeks = history.weeks.slice(-n);
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
      <RankedTeamName teamName={game.csvAway} ranking={getTeamRanking(rankingsByTeamId, awayTeamId)} />
      {separator}
      <RankedTeamName teamName={game.csvHome} ranking={getTeamRanking(rankingsByTeamId, homeTeamId)} />
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

function deriveFeaturedGameBadge(
  game: AppGame
): { label: string; classes: string } | null {
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
}: {
  standingsHistory: StandingsHistory;
  standingsLeaders: OwnerStandingsRow[];
  weekLabel?: (week: number) => string;
}): React.ReactElement | null {
  const data = React.useMemo((): GbChangeData | null => {
    const allSeries = selectGamesBackTrend({ standingsHistory });
    const weeks = standingsHistory.weeks;
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

  const ownerColorMap = React.useMemo(
    () => (data ? buildOwnerColorMap(data.rows.map((r) => r.ownerName)) : new Map<string, string>()),
    [data]
  );

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
        const nameColor = ownerColorMap.get(row.ownerName) ?? '#888';
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
          : 'border-gray-200/60 bg-white dark:border-zinc-800/60 dark:bg-zinc-900'
      }`}
    >
      <p
        className={`text-[10px] font-semibold uppercase tracking-wider ${
          isChampion
            ? 'text-amber-700 dark:text-amber-400'
            : 'text-gray-400 dark:text-zinc-500'
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
      <section className="rounded-xl border border-gray-200 bg-gray-50/90 px-4 py-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/60 sm:px-6">
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
  const top3 = heroMode === 'podium' && podiumLeaders.length === 3
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
  liveCountByOwner,
  deltaWeeks,
  deltasByOwner,
  weekLabel,
}: {
  rows: OwnerStandingsRow[];
  onOwnerSelect?: (owner: string) => void;
  previousRows?: OwnerStandingsRow[] | null;
  liveCountByOwner?: Map<string, number>;
  deltaWeeks?: number[];
  deltasByOwner?: Map<string, Map<number, number | null>>;
  weekLabel?: (week: number) => string;
}): React.ReactElement {
  const previousRankLookup = new Map(
    (previousRows ?? []).map((row, index) => [row.owner, index + 1] as const)
  );
  const hasDeltaCols = deltaWeeks && deltaWeeks.length > 0 && deltasByOwner;
  const labelFn = weekLabel ?? ((w: number) => `W${w}`);
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <div className="min-w-full text-sm">
        {/* Week header row for delta columns */}
        {hasDeltaCols ? (
          <div className="flex items-center border-b border-gray-100 px-2 py-1 dark:border-zinc-800">
            <span className="flex-1" />
            {deltaWeeks.map((w) => (
              <span
                key={w}
                className="w-7 shrink-0 text-center text-[9px] font-medium text-gray-400 dark:text-zinc-500"
              >
                {labelFn(w)}
              </span>
            ))}
          </div>
        ) : null}
        {rows.map((row, index) => {
          const liveCount = liveCountByOwner?.get(row.owner) ?? 0;
          const ownerDeltas = hasDeltaCols ? deltasByOwner.get(row.owner) : null;
          return (
            <div
              key={row.owner}
              className="border-b border-gray-100 px-2 py-2 dark:border-zinc-800"
            >
              {/* Primary line: rank · name · record · GB · deltas */}
              <div className="flex items-center gap-x-1.5">
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-0.5">
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
                  <span className="text-xs tabular-nums text-gray-400 dark:text-zinc-500">
                    {index === 0 ? formatGb(row.gamesBack) : `${formatGb(row.gamesBack)} GB`}
                  </span>
                  {liveCount > 0 ? (
                    <span className="rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                      {liveCount} live
                    </span>
                  ) : null}
                </div>
                {/* Inline delta values */}
                {hasDeltaCols && ownerDeltas ? (
                  deltaWeeks.map((w) => {
                    const d = ownerDeltas.get(w) ?? null;
                    return (
                      <span
                        key={w}
                        className={`w-7 shrink-0 text-center text-[11px] font-medium tabular-nums ${deltaTextColor(d)}`}
                      >
                        {deltaLabel(d)}
                      </span>
                    );
                  })
                ) : null}
              </div>
              {/* Secondary line: Win% · Diff */}
              <div className="mt-0.5 flex items-center gap-x-2 text-xs text-gray-400 dark:text-zinc-500">
                <span>Win% {formatWinPct(row.winPct)}</span>
                <span>Diff {formatDiff(row.pointDifferential)}</span>
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

  const NO_CLAIM = 'NoClaim';

  return (
    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
      {prioritizedItems.map((prioritized) => {
        const item = prioritized.item;
        const game = item.bucket.game;
        const score = item.score;
        const state = gameStateFromScore(score);
        const kickoff = formatKickoff(game.date, timeZone);
        const gameBadge = deriveFeaturedGameBadge(game);
        const awayScore = score?.away.score ?? null;
        const homeScore = score?.home.score ?? null;
        const awayWon = state === 'final' && awayScore !== null && homeScore !== null && awayScore > homeScore;
        const homeWon = state === 'final' && awayScore !== null && homeScore !== null && homeScore > awayScore;

        // Strip NoClaim from owner display lines
        const awayOwner = item.bucket.awayOwner === NO_CLAIM ? null : item.bucket.awayOwner;
        const homeOwner = item.bucket.homeOwner === NO_CLAIM ? null : item.bucket.homeOwner;
        const ownerLine =
          awayOwner && homeOwner
            ? `${awayOwner} vs ${homeOwner}`
            : awayOwner
              ? `${awayOwner}'s game`
              : homeOwner
                ? `${homeOwner}'s game`
                : null;

        return (
          <article
            key={game.key}
            className="rounded-lg bg-gray-100/60 p-2.5 sm:p-3 dark:bg-zinc-800/40"
          >
            <div className="flex items-start gap-2">
              <p className="min-w-0 flex-1 text-sm font-semibold leading-snug text-gray-950 dark:text-zinc-50">
                {renderMatchupLabel(item, rankingsByTeamId)}
              </p>
              {gameBadge ? (
                <span
                  className={`mt-0.5 shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${gameBadge.classes}`}
                >
                  {gameBadge.label}
                </span>
              ) : null}
            </div>
            {ownerLine ? (
              <p className="mt-0.5 text-xs text-gray-600 dark:text-zinc-400">{ownerLine}</p>
            ) : null}
            <div className="mt-1.5 flex items-center gap-1.5 text-xs">
              <span
                className={`rounded-full border px-1.5 py-0.5 font-semibold uppercase tracking-wide ${stateBadgeClasses(state)}`}
              >
                {state === 'final' ? 'Final' : (score?.status ?? 'Scheduled')}
              </span>
              <span aria-hidden="true" className="text-gray-400 dark:text-zinc-500">
                •
              </span>
              <span className="text-gray-500 dark:text-zinc-400">{kickoff}</span>
            </div>
            {awayScore !== null || homeScore !== null ? (
              <div className="mt-1.5 space-y-0.5 rounded-md bg-white/60 px-2 py-1.5 dark:bg-zinc-900/60">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className={`min-w-0 truncate ${awayWon ? 'font-medium text-gray-800 dark:text-zinc-100' : 'text-gray-400 dark:text-zinc-500'}`}>
                    {game.csvAway}
                  </span>
                  <span className={`tabular-nums ${awayWon ? 'font-medium text-gray-900 dark:text-zinc-50' : 'font-normal text-gray-400 dark:text-zinc-500'}`}>
                    {awayScore}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className={`min-w-0 truncate ${homeWon ? 'font-medium text-gray-800 dark:text-zinc-100' : 'text-gray-400 dark:text-zinc-500'}`}>
                    {game.csvHome}
                  </span>
                  <span className={`tabular-nums ${homeWon ? 'font-medium text-gray-900 dark:text-zinc-50' : 'font-normal text-gray-400 dark:text-zinc-500'}`}>
                    {homeScore}
                  </span>
                </div>
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

function insightHref(
  target: Insight['navigationTarget'] | undefined,
  leagueSlug?: string
): string | null {
  if (!target) return null;
  const base = leagueSlug ? `/league/${leagueSlug}` : '';
  if (target === 'standings') return `${base}/standings`;
  if (target === 'trends') return `${base}/standings?view=trends#trends`;
  if (target === 'matchup') return `${base}/matchups`;
  return null;
}

function HighlightList({
  insights,
  leagueSlug,
}: {
  insights: Insight[];
  leagueSlug?: string;
}): React.ReactElement | null {
  if (insights.length === 0) return null;

  return (
    <div>
      {insights.map((insight) => {
        const href = insightHref(insight.navigationTarget, leagueSlug);
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
  // Find the previous week for delta computation
  const latestIdx = weeks.indexOf(latestWeek);
  const previousWeek = latestIdx > 0 ? weeks[latestIdx - 1] : null;
  const previousEntries = previousWeek?.polls[currentEntries[0]?.rankSource ?? 'ap'] ?? [];
  const prevByTeam = new Map(previousEntries.map((e) => [e.teamId, e.rank]));

  const top10 = currentEntries.slice(0, 10);

  return {
    pollName,
    entries: top10.map((entry) => {
      const prevRank = prevByTeam.get(entry.teamId);
      const delta: number | 'new' | null =
        prevRank == null ? 'new' : prevRank === entry.rank ? null : prevRank - entry.rank;
      return {
        rank: entry.rank,
        teamName: entry.teamName,
        teamId: entry.teamId,
        delta,
      };
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
    return (
      <span className="w-7 text-right text-[11px] text-gray-400 dark:text-zinc-500">
        —
      </span>
    );
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
  ctaClasses,
}: {
  snapshot: PollSnapshot | null;
  rankingsHref: string;
  ctaClasses: string;
}): React.ReactElement {
  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[15px] font-medium text-gray-950 dark:text-zinc-50">
          {snapshot?.pollName ?? 'FBS Poll'}
        </p>
        <Link href={rankingsHref} className={ctaClasses}>
          Full rankings ↗
        </Link>
      </div>
      {!snapshot || snapshot.entries.length === 0 ? (
        <p className="py-2 text-sm text-gray-400 dark:text-zinc-500">Rankings unavailable</p>
      ) : (
        <div className="text-sm">
          {snapshot.entries.map((entry, idx) => (
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
  standingsLeaders: OwnerStandingsRow[];
  standingsCoverage: StandingsCoverage;
  matchupMatrix: OwnerMatchupMatrix;
  liveItems: OverviewGameItem[];
  keyMatchups: OverviewGameItem[];
  context: OverviewContext;
  displayTimeZone?: string;
  onOwnerSelect?: (owner: string) => void;
  onViewSchedule?: () => void;
  onViewMatchups?: () => void;
  onOpenHighlightTarget?: (target: HighlightDrilldownTarget) => void;
  rankingsByTeamId?: Map<string, TeamRankingEnrichment>;
  rankings?: RankingsResponse | null;
  standingsHistory?: StandingsHistory | null;
  leagueSlug?: string;
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
  onViewSchedule,
  onViewMatchups,
  rankingsByTeamId = new Map(),
  rankings = null,
  standingsHistory = null,
  leagueSlug,
}: OverviewPanelProps): React.ReactElement {
  const timeZone = displayTimeZone ?? getPresentationTimeZone();
  const weekLabelFn = React.useMemo(() => {
    const labelMap = buildWeekLabelMap(games);
    return (week: number) => formatWeekLabel(week, labelMap);
  }, [games]);
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

  const positionDeltaData = React.useMemo(() => {
    if (!standingsHistory) return null;
    const { weeks, owners } = selectPositionDeltas({ standingsHistory, maxWeeks: 5 });
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
  }, [standingsHistory]);

  const pollSnapshot = React.useMemo(() => {
    const phase = viewModel.championSummary?.phase ?? 'inSeason';
    return derivePollSnapshot(rankings, phase);
  }, [rankings, viewModel.championSummary]);

  const standingsHref = `${leagueSlug ? `/league/${leagueSlug}` : ''}/standings`;
  const rankingsHref = `${leagueSlug ? `/league/${leagueSlug}` : ''}/rankings`;
  const ctaClasses = 'text-xs font-medium text-gray-500 hover:text-gray-700 dark:text-zinc-400 dark:hover:text-zinc-200';

  return (
    <div className="space-y-5">
      {/* Podium / Hero */}
      <LeagueSummaryHero
        summary={viewModel.championSummary}
        heroMode={viewModel.heroMode}
        podiumLeaders={viewModel.podiumLeaders}
        standingsLeaders={standingsLeaders}
        leader={standingsLeaders[0]}
        leagueSlug={leagueSlug}
      />

      <SectionDivider />

      {/* Standings · FBS Polls · Insights */}
      <section>
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
          <EmptyState message="Add owners to populate standings." compact />
        ) : (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-[1fr_1fr_2fr] md:items-start">
            {/* Column 1: Standings table with inline deltas */}
            <div className="min-w-0">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-[15px] font-medium text-gray-950 dark:text-zinc-50">Standings</p>
                <Link href={standingsHref} className={ctaClasses}>
                  Full standings ↗
                </Link>
              </div>
              <CondensedStandingsTable
                rows={viewModel.standingsTopN}
                onOwnerSelect={onOwnerSelect}
                previousRows={viewModel.previousStandingsLeaders}
                liveCountByOwner={liveCountByOwner}
                deltaWeeks={positionDeltaData?.weeks}
                deltasByOwner={positionDeltaData?.byOwner}
                weekLabel={weekLabelFn}
              />
            </div>
            {/* Column 2: FBS Polls snapshot */}
            <PollSnapshotColumn
              snapshot={pollSnapshot}
              rankingsHref={rankingsHref}
              ctaClasses={ctaClasses}
            />
            {/* Column 3: Insights */}
            {sharedInsights.length > 0 ? (
              <div className="min-w-0">
                <p className="mb-2 text-[15px] font-medium text-gray-950 dark:text-zinc-50">Insights</p>
                <HighlightList
                  insights={sharedInsights}
                  leagueSlug={leagueSlug}
                />
              </div>
            ) : null}
          </div>
        )}
      </section>

      <SectionDivider />

      {/* Featured games */}
      <section>
        <SectionHeader
          title="Featured games"
          action={
            <button type="button" className={ctaClasses} onClick={onViewSchedule}>
              All results ↗
            </button>
          }
        />
        <div className="mt-2.5">
          <FeaturedGamesList
            prioritizedItems={viewModel.recentResults}
            emptyMessage="No recent results yet—completed games will appear here."
            timeZone={timeZone}
            rankingsByTeamId={rankingsByTeamId}
          />
        </div>
      </section>

      {/* Upcoming watchlist */}
      {viewModel.shouldShowFeaturedMatchups ? (
        <>
          <SectionDivider />
          <section>
            <SectionHeader
              title="Upcoming watchlist"
              action={
                <button type="button" className={ctaClasses} onClick={onViewMatchups}>
                  All matchups ↗
                </button>
              }
            />
            <div className="mt-2.5">
              <GameSummaryList
                prioritizedItems={viewModel.featuredMatchups}
                emptyMessage="No featured matchups yet for this slate."
                timeZone={timeZone}
                rankingsByTeamId={rankingsByTeamId}
                density="featured"
              />
            </div>
          </section>
        </>
      ) : null}

      {/* Live games — keeps card treatment */}
      {liveItems.length > 0 ? (
        <SectionCard title={liveTitle} tone="live" compact>
          <GameCardList items={liveItems} timeZone={timeZone} rankingsByTeamId={rankingsByTeamId} />
        </SectionCard>
      ) : null}

      {/* GB Race */}
      {standingsHistory ? (
        <>
          <SectionDivider />
          <section>
            <SectionHeader
              title="GB Race"
              action={
                <Link href={`${standingsHref}?view=trends#trends`} className={ctaClasses}>
                  Full standings ↗
                </Link>
              }
            />
            <div className="mt-2.5 flex flex-col gap-3 sm:flex-row">
              <div className="min-w-0 flex-1">
                <MiniTrendsGrid
                  standingsHistory={sliceStandingsHistoryToRecentWeeks(standingsHistory, 5)}
                  weekLabel={weekLabelFn}
                />
              </div>
              <div className="shrink-0">
                <GbChangeTable
                  standingsHistory={standingsHistory}
                  standingsLeaders={standingsLeaders}
                  weekLabel={weekLabelFn}
                />
              </div>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

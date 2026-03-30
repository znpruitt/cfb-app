import React from 'react';

import { classifyScorePackStatus } from '../lib/gameStatus';
import type { CombinedOdds } from '../lib/odds';
import { pillClass, usesNeutralSiteSemantics } from '../lib/gameUi';
import {
  computeGameTags,
  computeStandings,
  LEAGUE_TAG_LABELS,
  prioritizeGameTags,
} from '../lib/leagueInsights';
import {
  deriveOwnerWeekSlates,
  deriveWeekMatchupSections,
  type OwnerSlateGame,
  type OwnerWeekSlate,
  type WeekMatchupSections,
} from '../lib/matchups';
import {
  deriveExcludedGamesSummary,
  deriveMatchupsHeaderCopy,
  deriveOpponentDescriptor,
  deriveOwnerOutcome,
  formatSlateSummaryText,
  getDefaultVisibleOpponentsCount,
  summarizeSlateOpponents,
  type GameOutcomeTone,
} from '../lib/selectors/matchups';
import type { TeamRankingEnrichment } from '../lib/rankings';
import type { ScorePack } from '../lib/scores';
import type { AppGame } from '../lib/schedule';
import RankedTeamName from './RankedTeamName';
import { getPresentationTimeZone } from '../lib/weekPresentation';

type MatchupsWeekPanelProps = {
  games: AppGame[];
  oddsByKey: Record<string, CombinedOdds>;
  scoresByKey: Record<string, ScorePack>;
  rosterByTeam: Map<string, string>;
  displayTimeZone?: string;
  sections?: WeekMatchupSections;
  rankingsByTeamId?: Map<string, TeamRankingEnrichment>;
  focusedOwner?: string | null;
  focusedOwnerPair?: [string, string] | null;
};

type FocusableElement = {
  scrollIntoView: (options?: ScrollIntoViewOptions) => void;
};

export function scrollFocusedOwnerIntoView(params: {
  focusedOwner: string | null;
  focusedOwnerPair: [string, string] | null;
  refsByOwner: Map<string, FocusableElement>;
}): boolean {
  const { focusedOwner, focusedOwnerPair, refsByOwner } = params;
  const targetOwner = focusedOwner ?? focusedOwnerPair?.[0] ?? null;
  if (!targetOwner) return false;
  const element = refsByOwner.get(targetOwner);
  if (!element) return false;
  element.scrollIntoView({ block: 'center', behavior: 'smooth' });
  return true;
}

const DEFAULT_VISIBLE_OPPONENTS = getDefaultVisibleOpponentsCount();
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

function performanceClasses(tone: 'scheduled' | 'inprogress' | 'final' | 'neutral'): string {
  if (tone === 'final') {
    return 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300';
  }
  if (tone === 'inprogress') {
    return 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300';
  }
  if (tone === 'neutral') {
    return 'bg-slate-100 text-slate-700 dark:bg-zinc-800 dark:text-zinc-200';
  }
  return 'bg-blue-50 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300';
}

function getOpponentBadgeClasses(descriptor: string): string {
  if (descriptor === 'Self') {
    return 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300';
  }
  if (descriptor === 'FCS') {
    return 'border-gray-100 bg-gray-50/70 text-gray-500 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-500';
  }
  if (descriptor === 'NoClaim (FBS)') {
    return 'border-gray-200 bg-gray-50 text-gray-600 dark:border-zinc-700 dark:bg-zinc-800/70 dark:text-zinc-300';
  }
  return 'border-gray-200 bg-gray-50 text-gray-600 dark:border-zinc-700 dark:bg-zinc-800/70 dark:text-zinc-300';
}

function ownerOutcomeRowClasses(tone: GameOutcomeTone): string {
  switch (tone) {
    case 'inprogress':
      return 'border-l-2 border-l-amber-400/80 bg-amber-50/40 pl-2 dark:border-l-amber-500/70 dark:bg-amber-950/10';
    case 'finalWin':
      return 'border-l-2 border-l-emerald-400/80 bg-emerald-50/40 pl-2 dark:border-l-emerald-500/70 dark:bg-emerald-950/10';
    case 'finalLoss':
      return 'border-l-2 border-l-rose-400/80 bg-rose-50/40 pl-2 dark:border-l-rose-500/70 dark:bg-rose-950/10';
    case 'finalSelf':
      return 'border-l-2 border-l-violet-400/80 bg-violet-50/40 pl-2 dark:border-l-violet-500/70 dark:bg-violet-950/10';
    default:
      return 'border-l-2 border-l-transparent pl-2';
  }
}

function ownerCardSurfaceClasses(tone: OwnerWeekSlate['performance']['tone']): string {
  if (tone === 'final') {
    return 'border-emerald-300/70 bg-emerald-500/15 dark:border-emerald-900/70 dark:bg-emerald-950/15';
  }
  if (tone === 'inprogress') {
    return 'border-amber-300/70 bg-amber-500/15 dark:border-amber-900/70 dark:bg-amber-950/15';
  }
  if (tone === 'scheduled') {
    return 'border-blue-300/70 bg-blue-500/15 dark:border-blue-900/70 dark:bg-blue-950/15';
  }
  return 'border-gray-300/90 bg-white dark:border-zinc-700 dark:bg-zinc-900';
}

function ownerRecordToneClasses(tone: OwnerWeekSlate['performance']['tone']): string {
  if (tone === 'final') {
    return 'text-emerald-700 dark:text-emerald-300';
  }
  if (tone === 'inprogress') {
    return 'text-amber-700 dark:text-amber-300';
  }
  if (tone === 'scheduled') {
    return 'text-blue-700 dark:text-blue-300';
  }
  return 'text-gray-900 dark:text-zinc-100';
}

function buildLiveClockLabel(score?: ScorePack): string | null {
  if (!score) return null;
  const status = score.status?.trim() ?? '';
  const time = score.time?.trim() ?? '';
  const hasIsoDatePrefix = /^\d{4}-\d{2}-\d{2}[t\s]\d{2}:\d{2}/i.test(time);
  const hasIsoUtcSuffix = /z$/i.test(time);
  const parsedTime = Date.parse(time);
  const looksLikeKickoffTimestamp =
    time.length > 0 && (hasIsoDatePrefix || hasIsoUtcSuffix) && Number.isFinite(parsedTime);
  const liveClockTime = looksLikeKickoffTimestamp ? '' : time;

  if (liveClockTime.length === 0 && status.length === 0) return null;
  if (liveClockTime.length > 0 && /in progress/i.test(status)) return liveClockTime;
  if (liveClockTime.length > 0 && status.length > 0) return `${status} ${liveClockTime}`;
  if (/in progress/i.test(status)) return null;
  return liveClockTime.length > 0 ? liveClockTime : status;
}

function GameRow({
  slateGame,
  scoresByKey,
  oddsByKey,
  rosterByTeam,
  displayTimeZone,
  rankingsByTeamId,
}: {
  slateGame: OwnerSlateGame;
  scoresByKey: Record<string, ScorePack>;
  oddsByKey: Record<string, CombinedOdds>;
  rosterByTeam: Map<string, string>;
  displayTimeZone: string;
  rankingsByTeamId?: Map<string, TeamRankingEnrichment>;
}): React.ReactElement {
  const score = scoresByKey[slateGame.game.key];
  const odds = oddsByKey[slateGame.game.key];
  const { primary, secondary } = prioritizeGameTags(
    computeGameTags(slateGame.game, score, odds, rosterByTeam, rankingsByTeamId)
  );
  const ownerOutcome = deriveOwnerOutcome({ slateGame, score });
  const rawStatusBucket = classifyScorePackStatus(score);
  const statusTone = rawStatusBucket === 'disrupted' ? 'scheduled' : rawStatusBucket;
  const opponentDescriptor = deriveOpponentDescriptor(slateGame);
  const rowClasses = ownerOutcomeRowClasses(ownerOutcome.tone);
  const awayTeamName = slateGame.game.csvAway;
  const homeTeamName = slateGame.game.csvHome;
  const awayTeamId =
    slateGame.ownerTeamSide === 'away' ? slateGame.ownerTeamId : slateGame.opponentTeamId;
  const homeTeamId =
    slateGame.ownerTeamSide === 'home' ? slateGame.ownerTeamId : slateGame.opponentTeamId;
  const awayScore = score?.away.score;
  const homeScore = score?.home.score;
  const hasPrimaryScoreline =
    (statusTone === 'final' || statusTone === 'inprogress') &&
    (awayScore != null || homeScore != null);
  const scheduledSeparator =
    usesNeutralSiteSemantics(slateGame.game) || slateGame.game.neutral ? 'vs' : '@';
  const liveClockLabel = buildLiveClockLabel(score);
  const metadataEntries: string[] = [];
  if (statusTone === 'inprogress' && liveClockLabel) metadataEntries.push(liveClockLabel);
  metadataEntries.push(opponentDescriptor);
  if (statusTone === 'scheduled') {
    metadataEntries.push(`Kickoff ${formatKickoff(slateGame.game.date, displayTimeZone)}`);
  } else {
    metadataEntries.push(formatKickoff(slateGame.game.date, displayTimeZone));
  }
  if (slateGame.game.neutral) {
    metadataEntries.push('Neutral site');
  }

  return (
    <li className={`rounded-md py-2 transition-colors ${rowClasses}`}>
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-1.5 text-sm leading-5 text-gray-900 dark:text-zinc-100">
          {slateGame.game.label ? (
            <span className="text-xs font-semibold text-violet-700 dark:text-violet-300">
              {slateGame.game.label}
            </span>
          ) : null}
          {hasPrimaryScoreline ? (
            <>
              <RankedTeamName
                className="font-medium"
                teamName={awayTeamName}
                ranking={rankingsByTeamId?.get(awayTeamId)}
              />
              <span className="inline-flex min-w-[2ch] justify-end font-semibold tabular-nums">
                {awayScore ?? '—'}
              </span>
              <span className="text-gray-400 dark:text-zinc-500">–</span>
              <span className="inline-flex min-w-[2ch] justify-start font-semibold tabular-nums">
                {homeScore ?? '—'}
              </span>
              <RankedTeamName
                className="font-medium"
                teamName={homeTeamName}
                ranking={rankingsByTeamId?.get(homeTeamId)}
              />
            </>
          ) : (
            <>
              <RankedTeamName
                className="font-medium"
                teamName={awayTeamName}
                ranking={rankingsByTeamId?.get(awayTeamId)}
              />
              <span className="text-gray-400 dark:text-zinc-500">{scheduledSeparator}</span>
              <RankedTeamName
                className="font-medium"
                teamName={homeTeamName}
                ranking={rankingsByTeamId?.get(homeTeamId)}
              />
            </>
          )}
          <span
            className={`inline-flex w-fit rounded-full px-2 py-0.5 text-xs font-semibold ${performanceClasses(statusTone)}`}
          >
            {statusTone === 'final' ? 'Final' : statusTone === 'inprogress' ? 'Live' : 'Scheduled'}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-5 text-gray-500 dark:text-zinc-400">
          {primary ? (
            <span className="inline-flex flex-wrap gap-1">
              <span className="rounded-full border border-blue-300 bg-blue-100 px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-blue-800 dark:border-blue-700 dark:bg-blue-900/30 dark:text-blue-200">
                {LEAGUE_TAG_LABELS[primary]}
              </span>
              {secondary.map((tag) => (
                <span
                  key={`${slateGame.game.key}:tag:${tag}`}
                  className="hidden rounded-full border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-xs font-medium uppercase tracking-wide text-gray-600 sm:inline-flex dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                >
                  {LEAGUE_TAG_LABELS[tag]}
                </span>
              ))}
            </span>
          ) : null}
          {metadataEntries.map((entry, index) => (
            <React.Fragment key={`${slateGame.game.key}:meta:${entry}`}>
              {index > 0 ? <span>•</span> : null}
              {entry === opponentDescriptor ? (
                <span className={`${pillClass()} ${getOpponentBadgeClasses(opponentDescriptor)}`}>
                  {entry}
                </span>
              ) : (
                <span>{entry}</span>
              )}
            </React.Fragment>
          ))}
        </div>
      </div>
    </li>
  );
}

function EmptyState(): React.ReactElement {
  return (
    <div className="rounded border border-dashed border-gray-300 bg-gray-50 px-3 py-6 text-sm text-gray-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
      No surname-relevant games for this week.
    </div>
  );
}

function OwnerCard({
  slate,
  ownerStanding,
  scoresByKey,
  oddsByKey,
  rosterByTeam,
  displayTimeZone,
  rankingsByTeamId,
  isFocused = false,
  onRegisterRef,
}: {
  slate: OwnerWeekSlate;
  ownerStanding?: ReturnType<typeof computeStandings>[number];
  scoresByKey: Record<string, ScorePack>;
  oddsByKey: Record<string, CombinedOdds>;
  rosterByTeam: Map<string, string>;
  displayTimeZone: string;
  rankingsByTeamId?: Map<string, TeamRankingEnrichment>;
  isFocused?: boolean;
  onRegisterRef?: (element: HTMLElement | null) => void;
}): React.ReactElement {
  const [isExpanded, setIsExpanded] = React.useState(false);
  const opponentSummaryEntries = React.useMemo(() => summarizeSlateOpponents(slate), [slate]);
  const hasHiddenOpponents = opponentSummaryEntries.length > DEFAULT_VISIBLE_OPPONENTS;

  return (
    <article
      ref={onRegisterRef}
      className={`space-y-2.5 rounded-xl border p-3.5 shadow-sm sm:p-4 ${ownerCardSurfaceClasses(
        slate.performance.tone
      )} ${isFocused ? 'ring-1 ring-blue-400 dark:ring-blue-600' : ''}`}
      data-owner-card={slate.owner}
    >
      <div className="space-y-2">
        <div className="flex flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-x-3 sm:gap-y-1">
          <h3 className="text-lg font-semibold tracking-tight text-gray-900 dark:text-zinc-100">
            {slate.owner}
          </h3>
          <span
            className={`text-base font-semibold ${ownerRecordToneClasses(slate.performance.tone)}`}
          >
            {slate.performance.summary}
          </span>
        </div>
        <p className="text-sm leading-5 text-gray-600 dark:text-zinc-400 break-words">
          <span>
            {formatSlateSummaryText({
              entries: opponentSummaryEntries,
              totalGames: slate.totalGames,
              expanded: isExpanded,
            })}
          </span>
          <span className="mx-1 text-gray-300 dark:text-zinc-600">•</span>
          <span>
            total {slate.totalGames} · wins {ownerStanding?.wins ?? 0} · live {slate.liveGames}
          </span>
          {hasHiddenOpponents ? (
            <>
              <span className="mx-1 text-gray-300 dark:text-zinc-600">•</span>
              <button
                type="button"
                className="text-xs font-medium text-gray-500 underline-offset-2 hover:text-gray-700 hover:underline dark:text-zinc-400 dark:hover:text-zinc-200"
                onClick={() => setIsExpanded((current) => !current)}
              >
                {isExpanded ? 'Show less' : 'Show all'}
              </button>
            </>
          ) : null}
        </p>
      </div>

      <ul className="divide-y divide-gray-200 dark:divide-zinc-800">
        {slate.games.map((slateGame) => (
          <GameRow
            key={`${slate.owner}:${slateGame.game.key}:${slateGame.ownerTeamSide}`}
            slateGame={slateGame}
            scoresByKey={scoresByKey}
            oddsByKey={oddsByKey}
            rosterByTeam={rosterByTeam}
            displayTimeZone={displayTimeZone}
            rankingsByTeamId={rankingsByTeamId}
          />
        ))}
      </ul>
    </article>
  );
}

export default function MatchupsWeekPanel(props: MatchupsWeekPanelProps): React.ReactElement {
  const {
    games,
    oddsByKey,
    scoresByKey,
    rosterByTeam,
    displayTimeZone = getPresentationTimeZone(),
    sections,
    rankingsByTeamId = new Map(),
    focusedOwner = null,
    focusedOwnerPair = null,
  } = props;
  const derivedSections = sections ?? deriveWeekMatchupSections(games, rosterByTeam);
  const ownerSlates = deriveOwnerWeekSlates(games, rosterByTeam, scoresByKey);
  const oddsAvailableCount = React.useMemo(
    () => games.filter((game) => Boolean(oddsByKey[game.key])).length,
    [games, oddsByKey]
  );
  const standingsByOwner = React.useMemo(
    () =>
      new Map(
        computeStandings(games, scoresByKey, rosterByTeam).map((row) => [row.owner, row] as const)
      ),
    [games, scoresByKey, rosterByTeam]
  );
  const oddsSummaryCopy = deriveMatchupsHeaderCopy({
    gamesCount: games.length,
    oddsAvailableCount,
  });
  const ownerCardRefs = React.useRef<Map<string, HTMLElement>>(new Map());

  React.useEffect(() => {
    scrollFocusedOwnerIntoView({
      focusedOwner,
      focusedOwnerPair,
      refsByOwner: ownerCardRefs.current,
    });
  }, [focusedOwner, focusedOwnerPair]);

  return (
    <div className="space-y-3">
      <section className="space-y-1.5">
        <div>
          <h2 className="text-base font-semibold text-gray-900 dark:text-zinc-100">
            Weekly Slates
          </h2>
          <p className="text-xs text-gray-600 dark:text-zinc-400">Owner-first weekly cards.</p>
          <p className="text-xs text-gray-500 dark:text-zinc-400">
            Live games and primary tags are highlighted.
          </p>
          {oddsSummaryCopy ? (
            <p className="text-xs text-gray-500 dark:text-zinc-400">{oddsSummaryCopy}</p>
          ) : null}
        </div>

        {ownerSlates.length ? (
          <div className="grid gap-2.5 lg:grid-cols-2">
            {ownerSlates.map((slate) => (
              <OwnerCard
                key={slate.owner}
                slate={slate}
                ownerStanding={standingsByOwner.get(slate.owner)}
                scoresByKey={scoresByKey}
                oddsByKey={oddsByKey}
                rosterByTeam={rosterByTeam}
                displayTimeZone={displayTimeZone}
                rankingsByTeamId={rankingsByTeamId}
                onRegisterRef={(element) => {
                  if (!element) {
                    ownerCardRefs.current.delete(slate.owner);
                    return;
                  }
                  ownerCardRefs.current.set(slate.owner, element);
                }}
                isFocused={
                  focusedOwner === slate.owner ||
                  (focusedOwnerPair != null &&
                    (focusedOwnerPair[0] === slate.owner || focusedOwnerPair[1] === slate.owner))
                }
              />
            ))}
          </div>
        ) : (
          <EmptyState />
        )}
      </section>

      <section className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-3 py-2.5 sm:px-4 dark:border-zinc-700 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">Excluded games</h2>
        <p className="mt-1 text-xs text-gray-600 dark:text-zinc-400">
          {deriveExcludedGamesSummary(derivedSections)}{' '}
        </p>
      </section>
    </div>
  );
}

import React from 'react';

import { formatExpandedKickoff } from '../lib/gameCardPresentation';
import { classifyScorePackStatus } from '../lib/gameStatus';
import { displayOwner } from '../lib/gameOwnership';
import type { CombinedOdds } from '../lib/odds';
import {
  EYEBROW_TAG_CLASSES,
  formatGameMatchupLabel,
  pillClass,
  usesNeutralSiteSemantics,
} from '../lib/gameUi';
import {
  computeGameTags,
  computeStandings,
  LEAGUE_TAG_LABELS,
  prioritizeGameTags,
} from '../lib/gameTags';
import {
  deriveOwnerWeekSlates,
  type OwnerSlateGame,
  type OwnerWeekSlate,
  type WeekMatchupSections,
} from '../lib/matchups';
import {
  deriveOpponentDescriptor,
  deriveOwnerOutcome,
  selectSlateGameVisibility,
  type GameOutcomeTone,
} from '../lib/selectors/matchups';
import type { TeamRankingEnrichment } from '../lib/rankings';
import type { ScorePack } from '../lib/scores';
import type { AppGame } from '../lib/schedule';
import type { CanonicalStandings } from '../lib/selectors/leagueStandings';
import type { LiveDelta } from '../lib/selectors/liveDelta';
import {
  EMPTY_TEAM_RECORDS_BY_PROVIDER_GAME_ID,
  type TeamRecordsByProviderGameId,
} from '../lib/teamRecords/clientProjection';
import CompactGameScoreboard from './CompactGameScoreboard';
import { getPresentationTimeZone } from '../lib/weekPresentation';

type MatchupsWeekPanelProps = {
  games: AppGame[];
  oddsByKey: Record<string, CombinedOdds>;
  scoresByKey: Record<string, ScorePack>;
  rosterByTeam: Map<string, string>;
  displayTimeZone?: string;
  sections?: WeekMatchupSections;
  rankingsByTeamId?: Map<string, TeamRankingEnrichment>;
  teamRecordsByProviderGameId?: TeamRecordsByProviderGameId;
  focusedOwner?: string | null;
  focusedOwnerPair?: [string, string] | null;
  /**
   * Canonical standings snapshot loaded server-side. When present, drives the
   * owner-card display order so the Matchups view matches Standings/Overview
   * owner identity. Falls back to the client-derived owner-slate order when
   * canonical is absent.
   */
  canonicalStandings?: CanonicalStandings | null;
  /**
   * Client-side partial-week overlay retained on this public surface for Item
   * 143, which owns the decision about Matchups' freshness-gated live marker.
   * The shared scoreboard currently owns its live indicator behavior.
   */
  liveDelta?: LiveDelta | null;
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
      return 'border-l-2 border-l-zinc-400/80 bg-zinc-50/40 pl-2 dark:border-l-zinc-500/70 dark:bg-zinc-950/10';
    case 'finalWin':
      return 'border-l-2 border-l-transparent bg-gray-50/40 pl-2 dark:border-l-emerald-500/70 dark:bg-zinc-950/10';
    case 'finalLoss':
      return 'border-l-2 border-l-transparent bg-gray-50/40 pl-2 dark:border-l-rose-500/70 dark:bg-zinc-950/10';
    case 'finalSelf':
      return 'border-l-2 border-l-violet-400/80 bg-gray-50/40 pl-2 dark:border-l-violet-500/70 dark:bg-zinc-950/10';
    default:
      return 'border-l-2 border-l-transparent pl-2';
  }
}

function ownerCardSurfaceClasses(tone: OwnerWeekSlate['performance']['tone']): string {
  if (tone === 'scheduled') {
    return 'border-sky-300/70 bg-sky-500/15 dark:border-sky-800/70 dark:bg-zinc-800';
  }
  return 'border-gray-300/90 bg-white dark:border-zinc-700 dark:bg-zinc-800';
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
  teamRecordsByProviderGameId,
}: {
  slateGame: OwnerSlateGame;
  scoresByKey: Record<string, ScorePack>;
  oddsByKey: Record<string, CombinedOdds>;
  rosterByTeam: Map<string, string>;
  displayTimeZone: string;
  rankingsByTeamId?: Map<string, TeamRankingEnrichment>;
  teamRecordsByProviderGameId: TeamRecordsByProviderGameId;
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
  const scheduledSeparator =
    usesNeutralSiteSemantics(slateGame.game) || slateGame.game.neutral ? 'vs' : '@';
  const liveClockLabel = buildLiveClockLabel(score);
  const scoreboardState =
    statusTone === 'inprogress' ? 'live' : statusTone === 'final' ? 'final' : 'scheduled';
  const cardOwner = displayOwner(slateGame.owner);
  const opponentOwner = displayOwner(slateGame.opponentOwner);
  const opponentBelongsToCardOwner = slateGame.opponentOwner === slateGame.owner;
  const awayOwner = slateGame.ownerTeamSide === 'away' ? cardOwner : opponentOwner;
  const homeOwner = slateGame.ownerTeamSide === 'home' ? cardOwner : opponentOwner;
  const awayIsCardOwnerTeam =
    slateGame.ownerTeamSide === 'away' ||
    (slateGame.ownerTeamSide === 'home' && opponentBelongsToCardOwner);
  const homeIsCardOwnerTeam =
    slateGame.ownerTeamSide === 'home' ||
    (slateGame.ownerTeamSide === 'away' && opponentBelongsToCardOwner);
  const awayRanking = rankingsByTeamId?.get(awayTeamId);
  const homeRanking = rankingsByTeamId?.get(homeTeamId);
  const teamRecords = slateGame.game.providerGameId
    ? (teamRecordsByProviderGameId[String(slateGame.game.providerGameId).trim()] ?? null)
    : null;
  const opponentClassification =
    slateGame.ownerTeamSide === 'away'
      ? slateGame.game.homeClassification
      : slateGame.game.awayClassification;
  const opponentRanking = slateGame.ownerTeamSide === 'away' ? homeRanking : awayRanking;
  const scoreboardShowsOpponentFcsMarker =
    opponentClassification === 'fcs' && opponentRanking?.rank == null;
  const matchupLabel = formatGameMatchupLabel(slateGame.game, {
    homeAwaySeparator: scheduledSeparator,
  });
  // Item 163, owner ruling 2026-09-08: the `vs <owner>` form is retired from the
  // card. The scoreboard renders each team's owner inline on its own row, so
  // whenever this descriptor named an opponent's owner it printed a name already
  // two lines above it. `DESIGN.md:289` permits a marker that restates inline
  // content WHERE IT AIDS SCANNING, and this one does not: it sits in tier 2 below
  // both team lines, so the reader meets the inline name first. The mockup carries
  // no such pill.
  //
  // Suppressed HERE rather than in `deriveOpponentDescriptor` because the
  // duplication is a property of this card, not of the descriptor: the selector's
  // other consumer groups opponents for a summary that renders no scoreboard, where
  // the owner label is the only thing identifying them.
  //
  // `Self` survives — it names a relationship, not a person, and duplicates nothing.
  // So do `FCS`, `NoClaim (FBS)` and placeholder/derived participant names, none of
  // which appears anywhere else on the row.
  const opponentOwnedBySomeoneElse =
    slateGame.opponentOwner != null && slateGame.opponentOwner !== slateGame.owner;
  const hideOpponentDescriptor =
    opponentOwnedBySomeoneElse ||
    opponentDescriptor === 'NoClaim (FBS)' ||
    (opponentDescriptor === 'FCS' && scoreboardShowsOpponentFcsMarker);
  const metadataEntries: string[] = [];
  if (!hideOpponentDescriptor) metadataEntries.push(opponentDescriptor);
  if (statusTone !== 'scheduled') {
    metadataEntries.push(
      formatExpandedKickoff(slateGame.game.date, displayTimeZone, slateGame.game.startTimeTBD)
    );
  }
  const scheduledKickoff = `Kickoff ${formatExpandedKickoff(
    slateGame.game.date,
    displayTimeZone,
    slateGame.game.startTimeTBD
  )}`;
  const tier2Content = primary || metadataEntries.length > 0;

  return (
    <li className={`rounded-md transition-colors ${rowClasses}`}>
      <CompactGameScoreboard
        state={scoreboardState}
        clock={
          scoreboardState === 'scheduled'
            ? scheduledKickoff
            : scoreboardState === 'live'
              ? (liveClockLabel ?? undefined)
              : undefined
        }
        neutralSite={slateGame.game.neutral}
        matchupLabel={matchupLabel}
        contextSlot={
          slateGame.game.label ? (
            <span className="text-xs font-semibold text-violet-700 dark:text-violet-300">
              {slateGame.game.label}
            </span>
          ) : undefined
        }
        away={{
          teamName: awayTeamName,
          owner: awayOwner,
          isCardOwnerTeam: awayIsCardOwnerTeam,
          rank: awayRanking?.rank,
          rankSource: awayRanking?.rankSource,
          classification: slateGame.game.awayClassification,
          record: teamRecords?.away,
          score: scoreboardState === 'scheduled' ? null : (awayScore ?? null),
        }}
        home={{
          teamName: homeTeamName,
          owner: homeOwner,
          isCardOwnerTeam: homeIsCardOwnerTeam,
          rank: homeRanking?.rank,
          rankSource: homeRanking?.rankSource,
          classification: slateGame.game.homeClassification,
          record: teamRecords?.home,
          score: scoreboardState === 'scheduled' ? null : (homeScore ?? null),
        }}
        tier2Slot={
          tier2Content ? (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-5 text-gray-500 dark:text-zinc-400">
              {primary ? (
                <span className="inline-flex flex-wrap gap-1">
                  <span className={`inline-flex ${EYEBROW_TAG_CLASSES}`} data-eyebrow-tag>
                    {LEAGUE_TAG_LABELS[primary]}
                  </span>
                  {secondary.map((tag) => (
                    <span
                      key={`${slateGame.game.key}:tag:${tag}`}
                      className={`hidden sm:inline-flex ${EYEBROW_TAG_CLASSES}`}
                      data-eyebrow-tag
                    >
                      {LEAGUE_TAG_LABELS[tag]}
                    </span>
                  ))}
                </span>
              ) : null}
              {metadataEntries.map((entry, index) => (
                <React.Fragment key={`${slateGame.game.key}:meta:${entry}`}>
                  {index > 0 || primary ? <span>•</span> : null}
                  {entry === opponentDescriptor ? (
                    <span
                      className={`${pillClass()} ${getOpponentBadgeClasses(opponentDescriptor)}`}
                    >
                      {entry}
                    </span>
                  ) : (
                    <span>{entry}</span>
                  )}
                </React.Fragment>
              ))}
            </div>
          ) : undefined
        }
      />
    </li>
  );
}

function EmptyState(): React.ReactElement {
  return (
    <div className="rounded border border-dashed border-gray-300 bg-gray-50 px-3 py-6 text-sm text-gray-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
      No owner-relevant games for this week.
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
  teamRecordsByProviderGameId,
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
  teamRecordsByProviderGameId: TeamRecordsByProviderGameId;
  isFocused?: boolean;
  onRegisterRef?: (element: HTMLElement | null) => void;
}): React.ReactElement {
  const [isExpanded, setIsExpanded] = React.useState(false);
  const gameListId = `${React.useId()}-games`;
  // Item 135 — the selector decides both the count and which games the collapsed
  // card shows, so the control's label and the list it governs cannot disagree.
  // It also deduplicates: an owner holding both teams in a game gets two mirror
  // slate entries, and that is one game, one row.
  const { visibleGames, hiddenGameCount, hasHiddenGames } = React.useMemo(
    () => selectSlateGameVisibility(slate, isExpanded),
    [slate, isExpanded]
  );
  const wins = ownerStanding?.wins ?? 0;
  const losses = ownerStanding?.losses ?? 0;
  const winPctDisplay = wins + losses > 0 ? `${((wins / (wins + losses)) * 100).toFixed(1)}%` : '—';

  return (
    <article
      ref={onRegisterRef}
      className={`rounded-xl border p-3.5 shadow-sm sm:p-4 ${ownerCardSurfaceClasses(
        slate.performance.tone
      )} ${isFocused ? 'ring-1 ring-blue-400 dark:ring-blue-600' : ''}`}
      data-owner-card={slate.owner}
    >
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-xl font-bold tracking-tight text-gray-900 dark:text-zinc-50">
          {slate.owner}
        </h3>
        <span className="text-base font-semibold text-blue-600 dark:text-blue-400">
          {slate.performance.summary}
        </span>
      </div>

      <div className="mb-3 grid grid-cols-4 divide-x divide-gray-200 dark:divide-zinc-700">
        {(
          [
            { label: 'GAMES', value: slate.totalGames },
            { label: 'WINS', value: wins },
            { label: 'WIN%', value: winPctDisplay },
            { label: 'LIVE', value: slate.liveGames },
          ] as const
        ).map(({ label, value }) => (
          <div key={label} className="flex flex-col items-center py-2">
            <span className="text-base font-bold tabular-nums text-gray-900 dark:text-zinc-50">
              {value}
            </span>
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-zinc-400">
              {label}
            </span>
          </div>
        ))}
      </div>

      <ul id={gameListId} className="[&>li:last-child>article]:border-b-0">
        {visibleGames.map((slateGame) => (
          <GameRow
            key={`${slate.owner}:${slateGame.game.key}`}
            slateGame={slateGame}
            scoresByKey={scoresByKey}
            oddsByKey={oddsByKey}
            rosterByTeam={rosterByTeam}
            displayTimeZone={displayTimeZone}
            rankingsByTeamId={rankingsByTeamId}
            teamRecordsByProviderGameId={teamRecordsByProviderGameId}
          />
        ))}
      </ul>

      {hasHiddenGames ? (
        <button
          type="button"
          aria-expanded={isExpanded}
          aria-controls={gameListId}
          className="mt-2.5 w-full rounded-md border border-gray-200 py-1.5 text-xs font-semibold text-gray-600 transition-colors hover:bg-gray-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-700/50"
          onClick={() => setIsExpanded((current) => !current)}
        >
          {isExpanded
            ? 'Show less ↑'
            : `Show ${hiddenGameCount} more game${hiddenGameCount === 1 ? '' : 's'} ↓`}
        </button>
      ) : null}
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
    rankingsByTeamId = new Map(),
    teamRecordsByProviderGameId = EMPTY_TEAM_RECORDS_BY_PROVIDER_GAME_ID,
    focusedOwner = null,
    focusedOwnerPair = null,
    canonicalStandings = null,
  } = props;
  const rawOwnerSlates = deriveOwnerWeekSlates(games, rosterByTeam, scoresByKey);
  const visibleOwnerSlates = rawOwnerSlates.filter((slate) => displayOwner(slate.owner) !== null);
  // Reorder owner cards to match canonical owner identity when canonical is
  // present so Matchups shares the alphabetical ordering used by Standings/
  // Overview. Owner slates with no canonical entry (unrecognized rosters) are
  // appended after the canonical block in their original order so they remain
  // visible.
  const ownerSlates = React.useMemo(() => {
    if (!canonicalStandings) return visibleOwnerSlates;
    const slatesByOwner = new Map(visibleOwnerSlates.map((slate) => [slate.owner, slate] as const));
    const ordered: OwnerWeekSlate[] = [];
    for (const owner of canonicalStandings.ownerColorOrder) {
      const slate = slatesByOwner.get(owner);
      if (slate) {
        ordered.push(slate);
        slatesByOwner.delete(owner);
      }
    }
    for (const slate of visibleOwnerSlates) {
      if (slatesByOwner.has(slate.owner)) {
        ordered.push(slate);
        slatesByOwner.delete(slate.owner);
      }
    }
    return ordered;
  }, [canonicalStandings, visibleOwnerSlates]);
  const standingsByOwner = React.useMemo(
    () =>
      new Map(
        computeStandings(games, scoresByKey, rosterByTeam).map((row) => [row.owner, row] as const)
      ),
    [games, scoresByKey, rosterByTeam]
  );
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
      <section className="space-y-2.5">
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
                teamRecordsByProviderGameId={teamRecordsByProviderGameId}
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
    </div>
  );
}

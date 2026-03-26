import {
  classifyStatusLabel,
  formatScheduleStatusLabel,
  formatScoreSummaryLabel,
  isDisruptedStatusLabel,
} from '../gameStatus';
import { computeGameTags, prioritizeGameTags, type LeagueGameTag } from '../leagueInsights';
import type { CombinedOdds } from '../odds';
import type { TeamRankingEnrichment } from '../rankings';
import type { ScorePack } from '../scores';
import { getGameParticipantTeamId, type AppGame } from '../schedule';
import { groupGamesByDisplayDate } from '../weekPresentation';

function isFcsConference(conference: string | null | undefined): boolean {
  return /\bfcs\b/i.test(conference ?? '');
}

function resolveSummaryStateLabel(
  game: AppGame,
  score: ScorePack | undefined,
  isPlaceholder: boolean
): string {
  return (
    formatScoreSummaryLabel(score) ??
    formatScheduleStatusLabel(game.status, { isPlaceholder }) ??
    'Scheduled'
  );
}

function summaryStateChipBucket(
  summaryState: string
): 'final' | 'live' | 'disrupted' | 'scheduled' {
  const trimmed = summaryState.trim();
  const normalized = trimmed.toUpperCase();

  if (normalized === 'FINAL') return 'final';
  if (isDisruptedStatusLabel(trimmed)) return 'disrupted';

  const inferredState = classifyStatusLabel(trimmed);
  if (inferredState === 'inprogress') return 'live';

  return 'scheduled';
}

function summaryChipClasses(summaryState: string, isPlaceholder: boolean): string {
  const bucket = summaryStateChipBucket(summaryState);

  if (bucket === 'final') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-200';
  }

  if (bucket === 'live') {
    return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-200';
  }

  if (bucket === 'disrupted') {
    return 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/15 dark:text-rose-200';
  }

  if (isPlaceholder) {
    return 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/40 dark:bg-violet-500/15 dark:text-violet-200';
  }

  return 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/40 dark:bg-sky-500/15 dark:text-sky-200';
}

function shouldShowCollapsedCanonicalLabel(game: AppGame, isPlaceholder: boolean): boolean {
  if (!isPlaceholder || !game.label?.trim()) return false;

  const matchupParticipants = [game.csvAway, game.csvHome].map((value) =>
    value.trim().toLowerCase()
  );
  const hasTemplateParticipant = matchupParticipants.some(
    (value) => value === 'team tbd' || value === 'tbd' || value.includes('winner')
  );

  return hasTemplateParticipant || game.stage !== 'regular';
}

function primaryTagCardClasses(primaryTag: LeagueGameTag | null, hasRankedTeam: boolean): string {
  if (primaryTag === 'swing') {
    return 'border-indigo-300/80 bg-indigo-50/35 dark:border-indigo-900/70 dark:bg-indigo-950/20';
  }
  if (primaryTag === 'upset') {
    return 'border-amber-300/80 bg-amber-50/35 dark:border-amber-900/70 dark:bg-amber-950/20';
  }
  if (primaryTag === 'even') {
    return 'border-sky-300/80 bg-sky-50/30 dark:border-sky-900/70 dark:bg-sky-950/20';
  }
  if (hasRankedTeam) {
    return 'border-blue-300/70 bg-blue-50/20 dark:border-blue-900/70 dark:bg-blue-950/15';
  }
  return '';
}

export type GameWeekCardViewModel = {
  game: AppGame;
  score?: ScorePack;
  odds?: CombinedOdds;
  isPlaceholder: boolean;
  summaryState: string;
  summaryChipClassName: string;
  liveCardAccentClassName: string;
  showCollapsedCanonicalLabel: boolean;
  homeOwner?: string;
  awayOwner?: string;
  showOwnerMatchup: boolean;
  homeTeamId: string;
  awayTeamId: string;
  hasRankedTeam: boolean;
  tagPrimary: LeagueGameTag | null;
  tagSecondary: LeagueGameTag[];
  emphasisClassName: string;
};

export type GameWeekPanelViewModel = {
  hasNoGames: boolean;
  totalGames: number;
  scoresAvailableCount: number;
  oddsAvailableCount: number;
  groupedGames: Array<{
    dateKey: string;
    label: string;
    games: GameWeekCardViewModel[];
  }>;
};

export function deriveGameWeekPanelViewModel(params: {
  games: AppGame[];
  oddsByKey: Record<string, CombinedOdds>;
  scoresByKey: Record<string, ScorePack>;
  rosterByTeam: Map<string, string>;
  rankingsByTeamId: Map<string, TeamRankingEnrichment>;
  displayTimeZone: string;
}): GameWeekPanelViewModel {
  const { games, oddsByKey, scoresByKey, rosterByTeam, rankingsByTeamId, displayTimeZone } = params;

  const groupedGames = groupGamesByDisplayDate(games, displayTimeZone).map((group) => ({
    ...group,
    games: group.games.map((game): GameWeekCardViewModel => {
      const score = scoresByKey[game.key];
      const odds = oddsByKey[game.key];
      const isPlaceholder =
        game.status === 'placeholder' ||
        game.isPlaceholder ||
        game.participants?.home?.kind !== 'team' ||
        game.participants?.away?.kind !== 'team';
      const summaryState = resolveSummaryStateLabel(game, score, isPlaceholder);
      const homeIsLeagueTeam =
        game.participants.home.kind === 'team' && !isFcsConference(game.homeConf);
      const awayIsLeagueTeam =
        game.participants.away.kind === 'team' && !isFcsConference(game.awayConf);
      const homeOwner = homeIsLeagueTeam ? rosterByTeam.get(game.csvHome) : undefined;
      const awayOwner = awayIsLeagueTeam ? rosterByTeam.get(game.csvAway) : undefined;
      const homeTeamId = getGameParticipantTeamId(game, 'home') ?? game.canHome;
      const awayTeamId = getGameParticipantTeamId(game, 'away') ?? game.canAway;
      const hasRankedTeam =
        (rankingsByTeamId.get(homeTeamId)?.rank ?? null) != null ||
        (rankingsByTeamId.get(awayTeamId)?.rank ?? null) != null;
      const tagState = prioritizeGameTags(computeGameTags(game, score, odds, rosterByTeam));

      return {
        game,
        score,
        odds,
        isPlaceholder,
        summaryState,
        summaryChipClassName: summaryChipClasses(summaryState, isPlaceholder),
        liveCardAccentClassName:
          summaryStateChipBucket(summaryState) === 'live'
            ? 'ring-1 ring-amber-300/70 dark:ring-amber-800/60'
            : '',
        showCollapsedCanonicalLabel: shouldShowCollapsedCanonicalLabel(game, isPlaceholder),
        homeOwner,
        awayOwner,
        showOwnerMatchup:
          homeIsLeagueTeam && awayIsLeagueTeam && Boolean(homeOwner) && Boolean(awayOwner),
        homeTeamId,
        awayTeamId,
        hasRankedTeam,
        tagPrimary: tagState.primary,
        tagSecondary: tagState.secondary,
        emphasisClassName: primaryTagCardClasses(tagState.primary, hasRankedTeam),
      };
    }),
  }));

  const totalGames = games.length;

  return {
    hasNoGames: totalGames === 0,
    totalGames,
    scoresAvailableCount: games.filter((game) => Boolean(scoresByKey[game.key])).length,
    oddsAvailableCount: games.filter((game) => Boolean(oddsByKey[game.key])).length,
    groupedGames,
  };
}

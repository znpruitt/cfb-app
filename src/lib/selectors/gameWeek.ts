import {
  classifyStatusLabel,
  formatScheduleStatusLabel,
  formatScoreSummaryLabel,
  isDisruptedStatusLabel,
} from '../gameStatus';
import { computeGameTags, prioritizeGameTags, type LeagueGameTag } from '../gameTags';
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

function summaryStateTone(
  summaryState: string,
  isPlaceholder: boolean
): 'final' | 'live' | 'disrupted' | 'placeholder' | 'scheduled' {
  const bucket = summaryStateChipBucket(summaryState);
  if (bucket === 'final') return 'final';
  if (bucket === 'live') return 'live';
  if (bucket === 'disrupted') return 'disrupted';
  if (isPlaceholder) return 'placeholder';
  return 'scheduled';
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

export type GameWeekCardViewModel = {
  game: AppGame;
  score?: ScorePack;
  odds?: CombinedOdds;
  isPlaceholder: boolean;
  summaryState: string;
  summaryStateTone: 'final' | 'live' | 'disrupted' | 'placeholder' | 'scheduled';
  isLiveState: boolean;
  showCollapsedCanonicalLabel: boolean;
  homeOwner?: string;
  awayOwner?: string;
  showOwnerMatchup: boolean;
  homeTeamId: string;
  awayTeamId: string;
  hasRankedTeam: boolean;
  tagPrimary: LeagueGameTag | null;
  tagSecondary: LeagueGameTag[];
  emphasisTone: 'upset' | 'upset_watch' | 'top_25_matchup' | 'ranked' | 'none';
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
  // Selector boundary invariant: this module returns canonical-derived tokens only,
  // while presentation-layer class names stay in React components.
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
      const tagState = prioritizeGameTags(
        computeGameTags(game, score, odds, rosterByTeam, rankingsByTeamId)
      );
      const bucket = summaryStateChipBucket(summaryState);

      return {
        game,
        score,
        odds,
        isPlaceholder,
        summaryState,
        summaryStateTone: summaryStateTone(summaryState, isPlaceholder),
        isLiveState: bucket === 'live',
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
        emphasisTone: tagState.primary ?? (hasRankedTeam ? 'ranked' : 'none'),
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

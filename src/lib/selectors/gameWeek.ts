import {
  classifyStatusLabel,
  formatScheduleStatusLabel,
  formatScoreSummaryLabel,
  isDisruptedStatusLabel,
} from '../gameStatus';
import { formatPrimaryBroadcastLabel, formatVenueLabel } from '../gameCardPresentation';
import { computeGameTags, prioritizeGameTags, type LeagueGameTag } from '../gameTags';
import { deriveFavoriteSpreadPair, type CombinedOdds } from '../odds';
import type { TeamRankingEnrichment } from '../rankings';
import type { ScorePack } from '../scores';
import { getGameParticipantTeamId, type AppGame } from '../schedule';
import {
  EMPTY_TEAM_RECORDS_BY_PROVIDER_GAME_ID,
  type GameTeamRecordsClient,
  type TeamRecordsByProviderGameId,
} from './teamRecordsClient';
import { groupGamesByDisplayDate } from '../weekPresentation';
import { isPolicyFcsConference } from '../conferenceSubdivision';
import { getOwnerForGameSide } from '../gameOwnership';
import { formatLiveGameClock } from '../gameUi';

export type ScheduleScoreboardState = 'scheduled' | 'live' | 'final' | 'awaiting';

function resolveSummaryStateLabel(
  game: AppGame,
  score: ScorePack | undefined,
  isPlaceholder: boolean
): string {
  return (
    formatScoreSummaryLabel(score) ??
    (isPlaceholder ? 'Scheduled' : formatScheduleStatusLabel(game.status, { isPlaceholder })) ??
    'Scheduled'
  );
}

function summaryStateKind(summaryState: string): 'final' | 'live' | 'disrupted' | 'scheduled' {
  const trimmed = summaryState.trim();
  const normalized = trimmed.toUpperCase();

  if (normalized === 'FINAL') return 'final';
  if (isDisruptedStatusLabel(trimmed)) return 'disrupted';

  const inferredState = classifyStatusLabel(trimmed);
  if (inferredState === 'inprogress') return 'live';

  return 'scheduled';
}

function scoreboardState(
  stateKind: ReturnType<typeof summaryStateKind>,
  score: ScorePack | undefined
): ScheduleScoreboardState {
  if (stateKind === 'final') return 'final';
  if (stateKind === 'live') return score ? 'live' : 'awaiting';
  return 'scheduled';
}

function formatScheduleKickoff(
  date: string | null,
  timeZone: string,
  startTimeTBD?: boolean | null
): string {
  if (!date) return 'TBD';
  const kickoff = new Date(date);
  if (Number.isNaN(kickoff.getTime())) return 'TBD';
  if (startTimeTBD === true) return 'Time TBD';
  return kickoff.toLocaleTimeString(undefined, {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatMoneyline(value: number | null): string | null {
  if (value == null) return null;
  return value > 0 ? `+${value}` : `${value}`;
}

function formatOddsSummary(
  odds: CombinedOdds | undefined,
  teamNames: { away: string; home: string }
): string | null {
  if (!odds) return null;

  const segments: string[] = [];
  const favoriteSide = deriveFavoriteSpreadPair(odds.homeSpread, odds.awaySpread)?.favoriteSide;
  const favoriteName = favoriteSide ? teamNames[favoriteSide] : odds.favorite;
  if (favoriteName && odds.spread != null) {
    segments.push(`Spread: ${favoriteName} ${odds.spread}`);
  } else if (odds.spread != null) {
    segments.push(`Spread: ${odds.spread}`);
  }
  if (odds.total != null) {
    segments.push(`Over/Under: ${odds.total}`);
  }

  const awayMoneyline = formatMoneyline(odds.mlAway);
  const homeMoneyline = formatMoneyline(odds.mlHome);
  const moneylines = [
    awayMoneyline ? `${teamNames.away} ${awayMoneyline}` : null,
    homeMoneyline ? `${teamNames.home} ${homeMoneyline}` : null,
  ].filter((part): part is string => part !== null);
  if (moneylines.length > 0) {
    segments.push(`Moneyline: ${moneylines.join(' • ')}`);
  }

  return segments.length > 0 ? segments.join(' • ') : null;
}

function participantScoreboardName(game: AppGame, side: 'away' | 'home'): string {
  const participant = game.participants[side];
  if (participant.kind === 'team' && participant.labels) {
    return participant.labels.scoreboardName;
  }

  return participant.kind === 'team'
    ? participant.rawName.trim() || participant.displayName
    : participant.displayName;
}

function formatConferenceSummary(game: AppGame): string | null {
  const awayConference = game.awayConf.trim();
  const homeConference = game.homeConf.trim();
  if (awayConference && homeConference) {
    if (awayConference.localeCompare(homeConference, undefined, { sensitivity: 'accent' }) === 0) {
      return `${awayConference} matchup`;
    }
    return `${awayConference} vs ${homeConference}`;
  }
  if (awayConference) return `Away: ${awayConference}`;
  if (homeConference) return `Home: ${homeConference}`;
  return null;
}

function recordsForGame(
  game: AppGame,
  recordsByProviderGameId: TeamRecordsByProviderGameId
): GameTeamRecordsClient | null {
  const providerGameId = game.providerGameId?.trim();
  return providerGameId ? (recordsByProviderGameId[providerGameId] ?? null) : null;
}

function displayDateKey(timestampMs: number | null | undefined, timeZone: string): string | null {
  if (timestampMs == null || !Number.isFinite(timestampMs)) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(timestampMs));
}

function shouldShowCanonicalEventLabel(game: AppGame, isPlaceholder: boolean): boolean {
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
  isPlaceholder: boolean;
  scoreboardState: ScheduleScoreboardState;
  scheduleNotice: string | null;
  statusRowValue: string | null;
  broadcastLabel: string | null;
  venueLabel: string | null;
  oddsSummary: string | null;
  conferenceSummary: string | null;
  teamRecords: GameTeamRecordsClient | null;
  showCanonicalEventLabel: boolean;
  homeOwner?: string;
  awayOwner?: string;
  homeTeamId: string;
  awayTeamId: string;
  homeTeamName: string;
  awayTeamName: string;
  hasRankedTeam: boolean;
  tagPrimary: LeagueGameTag | null;
  tagSecondary: LeagueGameTag[];
};

export type GameWeekPanelViewModel = {
  hasNoGames: boolean;
  totalGames: number;
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
  teamRecordsByProviderGameId?: TeamRecordsByProviderGameId;
  displayTimeZone: string;
  currentDateMs?: number | null;
}): GameWeekPanelViewModel {
  // Selector boundary invariant: this module returns canonical-derived tokens only,
  // while presentation-layer class names stay in React components.
  const {
    games,
    oddsByKey,
    scoresByKey,
    rosterByTeam,
    rankingsByTeamId,
    teamRecordsByProviderGameId = EMPTY_TEAM_RECORDS_BY_PROVIDER_GAME_ID,
    displayTimeZone,
    currentDateMs,
  } = params;
  const todayDateKey = displayDateKey(currentDateMs, displayTimeZone);

  const groupedGames = groupGamesByDisplayDate(games, displayTimeZone).map((group) => ({
    ...group,
    label: group.dateKey === todayDateKey ? 'Today' : group.label,
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
        game.participants.home.kind === 'team' && !isPolicyFcsConference(game.homeConf);
      const awayIsLeagueTeam =
        game.participants.away.kind === 'team' && !isPolicyFcsConference(game.awayConf);
      const homeOwner = homeIsLeagueTeam
        ? getOwnerForGameSide(game, 'home', rosterByTeam)
        : undefined;
      const awayOwner = awayIsLeagueTeam
        ? getOwnerForGameSide(game, 'away', rosterByTeam)
        : undefined;
      const homeTeamId = getGameParticipantTeamId(game, 'home') ?? game.canHome;
      const awayTeamId = getGameParticipantTeamId(game, 'away') ?? game.canAway;
      const homeTeamName = participantScoreboardName(game, 'home');
      const awayTeamName = participantScoreboardName(game, 'away');
      const hasRankedTeam =
        (rankingsByTeamId.get(homeTeamId)?.rank ?? null) != null ||
        (rankingsByTeamId.get(awayTeamId)?.rank ?? null) != null;
      const tagState = prioritizeGameTags(
        computeGameTags(game, score, odds, rosterByTeam, rankingsByTeamId)
      );
      const stateKind = summaryStateKind(summaryState);
      const resolvedScoreboardState = scoreboardState(stateKind, score);
      const showBroadcast =
        resolvedScoreboardState === 'live' ||
        resolvedScoreboardState === 'awaiting' ||
        (resolvedScoreboardState === 'scheduled' && stateKind !== 'disrupted');

      return {
        game,
        score,
        isPlaceholder,
        scoreboardState: resolvedScoreboardState,
        scheduleNotice: resolvedScoreboardState === 'scheduled' ? summaryState : null,
        statusRowValue:
          resolvedScoreboardState === 'live'
            ? formatLiveGameClock(score)
            : resolvedScoreboardState === 'scheduled' && stateKind !== 'disrupted'
              ? formatScheduleKickoff(game.date, displayTimeZone, game.startTimeTBD)
              : null,
        broadcastLabel: showBroadcast ? formatPrimaryBroadcastLabel(game.media) : null,
        venueLabel: formatVenueLabel(game.venue),
        oddsSummary: formatOddsSummary(odds, { away: awayTeamName, home: homeTeamName }),
        conferenceSummary: formatConferenceSummary(game),
        teamRecords: recordsForGame(game, teamRecordsByProviderGameId),
        showCanonicalEventLabel: shouldShowCanonicalEventLabel(game, isPlaceholder),
        homeOwner,
        awayOwner,
        homeTeamId,
        awayTeamId,
        homeTeamName,
        awayTeamName,
        hasRankedTeam,
        tagPrimary: tagState.primary,
        tagSecondary: tagState.secondary,
      };
    }),
  }));

  const totalGames = games.length;

  return {
    hasNoGames: totalGames === 0,
    totalGames,
    groupedGames,
  };
}

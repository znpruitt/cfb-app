import { createTeamIdentityResolver, type TeamCatalogItem } from './teamIdentity';
import type { AppGame, ParticipantSlot, ScheduleWireItem } from './schedule';
import {
  classifyTeamSubdivision,
  getRegularSeasonEligibilityDecision,
  isFbsTeam,
  isOfficePoolEligibleTeamMatchup,
  type ScheduleEligibilityReason,
} from './scheduleEligibility';

export function isTrackedGame(
  game: AppGame,
  teamMetadataByCanonicalName: Map<string, TeamCatalogItem>,
  resolver: ReturnType<typeof createTeamIdentityResolver>
): boolean {
  const isRecognizedPlaceholderParticipant = (participant: ParticipantSlot): boolean => {
    if (participant.kind === 'derived') return true;
    if (participant.kind === 'placeholder') {
      return participant.source === 'postseason-classifier';
    }
    return false;
  };

  const isRecognizedPlaceholderShell =
    game.isPlaceholder &&
    game.stage !== 'regular' &&
    isRecognizedPlaceholderParticipant(game.participants.home) &&
    isRecognizedPlaceholderParticipant(game.participants.away);

  const isConferenceChampionshipLikePostseason =
    game.stage !== 'conference_championship' &&
    (game.postseasonRole === 'conference_championship' ||
      /conference[-\s]?championship/i.test([game.label ?? '', game.eventKey].join(' ')));

  if (game.stage !== 'regular' && game.stage !== 'conference_championship') {
    if (isConferenceChampionshipLikePostseason) {
      return false;
    }
  }

  const homeIsTeam = game.participants.home.kind === 'team';
  const awayIsTeam = game.participants.away.kind === 'team';

  if (!homeIsTeam && !awayIsTeam) {
    return isRecognizedPlaceholderShell;
  }

  const homeSubdivision = homeIsTeam
    ? classifyTeamSubdivision({
        canonicalTeamName: game.canHome,
        conference: game.homeConf,
        teamMetadataByCanonicalName,
        resolver,
        diagnosticsContext: 'schedule:tracked',
        diagnosticsGameId: game.eventId,
      })
    : 'UNKNOWN';
  const awaySubdivision = awayIsTeam
    ? classifyTeamSubdivision({
        canonicalTeamName: game.canAway,
        conference: game.awayConf,
        teamMetadataByCanonicalName,
        resolver,
        diagnosticsContext: 'schedule:tracked',
        diagnosticsGameId: game.eventId,
      })
    : 'UNKNOWN';

  if ((homeIsTeam && !awayIsTeam) || (!homeIsTeam && awayIsTeam)) {
    const placeholderParticipant = homeIsTeam ? game.participants.away : game.participants.home;
    return (
      isRecognizedPlaceholderParticipant(placeholderParticipant) &&
      (homeSubdivision === 'FBS' || awaySubdivision === 'FBS')
    );
  }

  return isOfficePoolEligibleTeamMatchup({ homeSubdivision, awaySubdivision });
}

export function resolveRegularSeasonRow(params: {
  item: ScheduleWireItem;
  resolver: ReturnType<typeof createTeamIdentityResolver>;
  teamMetadataByCanonicalName: Map<string, TeamCatalogItem>;
}): {
  include: boolean;
  reason: ScheduleEligibilityReason;
  emitIdentityIssue: boolean;
  homeResolved: ReturnType<ReturnType<typeof createTeamIdentityResolver>['resolveName']>;
  awayResolved: ReturnType<ReturnType<typeof createTeamIdentityResolver>['resolveName']>;
} {
  const { item, resolver, teamMetadataByCanonicalName } = params;
  const homeResolved = resolver.resolveName(item.homeTeam);
  const awayResolved = resolver.resolveName(item.awayTeam);
  const homeKnown = homeResolved.status === 'resolved';
  const awayKnown = awayResolved.status === 'resolved';

  const homeSubdivision = classifyTeamSubdivision({
    canonicalTeamName: homeResolved.canonicalName ?? item.homeTeam,
    conference: item.homeConference ?? '',
    teamMetadataByCanonicalName,
    resolver,
    diagnosticsContext: 'schedule:regular',
    diagnosticsGameId: String(item.id ?? ''),
  });
  const awaySubdivision = classifyTeamSubdivision({
    canonicalTeamName: awayResolved.canonicalName ?? item.awayTeam,
    conference: item.awayConference ?? '',
    teamMetadataByCanonicalName,
    resolver,
    diagnosticsContext: 'schedule:regular',
    diagnosticsGameId: String(item.id ?? ''),
  });

  const eligibility = getRegularSeasonEligibilityDecision({
    homeSubdivision,
    awaySubdivision,
    homeResolved: homeKnown,
    awayResolved: awayKnown,
  });
  return {
    include: eligibility.include,
    reason: eligibility.reason,
    emitIdentityIssue: eligibility.include && (!homeKnown || !awayKnown),
    homeResolved,
    awayResolved,
  };
}

export function buildByes(
  games: AppGame[],
  trackedFbsTeams: string[],
  teamMetadataByCanonicalName: Map<string, TeamCatalogItem>,
  resolver: ReturnType<typeof createTeamIdentityResolver>
): Record<number, string[]> {
  const byes: Record<number, string[]> = {};
  const weeks = Array.from(new Set(games.map((g) => g.week))).sort((a, b) => a - b);

  for (const week of weeks) {
    const teamsPlayingThisWeek = new Set<string>();
    for (const game of games) {
      if (game.week !== week) continue;
      if (
        game.participants.home.kind === 'team' &&
        isFbsTeam(game.canHome, teamMetadataByCanonicalName, resolver)
      ) {
        teamsPlayingThisWeek.add(game.canHome);
      }
      if (
        game.participants.away.kind === 'team' &&
        isFbsTeam(game.canAway, teamMetadataByCanonicalName, resolver)
      ) {
        teamsPlayingThisWeek.add(game.canAway);
      }
    }
    byes[week] = trackedFbsTeams
      .filter((team) => !teamsPlayingThisWeek.has(team))
      .sort((a, b) => a.localeCompare(b));
  }

  return byes;
}

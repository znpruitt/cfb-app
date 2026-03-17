import { createTeamIdentityResolver, type TeamCatalogItem } from './teamIdentity';
import {
  classifyConferenceForSubdivision,
  type ConferenceSubdivision,
} from './conferenceSubdivision';
import {
  recordAmbiguousConference,
  recordPresentDayPolicyConference,
  recordUnresolvedConference,
} from './conferenceDiagnostics';

export type EligibilitySubdivision = ConferenceSubdivision;

export type ScheduleEligibilityReason =
  | 'include_fbs_vs_fbs'
  | 'include_fbs_vs_fcs'
  | 'exclude_both_non_fbs'
  | 'exclude_unresolved_both_non_fbs'
  | 'include_unknown_fallback';

export type RegularSeasonEligibilityDecision = {
  include: boolean;
  reason: ScheduleEligibilityReason;
};

export function isFbsTeam(
  canonicalTeamName: string,
  teamMetadataByCanonicalName: Map<string, TeamCatalogItem>,
  resolver: ReturnType<typeof createTeamIdentityResolver>
): boolean {
  const resolved = resolver.resolveName(canonicalTeamName);
  if (resolved.status === 'resolved' && resolved.isOwnable) return true;

  const team = teamMetadataByCanonicalName.get(canonicalTeamName);
  if (!team) return false;

  const level = (team.level ?? team.subdivision ?? '').trim().toUpperCase();
  return level.includes('FBS');
}

export function classifyTeamSubdivision(params: {
  canonicalTeamName: string;
  conference: string;
  teamMetadataByCanonicalName: Map<string, TeamCatalogItem>;
  resolver: ReturnType<typeof createTeamIdentityResolver>;
  diagnosticsContext?: string;
  diagnosticsGameId?: string;
}): EligibilitySubdivision {
  const {
    canonicalTeamName,
    conference,
    teamMetadataByCanonicalName,
    resolver,
    diagnosticsContext,
    diagnosticsGameId,
  } = params;
  const conferenceMatch = classifyConferenceForSubdivision(conference);
  const conferenceSubdivision = conferenceMatch.subdivision;

  if (conferenceMatch.source === 'present_day_policy' && conferenceMatch.normalizedConference) {
    recordPresentDayPolicyConference({
      rawConference: conferenceMatch.rawConference,
      normalizedKey: conferenceMatch.normalizedConference,
      context: diagnosticsContext ?? 'schedule',
      teamName: canonicalTeamName,
      gameId: diagnosticsGameId,
      policyConference: conferenceMatch.matchedPolicyConference ?? conferenceMatch.rawConference,
      policyClassification: conferenceMatch.subdivision === 'FBS' ? 'FBS' : 'FCS',
    });
  }

  if (conferenceMatch.source === 'unresolved' && conferenceMatch.normalizedConference) {
    recordUnresolvedConference({
      rawConference: conferenceMatch.rawConference,
      normalizedKey: conferenceMatch.normalizedConference,
      context: diagnosticsContext ?? 'schedule',
      teamName: canonicalTeamName,
      gameId: diagnosticsGameId,
    });
  }

  if (conferenceMatch.source === 'ambiguous' && conferenceMatch.normalizedConference) {
    recordAmbiguousConference({
      rawConference: conferenceMatch.rawConference,
      normalizedKey: conferenceMatch.normalizedConference,
      context: diagnosticsContext ?? 'schedule',
      teamName: canonicalTeamName,
      gameId: diagnosticsGameId,
      candidateRecords: conferenceMatch.candidates.map((candidate) => ({
        id: candidate.id,
        name: candidate.name,
        shortName: candidate.shortName,
        abbreviation: candidate.abbreviation,
        classification: candidate.classification,
      })),
    });
  }

  if (conferenceSubdivision === 'FCS') {
    return 'FCS';
  }

  const resolved = resolver.resolveName(canonicalTeamName);
  if (resolved.status === 'resolved') {
    if (resolved.subdivision === 'FBS') return 'FBS';
    if (resolved.subdivision === 'FCS') return 'FCS';
    if (resolved.subdivision === 'OTHER') return conferenceSubdivision;
  }

  const team = teamMetadataByCanonicalName.get(canonicalTeamName);
  if (team) {
    const level = (team.level ?? team.subdivision ?? '').trim().toUpperCase();
    if (level.includes('FBS')) return 'FBS';
    if (level.includes('FCS')) return 'FCS';
  }

  return conferenceSubdivision;
}

export function isOfficePoolEligibleTeamMatchup(params: {
  homeSubdivision: EligibilitySubdivision;
  awaySubdivision: EligibilitySubdivision;
}): boolean {
  const { homeSubdivision, awaySubdivision } = params;
  return homeSubdivision === 'FBS' || awaySubdivision === 'FBS';
}

export function getRegularSeasonEligibilityDecision(params: {
  homeSubdivision: EligibilitySubdivision;
  awaySubdivision: EligibilitySubdivision;
  homeResolved: boolean;
  awayResolved: boolean;
}): RegularSeasonEligibilityDecision {
  const { homeSubdivision, awaySubdivision, homeResolved, awayResolved } = params;
  const include = isOfficePoolEligibleTeamMatchup({ homeSubdivision, awaySubdivision });

  if (include) {
    if (homeSubdivision === 'FBS' && awaySubdivision === 'FBS') {
      return { include: true, reason: 'include_fbs_vs_fbs' };
    }
    if (
      (homeSubdivision === 'FBS' && awaySubdivision === 'FCS') ||
      (homeSubdivision === 'FCS' && awaySubdivision === 'FBS')
    ) {
      return { include: true, reason: 'include_fbs_vs_fcs' };
    }
    return { include: true, reason: 'include_unknown_fallback' };
  }

  if (!homeResolved && !awayResolved) {
    return { include: false, reason: 'exclude_unresolved_both_non_fbs' };
  }

  return { include: false, reason: 'exclude_both_non_fbs' };
}

import { createTeamIdentityResolver, type TeamCatalogItem } from './teamIdentity.ts';
import {
  classifyConferenceForSubdivision,
  normalizeProviderClassification,
  providerClassificationToSubdivision,
  type ConferenceSubdivision,
  type ProviderClassification,
} from './conferenceSubdivision.ts';
import {
  recordAmbiguousConference,
  recordPresentDayPolicyConference,
  recordUnresolvedConference,
} from './conferenceDiagnostics.ts';

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
  /**
   * CFBD's own division label for THIS participant on THIS row, when the
   * schedule record carries it. Authoritative when present — see the
   * short-circuit below. Absent on records written before classification was
   * persisted, which keeps the conference/catalog fallback.
   */
  providerClassification?: ProviderClassification;
  diagnosticsContext?: string;
  diagnosticsGameId?: string;
}): EligibilitySubdivision {
  const {
    canonicalTeamName,
    conference,
    teamMetadataByCanonicalName,
    resolver,
    providerClassification,
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

  // The provider already told us this participant's division on this very row.
  // Prefer it over every form of reconstruction below: conference-string
  // matching and name resolution are both inference, and name resolution in
  // particular can collide a non-FBS school onto an FBS catalog entry whose
  // normalized key it happens to share (`Missouri S&T` -> `missourist`, the key
  // Missouri State already claims via its `missouri st` alt).
  // Re-validate at this boundary rather than trusting the static type. Durable
  // schedule rows are cast from app-state JSON without runtime checking
  // (`seasonBuild`, `canonicalScheduleCache`) and `applyManualOverride` spreads an
  // unvalidated `Partial<AppGame>` from the postseason-override store, so a value
  // outside CFBD's vocabulary can reach here. Unrecognized input must fall THROUGH
  // to inference — `providerClassificationToSubdivision` maps anything that is not
  // `fbs`/`fcs` to `OTHER`, so trusting it blindly would let a stray `'FBS'` (wrong
  // case) or a future division token silently drop a real FBS game.
  const trustedClassification = normalizeProviderClassification(providerClassification);
  if (trustedClassification) {
    return providerClassificationToSubdivision(trustedClassification);
  }

  if (conferenceSubdivision === 'FCS') {
    return 'FCS';
  }

  // Fallback, provider classification absent. A conference a real catalog record
  // classifies as Division II/III terminates here rather than falling through to
  // the resolver, so a name collision cannot promote a lower-division team to
  // FBS. The source check is load-bearing: `OTHER` is overloaded — it is also
  // what an UNRESOLVED or AMBIGUOUS conference returns, neither of which carries
  // any classification information, and terminating on those would drop real FBS
  // games. `cfbd_conference_lookup` is the ONLY source that can produce an
  // authoritative `OTHER`: present-day policy resolves exclusively to FBS or FCS
  // (`conferenceSubdivision.ts` `fromPolicyMatch`).
  if (conferenceSubdivision === 'OTHER' && conferenceMatch.source === 'cfbd_conference_lookup') {
    return 'OTHER';
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

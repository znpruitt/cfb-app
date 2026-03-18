export type ScoreAttachmentFailureReason =
  | 'unresolved_home_team'
  | 'unresolved_away_team'
  | 'unresolved_both_teams'
  | 'no_scheduled_match'
  | 'multiple_candidate_matches'
  | 'week_mismatch'
  | 'season_type_mismatch'
  | 'status_filtered'
  | 'missing_schedule_index'
  | 'provider_row_invalid'
  | 'unknown';

export type ScoreAttachmentDiagnosticClassification = 'actionable' | 'ignored';

export type ScoreAttachmentCandidateDiagnostic = {
  gameKey: string;
  homeTeam: string | null;
  awayTeam: string | null;
  week: number | null;
  seasonType: string | null;
  status: string | null;
  matchScore?: number | null;
  accepted: boolean;
  rejectionReason?: string | null;
};

export type ScoreAttachmentDiagnostic = {
  type: 'ignored_score_row';
  reason: ScoreAttachmentFailureReason;
  classification: ScoreAttachmentDiagnosticClassification;
  userMessage: string;
  provider: {
    source: string;
    providerGameId?: string | number | null;
    week: number | null;
    seasonType: string | null;
    status: string | null;
    homeTeamRaw: string | null;
    awayTeamRaw: string | null;
    homeScore?: number | null;
    awayScore?: number | null;
    kickoff?: string | null;
  };
  normalization: {
    homeTeamNormalized: string | null;
    awayTeamNormalized: string | null;
  };
  resolution: {
    homeCanonical: string | null;
    awayCanonical: string | null;
    homeResolved: boolean;
    awayResolved: boolean;
  };
  trace: {
    candidateCount: number;
    plausibleScheduledGameCount?: number;
    candidates?: ScoreAttachmentCandidateDiagnostic[];
    finalNote?: string | null;
  };
};

export function isIgnoredOutOfScopeProviderRow(item: ScoreAttachmentDiagnostic): boolean {
  return item.classification === 'ignored';
}

export function isActionableScoreAttachmentIssue(item: ScoreAttachmentDiagnostic): boolean {
  return item.classification === 'actionable';
}

export function classifyScoreAttachmentDiagnostic(params: {
  reason: ScoreAttachmentFailureReason;
  plausibleScheduledGameCount?: number;
}): ScoreAttachmentDiagnosticClassification {
  const plausibleCount = params.plausibleScheduledGameCount ?? 0;
  switch (params.reason) {
    case 'multiple_candidate_matches':
    case 'week_mismatch':
    case 'season_type_mismatch':
    case 'missing_schedule_index':
    case 'provider_row_invalid':
    case 'unknown':
      return 'actionable';
    case 'unresolved_home_team':
    case 'unresolved_away_team':
    case 'unresolved_both_teams':
      return plausibleCount > 0 ? 'actionable' : 'ignored';
    case 'no_scheduled_match':
    case 'status_filtered':
      return 'ignored';
    default:
      return 'ignored';
  }
}

export function buildScoreAttachmentUserMessage(
  item: Pick<ScoreAttachmentDiagnostic, 'reason' | 'classification'>
): string {
  if (item.classification === 'ignored') {
    switch (item.reason) {
      case 'no_scheduled_match':
        return 'Ignored: provider row not present in canonical schedule scope';
      case 'unresolved_home_team':
      case 'unresolved_away_team':
      case 'unresolved_both_teams':
        return 'Ignored: out-of-scope matchup or unresolved provider team label';
      default:
        return 'Ignored: out-of-scope provider row';
    }
  }

  switch (item.reason) {
    case 'multiple_candidate_matches':
      return 'Action required: canonical schedule match is ambiguous';
    case 'unresolved_home_team':
    case 'unresolved_away_team':
    case 'unresolved_both_teams':
      return 'Action required: alias or team resolution blocked score attachment';
    default:
      return 'Action required: score attachment anomaly needs review';
  }
}

export function summarizeAttachmentReasons(
  diagnostics: ScoreAttachmentDiagnostic[]
): Record<string, number> {
  return diagnostics.reduce<Record<string, number>>((acc, item) => {
    acc[item.reason] = (acc[item.reason] ?? 0) + 1;
    return acc;
  }, {});
}

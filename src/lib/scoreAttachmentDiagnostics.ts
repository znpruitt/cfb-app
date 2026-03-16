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
    candidates?: ScoreAttachmentCandidateDiagnostic[];
    finalNote?: string | null;
  };
};

export function summarizeAttachmentReasons(
  diagnostics: ScoreAttachmentDiagnostic[]
): Record<string, number> {
  return diagnostics.reduce<Record<string, number>>((acc, item) => {
    acc[item.reason] = (acc[item.reason] ?? 0) + 1;
    return acc;
  }, {});
}

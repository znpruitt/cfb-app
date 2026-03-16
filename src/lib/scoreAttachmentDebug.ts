import type { ScoreAttachmentDiagnostic } from './scoreAttachmentDiagnostics';

export type ScoreAttachmentDebugResponse = {
  year: number;
  week: number | null;
  seasonType: string | null;
  source?: string | null;
  summary: {
    providerRowCount: number;
    attachedCount: number;
    ignoredCount: number;
    reasons: Record<string, number>;
  };
  schedule: {
    indexedGameCount: number;
    games?: Array<{
      gameKey: string;
      homeTeam: string | null;
      awayTeam: string | null;
      week: number | null;
      seasonType: string | null;
      status?: string | null;
    }>;
  };
  diagnostics: ScoreAttachmentDiagnostic[];
};

export async function fetchScoreAttachmentDebug(params: {
  year: number;
  week?: number | null;
  seasonType?: string | null;
  source?: string | null;
}): Promise<ScoreAttachmentDebugResponse> {
  const search = new URLSearchParams();
  search.set('year', String(params.year));
  if (params.week != null) search.set('week', String(params.week));
  if (params.seasonType) search.set('seasonType', params.seasonType);
  if (params.source) search.set('source', params.source);

  const res = await fetch(`/api/debug/scores-attachment?${search.toString()}`, {
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`Debug scores endpoint failed (${res.status})`);
  }
  return (await res.json()) as ScoreAttachmentDebugResponse;
}

export type DiagEntry =
  | {
      kind: 'scores_miss';
      week: number;
      providerHome: string;
      providerAway: string;
      candidates?: Array<{ csvHome: string; csvAway: string; week: number }>;
      homeIdentity?: {
        normalizedInput: string;
        resolutionSource: string;
        status: 'resolved' | 'unresolved' | 'ambiguous';
        candidates?: string[];
      };
      awayIdentity?: {
        normalizedInput: string;
        resolutionSource: string;
        status: 'resolved' | 'unresolved' | 'ambiguous';
        candidates?: string[];
      };
    }
  | {
      kind: 'week_mismatch';
      week: number;
      providerHome: string;
      providerAway: string;
      candidates: Array<{ csvHome: string; csvAway: string; week: number }>;
    }
  | {
      kind: 'identity_resolution';
      flow: 'schedule' | 'scores' | 'odds';
      rawInput: string;
      normalizedInput: string;
      resolutionSource: string;
      status: 'resolved' | 'unresolved' | 'ambiguous';
      notes?: string;
      candidates?: string[];
    }
  | { kind: 'generic'; message: string };

export type AliasStaging = { upserts: Record<string, string>; deletes: string[] };

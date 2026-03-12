export type DiagEntry =
  | {
      kind: 'scores_miss';
      week: number;
      providerHome: string;
      providerAway: string;
      candidates?: Array<{ csvHome: string; csvAway: string; week: number }>;
    }
  | {
      kind: 'week_mismatch';
      week: number;
      providerHome: string;
      providerAway: string;
      candidates: Array<{ csvHome: string; csvAway: string; week: number }>;
    }
  | { kind: 'generic'; message: string };

export type AliasStaging = { upserts: Record<string, string>; deletes: string[] };

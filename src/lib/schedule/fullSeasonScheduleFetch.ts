import { fetchUpstreamJson } from '@/lib/api/fetchUpstream';
import { buildCfbdGamesUrl } from '@/lib/cfbd';

import {
  mapCfbdScheduleGame,
  type CfbdScheduleGame,
  type ScheduleItem,
  type SeasonType,
} from './cfbdSchedule.ts';
import {
  finalScoreCandidatesFromSchedulePayload,
  type FinalScoreSweepCandidate,
} from './finalScoreSweep.ts';

/** Bounded provider retry — mirrors the `/api/schedule` route policy verbatim. */
const CFBD_RETRY_POLICY = {
  maxAttempts: 3,
  baseDelayMs: 250,
  maxDelayMs: 2_000,
  jitterRatio: 0.2,
  retryOnHttpStatuses: [408, 425, 429, 500, 502, 503, 504],
} as const;

/** Shared CFBD pacing key — serializes with every other CFBD caller. */
const CFBD_PACING_POLICY = {
  key: 'cfbd',
  minIntervalMs: 150,
} as const;

export type FullSeasonSchedulePartitionFetchOutcome =
  | {
      kind: 'rows';
      seasonType: SeasonType;
      items: ScheduleItem[];
      scoreCandidates: FinalScoreSweepCandidate[];
    }
  | { kind: 'fetch-failed'; seasonType: SeasonType }
  | { kind: 'invalid-payload'; seasonType: SeasonType }
  | { kind: 'schema-drift'; seasonType: SeasonType };

/**
 * Fetch and normalize one full-year partition, applying the shared
 * complete-before-commit classification. Complete finals are also normalized
 * across the wire-only score seam; points never enter ScheduleItem.
 */
export async function fetchFullSeasonSchedulePartition(params: {
  year: number;
  seasonType: SeasonType;
  apiKey: string;
}): Promise<FullSeasonSchedulePartitionFetchOutcome> {
  const { year, seasonType, apiKey } = params;
  const url = buildCfbdGamesUrl({ year, seasonType, week: null });

  let upstream: CfbdScheduleGame[];
  try {
    upstream = await fetchUpstreamJson<CfbdScheduleGame[]>(url.toString(), {
      cache: 'no-store',
      timeoutMs: 12_000,
      headers: { Authorization: `Bearer ${apiKey}` },
      retry: CFBD_RETRY_POLICY,
      pacing: CFBD_PACING_POLICY,
    });
  } catch {
    return { kind: 'fetch-failed', seasonType };
  }

  if (!Array.isArray(upstream)) {
    return { kind: 'invalid-payload', seasonType };
  }

  const items: ScheduleItem[] = [];
  for (const game of upstream) {
    const mapped = mapCfbdScheduleGame(game, seasonType);
    if (mapped.ok) items.push(mapped.item);
  }

  // A nonempty provider payload that normalizes to zero rows is uncertainty,
  // not valid absence. An exact empty array remains valid partition absence.
  if (upstream.length > 0 && items.length === 0) {
    return { kind: 'schema-drift', seasonType };
  }

  return {
    kind: 'rows',
    seasonType,
    items,
    scoreCandidates: finalScoreCandidatesFromSchedulePayload(upstream, seasonType),
  };
}

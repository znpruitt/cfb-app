/**
 * Server-side rankings cache reading + provider-payload normalization.
 *
 * PLATFORM-086E2A separation: this module is strictly CACHE-ONLY. It never
 * contacts CFBD — `loadSeasonRankings` serves the process memo and the durable
 * `rankings/<year>` snapshot, and every provider fetch/validation/commit lives in
 * the shared refresh authority (`src/lib/rankings/refreshAuthority.ts`), which is
 * the ONE writer for both the authorized manual route and the future
 * PLATFORM-086E2B automatic caller.
 *
 * Freshness model (PLATFORM-086E2A):
 *   - The process memo is a cross-instance VISIBILITY bound, not a data-staleness
 *     judgment: a reader may trust its in-process copy for at most 120 seconds
 *     before forcing a durable re-read, so another instance's committed refresh
 *     becomes visible within that bound.
 *   - Rankings DATA staleness is the weekly-cadence horizon shared with the
 *     provider descriptor (8 days): younger snapshots serve clean; older ones
 *     remain prior-good fallback but carry `meta.stale`/`meta.rebuildRequired`.
 *   - Neither horizon ever authorizes a public read to contact the provider.
 */

import { createTeamIdentityResolver } from '../teamIdentity.ts';
import {
  normalizePollSource,
  selectPrimaryRankSource,
  type CanonicalPollEntry,
  type CanonicalRankedTeam,
  type RankSource,
  getDefaultRankingsSeason,
  type RankingsResponse,
  type RankingsWeek,
} from '../rankings.ts';
import { getProviderDatasetDescriptor } from '../providerDatasets.ts';
import { getAppState } from './appStateStore.ts';

export type CfbdPollRank = {
  rank: number | null;
  school: string;
  conference: string | null;
};

export type CfbdPoll = {
  poll: string;
  ranks: CfbdPollRank[];
};

export type CfbdPollWeek = {
  season: number;
  seasonType: string;
  week: number;
  polls: CfbdPoll[];
};

/** One durable/process-cached rankings snapshot: observation instant + payload. */
export type RankingsCacheEntry = {
  /** Observation instant (epoch ms) captured immediately before provider work. */
  at: number;
  response: RankingsResponse;
};

/**
 * Process-memo lifetime: how long one instance may trust its in-process copy
 * before forcing a durable re-read (cross-instance visibility bound). This is
 * NOT a data-staleness judgment — see `RANKINGS_STALE_AFTER_MS`.
 */
export const RANKINGS_MEMO_TTL_MS = 120 * 1000;

/**
 * Rankings DATA staleness horizon — weekly-cadence data with an 8-day allowance,
 * sourced from the shared provider descriptor so diagnostics and serving truth
 * cannot drift apart.
 */
export const RANKINGS_STALE_AFTER_MS = getProviderDatasetDescriptor('rankings').staleAfterMs;

const CACHE = new Map<number, { entry: RankingsCacheEntry; memoizedAtMs: number }>();

function compareWeek(a: RankingsWeek, b: RankingsWeek): number {
  if (a.season !== b.season) return a.season - b.season;
  if (a.week !== b.week) return a.week - b.week;
  const seasonTypeOrder = (value: string) => (value === 'postseason' ? 1 : 0);
  return seasonTypeOrder(a.seasonType) - seasonTypeOrder(b.seasonType);
}

/** Stable week ordering shared by normalization and the refresh authority. */
export function compareRankingsWeeks(a: RankingsWeek, b: RankingsWeek): number {
  return compareWeek(a, b);
}

function toCanonicalPollEntries(
  entries: CfbdPollRank[],
  source: RankSource,
  resolver: ReturnType<typeof createTeamIdentityResolver>
): CanonicalPollEntry[] {
  const seen = new Set<string>();
  const rankedEntries: CanonicalPollEntry[] = [];

  for (const entry of entries) {
    if (!entry.school || entry.rank == null) continue;
    const resolution = resolver.resolveName(entry.school);
    if (resolution.status !== 'resolved' || !resolution.identityKey || !resolution.canonicalName) {
      continue;
    }
    if (seen.has(resolution.identityKey)) continue;
    seen.add(resolution.identityKey);
    rankedEntries.push({
      teamId: resolution.identityKey,
      teamName: resolution.canonicalName,
      rank: entry.rank,
      rankSource: source,
    });
  }

  return rankedEntries.sort((a, b) => a.rank - b.rank || a.teamName.localeCompare(b.teamName));
}

function mergeWeekRankings(params: {
  week: CfbdPollWeek;
  resolver: ReturnType<typeof createTeamIdentityResolver>;
}): RankingsWeek | null {
  const { week, resolver } = params;
  const polls: Record<RankSource, CanonicalPollEntry[]> = {
    cfp: [],
    ap: [],
    coaches: [],
  };

  for (const poll of week.polls ?? []) {
    const source = normalizePollSource(poll.poll);
    if (!source) continue;
    polls[source] = toCanonicalPollEntries(poll.ranks ?? [], source, resolver);
  }

  const primarySource = selectPrimaryRankSource(polls);
  const teamMap = new Map<string, CanonicalRankedTeam>();

  for (const source of ['cfp', 'ap', 'coaches'] as const) {
    for (const entry of polls[source]) {
      const existing = teamMap.get(entry.teamId);
      const isPrimary = source === primarySource;
      teamMap.set(entry.teamId, {
        teamId: entry.teamId,
        teamName: entry.teamName,
        rank: entry.rank,
        rankSource: entry.rankSource,
        primaryRank: existing?.primaryRank ?? (isPrimary ? entry.rank : null),
        primaryRankSource: existing?.primaryRankSource ?? (isPrimary ? source : null),
      });
    }
  }

  const teams = Array.from(teamMap.values()).sort((a, b) => {
    const aRank = a.primaryRank ?? Number.POSITIVE_INFINITY;
    const bRank = b.primaryRank ?? Number.POSITIVE_INFINITY;
    if (aRank !== bRank) return aRank - bRank;
    return a.teamName.localeCompare(b.teamName);
  });

  if (!primarySource && teams.length === 0) return null;

  return {
    season: week.season,
    week: week.week,
    seasonType: week.seasonType,
    primarySource,
    teams,
    polls,
  };
}

export const POSTSEASON_SYNTHETIC_WEEK = 999;

/**
 * Collapse the postseason partition to ONE synthetic final-poll week (the highest
 * CFBD postseason week), keyed at `POSTSEASON_SYNTHETIC_WEEK` — the canonical
 * final-poll representation every rankings surface consumes.
 */
export function remapPostseasonWeeks(weeks: RankingsWeek[]): RankingsWeek[] {
  const regular = weeks.filter((w) => w.seasonType !== 'postseason');
  const postseason = weeks
    .filter((w) => w.seasonType === 'postseason')
    .sort((a, b) => a.week - b.week);

  if (postseason.length === 0) return regular;

  // Keep only the latest postseason entry (highest CFBD week = final poll).
  const finalPoll = postseason[postseason.length - 1]!;
  const remapped: RankingsWeek = {
    ...finalPoll,
    week: POSTSEASON_SYNTHETIC_WEEK,
    label: 'Final Poll',
  };

  return [...regular, remapped].sort(compareWeek);
}

export function normalizeCfbdRankingsWeeks(
  data: CfbdPollWeek[],
  resolver: ReturnType<typeof createTeamIdentityResolver>
): RankingsWeek[] {
  return (data ?? [])
    .map((week) => mergeWeekRankings({ week, resolver }))
    .filter((week): week is RankingsWeek => Boolean(week))
    .sort(compareWeek);
}

export type RankingsPartition = 'regular' | 'postseason';
export type RankingsPartitionKind = 'usable' | 'schema-drift' | 'valid-empty';

/**
 * Classify a SINGLE rankings partition from its raw provider payload and its
 * normalized weeks, WITHOUT reference to the other partition (6th-review finding
 * #1). A nonempty raw payload that normalizes to zero usable weeks is schema
 * drift — valid absence is inferred from an EMPTY raw payload, never solely from
 * "normalization produced zero rows" — so one healthy partition can never mask a
 * drifted one, and a drifted partition is never mistaken for a valid no-op.
 */
export function classifyRankingsPartition(
  partition: RankingsPartition,
  raw: CfbdPollWeek[],
  normalized: RankingsWeek[]
): { partition: RankingsPartition; kind: RankingsPartitionKind } {
  if (normalized.length > 0) return { partition, kind: 'usable' };
  return { partition, kind: raw.length > 0 ? 'schema-drift' : 'valid-empty' };
}

/** A stored value is a usable cache entry only when it carries a real response. */
export function normalizeStoredRankingsEntry(value: unknown): RankingsCacheEntry | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<RankingsCacheEntry>;
  if (typeof candidate.at !== 'number' || !Number.isFinite(candidate.at)) return null;
  const response = candidate.response as Partial<RankingsResponse> | undefined;
  if (!response || typeof response !== 'object') return null;
  if (!Array.isArray(response.weeks)) return null;
  return { at: candidate.at, response: response as RankingsResponse };
}

/**
 * Build the served payload for one cache entry: `cache: 'hit'`, with the
 * stale/rebuild markers applied ONLY past the 8-day data horizon — never merely
 * because the snapshot outlived the 120-second process memo.
 */
export function serveRankingsEntry(entry: RankingsCacheEntry, nowMs: number): RankingsResponse {
  const stale = nowMs - entry.at >= RANKINGS_STALE_AFTER_MS;
  return {
    ...entry.response,
    meta: {
      source: entry.response.meta?.source ?? 'cfbd',
      cache: 'hit',
      generatedAt: entry.response.meta?.generatedAt ?? new Date(entry.at).toISOString(),
      ...(stale ? { stale: true, rebuildRequired: true } : {}),
    },
  };
}

/**
 * Publish a confirmed durable entry into the process memo. Called by the refresh
 * authority ONLY after its transaction commit, and by the cache reader when it
 * re-reads durable state.
 */
export function publishRankingsProcessMemo(season: number, entry: RankingsCacheEntry): void {
  CACHE.set(season, { entry, memoizedAtMs: Date.now() });
}

/** The current memoized entry regardless of memo TTL (visibility comparisons). */
export function peekRankingsProcessMemo(season: number): RankingsCacheEntry | null {
  return CACHE.get(season)?.entry ?? null;
}

/**
 * Strictly cache-only rankings read: process memo (≤120s) → durable snapshot →
 * newest available entry. NEVER contacts CFBD. With nothing cached anywhere it
 * throws the established `admin refresh required` error (the route maps it to
 * HTTP 503) — a public cache miss is provider-free by construction.
 */
export async function loadSeasonRankings(
  season = getDefaultRankingsSeason(null)
): Promise<RankingsResponse> {
  const now = Date.now();
  const memo = CACHE.get(season);
  if (memo && now - memo.memoizedAtMs < RANKINGS_MEMO_TTL_MS) {
    return serveRankingsEntry(memo.entry, now);
  }

  // Memo absent or past its visibility bound — force a durable read so another
  // instance's committed refresh becomes visible within 120 seconds.
  const stored = normalizeStoredRankingsEntry(
    (await getAppState<unknown>('rankings', String(season)))?.value
  );

  const candidates = [memo?.entry ?? null, stored].filter(
    (entry): entry is RankingsCacheEntry => entry !== null
  );
  const newest = candidates.sort((a, b) => b.at - a.at)[0] ?? null;
  if (newest) {
    CACHE.set(season, { entry: newest, memoizedAtMs: now });
    return serveRankingsEntry(newest, now);
  }

  throw new Error(
    'rankings cache miss: admin refresh required (retry with bypassCache=1 and admin token)'
  );
}

export function __resetSeasonRankingsCacheForTests(): void {
  CACHE.clear();
}

export function __setSeasonRankingsCacheForTests(
  season: number,
  entry: RankingsCacheEntry,
  opts?: { memoizedAtMs?: number }
): void {
  CACHE.set(season, { entry, memoizedAtMs: opts?.memoizedAtMs ?? Date.now() });
}

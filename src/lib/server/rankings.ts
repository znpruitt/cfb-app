import teamsCatalog from '../../data/teams.json';
import { buildCfbdRankingsUrl } from '../cfbd.ts';
import { fetchUpstreamJson } from '../api/fetchUpstream.ts';
import { createTeamIdentityResolver, type TeamCatalogItem } from '../teamIdentity.ts';
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
import { SEED_ALIASES } from '../teamNames.ts';
import { getAppState, setAppState } from './appStateStore.ts';
import {
  beginProviderRefreshAttempt,
  nextProviderCommitSeq,
  recordProviderRefreshFailure,
  recordProviderRefreshNoop,
  recordProviderRefreshSuccess,
} from './providerRefreshStatus.ts';

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

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE = new Map<number, { at: number; response: RankingsResponse }>();
const CFBD_RETRY_POLICY = {
  maxAttempts: 3,
  baseDelayMs: 250,
  maxDelayMs: 2_000,
  jitterRatio: 0.2,
  retryOnHttpStatuses: [408, 425, 429, 500, 502, 503, 504],
} as const;
const CFBD_PACING_POLICY = {
  key: 'cfbd',
  minIntervalMs: 150,
} as const;

function compareWeek(a: RankingsWeek, b: RankingsWeek): number {
  if (a.season !== b.season) return a.season - b.season;
  if (a.week !== b.week) return a.week - b.week;
  const seasonTypeOrder = (value: string) => (value === 'postseason' ? 1 : 0);
  return seasonTypeOrder(a.seasonType) - seasonTypeOrder(b.seasonType);
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

const POSTSEASON_SYNTHETIC_WEEK = 999;

function remapPostseasonWeeks(weeks: RankingsWeek[]): RankingsWeek[] {
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

type RankingsPartition = 'regular' | 'postseason';
type RankingsPartitionKind = 'usable' | 'schema-drift' | 'valid-empty';

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

export async function loadSeasonRankings(
  season = getDefaultRankingsSeason(null),
  options?: { allowRefresh?: boolean }
): Promise<RankingsResponse> {
  const allowRefresh = options?.allowRefresh ?? false;
  const cached = CACHE.get(season);
  const now = Date.now();
  if (!allowRefresh && cached && now - cached.at < CACHE_TTL_MS) {
    return {
      ...cached.response,
      meta: {
        ...cached.response.meta,
        cache: 'hit',
      },
    };
  }

  const stored = await getAppState<{ at: number; response: RankingsResponse }>(
    'rankings',
    String(season)
  );
  if (!allowRefresh && stored?.value && now - stored.value.at < CACHE_TTL_MS) {
    CACHE.set(season, stored.value);
    return {
      ...stored.value.response,
      meta: {
        ...stored.value.response.meta,
        cache: 'hit',
      },
    };
  }

  if (!allowRefresh) {
    const staleCandidates = [cached, stored?.value].filter(
      (entry): entry is NonNullable<typeof entry> => Boolean(entry)
    );
    const stale = staleCandidates.sort((a, b) => b.at - a.at)[0] ?? null;
    if (stale) {
      return {
        ...stale.response,
        meta: {
          ...stale.response.meta,
          cache: 'hit',
          stale: true,
          rebuildRequired: true,
        },
      };
    }
    throw new Error(
      'rankings cache miss: admin refresh required (retry with bypassCache=1 and admin token)'
    );
  }

  // Provider-refresh observability (PLATFORM-086A): only the allowRefresh path
  // reaches here (cache-only reads returned above), so this is a real refresh.
  // Begin BEFORE credential validation so a missing-key early exit still resolves
  // a recorded failed attempt (rereview finding #5).
  const attempt = await beginProviderRefreshAttempt('rankings', {
    startedAt: new Date(now).toISOString(),
  });

  const cfbdApiKey = process.env.CFBD_API_KEY?.trim() ?? '';
  if (!cfbdApiKey) {
    await recordProviderRefreshFailure('rankings', {
      attempt,
      error: 'CFBD_API_KEY missing',
      code: 'cfbd-api-key-missing',
      durationMs: Date.now() - now,
    });
    throw new Error('CFBD_API_KEY missing');
  }

  try {
    const resolver = createTeamIdentityResolver({
      aliasMap: SEED_ALIASES,
      teams: (teamsCatalog.items ?? []) as TeamCatalogItem[],
    });
    const fetchOpts = {
      cache: 'no-store' as const,
      timeoutMs: 12_000,
      headers: { Authorization: `Bearer ${cfbdApiKey}` },
      retry: CFBD_RETRY_POLICY,
      pacing: CFBD_PACING_POLICY,
    };

    const [regularData, postseasonData] = await Promise.all([
      fetchUpstreamJson<CfbdPollWeek[]>(
        buildCfbdRankingsUrl({ year: season, seasonType: 'regular' }).toString(),
        fetchOpts
      ),
      fetchUpstreamJson<CfbdPollWeek[]>(
        buildCfbdRankingsUrl({ year: season, seasonType: 'postseason' }).toString(),
        fetchOpts
      ),
    ]);

    // Validate EACH partition independently BEFORE combining (6th-review finding
    // #1). A nonempty raw payload that normalizes to zero usable weeks is schema
    // drift; it must NOT be masked by usable content from the other partition, and
    // must NOT be mistaken for a valid no-op just because normalization produced
    // zero rows. Valid absence is inferred from an EMPTY raw payload only.
    const regularNormalized = normalizeCfbdRankingsWeeks(regularData ?? [], resolver);
    const postseasonNormalized = normalizeCfbdRankingsWeeks(postseasonData ?? [], resolver);
    const partitionClasses = [
      classifyRankingsPartition('regular', regularData ?? [], regularNormalized),
      classifyRankingsPartition('postseason', postseasonData ?? [], postseasonNormalized),
    ];
    const driftedPartitions = partitionClasses
      .filter((p) => p.kind === 'schema-drift')
      .map((p) => p.partition);

    if (driftedPartitions.length > 0) {
      // ≥1 applicable partition drifted → reject the AGGREGATE refresh. Never commit
      // a silently-incomplete snapshot as success, and never advance last-success.
      // Retain prior-good (serve it stale) when available; otherwise surface the
      // drift as a hard failure so the empty replacement cannot pass unnoticed.
      await recordProviderRefreshFailure('rankings', {
        attempt,
        error: `rankings partition(s) ${driftedPartitions.join(', ')} returned a nonempty payload that normalized to zero usable weeks (schema drift)`,
        code: 'rankings-partition-schema-drift',
        partialFailure: partitionClasses.some((p) => p.kind === 'usable'),
        failedPartitions: driftedPartitions,
        durationMs: Date.now() - now,
      });
      const prior = stored?.value ?? cached ?? null;
      if (prior) {
        return {
          ...prior.response,
          meta: { ...prior.response.meta, cache: 'hit', stale: true, rebuildRequired: true },
        };
      }
      throw new Error(
        `rankings refresh failed: partition schema drift (${driftedPartitions.join(', ')})`
      );
    }

    // No drift. Combine the usable/valid-empty partitions and remap postseason.
    const weeks = remapPostseasonWeeks(
      [...regularNormalized, ...postseasonNormalized].sort(compareWeek)
    );

    if (weeks.length === 0) {
      // Both partitions were raw-EMPTY (no drift above). Valid absence must not be
      // inferred solely from zero rows — a genuinely empty payload is a valid no-op
      // ONLY when rankings are not expected yet. Prior-good populated rankings are
      // the "expected" signal: an empty response OVER them is an unexpected empty
      // replacement (failure, retain prior-good), while an empty response with no
      // prior-good is a pre-poll no-op.
      const priorPopulated =
        (stored?.value?.response?.weeks?.length ?? 0) > 0 ||
        (cached?.response?.weeks?.length ?? 0) > 0;
      if (priorPopulated) {
        await recordProviderRefreshFailure('rankings', {
          attempt,
          error: 'rankings refresh returned zero usable weeks while prior-good rankings are cached',
          code: 'rankings-empty-replacement-rejected',
          durationMs: Date.now() - now,
        });
        const prior = stored?.value ?? cached!;
        return {
          ...prior.response,
          meta: { ...prior.response.meta, cache: 'hit', stale: true, rebuildRequired: true },
        };
      }
      // Genuinely empty pre-poll data → no-op: no durable write, prior-good (absent
      // here) preserved, last-success not advanced. A CLEAN empty response (no stale
      // markers) so the manual panel reads it as a successful no-op, not a fallback.
      await recordProviderRefreshNoop('rankings', {
        attempt,
        source: 'cfbd',
        durationMs: Date.now() - now,
      });
      return {
        weeks: [],
        latestWeek: null,
        meta: {
          source: 'cfbd',
          cache: 'miss',
          generatedAt: new Date(now).toISOString(),
        },
      };
    }

    const response: RankingsResponse = {
      weeks,
      latestWeek: weeks.at(-1) ?? null,
      meta: {
        source: 'cfbd',
        cache: 'miss',
        generatedAt: new Date(now).toISOString(),
      },
    };

    const cacheEntry = { at: now, response };
    // Durable-first commit order (PLATFORM-085A): persist the rankings snapshot
    // BEFORE publishing it to the process cache, so a failed durable write can't
    // leave this instance serving "fresh" rankings that no other instance can
    // durably reproduce. A setAppState throw propagates, skipping the CACHE update.
    await setAppState('rankings', String(season), cacheEntry);
    // Durable commit time + sequence for success ordering (rereview findings #3/#6).
    const committedAt = new Date().toISOString();
    const commitSeq = nextProviderCommitSeq();
    CACHE.set(season, cacheEntry);

    await recordProviderRefreshSuccess('rankings', {
      attempt,
      committedAt,
      commitSeq,
      source: 'cfbd',
      rowsCommitted: weeks.length,
      durationMs: Date.now() - now,
    });
    return response;
  } catch (error) {
    await recordProviderRefreshFailure('rankings', {
      attempt,
      error: error instanceof Error ? error.message : 'rankings refresh failed',
      durationMs: Date.now() - now,
    });
    throw error;
  }
}

export function __resetSeasonRankingsCacheForTests(): void {
  CACHE.clear();
}

export function __setSeasonRankingsCacheForTests(
  season: number,
  entry: { at: number; response: RankingsResponse }
): void {
  CACHE.set(season, entry);
}

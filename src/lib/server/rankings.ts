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

export function normalizeCfbdRankingsWeeks(
  data: CfbdPollWeek[],
  resolver: ReturnType<typeof createTeamIdentityResolver>
): RankingsWeek[] {
  return (data ?? [])
    .map((week) => mergeWeekRankings({ week, resolver }))
    .filter((week): week is RankingsWeek => Boolean(week))
    .sort(compareWeek);
}

export async function loadSeasonRankings(
  season = getDefaultRankingsSeason(null)
): Promise<RankingsResponse> {
  const cached = CACHE.get(season);
  const now = Date.now();
  if (cached && now - cached.at < CACHE_TTL_MS) {
    return {
      ...cached.response,
      meta: {
        ...cached.response.meta,
        cache: 'hit',
      },
    };
  }

  const cfbdApiKey = process.env.CFBD_API_KEY?.trim() ?? '';
  if (!cfbdApiKey) {
    throw new Error('CFBD_API_KEY missing');
  }

  const resolver = createTeamIdentityResolver({
    aliasMap: SEED_ALIASES,
    teams: (teamsCatalog.items ?? []) as TeamCatalogItem[],
  });
  const url = buildCfbdRankingsUrl({ year: season });
  const data = await fetchUpstreamJson<CfbdPollWeek[]>(url.toString(), {
    cache: 'no-store',
    timeoutMs: 12_000,
    headers: { Authorization: `Bearer ${cfbdApiKey}` },
    retry: CFBD_RETRY_POLICY,
    pacing: CFBD_PACING_POLICY,
  });

  const weeks = normalizeCfbdRankingsWeeks(data ?? [], resolver);

  const response: RankingsResponse = {
    weeks,
    latestWeek: weeks.at(-1) ?? null,
    meta: {
      source: 'cfbd',
      cache: 'miss',
      generatedAt: new Date(now).toISOString(),
    },
  };

  CACHE.set(season, { at: now, response });
  return response;
}

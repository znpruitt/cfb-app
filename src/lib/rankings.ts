import { seasonYearForToday } from './scores/normalizers.ts';
import { toTeamIdentityKey } from './teamIdentity.ts';
import { requireAdminAuthHeaders } from './adminAuth.ts';

export type RankSource = 'cfp' | 'ap' | 'coaches';

export type TeamRankingEnrichment = {
  rank: number | null;
  rankSource: RankSource | null;
};

export type CanonicalPollEntry = {
  teamId: string;
  teamName: string;
  rank: number;
  rankSource: RankSource;
};

export type CanonicalRankedTeam = CanonicalPollEntry & {
  primaryRank: number | null;
  primaryRankSource: RankSource | null;
};

export type RankingsWeek = {
  season: number;
  week: number;
  seasonType: string;
  primarySource: RankSource | null;
  teams: CanonicalRankedTeam[];
  polls: Record<RankSource, CanonicalPollEntry[]>;
};

export type RankingsResponse = {
  weeks: RankingsWeek[];
  latestWeek: RankingsWeek | null;
  meta: {
    source: 'cfbd';
    cache: 'hit' | 'miss';
    generatedAt: string;
    stale?: boolean;
    rebuildRequired?: boolean;
  };
};

const RANK_SOURCE_PRECEDENCE: RankSource[] = ['cfp', 'ap', 'coaches'];

export function rankSourceLabel(source: RankSource): string {
  if (source === 'cfp') return 'CFP';
  if (source === 'ap') return 'AP';
  return 'Coaches';
}

export function normalizePollSource(rawPoll: string): RankSource | null {
  const poll = rawPoll.trim().toLowerCase();
  if (!poll) return null;
  if (poll.includes('playoff')) return 'cfp';
  if (poll === 'ap top 25' || poll.includes('associated press') || poll.startsWith('ap')) {
    return 'ap';
  }
  if (poll.includes('coaches') || poll.includes('usa today')) return 'coaches';
  return null;
}

export function selectPrimaryRankSource(
  polls: Partial<Record<RankSource, CanonicalPollEntry[]>>
): RankSource | null {
  for (const source of RANK_SOURCE_PRECEDENCE) {
    if ((polls[source] ?? []).length > 0) return source;
  }
  return null;
}

export function buildRankingsLookup(
  week: RankingsWeek | null | undefined
): Map<string, TeamRankingEnrichment> {
  const lookup = new Map<string, TeamRankingEnrichment>();
  if (!week) return lookup;

  for (const team of week.teams) {
    lookup.set(team.teamId, {
      rank: team.primaryRank,
      rankSource: team.primaryRankSource,
    });
  }

  return lookup;
}

export function getTeamRanking(
  lookup: Map<string, TeamRankingEnrichment>,
  teamIdOrName: string | null | undefined
): TeamRankingEnrichment {
  if (!teamIdOrName) return { rank: null, rankSource: null };

  const exact = lookup.get(teamIdOrName);
  if (exact) return exact;

  const normalized = toTeamIdentityKey(teamIdOrName);
  return lookup.get(normalized) ?? { rank: null, rankSource: null };
}

export function selectRankingsWeek(params: {
  rankings: RankingsResponse | null;
  selectedWeek: number | null;
  selectedTab: number | 'postseason' | null;
}): RankingsWeek | null {
  const { rankings, selectedWeek, selectedTab } = params;
  if (!rankings) return null;
  if (selectedTab === 'postseason') return rankings.latestWeek;
  if (selectedWeek == null) return null;

  const matchingWeeks = rankings.weeks.filter((week) => week.week === selectedWeek);
  return matchingWeeks.at(-1) ?? null;
}

export function getDefaultRankingsSeason(explicitSeason?: number | null, now = new Date()): number {
  return Number.isInteger(explicitSeason) && (explicitSeason ?? 0) > 0
    ? (explicitSeason as number)
    : seasonYearForToday(now);
}

export async function fetchSeasonRankings(
  season: number,
  options?: { bypassCache?: boolean }
): Promise<RankingsResponse> {
  const search = new URLSearchParams({ year: String(season) });
  if (options?.bypassCache) search.set('bypassCache', '1');

  const response = await fetch(`/api/rankings?${search.toString()}`, {
    cache: 'no-store',
    headers: options?.bypassCache ? requireAdminAuthHeaders() : undefined,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`rankings ${response.status} ${detail}`);
  }

  return (await response.json()) as RankingsResponse;
}

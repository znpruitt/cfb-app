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
  label?: string;
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

/**
 * CFBD serves exactly six poll names, and only three of them are FBS.
 *
 * Measured 2026-08-18 by querying the provider for 2014, 2015, 2016, 2019,
 * 2021, 2023, 2024, 2025 and 2026 — the same six names in every season, with no
 * variants:
 *
 * | Accepted                     | Rejected                         |
 * | ---------------------------- | -------------------------------- |
 * | `AP Top 25`                  | `FCS Coaches Poll`               |
 * | `Coaches Poll`               | `AFCA Division II Coaches Poll`  |
 * | `Playoff Committee Rankings` | `AFCA Division III Coaches Poll` |
 *
 * Substring matching is what broke this. `includes('coaches')` claimed all
 * three rejected polls for the `coaches` column, and every season since 2014
 * has published at least one of them. Matching is therefore EXACT and fails
 * CLOSED: an unrecognised poll returns null and its column renders "Not
 * available" rather than silently showing another division's rankings.
 *
 * `College Football Playoff Rankings` was previously mapped to `cfp` and is NOT
 * kept: it appears in none of the nine seasons sampled above. Restoring a name
 * on the theory that the provider might use it is what made the old matcher
 * loose enough to fail.
 */
// A Map, not an object literal: a plain object's lookup walks Object.prototype,
// so `POLL_SOURCE_BY_EXACT_NAME['constructor']` returned a truthy non-RankSource
// and passed the caller's `if (!source)` guard, writing a junk key into the
// durable snapshot (`/code-review`, 2026-08-19). Lowercasing accidentally masked
// `toString`/`valueOf`, which is the only reason the blast radius was small.
// CFBD will not serve such a name, but this function documents that it fails
// closed, and for two inputs it did not.
const POLL_SOURCE_BY_EXACT_NAME = new Map<string, RankSource>([
  ['ap top 25', 'ap'],
  ['coaches poll', 'coaches'],
  ['playoff committee rankings', 'cfp'],
]);

/** Names CFBD serves that must never enter an FBS poll column. */
export const NON_FBS_POLL_NAMES = [
  'FCS Coaches Poll',
  'AFCA Division II Coaches Poll',
  'AFCA Division III Coaches Poll',
] as const;

/**
 * The single normalization both the matcher and its callers must use. Round one
 * compared a RAW provider name against `NON_FBS_POLL_NAMES` while matching
 * trimmed-and-lowercased, so the two halves of one decision disagreed on what
 * counted as the same name (`/code-review`, 2026-08-19).
 */
export function normalizePollName(rawPoll: string): string {
  return rawPoll.trim().toLowerCase();
}

const NON_FBS_POLL_NAME_KEYS = new Set(NON_FBS_POLL_NAMES.map(normalizePollName));

/** True for a poll CFBD serves that is knowingly not FBS — a refusal we expect. */
export function isKnownNonFbsPoll(rawPoll: string): boolean {
  return NON_FBS_POLL_NAME_KEYS.has(normalizePollName(rawPoll));
}

export function normalizePollSource(rawPoll: string): RankSource | null {
  return POLL_SOURCE_BY_EXACT_NAME.get(normalizePollName(rawPoll)) ?? null;
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

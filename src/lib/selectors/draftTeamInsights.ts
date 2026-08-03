import type { AppGame } from '@/lib/schedule';
import type { ScorePack } from '@/lib/scores';
import type { TeamCatalogItem } from '@/lib/teamIdentity';
import { getDraftEligibleTeams } from '@/lib/draft';

// ---------------------------------------------------------------------------
// Input types
//
// PLATFORM-086F2G1 retired SP+ ratings and win totals as draft inputs: they made
// team selection artificially easy and silently drove available-team ordering.
// The selector now derives only neutral factual context (identity, conference,
// colors, schedule shape, prior-season record, preseason AP rank, ranked
// opponents) and produces a recommendation-free ordering.
// ---------------------------------------------------------------------------

export type ApPollEntry = {
  teamName: string;
  rank: number;
};

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export type DraftTeamInsights = {
  teamId: string;
  teamName: string;
  conference: string | null;
  teamColor: string | null;
  lastSeasonRecord: { wins: number; losses: number } | null;
  preseasonRank: number | null;
  homeGames: number;
  awayGames: number;
  neutralGames: number;
  rankedOpponentCount: number;
  /** Shortest available display name: shortDisplayName → abbreviation → teamName. */
  shortName: string;
};

// ---------------------------------------------------------------------------
// Neutral ordering
//
// One deterministic, recommendation-free order shared by the commissioner and
// spectator boards: locale-aware alphabetical by display name, then a stable
// canonical team-id tie-break (code-point comparison, locale-independent). No
// rating, betting, projection, ownership, or market signal participates.
// ---------------------------------------------------------------------------

export function compareDraftInsightsAlphabetical(
  a: DraftTeamInsights,
  b: DraftTeamInsights
): number {
  const byName = a.teamName.localeCompare(b.teamName);
  if (byName !== 0) return byName;
  if (a.teamId < b.teamId) return -1;
  if (a.teamId > b.teamId) return 1;
  return 0;
}

// ---------------------------------------------------------------------------
// Conference color map — used as team color source since TeamCatalogItem.color
// is not populated in the static teams.json catalog. Each conference gets a
// distinct hue so the draft board provides meaningful visual grouping.
// ---------------------------------------------------------------------------

const CONFERENCE_COLORS: Record<string, string> = {
  SEC: '#2563EB', // blue-600
  'Big Ten': '#16A34A', // green-600
  ACC: '#DC2626', // red-600
  'Big 12': '#D97706', // amber-600
  'Pac-12': '#9333EA', // purple-600
  'Mountain West': '#7C3AED', // violet-600
  'Sun Belt': '#0891B2', // cyan-600
  'American Athletic': '#EA580C', // orange-600
  'Mid-American': '#B45309', // amber-700
  'Conference USA': '#0D9488', // teal-600
  'FBS Independents': '#6B7280', // gray-500
};

const CONFERENCE_COLOR_FALLBACK = '#6B7280'; // gray-500

function conferenceColor(conference: string | null | undefined): string {
  if (!conference) return CONFERENCE_COLOR_FALLBACK;
  return CONFERENCE_COLORS[conference] ?? CONFERENCE_COLOR_FALLBACK;
}

// ---------------------------------------------------------------------------
// Main selector
// ---------------------------------------------------------------------------

export function selectDraftTeamInsights(params: {
  teams: TeamCatalogItem[];
  schedule: AppGame[];
  apPoll: ApPollEntry[] | null;
  year: number;
  /** Completed games from year - 1 for last season record derivation. Optional — field is null when absent. */
  priorYearGames?: AppGame[];
  /** Scores keyed by game.key for priorYearGames. Must be provided alongside priorYearGames. */
  priorYearScoresByKey?: Record<string, ScorePack>;
}): DraftTeamInsights[] {
  const { teams, schedule, apPoll, priorYearGames, priorYearScoresByKey } = params;

  // Build provider name → canonical school name lookup using teams catalog (school + alts).
  // External providers (AP poll) use their own team name variants; this resolves
  // them to the canonical school name so lookup maps key on the same values as team.school.
  const providerToCanonical = new Map<string, string>();
  for (const team of teams) {
    providerToCanonical.set(team.school.toLowerCase(), team.school);
    for (const alt of team.alts ?? []) {
      if (!providerToCanonical.has(alt)) {
        providerToCanonical.set(alt, team.school);
      }
    }
  }
  const resolveProviderName = (name: string): string =>
    providerToCanonical.get(name.toLowerCase()) ?? name;

  const apRankByName = new Map<string, number>();
  if (apPoll) {
    for (const entry of apPoll) {
      apRankByName.set(resolveProviderName(entry.teamName).toLowerCase(), entry.rank);
    }
  }

  // Build prior year win/loss records from completed games + scores
  const priorYearRecordBySchool = new Map<string, { wins: number; losses: number }>();
  if (priorYearGames && priorYearScoresByKey) {
    for (const game of priorYearGames) {
      if (game.isPlaceholder) continue;
      const score = priorYearScoresByKey[game.key];
      if (!score) continue;
      const homeScore = score.home.score;
      const awayScore = score.away.score;
      if (homeScore === null || awayScore === null) continue;
      if (!score.status.toLowerCase().includes('final')) continue;

      const homeLower = game.canHome.toLowerCase();
      const awayLower = game.canAway.toLowerCase();
      const homeWon = homeScore > awayScore;

      const homeRec = priorYearRecordBySchool.get(homeLower) ?? { wins: 0, losses: 0 };
      if (homeWon) homeRec.wins++;
      else homeRec.losses++;
      priorYearRecordBySchool.set(homeLower, homeRec);

      const awayRec = priorYearRecordBySchool.get(awayLower) ?? { wins: 0, losses: 0 };
      if (!homeWon) awayRec.wins++;
      else awayRec.losses++;
      priorYearRecordBySchool.set(awayLower, awayRec);
    }
  }

  // Filter to draft-eligible teams (excludes NoClaim)
  const eligibleTeams = getDraftEligibleTeams(teams);

  const insights = eligibleTeams.map((team) => {
    const school = team.school;
    const schoolLower = school.toLowerCase();

    // Preseason rank
    const preseasonRank = apRankByName.get(schoolLower) ?? null;

    // Schedule stats
    let homeGames = 0;
    let awayGames = 0;
    let neutralGames = 0;
    const rankedOpponents = new Set<string>();

    for (const game of schedule) {
      const isHome = game.canHome.toLowerCase() === schoolLower;
      const isAway = game.canAway.toLowerCase() === schoolLower;
      if (!isHome && !isAway) continue;

      if (game.neutral) {
        neutralGames++;
      } else if (isHome) {
        homeGames++;
      } else {
        awayGames++;
      }

      const opponent = isHome ? game.canAway : game.canHome;
      const opRank = apRankByName.get(opponent.toLowerCase());
      if (opRank !== undefined && opRank <= 25) {
        rankedOpponents.add(opponent.toLowerCase());
      }
    }

    const teamName = team.displayName ?? school;
    const shortName = team.shortDisplayName
      ? team.shortDisplayName
      : teamName.length <= 14
        ? teamName
        : (team.abbreviation ?? teamName);

    return {
      teamId: school,
      teamName,
      conference: team.conference ?? null,
      teamColor: team.color ?? conferenceColor(team.conference),
      lastSeasonRecord: priorYearRecordBySchool.get(schoolLower) ?? null,
      preseasonRank,
      homeGames,
      awayGames,
      neutralGames,
      rankedOpponentCount: rankedOpponents.size,
      shortName,
    };
  });

  // Return in the single neutral order so every consumer receives the same,
  // recommendation-free ordering by construction (no per-page re-sort).
  return insights.sort(compareDraftInsightsAlphabetical);
}

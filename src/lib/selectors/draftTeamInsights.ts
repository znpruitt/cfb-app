import type { AppGame } from '@/lib/schedule';
import type { ScorePack } from '@/lib/scores';
import type { TeamCatalogItem } from '@/lib/teamIdentity';

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export type SpRatingEntry = {
  team: string;
  conference: string;
  rating: number | null;
  ranking: number | null;
};

export type WinTotalEntry = {
  school: string;
  winTotalLow: number;
  winTotalHigh: number;
};

export type ApPollEntry = {
  teamName: string;
  rank: number;
};

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export type SpTier = 'Elite' | 'Strong' | 'Average' | 'Weak';
export type SosTier = 'Hard' | 'Medium' | 'Easy';

export type DraftTeamInsights = {
  teamId: string;
  teamName: string;
  conference: string | null;
  spRating: number | null;
  spTier: SpTier | null;
  winTotalLow: number | null;
  winTotalHigh: number | null;
  lastSeasonRecord: { wins: number; losses: number } | null;
  preseasonRank: number | null;
  sosTier: SosTier | null;
  homeGames: number;
  awayGames: number;
  neutralGames: number;
  rankedOpponentCount: number;
  awaitingRatings: boolean;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deriveSpTier(rating: number, sortedRatingsDesc: number[]): SpTier {
  const n = sortedRatingsDesc.length;
  if (n === 0) return 'Average';
  const rank = sortedRatingsDesc.findIndex((r) => r <= rating);
  const pct = rank < 0 ? 1 : rank / n;
  if (pct < 0.25) return 'Elite';
  if (pct < 0.5) return 'Strong';
  if (pct < 0.75) return 'Average';
  return 'Weak';
}

function deriveSosTier(avgOpponentRating: number, sortedAvgRatingsAsc: number[]): SosTier {
  const n = sortedAvgRatingsAsc.length;
  if (n === 0) return 'Medium';
  const rank = sortedAvgRatingsAsc.findIndex((r) => r >= avgOpponentRating);
  const pct = rank < 0 ? 1 : rank / n;
  // bottom 30% easiest = pct < 0.3 in ascending sort
  if (pct < 0.3) return 'Easy';
  if (pct < 0.7) return 'Medium';
  return 'Hard';
}

// ---------------------------------------------------------------------------
// Main selector
// ---------------------------------------------------------------------------

export function selectDraftTeamInsights(params: {
  teams: TeamCatalogItem[];
  spRatings: SpRatingEntry[] | null;
  winTotals: WinTotalEntry[] | null;
  schedule: AppGame[];
  apPoll: ApPollEntry[] | null;
  year: number;
  /** Completed games from year - 1 for last season record derivation. Optional — field is null when absent. */
  priorYearGames?: AppGame[];
  /** Scores keyed by game.key for priorYearGames. Must be provided alongside priorYearGames. */
  priorYearScoresByKey?: Record<string, ScorePack>;
}): DraftTeamInsights[] {
  const { teams, spRatings, winTotals, schedule, apPoll, priorYearGames, priorYearScoresByKey } =
    params;

  const awaitingRatings = !spRatings || spRatings.length === 0;

  // Build lookup maps
  const spByName = new Map<string, SpRatingEntry>();
  if (spRatings) {
    for (const r of spRatings) {
      spByName.set(r.team.toLowerCase(), r);
    }
  }

  const winTotalBySchool = new Map<string, WinTotalEntry>();
  if (winTotals) {
    for (const w of winTotals) {
      winTotalBySchool.set(w.school.toLowerCase(), w);
    }
  }

  const apRankByName = new Map<string, number>();
  if (apPoll) {
    for (const entry of apPoll) {
      apRankByName.set(entry.teamName.toLowerCase(), entry.rank);
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

  // Filter NoClaim
  const eligibleTeams = teams.filter((t) => t.school !== 'NoClaim');

  // Build sorted SP+ ratings for tier derivation
  const validRatings = (spRatings ?? [])
    .map((r) => r.rating)
    .filter((r): r is number => r !== null && Number.isFinite(r))
    .sort((a, b) => b - a); // descending

  // Compute avg opponent SP+ per team for SOS
  const avgOpponentSpBySchool = new Map<string, number | null>();
  for (const team of eligibleTeams) {
    const school = team.school;
    const schoolLower = school.toLowerCase();
    const opponentRatings: number[] = [];

    for (const game of schedule) {
      const isHome = game.canHome.toLowerCase() === schoolLower;
      const isAway = game.canAway.toLowerCase() === schoolLower;
      if (!isHome && !isAway) continue;

      const opponentName = isHome ? game.canAway : game.canHome;
      const opSp = spByName.get(opponentName.toLowerCase());
      if (opSp?.rating != null && Number.isFinite(opSp.rating)) {
        opponentRatings.push(opSp.rating);
      }
    }

    if (opponentRatings.length === 0) {
      avgOpponentSpBySchool.set(schoolLower, null);
    } else {
      const avg = opponentRatings.reduce((s, r) => s + r, 0) / opponentRatings.length;
      avgOpponentSpBySchool.set(schoolLower, avg);
    }
  }

  // Build sorted avg opponent ratings for SOS tier derivation (ascending)
  const validAvgOpRatings = Array.from(avgOpponentSpBySchool.values())
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);

  return eligibleTeams.map((team) => {
    const school = team.school;
    const schoolLower = school.toLowerCase();

    // SP+
    const spEntry = spByName.get(schoolLower);
    const spRating = spEntry?.rating ?? null;
    const spTier =
      spRating !== null && validRatings.length > 0 ? deriveSpTier(spRating, validRatings) : null;

    // Win totals
    const wtEntry = winTotalBySchool.get(schoolLower);
    const winTotalLow = wtEntry?.winTotalLow ?? null;
    const winTotalHigh = wtEntry?.winTotalHigh ?? null;

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

    // SOS tier
    const avgOp = avgOpponentSpBySchool.get(schoolLower) ?? null;
    const sosTier =
      avgOp !== null && validAvgOpRatings.length > 0
        ? deriveSosTier(avgOp, validAvgOpRatings)
        : null;

    return {
      teamId: school,
      teamName: team.displayName ?? school,
      conference: team.conference ?? null,
      spRating,
      spTier,
      winTotalLow,
      winTotalHigh,
      lastSeasonRecord: priorYearRecordBySchool.get(schoolLower) ?? null,
      preseasonRank,
      sosTier,
      homeGames,
      awayGames,
      neutralGames,
      rankedOpponentCount: rankedOpponents.size,
      awaitingRatings,
    };
  });
}

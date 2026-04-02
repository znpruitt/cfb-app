import type { SeasonArchive } from '../seasonArchive';
import type { OwnerStandingsSeriesPoint } from '../standingsHistory';
import { parseOwnersCsv } from '../parseOwnersCsv';

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export type StandingsRow = {
  rank: number;
  owner: string;
  wins: number;
  losses: number;
  gamesBack: number;
  pointDifferential: number;
};

export type OwnerRosterEntry = {
  teamName: string;
  ownerName: string;
};

export type SeasonSuperlatives = {
  /** Highest single-week score (cumulative weekly delta of pointsFor). */
  highestWeeklyScore: { ownerName: string; score: number; week: number } | null;
  /**
   * Biggest blowout — null: individual game pairings are not stored in
   * SeasonArchive. Would require a per-week game list in the archive.
   */
  biggestBlowout: null;
  /**
   * Closest matchup — null: same reason as biggestBlowout.
   */
  closestMatchup: null;
  /**
   * Biggest upset — null: requires knowing which owner played which each week.
   */
  biggestUpset: null;
  /** Owner with the longest consecutive win streak and the weeks it spanned. */
  mostDominantStretch: {
    ownerName: string;
    consecutiveWins: number;
    weekStart: number;
    weekEnd: number;
  } | null;
  /** Owner with the biggest climb from Week 1 position to final position. */
  mostImproved: {
    ownerName: string;
    week1Rank: number;
    finalRank: number;
    improvement: number;
  } | null;
};

export type MatchupDetail = {
  week: number;
  ownerAScore: number;
  ownerBScore: number;
  winner: string;
};

/**
 * Serializable representation of a head-to-head pairing.
 * All fields use plain primitives/arrays — safe to pass as Next.js component props.
 */
export type HeadToHeadEntry = {
  ownerA: string;
  ownerB: string;
  wins: number;
  losses: number;
  matchups: MatchupDetail[];
};

// ---------------------------------------------------------------------------
// selectFinalStandings
// ---------------------------------------------------------------------------

/**
 * Returns the final standings from archive.finalStandings, adding an explicit rank field.
 */
export function selectFinalStandings(archive: SeasonArchive): StandingsRow[] {
  return archive.finalStandings.map((row, index) => ({
    rank: index + 1,
    owner: row.owner,
    wins: row.wins,
    losses: row.losses,
    gamesBack: row.gamesBack,
    pointDifferential: row.pointDifferential,
  }));
}

// ---------------------------------------------------------------------------
// selectOwnerRoster
// ---------------------------------------------------------------------------

/**
 * Parses archive.ownerRosterSnapshot CSV into structured entries sorted by owner name.
 * Owner names come from the snapshot — do not reference the live roster.
 */
export function selectOwnerRoster(archive: SeasonArchive): OwnerRosterEntry[] {
  const rows = parseOwnersCsv(archive.ownerRosterSnapshot);
  return rows
    .map((row) => ({ teamName: row.team, ownerName: row.owner }))
    .sort((a, b) => a.ownerName.localeCompare(b.ownerName));
}

// ---------------------------------------------------------------------------
// selectSeasonSuperlatives helpers
// ---------------------------------------------------------------------------

/**
 * Computes per-week score delta and win/loss outcome from a cumulative owner series.
 * Mirrors the weeklyStats helper in seasonArchive.ts (not exported there).
 */
function ownerWeeklyDeltas(
  series: OwnerStandingsSeriesPoint[]
): Map<number, { pointsFor: number; won: boolean }> {
  const result = new Map<number, { pointsFor: number; won: boolean }>();
  for (let i = 0; i < series.length; i++) {
    const cur = series[i]!;
    const prev = i > 0 ? series[i - 1]! : null;
    const weekPointsFor = prev ? cur.pointsFor - prev.pointsFor : cur.pointsFor;
    const weekWins = prev ? cur.wins - prev.wins : cur.wins;
    result.set(cur.week, { pointsFor: weekPointsFor, won: weekWins > 0 });
  }
  return result;
}

// ---------------------------------------------------------------------------
// selectSeasonSuperlatives
// ---------------------------------------------------------------------------

/**
 * Derives six season superlatives from archive.standingsHistory and archive.finalStandings.
 *
 * Three superlatives (biggestBlowout, closestMatchup, biggestUpset) require per-game
 * owner pairings that are not stored in SeasonArchive — these are always null.
 * Supporting them would require adding a per-week game pairing list to SeasonArchive.
 */
export function selectSeasonSuperlatives(archive: SeasonArchive): SeasonSuperlatives {
  const { byOwner, weeks, byWeek } = archive.standingsHistory;

  // 1. Highest single-week score
  let highestWeeklyScore: SeasonSuperlatives['highestWeeklyScore'] = null;
  for (const [owner, series] of Object.entries(byOwner)) {
    const weekly = ownerWeeklyDeltas(series);
    for (const [week, stats] of weekly) {
      if (!highestWeeklyScore || stats.pointsFor > highestWeeklyScore.score) {
        highestWeeklyScore = { ownerName: owner, score: stats.pointsFor, week };
      }
    }
  }

  // 5. Most dominant stretch — longest consecutive win streak
  let mostDominantStretch: SeasonSuperlatives['mostDominantStretch'] = null;
  for (const [owner, series] of Object.entries(byOwner)) {
    const weekly = ownerWeeklyDeltas(series);
    const orderedWeeks = [...weekly.keys()].sort((a, b) => a - b);
    let streak = 0;
    let streakStart = 0;
    let bestStreak = 0;
    let bestStart = 0;
    let bestEnd = 0;
    for (const week of orderedWeeks) {
      if (weekly.get(week)?.won) {
        if (streak === 0) streakStart = week;
        streak++;
        if (streak > bestStreak) {
          bestStreak = streak;
          bestStart = streakStart;
          bestEnd = week;
        }
      } else {
        streak = 0;
      }
    }
    if (
      bestStreak > 0 &&
      (!mostDominantStretch || bestStreak > mostDominantStretch.consecutiveWins)
    ) {
      mostDominantStretch = {
        ownerName: owner,
        consecutiveWins: bestStreak,
        weekStart: bestStart,
        weekEnd: bestEnd,
      };
    }
  }

  // 6. Most improved — biggest climb from Week 1 position to final position
  let mostImproved: SeasonSuperlatives['mostImproved'] = null;
  const firstWeek = weeks[0];
  if (firstWeek !== undefined && archive.finalStandings.length > 0) {
    const week1Standings = byWeek[firstWeek]?.standings ?? [];
    archive.finalStandings.forEach((finalRow, finalIndex) => {
      const finalRank = finalIndex + 1;
      const week1Index = week1Standings.findIndex((r) => r.owner === finalRow.owner);
      if (week1Index === -1) return;
      const week1Rank = week1Index + 1;
      const improvement = week1Rank - finalRank;
      if (!mostImproved || improvement > mostImproved.improvement) {
        mostImproved = { ownerName: finalRow.owner, week1Rank, finalRank, improvement };
      }
    });
  }

  return {
    highestWeeklyScore,
    biggestBlowout: null,
    closestMatchup: null,
    biggestUpset: null,
    mostDominantStretch,
    mostImproved,
  };
}

// ---------------------------------------------------------------------------
// selectHeadToHead
// ---------------------------------------------------------------------------

/**
 * Returns an empty head-to-head entry list.
 *
 * Individual game pairings — which owner played which other owner each week —
 * are not stored in SeasonArchive. StandingsHistory carries only per-owner
 * cumulative stats, not game-level matchup data. Deriving owner-vs-owner records
 * from cumulative series is not possible without the per-week game pairing list.
 *
 * HeadToHeadPanel renders a "not available" state when this returns empty.
 * To support full head-to-head, SeasonArchive would need a per-week pairings field.
 */
export function selectHeadToHead(_archive: SeasonArchive): HeadToHeadEntry[] {
  return [];
}

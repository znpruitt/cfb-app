import type { SeasonArchive } from '../seasonArchive';
import type { OwnerStandingsSeriesPoint } from '../standingsHistory';
import type { AppGame } from '../schedule';
import type { ScorePack } from '../scores';
import { parseOwnersCsv } from '../parseOwnersCsv';

const NO_CLAIM_OWNER = 'NoClaim';

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

export type BlowoutDetail = {
  ownerA: string;
  ownerB: string;
  ownerAScore: number;
  ownerBScore: number;
  margin: number;
  week: number;
  gameDescription: string;
};

export type SeasonSuperlatives = {
  /** Highest single-week score (cumulative weekly delta of pointsFor). */
  highestWeeklyScore: { ownerName: string; score: number; week: number } | null;
  /** Owned-vs-owned matchup with the largest score margin. */
  biggestBlowout: BlowoutDetail | null;
  /** Owned-vs-owned matchup with the smallest non-zero score margin. */
  closestMatchup: BlowoutDetail | null;
  /** Matchup where the lower-ranked owner beat the higher-ranked owner. */
  biggestUpset: {
    winner: string;
    loser: string;
    rankDiff: number;
    week: number;
    margin: number;
    gameDescription: string;
  } | null;
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
  gameDescription: string;
};

/**
 * Serializable representation of a head-to-head pairing.
 * All fields use plain primitives/arrays — safe to pass as Next.js component props.
 * wins/losses are from ownerA's perspective.
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
// Internal helpers
// ---------------------------------------------------------------------------

/** Computes per-week score delta and win/loss outcome from a cumulative owner series. */
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

type OwnedFinalGame = {
  game: AppGame;
  awayOwner: string;
  homeOwner: string;
  awayScore: number;
  homeScore: number;
  margin: number;
};

/**
 * Returns all owned-vs-owned final games from archive.games, with scores resolved.
 * Excludes NoClaim owners, placeholders, and games without final scores.
 */
function getOwnedFinalGames(
  games: AppGame[],
  scoresByKey: Record<string, ScorePack>,
  rosterByTeam: Map<string, string>
): OwnedFinalGame[] {
  const result: OwnedFinalGame[] = [];
  for (const game of games) {
    if (game.isPlaceholder) continue;
    const awayOwner = rosterByTeam.get(game.csvAway);
    const homeOwner = rosterByTeam.get(game.csvHome);
    if (!awayOwner || !homeOwner) continue;
    if (awayOwner === NO_CLAIM_OWNER || homeOwner === NO_CLAIM_OWNER) continue;
    const score = scoresByKey[game.key];
    if (!score) continue;
    const awayScore = score.away.score;
    const homeScore = score.home.score;
    if (awayScore === null || homeScore === null) continue;
    if (!score.status.toLowerCase().includes('final')) continue;
    result.push({
      game,
      awayOwner,
      homeOwner,
      awayScore,
      homeScore,
      margin: Math.abs(awayScore - homeScore),
    });
  }
  return result;
}

function gameDescription(game: AppGame): string {
  return `${game.canAway} vs ${game.canHome}`;
}

function toBlowoutDetail(og: OwnedFinalGame): BlowoutDetail {
  // Present ownerA as the winner for clarity
  const awayWon = og.awayScore > og.homeScore;
  const ownerA = awayWon ? og.awayOwner : og.homeOwner;
  const ownerB = awayWon ? og.homeOwner : og.awayOwner;
  const ownerAScore = awayWon ? og.awayScore : og.homeScore;
  const ownerBScore = awayWon ? og.homeScore : og.awayScore;
  return {
    ownerA,
    ownerB,
    ownerAScore,
    ownerBScore,
    margin: og.margin,
    week: og.game.week,
    gameDescription: gameDescription(og.game),
  };
}

// ---------------------------------------------------------------------------
// selectSeasonSuperlatives
// ---------------------------------------------------------------------------

export function selectSeasonSuperlatives(archive: SeasonArchive): SeasonSuperlatives {
  const { byOwner, weeks, byWeek } = archive.standingsHistory;

  // 1. Highest single-week score — from cumulative owner series deltas
  let highestWeeklyScore: SeasonSuperlatives['highestWeeklyScore'] = null;
  for (const [owner, series] of Object.entries(byOwner)) {
    const weekly = ownerWeeklyDeltas(series);
    for (const [week, stats] of weekly) {
      if (!highestWeeklyScore || stats.pointsFor > highestWeeklyScore.score) {
        highestWeeklyScore = { ownerName: owner, score: stats.pointsFor, week };
      }
    }
  }

  // Build roster for owned-game queries
  const ownerRows = parseOwnersCsv(archive.ownerRosterSnapshot);
  const rosterByTeam = new Map(ownerRows.map((r) => [r.team, r.owner]));
  const ownedFinalGames = getOwnedFinalGames(archive.games ?? [], archive.scoresByKey ?? {}, rosterByTeam);

  // 2. Biggest blowout — max margin in owned-vs-owned final games
  let biggestBlowout: SeasonSuperlatives['biggestBlowout'] = null;
  for (const og of ownedFinalGames) {
    if (!biggestBlowout || og.margin > biggestBlowout.margin) {
      biggestBlowout = toBlowoutDetail(og);
    }
  }

  // 3. Closest matchup — min non-zero margin in owned-vs-owned final games
  let closestMatchup: SeasonSuperlatives['closestMatchup'] = null;
  for (const og of ownedFinalGames) {
    if (og.margin === 0) continue;
    if (!closestMatchup || og.margin < closestMatchup.margin) {
      closestMatchup = toBlowoutDetail(og);
    }
  }

  // 4. Biggest upset — lower-ranked owner beats higher-ranked owner
  //    Rank is determined by standings at the END of the PREVIOUS week (pre-game standings)
  let biggestUpset: SeasonSuperlatives['biggestUpset'] = null;
  for (const og of ownedFinalGames) {
    const week = og.game.week;
    const weekIdx = weeks.indexOf(week);
    if (weekIdx <= 0) continue; // no prior week standings — cannot determine favorite

    const prevWeek = weeks[weekIdx - 1]!;
    const prevStandings = byWeek[prevWeek]?.standings ?? [];
    if (prevStandings.length === 0) continue;

    const awayRank = prevStandings.findIndex((r) => r.owner === og.awayOwner) + 1;
    const homeRank = prevStandings.findIndex((r) => r.owner === og.homeOwner) + 1;
    if (awayRank === 0 || homeRank === 0) continue;

    const awayWon = og.awayScore > og.homeScore;
    // An upset: lower-ranked (higher rank number) owner wins
    const awayIsLowerRanked = awayRank > homeRank;
    const upsetOccurred = (awayIsLowerRanked && awayWon) || (!awayIsLowerRanked && !awayWon);
    if (!upsetOccurred) continue;

    const rankDiff = Math.abs(awayRank - homeRank);
    const winner = awayWon ? og.awayOwner : og.homeOwner;
    const loser = awayWon ? og.homeOwner : og.awayOwner;

    if (!biggestUpset || rankDiff > biggestUpset.rankDiff) {
      biggestUpset = {
        winner,
        loser,
        rankDiff,
        week,
        margin: og.margin,
        gameDescription: gameDescription(og.game),
      };
    }
  }

  // 5. Most dominant stretch — longest consecutive win streak from owner series
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
    if (bestStreak > 0 && (!mostDominantStretch || bestStreak > mostDominantStretch.consecutiveWins)) {
      mostDominantStretch = {
        ownerName: owner,
        consecutiveWins: bestStreak,
        weekStart: bestStart,
        weekEnd: bestEnd,
      };
    }
  }

  // 6. Most improved — biggest climb from Week 1 rank to final rank
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
    biggestBlowout,
    closestMatchup,
    biggestUpset,
    mostDominantStretch,
    mostImproved,
  };
}

// ---------------------------------------------------------------------------
// selectHeadToHead
// ---------------------------------------------------------------------------

/**
 * Derives per-owner season W-L records and matchup details against every other
 * owner from archive.games and archive.scoresByKey.
 *
 * Excludes NoClaim owners, placeholder games, and games without a final score.
 * wins/losses in each entry are from ownerA's perspective (ownerA is
 * lexicographically smaller of the two).
 *
 * Returns [] when no owned-vs-owned matchups exist in the archive.
 */
export function selectHeadToHead(archive: SeasonArchive): HeadToHeadEntry[] {
  const ownerRows = parseOwnersCsv(archive.ownerRosterSnapshot);
  const rosterByTeam = new Map(ownerRows.map((r) => [r.team, r.owner]));

  type PairingRecord = { wins: number; losses: number; matchups: MatchupDetail[] };
  const pairings = new Map<string, PairingRecord>();

  function pairingKey(a: string, b: string): string {
    return a < b ? `${a}::${b}` : `${b}::${a}`;
  }

  for (const game of archive.games ?? []) {
    if (game.isPlaceholder) continue;
    const awayOwner = rosterByTeam.get(game.csvAway);
    const homeOwner = rosterByTeam.get(game.csvHome);
    if (!awayOwner || !homeOwner) continue;
    if (awayOwner === NO_CLAIM_OWNER || homeOwner === NO_CLAIM_OWNER) continue;

    const score = (archive.scoresByKey ?? {})[game.key];
    if (!score) continue;
    const awayScore = score.away.score;
    const homeScore = score.home.score;
    if (awayScore === null || homeScore === null) continue;
    if (!score.status.toLowerCase().includes('final')) continue;

    // ownerA is lexicographically smaller — determines wins/losses perspective
    const ownerA = awayOwner < homeOwner ? awayOwner : homeOwner;
    const isAwayOwnerA = ownerA === awayOwner;
    const ownerAScore = isAwayOwnerA ? awayScore : homeScore;
    const ownerBScore = isAwayOwnerA ? homeScore : awayScore;
    const winner = awayScore > homeScore ? awayOwner : homeOwner;

    const key = pairingKey(awayOwner, homeOwner);
    if (!pairings.has(key)) {
      pairings.set(key, { wins: 0, losses: 0, matchups: [] });
    }
    const record = pairings.get(key)!;

    if (winner === ownerA) {
      record.wins++;
    } else {
      record.losses++;
    }

    record.matchups.push({
      week: game.week,
      ownerAScore,
      ownerBScore,
      winner,
      gameDescription: gameDescription(game),
    });
  }

  return Array.from(pairings.entries())
    .map(([key, record]) => {
      const sepIdx = key.indexOf('::');
      const ownerA = key.slice(0, sepIdx);
      const ownerB = key.slice(sepIdx + 2);
      return {
        ownerA,
        ownerB,
        wins: record.wins,
        losses: record.losses,
        matchups: record.matchups.sort((a, b) => a.week - b.week),
      };
    })
    .sort((a, b) => a.ownerA.localeCompare(b.ownerA) || a.ownerB.localeCompare(b.ownerB));
}

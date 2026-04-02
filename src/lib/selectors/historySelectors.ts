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
    if (awayOwner === homeOwner) continue; // exclude same-owner matchups
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
  const ownedFinalGames = getOwnedFinalGames(
    archive.games ?? [],
    archive.scoresByKey ?? {},
    rosterByTeam
  );

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

// ---------------------------------------------------------------------------
// Cross-season output types
// ---------------------------------------------------------------------------

export type AllTimeStandingRow = {
  owner: string;
  totalWins: number;
  totalLosses: number;
  winPct: number;
  championships: number;
  seasonsPlayed: number;
  avgFinish: number;
};

export type ChampionshipEntry = {
  year: number;
  champion: string;
};

export type AllTimeHeadToHeadEntry = {
  ownerA: string;
  ownerB: string;
  wins: number;
  losses: number;
  seasons: number;
};

export type DynastyDroughtRow = {
  owner: string;
  longestWinStreak: number;
  longestWinStreakYears: number[];
  longestDrought: number;
};

export type DynastyDroughtResult = {
  rows: DynastyDroughtRow[];
};

export type MostImprovedEntry = {
  owner: string;
  fromYear: number;
  toYear: number;
  fromFinish: number;
  toFinish: number;
  improvement: number;
};

export type OwnerSeasonRecord = {
  year: number;
  wins: number;
  losses: number;
  gamesBack: number;
  finish: number;
  totalOwners: number;
  isChampion: boolean;
};

export type OwnerCareerHeadToHead = {
  opponent: string;
  wins: number;
  losses: number;
  seasons: Array<{
    year: number;
    wins: number;
    losses: number;
  }>;
};

export type OwnerCareerResult = {
  ownerName: string;
  totalWins: number;
  totalLosses: number;
  championships: number;
  seasonsPlayed: number;
  avgFinish: number;
  seasonHistory: OwnerSeasonRecord[];
  headToHead: OwnerCareerHeadToHead[];
};

// ---------------------------------------------------------------------------
// Internal helpers for cross-season selectors
// ---------------------------------------------------------------------------

/** Returns the champion (first-place owner) from an archive's finalStandings, or null. */
function archiveChampion(archive: SeasonArchive): string | null {
  return archive.finalStandings.length > 0 ? (archive.finalStandings[0]?.owner ?? null) : null;
}

/** Returns sorted archives by year ascending. */
function sortedByYear(archives: SeasonArchive[]): SeasonArchive[] {
  return [...archives].sort((a, b) => a.year - b.year);
}

// ---------------------------------------------------------------------------
// selectAllTimeStandings
// ---------------------------------------------------------------------------

/**
 * Aggregates W-L records, championships, and average finish position per owner
 * across all provided archives. NoClaim entries are excluded.
 *
 * Optionally accepts live season standings to merge into win/loss totals before
 * computing win percentage. Live wins/losses are included in winPct but the
 * live season does not count as a championship or increment seasonsPlayed.
 *
 * Sorted by: championships desc → win percentage desc → total wins desc.
 */
export function selectAllTimeStandings(
  archives: SeasonArchive[],
  liveStandings?: StandingsRow[]
): AllTimeStandingRow[] {
  type OwnerAccum = {
    totalWins: number;
    totalLosses: number;
    championships: number;
    seasonsPlayed: number;
    finishSum: number;
  };
  const accum = new Map<string, OwnerAccum>();

  for (const archive of archives) {
    const champion = archiveChampion(archive);
    archive.finalStandings.forEach((row, idx) => {
      if (row.owner === NO_CLAIM_OWNER) return;
      const finish = idx + 1;
      if (!accum.has(row.owner)) {
        accum.set(row.owner, {
          totalWins: 0,
          totalLosses: 0,
          championships: 0,
          seasonsPlayed: 0,
          finishSum: 0,
        });
      }
      const a = accum.get(row.owner)!;
      a.totalWins += row.wins;
      a.totalLosses += row.losses;
      a.championships += row.owner === champion ? 1 : 0;
      a.seasonsPlayed += 1;
      a.finishSum += finish;
    });
  }

  // Merge live season wins/losses — no championship credit, no seasonsPlayed increment
  if (liveStandings) {
    for (const row of liveStandings) {
      if (row.owner === NO_CLAIM_OWNER) continue;
      if (!accum.has(row.owner)) {
        accum.set(row.owner, {
          totalWins: 0,
          totalLosses: 0,
          championships: 0,
          seasonsPlayed: 0,
          finishSum: 0,
        });
      }
      const a = accum.get(row.owner)!;
      a.totalWins += row.wins;
      a.totalLosses += row.losses;
    }
  }

  return Array.from(accum.entries())
    .map(([owner, a]) => {
      const totalGames = a.totalWins + a.totalLosses;
      const winPct = totalGames > 0 ? a.totalWins / totalGames : 0;
      return {
        owner,
        totalWins: a.totalWins,
        totalLosses: a.totalLosses,
        winPct,
        championships: a.championships,
        seasonsPlayed: a.seasonsPlayed,
        avgFinish: a.seasonsPlayed > 0 ? a.finishSum / a.seasonsPlayed : 0,
      };
    })
    .sort(
      (a, b) =>
        b.championships - a.championships ||
        b.winPct - a.winPct ||
        b.totalWins - a.totalWins
    );
}

// ---------------------------------------------------------------------------
// selectChampionshipHistory
// ---------------------------------------------------------------------------

/**
 * Returns one entry per archived season listing the champion, sorted by year ascending.
 */
export function selectChampionshipHistory(archives: SeasonArchive[]): ChampionshipEntry[] {
  return sortedByYear(archives).map((archive) => ({
    year: archive.year,
    champion: archiveChampion(archive) ?? 'Unknown',
  }));
}

// ---------------------------------------------------------------------------
// selectAllTimeHeadToHead
// ---------------------------------------------------------------------------

/**
 * Aggregates head-to-head records across all archived seasons.
 * wins/losses from ownerA's perspective (ownerA lexicographically smaller).
 */
export function selectAllTimeHeadToHead(archives: SeasonArchive[]): AllTimeHeadToHeadEntry[] {
  type PairingAccum = { wins: number; losses: number; seasons: Set<number> };
  const pairings = new Map<string, PairingAccum>();

  function pairingKey(a: string, b: string): string {
    return a < b ? `${a}::${b}` : `${b}::${a}`;
  }

  for (const archive of archives) {
    const seasonH2H = selectHeadToHead(archive);
    for (const entry of seasonH2H) {
      const key = pairingKey(entry.ownerA, entry.ownerB);
      if (!pairings.has(key)) {
        pairings.set(key, { wins: 0, losses: 0, seasons: new Set() });
      }
      const p = pairings.get(key)!;
      // selectHeadToHead already ensures ownerA < ownerB, so direction is consistent
      if (entry.ownerA < entry.ownerB) {
        p.wins += entry.wins;
        p.losses += entry.losses;
      } else {
        p.wins += entry.losses;
        p.losses += entry.wins;
      }
      p.seasons.add(archive.year);
    }
  }

  return Array.from(pairings.entries())
    .map(([key, p]) => {
      const sep = key.indexOf('::');
      const ownerA = key.slice(0, sep);
      const ownerB = key.slice(sep + 2);
      return {
        ownerA,
        ownerB,
        wins: p.wins,
        losses: p.losses,
        seasons: p.seasons.size,
      };
    })
    .sort((a, b) => a.ownerA.localeCompare(b.ownerA) || a.ownerB.localeCompare(b.ownerB));
}

// ---------------------------------------------------------------------------
// selectTopRivalries
// ---------------------------------------------------------------------------

/**
 * Returns the closest head-to-head pairings across all seasons (most competitive records).
 * Sorted by absolute win difference asc, then total games desc.
 */
export function selectTopRivalries(archives: SeasonArchive[], limit = 5): AllTimeHeadToHeadEntry[] {
  const allH2H = selectAllTimeHeadToHead(archives);
  return allH2H
    .filter((e) => e.wins + e.losses >= 2) // at least 2 games for a rivalry
    .sort((a, b) => {
      const diffA = Math.abs(a.wins - a.losses);
      const diffB = Math.abs(b.wins - b.losses);
      return diffA - diffB || b.wins + b.losses - (a.wins + a.losses);
    })
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// selectDynastyAndDrought
// ---------------------------------------------------------------------------

/**
 * Per owner: longest championship winning streak (dynasty) and longest gap
 * between championships (drought). Archives must be sorted by year.
 */
export function selectDynastyAndDrought(archives: SeasonArchive[]): DynastyDroughtResult {
  const sorted = sortedByYear(archives);
  const years = sorted.map((a) => a.year);

  // Collect all owners
  const allOwners = new Set<string>();
  for (const archive of sorted) {
    for (const row of archive.finalStandings) {
      allOwners.add(row.owner);
    }
  }

  const rows: DynastyDroughtRow[] = [];

  for (const owner of allOwners) {
    if (owner === NO_CLAIM_OWNER) continue;
    // Determine which years the owner won a championship
    const champYears = new Set<number>();
    for (const archive of sorted) {
      if (archiveChampion(archive) === owner) {
        champYears.add(archive.year);
      }
    }

    // Determine which years the owner participated
    const participationYears = new Set<number>();
    for (const archive of sorted) {
      if (archive.finalStandings.some((r) => r.owner === owner)) {
        participationYears.add(archive.year);
      }
    }

    if (participationYears.size === 0) continue;

    // Longest consecutive championship streak
    let bestStreak = 0;
    let bestStreakYears: number[] = [];
    let curStreak = 0;
    let curStreakYears: number[] = [];

    for (const year of years) {
      if (!participationYears.has(year)) {
        curStreak = 0;
        curStreakYears = [];
        continue;
      }
      if (champYears.has(year)) {
        curStreak++;
        curStreakYears.push(year);
        if (curStreak > bestStreak) {
          bestStreak = curStreak;
          bestStreakYears = [...curStreakYears];
        }
      } else {
        curStreak = 0;
        curStreakYears = [];
      }
    }

    // Longest drought: max consecutive participation years without a championship
    let bestDrought = 0;
    let curDrought = 0;
    for (const year of years) {
      if (!participationYears.has(year)) continue;
      if (champYears.has(year)) {
        curDrought = 0;
      } else {
        curDrought++;
        if (curDrought > bestDrought) bestDrought = curDrought;
      }
    }

    rows.push({
      owner,
      longestWinStreak: bestStreak,
      longestWinStreakYears: bestStreakYears,
      longestDrought: bestDrought,
    });
  }

  // Sort by streak desc, then drought desc
  rows.sort(
    (a, b) => b.longestWinStreak - a.longestWinStreak || b.longestDrought - a.longestDrought
  );

  return { rows };
}

// ---------------------------------------------------------------------------
// selectMostImprovedSeasonOverSeason
// ---------------------------------------------------------------------------

/**
 * Returns the biggest finish position improvements between consecutive seasons.
 * Positive improvement = moved up the standings.
 */
export function selectMostImprovedSeasonOverSeason(archives: SeasonArchive[]): MostImprovedEntry[] {
  const sorted = sortedByYear(archives);
  if (sorted.length < 2) return [];

  const results: MostImprovedEntry[] = [];

  for (let i = 0; i < sorted.length - 1; i++) {
    const prev = sorted[i]!;
    const next = sorted[i + 1]!;

    const prevFinish = new Map<string, number>();
    prev.finalStandings.forEach((row, idx) => prevFinish.set(row.owner, idx + 1));

    const nextFinish = new Map<string, number>();
    next.finalStandings.forEach((row, idx) => nextFinish.set(row.owner, idx + 1));

    // Only owners who appeared in both seasons (exclude NoClaim)
    for (const [owner, fromFinish] of prevFinish) {
      if (owner === NO_CLAIM_OWNER) continue;
      const toFinish = nextFinish.get(owner);
      if (toFinish === undefined) continue;
      const improvement = fromFinish - toFinish; // positive = moved up
      results.push({
        owner,
        fromYear: prev.year,
        toYear: next.year,
        fromFinish,
        toFinish,
        improvement,
      });
    }
  }

  return results.sort((a, b) => b.improvement - a.improvement);
}

// ---------------------------------------------------------------------------
// selectOwnerCareer
// ---------------------------------------------------------------------------

/**
 * Aggregates a single owner's career across all archived seasons.
 */
export function selectOwnerCareer(archives: SeasonArchive[], ownerName: string): OwnerCareerResult {
  if (ownerName === NO_CLAIM_OWNER) {
    return {
      ownerName,
      totalWins: 0,
      totalLosses: 0,
      championships: 0,
      seasonsPlayed: 0,
      avgFinish: 0,
      seasonHistory: [],
      headToHead: [],
    };
  }
  const sorted = sortedByYear(archives);
  const seasonHistory: OwnerSeasonRecord[] = [];

  // Per-season head-to-head: Map<opponentName, {wins, losses}>
  const h2hBySeason = new Map<number, Map<string, { wins: number; losses: number }>>();

  for (const archive of sorted) {
    const finishIdx = archive.finalStandings.findIndex((r) => r.owner === ownerName);
    if (finishIdx === -1) continue;

    const row = archive.finalStandings[finishIdx]!;
    const finish = finishIdx + 1;
    const champion = archiveChampion(archive);

    seasonHistory.push({
      year: archive.year,
      wins: row.wins,
      losses: row.losses,
      gamesBack: row.gamesBack,
      finish,
      totalOwners: archive.finalStandings.length,
      isChampion: champion === ownerName,
    });

    // Season head-to-head
    const seasonH2H = selectHeadToHead(archive);
    const opponentMap = new Map<string, { wins: number; losses: number }>();
    for (const entry of seasonH2H) {
      if (entry.ownerA !== ownerName && entry.ownerB !== ownerName) continue;
      const isA = entry.ownerA === ownerName;
      const opponent = isA ? entry.ownerB : entry.ownerA;
      const wins = isA ? entry.wins : entry.losses;
      const losses = isA ? entry.losses : entry.wins;
      opponentMap.set(opponent, { wins, losses });
    }
    h2hBySeason.set(archive.year, opponentMap);
  }

  // Aggregate career totals
  let totalWins = 0;
  let totalLosses = 0;
  let championships = 0;
  let finishSum = 0;

  for (const s of seasonHistory) {
    totalWins += s.wins;
    totalLosses += s.losses;
    if (s.isChampion) championships++;
    finishSum += s.finish;
  }

  const seasonsPlayed = seasonHistory.length;
  const avgFinish = seasonsPlayed > 0 ? finishSum / seasonsPlayed : 0;

  // Aggregate all-time H2H per opponent with per-season breakdown
  const h2hByOpponent = new Map<
    string,
    { wins: number; losses: number; seasons: Array<{ year: number; wins: number; losses: number }> }
  >();

  for (const [year, opponentMap] of h2hBySeason) {
    for (const [opponent, record] of opponentMap) {
      if (!h2hByOpponent.has(opponent)) {
        h2hByOpponent.set(opponent, { wins: 0, losses: 0, seasons: [] });
      }
      const agg = h2hByOpponent.get(opponent)!;
      agg.wins += record.wins;
      agg.losses += record.losses;
      agg.seasons.push({ year, wins: record.wins, losses: record.losses });
    }
  }

  const headToHead: OwnerCareerHeadToHead[] = Array.from(h2hByOpponent.entries())
    .map(([opponent, agg]) => ({
      opponent,
      wins: agg.wins,
      losses: agg.losses,
      seasons: agg.seasons.sort((a, b) => a.year - b.year),
    }))
    .sort(
      (a, b) => b.wins + b.losses - (a.wins + a.losses) || a.opponent.localeCompare(b.opponent)
    );

  return {
    ownerName,
    totalWins,
    totalLosses,
    championships,
    seasonsPlayed,
    avgFinish,
    seasonHistory,
    headToHead,
  };
}

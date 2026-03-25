import { gameStateFromScore } from './gameUi.ts';
import type { OverviewGameItem } from './overview.ts';
import type { TeamRankingEnrichment } from './rankings.ts';
import { getGameParticipantTeamId, type AppGame } from './schedule.ts';
import type { ScorePack } from './scores.ts';
import type { CombinedOdds } from './odds.ts';
import type { OwnerStandingsRow } from './standings.ts';
import { normalizeTeamName } from './teamNormalization.ts';

export type Insight = {
  id: string;
  text: string;
  priority: number;
};

export type GameHighlightTag = {
  id: 'top25' | 'topMatchup' | 'close' | 'ranked';
  text: string;
  priority: number;
};

type LeagueInsightsInput = {
  standings: OwnerStandingsRow[];
  previousStandings?: OwnerStandingsRow[] | null;
  recentResults: OverviewGameItem[];
  liveGames: OverviewGameItem[];
  rankingsByTeamId: Map<string, TeamRankingEnrichment>;
};

const TOP_INSIGHT_LIMIT = 3;
const TOP_BADGE_LIMIT = 2;

function teamRankForGameSide(
  item: OverviewGameItem,
  side: 'away' | 'home',
  rankingsByTeamId: Map<string, TeamRankingEnrichment>
): number | null {
  const teamId = getGameParticipantTeamId(item.bucket.game, side);
  const fallbackTeamId = side === 'away' ? item.bucket.game.canAway : item.bucket.game.canHome;
  return rankingsByTeamId.get(teamId ?? fallbackTeamId)?.rank ?? null;
}

function gameMargin(item: OverviewGameItem): number | null {
  const awayScore = item.score?.away.score;
  const homeScore = item.score?.home.score;
  if (awayScore == null || homeScore == null) return null;
  return Math.abs(awayScore - homeScore);
}

function isTopOwnerGame(item: OverviewGameItem, topOwners: Set<string>): boolean {
  return Boolean(
    (item.bucket.awayOwner && topOwners.has(item.bucket.awayOwner)) ||
      (item.bucket.homeOwner && topOwners.has(item.bucket.homeOwner))
  );
}

function isFinalTopTwoHeadToHead(item: OverviewGameItem, topTwoOwners: Set<string>): boolean {
  if (topTwoOwners.size < 2) return false;
  if (gameStateFromScore(item.score) !== 'final') return false;

  const awayOwner = item.bucket.awayOwner;
  const homeOwner = item.bucket.homeOwner;
  if (!awayOwner || !homeOwner || awayOwner === homeOwner) return false;

  return topTwoOwners.has(awayOwner) && topTwoOwners.has(homeOwner);
}

function ownerRankLookup(rows: OwnerStandingsRow[]): Map<string, number> {
  return new Map(rows.map((row, index) => [row.owner, index + 1]));
}

function leaderGap(rows: OwnerStandingsRow[]): number | null {
  if (rows.length < 2) return null;
  return Math.max(0, rows[0].winPct - rows[1].winPct);
}

export function deriveLeagueInsights({
  standings,
  previousStandings,
  recentResults,
  liveGames,
  rankingsByTeamId,
}: LeagueInsightsInput): Insight[] {
  const insights: Insight[] = [];
  const leader = standings[0];
  const runnerUp = standings[1];

  if (leader && runnerUp) {
    const gap = leaderGap(standings) ?? 0;
    insights.push({
      id: 'leader-gap',
      text: `${leader.owner} leads by ${gap.toFixed(3)} win%`,
      priority: 100,
    });

    const previousGap = previousStandings ? leaderGap(previousStandings) : null;
    if (previousGap != null) {
      const gapDelta = gap - previousGap;
      if (gapDelta > 0.001) {
        insights.push({
          id: 'leader-gap-widened',
          text: `Leader gap widened to ${gap.toFixed(3)}`,
          priority: 98,
        });
      } else if (gapDelta < -0.001) {
        insights.push({
          id: 'leader-gap-tightened',
          text: `Leader gap tightened to ${gap.toFixed(3)}`,
          priority: 98,
        });
      }
    }
  }

  if (previousStandings?.length) {
    const prevRanks = ownerRankLookup(previousStandings);
    standings.slice(0, 3).forEach((row, index) => {
      const currentRank = index + 1;
      const previousRank = prevRanks.get(row.owner);
      if (previousRank && previousRank > currentRank && currentRank <= 3) {
        insights.push({
          id: `rank-movement-${row.owner}`,
          text: `${row.owner} moved into ${currentRank === 1 ? '1st' : currentRank === 2 ? '2nd' : '3rd'}`,
          priority: 96 - currentRank,
        });
      }
    });
  }

  const rankedLiveMatchup = liveGames.find((game) => {
    const awayRank = teamRankForGameSide(game, 'away', rankingsByTeamId);
    const homeRank = teamRankForGameSide(game, 'home', rankingsByTeamId);
    return awayRank != null && homeRank != null;
  });
  if (rankedLiveMatchup) {
    const awayRank = teamRankForGameSide(rankedLiveMatchup, 'away', rankingsByTeamId);
    const homeRank = teamRankForGameSide(rankedLiveMatchup, 'home', rankingsByTeamId);
    if (awayRank != null && homeRank != null) {
      insights.push({
        id: `live-top25-${rankedLiveMatchup.bucket.game.key}`,
        text: `#${awayRank} vs #${homeRank} live now`,
        priority: 95,
      });
    }
  } else {
    const rankedMatchup = recentResults.find((game) => {
      const awayRank = teamRankForGameSide(game, 'away', rankingsByTeamId);
      const homeRank = teamRankForGameSide(game, 'home', rankingsByTeamId);
      return awayRank != null && homeRank != null;
    });
    if (rankedMatchup) {
      const awayRank = teamRankForGameSide(rankedMatchup, 'away', rankingsByTeamId);
      const homeRank = teamRankForGameSide(rankedMatchup, 'home', rankingsByTeamId);
      if (awayRank != null && homeRank != null) {
        insights.push({
          id: `top25-${rankedMatchup.bucket.game.key}`,
          text: `#${awayRank} vs #${homeRank} matchup this week`,
          priority: 90,
        });
      }
    }
  }

  if (liveGames.length > 0) {
    insights.push({
      id: 'live-impact',
      text: `${liveGames.length} live ${liveGames.length === 1 ? 'game' : 'games'} affecting standings`,
      priority: 89,
    });
  }

  const topOwners = new Set(standings.slice(0, 2).map((row) => row.owner));
  const leaderLiveGame = liveGames.some((item) =>
    isTopOwnerGame(item, new Set([leader?.owner ?? '']))
  );
  if (leaderLiveGame) {
    insights.push({
      id: 'leader-live',
      text: 'Leader game live now',
      priority: 88,
    });
  } else if (recentResults.some((item) => isFinalTopTwoHeadToHead(item, topOwners))) {
    insights.push({
      id: 'top-two-result',
      text: 'Top 2 matchup result',
      priority: 87,
    });
  }

  const closeGames = recentResults.filter((item) => {
    const margin = gameMargin(item);
    return margin != null && margin <= 7;
  }).length;
  if (closeGames > 0) {
    insights.push({
      id: 'close-games',
      text: `${closeGames} close ${closeGames === 1 ? 'game' : 'games'} this week`,
      priority: 66,
    });
  }

  const rankedSingleTeamResult = recentResults.find((item) => {
    const awayRank = teamRankForGameSide(item, 'away', rankingsByTeamId);
    const homeRank = teamRankForGameSide(item, 'home', rankingsByTeamId);
    return (awayRank != null && homeRank == null) || (awayRank == null && homeRank != null);
  });
  if (rankedSingleTeamResult) {
    const awayRank = teamRankForGameSide(rankedSingleTeamResult, 'away', rankingsByTeamId);
    const homeRank = teamRankForGameSide(rankedSingleTeamResult, 'home', rankingsByTeamId);
    const rankedTeamName =
      awayRank != null
        ? rankedSingleTeamResult.bucket.game.csvAway
        : rankedSingleTeamResult.bucket.game.csvHome;
    const rank = awayRank ?? homeRank;
    if (rank != null) {
      insights.push({
        id: `ranked-single-${rankedSingleTeamResult.bucket.game.key}`,
        text: `#${rank} ${rankedTeamName} in action`,
        priority: 62,
      });
    }
  }

  return insights.sort((a, b) => b.priority - a.priority).slice(0, TOP_INSIGHT_LIMIT);
}

export function deriveGameHighlightTags(params: {
  item: OverviewGameItem;
  rankingsByTeamId: Map<string, TeamRankingEnrichment>;
  topOwners: Set<string>;
}): GameHighlightTag[] {
  const { item, rankingsByTeamId, topOwners } = params;
  const awayRank = teamRankForGameSide(item, 'away', rankingsByTeamId);
  const homeRank = teamRankForGameSide(item, 'home', rankingsByTeamId);
  const margin = gameMargin(item);
  const tags: GameHighlightTag[] = [];

  if (awayRank != null && homeRank != null) {
    tags.push({
      id: 'top25',
      text: `#${awayRank} vs #${homeRank}`,
      priority: 100,
    });
  } else if (awayRank != null || homeRank != null) {
    tags.push({
      id: 'ranked',
      text: `#${awayRank ?? homeRank}`,
      priority: 70,
    });
  }

  if (isTopOwnerGame(item, topOwners)) {
    tags.push({
      id: 'topMatchup',
      text: 'Top matchup',
      priority: 90,
    });
  }

  if (margin != null && margin <= 7) {
    tags.push({
      id: 'close',
      text: 'Close',
      priority: 80,
    });
  }

  return tags.sort((a, b) => b.priority - a.priority).slice(0, TOP_BADGE_LIMIT);
}

export type LeagueStandingRow = {
  owner: string;
  wins: number;
  losses: number;
  winPct: number;
  pointDiff: number;
  liveGames: number;
};

export type WeeklyInsights = {
  mostActiveOwner: string | null;
  mostActiveGames: number;
  mostLiveOwner: string | null;
  mostLiveGames: number;
  totalLiveOwnedGames: number;
  totalOwnedGames: number;
  ownedVsOwnedGames: number;
  leaderThisWeek: string | null;
  leaderWins: number;
  leaderProjectedWins: number;
};

export type LeagueGameTag = 'swing' | 'upset' | 'even';
export const LEAGUE_TAG_PRIORITY: Record<LeagueGameTag, number> = {
  swing: 3,
  upset: 2,
  even: 1,
};
export const LEAGUE_TAG_LABELS: Record<LeagueGameTag, string> = {
  swing: 'Swing',
  upset: 'Upset alert',
  even: 'Even spread',
};

function getState(score?: ScorePack): 'scheduled' | 'inprogress' | 'final' | 'unknown' {
  return gameStateFromScore(score);
}

function addOwnerCount(counter: Map<string, number>, owner: string | undefined): void {
  if (!owner) return;
  counter.set(owner, (counter.get(owner) ?? 0) + 1);
}

function sideIdentityCandidates(game: AppGame, side: 'away' | 'home'): string[] {
  const participant = game.participants[side];
  const teamId = getGameParticipantTeamId(game, side);
  const csvName = side === 'away' ? game.csvAway : game.csvHome;
  const canonicalName = side === 'away' ? game.canAway : game.canHome;

  const raw = [
    teamId,
    participant.kind === 'team' ? participant.canonicalName : null,
    participant.kind === 'team' ? participant.displayName : null,
    participant.kind === 'team' ? participant.rawName : null,
    canonicalName,
    csvName,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

  const unique: string[] = [];
  const seen = new Set<string>();
  for (const value of raw) {
    if (seen.has(value)) continue;
    seen.add(value);
    unique.push(value);
  }
  return unique;
}

function ownerForSide(
  game: AppGame,
  side: 'away' | 'home',
  ownershipMap: Map<string, string>
): string | undefined {
  for (const candidate of sideIdentityCandidates(game, side)) {
    const owner = ownershipMap.get(candidate);
    if (owner) return owner;
  }
  return undefined;
}

function ownerTeamSides(
  game: AppGame,
  ownershipMap: Map<string, string>
): { awayOwner?: string; homeOwner?: string } {
  return {
    awayOwner: ownerForSide(game, 'away', ownershipMap),
    homeOwner: ownerForSide(game, 'home', ownershipMap),
  };
}

function scoreForSide(score: ScorePack, side: 'away' | 'home'): number | null {
  return side === 'away' ? score.away.score : score.home.score;
}

function spreadMagnitude(odds?: CombinedOdds): number | null {
  if (!odds) return null;
  if (typeof odds.spread === 'number') return Math.abs(odds.spread);
  if (typeof odds.homeSpread === 'number') return Math.abs(odds.homeSpread);
  if (typeof odds.awaySpread === 'number') return Math.abs(odds.awaySpread);
  return null;
}

function favoriteSideFromOdds(game: AppGame, odds?: CombinedOdds): 'away' | 'home' | null {
  if (!odds) return null;

  if (typeof odds.homeSpread === 'number' && typeof odds.awaySpread === 'number') {
    if (odds.homeSpread < odds.awaySpread) return 'home';
    if (odds.awaySpread < odds.homeSpread) return 'away';
  }

  if (odds.favorite) {
    const favoriteKey = normalizeTeamName(odds.favorite);
    const homeKeys = new Set(
      sideIdentityCandidates(game, 'home').map((value) => normalizeTeamName(value))
    );
    const awayKeys = new Set(
      sideIdentityCandidates(game, 'away').map((value) => normalizeTeamName(value))
    );
    if (homeKeys.has(favoriteKey)) return 'home';
    if (awayKeys.has(favoriteKey)) return 'away';
  }

  return null;
}

function projectedWinsForOwner(
  game: AppGame,
  score: ScorePack,
  owner: string,
  ownershipMap: Map<string, string>,
  includeFinals: boolean
): number {
  const { awayOwner, homeOwner } = ownerTeamSides(game, ownershipMap);
  const awayScore = score.away.score;
  const homeScore = score.home.score;
  if (awayScore == null || homeScore == null) return 0;

  const state = getState(score);
  const awayWinning = awayScore > homeScore;
  const homeWinning = homeScore > awayScore;

  if (state !== 'inprogress' && (!includeFinals || state !== 'final')) return 0;

  let wins = 0;
  if (awayOwner === owner && awayWinning) wins += 1;
  if (homeOwner === owner && homeWinning) wins += 1;
  return wins;
}

export function computeStandings(
  games: AppGame[],
  scores: Record<string, ScorePack>,
  ownershipMap: Map<string, string>
): LeagueStandingRow[] {
  const owners = Array.from(new Set(ownershipMap.values())).sort((a, b) => a.localeCompare(b));
  const base = new Map<string, LeagueStandingRow>(
    owners.map((owner) => [
      owner,
      { owner, wins: 0, losses: 0, winPct: 0, pointDiff: 0, liveGames: 0 },
    ])
  );

  for (const game of games) {
    const score = scores[game.key];
    const state = getState(score);
    const { awayOwner, homeOwner } = ownerTeamSides(game, ownershipMap);

    if (state === 'inprogress') {
      if (awayOwner) base.get(awayOwner)!.liveGames += 1;
      if (homeOwner) base.get(homeOwner)!.liveGames += 1;
    }

    if (!score || state !== 'final') continue;
    const awayScore = score.away.score;
    const homeScore = score.home.score;
    if (awayScore == null || homeScore == null) continue;

    if (awayOwner) {
      const row = base.get(awayOwner)!;
      row.pointDiff += awayScore - homeScore;
      if (awayScore > homeScore) row.wins += 1;
      if (awayScore < homeScore) row.losses += 1;
    }

    if (homeOwner) {
      const row = base.get(homeOwner)!;
      row.pointDiff += homeScore - awayScore;
      if (homeScore > awayScore) row.wins += 1;
      if (homeScore < awayScore) row.losses += 1;
    }
  }

  return Array.from(base.values())
    .map((row) => {
      const gamesPlayed = row.wins + row.losses;
      return {
        ...row,
        winPct: gamesPlayed > 0 ? row.wins / gamesPlayed : 0,
      };
    })
    .sort((left, right) => {
      if (right.winPct !== left.winPct) return right.winPct - left.winPct;
      if (right.wins !== left.wins) return right.wins - left.wins;
      if (right.pointDiff !== left.pointDiff) return right.pointDiff - left.pointDiff;
      return left.owner.localeCompare(right.owner);
    });
}

export function computeWeeklyInsights(
  games: AppGame[],
  scores: Record<string, ScorePack>,
  ownershipMap: Map<string, string>
): WeeklyInsights {
  const ownerGameCounts = new Map<string, number>();
  const ownerLiveCounts = new Map<string, number>();
  const ownerWins = new Map<string, number>();
  const ownerProjected = new Map<string, number>();
  let totalLiveOwnedGames = 0;
  let totalOwnedGames = 0;
  let ownedVsOwnedGames = 0;

  for (const game of games) {
    const score = scores[game.key];
    const state = getState(score);
    const { awayOwner, homeOwner } = ownerTeamSides(game, ownershipMap);

    const hasOwnedAway = Boolean(awayOwner);
    const hasOwnedHome = Boolean(homeOwner);
    if (hasOwnedAway || hasOwnedHome) totalOwnedGames += 1;
    if (hasOwnedAway && hasOwnedHome) ownedVsOwnedGames += 1;

    addOwnerCount(ownerGameCounts, awayOwner);
    addOwnerCount(ownerGameCounts, homeOwner);

    if (state === 'inprogress') {
      if (hasOwnedAway || hasOwnedHome) totalLiveOwnedGames += 1;
      addOwnerCount(ownerLiveCounts, awayOwner);
      addOwnerCount(ownerLiveCounts, homeOwner);
    }

    if (!score) continue;
    if (state === 'final') {
      const awayScore = scoreForSide(score, 'away');
      const homeScore = scoreForSide(score, 'home');
      if (awayScore != null && homeScore != null) {
        if (awayOwner && awayScore > homeScore)
          ownerWins.set(awayOwner, (ownerWins.get(awayOwner) ?? 0) + 1);
        if (homeOwner && homeScore > awayScore)
          ownerWins.set(homeOwner, (ownerWins.get(homeOwner) ?? 0) + 1);
      }
    }

    const owners = Array.from(
      new Set([awayOwner, homeOwner].filter((v): v is string => Boolean(v)))
    );
    for (const owner of owners) {
      const wins = projectedWinsForOwner(game, score, owner, ownershipMap, false);
      if (wins > 0) ownerProjected.set(owner, (ownerProjected.get(owner) ?? 0) + wins);
    }
  }

  const ownerPool = Array.from(
    new Set([
      ...ownershipMap.values(),
      ...ownerGameCounts.keys(),
      ...ownerLiveCounts.keys(),
      ...ownerWins.keys(),
      ...ownerProjected.keys(),
    ])
  );

  const pickLeader = (counter: Map<string, number>): { owner: string | null; count: number } => {
    let owner: string | null = null;
    let count = 0;
    for (const name of ownerPool) {
      const value = counter.get(name) ?? 0;
      if (
        value > count ||
        (value === count && value > 0 && owner && name.localeCompare(owner) < 0)
      ) {
        owner = name;
        count = value;
      }
      if (owner == null && value > 0) {
        owner = name;
        count = value;
      }
    }
    return { owner, count };
  };

  const activity = pickLeader(ownerGameCounts);
  const live = pickLeader(ownerLiveCounts);

  let leaderThisWeek: string | null = null;
  let leaderWins = 0;
  let leaderProjectedWins = 0;
  for (const owner of ownerPool) {
    const wins = ownerWins.get(owner) ?? 0;
    const projected = (ownerProjected.get(owner) ?? 0) + wins;
    if (
      projected > leaderProjectedWins ||
      (projected === leaderProjectedWins && wins > leaderWins) ||
      (projected === leaderProjectedWins &&
        wins === leaderWins &&
        leaderThisWeek &&
        owner.localeCompare(leaderThisWeek) < 0) ||
      (leaderThisWeek == null && projected > 0)
    ) {
      leaderThisWeek = owner;
      leaderWins = wins;
      leaderProjectedWins = projected;
    }
  }

  return {
    mostActiveOwner: activity.owner,
    mostActiveGames: activity.count,
    mostLiveOwner: live.owner,
    mostLiveGames: live.count,
    totalLiveOwnedGames,
    totalOwnedGames,
    ownedVsOwnedGames,
    leaderThisWeek,
    leaderWins,
    leaderProjectedWins,
  };
}

export function computeGameTags(
  game: AppGame,
  score: ScorePack | undefined,
  odds: CombinedOdds | undefined,
  ownershipMap: Map<string, string>,
  spreadThreshold = 3
): LeagueGameTag[] {
  const tags: LeagueGameTag[] = [];
  const { awayOwner, homeOwner } = ownerTeamSides(game, ownershipMap);

  if (awayOwner && homeOwner && awayOwner !== homeOwner) {
    tags.push('swing');
  }

  const state = getState(score);
  if (score && state === 'inprogress') {
    const awayScore = score.away.score;
    const homeScore = score.home.score;
    const favoriteSide = favoriteSideFromOdds(game, odds);

    if (awayScore != null && homeScore != null && favoriteSide) {
      const underdogLeading =
        (favoriteSide === 'home' && awayScore > homeScore) ||
        (favoriteSide === 'away' && homeScore > awayScore);
      if (underdogLeading) tags.push('upset');
    }
  }

  const spread = spreadMagnitude(odds);
  if (spread != null && spread <= spreadThreshold) {
    tags.push('even');
  }

  return tags;
}

export function prioritizeGameTags(tags: LeagueGameTag[]): {
  primary: LeagueGameTag | null;
  secondary: LeagueGameTag[];
} {
  if (tags.length === 0) return { primary: null, secondary: [] };
  const deduped = Array.from(new Set(tags));
  deduped.sort((left, right) => LEAGUE_TAG_PRIORITY[right] - LEAGUE_TAG_PRIORITY[left]);
  const [primary, ...secondary] = deduped;
  return { primary: primary ?? null, secondary };
}

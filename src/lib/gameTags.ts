import { gameStateFromScore } from './gameUi.ts';
import type { OverviewGameItem } from './overview.ts';
import type { TeamRankingEnrichment } from './rankings.ts';
import { getGameParticipantTeamId, type AppGame } from './schedule.ts';
import type { ScorePack } from './scores.ts';
import type { CombinedOdds } from './odds.ts';
import type { OwnerStandingsRow } from './standings.ts';
import { hasEquivalentTeamName } from './teamIdentity.ts';

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

export type OverviewHighlightSignals = {
  topMatchupKey: string | null;
  upsetWatchKeys: string[];
  rankedHighlightKey: string | null;
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
type OwnerMovementDelta = {
  owner: string;
  winsDelta: number;
  lossesDelta: number;
  pointDiffDelta: number;
};

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

function rankingPairForItem(
  item: OverviewGameItem,
  rankingsByTeamId: Map<string, TeamRankingEnrichment>
): { awayRank: number | null; homeRank: number | null } {
  return {
    awayRank: teamRankForGameSide(item, 'away', rankingsByTeamId),
    homeRank: teamRankForGameSide(item, 'home', rankingsByTeamId),
  };
}

function deriveMovementInsights(params: {
  standings: OwnerStandingsRow[];
  previousStandings?: OwnerStandingsRow[] | null;
}): Insight[] {
  const { standings, previousStandings } = params;
  if (!previousStandings?.length) return [];

  const previousByOwner = new Map(previousStandings.map((row) => [row.owner, row]));
  const deltas: OwnerMovementDelta[] = standings.map((row) => {
    const previous = previousByOwner.get(row.owner);
    return {
      owner: row.owner,
      winsDelta: row.wins - (previous?.wins ?? 0),
      lossesDelta: row.losses - (previous?.losses ?? 0),
      pointDiffDelta: row.pointDifferential - (previous?.pointDifferential ?? 0),
    };
  });

  const biggestGain = deltas
    .filter((delta) => delta.winsDelta > 0)
    .sort((left, right) => {
      if (right.winsDelta !== left.winsDelta) return right.winsDelta - left.winsDelta;
      if (right.pointDiffDelta !== left.pointDiffDelta)
        return right.pointDiffDelta - left.pointDiffDelta;
      return left.owner.localeCompare(right.owner);
    })[0];

  const biggestDrop = deltas
    .filter((delta) => delta.lossesDelta > 0)
    .sort((left, right) => {
      if (right.lossesDelta !== left.lossesDelta) return right.lossesDelta - left.lossesDelta;
      if (left.pointDiffDelta !== right.pointDiffDelta)
        return left.pointDiffDelta - right.pointDiffDelta;
      return left.owner.localeCompare(right.owner);
    })[0];

  const insights: Insight[] = [];
  if (biggestGain) {
    const { owner, winsDelta } = biggestGain;
    insights.push({
      id: `biggest-gain-${owner}`,
      text: `Biggest gain: ${owner} (+${winsDelta} wins)`,
      priority: 99,
    });
  }

  if (biggestDrop) {
    const { owner, lossesDelta } = biggestDrop;
    insights.push({
      id: `biggest-drop-${owner}`,
      text: `Biggest drop: ${owner} (-${lossesDelta})`,
      priority: 97,
    });
  }

  return insights;
}

export function deriveGameMovementInsights({
  standings,
  previousStandings,
  recentResults,
  liveGames,
  rankingsByTeamId,
}: LeagueInsightsInput): Insight[] {
  const insights: Insight[] = [];
  const leader = standings[0];
  const runnerUp = standings[1];

  insights.push(...deriveMovementInsights({ standings, previousStandings }));

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

export function deriveOverviewHighlightSignals(params: {
  keyMatchups: OverviewGameItem[];
  rankingsByTeamId: Map<string, TeamRankingEnrichment>;
}): OverviewHighlightSignals {
  const { keyMatchups, rankingsByTeamId } = params;
  const dedupedByKey = new Map<string, OverviewGameItem>();
  keyMatchups.forEach((item) => {
    dedupedByKey.set(item.bucket.game.key, item);
  });
  const displayedItems = Array.from(dedupedByKey.values());

  const topMatchup = displayedItems
    .filter((item) =>
      Boolean(
        item.bucket.awayOwner &&
          item.bucket.homeOwner &&
          item.bucket.awayOwner !== item.bucket.homeOwner
      )
    )
    .map((item) => {
      const { awayRank, homeRank } = rankingPairForItem(item, rankingsByTeamId);
      const margin = gameMargin(item);
      const ownedVsOwned = Boolean(
        item.bucket.awayOwner &&
          item.bucket.homeOwner &&
          item.bucket.awayOwner !== item.bucket.homeOwner
      );
      const closeGame = margin != null && margin <= 7;
      const isLive = gameStateFromScore(item.score) === 'inprogress';
      const rankedBonus =
        awayRank != null && homeRank != null ? 2 : awayRank != null || homeRank != null ? 1 : 0;

      return {
        item,
        ownedVsOwned,
        closeGame,
        isLive,
        rankedBonus,
        kickoff: new Date(item.bucket.game.date ?? '').getTime(),
      };
    })
    .sort((left, right) => {
      if (left.ownedVsOwned !== right.ownedVsOwned) return left.ownedVsOwned ? -1 : 1;
      if (left.closeGame !== right.closeGame) return left.closeGame ? -1 : 1;
      if (left.isLive !== right.isLive) return left.isLive ? -1 : 1;
      if (left.rankedBonus !== right.rankedBonus) return right.rankedBonus - left.rankedBonus;
      if (
        Number.isFinite(left.kickoff) &&
        Number.isFinite(right.kickoff) &&
        left.kickoff !== right.kickoff
      ) {
        return left.kickoff - right.kickoff;
      }
      return left.item.bucket.game.key.localeCompare(right.item.bucket.game.key);
    })[0];

  const upsetWatch = displayedItems
    .filter((item) => {
      if (gameStateFromScore(item.score) !== 'inprogress') return false;
      const { awayRank, homeRank } = rankingPairForItem(item, rankingsByTeamId);
      if (awayRank == null && homeRank == null) return false;
      const awayScore = item.score?.away.score;
      const homeScore = item.score?.home.score;
      if (awayScore == null || homeScore == null || awayScore === homeScore) return false;

      const awayFavorite = awayRank != null && (homeRank == null || awayRank < homeRank);
      const homeFavorite = homeRank != null && (awayRank == null || homeRank < awayRank);
      if (!awayFavorite && !homeFavorite) return false;

      return (awayFavorite && awayScore < homeScore) || (homeFavorite && homeScore < awayScore);
    })
    .sort((left, right) => {
      const leftMargin = gameMargin(left) ?? 0;
      const rightMargin = gameMargin(right) ?? 0;
      if (rightMargin !== leftMargin) return rightMargin - leftMargin;
      return left.bucket.game.key.localeCompare(right.bucket.game.key);
    })
    .slice(0, 2)
    .map((item) => item.bucket.game.key);

  const rankedHighlight = displayedItems
    .map((item) => {
      const { awayRank, homeRank } = rankingPairForItem(item, rankingsByTeamId);
      const ranks = [awayRank, homeRank].filter((rank): rank is number => rank != null);
      if (ranks.length === 0) return null;
      const bestRank = Math.min(...ranks);
      const hasTwoRanked = ranks.length === 2;
      return { item, bestRank, hasTwoRanked };
    })
    .filter(
      (value): value is { item: OverviewGameItem; bestRank: number; hasTwoRanked: boolean } =>
        value !== null
    )
    .sort((left, right) => {
      if (left.hasTwoRanked !== right.hasTwoRanked) return left.hasTwoRanked ? -1 : 1;
      if (left.bestRank !== right.bestRank) return left.bestRank - right.bestRank;
      return left.item.bucket.game.key.localeCompare(right.item.bucket.game.key);
    })[0];

  return {
    topMatchupKey: topMatchup?.item.bucket.game.key ?? null,
    upsetWatchKeys: upsetWatch,
    rankedHighlightKey: rankedHighlight?.item.bucket.game.key ?? null,
  };
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

export type LeagueGameTag = 'upset' | 'upset_watch' | 'top_25_matchup';
export const LEAGUE_TAG_PRIORITY: Record<LeagueGameTag, number> = {
  upset: 3,
  upset_watch: 2,
  top_25_matchup: 1,
};
export const LEAGUE_TAG_LABELS: Record<LeagueGameTag, string> = {
  upset: 'Upset',
  upset_watch: 'Upset watch',
  top_25_matchup: 'Top 25',
};

function getState(score?: ScorePack): 'scheduled' | 'inprogress' | 'final' | 'unknown' {
  return gameStateFromScore(score);
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
    return null;
  }

  if (odds.favorite) {
    if (hasEquivalentTeamName(odds.favorite, sideIdentityCandidates(game, 'home'))) return 'home';
    if (hasEquivalentTeamName(odds.favorite, sideIdentityCandidates(game, 'away'))) return 'away';
  }

  return null;
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

function rankForSide(
  game: AppGame,
  side: 'away' | 'home',
  rankingsByTeamId?: Map<string, TeamRankingEnrichment>
): number | null {
  if (!rankingsByTeamId) return null;
  const teamId = getGameParticipantTeamId(game, side);
  const fallback = side === 'away' ? game.canAway : game.canHome;
  const rank = rankingsByTeamId.get(teamId ?? fallback)?.rank ?? null;
  return typeof rank === 'number' ? rank : null;
}

function winnerSide(score: ScorePack): 'away' | 'home' | null {
  const awayScore = score.away.score;
  const homeScore = score.home.score;
  if (awayScore == null || homeScore == null || awayScore === homeScore) return null;
  return awayScore > homeScore ? 'away' : 'home';
}

function isRankedTop25(rank: number | null): rank is number {
  return rank != null && rank <= 25;
}

function isRankUpset(params: { winnerRank: number | null; loserRank: number | null }): boolean {
  const { winnerRank, loserRank } = params;
  if (loserRank == null) return false;
  if (winnerRank == null) return true;
  return winnerRank > loserRank;
}

export function computeGameTags(
  game: AppGame,
  score: ScorePack | undefined,
  odds: CombinedOdds | undefined,
  ownershipMap: Map<string, string>,
  rankingsByTeamId?: Map<string, TeamRankingEnrichment>,
  upsetSpreadThreshold = 6
): LeagueGameTag[] {
  const tags: LeagueGameTag[] = [];

  const awayRank = rankForSide(game, 'away', rankingsByTeamId);
  const homeRank = rankForSide(game, 'home', rankingsByTeamId);
  const hasTop25Matchup = isRankedTop25(awayRank) && isRankedTop25(homeRank);

  const state = getState(score);
  const favoriteSide = favoriteSideFromOdds(game, odds);
  const spread = spreadMagnitude(odds);

  if (score && state === 'final') {
    const winningSide = winnerSide(score);
    if (winningSide) {
      const losingSide = winningSide === 'away' ? 'home' : 'away';
      const winningRank = winningSide === 'away' ? awayRank : homeRank;
      const losingRank = losingSide === 'away' ? awayRank : homeRank;
      const rankUpset = isRankUpset({ winnerRank: winningRank, loserRank: losingRank });
      const oddsUpset =
        favoriteSide != null &&
        favoriteSide !== winningSide &&
        spread != null &&
        spread >= upsetSpreadThreshold;

      if (rankUpset || oddsUpset) {
        tags.push('upset');
      }
    }
  }

  if (
    state !== 'final' &&
    favoriteSide != null &&
    spread != null &&
    spread >= upsetSpreadThreshold
  ) {
    const underdogSide = favoriteSide === 'away' ? 'home' : 'away';
    const favoriteRank = favoriteSide === 'away' ? awayRank : homeRank;
    const underdogRank = underdogSide === 'away' ? awayRank : homeRank;

    const rankingTension =
      underdogRank != null && (favoriteRank == null || favoriteRank > underdogRank);

    let liveUnderdogLead = false;
    if (score && state === 'inprogress') {
      const leadingSide = winnerSide(score);
      liveUnderdogLead = leadingSide != null && leadingSide === underdogSide;
    }

    if (rankingTension || liveUnderdogLead) {
      tags.push('upset_watch');
    }
  }

  if (hasTop25Matchup) {
    tags.push('top_25_matchup');
  }

  void ownershipMap;

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

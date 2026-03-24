import { gameStateFromScore } from './gameUi.ts';
import type { OverviewGameItem } from './overview.ts';
import type { TeamRankingEnrichment } from './rankings.ts';
import { getGameParticipantTeamId } from './schedule.ts';
import type { OwnerStandingsRow } from './standings.ts';

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

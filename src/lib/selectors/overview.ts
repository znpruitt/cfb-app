import {
  deriveGameHighlightTags,
  deriveLeagueInsights,
  deriveOverviewHighlightSignals,
  type OverviewHighlightSignals,
} from '../leagueInsights';
import { gameStateFromScore } from '../gameUi';
import { isTruePostseasonGame } from '../postseason-display';
import type { TeamRankingEnrichment } from '../rankings';
import { getGameParticipantTeamId } from '../schedule';
import type { OverviewContext, OverviewGameItem } from '../overview';
import type { OwnerStandingsRow, StandingsCoverage } from '../standings';

// Canonical → Derived invariant: overview selectors consume canonical snapshot inputs
// and return pure, presentation-agnostic derived data.
type LeagueSummaryPhase = 'inSeason' | 'postseason' | 'complete';

export type LeagueSummaryViewModel = {
  phase: LeagueSummaryPhase;
  headline: string;
  metricSignal: string;
  placementSummary: string;
  progressSignal: string;
  supportingCopy: string;
  hasTieAtTop: boolean;
};

export type PrioritizedOverviewItem = {
  item: OverviewGameItem;
  isTopMatchup: boolean;
  isUpsetWatch: boolean;
  isRankedSpotlight: boolean;
  hasPriorityHighlight: boolean;
  highlightLabel: string | null;
  highlightTags: ReturnType<typeof deriveGameHighlightTags>;
};

export type OverviewViewModel = {
  championSummary: LeagueSummaryViewModel | null;
  standingsTopN: OwnerStandingsRow[];
  standingsHasMore: boolean;
  standingsContext: string | null;
  keyMovements: { id: string; text: string }[];
  featuredMatchups: PrioritizedOverviewItem[];
  recentResults: PrioritizedOverviewItem[];
  leagueHighlights: {
    id: string;
    label: string;
    text: string;
    linkTarget: 'schedule' | 'matchups' | 'matrix' | 'standings';
  }[];
};

export const OVERVIEW_STANDINGS_LIMIT = 5;
export const OVERVIEW_FEATURED_MATCHUPS_LIMIT = 4;
export const OVERVIEW_RESULTS_LIMIT = 5;

function formatDiff(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function formatPctGap(value: number): string {
  return value.toFixed(3);
}

function deriveLeagueSummaryPhase(params: {
  liveItems: OverviewGameItem[];
  keyMatchups: OverviewGameItem[];
  standingsCoverage: StandingsCoverage;
}): LeagueSummaryPhase {
  const allItems = [...params.liveItems, ...params.keyMatchups];
  const hasPostseasonGames = allItems.some((item) => isTruePostseasonGame(item.bucket.game));
  if (!hasPostseasonGames) return 'inSeason';

  const hasActiveOrUpcomingPostseasonGame = allItems.some((item) => {
    if (!isTruePostseasonGame(item.bucket.game)) return false;
    const state = gameStateFromScore(item.score);
    return state === 'inprogress' || state === 'scheduled' || state === 'unknown';
  });

  if (hasActiveOrUpcomingPostseasonGame) return 'postseason';
  return params.standingsCoverage.state === 'complete' ? 'complete' : 'postseason';
}

function deriveLeagueSummaryStatusLabel(
  phase: LeagueSummaryPhase,
  context: OverviewContext
): string {
  if (phase === 'complete') return 'Season complete';
  if (phase === 'postseason') return 'Postseason';

  const scopeDetail = context.scopeDetail?.trim();
  if (scopeDetail && /^week\s+\d+/i.test(scopeDetail)) {
    return scopeDetail.replace(/^week/i, 'Week');
  }

  return 'Regular season';
}

export function deriveLeagueSummaryViewModel(params: {
  standingsLeaders: OwnerStandingsRow[];
  context: OverviewContext;
  liveItems: OverviewGameItem[];
  keyMatchups: OverviewGameItem[];
  standingsCoverage: StandingsCoverage;
}): LeagueSummaryViewModel | null {
  const { standingsLeaders, context, liveItems, keyMatchups, standingsCoverage } = params;
  const leader = standingsLeaders[0];
  const runnerUp = standingsLeaders[1];
  const thirdPlace = standingsLeaders[2];
  if (!leader) return null;

  const phase = deriveLeagueSummaryPhase({ liveItems, keyMatchups, standingsCoverage });
  const hasTieAtTop = runnerUp ? runnerUp.winPct === leader.winPct : false;
  const winPctGap = runnerUp ? Math.max(0, leader.winPct - runnerUp.winPct) : 0;
  const progressSignal = deriveLeagueSummaryStatusLabel(phase, context);
  const placementSummary = [runnerUp, thirdPlace]
    .map((row, index) => (row ? `#${index + 2} ${row.owner} ${row.wins}–${row.losses}` : null))
    .filter((value): value is string => value !== null)
    .join(' · ');
  const metricSignal =
    phase === 'inSeason'
      ? runnerUp
        ? hasTieAtTop
          ? 'Gap tied'
          : `Gap #2 ${formatPctGap(winPctGap)}`
        : 'Gap #2 —'
      : `Diff ${formatDiff(leader.pointDifferential)}`;

  return {
    phase,
    hasTieAtTop,
    metricSignal,
    placementSummary,
    progressSignal,
    supportingCopy: placementSummary.length > 0 ? placementSummary : progressSignal,
    headline:
      phase === 'complete'
        ? `Champion: ${leader.owner}`
        : phase === 'postseason'
          ? 'Championship race'
          : `League leader: ${leader.owner}`,
  };
}

export function prioritizeOverviewItems(params: {
  items: OverviewGameItem[];
  highlightSignals: OverviewHighlightSignals;
  rankingsByTeamId: Map<string, TeamRankingEnrichment>;
  topOwnerNames: Set<string>;
}): PrioritizedOverviewItem[] {
  const { items, highlightSignals, rankingsByTeamId, topOwnerNames } = params;
  const upsetWatchSet = new Set(highlightSignals.upsetWatchKeys);
  const consumed = new Set<string>();
  const ordered: OverviewGameItem[] = [];
  const pushByKey = (key: string | null): void => {
    if (!key || consumed.has(key)) return;
    const match = items.find((item) => item.bucket.game.key === key);
    if (!match) return;
    consumed.add(key);
    ordered.push(match);
  };

  pushByKey(highlightSignals.topMatchupKey);
  highlightSignals.upsetWatchKeys.forEach((key) => pushByKey(key));
  pushByKey(highlightSignals.rankedHighlightKey);
  items.forEach((item) => {
    if (!consumed.has(item.bucket.game.key)) ordered.push(item);
  });

  return ordered.map((item) => {
    const highlightTags = deriveGameHighlightTags({
      item,
      rankingsByTeamId,
      topOwners: topOwnerNames,
    });
    const isTopMatchup = highlightSignals.topMatchupKey === item.bucket.game.key;
    const isUpsetWatch = upsetWatchSet.has(item.bucket.game.key);
    const isRankedSpotlight =
      highlightSignals.rankedHighlightKey === item.bucket.game.key &&
      !isTopMatchup &&
      !isUpsetWatch;
    const hasTopMatchupTag = highlightTags.some((tag) => tag.id === 'topMatchup');

    return {
      item,
      isTopMatchup,
      isUpsetWatch,
      isRankedSpotlight,
      hasPriorityHighlight: highlightTags.some(
        (tag) => tag.id === 'top25' || tag.id === 'topMatchup'
      ),
      highlightTags,
      highlightLabel: isUpsetWatch
        ? 'Upset watch'
        : isRankedSpotlight
          ? 'Ranked spotlight'
          : isTopMatchup && !hasTopMatchupTag
            ? 'Top matchup'
            : null,
    };
  });
}

export function deriveStandingsContextLabel(standingsLeaders: OwnerStandingsRow[]): string | null {
  if (standingsLeaders.length < 2) return null;
  const leader = standingsLeaders[0];
  const runnerUp = standingsLeaders[1];
  const gap = Math.max(0, leader.winPct - runnerUp.winPct);
  if (gap > 0.03) return null;
  return `Tight race: ${leader.owner} and ${runnerUp.owner} are separated by ${formatPctGap(gap)} win%.`;
}

function parseRecord(record: string): { leftWins: number; rightWins: number } | null {
  const match = record.match(/^\s*(\d+)\D+(\d+)\s*$/u);
  if (!match) return null;
  return {
    leftWins: Number(match[1]),
    rightWins: Number(match[2]),
  };
}

function compareOwnerPair(left: [string, string], right: [string, string]): number {
  return left[0] === right[0] ? left[1].localeCompare(right[1]) : left[0].localeCompare(right[0]);
}

function deriveMatchupInsights(matrix: {
  owners: string[];
  rows: { owner: string; cells: { owner: string; gameCount: number; record?: string | null }[] }[];
}): {
  mostFrequent?: {
    owners: [string, string];
    gameCount: number;
  };
  mostUnbalanced?: {
    owners: [string, string];
    record: string;
  };
  mostCompetitive?: {
    owners: [string, string];
    record: string;
    remainingGames: number;
  };
  mostActiveOwner?: {
    owner: string;
    totalMatchups: number;
  };
} {
  const pairRows: { owners: [string, string]; gameCount: number; record: string | null }[] = [];
  const activeOwnerCounts = new Map<string, number>();

  for (const row of matrix.rows) {
    for (const cell of row.cells) {
      if (cell.owner === row.owner) continue;
      if (row.owner.localeCompare(cell.owner) >= 0) continue;
      const owners: [string, string] = [row.owner, cell.owner];
      pairRows.push({
        owners,
        gameCount: cell.gameCount,
        record: cell.record ?? null,
      });

      if (cell.gameCount > 0) {
        activeOwnerCounts.set(row.owner, (activeOwnerCounts.get(row.owner) ?? 0) + cell.gameCount);
        activeOwnerCounts.set(
          cell.owner,
          (activeOwnerCounts.get(cell.owner) ?? 0) + cell.gameCount
        );
      }
    }
  }

  const mostFrequent = pairRows
    .filter((pair) => pair.gameCount > 0)
    .sort((left, right) => {
      if (right.gameCount !== left.gameCount) return right.gameCount - left.gameCount;
      return compareOwnerPair(left.owners, right.owners);
    })[0];

  const parsedRecords = pairRows
    .map((pair) => {
      const parsed = pair.record ? parseRecord(pair.record) : null;
      if (!parsed) return null;
      return { ...pair, parsed };
    })
    .filter(
      (
        value
      ): value is {
        owners: [string, string];
        gameCount: number;
        record: string;
        parsed: { leftWins: number; rightWins: number };
      } => value !== null
    );

  const mostUnbalanced = parsedRecords
    .filter((pair) => pair.gameCount > 0)
    .sort((left, right) => {
      const leftGap = Math.abs(left.parsed.leftWins - left.parsed.rightWins);
      const rightGap = Math.abs(right.parsed.leftWins - right.parsed.rightWins);
      if (rightGap !== leftGap) return rightGap - leftGap;
      if (right.gameCount !== left.gameCount) return right.gameCount - left.gameCount;
      return compareOwnerPair(left.owners, right.owners);
    })[0];

  const mostCompetitive = parsedRecords
    .filter((pair) => pair.gameCount > 0)
    .sort((left, right) => {
      const leftGap = Math.abs(left.parsed.leftWins - left.parsed.rightWins);
      const rightGap = Math.abs(right.parsed.leftWins - right.parsed.rightWins);
      if (leftGap !== rightGap) return leftGap - rightGap;
      const leftRemaining = Math.max(
        0,
        left.gameCount - left.parsed.leftWins - left.parsed.rightWins
      );
      const rightRemaining = Math.max(
        0,
        right.gameCount - right.parsed.leftWins - right.parsed.rightWins
      );
      if (rightRemaining !== leftRemaining) return rightRemaining - leftRemaining;
      if (right.gameCount !== left.gameCount) return right.gameCount - left.gameCount;
      return compareOwnerPair(left.owners, right.owners);
    })[0];

  const mostActiveOwner = Array.from(activeOwnerCounts.entries())
    .sort((left, right) => {
      if (right[1] !== left[1]) return right[1] - left[1];
      return left[0].localeCompare(right[0]);
    })
    .map(([owner, totalMatchups]) => ({ owner, totalMatchups }))[0];

  return {
    ...(mostFrequent
      ? { mostFrequent: { owners: mostFrequent.owners, gameCount: mostFrequent.gameCount } }
      : {}),
    ...(mostUnbalanced
      ? { mostUnbalanced: { owners: mostUnbalanced.owners, record: mostUnbalanced.record } }
      : {}),
    ...(mostCompetitive
      ? {
          mostCompetitive: {
            owners: mostCompetitive.owners,
            record: mostCompetitive.record,
            remainingGames: Math.max(
              0,
              mostCompetitive.gameCount -
                mostCompetitive.parsed.leftWins -
                mostCompetitive.parsed.rightWins
            ),
          },
        }
      : {}),
    ...(mostActiveOwner ? { mostActiveOwner } : {}),
  };
}

function deriveScopePhrase(context: OverviewContext): string {
  const detail = context.scopeDetail?.trim();
  if (!detail) return 'this slate';
  if (/^week\s+\d+/i.test(detail)) return 'this week';
  if (/postseason/i.test(detail) || /postseason/i.test(context.scopeLabel))
    return 'this postseason slate';
  return detail.toLowerCase();
}

function scoreMargin(item: OverviewGameItem): number | null {
  const away = item.score?.away.score;
  const home = item.score?.home.score;
  if (away == null || home == null) return null;
  return Math.abs(away - home);
}

function winnerText(item: OverviewGameItem): string | null {
  const awayScore = item.score?.away.score;
  const homeScore = item.score?.home.score;
  if (awayScore == null || homeScore == null) return null;
  if (awayScore === homeScore) return null;
  const winner = awayScore > homeScore ? item.bucket.game.csvAway : item.bucket.game.csvHome;
  const loser = awayScore > homeScore ? item.bucket.game.csvHome : item.bucket.game.csvAway;
  const margin = Math.abs(awayScore - homeScore);
  return `${winner} beat ${loser} by ${margin}`;
}

function deriveLeagueHighlights(params: {
  finalItems: PrioritizedOverviewItem[];
  allMatchups: OverviewGameItem[];
  movementInsights: { id: string; text: string }[];
  matchupMatrix: {
    owners: string[];
    rows: {
      owner: string;
      cells: { owner: string; gameCount: number; record?: string | null }[];
    }[];
  };
  rankingsByTeamId: Map<string, TeamRankingEnrichment>;
  context: OverviewContext;
}): OverviewViewModel['leagueHighlights'] {
  const scopePhrase = deriveScopePhrase(params.context);
  const highlights: OverviewViewModel['leagueHighlights'] = [];
  const finals = params.finalItems.map((entry) => entry.item);
  const seen = new Set<string>();
  const push = (entry: OverviewViewModel['leagueHighlights'][number] | null): void => {
    if (!entry || seen.has(entry.id)) return;
    seen.add(entry.id);
    highlights.push(entry);
  };

  const blowout = finals
    .filter((item) => (scoreMargin(item) ?? 0) >= 14)
    .sort((left, right) => {
      const marginDiff = (scoreMargin(right) ?? 0) - (scoreMargin(left) ?? 0);
      if (marginDiff !== 0) return marginDiff;
      return left.bucket.game.key.localeCompare(right.bucket.game.key);
    })[0];
  if (blowout) {
    push({
      id: `blowout-${blowout.bucket.game.key}`,
      label: 'Biggest win',
      text: `${winnerText(blowout)} (${scopePhrase})`,
      linkTarget: 'schedule',
    });
  }

  const closestFinish = finals
    .filter((item) => {
      const margin = scoreMargin(item);
      return margin != null && margin <= 7;
    })
    .sort((left, right) => {
      const marginDiff = (scoreMargin(left) ?? 99) - (scoreMargin(right) ?? 99);
      if (marginDiff !== 0) return marginDiff;
      return left.bucket.game.key.localeCompare(right.bucket.game.key);
    })[0];
  if (closestFinish) {
    push({
      id: `close-${closestFinish.bucket.game.key}`,
      label: 'Closest finish',
      text: `${winnerText(closestFinish)} (${scopePhrase})`,
      linkTarget: 'schedule',
    });
  }

  const rankedMatchup = params.allMatchups
    .map((item) => {
      const awayRank =
        params.rankingsByTeamId.get(
          getGameParticipantTeamId(item.bucket.game, 'away') ?? item.bucket.game.canAway
        )?.rank ?? null;
      const homeRank =
        params.rankingsByTeamId.get(
          getGameParticipantTeamId(item.bucket.game, 'home') ?? item.bucket.game.canHome
        )?.rank ?? null;
      if (awayRank == null || homeRank == null) return null;
      return { item, awayRank, homeRank, combinedRank: awayRank + homeRank };
    })
    .filter((value): value is NonNullable<typeof value> => value !== null)
    .sort((left, right) => {
      if (left.combinedRank !== right.combinedRank) return left.combinedRank - right.combinedRank;
      return left.item.bucket.game.key.localeCompare(right.item.bucket.game.key);
    })[0];
  if (rankedMatchup) {
    push({
      id: `ranked-${rankedMatchup.item.bucket.game.key}`,
      label: 'Top ranked matchup',
      text: `#${rankedMatchup.awayRank} ${rankedMatchup.item.bucket.game.csvAway} vs #${rankedMatchup.homeRank} ${rankedMatchup.item.bucket.game.csvHome} (${scopePhrase})`,
      linkTarget: 'matchups',
    });
  }

  const biggestGain = params.movementInsights.find((insight) =>
    insight.id.startsWith('biggest-gain-')
  );
  if (biggestGain) {
    push({
      id: biggestGain.id,
      label: 'Biggest gain',
      text: `${biggestGain.text} (${scopePhrase})`,
      linkTarget: 'standings',
    });
  }

  const ownerCounts = new Map<string, number>();
  params.allMatchups.forEach((item) => {
    if (item.bucket.awayOwner) {
      ownerCounts.set(item.bucket.awayOwner, (ownerCounts.get(item.bucket.awayOwner) ?? 0) + 1);
    }
    if (item.bucket.homeOwner) {
      ownerCounts.set(item.bucket.homeOwner, (ownerCounts.get(item.bucket.homeOwner) ?? 0) + 1);
    }
  });
  const mostGamesOwner = Array.from(ownerCounts.entries())
    .filter(([, count]) => count >= 3)
    .sort((left, right) => {
      if (right[1] !== left[1]) return right[1] - left[1];
      return left[0].localeCompare(right[0]);
    })[0];
  if (mostGamesOwner) {
    push({
      id: `most-games-${mostGamesOwner[0]}`,
      label: 'Most games this week',
      text: `${mostGamesOwner[0]} has ${mostGamesOwner[1]} teams playing (${scopePhrase})`,
      linkTarget: 'matchups',
    });
  }

  const matrixInsights = deriveMatchupInsights(params.matchupMatrix);
  if (matrixInsights.mostCompetitive) {
    const parsed = parseRecord(matrixInsights.mostCompetitive.record);
    const totalGames = parsed ? parsed.leftWins + parsed.rightWins : 0;
    if (totalGames >= 2 && parsed && parsed.leftWins === parsed.rightWins) {
      push({
        id: `split-${matrixInsights.mostCompetitive.owners.join('-')}`,
        label: 'Split owner matchup',
        text: `${matrixInsights.mostCompetitive.owners[0]} vs ${matrixInsights.mostCompetitive.owners[1]} (${matrixInsights.mostCompetitive.record})`,
        linkTarget: 'matrix',
      });
    }
  } else if (matrixInsights.mostFrequent && matrixInsights.mostFrequent.gameCount >= 4) {
    push({
      id: `collision-${matrixInsights.mostFrequent.owners.join('-')}`,
      label: 'Heavy owner collision',
      text: `${matrixInsights.mostFrequent.owners[0]} vs ${matrixInsights.mostFrequent.owners[1]} has ${matrixInsights.mostFrequent.gameCount} head-to-head games`,
      linkTarget: 'matrix',
    });
  }

  return highlights.slice(0, 5);
}

export function selectOverviewViewModel(params: {
  standingsLeaders: OwnerStandingsRow[];
  previousStandingsLeaders?: OwnerStandingsRow[] | null;
  standingsCoverage: StandingsCoverage;
  context: OverviewContext;
  liveItems: OverviewGameItem[];
  keyMatchups: OverviewGameItem[];
  matchupMatrix: {
    owners: string[];
    rows: {
      owner: string;
      cells: { owner: string; gameCount: number; record?: string | null }[];
    }[];
  };
  rankingsByTeamId: Map<string, TeamRankingEnrichment>;
  standingsLimit?: number;
  featuredLimit?: number;
  resultsLimit?: number;
}): OverviewViewModel {
  const {
    standingsLeaders,
    previousStandingsLeaders = null,
    standingsCoverage,
    context,
    liveItems,
    keyMatchups,
    matchupMatrix,
    rankingsByTeamId,
    standingsLimit = OVERVIEW_STANDINGS_LIMIT,
    featuredLimit = OVERVIEW_FEATURED_MATCHUPS_LIMIT,
    resultsLimit = OVERVIEW_RESULTS_LIMIT,
  } = params;
  const topOwnerNames = new Set(standingsLeaders.slice(0, 3).map((row) => row.owner));
  const overviewMatchupCandidates = keyMatchups;
  const featuredCandidates = overviewMatchupCandidates.filter(
    (item) => gameStateFromScore(item.score) !== 'final'
  );
  const resultCandidates = overviewMatchupCandidates.filter(
    (item) => gameStateFromScore(item.score) === 'final'
  );
  const highlightSignals = deriveOverviewHighlightSignals({
    keyMatchups: overviewMatchupCandidates,
    rankingsByTeamId,
  });
  const prioritizedFeatured = prioritizeOverviewItems({
    items: featuredCandidates,
    highlightSignals,
    rankingsByTeamId,
    topOwnerNames,
  });
  const prioritizedResults = prioritizeOverviewItems({
    items: resultCandidates,
    highlightSignals,
    rankingsByTeamId,
    topOwnerNames,
  });
  const featuredMatchups = prioritizedFeatured.slice(0, featuredLimit);
  const recentResults = prioritizedResults.slice(0, resultsLimit);
  const movementInsights = deriveLeagueInsights({
    standings: standingsLeaders,
    previousStandings: previousStandingsLeaders,
    recentResults: keyMatchups,
    liveGames: liveItems,
    rankingsByTeamId,
  })
    .filter(
      (insight) =>
        insight.id.startsWith('leader-gap') ||
        insight.id.startsWith('biggest-gain-') ||
        insight.id.startsWith('biggest-drop-') ||
        insight.id.startsWith('rank-movement-')
    )
    .slice(0, 3)
    .map((insight) => ({ id: insight.id, text: insight.text }));

  return {
    championSummary: deriveLeagueSummaryViewModel({
      standingsLeaders,
      context,
      liveItems,
      keyMatchups,
      standingsCoverage,
    }),
    standingsTopN: standingsLeaders.slice(0, standingsLimit),
    standingsHasMore: standingsLeaders.length > standingsLimit,
    standingsContext: deriveStandingsContextLabel(standingsLeaders),
    keyMovements: movementInsights,
    featuredMatchups,
    recentResults,
    leagueHighlights: deriveLeagueHighlights({
      finalItems: prioritizedResults,
      allMatchups: overviewMatchupCandidates,
      movementInsights,
      matchupMatrix,
      rankingsByTeamId,
      context,
    }),
  };
}

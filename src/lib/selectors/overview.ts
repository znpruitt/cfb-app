import {
  deriveGameHighlightTags,
  deriveLeagueInsights,
  deriveOverviewHighlightSignals,
  type OverviewHighlightSignals,
} from '../leagueInsights';
import { gameStateFromScore } from '../gameUi';
import { isTruePostseasonGame } from '../postseason-display';
import type { TeamRankingEnrichment } from '../rankings';
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
  matrixPreview: {
    ownerCount: number;
    matchupCount: number;
  } | null;
};

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

function matrixMatchupCount(matrix: {
  rows: { owner: string; cells: { owner: string; gameCount: number }[] }[];
}): number {
  let total = 0;
  for (const row of matrix.rows) {
    for (const cell of row.cells) {
      if (row.owner === cell.owner) continue;
      total += cell.gameCount;
    }
  }
  return Math.floor(total / 2);
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
    rows: { owner: string; cells: { owner: string; gameCount: number }[] }[];
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
    standingsLimit = 5,
    featuredLimit = 4,
    resultsLimit = 5,
  } = params;
  const topOwnerNames = new Set(standingsLeaders.slice(0, 3).map((row) => row.owner));
  const highlightSignals = deriveOverviewHighlightSignals({ keyMatchups, rankingsByTeamId });
  const prioritizedAll = prioritizeOverviewItems({
    items: keyMatchups,
    highlightSignals,
    rankingsByTeamId,
    topOwnerNames,
  });
  const featuredMatchups = prioritizedAll
    .filter((entry) => {
      return gameStateFromScore(entry.item.score) !== 'final';
    })
    .slice(0, featuredLimit);
  const recentResults = prioritizedAll
    .filter((entry) => {
      return gameStateFromScore(entry.item.score) === 'final';
    })
    .slice(0, resultsLimit);

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
    keyMovements: deriveLeagueInsights({
      standings: standingsLeaders,
      previousStandings: previousStandingsLeaders,
      recentResults: keyMatchups,
      liveGames: liveItems,
      rankingsByTeamId,
    })
      .slice(0, 3)
      .map((insight) => ({ id: insight.id, text: insight.text })),
    featuredMatchups,
    recentResults,
    matrixPreview:
      matchupMatrix.owners.length === 0
        ? null
        : {
            ownerCount: matchupMatrix.owners.length,
            matchupCount: matrixMatchupCount(matchupMatrix),
          },
  };
}

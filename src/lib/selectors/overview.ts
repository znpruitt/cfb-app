import {
  deriveGameHighlightTags,
  deriveOverviewHighlightSignals,
  type OverviewHighlightSignals,
} from '../gameTags';
import { gameStateFromScore } from '../gameUi';
import { isTruePostseasonGame } from '../postseason-display';
import type { TeamRankingEnrichment } from '../rankings';
import type { OverviewContext, OverviewGameItem } from '../overview';
import type { StandingsHistory } from '../standingsHistory';
import type { OwnerStandingsRow, StandingsCoverage } from '../standings';
import type { CanonicalStandings } from './leagueStandings';
import { selectResolvedStandingsWeeks } from './historyResolution';
import {
  selectGamesBackTrend,
  selectWinBars,
  selectWinPctTrend,
  type GamesBackSeries,
  type WinBarsRow,
  type WinPctSeries,
} from './trends';
import { selectLeagueStorylines, type LeagueStoryline } from './storylines';
import { selectSeasonContext, type SeasonContext } from './seasonContext';

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
  heroNarrative: string | null;
  heroMode: 'leader' | 'podium';
  podiumLeaders: OwnerStandingsRow[];
  topTierLeaders: OwnerStandingsRow[];
  isTopTie: boolean;
  standingsTopN: OwnerStandingsRow[];
  previousStandingsLeaders: OwnerStandingsRow[];
  standingsHasMore: boolean;
  standingsContext: string | null;
  featuredMatchups: PrioritizedOverviewItem[];
  shouldShowFeaturedMatchups: boolean;
  recentResults: PrioritizedOverviewItem[];
  gamesBackTrend: GamesBackSeries[];
  winPctTrend: WinPctSeries[];
  winBars: WinBarsRow[];
  storylines: LeagueStoryline[];
};

/**
 * The Upcoming watchlist shows whenever it has matchups.
 *
 * This previously also required `leagueHighlights.length === 0`, an either/or
 * with a highlights section that rendered above it. That section no longer
 * exists — `leagueHighlights` is not on the view model and no component reads
 * it — so the condition suppressed the watchlist in favour of nothing. The
 * visible effect was an Overview whose entire games region was one empty
 * "No recent results yet" box while a full slate sat minutes from kickoff.
 *
 * The retired `leagueHighlights` gate and pulse derivation no longer participate
 * in this decision; the request-time weekly recap owns timely recap presentation.
 */
function deriveShouldShowFeaturedMatchups(params: {
  featuredMatchups: PrioritizedOverviewItem[];
}): boolean {
  return params.featuredMatchups.length > 0;
}

export const OVERVIEW_STANDINGS_LIMIT = 5;
export const OVERVIEW_FEATURED_MATCHUPS_LIMIT = 4;
export const OVERVIEW_RESULTS_LIMIT = 6;

/**
 * Conservative coverage returned when a canonical snapshot is supplied but its
 * required `coverage` is missing/null at runtime. We do NOT silently fall back
 * to client coverage in that case — a malformed canonical snapshot must not be
 * papered over with schedule-derived coverage.
 */
export const CANONICAL_COVERAGE_UNAVAILABLE: StandingsCoverage = {
  state: 'error',
  message: 'Standings coverage is unavailable.',
};

/**
 * Resolves which standings rows/history/coverage the Overview surface renders.
 *
 * Canonical is preferred: when a canonical snapshot is supplied, its `rows`
 * (even when empty), its `standingsHistory` (even when null), and its `coverage`
 * are used — never the client-derived equivalents. When canonical is supplied
 * but `coverage` is missing/null at runtime, `CANONICAL_COVERAGE_UNAVAILABLE`
 * is returned (defensive; the type keeps `coverage` required). The client-derived
 * `standingsLeaders`/`standingsHistory`/`standingsCoverage` are used only when NO
 * canonical snapshot is supplied (`undefined`/`null`, e.g. routes not yet loading
 * canonical). liveDelta and selected games are intentionally NOT part of this
 * resolution — liveDelta is not merged into rows this phase.
 */
export function resolveOverviewCanonicalInputs(params: {
  canonicalStandings?: CanonicalStandings | null;
  standingsLeaders: OwnerStandingsRow[];
  standingsHistory?: StandingsHistory | null;
  standingsCoverage: StandingsCoverage;
}): { rows: OwnerStandingsRow[]; history: StandingsHistory | null; coverage: StandingsCoverage } {
  const {
    canonicalStandings,
    standingsLeaders,
    standingsHistory = null,
    standingsCoverage,
  } = params;
  return {
    rows: canonicalStandings?.rows ?? standingsLeaders,
    history: canonicalStandings ? canonicalStandings.standingsHistory : (standingsHistory ?? null),
    coverage: canonicalStandings
      ? (canonicalStandings.coverage ?? CANONICAL_COVERAGE_UNAVAILABLE)
      : standingsCoverage,
  };
}

/**
 * Returns the standings snapshots from the latest fully-resolved week and the
 * one before it. Movement insights, rank-arrow comparisons, and any other
 * temporally-paired derivation should anchor on this pair so partial-week
 * unresolved state never causes the comparison to skip a week boundary.
 */
export function deriveResolvedMovementStandings(standingsHistory?: StandingsHistory | null): {
  latest: OwnerStandingsRow[] | null;
  previous: OwnerStandingsRow[] | null;
} {
  if (!standingsHistory || standingsHistory.weeks.length === 0) {
    return { latest: null, previous: null };
  }
  const { latestResolvedWeek, previousResolvedWeek } =
    selectResolvedStandingsWeeks(standingsHistory);
  return {
    latest:
      latestResolvedWeek != null
        ? (standingsHistory.byWeek[latestResolvedWeek]?.standings ?? null)
        : null,
    previous:
      previousResolvedWeek != null
        ? (standingsHistory.byWeek[previousResolvedWeek]?.standings ?? null)
        : null,
  };
}

function formatDiff(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function formatNameList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

function deriveTopTierLeaders(standingsLeaders: OwnerStandingsRow[]): OwnerStandingsRow[] {
  const leaderWinPct = standingsLeaders[0]?.winPct;
  if (leaderWinPct == null) return [];
  return standingsLeaders.filter((row) => row.winPct === leaderWinPct);
}

function deriveHeroNarrative(params: {
  summary: LeagueSummaryViewModel | null;
  standingsLeaders: OwnerStandingsRow[];
  topTierLeaders: OwnerStandingsRow[];
  isTopTie: boolean;
}): string | null {
  const { summary, standingsLeaders, topTierLeaders, isTopTie } = params;
  if (!summary) return null;
  const leader = standingsLeaders[0];
  if (!leader) return null;
  const leaderRecord = `${leader.wins}–${leader.losses}`;
  const leaderRecordWithPct = `${leaderRecord} (${formatPctGap(leader.winPct)})`;
  if (isTopTie) {
    const tiedOwners = formatNameList(topTierLeaders.map((row) => row.owner));
    return summary.phase === 'complete'
      ? `${tiedOwners} finished tied for first at ${leaderRecord}`
      : `${tiedOwners} are tied for first at ${leaderRecordWithPct}`;
  }

  const runnerUp = standingsLeaders[1];
  const recordAndDiff = `${leader.wins}–${leader.losses} (${formatPctGap(leader.winPct)}), ${formatDiff(leader.pointDifferential)} diff`;
  if (!runnerUp) {
    return summary.phase === 'complete'
      ? `Finished ${recordAndDiff}.`
      : `Leads at ${recordAndDiff}.`;
  }

  const gbGap = runnerUp.gamesBack;
  const gbLabel =
    gbGap === 1
      ? '1 game'
      : Number.isInteger(gbGap)
        ? `${gbGap} games`
        : `${gbGap.toFixed(1)} games`;
  const pctGap = Math.max(0, leader.winPct - runnerUp.winPct);
  return summary.phase === 'complete'
    ? `${leader.owner} won the title by ${gbLabel} over ${runnerUp.owner}`
    : `Leads at ${recordAndDiff} • Ahead of ${runnerUp.owner} by ${formatPctGap(pctGap)}`;
}

function deriveHeroMode(
  championSummary: LeagueSummaryViewModel | null,
  standingsLeaders: OwnerStandingsRow[]
): 'leader' | 'podium' {
  if (championSummary?.phase === 'complete' && standingsLeaders.length >= 3) return 'podium';
  return 'leader';
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

  return items.map((item) => {
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

function compareWatchlistItems(a: OverviewGameItem, b: OverviewGameItem): number {
  if (a.sortDate !== b.sortDate) return a.sortDate - b.sortDate;
  if (a.priority !== b.priority) return b.priority - a.priority;
  return a.bucket.game.key.localeCompare(b.bucket.game.key);
}

function compareRecentResultItems(a: OverviewGameItem, b: OverviewGameItem): number {
  const aHasKickoff = Number.isFinite(a.sortDate);
  const bHasKickoff = Number.isFinite(b.sortDate);
  if (aHasKickoff !== bHasKickoff) return aHasKickoff ? -1 : 1;
  if (aHasKickoff && a.sortDate !== b.sortDate) return b.sortDate - a.sortDate;
  if (a.priority !== b.priority) return b.priority - a.priority;
  return a.bucket.game.key.localeCompare(b.bucket.game.key);
}

export function deriveStandingsContextLabel(standingsLeaders: OwnerStandingsRow[]): string | null {
  if (standingsLeaders.length < 2) return null;
  const leader = standingsLeaders[0];
  const runnerUp = standingsLeaders[1];
  const gap = Math.max(0, leader.winPct - runnerUp.winPct);
  if (gap > 0.03) return null;
  return `Tight race: ${leader.owner} and ${runnerUp.owner} are separated by ${formatPctGap(gap)} win%.`;
}

const NO_CLAIM_OWNER = 'NoClaim';

function postseasonRolePriority(role: string | null): number {
  if (role === 'national_championship') return 0;
  if (role === 'playoff') return 1;
  if (role === 'conference_championship') return 2;
  if (role === 'bowl') return 3;
  return 4;
}

function selectFeaturedGames(
  prioritized: PrioritizedOverviewItem[],
  limit: number
): PrioritizedOverviewItem[] {
  // Exclude games where both sides are NoClaim — no real owner is involved
  const eligible = prioritized.filter((p) => {
    const a = p.item.bucket.awayOwner;
    const h = p.item.bucket.homeOwner;
    return !(a === NO_CLAIM_OWNER && h === NO_CLAIM_OWNER);
  });

  const hasPostseasonGames = eligible.some((item) => item.item.bucket.game.postseasonRole != null);
  if (!hasPostseasonGames) return eligible.slice(0, limit);
  // In postseason context, sort by postseasonRole tier, preserving original order within each tier
  const indexed = eligible.map((item, i) => ({ item, i }));
  indexed.sort((a, b) => {
    const ap = postseasonRolePriority(a.item.item.bucket.game.postseasonRole);
    const bp = postseasonRolePriority(b.item.item.bucket.game.postseasonRole);
    return ap !== bp ? ap - bp : a.i - b.i;
  });
  return indexed.slice(0, limit).map(({ item }) => item);
}

export function selectOverviewViewModel(params: {
  standingsLeaders: OwnerStandingsRow[];
  standingsHistory?: StandingsHistory | null;
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
  /**
   * PLATFORM-109 remediation — the season context, when the caller already holds
   * one. The league routes derive it server-side from the UNSTRIPPED canonical
   * snapshot and pass it down, so this selector no longer re-derives a value that
   * already exists one layer up.
   *
   * Optional, and re-derived when absent — but the fallback is UNREACHED, and
   * WRONG IF REACHED. `selectSeasonContext` refuses to call a pending-less
   * history final unless every week was played, which is right for a season
   * still running and wrong for one that ended on an abandoned game: that week
   * is `played: false` precisely because something was pending, so once `pending`
   * is stripped the re-derivation answers `in-season` where the truth is `final`.
   * Measured on this branch — server `final`, prop `final`, stripped
   * re-derivation `in-season`.
   *
   * Nothing reaches it today: all five league routes pass the prop. An earlier
   * version of this note claimed the fallback was correct, which review
   * disproved. Making the parameter REQUIRED would delete the trap instead of
   * documenting it, at the cost of touching every test call site; recorded as a
   * follow-up rather than done here.
   *
   * Pass it. One derivation, one answer.
   */
  seasonContext?: SeasonContext;
  standingsLimit?: number;
  featuredLimit?: number;
  resultsLimit?: number;
}): OverviewViewModel {
  const {
    standingsLeaders,
    standingsHistory = null,
    standingsCoverage,
    context,
    liveItems,
    keyMatchups,
    rankingsByTeamId,
    seasonContext: seasonContextOverride,
    standingsLimit = OVERVIEW_STANDINGS_LIMIT,
    featuredLimit = OVERVIEW_FEATURED_MATCHUPS_LIMIT,
    resultsLimit = OVERVIEW_RESULTS_LIMIT,
  } = params;
  const resolvedMovement = deriveResolvedMovementStandings(standingsHistory);
  // Movement insights and CondensedStandingsTable rank arrows both compare
  // week-over-week resolved snapshots. When the latest week is partially
  // unresolved (some games not yet final), `standingsLeaders` reflects that
  // partial state and would skew the comparison by crossing two week
  // boundaries; pin `current` to the most recent fully-resolved week and fall
  // back to the raw rows only when no resolved history exists. Live-display
  // surfaces (top-3 hero, GB Race chart) keep using `standingsLeaders` directly
  // via OverviewPanel.
  const resolvedCurrent = resolvedMovement.latest ?? standingsLeaders;
  const previousStandings = resolvedMovement.previous;
  const topOwnerNames = new Set(standingsLeaders.slice(0, 3).map((row) => row.owner));
  const overviewMatchupCandidates = keyMatchups;
  const featuredCandidates = overviewMatchupCandidates
    .filter((item) => {
      const gameState = gameStateFromScore(item.score);
      return gameState !== 'final' && gameState !== 'inprogress';
    })
    .sort(compareWatchlistItems);
  const resultCandidates = overviewMatchupCandidates
    .filter((item) => gameStateFromScore(item.score) === 'final')
    .sort(compareRecentResultItems);
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
  const recentResults = selectFeaturedGames(prioritizedResults, resultsLimit);
  const gamesBackTrend = standingsHistory ? selectGamesBackTrend({ standingsHistory }) : [];
  const winPctTrend = standingsHistory ? selectWinPctTrend({ standingsHistory }) : [];
  const winBars = standingsHistory ? selectWinBars({ standingsHistory }) : [];
  const seasonContext = seasonContextOverride ?? selectSeasonContext({ standingsHistory });
  const storylines = selectLeagueStorylines({
    standingsHistory,
    gamesBackTrend,
    winPctTrend,
    winBars,
    seasonContext,
  });
  const championSummary = deriveLeagueSummaryViewModel({
    standingsLeaders,
    context,
    liveItems,
    keyMatchups,
    standingsCoverage,
  });
  const standingsContext = deriveStandingsContextLabel(standingsLeaders);
  const heroMode = deriveHeroMode(championSummary, standingsLeaders);
  const podiumLeaders = heroMode === 'podium' ? standingsLeaders.slice(0, 3) : [];
  const topTierLeaders = deriveTopTierLeaders(standingsLeaders);
  const isTopTie = topTierLeaders.length > 1;
  const heroNarrative = deriveHeroNarrative({
    summary: championSummary,
    standingsLeaders,
    topTierLeaders,
    isTopTie,
  });

  return {
    championSummary,
    heroNarrative,
    heroMode,
    podiumLeaders,
    topTierLeaders,
    isTopTie,
    standingsTopN: resolvedCurrent.slice(0, standingsLimit),
    previousStandingsLeaders: previousStandings ?? [],
    standingsHasMore: resolvedCurrent.length > standingsLimit,
    standingsContext,
    featuredMatchups,
    shouldShowFeaturedMatchups: deriveShouldShowFeaturedMatchups({ featuredMatchups }),
    recentResults,
    gamesBackTrend,
    winPctTrend,
    winBars,
    storylines,
  };
}

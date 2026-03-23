import { gameStateFromScore } from './gameUi.ts';
import { isTruePostseasonGame } from './postseason-display.ts';
import { chooseDefaultWeek, deriveRegularWeeks, filterGamesForWeek } from './weekSelection.ts';
import { deriveWeekMatchupSections, type MatchupBucket } from './matchups.ts';
import type { ScorePack } from './scores.ts';
import type { AppGame } from './schedule.ts';
import type { OwnerStandingsRow, StandingsCoverage } from './standings.ts';

export type OverviewGameItem = {
  bucket: MatchupBucket;
  score?: ScorePack;
  priority: number;
  sortDate: number;
};

export type OwnerMatchupMatrixCell = {
  owner: string;
  gameCount: number;
  record: string | null;
};

export type OwnerMatchupMatrixRow = {
  owner: string;
  cells: OwnerMatchupMatrixCell[];
};

export type OwnerMatchupMatrix = {
  owners: string[];
  rows: OwnerMatchupMatrixRow[];
};

export type OverviewSectionKind = 'standings' | 'matrix' | 'live' | 'highlights';

export type OverviewContext = {
  scopeLabel: string;
  scopeDetail: string | null;
  emphasis: 'live' | 'upcoming' | 'recent' | 'standings';
  highlightsTitle: string;
  highlightsDescription: string;
  liveDescription: string;
  sectionOrder: OverviewSectionKind[];
};

export type OverviewSnapshot = {
  standingsLeaders: OwnerStandingsRow[];
  matchupMatrix: OwnerMatchupMatrix;
  liveItems: OverviewGameItem[];
  keyMatchups: OverviewGameItem[];
  context: OverviewContext;
};

const DEFAULT_LIVE_ITEM_COUNT = 6;
const DEFAULT_KEY_MATCHUP_COUNT = 4;

function kickoffTimeValue(date: string | null): number {
  if (!date) return Number.POSITIVE_INFINITY;
  const value = new Date(date).getTime();
  return Number.isNaN(value) ? Number.POSITIVE_INFINITY : value;
}

function compareOverviewItems(a: OverviewGameItem, b: OverviewGameItem): number {
  if (b.priority !== a.priority) return b.priority - a.priority;
  if (a.sortDate !== b.sortDate) return a.sortDate - b.sortDate;
  return a.bucket.game.key.localeCompare(b.bucket.game.key);
}

function compareRecentOverviewItems(a: OverviewGameItem, b: OverviewGameItem): number {
  if (b.priority !== a.priority) return b.priority - a.priority;
  if (b.sortDate !== a.sortDate) return b.sortDate - a.sortDate;
  return a.bucket.game.key.localeCompare(b.bucket.game.key);
}

function toOverviewItem(bucket: MatchupBucket, score?: ScorePack): OverviewGameItem {
  return {
    bucket,
    score,
    priority: bucket.awayOwner && bucket.homeOwner ? 2 : 1,
    sortDate: kickoffTimeValue(bucket.game.date),
  };
}

function isLiveScore(score?: ScorePack): boolean {
  return gameStateFromScore(score) === 'inprogress';
}

function isKeyMatchupState(score?: ScorePack): boolean {
  const state = gameStateFromScore(score);
  return state === 'inprogress' || state === 'scheduled' || state === 'unknown';
}

function isUpcomingScore(score?: ScorePack): boolean {
  const state = gameStateFromScore(score);
  return state === 'scheduled' || state === 'unknown';
}

function isTrustedAutonomousUpcomingScore(score?: ScorePack): boolean {
  return gameStateFromScore(score) === 'scheduled';
}

function isFinalScore(score?: ScorePack): boolean {
  return gameStateFromScore(score) === 'final';
}

type ActiveSlateStatus = {
  hasLive: boolean;
  hasUpcoming: boolean;
  hasFinal: boolean;
};

function deriveActiveSlateStatus(items: OverviewGameItem[]): ActiveSlateStatus {
  return items.reduce<ActiveSlateStatus>(
    (status, item) => ({
      hasLive: status.hasLive || isLiveScore(item.score),
      hasUpcoming: status.hasUpcoming || isUpcomingScore(item.score),
      hasFinal: status.hasFinal || isFinalScore(item.score),
    }),
    { hasLive: false, hasUpcoming: false, hasFinal: false }
  );
}

function deriveOverviewContext(params: {
  weekGames: AppGame[];
  activeSlateStatus: ActiveSlateStatus;
  selectedWeekLabel?: string;
}): OverviewContext {
  const { weekGames, activeSlateStatus, selectedWeekLabel } = params;
  const scopeLabel = weekGames.some((game) => isTruePostseasonGame(game))
    ? 'Postseason focus'
    : 'Current league focus';
  const scopeDetail = selectedWeekLabel ?? null;

  if (activeSlateStatus.hasLive) {
    return {
      scopeLabel,
      scopeDetail,
      emphasis: 'live',
      highlightsTitle: 'Up next for the league',
      highlightsDescription: activeSlateStatus.hasUpcoming
        ? 'Live games lead the page, with the next owned-team matchups queued right behind them.'
        : 'Live action is leading the page while completed and pending league games stay one step back.',
      liveDescription:
        'Track league-relevant live action across all teams and head-to-head battles.',
      sectionOrder: ['live', 'highlights', 'standings', 'matrix'],
    };
  }

  if (activeSlateStatus.hasUpcoming) {
    return {
      scopeLabel,
      scopeDetail,
      emphasis: 'upcoming',
      highlightsTitle: 'What matters next',
      highlightsDescription:
        'The active slate is upcoming, so Overview leads with the next head-to-head and owned-team games to watch.',
      liveDescription: 'If games go live, they will automatically move to the top of Overview.',
      sectionOrder: ['highlights', 'standings', 'matrix', 'live'],
    };
  }

  if (activeSlateStatus.hasFinal) {
    return {
      scopeLabel,
      scopeDetail,
      emphasis: 'recent',
      highlightsTitle: 'Recent league results',
      highlightsDescription:
        'The active slate is mostly complete, so Overview highlights the latest owned-team results before the broader season view.',
      liveDescription: 'If new live action starts, it will automatically take priority here.',
      sectionOrder: ['highlights', 'standings', 'matrix', 'live'],
    };
  }

  return {
    scopeLabel,
    scopeDetail,
    emphasis: 'standings',
    highlightsTitle: 'League watch list',
    highlightsDescription:
      'Standings stay central while Overview waits for owned-team games to define the next slate.',
    liveDescription: 'Live league games will appear automatically once scores are in progress.',
    sectionOrder: ['standings', 'highlights', 'matrix', 'live'],
  };
}

export type AutonomousOverviewScope = {
  games: AppGame[];
  label: string | null;
};

type OverviewScopeCandidate = {
  games: AppGame[];
  label: string | null;
  kind: 'regular' | 'postseason';
  week: number | null;
  hasRelevantGames: boolean;
  status: ActiveSlateStatus;
  nextUpcomingDate: number;
  latestRelevantDate: number;
  isDefaultRegularWeek: boolean;
};

function finiteMin(values: number[]): number {
  const finite = values.filter((value) => Number.isFinite(value));
  return finite.length ? Math.min(...finite) : Number.POSITIVE_INFINITY;
}

function finiteMax(values: number[]): number {
  const finite = values.filter((value) => Number.isFinite(value));
  return finite.length ? Math.max(...finite) : Number.NEGATIVE_INFINITY;
}

function buildOverviewScopeCandidate(params: {
  games: AppGame[];
  label: string | null;
  kind: 'regular' | 'postseason';
  week: number | null;
  rosterByTeam: Map<string, string>;
  scoresByKey: Record<string, ScorePack>;
  isDefaultRegularWeek?: boolean;
}): OverviewScopeCandidate {
  const {
    games,
    label,
    kind,
    week,
    rosterByTeam,
    scoresByKey,
    isDefaultRegularWeek = false,
  } = params;
  const items = deriveWeekMatchupSections(games, rosterByTeam);
  const activeSlateItems = [...items.ownerMatchups, ...items.secondaryGames]
    .map((bucket) => toOverviewItem(bucket, scoresByKey[bucket.game.key]))
    .sort(compareOverviewItems);
  const status = deriveActiveSlateStatus(activeSlateItems);

  return {
    games,
    label,
    kind,
    week,
    hasRelevantGames: activeSlateItems.length > 0,
    status,
    nextUpcomingDate: finiteMin(
      activeSlateItems
        .filter((item) => isTrustedAutonomousUpcomingScore(item.score))
        .map((item) => item.sortDate)
    ),
    latestRelevantDate: finiteMax(activeSlateItems.map((item) => item.sortDate)),
    isDefaultRegularWeek,
  };
}

function candidatePriority(candidate: OverviewScopeCandidate): number {
  if (candidate.status.hasLive) return 3;
  if (candidate.status.hasUpcoming) return 2;
  if (candidate.status.hasFinal) return 1;
  return 0;
}

function compareOverviewScopeCandidates(
  a: OverviewScopeCandidate,
  b: OverviewScopeCandidate
): number {
  const priorityDiff = candidatePriority(b) - candidatePriority(a);
  if (priorityDiff !== 0) return priorityDiff;

  if (candidatePriority(a) === 2 && a.nextUpcomingDate !== b.nextUpcomingDate) {
    return a.nextUpcomingDate - b.nextUpcomingDate;
  }

  if (
    (candidatePriority(a) === 3 || candidatePriority(a) === 1) &&
    a.latestRelevantDate !== b.latestRelevantDate
  ) {
    return b.latestRelevantDate - a.latestRelevantDate;
  }

  if (a.isDefaultRegularWeek !== b.isDefaultRegularWeek) {
    return a.isDefaultRegularWeek ? -1 : 1;
  }

  if (a.kind !== b.kind) {
    return a.kind === 'postseason' ? -1 : 1;
  }

  return (b.week ?? -1) - (a.week ?? -1);
}

export function deriveAutonomousOverviewScope(params: {
  games: AppGame[];
  rosterByTeam: Map<string, string>;
  scoresByKey: Record<string, ScorePack>;
  nowMs?: number;
}): AutonomousOverviewScope {
  const { games, rosterByTeam, scoresByKey, nowMs = Date.now() } = params;
  const regularWeeks = deriveRegularWeeks(games);
  const defaultWeek = chooseDefaultWeek({ games, regularWeeks, nowMs });

  const candidates: OverviewScopeCandidate[] = regularWeeks.map((week) =>
    buildOverviewScopeCandidate({
      games: filterGamesForWeek(games, week),
      label: `Week ${week}`,
      kind: 'regular',
      week,
      rosterByTeam,
      scoresByKey,
      isDefaultRegularWeek: week === defaultWeek,
    })
  );

  const postseasonGames = games.filter((game) => isTruePostseasonGame(game));
  if (postseasonGames.length > 0) {
    candidates.push(
      buildOverviewScopeCandidate({
        games: postseasonGames,
        label: 'the postseason',
        kind: 'postseason',
        week: null,
        rosterByTeam,
        scoresByKey,
      })
    );
  }

  const relevantCandidates = candidates.filter((candidate) => candidate.hasRelevantGames);
  const rankedCandidates = (relevantCandidates.length ? relevantCandidates : candidates).sort(
    compareOverviewScopeCandidates
  );
  const chosen = rankedCandidates[0];

  if (!chosen) {
    return { games: [], label: null };
  }

  return {
    games: chosen.games,
    label: chosen.label,
  };
}

export function deriveOwnerMatchupMatrix(params: {
  weekGames: AppGame[];
  standingsRows: OwnerStandingsRow[];
  rosterByTeam: Map<string, string>;
  scoresByKey: Record<string, ScorePack>;
}): OwnerMatchupMatrix {
  const { weekGames, standingsRows, rosterByTeam, scoresByKey } = params;
  const owners = standingsRows.map((row) => row.owner);
  const indexByOwner = new Map(owners.map((owner, index) => [owner, index]));
  const counts = owners.map(() => owners.map(() => 0));
  const wins = owners.map(() => owners.map(() => 0));
  const losses = owners.map(() => owners.map(() => 0));

  const sections = deriveWeekMatchupSections(weekGames, rosterByTeam);
  for (const bucket of sections.ownerMatchups) {
    const awayOwner = bucket.awayOwner;
    const homeOwner = bucket.homeOwner;
    if (!awayOwner || !homeOwner) continue;

    const awayIndex = indexByOwner.get(awayOwner);
    const homeIndex = indexByOwner.get(homeOwner);
    if (awayIndex == null || homeIndex == null) continue;

    counts[awayIndex]![homeIndex]! += 1;
    counts[homeIndex]![awayIndex]! += 1;

    const score = scoresByKey[bucket.game.key];
    if (gameStateFromScore(score) !== 'final') continue;
    const awayScore = score?.away.score;
    const homeScore = score?.home.score;
    if (awayScore == null || homeScore == null || awayScore === homeScore) continue;

    if (awayScore > homeScore) {
      wins[awayIndex]![homeIndex]! += 1;
      losses[homeIndex]![awayIndex]! += 1;
    } else {
      wins[homeIndex]![awayIndex]! += 1;
      losses[awayIndex]![homeIndex]! += 1;
    }
  }

  return {
    owners,
    rows: owners.map((rowOwner, rowIndex) => ({
      owner: rowOwner,
      cells: owners.map((columnOwner, columnIndex) => ({
        owner: columnOwner,
        gameCount: counts[rowIndex]![columnIndex]!,
        record:
          wins[rowIndex]![columnIndex] || losses[rowIndex]![columnIndex]
            ? `${wins[rowIndex]![columnIndex]}–${losses[rowIndex]![columnIndex]}`
            : null,
      })),
    })),
  };
}

export function deriveOverviewSnapshot(params: {
  standingsRows: OwnerStandingsRow[];
  standingsCoverage: StandingsCoverage;
  weekGames: AppGame[];
  allGames: AppGame[];
  rosterByTeam: Map<string, string>;
  scoresByKey: Record<string, ScorePack>;
  options?: {
    liveItemsLimit?: number;
    keyMatchupsLimit?: number;
  };
  selectedWeekLabel?: string;
}): OverviewSnapshot {
  const {
    standingsRows,
    standingsCoverage,
    weekGames,
    allGames,
    rosterByTeam,
    scoresByKey,
    options,
    selectedWeekLabel,
  } = params;

  const standingsLeaders = standingsRows;

  const allSections = deriveWeekMatchupSections(allGames, rosterByTeam);
  const weekSections = deriveWeekMatchupSections(weekGames, rosterByTeam);

  const liveItems = [...allSections.ownerMatchups, ...allSections.secondaryGames]
    .filter((bucket) => isLiveScore(scoresByKey[bucket.game.key]))
    .map((bucket) => toOverviewItem(bucket, scoresByKey[bucket.game.key]))
    .sort(compareOverviewItems)
    .slice(0, options?.liveItemsLimit ?? DEFAULT_LIVE_ITEM_COUNT);

  const activeSlateItems = [...weekSections.ownerMatchups, ...weekSections.secondaryGames]
    .map((bucket) => toOverviewItem(bucket, scoresByKey[bucket.game.key]))
    .sort(compareOverviewItems);

  const activeSlateStatus = deriveActiveSlateStatus(activeSlateItems);
  const includeFinalWeekGames =
    standingsCoverage.state !== 'complete' ||
    (!activeSlateStatus.hasLive && !activeSlateStatus.hasUpcoming);
  const recentMode =
    !activeSlateStatus.hasLive && !activeSlateStatus.hasUpcoming && activeSlateStatus.hasFinal;
  const keyMatchups = [...activeSlateItems]
    .filter((item) => (includeFinalWeekGames ? true : isKeyMatchupState(item.score)))
    .sort(recentMode ? compareRecentOverviewItems : compareOverviewItems)
    .slice(0, options?.keyMatchupsLimit ?? DEFAULT_KEY_MATCHUP_COUNT);

  const context = deriveOverviewContext({
    weekGames,
    activeSlateStatus,
    selectedWeekLabel,
  });

  return {
    standingsLeaders,
    matchupMatrix: deriveOwnerMatchupMatrix({
      weekGames,
      standingsRows,
      rosterByTeam,
      scoresByKey,
    }),
    liveItems,
    keyMatchups,
    context,
  };
}

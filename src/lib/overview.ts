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

/**
 * What Overview knows about the slate it is rendering.
 *
 * Five fields were removed here on 2026-09-04 (Item 124): `sectionOrder`, `scopeLabel`,
 * `highlightsTitle`, `highlightsDescription` and `liveDescription`. Every one was
 * declared, populated at all four construction sites below, and read by nothing outside
 * this file and test fixtures — `OverviewPanel` hardcodes its section order and headings
 * in JSX. `sectionOrder`'s live-emphasis value said Live leads the page above Standings,
 * which the shipped order contradicts, and `liveDescription` carried copy describing
 * behaviour the page does not have. A second, unread model of a fact the JSX already
 * owns is exactly what let those two drift without anyone noticing.
 *
 * `scopeDetail` survives because it is genuinely read: `selectors/overview.ts:237` derives
 * the week label from it.
 *
 * `emphasis` is RETAINED BUT UNREAD, and that is a deliberate pause, not a claim that it
 * is used. An earlier draft of this comment said "five components branch on the second".
 * That was false — it came from grepping the bare word `emphasis`, which matches
 * `cardEmphasisClasses`, `data-leader-emphasis`, and an unrelated prop on
 * `CareerSummaryCard`. Nothing anywhere in `src/` reads `context.emphasis`; proved by
 * renaming the field, which errors in four test files and zero production files.
 *
 * So `emphasis` meets the exact criterion the five deleted fields failed. It is left in
 * place only until the owner rules on it, because deleting it collapses this function's
 * slate branching entirely and Item 113 may want the signal. Do not read its presence as
 * evidence that anything consumes it.
 */
export type OverviewContext = {
  scopeDetail: string | null;
  emphasis: 'live' | 'upcoming' | 'recent' | 'standings';
};

export type OverviewSnapshot = {
  standingsLeaders: OwnerStandingsRow[];
  matchupMatrix: OwnerMatchupMatrix;
  liveItems: OverviewGameItem[];
  keyMatchups: OverviewGameItem[];
  sectionItems: OverviewGameItem[];
  context: OverviewContext;
};

const DEFAULT_LIVE_ITEM_COUNT = 6;

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

// `weekGames` was dropped from the parameters with `scopeLabel` (Item 124): it existed
// solely to run `isTruePostseasonGame` over the slate for that unread label.
function deriveOverviewContext(params: {
  activeSlateStatus: ActiveSlateStatus;
  selectedWeekLabel?: string;
}): OverviewContext {
  const { activeSlateStatus, selectedWeekLabel } = params;
  const scopeDetail = selectedWeekLabel ?? null;

  if (activeSlateStatus.hasLive) {
    return { scopeDetail, emphasis: 'live' };
  }

  if (activeSlateStatus.hasUpcoming) {
    return { scopeDetail, emphasis: 'upcoming' };
  }

  if (activeSlateStatus.hasFinal) {
    return { scopeDetail, emphasis: 'recent' };
  }

  return { scopeDetail, emphasis: 'standings' };
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

  const sectionItems = [...allSections.ownerMatchups, ...allSections.secondaryGames].map((bucket) =>
    toOverviewItem(bucket, scoresByKey[bucket.game.key])
  );

  const liveItems = sectionItems
    .filter((item) => isLiveScore(item.score))
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
    .sort(recentMode ? compareRecentOverviewItems : compareOverviewItems);

  const context = deriveOverviewContext({ activeSlateStatus, selectedWeekLabel });

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
    sectionItems,
    context,
  };
}

import { gameStateFromScore } from './gameUi.ts';
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

export type OverviewSnapshot = {
  standingsLeaders: OwnerStandingsRow[];
  matchupMatrix: OwnerMatchupMatrix;
  liveItems: OverviewGameItem[];
  keyMatchups: OverviewGameItem[];
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
}): OverviewSnapshot {
  const {
    standingsRows,
    standingsCoverage,
    weekGames,
    allGames,
    rosterByTeam,
    scoresByKey,
    options,
  } = params;

  const standingsLeaders = standingsRows;

  const allSections = deriveWeekMatchupSections(allGames, rosterByTeam);
  const weekSections = deriveWeekMatchupSections(weekGames, rosterByTeam);

  const liveItems = [...allSections.ownerMatchups, ...allSections.secondaryGames]
    .filter((bucket) => isLiveScore(scoresByKey[bucket.game.key]))
    .map((bucket) => toOverviewItem(bucket, scoresByKey[bucket.game.key]))
    .sort(compareOverviewItems)
    .slice(0, options?.liveItemsLimit ?? DEFAULT_LIVE_ITEM_COUNT);

  const includeFinalWeekGames = standingsCoverage.state !== 'complete';
  const keyMatchups = [...weekSections.ownerMatchups, ...weekSections.secondaryGames]
    .filter((bucket) => {
      const score = scoresByKey[bucket.game.key];
      return includeFinalWeekGames ? true : isKeyMatchupState(score);
    })
    .map((bucket) => toOverviewItem(bucket, scoresByKey[bucket.game.key]))
    .sort(compareOverviewItems)
    .slice(0, options?.keyMatchupsLimit ?? DEFAULT_KEY_MATCHUP_COUNT);

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
  };
}

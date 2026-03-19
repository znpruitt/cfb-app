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

export type OverviewSnapshot = {
  standingsLeaders: OwnerStandingsRow[];
  liveItems: OverviewGameItem[];
  keyMatchups: OverviewGameItem[];
};

const DEFAULT_STANDINGS_LEADER_COUNT = 5;
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

export function deriveOverviewSnapshot(params: {
  standingsRows: OwnerStandingsRow[];
  standingsCoverage: StandingsCoverage;
  weekGames: AppGame[];
  allGames: AppGame[];
  rosterByTeam: Map<string, string>;
  scoresByKey: Record<string, ScorePack>;
  options?: {
    standingsLeadersLimit?: number;
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

  const standingsLeaders = standingsRows.slice(
    0,
    options?.standingsLeadersLimit ?? DEFAULT_STANDINGS_LEADER_COUNT
  );

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
    liveItems,
    keyMatchups,
  };
}

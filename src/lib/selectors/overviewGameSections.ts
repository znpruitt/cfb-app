import { isDisruptedStatusLabel, normalizeStatusTokens } from '../gameStatus';
import { gameStateFromScore } from '../gameUi';
import type { OverviewGameItem } from '../overview';
import type {
  WeeklyRecapViewModel,
  AvailableWeeklyRecapViewModel,
} from '../recap/composeWeeklyRecap';
import type { AppGame } from '../schedule';
import { NO_CLAIM_OWNER } from '../standings';
import { hasGameBeenAbandoned } from '../standingsHistory';
import {
  selectWeeklyRecapTargetWeek,
  selectWeeklyRecapTileState,
  selectWeeklyRecapWeekTargets,
  type WeeklyRecapTileState,
  type WeeklyRecapTargetWeek,
} from './weeklyRecapFacts';

export const OVERVIEW_LIVE_LIMIT = 6;
export const OVERVIEW_RECENT_FINALS_LIMIT = 6;

export type OverviewGameRouteStatus =
  | { kind: 'scheduled'; label: 'Scheduled' }
  | { kind: 'live'; label: 'Live' }
  | { kind: 'awaiting-score'; label: 'Awaiting score' }
  | { kind: 'final'; label: 'Final' }
  | {
      kind: 'disrupted';
      label: 'Delayed' | 'Canceled' | 'Postponed' | 'Suspended';
    };

export type OverviewSectionItem = OverviewGameItem & {
  routeStatus: OverviewGameRouteStatus;
};

export type OverviewGameSections = {
  scheduled: OverviewSectionItem[];
  live: OverviewSectionItem[];
  recentFinals: OverviewSectionItem[];
};

export type OverviewPresentationPhase = 'inactive' | WeeklyRecapTileState;

export type OverviewGamePresentation = {
  phase: OverviewPresentationPhase;
  recap: AvailableWeeklyRecapViewModel | null;
  recapGameKeys: ReadonlySet<string>;
  expiredFinalWeeks: ReadonlySet<number>;
};

type OverviewStateSection = keyof OverviewGameSections;

function targetFromRecap(recap: AvailableWeeklyRecapViewModel): WeeklyRecapTargetWeek {
  return { week: recap.week, latestGameDate: recap.latestGameDate };
}

function targetsMatch(left: WeeklyRecapTargetWeek, right: WeeklyRecapTargetWeek): boolean {
  return left.week === right.week && left.latestGameDate === right.latestGameDate;
}

/**
 * Resolve the one Overview presentation fact shared by the recap tile and game
 * sections. An available server recap remains authoritative when client schedule
 * bootstrap has no target; a contradictory response fails closed as no tile and
 * therefore owns no final.
 */
export function selectOverviewGamePresentation(params: {
  scheduleGames: AppGame[];
  weeklyRecap: WeeklyRecapViewModel;
  activeSeason: boolean;
  now: Date;
}): OverviewGamePresentation {
  const { scheduleGames, weeklyRecap, activeSeason, now } = params;
  if (!activeSeason) {
    return {
      phase: 'inactive',
      recap: null,
      recapGameKeys: new Set<string>(),
      expiredFinalWeeks: new Set<number>(),
    };
  }

  const scheduleTarget = selectWeeklyRecapTargetWeek(scheduleGames, now);
  const availableRecap = weeklyRecap.status === 'available' ? weeklyRecap : null;
  const recapTarget = availableRecap ? targetFromRecap(availableRecap) : null;
  const responseMatches =
    recapTarget !== null && (scheduleTarget === null || targetsMatch(recapTarget, scheduleTarget));
  const presentationTarget = responseMatches ? recapTarget : scheduleTarget;
  const phase = selectWeeklyRecapTileState(presentationTarget, now);
  const recap = phase === 'recap' && responseMatches ? availableRecap : null;
  const recapGameKeys = new Set(
    recap?.tileHighlights.flatMap((line) => (line.kind === 'game' ? [line.gameKey] : [])) ?? []
  );
  const expiredFinalWeeks = new Set(
    selectWeeklyRecapWeekTargets(scheduleGames)
      .filter((target) => selectWeeklyRecapTileState(target, now) === 'upcoming')
      .map((target) => target.week)
  );

  return { phase, recap, recapGameKeys, expiredFinalWeeks };
}

function isRealOverviewOwner(owner: string | null | undefined, isLeagueTeam: boolean): boolean {
  if (!isLeagueTeam) return false;
  const normalized = owner?.trim();
  return Boolean(normalized && normalized !== NO_CLAIM_OWNER);
}

function realOwnerCount(item: OverviewGameItem): number {
  return (
    Number(isRealOverviewOwner(item.bucket.awayOwner, item.bucket.awayIsLeagueTeam)) +
    Number(isRealOverviewOwner(item.bucket.homeOwner, item.bucket.homeIsLeagueTeam))
  );
}

export function compareOverviewWatchlistItems(a: OverviewGameItem, b: OverviewGameItem): number {
  if (a.sortDate !== b.sortDate) return a.sortDate - b.sortDate;
  const ownerCountDifference = realOwnerCount(b) - realOwnerCount(a);
  if (ownerCountDifference !== 0) return ownerCountDifference;
  return a.bucket.game.key.localeCompare(b.bucket.game.key);
}

export function compareOverviewRecentFinals(a: OverviewGameItem, b: OverviewGameItem): number {
  const aHasKickoff = Number.isFinite(a.sortDate);
  const bHasKickoff = Number.isFinite(b.sortDate);
  if (aHasKickoff !== bHasKickoff) return aHasKickoff ? -1 : 1;
  if (aHasKickoff && a.sortDate !== b.sortDate) return b.sortDate - a.sortDate;
  const ownerCountDifference = realOwnerCount(b) - realOwnerCount(a);
  if (ownerCountDifference !== 0) return ownerCountDifference;
  return a.bucket.game.key.localeCompare(b.bucket.game.key);
}

export function compareOverviewLiveItems(a: OverviewGameItem, b: OverviewGameItem): number {
  const aHasLiveScore = gameStateFromScore(a.score) === 'inprogress';
  const bHasLiveScore = gameStateFromScore(b.score) === 'inprogress';
  if (aHasLiveScore !== bHasLiveScore) return aHasLiveScore ? -1 : 1;
  const ownerCountDifference = realOwnerCount(b) - realOwnerCount(a);
  if (ownerCountDifference !== 0) return ownerCountDifference;
  if (a.sortDate !== b.sortDate) return a.sortDate - b.sortDate;
  return a.bucket.game.key.localeCompare(b.bucket.game.key);
}

function uniqueOverviewItems(items: OverviewGameItem[]): OverviewGameItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.bucket.game.key;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function disruptedStatus(item: OverviewGameItem): OverviewGameRouteStatus | null {
  const rawLabel = isDisruptedStatusLabel(item.score?.status)
    ? item.score?.status
    : isDisruptedStatusLabel(item.bucket.game.rawStatus)
      ? item.bucket.game.rawStatus
      : null;
  const tokens = normalizeStatusTokens(rawLabel);
  if (tokens.includes('delayed')) return { kind: 'disrupted', label: 'Delayed' };
  if (tokens.includes('canceled') || tokens.includes('cancelled')) {
    return { kind: 'disrupted', label: 'Canceled' };
  }
  if (tokens.includes('postponed')) return { kind: 'disrupted', label: 'Postponed' };
  if (tokens.includes('suspended')) return { kind: 'disrupted', label: 'Suspended' };
  return null;
}

function routeForItem(
  item: OverviewGameItem,
  now: Date
): { section: OverviewStateSection; status: OverviewGameRouteStatus } | null {
  if (realOwnerCount(item) === 0) return null;

  const scoreState = gameStateFromScore(item.score);
  if (scoreState === 'final') {
    return { section: 'recentFinals', status: { kind: 'final', label: 'Final' } };
  }
  if (scoreState === 'inprogress') {
    return { section: 'live', status: { kind: 'live', label: 'Live' } };
  }
  // CFBD does not currently expose these labels. Keep the legacy-safe guard,
  // but do not build an independent disruption lifecycle around dead inputs.
  const disruption = disruptedStatus(item);
  if (disruption) return { section: 'scheduled', status: disruption };

  const game = item.bucket.game;
  const kickoffMs = game.date ? Date.parse(game.date) : Number.NaN;
  if (game.startTimeTBD === true || !Number.isFinite(kickoffMs) || kickoffMs > now.getTime()) {
    return { section: 'scheduled', status: { kind: 'scheduled', label: 'Scheduled' } };
  }

  // Item 64(c): this is a per-row question. The population-level weekly
  // finality selector intentionally answers a different, all-games question.
  if (hasGameBeenAbandoned({ key: game.key, week: game.week, kickoff: game.date }, now)) {
    return null;
  }

  return {
    section: 'live',
    status: { kind: 'awaiting-score', label: 'Awaiting score' },
  };
}

/** Route each non-Featured Overview game from the approved v2 decision table. */
export function selectOverviewGameSections(params: {
  items: OverviewGameItem[];
  eligibleWatchlistKeys: ReadonlySet<string>;
  featuredGameKeys: ReadonlySet<string>;
  presentation: Pick<OverviewGamePresentation, 'phase' | 'recapGameKeys' | 'expiredFinalWeeks'>;
  now: Date;
}): OverviewGameSections {
  const { items, eligibleWatchlistKeys, featuredGameKeys, presentation, now } = params;
  const sections: OverviewGameSections = { scheduled: [], live: [], recentFinals: [] };

  for (const item of uniqueOverviewItems(items)) {
    const gameKey = item.bucket.game.key;
    if (featuredGameKeys.has(gameKey)) continue;
    const route = routeForItem(item, now);
    if (!route) continue;
    if (route.section === 'scheduled' && !eligibleWatchlistKeys.has(gameKey)) continue;
    if (
      route.section === 'recentFinals' &&
      (presentation.phase === 'inactive' ||
        presentation.expiredFinalWeeks.has(item.bucket.game.canonicalWeek) ||
        presentation.recapGameKeys.has(gameKey))
    ) {
      continue;
    }
    sections[route.section].push({ ...item, routeStatus: route.status });
  }

  sections.scheduled.sort(compareOverviewWatchlistItems);
  sections.live.sort(compareOverviewLiveItems);
  sections.recentFinals.sort(compareOverviewRecentFinals);
  sections.live = sections.live.slice(0, OVERVIEW_LIVE_LIMIT);
  sections.recentFinals = sections.recentFinals.slice(0, OVERVIEW_RECENT_FINALS_LIMIT);
  return sections;
}

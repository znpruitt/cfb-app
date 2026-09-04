import { hasUsableFinalScore, isDisruptedStatusLabel, normalizeStatusTokens } from '../gameStatus';
import { gameStateFromScore } from '../gameUi';
import type { OverviewGameItem } from '../overview';
import type { AppGame } from '../schedule';
import { NO_CLAIM_OWNER } from '../standings';
import { derivePendingGame, hasGameBeenAbandoned } from '../standingsHistory';
import type { PrioritizedOverviewItem } from './overview';
import { selectWeeklyRecapTileState, selectWeeklyRecapWeekTargets } from './weeklyRecapFacts';

export const OVERVIEW_LIVE_LIMIT = 6;
export const OVERVIEW_RECENT_FINALS_LIMIT = 6;
export const OVERVIEW_WATCHLIST_LIMIT = 6;

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

export type PrioritizedOverviewSectionItem = PrioritizedOverviewItem & {
  routeStatus: OverviewGameRouteStatus;
};

export type OverviewGameSections = {
  scheduled: PrioritizedOverviewSectionItem[];
  live: OverviewSectionItem[];
  recentFinals: OverviewSectionItem[];
};

type OverviewStateSection = 'scheduled' | 'live' | 'recentFinals';

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

  const pending = derivePendingGame(item.bucket.game, item.score, {
    requireUsableFinalScore: true,
  });

  // Abandonment is a gate over every unresolved real game, not a branch of
  // scheduled/unknown routing. This makes a stranded in-progress pack obey the
  // same per-game eight-hour bound without duplicating the threshold or shape.
  if (pending && hasGameBeenAbandoned(pending, now)) return null;

  if (hasUsableFinalScore(item.score)) {
    return { section: 'recentFinals', status: { kind: 'final', label: 'Final' } };
  }

  // CFBD cannot currently emit these labels. Retain the legacy-safe guard, but
  // do not build a separate ordering or lifecycle around an unreachable input.
  const disruption = disruptedStatus(item);
  if (disruption) return { section: 'scheduled', status: disruption };

  // `derivePendingGame` is also the authority for real/planned games. Requiring
  // it before the score-state switch keeps unresolved CFP participant shells
  // out even if an inconsistent score row claims in-progress.
  if (!pending) return null;

  const scoreState = gameStateFromScore(item.score);
  if (scoreState === 'inprogress') {
    return { section: 'live', status: { kind: 'live', label: 'Live' } };
  }

  const kickoffMs = pending.kickoff ? Date.parse(pending.kickoff) : Number.NaN;
  if (!Number.isFinite(kickoffMs) || kickoffMs > now.getTime()) {
    return { section: 'scheduled', status: { kind: 'scheduled', label: 'Scheduled' } };
  }

  return {
    section: 'live',
    status: { kind: 'awaiting-score', label: 'Awaiting score' },
  };
}

/**
 * Recent finals sort by kickoff, descending — most recent first — and by nothing
 * else. Section-ordering resolutions §2, scoped by the owner on 2026-09-04 to every
 * Overview game section rather than to Live alone: kickoff time is the discriminator
 * here, in Live, in Featured, and below the watchlist's curation score.
 *
 * ONE deliberate exception, and it is not a comparator: the watchlist keeps
 * `watchlistPriority` above kickoff, because it is a curated list and the curation IS
 * the order. Every owner-count key is gone — Live, Recent finals, the watchlist's
 * tiebreak, and Featured's `compareRecentResultItems` (`selectors/overview.ts`).
 *
 * This matters here more than the identical rule does in Live, because CFBD kickoffs
 * cluster on shared hour and half-hour timestamps, so a slate routinely holds several
 * finals with the same `sortDate`. Under the old tiebreak two adjacent rows reordered
 * by how many league owners the game involved, with nothing on either row explaining
 * why. The game key decides ties now — arbitrary, but visibly arbitrary rather than
 * a hidden relevance ranking.
 */
function compareOverviewRecentFinals(a: OverviewGameItem, b: OverviewGameItem): number {
  const aHasKickoff = Number.isFinite(a.sortDate);
  const bHasKickoff = Number.isFinite(b.sortDate);
  if (aHasKickoff !== bHasKickoff) return aHasKickoff ? -1 : 1;
  if (aHasKickoff && a.sortDate !== b.sortDate) return b.sortDate - a.sortDate;
  return a.bucket.game.key.localeCompare(b.bucket.game.key);
}

/**
 * Live rows sort by kickoff, ascending, and by nothing else.
 *
 * Owner decision 2026-09-04, recorded in
 * `docs/campaigns/item-87-followon-section-ordering-resolutions.md` §1 and §2. Game progress is
 * explicitly NOT a sort input. An in-progress-before-awaiting partition kept scoreless rows at the
 * bottom; it was proposed and withdrawn, because under it a row jumps from the bottom of the
 * section to its kickoff position the moment a score attaches — a reposition on a polling surface,
 * with the member having touched nothing. The cost of pure kickoff order is a scoreless row sitting
 * among scored ones for the bounded post-kickoff gap, which is the cheaper trade.
 *
 * The owner-count key went with it (§2): relevance promotion belongs to Featured, which exists to
 * pull games out of chronological order. Sorting here is a legibility tool, not a ranking one — a
 * member can tell why one row sits above another only if the answer is "it kicked off first".
 */
function compareOverviewLiveItems(a: OverviewGameItem, b: OverviewGameItem): number {
  const aHasKickoff = Number.isFinite(a.sortDate);
  const bHasKickoff = Number.isFinite(b.sortDate);
  if (aHasKickoff !== bHasKickoff) return aHasKickoff ? -1 : 1;
  if (aHasKickoff && a.sortDate !== b.sortDate) return a.sortDate - b.sortDate;
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

function expiredFinalWeeks(scheduleGames: AppGame[], now: Date): ReadonlySet<number> {
  return new Set(
    selectWeeklyRecapWeekTargets(scheduleGames)
      .filter((target) => selectWeeklyRecapTileState(target, now) === 'upcoming')
      .map((target) => target.week)
  );
}

/** Route every non-Featured game from the approved score × kickoff × ownership table. */
export function selectOverviewGameSections(params: {
  sectionItems: OverviewGameItem[];
  scheduleGames: AppGame[];
  watchlistCandidates: PrioritizedOverviewItem[];
  featuredGameKeys: ReadonlySet<string>;
  now: Date;
}): OverviewGameSections {
  const { sectionItems, scheduleGames, watchlistCandidates, featuredGameKeys, now } = params;
  const routesByKey = new Map<
    string,
    { item: OverviewGameItem; section: OverviewStateSection; status: OverviewGameRouteStatus }
  >();
  const expiredWeeks = expiredFinalWeeks(scheduleGames, now);

  for (const item of uniqueOverviewItems(sectionItems)) {
    const gameKey = item.bucket.game.key;
    if (featuredGameKeys.has(gameKey)) continue;
    const route = routeForItem(item, now);
    if (!route) continue;
    if (route.section === 'recentFinals' && expiredWeeks.has(item.bucket.game.canonicalWeek)) {
      continue;
    }
    routesByKey.set(gameKey, { item, ...route });
  }

  const scheduled: PrioritizedOverviewSectionItem[] = [];
  const scheduledKeys = new Set<string>();
  for (const candidate of watchlistCandidates) {
    const gameKey = candidate.item.bucket.game.key;
    const route = routesByKey.get(gameKey);
    if (scheduledKeys.has(gameKey) || route?.section !== 'scheduled') continue;
    scheduledKeys.add(gameKey);
    scheduled.push({ ...candidate, routeStatus: route.status });
    if (scheduled.length === OVERVIEW_WATCHLIST_LIMIT) break;
  }

  const live: OverviewSectionItem[] = [];
  const recentFinals: OverviewSectionItem[] = [];
  for (const { item, section, status } of routesByKey.values()) {
    if (section === 'live') live.push({ ...item, routeStatus: status });
    if (section === 'recentFinals') recentFinals.push({ ...item, routeStatus: status });
  }

  live.sort(compareOverviewLiveItems);
  recentFinals.sort(compareOverviewRecentFinals);

  return {
    scheduled,
    live: live.slice(0, OVERVIEW_LIVE_LIMIT),
    recentFinals: recentFinals.slice(0, OVERVIEW_RECENT_FINALS_LIMIT),
  };
}

import type { CfbdSeasonType } from '@/lib/cfbd';
import { isCanceledOrPostponedStatusLabel } from '@/lib/gameStatus';

import type { LiveScoreContext, LiveScoreGame } from './canonicalContext';

/**
 * PLATFORM-086B1 — schedule-armed live-score polling-target selection.
 *
 * Pure and deterministic (now injected). A canonical game is eligible for live
 * polling only when it is addressable (the canonical slate guarantees a positive
 * provider id), has BOTH participants resolved, has a parseable kickoff, sits
 * inside the hard [kickoff − 15m, kickoff + 24h] window, is NOT explicitly
 * canceled or postponed (delayed/suspended stay eligible), and whose cached
 * result is not authoritatively resolved (a confirmed final).
 *
 * Mode priority per invocation:
 *   1. any in-window game still open (scheduled/live/unconfirmed) → scoreboard
 *      (one global fetch may touch several week partitions);
 *   2. else a scoreboard final still awaiting `/games` confirmation → exactly
 *      one pending week partition for final-reconciliation;
 *   3. else no target.
 */

/** Eligibility window: 15 minutes before kickoff through 24 hours after. */
export const POLLING_WINDOW_BEFORE_KICKOFF_MS = 15 * 60 * 1000;
export const POLLING_WINDOW_AFTER_KICKOFF_MS = 24 * 60 * 60 * 1000;

export type PartitionRef = {
  year: number;
  /** Provider partition week (CFBD week — postseason provider week, never canonical). */
  week: number;
  seasonType: CfbdSeasonType;
};

/** The durable resolution state of one in-window eligible game. */
export type WindowResolution = 'unresolved-open' | 'pending-confirmation' | 'resolved';

export type WindowGame = {
  game: LiveScoreGame;
  kickoffMs: number;
  resolution: WindowResolution;
};

export type PollingPlan =
  | { mode: 'scoreboard'; targets: LiveScoreGame[]; partitions: PartitionRef[] }
  | { mode: 'final-reconciliation'; partition: PartitionRef; pendingGames: LiveScoreGame[] }
  | { mode: 'none' };

/** Stable key for a partition. */
export function partitionKey(ref: PartitionRef): string {
  return `${ref.year}:${ref.week}:${ref.seasonType}`;
}

/**
 * The durable resolution of a game: a confirmed final is `resolved` (never
 * polled); a scoreboard final still pending `/games` confirmation is
 * `pending-confirmation`; everything else (no score, scheduled, live, or a
 * non-terminal disrupted cache) is `unresolved-open` and drives scoreboard
 * polling. Fail-safe toward polling — an unclear cache never suppresses a poll.
 */
function resolveWindowState(game: LiveScoreGame): WindowResolution {
  if (game.cachedStatus === 'final') {
    return game.pendingConfirmation ? 'pending-confirmation' : 'resolved';
  }
  return 'unresolved-open';
}

/**
 * The in-window, addressable, non-canceled/postponed games with resolved
 * participants and a parseable kickoff, tagged with their resolution state.
 * A missing/unparseable kickoff can never prove the window, so it is excluded
 * (fail-safe for quota — polling never starts on unprovable time).
 */
export function collectWindowGames(context: LiveScoreContext, now: Date): WindowGame[] {
  const nowMs = now.getTime();
  const out: WindowGame[] = [];
  for (const game of context.games) {
    const { canonical } = game;
    // Both participants must be resolved known teams (excludes placeholder /
    // half-set matchups). The slate already guarantees a positive provider id.
    if (canonical.home === null || canonical.away === null) continue;
    if (isCanceledOrPostponedStatusLabel(canonical.rawStatus)) continue;

    const kickoffMs =
      typeof canonical.kickoff === 'string' ? Date.parse(canonical.kickoff) : Number.NaN;
    if (!Number.isFinite(kickoffMs)) continue;
    const age = nowMs - kickoffMs;
    if (!Number.isFinite(age)) continue;
    if (age < -POLLING_WINDOW_BEFORE_KICKOFF_MS || age > POLLING_WINDOW_AFTER_KICKOFF_MS) continue;

    out.push({ game, kickoffMs, resolution: resolveWindowState(game) });
  }
  return out;
}

/** Earliest kickoff first; then regular before postseason; then lower week. */
function compareByKickoff(a: WindowGame, b: WindowGame): number {
  if (a.kickoffMs !== b.kickoffMs) return a.kickoffMs - b.kickoffMs;
  if (a.game.canonical.seasonType !== b.game.canonical.seasonType) {
    return a.game.canonical.seasonType === 'regular' ? -1 : 1;
  }
  return a.game.canonical.providerWeek - b.game.canonical.providerWeek;
}

function comparePartitions(a: PartitionRef, b: PartitionRef): number {
  if (a.seasonType !== b.seasonType) return a.seasonType === 'regular' ? -1 : 1;
  return a.week - b.week;
}

/**
 * Choose the single polling plan for this invocation. Deterministic and pure.
 */
export function selectPollingPlan(context: LiveScoreContext, now: Date): PollingPlan {
  const windowGames = collectWindowGames(context, now);

  const open = windowGames.filter((w) => w.resolution === 'unresolved-open');
  if (open.length > 0) {
    const targets = open.map((w) => w.game);
    const seen = new Map<string, PartitionRef>();
    for (const w of open) {
      const ref: PartitionRef = {
        year: context.year,
        week: w.game.canonical.providerWeek,
        seasonType: w.game.canonical.seasonType,
      };
      seen.set(partitionKey(ref), ref);
    }
    const partitions = [...seen.values()].sort(comparePartitions);
    return { mode: 'scoreboard', targets, partitions };
  }

  const pending = windowGames.filter((w) => w.resolution === 'pending-confirmation');
  if (pending.length > 0) {
    // One exact partition: the one holding the earliest pending kickoff.
    const earliest = [...pending].sort(compareByKickoff)[0]!;
    const partition: PartitionRef = {
      year: context.year,
      week: earliest.game.canonical.providerWeek,
      seasonType: earliest.game.canonical.seasonType,
    };
    const pendingGames = pending
      .filter(
        (w) =>
          w.game.canonical.providerWeek === partition.week &&
          w.game.canonical.seasonType === partition.seasonType
      )
      .map((w) => w.game);
    return { mode: 'final-reconciliation', partition, pendingGames };
  }

  return { mode: 'none' };
}

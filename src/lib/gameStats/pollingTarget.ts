import type { CfbdSeasonType } from '../cfbd.ts';
import type { SeasonRelation } from './contract.ts';
import type { CanonicalGame, CanonicalSlate } from './canonicalSlate.ts';
import { selectGameEvidence } from './evidenceAuthority.ts';
import { groupRowsById } from './partitionCoverage.ts';
import { validateGameStatsEnvelope } from './publicProjection.ts';

/**
 * PLATFORM-086H3E2 — schedule/evidence polling-target derivation (DORMANT).
 *
 * The approved 15-minute cron policy (wired in E3) is deliberately NOT
 * score-gated: scores have no automation until PLATFORM-086B, so a
 * final-score arming condition could leave the cron permanently inert.
 * Eligibility is schedule-time-and-evidence instead:
 *
 *   - a game becomes eligible THREE hours after kickoff and remains eligible
 *     until TWENTY-FOUR hours after kickoff, while its evidence is not yet
 *     `satisfied`;
 *   - a partition `(year, providerWeek, seasonType)` is a candidate while it
 *     contains at least one such game;
 *   - candidates order deterministically by earliest unresolved eligible
 *     kickoff, then season type (regular before postseason), then provider
 *     week — and AT MOST ONE partition is fetched per run (the selector
 *     returns a single target or null).
 *
 * Games must be addressable and stat-applicable: placeholder shells and
 * disrupted games never poll, and a missing/unparseable kickoff can never
 * prove the 3-hour age, so it is NOT eligible (fail-safe for quota — polling
 * never starts on unprovable time). Analytics eligibility remains separately
 * final-score-gated (C3/C4); after the finite window closes, the authenticated
 * manual refresh is the recovery path.
 *
 * Everything here is pure: the caller derives the slate and reads committed
 * partition records CACHE-ONLY, then asks this module for the single target.
 * Current-season scoping is the caller's responsibility (it supplies the
 * slate). No provider access, no clocks (now is injected), no writes.
 */

/** A game becomes pollable exactly three hours after kickoff (inclusive). */
export const POLLING_MIN_KICKOFF_AGE_MS = 3 * 60 * 60 * 1000;
/** A game leaves the polling window exactly 24 hours after kickoff (exclusive). */
export const POLLING_MAX_KICKOFF_AGE_MS = 24 * 60 * 60 * 1000;

export type PollingPartitionRef = {
  year: number;
  /** Provider partition week (CFBD week — postseason provider week, never canonical). */
  week: number;
  seasonType: CfbdSeasonType;
};

export type PollingTarget = PollingPartitionRef & {
  /** ISO kickoff of the earliest unresolved eligible game — the ordering key. */
  earliestUnresolvedKickoff: string;
};

/** Stable map key for a partition's committed durable record. */
export function pollingPartitionKey(ref: PollingPartitionRef): string {
  return `${ref.year}:${ref.week}:${ref.seasonType}`;
}

type WindowGame = { game: CanonicalGame; kickoffMs: number };

/**
 * Whether a slate game is inside the kickoff window at `nowMs` — addressable,
 * stat-applicable, with a parseable kickoff aged [3h, 24h).
 */
function windowGame(game: CanonicalGame, nowMs: number): WindowGame | null {
  // Placeholder shells and disrupted games never produce stats.
  if (game.applicability === 'not-expected') return null;
  const kickoffMs = typeof game.kickoff === 'string' ? Date.parse(game.kickoff) : Number.NaN;
  // An unprovable kickoff age never polls (fail-safe, quota-first). The age
  // itself must be finite: an invalid injected clock (NaN nowMs) would make
  // both window comparisons false and fall through to eligible otherwise.
  if (!Number.isFinite(kickoffMs)) return null;
  const age = nowMs - kickoffMs;
  if (!Number.isFinite(age)) return null;
  if (age < POLLING_MIN_KICKOFF_AGE_MS || age >= POLLING_MAX_KICKOFF_AGE_MS) return null;
  return { game, kickoffMs };
}

type PartitionAccumulator = {
  ref: PollingPartitionRef;
  games: WindowGame[];
  earliestKickoffMs: number;
};

function collectWindowPartitions(slate: CanonicalSlate, nowMs: number): PartitionAccumulator[] {
  const byPartition = new Map<string, PartitionAccumulator>();
  for (const game of slate.games) {
    const inWindow = windowGame(game, nowMs);
    if (inWindow === null) continue;
    const ref: PollingPartitionRef = {
      year: slate.year,
      week: game.providerWeek,
      seasonType: game.seasonType,
    };
    const key = pollingPartitionKey(ref);
    const existing = byPartition.get(key);
    if (existing === undefined) {
      byPartition.set(key, { ref, games: [inWindow], earliestKickoffMs: inWindow.kickoffMs });
    } else {
      existing.games.push(inWindow);
      existing.earliestKickoffMs = Math.min(existing.earliestKickoffMs, inWindow.kickoffMs);
    }
  }
  return [...byPartition.values()].sort(comparePartitions);
}

/** Earliest kickoff first; then regular before postseason; then lower week. */
function comparePartitions(a: PartitionAccumulator, b: PartitionAccumulator): number {
  if (a.earliestKickoffMs !== b.earliestKickoffMs) {
    return a.earliestKickoffMs - b.earliestKickoffMs;
  }
  if (a.ref.seasonType !== b.ref.seasonType) {
    return a.ref.seasonType === 'regular' ? -1 : 1;
  }
  return a.ref.week - b.ref.week;
}

/**
 * Phase 1 — the partitions whose committed records the caller must read
 * (cache-only) before target selection: every partition with at least one
 * game inside the kickoff window, deterministically ordered. Evidence is not
 * consulted here (the caller has not read any records yet).
 */
export function listKickoffWindowPartitions(
  slate: CanonicalSlate,
  now: Date
): PollingPartitionRef[] {
  return collectWindowPartitions(slate, now.getTime()).map((p) => p.ref);
}

export type PollingTargetInput = {
  slate: CanonicalSlate;
  now: Date;
  seasonRelation: SeasonRelation;
  /**
   * RAW durable read value per phase-1 partition, keyed by
   * `pollingPartitionKey` — read CACHE-ONLY by the caller and validated HERE
   * through the shared `validateGameStatsEnvelope` authority (durable
   * app-state is untyped at rest; the stored value proves nothing). A missing
   * entry, an absent record, a malformed envelope, a partition-mismatched
   * envelope, or a non-array games payload all resolve NOTHING: every window
   * game stays unresolved, which fails TOWARD polling — corrupt or mispaired
   * durable context can suppress neither the poll nor a repair, and the
   * finite window plus the quota reserve bound the cost.
   */
  recordsByPartition: ReadonlyMap<string, unknown>;
};

/**
 * Phase 2 — the single approved target (or null). A window game is UNRESOLVED
 * while the shared evidence authority does not classify its stored evidence
 * `satisfied`; a partition is a candidate while it has at least one
 * unresolved window game. Candidates order by earliest unresolved eligible
 * kickoff, then season type, then provider week — the first is the run's only
 * permitted fetch.
 */
export function selectPollingTarget(input: PollingTargetInput): PollingTarget | null {
  const { slate, now, seasonRelation, recordsByPartition } = input;
  const nowMs = now.getTime();

  let best: { target: PollingTarget; sortKey: PartitionAccumulator } | null = null;
  for (const partition of collectWindowPartitions(slate, nowMs)) {
    // Validate the untyped stored value through the ONE envelope authority
    // before any row is grouped: only an exactly-valid envelope for THIS
    // partition may resolve games.
    const validation = validateGameStatsEnvelope(
      recordsByPartition.get(pollingPartitionKey(partition.ref)) ?? null,
      partition.ref.year,
      partition.ref.week,
      partition.ref.seasonType
    );
    const rowsById = groupRowsById(validation.status === 'ok' ? validation.record : null);

    let earliestUnresolvedMs = Number.POSITIVE_INFINITY;
    let earliestUnresolvedKickoff: string | null = null;
    for (const { game, kickoffMs } of partition.games) {
      const decision = selectGameEvidence(
        game,
        rowsById.get(game.providerGameId) ?? [],
        seasonRelation
      );
      if (decision.state === 'satisfied') continue;
      if (kickoffMs < earliestUnresolvedMs) {
        earliestUnresolvedMs = kickoffMs;
        earliestUnresolvedKickoff = game.kickoff;
      }
    }
    if (earliestUnresolvedKickoff === null) continue; // fully resolved partition

    const candidate: PartitionAccumulator = {
      ref: partition.ref,
      games: partition.games,
      earliestKickoffMs: earliestUnresolvedMs,
    };
    if (best === null || comparePartitions(candidate, best.sortKey) < 0) {
      best = {
        target: { ...partition.ref, earliestUnresolvedKickoff },
        sortKey: candidate,
      };
    }
  }
  return best?.target ?? null;
}

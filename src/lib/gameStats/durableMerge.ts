import {
  buildV2GameStats,
  isPersistableIncomingRow,
  isValidProviderGameId,
  parseCategoryValue,
  type ParsedV2Observation,
  type ParsedV2TeamObservation,
} from './contract.ts';
import { getCachedGameStats, getGameStatsKey, setCachedGameStats } from './cache.ts';
import { withAppStateKeyLock } from '../server/appStateStore.ts';
import type { CfbdSeasonType } from '../cfbd.ts';
import type { GameStats, TeamGameStats, WeeklyGameStats } from './types.ts';

/**
 * PLATFORM-086H2 — durable game-stats merge service (DORMANT).
 *
 * The durable merge authority the staged activation PR (PR 3) will later wire
 * into validated ingestion → durable merge → cache completeness →
 * schedule-relative recovery → analytics projection → truthful availability.
 * NOTHING in current production invokes it: no cron, manual refresh, coverage,
 * recovery, analytics, Insights, career, diagnostics, or availability path may
 * import this module until that atomic activation (the recursive
 * dormant-boundary guard enforces this).
 *
 * Core guarantees:
 *   - Durable storage is the source of truth: the read→merge→write sequence
 *     runs under the durable per-key advisory lock (`withAppStateKeyLock`),
 *     merges against the CURRENT durable partition, and writes only when the
 *     merged partition semantically changed. This path has no process-level
 *     cache today; the service performs no mutation besides that single
 *     durable write, so a failure can never leave partial process state.
 *   - Observation fencing is per game: each written v2 row carries
 *     `fetchStartedAt` (when its batch's provider fetch started), an older
 *     observation can never overwrite a newer accepted row, equal fences are
 *     idempotent for identical content and a CONFLICT for divergent content
 *     (never last-writer-wins), and an unparsable stored fence blocks the
 *     overwrite as a conflict instead of silently defeating the fence.
 *   - Merging is conservative and field-level: games absent from a partial
 *     batch are retained; a raw category is REPLACED only by a strictly
 *     parse-valid newer value (malformed input never clobbers prior evidence,
 *     and zero/permitted-negative values are positive evidence, never
 *     "missing"); categories the newer observation omits are preserved; points
 *     update only on explicit `pointsProvided` evidence, otherwise the prior
 *     number is preserved without fabricating evidence. Row counts, payload
 *     size, and supersets carry NO replacement authority.
 *   - Identity is never reconstructed from team strings: games pair by
 *     provider game id, sides pair by home/away, and a positive stored
 *     schoolId that contradicts the validated incoming teamId is an
 *     irreconcilable conflict that preserves durable state.
 *   - Normalized fields of every merged row are rebuilt from the merged raw
 *     evidence through the ONE strict normalization path (`buildV2GameStats`)
 *     — a legacy row's lenient normalized values are superseded by the strict
 *     rebuild when it upgrades to v2, while its raw evidence is preserved.
 */

// === Service contract ===

export type DurableMergeInput = {
  year: number;
  week: number;
  seasonType: CfbdSeasonType;
  /**
   * Observation fence for this batch: when the provider fetch that produced
   * `observations` STARTED (ISO). Must parse to a finite time — an invalid
   * fence never silently defeats fencing; it makes the whole call
   * `unavailable`.
   */
  fetchStartedAt: string;
  observations: readonly ParsedV2Observation[];
};

export type MergeConflictReason =
  | 'duplicate-incoming-divergent'
  | 'same-fence-divergent'
  | 'identity-contradiction'
  | 'existing-fence-unparsable';

export type MergeConflict = { providerGameId: number; reason: MergeConflictReason };

export type DurableMergeOutcome =
  | 'written'
  | 'unchanged'
  | 'partially-merged'
  | 'stale'
  | 'conflict'
  | 'unavailable';

export type DurableMergeUnavailableReason =
  | 'invalid-fetch-started-at'
  | 'lock-unavailable'
  | 'durable-read-failed'
  | 'durable-write-failed';

export type DurableMergeResult = {
  outcome: DurableMergeOutcome;
  /** Provider game ids, deterministically sorted ascending. */
  inserted: number[];
  updated: number[];
  unchanged: number[];
  stale: number[];
  conflicts: MergeConflict[];
  /** Existing games the incoming batch did not address — always retained. */
  retainedExisting: number[];
  skippedNonPersistable: number;
  /** Set ONLY when `outcome` is `unavailable`. */
  unavailableReason?: DurableMergeUnavailableReason;
};

// === Structural equality (semantic, key-order independent) ===

function structurallyEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object' || a === null || b === null) return false;
  const aIsArray = Array.isArray(a);
  if (aIsArray !== Array.isArray(b)) return false;
  if (aIsArray) {
    const arrA = a as unknown[];
    const arrB = b as unknown[];
    if (arrA.length !== arrB.length) return false;
    return arrA.every((item, i) => structurallyEqual(item, arrB[i]));
  }
  const recA = a as Record<string, unknown>;
  const recB = b as Record<string, unknown>;
  const keysA = Object.keys(recA);
  const keysB = Object.keys(recB);
  if (keysA.length !== keysB.length) return false;
  return keysA.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(recB, key) && structurallyEqual(recA[key], recB[key])
  );
}

// === Pure per-game merge ===

function parseFenceMs(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Conservative category-level raw merge: categories absent from the newer
 * observation are preserved; a category the newer observation ADDS is new
 * evidence and is recorded as provided; a category present on both sides is
 * replaced only when the incoming value is strictly parse-valid — malformed or
 * unrecognized incoming values never clobber prior evidence.
 */
function mergeRawEvidence(
  existing: Record<string, string>,
  incoming: Record<string, string>
): Record<string, string> {
  const merged: Record<string, string> = { ...existing };
  for (const [category, value] of Object.entries(incoming)) {
    if (!Object.prototype.hasOwnProperty.call(merged, category)) {
      merged[category] = value;
      continue;
    }
    if (parseCategoryValue(category, value).status === 'valid') {
      merged[category] = value;
    }
  }
  return merged;
}

type SideMerge = { team: ParsedV2TeamObservation; preservedPoints: number | null };

/**
 * Merge one side. Returns the synthetic observation to rebuild through the
 * single strict normalization path, plus a preserved prior points NUMBER when
 * neither side carries explicit points evidence (kept without fabricating
 * `pointsProvided`). Returns `null` on an irreconcilable identity
 * contradiction (both school ids positive and different).
 */
function mergeSide(existing: TeamGameStats, incoming: ParsedV2TeamObservation): SideMerge | null {
  const existingSchoolId = existing.schoolId;
  if (isValidProviderGameId(existingSchoolId) && existingSchoolId !== incoming.schoolId) {
    return null;
  }

  const pointsProvided = incoming.pointsProvided || existing.pointsProvided === true ? true : false;
  const points = incoming.pointsProvided
    ? incoming.points
    : existing.pointsProvided === true
      ? existing.points
      : null;

  return {
    team: {
      school: incoming.school,
      schoolId: incoming.schoolId,
      conference: incoming.conference,
      homeAway: incoming.homeAway,
      pointsProvided,
      points,
      raw: mergeRawEvidence(existing.raw ?? {}, incoming.raw),
    },
    // No explicit evidence on either side: preserve the prior stored number
    // (legacy rows carry unverified points) without marking it as evidence.
    preservedPoints:
      !pointsProvided && typeof existing.points === 'number' ? existing.points : null,
  };
}

type GameMerge =
  | { kind: 'merged'; row: GameStats }
  | { kind: 'conflict'; reason: MergeConflictReason };

/** Merge an incoming observation into an existing row (legacy or v2). */
function mergeGameRow(
  existing: GameStats,
  incoming: ParsedV2Observation,
  week: number,
  seasonType: CfbdSeasonType
): GameMerge {
  const home = mergeSide(existing.home, incoming.home);
  const away = mergeSide(existing.away, incoming.away);
  if (!home || !away) return { kind: 'conflict', reason: 'identity-contradiction' };

  const row = buildV2GameStats(
    { providerGameId: incoming.providerGameId, home: home.team, away: away.team },
    week,
    seasonType
  );
  if (home.preservedPoints !== null) row.home.points = home.preservedPoints;
  if (away.preservedPoints !== null) row.away.points = away.preservedPoints;
  return { kind: 'merged', row };
}

/** A fresh v2 row for a game the durable partition does not know yet. */
function insertGameRow(
  incoming: ParsedV2Observation,
  week: number,
  seasonType: CfbdSeasonType,
  fence: string
): GameStats {
  return { ...buildV2GameStats(incoming, week, seasonType), fetchStartedAt: fence };
}

// === Pure weekly-partition merge (the decision table) ===

export type WeeklyMergeComputation = {
  /** Merged partition; `null` when nothing exists and nothing is persistable. */
  partition: WeeklyGameStats | null;
  /** Whether the merged partition semantically differs from `existing`. */
  changed: boolean;
  inserted: number[];
  updated: number[];
  unchanged: number[];
  stale: number[];
  conflicts: MergeConflict[];
  retainedExisting: number[];
  skippedNonPersistable: number;
};

/**
 * Pure merge of one incoming batch into one durable weekly partition. Every
 * decision-table state resolves deterministically and independently of the
 * incoming array order; destructive replacement always requires positive
 * evidence (a strictly newer fence AND positively observed field values).
 */
export function computeWeeklyGameStatsMerge(
  existing: WeeklyGameStats | null,
  input: DurableMergeInput
): WeeklyMergeComputation {
  const { year, week, seasonType, fetchStartedAt } = input;
  const incomingFenceMs = parseFenceMs(fetchStartedAt);
  if (incomingFenceMs === null) {
    throw new Error('computeWeeklyGameStatsMerge requires a parseable fetchStartedAt');
  }

  const result: WeeklyMergeComputation = {
    partition: existing,
    changed: false,
    inserted: [],
    updated: [],
    unchanged: [],
    stale: [],
    conflicts: [],
    retainedExisting: [],
    skippedNonPersistable: 0,
  };

  // 1. Persistence authority: only observations with at least one strictly
  //    valid recognized category on BOTH sides may create or update rows.
  const persistable: ParsedV2Observation[] = [];
  for (const observation of input.observations) {
    if (isPersistableIncomingRow(observation)) persistable.push(observation);
    else result.skippedNonPersistable += 1;
  }

  // 2. Deterministic in-batch duplicate handling: identical duplicates count
  //    once; divergent duplicates conflict (array order never decides).
  const byGame = new Map<number, ParsedV2Observation>();
  const duplicateConflicts = new Set<number>();
  for (const observation of persistable) {
    const id = observation.providerGameId;
    const prior = byGame.get(id);
    if (!prior) {
      byGame.set(id, observation);
      continue;
    }
    if (!structurallyEqual(prior, observation)) duplicateConflicts.add(id);
  }
  for (const id of duplicateConflicts) {
    byGame.delete(id);
    result.conflicts.push({ providerGameId: id, reason: 'duplicate-incoming-divergent' });
  }

  const existingGames = existing?.games ?? [];
  const existingById = new Map<number, GameStats>();
  for (const game of existingGames) existingById.set(game.providerGameId, game);

  // 3. Per-game decisions, iterated in sorted-id order for determinism.
  const replacements = new Map<number, GameStats>();
  const insertedRows: GameStats[] = [];
  const addressed = new Set<number>(duplicateConflicts);
  for (const id of [...byGame.keys()].sort((a, b) => a - b)) {
    addressed.add(id);
    const incoming = byGame.get(id)!;
    const current = existingById.get(id);

    if (!current) {
      insertedRows.push(insertGameRow(incoming, week, seasonType, fetchStartedAt));
      result.inserted.push(id);
      continue;
    }

    const isLegacy = !Object.prototype.hasOwnProperty.call(current, 'schemaVersion');
    if (!isLegacy) {
      const currentFenceMs = parseFenceMs(current.fetchStartedAt);
      if (currentFenceMs === null) {
        // A v2 row without a parseable fence cannot prove the incoming
        // observation is newer — never silently defeat the fence.
        result.conflicts.push({ providerGameId: id, reason: 'existing-fence-unparsable' });
        continue;
      }
      if (incomingFenceMs < currentFenceMs) {
        result.stale.push(id);
        continue;
      }
      const merge = mergeGameRow(current, incoming, week, seasonType);
      if (merge.kind === 'conflict') {
        result.conflicts.push({ providerGameId: id, reason: merge.reason });
        continue;
      }
      // Compare CONTENT at the existing fence: an observation that changes
      // nothing is idempotent and must not advance the fence or force a write.
      const comparable: GameStats = { ...merge.row, fetchStartedAt: current.fetchStartedAt };
      if (structurallyEqual(comparable, current)) {
        result.unchanged.push(id);
        continue;
      }
      if (incomingFenceMs === currentFenceMs) {
        // Same fence, divergent content: never last-writer-wins.
        result.conflicts.push({ providerGameId: id, reason: 'same-fence-divergent' });
        continue;
      }
      replacements.set(id, { ...merge.row, fetchStartedAt });
      result.updated.push(id);
      continue;
    }

    // Legacy row (no fence): a validated v2 observation may upgrade it through
    // the same conservative field merge, preserving compatible prior evidence.
    const merge = mergeGameRow(current, incoming, week, seasonType);
    if (merge.kind === 'conflict') {
      result.conflicts.push({ providerGameId: id, reason: merge.reason });
      continue;
    }
    replacements.set(id, { ...merge.row, fetchStartedAt });
    result.updated.push(id);
  }

  for (const game of existingGames) {
    if (!addressed.has(game.providerGameId)) result.retainedExisting.push(game.providerGameId);
  }
  result.retainedExisting.sort((a, b) => a - b);

  result.changed = result.inserted.length > 0 || result.updated.length > 0;
  if (!result.changed) return result;

  // 4. Assemble the merged partition: existing games in their stored order
  //    (updated in place), inserted games appended in sorted-id order. The
  //    partition-level `fetchedAt` never moves backward.
  const mergedGames = existingGames.map((game) => replacements.get(game.providerGameId) ?? game);
  mergedGames.push(...insertedRows);

  const existingFetchedAtMs = existing ? (parseFenceMs(existing.fetchedAt) ?? 0) : null;
  const fetchedAt =
    existing && existingFetchedAtMs !== null && existingFetchedAtMs >= incomingFenceMs
      ? existing.fetchedAt
      : fetchStartedAt;

  result.partition = { year, week, seasonType, fetchedAt, games: mergedGames };
  return result;
}

// === Durable service ===

function noChangeOutcome(computation: WeeklyMergeComputation): DurableMergeOutcome {
  if (computation.conflicts.length > 0) return 'conflict';
  if (computation.stale.length > 0) return 'stale';
  return 'unchanged';
}

function toResult(
  computation: WeeklyMergeComputation,
  outcome: DurableMergeOutcome
): DurableMergeResult {
  return {
    outcome,
    inserted: computation.inserted,
    updated: computation.updated,
    unchanged: computation.unchanged,
    stale: computation.stale,
    conflicts: computation.conflicts,
    retainedExisting: computation.retainedExisting,
    skippedNonPersistable: computation.skippedNonPersistable,
  };
}

function unavailable(reason: DurableMergeUnavailableReason): DurableMergeResult {
  return {
    outcome: 'unavailable',
    inserted: [],
    updated: [],
    unchanged: [],
    stale: [],
    conflicts: [],
    retainedExisting: [],
    skippedNonPersistable: 0,
    unavailableReason: reason,
  };
}

// Mirrors the private scope constant in `cache.ts` — the lock must cover the
// exact durable key the cache helpers read and write.
const GAME_STATS_SCOPE = 'game-stats';

/**
 * Durably merge one validated observation batch into its weekly partition.
 *
 * The whole read→merge→write sequence runs under the durable per-key advisory
 * lock, so two concurrent writers cannot lose disjoint updates and a stale
 * writer completing late cannot roll state backward (its observations fail the
 * per-game fence against the newer durable state it re-reads under the lock).
 * A semantically unchanged merge performs NO durable write and is idempotent
 * under retry. Any storage-layer failure returns a typed `unavailable` result
 * with durable state untouched — stale, conflict, unchanged, and unavailable
 * are never collapsed.
 */
export async function mergeGameStatsPartitionDurable(
  input: DurableMergeInput
): Promise<DurableMergeResult> {
  if (parseFenceMs(input.fetchStartedAt) === null) {
    return unavailable('invalid-fetch-started-at');
  }

  const key = getGameStatsKey(input.year, input.week, input.seasonType);
  try {
    return await withAppStateKeyLock(GAME_STATS_SCOPE, key, async () => {
      let existing: WeeklyGameStats | null;
      try {
        existing = await getCachedGameStats(input.year, input.week, input.seasonType);
      } catch {
        return unavailable('durable-read-failed');
      }

      const computation = computeWeeklyGameStatsMerge(existing, input);
      if (!computation.changed) {
        return toResult(computation, noChangeOutcome(computation));
      }

      try {
        await setCachedGameStats(computation.partition!);
      } catch {
        return unavailable('durable-write-failed');
      }

      const clean = computation.stale.length === 0 && computation.conflicts.length === 0;
      return toResult(computation, clean ? 'written' : 'partially-merged');
    });
  } catch {
    // Lock acquisition/machinery failure: durable state untouched.
    return unavailable('lock-unavailable');
  }
}

import {
  buildV2GameStats,
  isPersistableIncomingRow,
  isValidProviderGameId,
  parseCategoryValue,
  type ParsedV2Observation,
  type ParsedV2TeamObservation,
} from './contract.ts';
import { getGameStatsKey } from './cache.ts';
import {
  AppStateKeyLockAcquireError,
  AppStateTxnCleanupError,
  AppStateTxnFinalizeError,
  withAppStateKeyTransaction,
  type AppStateKeyTxn,
} from '../server/appStateStore.ts';
import { providerRefreshScopeKey, weekPartitionScope } from '../providerRefreshScope.ts';
import type { CfbdSeasonType } from '../cfbd.ts';
import type { GameStats, TeamGameStats, WeeklyGameStats } from './types.ts';

/**
 * PLATFORM-086H2 — durable game-stats merge service (ACTIVE since
 * PLATFORM-086H3).
 *
 * The one durable merge authority in the activated production lifecycle:
 * validated ingestion (`ingestion.ts`) → durable merge (this module) →
 * committed-state coverage (`partitionCoverage.ts`) → schedule-relative
 * recovery (`recovery.ts`) → analytics projection (`contract.ts` via
 * `ownerStats.ts`) → truthful availability (`/api/game-stats`). Activation
 * invariant: every game-stats writer routes through this authority (or the
 * exact same per-partition transaction-scoped lock) — an unlocked writer
 * bypasses the serialization entirely, and the activation guard
 * (`__tests__/activation-guards.test.ts`) fails any bypass or blind
 * partition overwrite.
 *
 * Core guarantees:
 *   - Durable storage is the source of truth: the read→merge→write sequence
 *     runs INSIDE one advisory-locked database transaction on one dedicated
 *     client (`withAppStateKeyTransaction`) — the read, the merge input, and
 *     the conditional write are transaction-scoped, the lock owner never
 *     needs a second pooled connection, and no ordinary success is reported
 *     until COMMIT succeeds. A commit failure with a pending write is
 *     reported as a typed `indeterminate` outcome (durability unknown), never
 *     as "durable state untouched".
 *   - Observation fencing is per game and strictly RFC 3339: fences must be
 *     full date-time strings with an explicit timezone, are canonicalized to
 *     UTC ISO form before comparison and persistence, and compare numerically.
 *     An older observation never overwrites a newer accepted row; equal fences
 *     are idempotent for identical content and a CONFLICT for divergent
 *     content (never last-writer-wins); an unparsable stored fence blocks the
 *     overwrite as a conflict. A strictly NEWER observation that re-confirms
 *     identical content durably advances the row's fence (a fence-only
 *     `refreshed` write) — freshness evidence is itself durable evidence, so a
 *     reordered older observation can never roll state back past it.
 *   - Merging is conservative and field-level: games absent from a partial
 *     batch are retained; a raw category is REPLACED only by a strictly
 *     parse-valid newer value; categories the newer observation omits are
 *     preserved; and normalized values that merged raw evidence cannot
 *     strictly reconstruct are PRESERVED from the prior row rather than
 *     zeroed (compatibility preservation — it establishes no strict
 *     completeness, no analytics eligibility, and no raw or points evidence,
 *     all of which continue to derive from raw/points authority). Points
 *     update only on explicit `pointsProvided` evidence. Row counts, payload
 *     size, and supersets carry NO replacement authority.
 *   - Schema-version authority is respected for EXISTING rows: absent →
 *     legacy-compatible merge; exactly 2 → mergeable v2; any other present
 *     value → typed conflict (`unsupported-schema-version` /
 *     `malformed-schema-version`) with the durable row preserved bit-for-bit.
 *   - Duplicates are deterministic on BOTH sides of the merge: identical
 *     incoming duplicates count once and divergent ones conflict without
 *     array-order bias; identical EXISTING durable duplicates are treated as
 *     one canonical row (collapsed only when an accepted update rewrites the
 *     game), while divergent existing duplicates conflict and are preserved
 *     unchanged. Every result list is sorted and deduplicated.
 *   - Identity is never reconstructed from team strings: games pair by
 *     provider game id, sides pair by home/away, and a positive stored
 *     schoolId contradicting the validated incoming teamId is an
 *     irreconcilable conflict.
 */

// === Service contract ===

export type DurableMergeInput = {
  year: number;
  week: number;
  seasonType: CfbdSeasonType;
  /**
   * Observation fence for this batch: when the provider fetch that produced
   * `observations` STARTED. Must be a strict RFC 3339 date-time with an
   * explicit timezone — anything else makes the whole call `unavailable`
   * (an invalid fence never silently defeats fencing).
   */
  fetchStartedAt: string;
  observations: readonly ParsedV2Observation[];
};

export type MergeConflictReason =
  | 'duplicate-incoming-divergent'
  | 'duplicate-existing-divergent'
  | 'same-fence-divergent'
  | 'identity-contradiction'
  | 'existing-fence-unparsable'
  | 'unsupported-schema-version'
  | 'malformed-schema-version';

export type MergeConflict = { providerGameId: number; reason: MergeConflictReason };

export type DurableMergeOutcome =
  | 'written'
  | 'unchanged'
  | 'partially-merged'
  | 'stale'
  | 'conflict'
  | 'unavailable'
  | 'indeterminate';

export type DurableMergeUnavailableReason =
  | 'invalid-fetch-started-at'
  | 'lock-unavailable'
  | 'durable-read-failed'
  | 'durable-write-failed'
  | 'merge-computation-failed'
  | 'transaction-cleanup-failed'
  | 'transaction-finalize-failed';

export type DurableMergeResult = {
  outcome: DurableMergeOutcome;
  /** The durable partition this merge targeted (`scope/key`). */
  partitionKey: string;
  /**
   * Durable-commit stamp (PLATFORM-086H3) for outcomes that wrote
   * (`written` / `partially-merged`). `commitRevision` is the partition's
   * DURABLE monotonic revision, allocated from the prior committed value
   * INSIDE this merge's advisory-locked transaction — globally comparable
   * across processes, instances, and restarts, so downstream status ordering
   * never depends on process-local sequences or finalizer completion time.
   * `committedAt` is captured immediately after the confirmed COMMIT
   * (display/ordering fallback only).
   */
  commit?: { committedAt: string; commitRevision: number };
  /** Provider game ids — every list sorted ascending and deduplicated. */
  inserted: number[];
  updated: number[];
  /** Fence-only durable refreshes: newer observation, identical content. */
  refreshed: number[];
  unchanged: number[];
  stale: number[];
  conflicts: MergeConflict[];
  /** Existing games the incoming batch did not address — always retained. */
  retainedExisting: number[];
  skippedNonPersistable: number;
  /** Set ONLY when `outcome` is `unavailable` (durable state untouched). */
  unavailableReason?: DurableMergeUnavailableReason;
  /**
   * Set ONLY when `outcome` is `indeterminate`: a write statement ran and the
   * transaction could not be confirmed committed OR cleanly rolled back
   * (`transaction-finalize-failed` = COMMIT failed;
   * `transaction-cleanup-failed` = ROLLBACK failed after a write may have
   * executed), so whether the write persisted is genuinely unknown. Retrying
   * the same input is safe and idempotent either way.
   */
  indeterminate?: {
    reason: 'transaction-finalize-failed' | 'transaction-cleanup-failed';
    durability: 'unknown';
    partitionKey: string;
  };
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

// === Strict RFC 3339 observation fences ===

// Full date + time + seconds (optional fraction) + explicit Z or numeric
// offset. Date-only strings, locale formats, month names, bare numbers, and
// zone-less timestamps are all rejected structurally; calendar and offset
// components are validated EXPLICITLY because `Date.parse` leniently rolls
// over impossible days-of-month (e.g. Feb 30 → Mar 1) instead of failing.
const RFC3339_DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/;

/**
 * The ONE strict RFC 3339 / calendar-valid timestamp parser shared by the
 * game-stats lifecycle: observation fences here, and the public read
 * boundary's `fetchedAt` envelope validation (`readAvailability.ts`).
 * Permissive `Date.parse` normalization (e.g. Feb 30 → Mar 1) never passes.
 */
export function parseStrictRfc3339Ms(value: unknown): number | null {
  return parseFenceMs(value);
}

function parseFenceMs(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = RFC3339_DATE_TIME.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, offset] = match;
  const monthNum = Number(month);
  if (monthNum < 1 || monthNum > 12) return null;
  const daysInMonth = new Date(Date.UTC(Number(year), monthNum, 0)).getUTCDate();
  if (Number(day) < 1 || Number(day) > daysInMonth) return null;
  if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return null;
  if (offset !== 'Z' && offset !== 'z') {
    const [offsetHours, offsetMinutes] = offset!.slice(1).split(':');
    if (Number(offsetHours) > 23 || Number(offsetMinutes) > 59) return null;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** Canonical UTC ISO form used for all persisted fences. */
function canonicalFence(ms: number): string {
  return new Date(ms).toISOString();
}

// === Pure per-game merge ===

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

/**
 * Normalized fields grouped by the raw category that strictly reconstructs
 * them. When merged raw evidence CANNOT strictly reconstruct a family (the
 * category is absent or malformed), the prior row's stored normalized values
 * for that family are preserved instead of the rebuild's zero fallbacks —
 * legacy normalized evidence must never be destroyed by an unrelated partial
 * update. Preservation is compatibility-only: strict completeness, analytics
 * eligibility, and points evidence all continue to derive from raw/points
 * authority, which this overlay never touches.
 */
const NORMALIZED_FIELD_FAMILIES: ReadonlyArray<{
  category: string;
  fields: ReadonlyArray<keyof TeamGameStats>;
}> = [
  { category: 'totalYards', fields: ['totalYards'] },
  { category: 'rushingYards', fields: ['rushingYards'] },
  { category: 'netPassingYards', fields: ['passingYards'] },
  { category: 'rushingAttempts', fields: ['rushingAttempts'] },
  { category: 'passAttempts', fields: ['passingAttempts'] },
  { category: 'passCompletions', fields: ['passingCompletions'] },
  { category: 'rushingTDs', fields: ['rushingTDs'] },
  { category: 'passingTDs', fields: ['passingTDs'] },
  { category: 'firstDowns', fields: ['firstDowns'] },
  { category: 'turnovers', fields: ['turnovers'] },
  { category: 'fumblesLost', fields: ['fumblesLost'] },
  { category: 'interceptions', fields: ['interceptionsThrown'] },
  { category: 'passesIntercepted', fields: ['passesIntercepted'] },
  { category: 'fumblesRecovered', fields: ['fumblesRecovered'] },
  {
    category: 'thirdDownEff',
    fields: ['thirdDownConversions', 'thirdDownAttempts', 'thirdDownPct'],
  },
  { category: 'fourthDownEff', fields: ['fourthDownConversions', 'fourthDownAttempts'] },
  { category: 'totalPenaltiesYards', fields: ['penaltyCount', 'penaltyYards'] },
  { category: 'possessionTime', fields: ['possessionSeconds'] },
  { category: 'interceptionYards', fields: ['interceptionReturnYards'] },
  { category: 'interceptionTDs', fields: ['interceptionReturnTDs'] },
  { category: 'kickReturnYards', fields: ['kickReturnYards'] },
  { category: 'kickReturnTDs', fields: ['kickReturnTDs'] },
  { category: 'puntReturnYards', fields: ['puntReturnYards'] },
  { category: 'puntReturnTDs', fields: ['puntReturnTDs'] },
];

function preserveUnreconstructedNormalizedFields(
  rebuilt: TeamGameStats,
  prior: TeamGameStats,
  mergedRaw: Record<string, string>
): void {
  for (const family of NORMALIZED_FIELD_FAMILIES) {
    if (parseCategoryValue(family.category, mergedRaw[family.category]).status === 'valid') {
      continue;
    }
    for (const field of family.fields) {
      const priorValue = prior[field];
      if (typeof priorValue === 'number') {
        (rebuilt as Record<string, unknown>)[field] = priorValue;
      }
    }
  }
}

type SideMerge = {
  team: ParsedV2TeamObservation;
  preservedPoints: number | null;
  prior: TeamGameStats;
};

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

  const pointsProvided = incoming.pointsProvided || existing.pointsProvided === true;
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
    preservedPoints:
      !pointsProvided && typeof existing.points === 'number' ? existing.points : null,
    prior: existing,
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
  for (const side of [
    { built: row.home, merge: home },
    { built: row.away, merge: away },
  ]) {
    preserveUnreconstructedNormalizedFields(side.built, side.merge.prior, side.merge.team.raw);
    if (side.merge.preservedPoints !== null) side.built.points = side.merge.preservedPoints;
  }
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

// === Existing-row schema-version + duplicate grouping ===

type ExistingRowState =
  | { kind: 'legacy'; row: GameStats }
  | { kind: 'v2'; row: GameStats }
  | { kind: 'version-conflict'; reason: 'unsupported-schema-version' | 'malformed-schema-version' };

function classifyExistingRowVersion(row: GameStats): ExistingRowState {
  const record = row as unknown as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(record, 'schemaVersion')) {
    return { kind: 'legacy', row };
  }
  const version = record.schemaVersion;
  if (version === 2) return { kind: 'v2', row };
  if (typeof version === 'number' && Number.isSafeInteger(version) && version > 2) {
    return { kind: 'version-conflict', reason: 'unsupported-schema-version' };
  }
  return { kind: 'version-conflict', reason: 'malformed-schema-version' };
}

type ExistingGroup =
  | { kind: 'canonical'; state: ExistingRowState }
  | { kind: 'divergent-duplicates' };

/**
 * Group existing durable rows by provider game id WITHOUT array-order
 * authority: identical duplicates collapse to one canonical row (any copy —
 * they are structurally equal); divergent duplicates are a typed conflict that
 * preserves every stored row unchanged.
 */
function groupExistingRows(games: readonly GameStats[]): Map<number, ExistingGroup> {
  const byId = new Map<number, GameStats[]>();
  for (const game of games) {
    const rows = byId.get(game.providerGameId);
    if (rows) rows.push(game);
    else byId.set(game.providerGameId, [game]);
  }
  const groups = new Map<number, ExistingGroup>();
  for (const [id, rows] of byId) {
    const allIdentical = rows.every((row) => structurallyEqual(row, rows[0]));
    if (!allIdentical) {
      groups.set(id, { kind: 'divergent-duplicates' });
      continue;
    }
    groups.set(id, { kind: 'canonical', state: classifyExistingRowVersion(rows[0]!) });
  }
  return groups;
}

// === Pure weekly-partition merge (the decision table) ===

export type WeeklyMergeComputation = {
  /** Merged partition; `null` when nothing exists and nothing is persistable. */
  partition: WeeklyGameStats | null;
  /** Whether the merged partition semantically differs from `existing`. */
  changed: boolean;
  inserted: number[];
  updated: number[];
  refreshed: number[];
  unchanged: number[];
  stale: number[];
  conflicts: MergeConflict[];
  retainedExisting: number[];
  skippedNonPersistable: number;
};

function sortIds(ids: number[]): number[] {
  return [...new Set(ids)].sort((a, b) => a - b);
}

function sortConflicts(conflicts: MergeConflict[]): MergeConflict[] {
  const seen = new Set<string>();
  const unique = conflicts.filter((c) => {
    const key = `${c.providerGameId}:${c.reason}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return unique.sort(
    (a, b) => a.providerGameId - b.providerGameId || a.reason.localeCompare(b.reason)
  );
}

/**
 * Pure merge of one incoming batch into one durable weekly partition. Every
 * decision-table state resolves deterministically and independently of BOTH
 * the incoming array order and the stored array order; destructive replacement
 * always requires positive evidence.
 */
export function computeWeeklyGameStatsMerge(
  existing: WeeklyGameStats | null,
  input: DurableMergeInput
): WeeklyMergeComputation {
  const { year, week, seasonType } = input;
  const incomingFenceMs = parseFenceMs(input.fetchStartedAt);
  if (incomingFenceMs === null) {
    throw new Error('computeWeeklyGameStatsMerge requires a strict RFC 3339 fetchStartedAt');
  }
  const fence = canonicalFence(incomingFenceMs);

  const result: WeeklyMergeComputation = {
    partition: existing,
    changed: false,
    inserted: [],
    updated: [],
    refreshed: [],
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

  // 3. Existing rows: grouped by id (no stored-order authority), with schema
  //    version and divergent-duplicate conflicts resolved before any merge.
  const existingGames = existing?.games ?? [];
  const existingGroups = groupExistingRows(existingGames);
  const addressed = new Set<number>(duplicateConflicts);

  // 4. Per-game decisions, iterated in sorted-id order for determinism.
  const replacements = new Map<number, GameStats>();
  const insertedRows: GameStats[] = [];
  for (const id of [...byGame.keys()].sort((a, b) => a - b)) {
    addressed.add(id);
    const incoming = byGame.get(id)!;
    const group = existingGroups.get(id);

    if (!group) {
      insertedRows.push(insertGameRow(incoming, week, seasonType, fence));
      result.inserted.push(id);
      continue;
    }
    if (group.kind === 'divergent-duplicates') {
      // Preserve every conflicting stored row; reject mutation for this game.
      result.conflicts.push({ providerGameId: id, reason: 'duplicate-existing-divergent' });
      continue;
    }
    const state = group.state;
    if (state.kind === 'version-conflict') {
      // Unsupported/malformed versions are never rebuilt, downgraded, or
      // field-dropped — the stored row stays untouched.
      result.conflicts.push({ providerGameId: id, reason: state.reason });
      continue;
    }

    const current = state.row;
    if (state.kind === 'v2') {
      const currentFenceMs = parseFenceMs(current.fetchStartedAt);
      if (currentFenceMs === null) {
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
      const comparable: GameStats = { ...merge.row, fetchStartedAt: current.fetchStartedAt };
      const contentIdentical = structurallyEqual(comparable, current);
      if (incomingFenceMs === currentFenceMs) {
        if (contentIdentical) {
          result.unchanged.push(id);
        } else {
          // Same fence, divergent content: never last-writer-wins.
          result.conflicts.push({ providerGameId: id, reason: 'same-fence-divergent' });
        }
        continue;
      }
      if (contentIdentical) {
        // Strictly newer observation re-confirmed this exact content: persist
        // the freshness evidence so a reordered OLDER observation can never
        // roll the row back past this confirmation.
        replacements.set(id, { ...current, fetchStartedAt: fence });
        result.refreshed.push(id);
        continue;
      }
      replacements.set(id, { ...merge.row, fetchStartedAt: fence });
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
    replacements.set(id, { ...merge.row, fetchStartedAt: fence });
    result.updated.push(id);
  }

  for (const game of existingGames) {
    if (!addressed.has(game.providerGameId)) result.retainedExisting.push(game.providerGameId);
  }

  result.inserted = sortIds(result.inserted);
  result.updated = sortIds(result.updated);
  result.refreshed = sortIds(result.refreshed);
  result.unchanged = sortIds(result.unchanged);
  result.stale = sortIds(result.stale);
  result.retainedExisting = sortIds(result.retainedExisting);
  result.conflicts = sortConflicts(result.conflicts);

  result.changed =
    result.inserted.length > 0 || result.updated.length > 0 || result.refreshed.length > 0;
  if (!result.changed) return result;

  // 5. Assemble the merged partition: existing games in their stored order
  //    (an accepted update/refresh replaces the game at its FIRST stored
  //    position and collapses identical duplicate copies), inserted games
  //    appended in sorted-id order. Divergent duplicates and version-conflict
  //    rows pass through bit-for-bit. The partition-level `fetchedAt` never
  //    moves backward.
  const emittedReplacement = new Set<number>();
  const mergedGames: GameStats[] = [];
  for (const game of existingGames) {
    const replacement = replacements.get(game.providerGameId);
    if (!replacement) {
      mergedGames.push(game);
      continue;
    }
    if (emittedReplacement.has(game.providerGameId)) continue;
    emittedReplacement.add(game.providerGameId);
    mergedGames.push(replacement);
  }
  mergedGames.push(...insertedRows);

  const existingFetchedAtMs = existing ? Date.parse(existing.fetchedAt) : Number.NaN;
  const fetchedAt =
    existing && Number.isFinite(existingFetchedAtMs) && existingFetchedAtMs >= incomingFenceMs
      ? existing.fetchedAt
      : fence;

  // NOTE: `commitRevision` is stamped by the durable service AFTER ledger
  // allocation (`allocateCommitRevision`) — the pure merge does not invent
  // ordering authority. The envelope copy is informational; the dedicated
  // ledger (+ status floor) is what guarantees monotonicity across
  // restoration, repair, and corruption.
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
  outcome: DurableMergeOutcome,
  partitionKey: string
): DurableMergeResult {
  return {
    outcome,
    partitionKey,
    inserted: computation.inserted,
    updated: computation.updated,
    refreshed: computation.refreshed,
    unchanged: computation.unchanged,
    stale: computation.stale,
    conflicts: computation.conflicts,
    retainedExisting: computation.retainedExisting,
    skippedNonPersistable: computation.skippedNonPersistable,
  };
}

function emptyResult(outcome: DurableMergeOutcome, partitionKey: string): DurableMergeResult {
  return {
    outcome,
    partitionKey,
    inserted: [],
    updated: [],
    refreshed: [],
    unchanged: [],
    stale: [],
    conflicts: [],
    retainedExisting: [],
    skippedNonPersistable: 0,
  };
}

function unavailable(
  reason: DurableMergeUnavailableReason,
  partitionKey: string
): DurableMergeResult {
  return { ...emptyResult('unavailable', partitionKey), unavailableReason: reason };
}

function indeterminate(
  reason: 'transaction-finalize-failed' | 'transaction-cleanup-failed',
  partitionKey: string
): DurableMergeResult {
  return {
    ...emptyResult('indeterminate', partitionKey),
    indeterminate: { reason, durability: 'unknown', partitionKey },
  };
}

/**
 * Internal control-flow sentinel: thrown from inside the transaction callback
 * when the pure merge computation itself fails (e.g. structurally invalid
 * durable state), so the primitive ROLLS BACK before the typed result is
 * returned. Never escapes `mergeGameStatsPartitionDurable`.
 */
class MergeComputationFailure {
  constructor(readonly result: DurableMergeResult) {}
}

// Mirrors the private scope constant in `cache.ts` — the lock must cover the
// exact durable key the game-stats cache reads and writes.
const GAME_STATS_SCOPE = 'game-stats';

// Dedicated per-partition revision LEDGER (PLATFORM-086H3): the durable
// ordering authority for refresh-status publication. Keyed 1:1 with the
// evidence partition, so every allocator serializes on the evidence key's
// advisory lock; co-committed with the evidence write in the SAME
// transaction (rollback discards both). Unlike the informational copy on the
// partition envelope, the ledger survives partition restoration/repair — the
// allocation floor below guarantees the sequence can never reset.
const GAME_STATS_REVISION_SCOPE = 'game-stats-revision';
// Mirrors providerRefreshStatus.PROVIDER_REFRESH_STATUS_SCOPE (imported
// lazily as a literal to avoid a lifecycle → status-module value import; the
// revision floor only READS the status row).
const PROVIDER_REFRESH_STATUS_SCOPE = 'provider-refresh-status';

type RevisionLedgerRecord = { revision: number };

function validRevision(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

/**
 * Allocate the next durable commit revision for one partition INSIDE the
 * evidence transaction. The next revision is strictly greater than every
 * VALID known revision for the scope — the dedicated ledger, the current
 * partition envelope's informational copy, and the refresh-status ledger's
 * last published success revision — so no restoration, repair, corruption,
 * or missing source can ever reset ordering below prior history (a malformed
 * value simply contributes nothing to the floor and is repaired by the
 * ledger write that follows). Deterministic for every combination of
 * missing/malformed/conflicting sources: the floor is the MAX of the valid
 * values, and entirely legacy state (no valid source anywhere) starts at 1.
 */
async function allocateCommitRevision(
  txn: AppStateKeyTxn,
  input: { year: number; week: number; seasonType: CfbdSeasonType },
  existing: WeeklyGameStats | null,
  key: string
): Promise<number> {
  const ledger = await txn.readKey<RevisionLedgerRecord | null>(GAME_STATS_REVISION_SCOPE, key);
  const statusScopeKey = providerRefreshScopeKey(
    'game-stats',
    weekPartitionScope(input.year, input.week, input.seasonType)
  );
  const status = await txn.readKey<{ lastSuccessRevision?: unknown } | null>(
    PROVIDER_REFRESH_STATUS_SCOPE,
    statusScopeKey
  );
  const floor = Math.max(
    validRevision(ledger?.value?.revision) ?? 0,
    validRevision(existing?.commitRevision) ?? 0,
    validRevision(status?.value?.lastSuccessRevision) ?? 0
  );
  return floor + 1;
}

/**
 * Durably merge one validated observation batch into its weekly partition.
 *
 * The whole read→merge→write sequence runs inside ONE advisory-locked
 * transaction on ONE dedicated client, so two concurrent writers cannot lose
 * disjoint updates, a stale writer completing late cannot roll state backward
 * (its observations fail the per-game fence against the newer durable state it
 * re-reads under the lock), and the lock owner can never be starved of a
 * second connection. A semantically unchanged merge performs NO durable write
 * and is idempotent under retry. Storage failures return typed `unavailable`
 * results with durable state untouched; a COMMIT failure with a pending write
 * returns a typed `indeterminate` result (durability unknown) — stale,
 * conflict, unchanged, unavailable, and indeterminate are never collapsed.
 */
export async function mergeGameStatsPartitionDurable(
  input: DurableMergeInput
): Promise<DurableMergeResult> {
  const key = getGameStatsKey(input.year, input.week, input.seasonType);
  const partitionKey = `${GAME_STATS_SCOPE}/${key}`;
  if (parseFenceMs(input.fetchStartedAt) === null) {
    return unavailable('invalid-fetch-started-at', partitionKey);
  }

  // The durable partition revision this transaction WROTE (allocated from the
  // committed prior inside the locked callback); consulted only after the
  // transaction resolves — i.e. only after the COMMIT is confirmed.
  let committedRevision: number | null = null;
  try {
    const result = await withAppStateKeyTransaction(GAME_STATS_SCOPE, key, async (txn) => {
      let existing: WeeklyGameStats | null;
      try {
        existing = (await txn.read<WeeklyGameStats>())?.value ?? null;
      } catch {
        return unavailable('durable-read-failed', partitionKey);
      }

      let computation: WeeklyMergeComputation;
      try {
        computation = computeWeeklyGameStatsMerge(existing, input);
      } catch {
        // Structurally invalid durable state (or a computation defect): throw
        // the sentinel so the transaction ROLLS BACK before this typed result
        // surfaces — never mislabeled as a lock failure.
        throw new MergeComputationFailure(unavailable('merge-computation-failed', partitionKey));
      }
      if (!computation.changed) {
        return toResult(computation, noChangeOutcome(computation), partitionKey);
      }

      let nextRevision: number;
      try {
        nextRevision = await allocateCommitRevision(txn, input, existing, key);
      } catch {
        return unavailable('durable-read-failed', partitionKey);
      }
      computation.partition!.commitRevision = nextRevision;

      try {
        await txn.write(computation.partition!);
        // Co-committed ledger advance: the durable ordering authority moves
        // WITH the evidence in one transaction — rollback discards both, and
        // a concurrent writer cannot observe (or reuse) this revision because
        // every allocator holds this partition's advisory lock.
        await txn.writeKey<RevisionLedgerRecord>(GAME_STATS_REVISION_SCOPE, key, {
          revision: nextRevision,
        });
      } catch {
        return unavailable('durable-write-failed', partitionKey);
      }
      committedRevision = nextRevision;

      const clean = computation.stale.length === 0 && computation.conflicts.length === 0;
      return toResult(computation, clean ? 'written' : 'partially-merged', partitionKey);
    });
    // Commit stamp captured IMMEDIATELY after the confirmed COMMIT (the
    // transaction resolves only post-COMMIT) — never after rereads, coverage
    // evaluation, or publication. The revision was allocated transactionally
    // WITH the write, so it reflects TRUE durable commit order even when a
    // finalizer stalls or the process restarts.
    if (
      (result.outcome === 'written' || result.outcome === 'partially-merged') &&
      committedRevision !== null
    ) {
      result.commit = {
        committedAt: new Date().toISOString(),
        commitRevision: committedRevision,
      };
    }
    return result;
  } catch (error) {
    if (error instanceof MergeComputationFailure) {
      // The primitive confirmed rollback before rethrowing the sentinel.
      return error.result;
    }
    if (error instanceof AppStateTxnFinalizeError) {
      // COMMIT failed: if mutation SQL was SUBMITTED, durability is genuinely
      // unknown; with none, durable state is certainly untouched.
      return error.writeAttempted
        ? indeterminate('transaction-finalize-failed', partitionKey)
        : unavailable('transaction-finalize-failed', partitionKey);
    }
    if (error instanceof AppStateTxnCleanupError) {
      // ROLLBACK failed: the uncertainty threshold is whether mutation SQL was
      // SUBMITTED — a rejected or unacknowledged write may still have executed
      // server-side. Only a transaction that never submitted mutation SQL is
      // defensibly untouched.
      return error.writeAttempted
        ? indeterminate('transaction-cleanup-failed', partitionKey)
        : unavailable('transaction-cleanup-failed', partitionKey);
    }
    if (error instanceof AppStateKeyLockAcquireError) {
      // ONLY genuine lock acquisition / lock-infrastructure failure.
      return unavailable('lock-unavailable', partitionKey);
    }
    // Anything else is an unexpected programming/machinery defect — surface it
    // loudly rather than mislabeling it as an operational failure.
    throw error;
  }
}

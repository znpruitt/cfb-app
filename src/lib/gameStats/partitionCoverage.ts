import type { CfbdSeasonType } from '../cfbd.ts';
import {
  selectCanonicalPartition,
  type CanonicalGame,
  type CanonicalSlate,
  type CanonicalSlateResult,
  type CanonicalSlateUnavailableReason,
} from './canonicalSlate.ts';
import { selectGameEvidence, type EvidenceDecision } from './evidenceAuthority.ts';
import { isValidProviderGameId, type SeasonRelation } from './contract.ts';
import type { GameStats, WeeklyGameStats } from './types.ts';

/**
 * PLATFORM-086H3C1 — weekly coverage (DORMANT).
 *
 * Evaluates coverage for one provider partition from the SUPPLIED committed
 * durable weekly record (never a provider response or an unconfirmed write
 * result) against the canonical slate. Every expected game resolves to exactly
 * one typed state via the shared evidence authority. Rows associate by the
 * canonical CFBD game id + partition agreement; stored ids that match no
 * scheduled game are reported as unmatched and never count as coverage. When the
 * schedule/identity context is unavailable, coverage is unavailable rather than
 * fabricated absence.
 *
 * Only diagnostics with a concrete consumer are surfaced: `pending` /
 * `deferredPlaceholders` (recovery must not treat these as gaps),
 * `unmatchedStoredIds` (stored rows mapping to no scheduled game), and
 * `duplicateConflicts` (irreconcilable divergent duplicates). All are
 * deterministic.
 */

export type PartitionCoverageState =
  | 'not-applicable'
  | 'complete'
  | 'partial'
  | 'absent'
  | 'blocked'
  | 'manual-only';

export type GameCoverage = {
  game: CanonicalGame;
  decision: EvidenceDecision;
};

export type PartitionCoverage = {
  year: number;
  week: number;
  seasonType: CfbdSeasonType;
  state: PartitionCoverageState;
  /** One entry per EXPECTED game, in slate order. */
  games: GameCoverage[];
  /** Upcoming eligible games — reported, never gaps. */
  pending: CanonicalGame[];
  /** Placeholder games deferred until their matchup is set. */
  deferredPlaceholders: CanonicalGame[];
  /** Stored provider ids not present anywhere in this partition's schedule. */
  unmatchedStoredIds: number[];
  /** Expected games whose top evidence class diverged irreconcilably. */
  duplicateConflicts: number[];
};

export type PartitionCoverageResult =
  | { status: 'available'; coverage: PartitionCoverage }
  | { status: 'unavailable'; reason: CanonicalSlateUnavailableReason };

function sortedUnique(ids: number[]): number[] {
  return [...new Set(ids)].sort((a, b) => a - b);
}

/**
 * Group the record's rows by provider game id. Rows without a valid positive
 * provider id are never addressable and are dropped here (they can satisfy or
 * block nothing). Shared association authority: coverage AND the C4 analytics
 * projection (`projectAnalyticsPartition`) both associate rows through THIS one
 * helper, so there is exactly one id-parsing/grouping policy.
 */
export function groupRowsById(record: WeeklyGameStats | null): Map<number, GameStats[]> {
  const byId = new Map<number, GameStats[]>();
  for (const row of record?.games ?? []) {
    const id = (row as { providerGameId?: unknown })?.providerGameId;
    if (!isValidProviderGameId(id)) continue;
    const list = byId.get(id);
    if (list) list.push(row);
    else byId.set(id, [row]);
  }
  return byId;
}

function partitionState(games: GameCoverage[]): PartitionCoverageState {
  if (games.length === 0) return 'not-applicable';
  const satisfied = games.filter((g) => g.decision.state === 'satisfied').length;
  // `complete` is reserved for all-satisfied coverage.
  if (satisfied === games.length) return 'complete';
  // Sparse (incomplete) games still publish a visibly-incomplete public row, so a
  // partition that carries any satisfied OR incomplete evidence is `partial` — it
  // must never report `absent` while `projectPublicFromCoverage` publishes rows.
  const incomplete = games.filter((g) => g.decision.state === 'incomplete').length;
  if (satisfied > 0 || incomplete > 0) return 'partial';
  // Zero published coverage: distinguish the remaining gap kinds.
  if (games.some((g) => g.decision.state === 'blocked-unsupported-schema')) return 'blocked';
  if (games.some((g) => g.decision.state === 'manual-only')) return 'manual-only';
  return 'absent';
}

/**
 * Pure coverage evaluation over an AVAILABLE slate. `week` is the provider
 * partition week (`AppGame.providerWeek`).
 */
export function evaluatePartitionCoverage(
  slate: CanonicalSlate,
  week: number,
  seasonType: CfbdSeasonType,
  record: WeeklyGameStats | null,
  seasonRelation: SeasonRelation
): PartitionCoverage {
  const partition = selectCanonicalPartition(slate, week, seasonType);
  const rowsById = groupRowsById(record);

  // Every scheduled provider id in this partition (any applicability): a stored
  // row for one of these is scheduled, never "unmatched".
  const scheduledIds = new Set<number>();
  for (const game of slate.games) {
    if (game.providerWeek === week && game.seasonType === seasonType) {
      scheduledIds.add(game.providerGameId);
    }
  }

  const games: GameCoverage[] = [];
  const duplicateConflicts: number[] = [];

  for (const game of partition.expected) {
    const candidates = rowsById.get(game.providerGameId) ?? [];
    const decision = selectGameEvidence(game, candidates, seasonRelation);
    games.push({ game, decision });
    if (decision.state === 'duplicate-conflict') duplicateConflicts.push(game.providerGameId);
  }

  const unmatchedStoredIds = [...rowsById.keys()].filter((id) => !scheduledIds.has(id));

  return {
    year: slate.year,
    week,
    seasonType,
    state: partitionState(games),
    games,
    pending: partition.pending,
    deferredPlaceholders: partition.deferredPlaceholders,
    unmatchedStoredIds: sortedUnique(unmatchedStoredIds),
    duplicateConflicts: sortedUnique(duplicateConflicts),
  };
}

/**
 * Coverage from a slate RESULT: an unavailable schedule/identity context makes
 * coverage unavailable rather than treating stored rows as unmatched.
 */
export function evaluatePartitionCoverageFromResult(
  slateResult: CanonicalSlateResult,
  week: number,
  seasonType: CfbdSeasonType,
  record: WeeklyGameStats | null,
  seasonRelation: SeasonRelation
): PartitionCoverageResult {
  if (slateResult.status === 'unavailable') {
    return { status: 'unavailable', reason: slateResult.reason };
  }
  return {
    status: 'available',
    coverage: evaluatePartitionCoverage(
      slateResult.slate,
      week,
      seasonType,
      record,
      seasonRelation
    ),
  };
}

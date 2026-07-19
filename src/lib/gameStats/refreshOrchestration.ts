import type { CfbdSeasonType } from '../cfbd.ts';
import { getCachedGameStats, listCachedGameStats } from './cache.ts';
import { loadGameStatsIdentityResolver } from './identityContext.ts';
import {
  computeScheduleExpectationFingerprint,
  ingestGameStatsObservations,
  type GameStatsSlateExpectation,
} from './ingestion.ts';
import {
  computeCoverageFingerprint,
  evaluateGameStatsPartitionCoverage,
  isPartitionRecoverySatisfied,
} from './partitionCoverage.ts';
import { planGameStatsRecovery, type GameStatsRecoverySlate } from './recovery.ts';
import {
  claimGameStatsRecoveryPartition,
  finalizeGameStatsRecoveryClaim,
  readGameStatsRecoveryDispositions,
  retireGameStatsRecoveryDisposition,
  type GameStatsRecoveryClaim,
  type GameStatsRecoveryFinalization,
} from './recoveryDisposition.ts';
import {
  composeGameStatsStatusPublication,
  finalizeGameStatsRefresh,
  type GameStatsRefreshPublication,
  type GameStatsStatusPublication,
} from './refreshPublication.ts';
import { loadSlateExpectationContext } from './readAvailability.ts';
import type { TeamIdentityResolver } from '../teamIdentity.ts';
import { weekPartitionScope } from '../providerRefreshScope.ts';
import { loadCachedScheduleItems } from '../server/canonicalScheduleCache.ts';
import {
  beginProviderRefreshAttempt,
  recordProviderRefreshFailure,
} from '../server/providerRefreshStatus.ts';

/**
 * PLATFORM-086H3 — game-stats refresh orchestration (ACTIVE).
 *
 * The ONE production entry point for every game-stats refresh attempt. Writer
 * routes (cron, authorized manual refresh) call this module and nothing else:
 * they never import durable mutation primitives, refresh-status publication,
 * recovery-disposition setters, coverage reducers, or transaction locks (the
 * activation guard enforces those ownership boundaries). The orchestrated
 * flow:
 *
 *   canonical target resolution (schedule + identity context)
 *   → durable, FENCED recovery claim (transactional; committed BEFORE any
 *     provider access; never held across the network call)
 *   → provider fetch (caller-supplied thunk — URL/retry policy stay at the
 *     route, quota spent only after a committed claim)
 *   → validated ingestion → durable merge authority
 *   → committed-state finalization (reread → coverage → publication)
 *   → token-CONDITIONAL claim finalization (progress judged ONLY from
 *     committed-coverage / schedule fingerprints)
 *
 * Claim persistence failures propagate BEFORE the provider fetch (no claim →
 * no request). Finalization failures are surfaced on the result (and logged)
 * — never silently swallowed, since the disposition is the mechanism that
 * bounds retries. Authorized manual refreshes participate in the same
 * lifecycle with documented operator semantics: the claim is acquired with
 * `override` (skips backoff gates and fences out an in-flight scheduled
 * claim), and every typed outcome records disposition identically.
 */

export type ProviderPayloadFetch = (target: {
  year: number;
  week: number;
  seasonType: CfbdSeasonType;
}) => Promise<unknown>;

export type RecoveryFinalizationReport = {
  outcome: GameStatsRecoveryFinalization | 'failed';
  detail?: string;
};

/**
 * A recovery-METADATA operation that could not be persisted (claim
 * finalization, retirement, clearing). Surfaced on route results with a
 * stable code — logging alone is insufficient; game-stat evidence is never
 * changed by these operations.
 */
export type RecoveryMetadataFailure = {
  partition: string;
  operation: 'finalize' | 'retire' | 'stale-claim-finalize';
  detail: string;
};

/**
 * Emitted ONLY when a recovery-metadata OPERATION (claim release/finalize,
 * retirement) actually failed — never for a primary reread failure alone.
 */
export const GAME_STATS_RECOVERY_METADATA_FAILURE_CODE = 'game-stats-recovery-metadata-failure';

/** Post-claim revalidation stages, each with a STABLE, stage-specific code. */
export type GameStatsRevalidationStage =
  | 'schedule-context'
  | 'durable-reread'
  | 'coverage-evaluation';

export const GAME_STATS_REVALIDATION_FAILURE_CODES: Readonly<
  Record<GameStatsRevalidationStage, string>
> = {
  'schedule-context': 'game-stats-revalidation-schedule-context-failed',
  'durable-reread': 'game-stats-revalidation-durable-reread-failed',
  'coverage-evaluation': 'game-stats-revalidation-coverage-failed',
};

const GAME_STATS_REVALIDATION_SUMMARIES: Readonly<Record<GameStatsRevalidationStage, string>> = {
  'schedule-context': 'canonical schedule context could not be reread after the claim',
  'durable-reread': 'committed durable partition could not be reread after the claim',
  'coverage-evaluation': 'committed coverage could not be evaluated after the claim',
};

/** Safe, per-operation caller-facing summary for a recovery-metadata failure. */
const RECOVERY_OPERATION_SUMMARIES: Readonly<Record<RecoveryMetadataFailure['operation'], string>> =
  {
    finalize: 'recovery-disposition finalization did not persist',
    retire: 'recovery-disposition retirement did not persist',
    'stale-claim-finalize': 'the claim release did not persist',
  };

/** A recovery-metadata failure projected for the wire — NO raw storage/db
 * messages, file paths, tokens, rows, or stacks. */
export type PublicRecoveryMetadataFailure = {
  partition: string;
  operation: RecoveryMetadataFailure['operation'];
  code: typeof GAME_STATS_RECOVERY_METADATA_FAILURE_CODE;
  summary: string;
  dispositionPersistence: 'uncertain';
};

export function toPublicRecoveryMetadataFailure(
  failure: RecoveryMetadataFailure
): PublicRecoveryMetadataFailure {
  return {
    partition: failure.partition,
    operation: failure.operation,
    code: GAME_STATS_RECOVERY_METADATA_FAILURE_CODE,
    summary: RECOVERY_OPERATION_SUMMARIES[failure.operation],
    dispositionPersistence: 'uncertain',
  };
}

/** The safe, caller-facing projection of a revalidation failure. */
export type PublicGameStatsRevalidationFailure = {
  error: string;
  stage: GameStatsRevalidationStage;
  code: string;
  /** Present ONLY when a recovery-metadata operation actually failed. */
  recoveryFailureCode?: typeof GAME_STATS_RECOVERY_METADATA_FAILURE_CODE;
  recoveryFailures?: PublicRecoveryMetadataFailure[];
  providerAccessOccurred: false;
  leaseMayRemainActive: boolean;
  detail: string;
};

/**
 * Structured post-claim revalidation failure (PLATFORM-086H3): the
 * authoritative reread (schedule context, committed partition, or coverage
 * evaluation) failed AFTER a claim was acquired.
 *
 * Public/internal SEPARATION: the raw underlying cause (`internalCause`) is
 * for SERVER LOGS ONLY and is never serialized; callers receive a STABLE,
 * stage-specific `primary.code` and a SAFE `primary.summary`. The
 * recovery-metadata failure code is attached ONLY when a recovery-metadata
 * operation (claim release) actually failed — a primary reread failure whose
 * claim release succeeded carries only the stage code plus safe zero-fetch
 * metadata. Every secondary failure is projected through
 * `toPublicRecoveryMetadataFailure` (no raw messages/paths/tokens/rows).
 */
export class GameStatsRecoveryRevalidationError extends Error {
  readonly primary: { stage: GameStatsRevalidationStage; code: string; summary: string };
  /** Raw underlying cause — SERVER LOGS ONLY, never serialized to callers. */
  readonly internalCause: unknown;
  readonly recoveryFailures: RecoveryMetadataFailure[];
  readonly partition: string;
  /** No provider request was made for this claim. */
  readonly providerAccessOccurred = false as const;
  /** Whether the released-claim finalization failed (the lease may persist until expiry — still bounded). */
  readonly leaseMayRemainActive: boolean;
  constructor(params: {
    stage: GameStatsRevalidationStage;
    /** Raw cause — logged, never serialized. */
    internalCause: unknown;
    recoveryFailures: RecoveryMetadataFailure[];
    partition: string;
    leaseMayRemainActive: boolean;
  }) {
    const summary = GAME_STATS_REVALIDATION_SUMMARIES[params.stage];
    super(`post-claim revalidation failed (${params.stage}): ${summary}`);
    this.name = 'GameStatsRecoveryRevalidationError';
    this.primary = {
      stage: params.stage,
      code: GAME_STATS_REVALIDATION_FAILURE_CODES[params.stage],
      summary,
    };
    this.internalCause = params.internalCause;
    this.recoveryFailures = params.recoveryFailures;
    this.partition = params.partition;
    this.leaseMayRemainActive = params.leaseMayRemainActive;
    // Raw cause is logged HERE (server-side) and nowhere near the wire.
    console.error('game-stats post-claim revalidation failed', {
      stage: params.stage,
      partition: params.partition,
      internalCause:
        params.internalCause instanceof Error
          ? params.internalCause.message
          : String(params.internalCause),
      recoveryFailures: params.recoveryFailures,
    });
  }

  /** True iff a recovery-metadata operation actually failed. */
  get recoveryMetadataFailed(): boolean {
    return this.recoveryFailures.length > 0;
  }

  /** SAFE, caller-facing projection — nothing raw ever reaches the wire. */
  toPublic(): PublicGameStatsRevalidationFailure {
    return {
      error: `post-claim revalidation failed (${this.primary.stage}): ${this.primary.summary}`,
      stage: this.primary.stage,
      code: this.primary.code,
      ...(this.recoveryMetadataFailed
        ? {
            recoveryFailureCode: GAME_STATS_RECOVERY_METADATA_FAILURE_CODE,
            recoveryFailures: this.recoveryFailures.map(toPublicRecoveryMetadataFailure),
          }
        : {}),
      providerAccessOccurred: false,
      leaseMayRemainActive: this.leaseMayRemainActive,
      detail: `partition ${this.partition}: zero provider calls, no evidence mutation; ${
        this.leaseMayRemainActive
          ? 'recovery-metadata persistence is uncertain and the claim lease remains bounded by its expiry'
          : 'the claim was released'
      }`,
    };
  }
}

async function finalizeClaimVisible(params: {
  claim: GameStatsRecoveryClaim;
  reason: GameStatsRefreshPublication['dispositionReason'];
  now: number;
  postCoverageFingerprint: string | null;
}): Promise<RecoveryFinalizationReport> {
  const { claim, reason, now, postCoverageFingerprint } = params;
  try {
    const outcome = await finalizeGameStatsRecoveryClaim({
      year: claim.year,
      week: claim.week,
      seasonType: claim.seasonType,
      attemptToken: claim.attemptToken,
      reason,
      now,
      postCoverageFingerprint,
      priorCoverageFingerprint: claim.priorCoverageFingerprint,
      scheduleChanged: claim.scheduleChanged,
    });
    return { outcome };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    // Operationally visible: surfaced on the result AND logged. Never rethrown
    // over an already-published refresh outcome.
    console.error('game-stats recovery disposition finalization failed', {
      partition: claim.partitionKey,
      reason,
      detail,
    });
    return { outcome: 'failed', detail };
  }
}

/** Fingerprint of the publication's committed coverage (null when unverifiable). */
function postCoverageFingerprint(publication: GameStatsRefreshPublication): string | null {
  return publication.coverage ? computeCoverageFingerprint(publication.coverage) : null;
}

// === The claimed execution core shared by scheduled and manual flows ===

type ClaimedExecution = {
  publication: GameStatsRefreshPublication;
  recovery: RecoveryFinalizationReport;
  fetchStartedAt: string;
};

async function executeClaimedRefresh(params: {
  claim: GameStatsRecoveryClaim;
  expectation: GameStatsSlateExpectation;
  resolver: TeamIdentityResolver;
  seasonRelation: 'current' | 'historical';
  fetchPayload: ProviderPayloadFetch;
  contextLabel: string;
}): Promise<
  | ClaimedExecution
  | {
      providerError: unknown;
      recovery: RecoveryFinalizationReport;
      statusPublication: GameStatsStatusPublication;
    }
> {
  const { claim, expectation, resolver, seasonRelation, fetchPayload, contextLabel } = params;
  const { year, week, seasonType } = claim;
  const scope = weekPartitionScope(year, week, seasonType);
  const attempt = await beginProviderRefreshAttempt('game-stats', scope, {
    startedAt: new Date().toISOString(),
  });

  // Observation fence: when THIS provider fetch started — captured before the
  // request so a reordered older observation can never outrank a newer one.
  const fetchStartedAt = new Date().toISOString();
  let payload: unknown;
  try {
    payload = await fetchPayload({ year, week, seasonType });
  } catch (error) {
    // BOTH lifecycle mutation results survive to route shaping — a provider
    // failure never discards whether its begin/terminal records persisted.
    const terminal = await recordProviderRefreshFailure('game-stats', scope, {
      attempt,
      error: error instanceof Error ? error.message : 'unknown error',
    });
    const recovery = await finalizeClaimVisible({
      claim,
      reason: 'provider-unavailable',
      now: Date.now(),
      postCoverageFingerprint: null,
    });
    return {
      providerError: error,
      recovery,
      statusPublication: composeGameStatsStatusPublication(attempt.persistence, terminal),
    };
  }

  const ingestion = await ingestGameStatsObservations({
    year,
    week,
    seasonType,
    fetchStartedAt,
    payload,
    expectation,
    resolver,
  });
  const publication = await finalizeGameStatsRefresh({
    ingestion,
    expectation,
    seasonRelation,
    scope,
    attempt,
    contextLabel,
  });
  const recovery = await finalizeClaimVisible({
    claim,
    reason: publication.dispositionReason,
    now: Date.now(),
    postCoverageFingerprint: postCoverageFingerprint(publication),
  });
  return { publication, recovery, fetchStartedAt };
}

// === Post-claim authoritative revalidation ===

export type ClaimedRecoveryTarget = {
  week: number;
  seasonType: CfbdSeasonType;
  claim: GameStatsRecoveryClaim;
  /** FRESH canonical expectation reread AFTER the claim (authoritative). */
  expectation: GameStatsSlateExpectation;
  resolver: TeamIdentityResolver;
};

export type ClaimAndRevalidateResult = {
  target: ClaimedRecoveryTarget | null;
  staleClaims: Array<{ week: number; seasonType: CfbdSeasonType }>;
  recoveryFailures: RecoveryMetadataFailure[];
};

/**
 * Claim the next eligible candidate and REVALIDATE it against authoritative
 * current state before any provider access. The pre-claim recovery plan is a
 * SNAPSHOT and is never trusted after claim acquisition: another writer may
 * have satisfied the partition (or the schedule may have changed) between
 * planning and claiming. After each successful claim this helper rereads the
 * canonical schedule expectation and the committed durable partition, and
 * proceeds only when shared coverage still shows recoverable/absent expected
 * games. A candidate that is now satisfied, blocked, manual-only, unresolved,
 * placeholder-deferred, classification-ineligible, or gone from the schedule
 * is released with a token-CONDITIONAL finalization (`satisfied` → cleared;
 * the token fence means a stale validation can never clear a replacement
 * claim) and selection rotates onward — ZERO provider calls are spent on
 * stale candidates, and the caller still performs at most ONE fetch per run.
 */
export async function claimAndRevalidateNextCandidate(params: {
  year: number;
  now: number;
  candidates: readonly GameStatsRecoverySlate[];
}): Promise<ClaimAndRevalidateResult> {
  const { year, now, candidates } = params;
  const staleClaims: Array<{ week: number; seasonType: CfbdSeasonType }> = [];
  const recoveryFailures: RecoveryMetadataFailure[] = [];

  for (const slate of candidates) {
    if (!slate.eligible) continue;
    const { week, seasonType } = slate;
    const claimResult = await claimGameStatsRecoveryPartition({
      year,
      week,
      seasonType,
      now,
      coverageFingerprint: computeCoverageFingerprint(slate.coverage),
      scheduleFingerprint: computeScheduleExpectationFingerprint(slate.expectation),
    });
    if (!claimResult.claimed) continue;
    const claim = claimResult.claim;

    // AUTHORITATIVE reread after the claim: fresh schedule expectation and
    // fresh committed durable coverage — never the pre-claim plan snapshot.
    const context = await loadSlateExpectationContext({ year, week, seasonType, now });
    if (!context.ok) {
      // Systemic context failure: no fetch is possible or safe. Release the
      // claim (token-conditional, escalating backoff) and STOP the run with
      // a STRUCTURED error — the primary cause and every recovery-metadata
      // failure both survive to route shaping; continuing to other
      // candidates would hit the same store failure.
      const release = await finalizeClaimVisible({
        claim,
        reason: 'durable-unavailable',
        now,
        postCoverageFingerprint: null,
      });
      if (release.outcome === 'failed') {
        recoveryFailures.push({
          partition: claim.partitionKey,
          operation: 'stale-claim-finalize',
          detail: release.detail ?? 'finalization failed',
        });
      }
      throw new GameStatsRecoveryRevalidationError({
        stage: 'schedule-context',
        internalCause: context.detail,
        recoveryFailures,
        partition: claim.partitionKey,
        leaseMayRemainActive: release.outcome === 'failed',
      });
    }

    let committed;
    try {
      committed = await getCachedGameStats(year, week, seasonType);
    } catch (error) {
      const release = await finalizeClaimVisible({
        claim,
        reason: 'durable-unavailable',
        now,
        postCoverageFingerprint: null,
      });
      if (release.outcome === 'failed') {
        recoveryFailures.push({
          partition: claim.partitionKey,
          operation: 'stale-claim-finalize',
          detail: release.detail ?? 'finalization failed',
        });
      }
      throw new GameStatsRecoveryRevalidationError({
        stage: 'durable-reread',
        internalCause: error,
        recoveryFailures,
        partition: claim.partitionKey,
        leaseMayRemainActive: release.outcome === 'failed',
      });
    }
    const coverage = evaluateGameStatsPartitionCoverage(context.expectation, committed, {
      seasonRelation: 'current',
    });
    const freshFingerprint = computeCoverageFingerprint(coverage);
    const stillEligible =
      context.expectation.expectedIds.size > 0 && !isPartitionRecoverySatisfied(coverage);

    if (!stillEligible) {
      // The stale-plan race: another writer satisfied this partition (or the
      // schedule made it ineligible) after planning. Zero provider calls;
      // token-conditionally clear the claim; rotate onward.
      staleClaims.push({ week, seasonType });
      const release = await finalizeClaimVisible({
        claim,
        reason: 'satisfied',
        now,
        postCoverageFingerprint: freshFingerprint,
      });
      if (release.outcome === 'failed') {
        recoveryFailures.push({
          partition: claim.partitionKey,
          operation: 'stale-claim-finalize',
          detail: release.detail ?? 'finalization failed',
        });
      }
      continue;
    }

    return {
      // Progress judgement uses the FRESH pre-fetch fingerprint as the
      // authoritative BEFORE state (the plan-time fingerprint is stale).
      target: {
        week,
        seasonType,
        claim: { ...claim, priorCoverageFingerprint: freshFingerprint },
        expectation: context.expectation,
        resolver: context.resolver,
      },
      staleClaims,
      recoveryFailures,
    };
  }

  return { target: null, staleClaims, recoveryFailures };
}

// === Scheduled (cron) flow ===

export type ScheduledGameStatsRefreshResult = (
  | {
      kind: 'skipped';
      reason: 'no-schedule' | 'all-satisfied' | 'all-ineligible';
      detail: string;
    }
  | {
      kind: 'config-failure';
      week: number;
      seasonType: CfbdSeasonType;
      statusPublication: GameStatsStatusPublication;
    }
  | {
      kind: 'provider-failure';
      week: number;
      seasonType: CfbdSeasonType;
      error: unknown;
      recovery: RecoveryFinalizationReport;
      statusPublication: GameStatsStatusPublication;
    }
  | {
      kind: 'executed';
      week: number;
      seasonType: CfbdSeasonType;
      publication: GameStatsRefreshPublication;
      recovery: RecoveryFinalizationReport;
      fetchStartedAt: string;
    }
) & {
  /** Claims released post-claim because AUTHORITATIVE state was already satisfied/ineligible. */
  staleClaims?: Array<{ week: number; seasonType: CfbdSeasonType }>;
  /** Recovery-METADATA persistence failures (stable code; evidence unchanged). */
  recoveryFailures?: RecoveryMetadataFailure[];
};

/**
 * One scheduled recovery run: plan schedule-relative recovery over committed
 * coverage and durable dispositions, atomically CLAIM the newest eligible
 * candidate (racing executions fall through to the next eligible candidate —
 * overlapping runs can never both fetch one partition), then execute the
 * claimed refresh. Also retires stale dispositions the planner proves
 * satisfied, and transitions blocked/manual-only slates with lingering
 * dispositions to the terminal manual-action state.
 *
 * `providerConfigured: false` (missing credential) records a failed attempt
 * against the exact resolved target partition and returns without a claim.
 */
export async function runScheduledGameStatsRefresh(params: {
  year: number;
  now: number;
  providerConfigured: boolean;
  fetchPayload: ProviderPayloadFetch;
}): Promise<ScheduledGameStatsRefreshResult> {
  const { year, now, providerConfigured, fetchPayload } = params;

  const scheduleItems = await loadCachedScheduleItems(year);
  if (scheduleItems.length === 0) {
    return {
      kind: 'skipped',
      reason: 'no-schedule',
      detail: 'no completed weeks found in cached schedule',
    };
  }
  const [resolver, records, dispositions] = await Promise.all([
    loadGameStatsIdentityResolver(),
    listCachedGameStats(year),
    readGameStatsRecoveryDispositions(year),
  ]);
  const plan = planGameStatsRecovery({
    year,
    scheduleItems,
    resolver,
    records,
    dispositions,
    now,
    seasonRelation: 'current',
  });

  const recoveryFailures: RecoveryMetadataFailure[] = [];

  // Retire stale dispositions from authoritative planner state (best-effort,
  // conditional — an active claim is never touched). Failures are surfaced on
  // the result with a stable code, never logging-only.
  for (const slate of plan.satisfied) {
    if (!dispositions.has(`${year}:${slate.week}:${slate.seasonType}`)) continue;
    const isTerminalState =
      slate.coverage.state === 'blocked' || slate.coverage.state === 'manual-only';
    try {
      await retireGameStatsRecoveryDisposition({
        year,
        week: slate.week,
        seasonType: slate.seasonType,
        now,
        state: isTerminalState ? 'manual-action' : 'satisfied',
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      recoveryFailures.push({
        partition: `${year}:${slate.week}:${slate.seasonType}`,
        operation: 'retire',
        detail,
      });
      console.error('game-stats recovery disposition retirement failed', {
        partition: `${year}:${slate.week}:${slate.seasonType}`,
        detail,
      });
    }
  }
  const withFailures = <T extends ScheduledGameStatsRefreshResult>(result: T): T => ({
    ...result,
    ...(recoveryFailures.length > 0 ? { recoveryFailures } : {}),
  });

  if (plan.candidates.length === 0) {
    return withFailures(
      plan.satisfied.length > 0
        ? {
            kind: 'skipped',
            reason: 'all-satisfied',
            detail: `all ${plan.satisfied.length} completed slate(s) already satisfied by committed durable evidence`,
          }
        : {
            kind: 'skipped',
            reason: 'no-schedule',
            detail: 'no completed weeks found in cached schedule',
          }
    );
  }

  const eligible = plan.candidates.filter((slate) => slate.eligible);
  if (!providerConfigured && eligible.length > 0) {
    // A resolved target with no credential: record the failure against the
    // exact week partition (no claim — configuration is not partition state).
    const first = eligible[0]!;
    const scope = weekPartitionScope(year, first.week, first.seasonType);
    const attempt = await beginProviderRefreshAttempt('game-stats', scope, {
      startedAt: new Date(now).toISOString(),
    });
    const terminal = await recordProviderRefreshFailure('game-stats', scope, {
      attempt,
      error: 'CFBD_API_KEY not configured',
      code: 'cfbd-api-key-missing',
      status: 500,
    });
    return withFailures({
      kind: 'config-failure',
      week: first.week,
      seasonType: first.seasonType,
      statusPublication: composeGameStatsStatusPublication(attempt.persistence, terminal),
    });
  }

  // Atomic claim + POST-CLAIM authoritative revalidation with rotation: a
  // candidate another run claimed refuses; a candidate whose CURRENT durable
  // coverage is already satisfied is released with zero provider calls and
  // selection rotates onward. At most one fetch per run either way.
  const selection = await claimAndRevalidateNextCandidate({
    year,
    now,
    candidates: plan.candidates,
  });
  recoveryFailures.push(...selection.recoveryFailures);
  const staleClaims = selection.staleClaims;
  const withSelection = <T extends ScheduledGameStatsRefreshResult>(result: T): T => ({
    ...withFailures(result),
    ...(staleClaims.length > 0 ? { staleClaims } : {}),
  });

  if (!selection.target) {
    return withSelection(
      staleClaims.length > 0
        ? {
            kind: 'skipped',
            reason: 'all-satisfied',
            detail: `${staleClaims.length} claimed candidate(s) were already satisfied on authoritative reread; remaining candidates are claimed, backing off, or awaiting operator action`,
          }
        : {
            kind: 'skipped',
            reason: 'all-ineligible',
            detail: `all ${plan.candidates.length} recovery candidate(s) are claimed, backing off, or awaiting operator action`,
          }
    );
  }

  const target = selection.target;
  const execution = await executeClaimedRefresh({
    claim: target.claim,
    expectation: target.expectation,
    resolver: target.resolver,
    seasonRelation: 'current',
    fetchPayload,
    contextLabel: `week ${target.week} ${target.seasonType}`,
  });
  if ('providerError' in execution) {
    return withSelection({
      kind: 'provider-failure',
      week: target.week,
      seasonType: target.seasonType,
      error: execution.providerError,
      recovery: execution.recovery,
      statusPublication: execution.statusPublication,
    });
  }
  return withSelection({
    kind: 'executed',
    week: target.week,
    seasonType: target.seasonType,
    publication: execution.publication,
    recovery: execution.recovery,
    fetchStartedAt: execution.fetchStartedAt,
  });
}

// === Authorized manual flow ===

export type ManualGameStatsRefreshResult =
  | { kind: 'context-unavailable'; detail: string }
  | { kind: 'no-schedule' }
  | {
      kind: 'no-canonical-targets';
      slate: {
        deferredPlaceholders: number;
        unresolvedParticipants: number;
        classificationUnknown: number;
        excludedByClassification: number;
        disrupted: number;
      };
    }
  | { kind: 'config-failure'; statusPublication: GameStatsStatusPublication }
  | {
      kind: 'provider-failure';
      error: unknown;
      recovery: RecoveryFinalizationReport;
      statusPublication: GameStatsStatusPublication;
    }
  | {
      kind: 'executed';
      publication: GameStatsRefreshPublication;
      recovery: RecoveryFinalizationReport;
      expectation: GameStatsSlateExpectation;
    };

/**
 * One authorized manual refresh. Canonical target validation happens BEFORE
 * any provider access: the partition must contain at least one scheduled game
 * with authoritative participant identities, explicit eligible FBS/FCS
 * classification, and supported addressability (pending games qualify) — a
 * year with unrelated schedule rows is insufficient, and registry-unknown or
 * classification-unknown games never qualify the partition. The recovery
 * claim uses OVERRIDE semantics (documented): operator intent skips backoff
 * gates and fences out an in-flight scheduled claim, while attempt counting,
 * typed disposition recording, and conditional finalization apply
 * identically.
 */
export async function runManualGameStatsRefresh(params: {
  year: number;
  week: number;
  seasonType: CfbdSeasonType;
  now: number;
  providerConfigured: boolean;
  fetchPayload: ProviderPayloadFetch;
}): Promise<ManualGameStatsRefreshResult> {
  const { year, week, seasonType, now, providerConfigured, fetchPayload } = params;
  const seasonRelation: 'current' | 'historical' =
    year >= seasonYearAt(now) ? 'current' : 'historical';

  const context = await loadSlateExpectationContext({ year, week, seasonType, now });
  if (!context.ok) return { kind: 'context-unavailable', detail: context.detail };
  const { expectation, resolver } = context;
  if (!expectation.scheduleAvailable) return { kind: 'no-schedule' };
  if (expectation.games.size === 0) {
    return {
      kind: 'no-canonical-targets',
      slate: {
        deferredPlaceholders: expectation.deferredPlaceholders,
        unresolvedParticipants: expectation.unresolvedParticipants,
        classificationUnknown: expectation.classificationUnknown,
        excludedByClassification: expectation.excludedByClassification,
        disrupted: expectation.disrupted,
      },
    };
  }

  const scope = weekPartitionScope(year, week, seasonType);
  if (!providerConfigured) {
    const attempt = await beginProviderRefreshAttempt('game-stats', scope, {
      startedAt: new Date(now).toISOString(),
    });
    const terminal = await recordProviderRefreshFailure('game-stats', scope, {
      attempt,
      error: 'CFBD_API_KEY not configured',
      code: 'cfbd-api-key-missing',
      status: 500,
    });
    return {
      kind: 'config-failure',
      statusPublication: composeGameStatsStatusPublication(attempt.persistence, terminal),
    };
  }

  // Authoritative BEFORE state for progress judgement.
  let priorCoverageFingerprint: string;
  try {
    const committed = await getCachedGameStats(year, week, seasonType);
    priorCoverageFingerprint = computeCoverageFingerprint(
      evaluateGameStatsPartitionCoverage(expectation, committed, { seasonRelation })
    );
  } catch {
    // Unreadable committed state: claim with an empty prior fingerprint —
    // finalization treats missing prior state as non-progress.
    priorCoverageFingerprint = '';
  }

  const claimResult = await claimGameStatsRecoveryPartition({
    year,
    week,
    seasonType,
    now,
    coverageFingerprint: priorCoverageFingerprint,
    scheduleFingerprint: computeScheduleExpectationFingerprint(expectation),
    override: true,
  });
  if (!claimResult.claimed) {
    // Unreachable with override semantics; typed for completeness.
    return { kind: 'context-unavailable', detail: `claim refused (${claimResult.reason})` };
  }

  const execution = await executeClaimedRefresh({
    claim: claimResult.claim,
    expectation,
    resolver,
    seasonRelation,
    fetchPayload,
    contextLabel: `week ${week} ${seasonType}`,
  });
  if ('providerError' in execution) {
    return {
      kind: 'provider-failure',
      error: execution.providerError,
      recovery: execution.recovery,
      statusPublication: execution.statusPublication,
    };
  }
  return {
    kind: 'executed',
    publication: execution.publication,
    recovery: execution.recovery,
    expectation,
  };
}

function seasonYearAt(now: number): number {
  const d = new Date(now);
  return d.getUTCMonth() >= 6 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
}

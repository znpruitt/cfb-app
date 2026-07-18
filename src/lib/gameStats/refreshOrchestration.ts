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
  finalizeGameStatsRefresh,
  type GameStatsRefreshPublication,
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
}): Promise<ClaimedExecution | { providerError: unknown; recovery: RecoveryFinalizationReport }> {
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
    await recordProviderRefreshFailure('game-stats', scope, {
      attempt,
      error: error instanceof Error ? error.message : 'unknown error',
    });
    const recovery = await finalizeClaimVisible({
      claim,
      reason: 'provider-unavailable',
      now: Date.now(),
      postCoverageFingerprint: null,
    });
    return { providerError: error, recovery };
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

// === Scheduled (cron) flow ===

export type ScheduledGameStatsRefreshResult =
  | {
      kind: 'skipped';
      reason: 'no-schedule' | 'all-satisfied' | 'all-ineligible';
      detail: string;
    }
  | { kind: 'config-failure'; week: number; seasonType: CfbdSeasonType }
  | {
      kind: 'provider-failure';
      week: number;
      seasonType: CfbdSeasonType;
      error: unknown;
      recovery: RecoveryFinalizationReport;
    }
  | {
      kind: 'executed';
      week: number;
      seasonType: CfbdSeasonType;
      publication: GameStatsRefreshPublication;
      recovery: RecoveryFinalizationReport;
      fetchStartedAt: string;
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

  // Retire stale dispositions from authoritative planner state (best-effort,
  // conditional — an active claim is never touched).
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
      console.error('game-stats recovery disposition retirement failed', {
        partition: `${year}:${slate.week}:${slate.seasonType}`,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (plan.candidates.length === 0) {
    return plan.satisfied.length > 0
      ? {
          kind: 'skipped',
          reason: 'all-satisfied',
          detail: `all ${plan.satisfied.length} completed slate(s) already satisfied by committed durable evidence`,
        }
      : {
          kind: 'skipped',
          reason: 'no-schedule',
          detail: 'no completed weeks found in cached schedule',
        };
  }

  // Atomic claim with rotation: try candidates newest-first; a candidate that
  // a concurrent run claimed (or that entered backoff since planning) refuses
  // and selection moves to the next eligible one.
  let claimed: { slate: GameStatsRecoverySlate; claim: GameStatsRecoveryClaim } | null = null;
  for (const slate of plan.candidates) {
    if (!slate.eligible) continue;
    if (!providerConfigured) {
      // A resolved target with no credential: record the failure against the
      // exact week partition (no claim — configuration is not partition state).
      const scope = weekPartitionScope(year, slate.week, slate.seasonType);
      const attempt = await beginProviderRefreshAttempt('game-stats', scope, {
        startedAt: new Date(now).toISOString(),
      });
      await recordProviderRefreshFailure('game-stats', scope, {
        attempt,
        error: 'CFBD_API_KEY not configured',
        code: 'cfbd-api-key-missing',
        status: 500,
      });
      return { kind: 'config-failure', week: slate.week, seasonType: slate.seasonType };
    }
    const result = await claimGameStatsRecoveryPartition({
      year,
      week: slate.week,
      seasonType: slate.seasonType,
      now,
      coverageFingerprint: computeCoverageFingerprint(slate.coverage),
      scheduleFingerprint: computeScheduleExpectationFingerprint(slate.expectation),
    });
    if (result.claimed) {
      claimed = { slate, claim: result.claim };
      break;
    }
  }

  if (!claimed) {
    return {
      kind: 'skipped',
      reason: 'all-ineligible',
      detail: `all ${plan.candidates.length} recovery candidate(s) are claimed, backing off, or awaiting operator action`,
    };
  }

  const { slate, claim } = claimed;
  const execution = await executeClaimedRefresh({
    claim,
    expectation: slate.expectation,
    resolver,
    seasonRelation: 'current',
    fetchPayload,
    contextLabel: `week ${slate.week} ${slate.seasonType}`,
  });
  if ('providerError' in execution) {
    return {
      kind: 'provider-failure',
      week: slate.week,
      seasonType: slate.seasonType,
      error: execution.providerError,
      recovery: execution.recovery,
    };
  }
  return {
    kind: 'executed',
    week: slate.week,
    seasonType: slate.seasonType,
    publication: execution.publication,
    recovery: execution.recovery,
    fetchStartedAt: execution.fetchStartedAt,
  };
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
  | { kind: 'config-failure' }
  | { kind: 'provider-failure'; error: unknown; recovery: RecoveryFinalizationReport }
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
    await recordProviderRefreshFailure('game-stats', scope, {
      attempt,
      error: 'CFBD_API_KEY not configured',
      code: 'cfbd-api-key-missing',
      status: 500,
    });
    return { kind: 'config-failure' };
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

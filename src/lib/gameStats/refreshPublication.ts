import type { SeasonRelation } from './contract.ts';
import { getCachedGameStats } from './cache.ts';
import type {
  GameStatsIngestionResult,
  GameStatsSlateExpectation,
  ObservationAttachmentCounts,
  ParseFailureCounts,
} from './ingestion.ts';
import {
  evaluateGameStatsPartitionCoverage,
  type GameStatsPartitionCoverage,
} from './partitionCoverage.ts';
import type { WeeklyGameStats } from './types.ts';
import type { ProviderRefreshScope } from '../providerRefreshScope.ts';
import {
  recordProviderRefreshFailure,
  recordProviderRefreshNoop,
  recordProviderRefreshSuccess,
  type ProviderRefreshAttempt,
} from '../server/providerRefreshStatus.ts';

/**
 * PLATFORM-086H3 — committed-state refresh finalization (ACTIVE).
 *
 * The ONE post-ingestion publication path shared by the scheduled cron and the
 * authorized manual refresh. Every confirmed merge outcome flows:
 *
 *   merge returns after COMMIT
 *   → REREAD the durable partition
 *   → classify committed rows (H1 contract)
 *   → evaluate schedule-relative coverage
 *   → publish refresh status / HTTP result
 *
 * Coverage is therefore derived ONLY from committed durable state — never
 * from provider payload size, submitted observations, parser success counts,
 * merge intent, pre-merge rows, or the merge outcome label alone. Publication
 * truthfulness rules enforced here:
 *
 *   - success (full or partial) is recorded only AFTER the committed reread
 *     and coverage evaluation; a partial committed partition is recorded as a
 *     PARTIAL success, never a full one;
 *   - a fence-only `refreshed` durable change is a confirmed commit and is
 *     published like any other accepted change (freshness advanced), with
 *     coverage deciding completeness;
 *   - `unchanged`/`stale` do NOT mean "no applicable data": committed
 *     coverage decides — a complete partition resolves as a truthful no-op,
 *     an incomplete one is a FAILURE (which also means a prior meaningful
 *     failure is never cleared by a no-write outcome);
 *   - a contextually UNEXPECTED empty provider response is a stable failure
 *     (`game-stats-empty-unexpected`), never "no applicable data";
 *   - mismatched participants, unresolved provider identity, and unscheduled
 *     ids are distinct failures — never collapsed;
 *   - `conflict`/`unavailable` are failures with durable state preserved;
 *     `indeterminate` is a failure that publishes NO success and NO
 *     definitive post-write coverage (durability is unknown; retry is safe);
 *   - a POST-COMMIT reread failure never reports the partition as
 *     successfully available: the merge may have committed, and the failure
 *     says exactly that (`game-stats-postcommit-reread-failed`);
 *   - success ordering uses the MERGE AUTHORITY'S commit stamp (captured
 *     immediately after COMMIT, before any reread) — the finalizer never
 *     generates a timestamp that could reorder commits, so a stalled reread
 *     cannot let an older commit overwrite newer last-success metadata;
 *   - provider-attempt DEGRADATION (parse failures, participant mismatches,
 *     unresolved provider identities) survives a successful commit: the
 *     attempt records as PARTIAL and the typed diagnostics ride the
 *     publication — committed availability is not downgraded, but the
 *     degraded attempt is never hidden.
 */

/** Canonical reason a refresh attempt resolved the way it did (recovery bookkeeping). */
export type GameStatsRefreshDispositionReason =
  | 'satisfied'
  | 'partial-coverage'
  /** Recorded by writers when the provider fetch itself failed (pre-ingestion). */
  | 'provider-unavailable'
  | 'empty-expected'
  | 'empty-unexpected'
  | 'invalid-payload'
  | 'schema-drift'
  | 'participant-mismatch'
  | 'unresolved-participant'
  | 'unmatched-observations'
  | 'no-persistable-observations'
  | 'merge-conflict'
  | 'durable-unavailable'
  | 'durable-indeterminate'
  | 'stale-insufficient'
  | 'unchanged-insufficient'
  | 'postcommit-reread-failed';

export type GameStatsRefreshPublication = {
  /** What the provider-refresh status ledger recorded. */
  recorded: 'success' | 'partial-success' | 'noop' | 'failure';
  /** Stable failure code (present iff `recorded` is `failure`). */
  code?: string;
  /** Detail line used for the status record / HTTP body. */
  detail: string;
  /** Suggested HTTP status for the writer's response. */
  httpStatus: number;
  /** Committed durable partition REREAD after the merge (null when absent or reread failed/skipped). */
  committed: WeeklyGameStats | null;
  /** Coverage evaluated from the committed reread (null when unavailable). */
  coverage: GameStatsPartitionCoverage | null;
  reread: 'ok' | 'failed' | 'skipped';
  /** Durable changes the merge ACCEPTED (inserted + updated + fence-refreshed). */
  acceptedGames: number;
  dispositionReason: GameStatsRefreshDispositionReason;
  /**
   * Provider-attempt diagnostics carried through publication (never erased by
   * a successful commit). `degraded` is true when the payload carried parse
   * failures, participant mismatches, or unresolved provider identities —
   * recovery progress is NEVER judged from these (committed-coverage
   * fingerprints own that); they exist for observability.
   */
  attempt: {
    parseFailures: ParseFailureCounts;
    attachment: ObservationAttachmentCounts | null;
    degraded: boolean;
  };
};

function attemptDiagnostics(ingestion: GameStatsIngestionResult): {
  parseFailures: ParseFailureCounts;
  attachment: ObservationAttachmentCounts | null;
  degraded: boolean;
} {
  const parseFailures =
    'parseFailures' in ingestion ? ingestion.parseFailures : ({} as ParseFailureCounts);
  const attachment = 'attachment' in ingestion ? ingestion.attachment : null;
  const parseFailureCount = Object.values(parseFailures).reduce(
    (sum, count) => sum + (count ?? 0),
    0
  );
  const degraded =
    parseFailureCount > 0 ||
    (attachment !== null &&
      (attachment.participantMismatch > 0 || attachment.unresolvedParticipant > 0));
  return { parseFailures, attachment, degraded };
}

function attachmentDetail(attachment: ObservationAttachmentCounts): string {
  return (
    `matched ${attachment.matched}, participant-mismatch ${attachment.participantMismatch}, ` +
    `unresolved-participant ${attachment.unresolvedParticipant}, unscheduled ${attachment.unscheduledId}, ` +
    `excluded ${attachment.excludedClassification}, placeholder-deferred ${attachment.placeholderDeferred}`
  );
}

function unattachableFailure(attachment: ObservationAttachmentCounts): {
  code: string;
  reason: GameStatsRefreshDispositionReason;
  summary: string;
} {
  if (attachment.participantMismatch > 0) {
    return {
      code: 'game-stats-participant-mismatch',
      reason: 'participant-mismatch',
      summary: 'provider participants did not agree with the canonical schedule participants',
    };
  }
  if (attachment.unresolvedParticipant > 0) {
    return {
      code: 'game-stats-unresolved-participant',
      reason: 'unresolved-participant',
      summary: 'provider participants could not be resolved to canonical team identities',
    };
  }
  return {
    code: 'game-stats-unmatched-observations',
    reason: 'unmatched-observations',
    summary: 'no provider observation attached to a canonical schedule game',
  };
}

export type FinalizeGameStatsRefreshParams = {
  ingestion: GameStatsIngestionResult;
  expectation: GameStatsSlateExpectation;
  seasonRelation: SeasonRelation;
  scope: ProviderRefreshScope;
  attempt: ProviderRefreshAttempt;
  /** Message prefix, e.g. `week 3 regular`. */
  contextLabel: string;
  source?: string;
};

/**
 * Publish the truthful outcome of one refresh attempt. See the module header
 * for the full matrix. Returns the committed serving state so the caller can
 * shape its HTTP response WITHOUT re-deriving coverage.
 */
export async function finalizeGameStatsRefresh(
  params: FinalizeGameStatsRefreshParams
): Promise<GameStatsRefreshPublication> {
  const { ingestion, expectation, seasonRelation, scope, attempt, contextLabel } = params;
  const source = params.source ?? 'cfbd';
  const diagnostics = attemptDiagnostics(ingestion);

  const fail = async (
    code: string,
    reason: GameStatsRefreshDispositionReason,
    detail: string,
    httpStatus: number,
    extras: Partial<GameStatsRefreshPublication> = {}
  ): Promise<GameStatsRefreshPublication> => {
    await recordProviderRefreshFailure('game-stats', scope, {
      attempt,
      error: `${contextLabel}: ${detail}`,
      code,
      status: httpStatus,
    });
    return {
      recorded: 'failure',
      code,
      detail,
      httpStatus,
      committed: null,
      coverage: null,
      reread: 'skipped',
      acceptedGames: 0,
      dispositionReason: reason,
      attempt: diagnostics,
      ...extras,
    };
  };

  switch (ingestion.kind) {
    case 'invalid-payload':
      return fail(
        'game-stats-invalid-payload',
        'invalid-payload',
        'provider payload was not an array',
        502
      );
    case 'schema-drift':
      return fail(
        'game-stats-schema-drift',
        'schema-drift',
        `provider returned ${ingestion.entryCount} row(s) but none parsed as a game observation`,
        502
      );
    case 'valid-empty': {
      if (ingestion.emptyContext === 'unexpected') {
        // The canonical schedule expects completed stat-producing games here:
        // an empty provider response is a stable FAILURE, never "no
        // applicable data" — prior-good durable evidence is preserved and the
        // latest meaningful failure state is not cleared.
        return fail(
          'game-stats-empty-unexpected',
          'empty-unexpected',
          `provider returned no game stats although ${expectation.expectedIds.size} completed game(s) expect them`,
          502
        );
      }
      await recordProviderRefreshNoop('game-stats', scope, { attempt, source });
      return {
        recorded: 'noop',
        detail: 'provider returned no game stats yet (nothing expected for this slate)',
        httpStatus: 200,
        committed: null,
        coverage: null,
        reread: 'skipped',
        acceptedGames: 0,
        dispositionReason: 'empty-expected',
        attempt: diagnostics,
      };
    }
    case 'no-attachable-observations': {
      const { code, reason, summary } = unattachableFailure(ingestion.attachment);
      return fail(code, reason, `${summary} (${attachmentDetail(ingestion.attachment)})`, 502);
    }
    case 'no-persistable-observations':
      return fail(
        'game-stats-no-persistable-observations',
        'no-persistable-observations',
        `${ingestion.attachment.matched} attached observation(s) carried no persistable category evidence`,
        502
      );
    case 'merged':
      break;
  }

  const { merge } = ingestion;
  if (merge.outcome === 'unavailable') {
    return fail(
      'game-stats-durable-unavailable',
      'durable-unavailable',
      `durable storage unavailable (${merge.unavailableReason}); durable state untouched`,
      503
    );
  }
  if (merge.outcome === 'indeterminate') {
    // Durability is genuinely UNKNOWN: publish no success and no definitive
    // post-write coverage. A later retry reacquires the lock and recomputes
    // from durable state; the recovery disposition applies backoff so the
    // retry is bounded, not every-run.
    return fail(
      'game-stats-durable-indeterminate',
      'durable-indeterminate',
      `durable write durability unknown (${merge.indeterminate?.reason}); retry is safe and idempotent`,
      500
    );
  }
  if (merge.outcome === 'conflict') {
    return fail(
      'game-stats-merge-conflict',
      'merge-conflict',
      `durable merge rejected every observation (${merge.conflicts.length} conflict(s)); stored rows preserved`,
      409
    );
  }

  // Confirmed outcomes (written / partially-merged / unchanged / stale —
  // fence-only refreshes surface as `written` with ids under `refreshed`):
  // REREAD committed durable state before ANY publication.
  const accepted = merge.inserted.length + merge.updated.length + merge.refreshed.length;
  let committed: WeeklyGameStats | null;
  try {
    committed = await getCachedGameStats(
      expectation.year,
      expectation.week,
      expectation.seasonType
    );
  } catch (error) {
    const detail =
      accepted > 0
        ? 'the merge committed but the post-commit durable reread failed; serving state is unverifiable (durable evidence preserved; retry is safe)'
        : 'the post-commit durable reread failed; serving state is unverifiable (no durable change was accepted; retry is safe)';
    const publication = await fail(
      'game-stats-postcommit-reread-failed',
      'postcommit-reread-failed',
      detail,
      503
    );
    return {
      ...publication,
      reread: 'failed',
      acceptedGames: accepted,
      detail: error instanceof Error ? `${detail} (${error.message})` : detail,
    };
  }

  const coverage = evaluateGameStatsPartitionCoverage(expectation, committed, { seasonRelation });
  const complete = coverage.state === 'complete' || coverage.state === 'not-applicable';

  if (accepted > 0) {
    // The commit stamp comes from the MERGE AUTHORITY, captured immediately
    // after the confirmed COMMIT — never regenerated here, so a stalled
    // reread/finalizer cannot reorder commits on the status ledger.
    const partial = !complete || merge.conflicts.length > 0 || diagnostics.degraded;
    await recordProviderRefreshSuccess('game-stats', scope, {
      attempt,
      committedAt: merge.commit?.committedAt,
      commitSeq: merge.commit?.commitSeq,
      source,
      rowsCommitted: accepted,
      partialFailure: partial,
    });
    const degradedNote = diagnostics.degraded
      ? '; provider payload degradation observed (parse/attachment diagnostics retained)'
      : '';
    return {
      recorded: partial ? 'partial-success' : 'success',
      detail: complete
        ? `committed ${accepted} game(s); committed coverage is complete${degradedNote}`
        : `committed ${accepted} game(s); committed coverage is ${coverage.state} (${coverage.satisfied.length}/${coverage.expected.length} expected games satisfied)${degradedNote}`,
      httpStatus: 200,
      committed,
      coverage,
      reread: 'ok',
      acceptedGames: accepted,
      dispositionReason: complete ? 'satisfied' : 'partial-coverage',
      attempt: diagnostics,
    };
  }

  // No durable change (`unchanged` at an equal fence, or every observation
  // `stale`). Committed coverage — not the outcome label — decides.
  if (complete) {
    await recordProviderRefreshNoop('game-stats', scope, { attempt, source });
    return {
      recorded: 'noop',
      detail: `durable state already satisfies the schedule expectation (${merge.outcome})`,
      httpStatus: 200,
      committed,
      coverage,
      reread: 'ok',
      acceptedGames: 0,
      dispositionReason: 'satisfied',
      attempt: diagnostics,
    };
  }

  const stale = merge.outcome === 'stale' || merge.stale.length > 0;
  const publication = await fail(
    stale ? 'game-stats-stale-insufficient' : 'game-stats-unchanged-insufficient',
    stale ? 'stale-insufficient' : 'unchanged-insufficient',
    stale
      ? `provider observations were older than durable evidence and committed coverage is still ${coverage.state}`
      : `provider observations added no durable evidence and committed coverage is still ${coverage.state}`,
    502
  );
  return { ...publication, committed, coverage, reread: 'ok' };
}

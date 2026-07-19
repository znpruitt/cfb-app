import { NextResponse } from 'next/server';

import { fetchUpstreamJson } from '@/lib/api/fetchUpstream';
import { buildCfbdGameTeamStatsUrl, type CfbdSeasonType } from '@/lib/cfbd';
import {
  GAME_STATS_RECOVERY_METADATA_FAILURE_CODE,
  GameStatsRecoveryRevalidationError,
  runScheduledGameStatsRefresh,
  toPublicRecoveryMetadataFailure,
  type PublicRecoveryMetadataFailure,
  type ScheduledGameStatsRefreshResult,
} from '@/lib/gameStats/refreshOrchestration';
import type {
  GameStatsAttemptDiagnostics,
  GameStatsRefreshPublication,
} from '@/lib/gameStats/refreshPublication';
import { isAutoRefreshAllowed } from '@/lib/server/providerRefreshSettings';

export const dynamic = 'force-dynamic';

// PLATFORM-086H3: this route is a THIN shell over the game-stats refresh
// orchestration boundary — it owns cron authentication, the pause gate, the
// provider transport (URL/retry policy), and HTTP shaping, and imports NO
// durable mutation, status publication, recovery disposition, or coverage
// machinery (the activation guard enforces that ownership).

const CFBD_API_KEY = process.env.CFBD_API_KEY ?? '';

const RETRY_POLICY = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 4_000,
  jitterRatio: 0.2,
  retryOnHttpStatuses: [408, 429, 500, 502, 503, 504],
} as const;

const PACING_POLICY = {
  key: 'cfbd',
  minIntervalMs: 150,
} as const;

type CronCoverageSummary = {
  state: string;
  satisfied: number;
  expected: number;
  blocked: number;
  recoverable: number;
  absent: number;
};

type CronResult = {
  year: number;
  week: number | null;
  seasonType: CfbdSeasonType | null;
  gamesProcessed: number;
  fetchedAt: string | null;
  skipped?: string;
  error?: string;
  detail?: string;
  coverage?: CronCoverageSummary;
  recovery?: string;
  /** Post-claim revalidation released these claims with zero provider calls. */
  staleClaims?: Array<{ week: number; seasonType: CfbdSeasonType }>;
  /**
   * Recovery-METADATA persistence failures (stable code
   * `game-stats-recovery-metadata-failure`): the provider request for these
   * partitions was skipped or already resolved, recovery bookkeeping could
   * not be finalized/retired, and game-stat evidence was NOT changed.
   */
  recoveryFailures?: PublicRecoveryMetadataFailure[];
  recoveryFailureCode?: string;
  /** Stage of a post-claim revalidation failure (stable, stage-specific). */
  stage?: string;
  code?: string;
  /** Zero-fetch truth on a post-claim revalidation failure. */
  providerAccessOccurred?: false;
  leaseMayRemainActive?: boolean;
  /** Typed provider-attempt degradation counts (parse/attachment buckets). */
  attempt?: GameStatsAttemptDiagnostics;
  /** Present when the status-ledger mutation did not persist normally. */
  statusPublication?: { begin: string; terminal: string; complete: boolean };
};

function verifyCronSecret(req: Request): 'ok' | 'not-configured' | 'invalid' {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) return 'not-configured';
  const authHeader = req.headers.get('authorization') ?? '';
  return authHeader === `Bearer ${cronSecret}` ? 'ok' : 'invalid';
}

function seasonYearForToday(now = new Date()): number {
  const month = now.getUTCMonth();
  const year = now.getUTCFullYear();
  return month >= 6 ? year : year - 1;
}

function coverageSummary(
  publication: GameStatsRefreshPublication
): CronCoverageSummary | undefined {
  const coverage = publication.coverage;
  if (!coverage) return undefined;
  return {
    state: coverage.state,
    satisfied: coverage.satisfied.length,
    expected: coverage.expected.length,
    blocked: coverage.blocked.length,
    recoverable: coverage.recoverable.length,
    absent: coverage.absent.length,
  };
}

function fetchGameTeamStats(target: {
  year: number;
  week: number;
  seasonType: CfbdSeasonType;
}): Promise<unknown> {
  const cfbdUrl = buildCfbdGameTeamStatsUrl(target);
  return fetchUpstreamJson<unknown>(cfbdUrl.toString(), {
    headers: { Authorization: `Bearer ${CFBD_API_KEY}` },
    timeoutMs: 15_000,
    retry: RETRY_POLICY,
    pacing: PACING_POLICY,
  });
}

export async function GET(req: Request): Promise<NextResponse<CronResult>> {
  const authResult = verifyCronSecret(req);
  if (authResult !== 'ok') {
    const error =
      authResult === 'not-configured'
        ? 'CRON_SECRET is not configured on the server'
        : 'unauthorized: Bearer token did not match CRON_SECRET';
    return NextResponse.json(
      { year: 0, week: null, seasonType: null, gamesProcessed: 0, fetchedAt: null, error },
      { status: 401 }
    );
  }

  const year = seasonYearForToday();
  const emptyResult: CronResult = {
    year,
    week: null,
    seasonType: null,
    gamesProcessed: 0,
    fetchedAt: null,
  };

  // Operational auto-refresh control (PLATFORM-086A): game-stats is a
  // NONCRITICAL ingestion job, so it honors the global pause and its per-dataset
  // enable flag. Manual admin refresh (/api/game-stats?bypassCache=1) stays
  // available even when paused.
  if (!(await isAutoRefreshAllowed('game-stats'))) {
    return NextResponse.json({
      ...emptyResult,
      skipped: 'automatic game-stats refresh is paused or disabled',
    });
  }

  let result: ScheduledGameStatsRefreshResult;
  try {
    result = await runScheduledGameStatsRefresh({
      year,
      now: Date.now(),
      providerConfigured: Boolean(CFBD_API_KEY),
      fetchPayload: fetchGameTeamStats,
    });
  } catch (err) {
    if (err instanceof GameStatsRecoveryRevalidationError) {
      // Post-claim revalidation failed. The SAFE projection carries the
      // stage-specific stable code and summary, the recovery-metadata code
      // ONLY when a recovery operation actually failed, and only sanitized
      // secondary failures — the raw storage cause is logged server-side, never
      // serialized. Zero-fetch/no-mutation/lease-bounded truth is preserved.
      return NextResponse.json({ ...emptyResult, ...err.toPublic() }, { status: 500 });
    }
    // Target resolution / identity context / claim persistence failure: the
    // established cron error path, with NO provider call spent and no failure
    // assigned to a data scope that was never verified. The raw cause is
    // logged; only a generic message reaches the caller.
    console.error('game-stats cron refresh failed before revalidation', {
      cause: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { ...emptyResult, error: 'game-stats cron refresh failed' },
      { status: 500 }
    );
  }

  const recoveryMeta = {
    ...(result.staleClaims && result.staleClaims.length > 0
      ? { staleClaims: result.staleClaims }
      : {}),
    ...(result.recoveryFailures && result.recoveryFailures.length > 0
      ? {
          // Sanitized: safe per-operation summaries, never raw storage messages.
          recoveryFailures: result.recoveryFailures.map(toPublicRecoveryMetadataFailure),
          recoveryFailureCode: GAME_STATS_RECOVERY_METADATA_FAILURE_CODE,
        }
      : {}),
  };

  switch (result.kind) {
    case 'skipped':
      return NextResponse.json({ ...emptyResult, skipped: result.detail, ...recoveryMeta });
    case 'config-failure':
      return NextResponse.json(
        {
          ...emptyResult,
          week: result.week,
          seasonType: result.seasonType,
          error: 'CFBD_API_KEY not configured',
          ...(!result.statusPublication.complete
            ? { statusPublication: result.statusPublication }
            : {}),
          ...recoveryMeta,
        },
        { status: 500 }
      );
    case 'provider-failure':
      // BOTH causes retained: the provider failure is the primary error; a
      // disposition-finalization failure is surfaced separately with its
      // stable code — neither replaces the other.
      return NextResponse.json(
        {
          ...emptyResult,
          week: result.week,
          seasonType: result.seasonType,
          error: result.error instanceof Error ? result.error.message : 'unknown error',
          ...(!result.statusPublication.complete
            ? { statusPublication: result.statusPublication }
            : {}),
          ...(result.recovery.outcome === 'failed'
            ? {
                // Safe summary only — the raw disposition-store cause is logged
                // by the orchestration layer, never serialized.
                recovery: 'recovery-disposition finalization did not persist (uncertain)',
                recoveryFailureCode: GAME_STATS_RECOVERY_METADATA_FAILURE_CODE,
              }
            : {}),
          ...recoveryMeta,
        },
        { status: 500 }
      );
    case 'executed':
      break;
  }

  const { publication } = result;
  const coverage = coverageSummary(publication);
  const attempt = publication.attempt;
  // Surface the composite lifecycle whenever it is anything but fully
  // complete — a failed BEGIN marker is reportable even when the terminal
  // record (and the evidence) persisted.
  const statusPublication = !publication.statusPublication.complete
    ? { statusPublication: publication.statusPublication }
    : {};
  const recovery =
    result.recovery.outcome === 'failed'
      ? 'recovery-disposition finalization did not persist (uncertain)'
      : undefined;

  if (publication.recorded === 'failure') {
    return NextResponse.json(
      {
        ...emptyResult,
        week: result.week,
        seasonType: result.seasonType,
        error: publication.code,
        detail: publication.detail,
        coverage,
        attempt,
        ...statusPublication,
        ...(recovery
          ? { recovery, recoveryFailureCode: GAME_STATS_RECOVERY_METADATA_FAILURE_CODE }
          : {}),
        ...recoveryMeta,
      },
      { status: publication.httpStatus }
    );
  }
  if (publication.recorded === 'noop') {
    return NextResponse.json({
      year,
      week: result.week,
      seasonType: result.seasonType,
      gamesProcessed: 0,
      fetchedAt: null,
      skipped: `week ${result.week} ${result.seasonType}: ${publication.detail}`,
      coverage,
      attempt,
      ...statusPublication,
      ...(recovery
        ? { recovery, recoveryFailureCode: GAME_STATS_RECOVERY_METADATA_FAILURE_CODE }
        : {}),
      ...recoveryMeta,
    });
  }
  return NextResponse.json({
    year,
    week: result.week,
    seasonType: result.seasonType,
    gamesProcessed: publication.acceptedGames,
    fetchedAt: result.fetchStartedAt,
    ...(publication.recorded === 'partial-success' ? { detail: publication.detail } : {}),
    coverage,
    attempt,
    ...statusPublication,
    ...(recovery
      ? { recovery, recoveryFailureCode: GAME_STATS_RECOVERY_METADATA_FAILURE_CODE }
      : {}),
    ...recoveryMeta,
  });
}

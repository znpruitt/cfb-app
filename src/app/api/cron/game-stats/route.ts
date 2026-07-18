import { NextResponse } from 'next/server';

import { fetchUpstreamJson } from '@/lib/api/fetchUpstream';
import { buildCfbdGameTeamStatsUrl, type CfbdSeasonType } from '@/lib/cfbd';
import { listCachedGameStats } from '@/lib/gameStats/cache';
import { loadGameStatsIdentityResolver } from '@/lib/gameStats/identityContext';
import { ingestGameStatsObservations } from '@/lib/gameStats/ingestion';
import { planGameStatsRecovery } from '@/lib/gameStats/recovery';
import {
  readGameStatsRecoveryDispositions,
  recordGameStatsRecoveryAttempt,
} from '@/lib/gameStats/recoveryDisposition';
import {
  finalizeGameStatsRefresh,
  type GameStatsRefreshPublication,
} from '@/lib/gameStats/refreshPublication';
import { loadCachedScheduleItems } from '@/lib/server/canonicalScheduleCache';
import { isAutoRefreshAllowed } from '@/lib/server/providerRefreshSettings';
import { weekPartitionScope } from '@/lib/providerRefreshScope';
import {
  beginProviderRefreshAttempt,
  recordProviderRefreshFailure,
} from '@/lib/server/providerRefreshStatus';

export const dynamic = 'force-dynamic';

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
  // available even when paused. (The lifecycle-critical season-transition cron is
  // exempt and does not call this.)
  if (!(await isAutoRefreshAllowed('game-stats'))) {
    return NextResponse.json({
      ...emptyResult,
      skipped: 'automatic game-stats refresh is paused or disabled',
    });
  }

  // Schedule-relative recovery target resolution (PLATFORM-086H3): compare
  // canonical schedule expectations (WITH canonical participants and
  // classification) against COMMITTED durable evidence and the durable
  // recovery disposition, then take the newest ELIGIBLE slate still needing
  // repair — a backed-off newer slate rotates selection to older eligible
  // ones. Cache-only — no provider call — and it runs BEFORE credential
  // validation so every outcome records against the exact week partition this
  // run targets, never the year rollup. A failure HERE (schedule, identity
  // context, durable coverage, or disposition read) uses the established cron
  // error path WITHOUT assigning the failure to any data scope: no target has
  // been verified, and a read failure must never be reinterpreted as absent
  // coverage.
  let plan: ReturnType<typeof planGameStatsRecovery>;
  let resolver: Awaited<ReturnType<typeof loadGameStatsIdentityResolver>>;
  try {
    const scheduleItems = await loadCachedScheduleItems(year);
    if (scheduleItems.length === 0) {
      return NextResponse.json({
        ...emptyResult,
        skipped: 'no completed weeks found in cached schedule',
      });
    }
    const [loadedResolver, records, dispositions] = await Promise.all([
      loadGameStatsIdentityResolver(),
      listCachedGameStats(year),
      readGameStatsRecoveryDispositions(year),
    ]);
    resolver = loadedResolver;
    plan = planGameStatsRecovery({
      year,
      scheduleItems,
      resolver,
      records,
      dispositions,
      now: Date.now(),
      seasonRelation: 'current',
    });
    if (!plan.target) {
      let skipped: string;
      if (plan.candidates.length > 0) {
        skipped = `all ${plan.candidates.length} recovery candidate(s) are backing off or awaiting operator action`;
      } else if (plan.satisfied.length > 0) {
        skipped = `all ${plan.satisfied.length} completed slate(s) already satisfied by committed durable evidence`;
      } else {
        skipped = 'no completed weeks found in cached schedule';
      }
      return NextResponse.json({ ...emptyResult, skipped });
    }
  } catch (err) {
    return NextResponse.json(
      { ...emptyResult, error: err instanceof Error ? err.message : 'unknown error' },
      { status: 500 }
    );
  }

  const target = plan.target;
  const { week, seasonType, expectation } = target;
  const weekScope = weekPartitionScope(year, week, seasonType);
  const contextLabel = `week ${week} ${seasonType}`;

  const recordDisposition = async (
    reason: GameStatsRefreshPublication['dispositionReason'],
    meaningfulChange: boolean
  ): Promise<void> => {
    try {
      await recordGameStatsRecoveryAttempt({
        year,
        week,
        seasonType,
        reason,
        meaningfulChange,
        now: Date.now(),
      });
    } catch (error) {
      // Disposition bookkeeping is best-effort operational state: a failed
      // write must not overturn the already-published refresh outcome.
      console.error('game-stats recovery disposition write failed', {
        year,
        week,
        seasonType,
        reason,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  if (!CFBD_API_KEY) {
    // Missing credential on an unpaused cron WITH a resolved target: record a
    // failed attempt against THIS week partition (not the year rollup) so the
    // panel shows the automatic refresh is broken and a later successful run of
    // the same week can replace it through normal attempt ordering. Prior-good
    // data is preserved. No disposition escalation: the failure is local
    // configuration, not partition state.
    const attempt = await beginProviderRefreshAttempt('game-stats', weekScope, {
      startedAt: new Date().toISOString(),
    });
    await recordProviderRefreshFailure('game-stats', weekScope, {
      attempt,
      error: 'CFBD_API_KEY not configured',
      code: 'cfbd-api-key-missing',
      status: 500,
    });
    return NextResponse.json(
      { ...emptyResult, week, seasonType, error: 'CFBD_API_KEY not configured' },
      { status: 500 }
    );
  }

  const attempt = await beginProviderRefreshAttempt('game-stats', weekScope, {
    startedAt: new Date().toISOString(),
  });

  try {
    // Observation fence: when THIS provider fetch started. Captured before the
    // request so a reordered older observation can never outrank a newer one.
    const fetchStartedAt = new Date().toISOString();
    const cfbdUrl = buildCfbdGameTeamStatsUrl({ year, week, seasonType });
    const rawGames = await fetchUpstreamJson<unknown>(cfbdUrl.toString(), {
      headers: { Authorization: `Bearer ${CFBD_API_KEY}` },
      timeoutMs: 15_000,
      retry: RETRY_POLICY,
      pacing: PACING_POLICY,
    });

    // Validation → canonical attachment → durable merge authority → committed
    // durable reread → coverage → truthful publication. The finalize path owns
    // the whole outcome matrix; the cron only shapes the HTTP body and records
    // the recovery disposition that bounds future runs.
    const ingestion = await ingestGameStatsObservations({
      year,
      week,
      seasonType,
      fetchStartedAt,
      payload: rawGames,
      expectation,
      resolver,
    });

    const publication = await finalizeGameStatsRefresh({
      ingestion,
      expectation,
      seasonRelation: 'current',
      scope: weekScope,
      attempt,
      contextLabel,
    });
    await recordDisposition(publication.dispositionReason, publication.meaningfulChange);

    const coverage = coverageSummary(publication);
    if (publication.recorded === 'failure') {
      return NextResponse.json(
        {
          ...emptyResult,
          week,
          seasonType,
          error: publication.code,
          detail: publication.detail,
          coverage,
        },
        { status: publication.httpStatus }
      );
    }
    if (publication.recorded === 'noop') {
      return NextResponse.json({
        year,
        week,
        seasonType,
        gamesProcessed: 0,
        fetchedAt: null,
        skipped: `${contextLabel}: ${publication.detail}`,
        coverage,
      });
    }
    const accepted =
      ingestion.kind === 'merged'
        ? ingestion.merge.inserted.length +
          ingestion.merge.updated.length +
          ingestion.merge.refreshed.length
        : 0;
    return NextResponse.json({
      year,
      week,
      seasonType,
      gamesProcessed: accepted,
      fetchedAt: fetchStartedAt,
      ...(publication.recorded === 'partial-success' ? { detail: publication.detail } : {}),
      coverage,
    });
  } catch (err) {
    await recordProviderRefreshFailure('game-stats', weekScope, {
      attempt,
      error: err instanceof Error ? err.message : 'unknown error',
    });
    await recordDisposition('provider-unavailable', false);
    return NextResponse.json(
      {
        ...emptyResult,
        week,
        seasonType,
        error: err instanceof Error ? err.message : 'unknown error',
      },
      { status: 500 }
    );
  }
}

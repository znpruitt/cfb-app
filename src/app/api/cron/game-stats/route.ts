import { NextResponse } from 'next/server';

import { fetchUpstreamJson } from '@/lib/api/fetchUpstream';
import { buildCfbdGameTeamStatsUrl, type CfbdSeasonType } from '@/lib/cfbd';
import {
  runScheduledGameStatsRefresh,
  type ScheduledGameStatsRefreshResult,
} from '@/lib/gameStats/refreshOrchestration';
import type { GameStatsRefreshPublication } from '@/lib/gameStats/refreshPublication';
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
    // Target resolution / identity context / claim persistence failure: the
    // established cron error path, with NO provider call spent and no failure
    // assigned to a data scope that was never verified.
    return NextResponse.json(
      { ...emptyResult, error: err instanceof Error ? err.message : 'unknown error' },
      { status: 500 }
    );
  }

  switch (result.kind) {
    case 'skipped':
      return NextResponse.json({ ...emptyResult, skipped: result.detail });
    case 'config-failure':
      return NextResponse.json(
        {
          ...emptyResult,
          week: result.week,
          seasonType: result.seasonType,
          error: 'CFBD_API_KEY not configured',
        },
        { status: 500 }
      );
    case 'provider-failure':
      return NextResponse.json(
        {
          ...emptyResult,
          week: result.week,
          seasonType: result.seasonType,
          error: result.error instanceof Error ? result.error.message : 'unknown error',
          ...(result.recovery.outcome === 'failed'
            ? { recovery: `disposition finalization failed: ${result.recovery.detail}` }
            : {}),
        },
        { status: 500 }
      );
    case 'executed':
      break;
  }

  const { publication } = result;
  const coverage = coverageSummary(publication);
  const recovery =
    result.recovery.outcome === 'failed'
      ? `disposition finalization failed: ${result.recovery.detail}`
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
        ...(recovery ? { recovery } : {}),
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
      ...(recovery ? { recovery } : {}),
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
    ...(recovery ? { recovery } : {}),
  });
}

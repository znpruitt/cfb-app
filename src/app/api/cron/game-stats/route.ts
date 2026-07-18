import { NextResponse } from 'next/server';

import { fetchUpstreamJson } from '@/lib/api/fetchUpstream';
import { buildCfbdGameTeamStatsUrl, type CfbdSeasonType } from '@/lib/cfbd';
import { listCachedGameStats } from '@/lib/gameStats/cache';
import {
  ingestGameStatsObservations,
  type GameStatsIngestionResult,
} from '@/lib/gameStats/ingestion';
import { planGameStatsRecovery } from '@/lib/gameStats/recovery';
import type { DurableMergeResult } from '@/lib/gameStats/durableMerge';
import { loadCachedScheduleItems } from '@/lib/server/canonicalScheduleCache';
import { isAutoRefreshAllowed } from '@/lib/server/providerRefreshSettings';
import { weekPartitionScope } from '@/lib/providerRefreshScope';
import {
  beginProviderRefreshAttempt,
  nextProviderCommitSeq,
  recordProviderRefreshFailure,
  recordProviderRefreshNoop,
  recordProviderRefreshSuccess,
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

type CronDurableSummary = {
  outcome: DurableMergeResult['outcome'];
  inserted: number;
  updated: number;
  refreshed: number;
  unchanged: number;
  stale: number;
  conflicts: number;
  retainedExisting: number;
  skippedNonPersistable: number;
  unmatchedObservations: number;
};

type CronResult = {
  year: number;
  week: number | null;
  seasonType: CfbdSeasonType | null;
  gamesProcessed: number;
  fetchedAt: string | null;
  skipped?: string;
  error?: string;
  durable?: CronDurableSummary;
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

function durableSummary(merge: DurableMergeResult, unmatched: number): CronDurableSummary {
  return {
    outcome: merge.outcome,
    inserted: merge.inserted.length,
    updated: merge.updated.length,
    refreshed: merge.refreshed.length,
    unchanged: merge.unchanged.length,
    stale: merge.stale.length,
    conflicts: merge.conflicts.length,
    retainedExisting: merge.retainedExisting.length,
    skippedNonPersistable: merge.skippedNonPersistable,
    unmatchedObservations: unmatched,
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
  // canonical schedule expectations with COMMITTED durable evidence and take
  // the newest slate still needing repair. Cache-only — no provider call — and
  // it runs BEFORE credential validation so every outcome records against the
  // exact week partition this run targets, never the year rollup (SCOPED-STATUS
  // review v2 #1). A failure HERE (schedule or durable read) uses the
  // established cron error path WITHOUT assigning the failure to any data
  // scope: no target has been verified, and a read failure must never be
  // reinterpreted as absent coverage.
  let target: ReturnType<typeof planGameStatsRecovery>['candidates'][number] | undefined;
  try {
    const scheduleItems = await loadCachedScheduleItems(year);
    if (scheduleItems.length === 0) {
      return NextResponse.json({
        ...emptyResult,
        skipped: 'no completed weeks found in cached schedule',
      });
    }
    const records = await listCachedGameStats(year);
    const plan = planGameStatsRecovery({
      year,
      scheduleItems,
      records,
      now: Date.now(),
      seasonRelation: 'current',
    });
    target = plan.candidates[0];
    if (!target) {
      const skipped =
        plan.satisfied.length > 0
          ? `all ${plan.satisfied.length} completed slate(s) already satisfied by committed durable evidence`
          : 'no completed weeks found in cached schedule';
      return NextResponse.json({ ...emptyResult, skipped });
    }
  } catch (err) {
    return NextResponse.json(
      { ...emptyResult, error: err instanceof Error ? err.message : 'unknown error' },
      { status: 500 }
    );
  }

  const { week, seasonType, expectation } = target;
  // One canonical target scope, captured ONCE and reused by every terminal
  // resolver below so begin and resolve always agree.
  const weekScope = weekPartitionScope(year, week, seasonType);

  if (!CFBD_API_KEY) {
    // Missing credential on an unpaused cron WITH a resolved target: record a
    // failed attempt against THIS week partition (not the year rollup) so the
    // panel shows the automatic refresh is broken and a later successful run of
    // the same week can replace it through normal attempt ordering. Prior-good
    // data is preserved.
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

    // Validation → schedule matching → durable merge authority. The ingestion
    // service never lets invalid, unmatched, or empty payloads clear prior
    // durable evidence.
    const ingestion: GameStatsIngestionResult = await ingestGameStatsObservations({
      year,
      week,
      seasonType,
      fetchStartedAt,
      payload: rawGames,
      expectation,
    });

    switch (ingestion.kind) {
      case 'invalid-payload': {
        await recordProviderRefreshFailure('game-stats', weekScope, {
          attempt,
          error: `week ${week} ${seasonType}: provider payload was not an array`,
          code: 'game-stats-invalid-payload',
          status: 502,
        });
        return NextResponse.json(
          { ...emptyResult, week, seasonType, error: 'game-stats-invalid-payload' },
          { status: 502 }
        );
      }
      case 'schema-drift': {
        await recordProviderRefreshFailure('game-stats', weekScope, {
          attempt,
          error: `week ${week} ${seasonType}: provider returned ${ingestion.entryCount} row(s) but none parsed as a game observation`,
          code: 'game-stats-schema-drift',
          status: 502,
        });
        return NextResponse.json(
          { ...emptyResult, week, seasonType, error: 'game-stats-schema-drift' },
          { status: 502 }
        );
      }
      case 'valid-empty': {
        // A genuine empty provider array is a no-op, NOT a durable commit and
        // NOT a last-success advance. When the schedule says completed games
        // SHOULD have stats, the emptiness is contextually unexpected — still
        // non-destructive, still bounded by the cron cadence (it self-resolves
        // once CFBD publishes), but reported truthfully.
        await recordProviderRefreshNoop('game-stats', weekScope, { attempt, source: 'cfbd' });
        const detail =
          ingestion.emptyContext === 'unexpected'
            ? `provider returned no game stats although ${expectation.expectedIds.size} completed game(s) expect them (contextually unexpected; retrying on cron cadence)`
            : 'provider returned no game stats yet (no-op)';
        return NextResponse.json({
          year,
          week,
          seasonType,
          gamesProcessed: 0,
          fetchedAt: null,
          skipped: `week ${week} ${seasonType}: ${detail}`,
        });
      }
      case 'unmatched-only': {
        // Observations parsed but NONE belong to a canonical-schedule game in
        // this slate. Provider statistics never create games, so nothing may
        // merge — recorded as a failure (identity mismatch), prior-good intact.
        await recordProviderRefreshFailure('game-stats', weekScope, {
          attempt,
          error: `week ${week} ${seasonType}: ${ingestion.unmatched} provider observation(s) matched no canonical schedule game`,
          code: 'game-stats-unmatched-observations',
          status: 502,
        });
        return NextResponse.json(
          { ...emptyResult, week, seasonType, error: 'game-stats-unmatched-observations' },
          { status: 502 }
        );
      }
      case 'no-persistable-observations': {
        // Matched observations carried no strictly valid category evidence on
        // both sides — a content failure (preserve prior-good), never an
        // ordinary empty success and never a durable clear.
        await recordProviderRefreshFailure('game-stats', weekScope, {
          attempt,
          error: `week ${week} ${seasonType}: ${ingestion.matched} matched observation(s) carried no persistable category evidence`,
          code: 'game-stats-no-persistable-observations',
          status: 502,
        });
        return NextResponse.json(
          { ...emptyResult, week, seasonType, error: 'game-stats-no-persistable-observations' },
          { status: 502 }
        );
      }
      case 'merged': {
        const { merge } = ingestion;
        const durable = durableSummary(merge, ingestion.unmatched);
        const accepted = merge.inserted.length + merge.updated.length + merge.refreshed.length;

        switch (merge.outcome) {
          // Fence-only refreshes surface as `written` with the game ids listed
          // under `refreshed` — freshness evidence is itself a durable commit.
          case 'written':
          case 'partially-merged': {
            // Durable COMMIT is confirmed before any publication: last-success
            // status (what diagnostics and the admin panel read) advances only
            // here, after the merge authority returned a committed outcome.
            const committedAt = new Date().toISOString();
            const commitSeq = nextProviderCommitSeq();
            await recordProviderRefreshSuccess('game-stats', weekScope, {
              attempt,
              committedAt,
              commitSeq,
              source: 'cfbd',
              rowsCommitted: accepted,
              partialFailure: merge.outcome === 'partially-merged',
            });
            return NextResponse.json({
              year,
              week,
              seasonType,
              gamesProcessed: accepted,
              fetchedAt: fetchStartedAt,
              durable,
            });
          }
          case 'unchanged':
          case 'stale': {
            // The provider fetch succeeded but produced no durable change
            // (identical content at an equal fence, or only older-than-stored
            // observations). Truthful no-op: no last-success advance, no
            // fabricated failure, durable state untouched.
            await recordProviderRefreshNoop('game-stats', weekScope, { attempt, source: 'cfbd' });
            return NextResponse.json({
              year,
              week,
              seasonType,
              gamesProcessed: 0,
              fetchedAt: null,
              skipped: `week ${week} ${seasonType}: durable state already reflects this observation set (${merge.outcome})`,
              durable,
            });
          }
          case 'conflict': {
            await recordProviderRefreshFailure('game-stats', weekScope, {
              attempt,
              error: `week ${week} ${seasonType}: durable merge rejected every observation (${merge.conflicts.length} conflict(s)); stored rows preserved`,
              code: 'game-stats-merge-conflict',
              status: 502,
            });
            return NextResponse.json(
              { ...emptyResult, week, seasonType, error: 'game-stats-merge-conflict', durable },
              { status: 502 }
            );
          }
          case 'unavailable': {
            await recordProviderRefreshFailure('game-stats', weekScope, {
              attempt,
              error: `week ${week} ${seasonType}: durable storage unavailable (${merge.unavailableReason}); durable state untouched`,
              code: 'game-stats-durable-unavailable',
              status: 503,
            });
            return NextResponse.json(
              {
                ...emptyResult,
                week,
                seasonType,
                error: 'game-stats-durable-unavailable',
                durable,
              },
              { status: 503 }
            );
          }
          case 'indeterminate': {
            // Durability is genuinely UNKNOWN (commit/rollback could not be
            // confirmed). Never published as success, never claimed as
            // untouched: the failure record says exactly that, and a retry of
            // the same input is safe and idempotent.
            await recordProviderRefreshFailure('game-stats', weekScope, {
              attempt,
              error: `week ${week} ${seasonType}: durable write durability unknown (${merge.indeterminate?.reason}); retry is safe and idempotent`,
              code: 'game-stats-durable-indeterminate',
              status: 500,
            });
            return NextResponse.json(
              {
                ...emptyResult,
                week,
                seasonType,
                error: 'game-stats-durable-indeterminate',
                durable,
              },
              { status: 500 }
            );
          }
        }
        // Exhaustive over DurableMergeOutcome — unreachable.
        return NextResponse.json(
          { ...emptyResult, week, seasonType, error: 'unhandled durable merge outcome' },
          { status: 500 }
        );
      }
    }
  } catch (err) {
    await recordProviderRefreshFailure('game-stats', weekScope, {
      attempt,
      error: err instanceof Error ? err.message : 'unknown error',
    });
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

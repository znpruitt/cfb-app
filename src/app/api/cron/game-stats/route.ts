import { NextResponse } from 'next/server';

import { fetchUpstreamJson } from '@/lib/api/fetchUpstream';
import { buildCfbdGameTeamStatsUrl, type CfbdSeasonType } from '@/lib/cfbd';
import { getCachedGameStats, setCachedGameStats } from '@/lib/gameStats/cache';
import {
  classifyGameStatsPayload,
  evaluateWeeklyGameStatsCompleteness,
  expectsGameStats,
  mergeWeeklyGameStats,
} from '@/lib/gameStats/coverage';
import type { RawGameTeamStats, WeeklyGameStats } from '@/lib/gameStats/types';
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
import type { ScheduleWireItem } from '@/lib/schedule';

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

/** Per-candidate outcome for one (week, seasonType) slate this run evaluated. */
type CronWeekResult = {
  week: number;
  seasonType: CfbdSeasonType;
  outcome:
    | 'skipped-complete'
    | 'skipped-no-expected-games'
    | 'skipped-schedule-unavailable'
    | 'committed'
    | 'noop'
    | 'no-change'
    | 'failed'
    /** Identified incomplete but not attempted because an earlier week's failure aborted the run. */
    | 'deferred';
  detail?: string;
  rowsCommitted?: number;
};

type CronResult = {
  year: number;
  /** Every completed candidate slate this run evaluated, newest first. */
  results: CronWeekResult[];
  /** Total rows added or replaced across all committed weeks this run. */
  gamesProcessed: number;
  skipped?: string;
  error?: string;
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

type CandidateSlate = { week: number; seasonType: CfbdSeasonType; latestKickoff: number };

/**
 * Every completed candidate slate from the cached schedule, NEWEST first.
 *
 * Generalizes the former latest-week-only selection (PLATFORM-086H): each
 * completed week is a recovery candidate every run, so a week left incomplete
 * (partial CFBD publication, a prior failure) is retried on later scheduled runs
 * instead of being abandoned once a newer week completes. Only STAT-PRODUCING
 * games count toward selection (5th-review finding #1): a disrupted game
 * (canceled/postponed/…) never yields team stats, so a slate composed solely of
 * them is never a candidate — otherwise every run would re-spend CFBD quota on a
 * permanently unresolvable week.
 */
function findCompletedCandidateSlates(items: ScheduleWireItem[], now: number): CandidateSlate[] {
  const slateMaxDate = new Map<string, CandidateSlate>();
  const completedThreshold = now - 6 * 60 * 60 * 1000;

  for (const item of items) {
    if (!item.startDate) continue;
    if (!expectsGameStats(item.status)) continue;
    const gameTime = new Date(item.startDate).getTime();
    if (!Number.isFinite(gameTime) || gameTime > completedThreshold) continue;

    const seasonType: CfbdSeasonType = item.seasonType === 'postseason' ? 'postseason' : 'regular';
    const key = `${item.week}:${seasonType}`;
    const prev = slateMaxDate.get(key);
    if (!prev || gameTime > prev.latestKickoff) {
      slateMaxDate.set(key, { week: item.week, seasonType, latestKickoff: gameTime });
    }
  }

  return [...slateMaxDate.values()].sort((a, b) => b.latestKickoff - a.latestKickoff);
}

export async function GET(req: Request): Promise<NextResponse<CronResult>> {
  const authResult = verifyCronSecret(req);
  if (authResult !== 'ok') {
    const error =
      authResult === 'not-configured'
        ? 'CRON_SECRET is not configured on the server'
        : 'unauthorized: Bearer token did not match CRON_SECRET';
    return NextResponse.json({ year: 0, results: [], gamesProcessed: 0, error }, { status: 401 });
  }

  const year = seasonYearForToday();
  const emptyResult: CronResult = { year, results: [], gamesProcessed: 0 };

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

  // Resolve the candidate slates BEFORE credential validation (cache-only, no
  // provider call) so a missing-key failure — and every other outcome — records
  // against the EXACT week partition this run intends to refresh, never the year
  // rollup (SCOPED-STATUS review v2 #1). A weekly cron never owns the year
  // data-rollup status.
  let scheduleItems: ScheduleWireItem[];
  let candidates: CandidateSlate[];
  try {
    scheduleItems = await loadCachedScheduleItems(year);
    candidates = findCompletedCandidateSlates(scheduleItems, Date.now());
  } catch (err) {
    // Local target resolution itself failed (e.g. a durable schedule read error).
    // Use the established cron failure path WITHOUT assigning the failure to any
    // year/week data scope — no target has been verified. Nothing is marked
    // complete, so recovery is never suppressed by this failure.
    return NextResponse.json(
      { ...emptyResult, error: err instanceof Error ? err.message : 'unknown error' },
      { status: 500 }
    );
  }

  if (candidates.length === 0) {
    // No applicable completed week — no work, no scoped status, no provider call.
    return NextResponse.json({
      ...emptyResult,
      skipped: 'no completed weeks found in cached schedule',
    });
  }

  // Evaluate the schedule-relative completeness contract for every candidate
  // (cache-only). A week is skipped ONLY when the contract proves it complete or
  // proves no stats are expected; anything else stays eligible for recovery.
  const results: CronWeekResult[] = [];
  const targets: CandidateSlate[] = [];
  try {
    for (const candidate of candidates) {
      const { week, seasonType } = candidate;
      const existing = await getCachedGameStats(year, week, seasonType);
      const completeness = evaluateWeeklyGameStatsCompleteness({
        scheduleItems,
        week,
        seasonType,
        record: existing,
      });
      if (completeness.state === 'complete') {
        results.push({
          week,
          seasonType,
          outcome: 'skipped-complete',
          detail: `all ${completeness.expectedCount} expected games have usable cached stats`,
        });
        continue;
      }
      if (completeness.state === 'no-expected-games') {
        results.push({
          week,
          seasonType,
          outcome: 'skipped-no-expected-games',
          detail: 'no schedule game in this slate is expected to produce stats',
        });
        continue;
      }
      if (completeness.state === 'schedule-unavailable') {
        // Defensive: candidates derive from schedule rows, so evidence should
        // exist. If it does not, defer conservatively — never claim complete,
        // never spend a provider call on an unverifiable target.
        results.push({
          week,
          seasonType,
          outcome: 'skipped-schedule-unavailable',
          detail: 'schedule evidence unavailable for this slate; deferred to a later run',
        });
        continue;
      }
      targets.push(candidate);
      results.push({
        week,
        seasonType,
        // Overwritten when this week's fetch resolves; survives only when an
        // earlier week's failure aborts the run before this week is attempted.
        outcome: 'deferred',
        detail:
          completeness.state === 'partial'
            ? `partial coverage: ${completeness.coveredCount}/${completeness.expectedCount} expected games covered`
            : `no usable rows for ${completeness.expectedCount} expected games`,
      });
    }
  } catch (err) {
    // A durable game-stats cache read failure: defer conservatively (no provider
    // call, nothing marked complete) via the established cron failure path.
    return NextResponse.json(
      { ...emptyResult, error: err instanceof Error ? err.message : 'unknown error' },
      { status: 500 }
    );
  }

  const resultFor = (slate: CandidateSlate): CronWeekResult => {
    const found = results.find((r) => r.week === slate.week && r.seasonType === slate.seasonType);
    if (!found) throw new Error('unreachable: target slate missing from results');
    return found;
  };

  if (targets.length === 0) {
    return NextResponse.json({
      ...emptyResult,
      results,
      skipped: 'every completed week is already complete or expects no stats',
    });
  }

  if (!CFBD_API_KEY) {
    // Missing credential on an unpaused cron WITH resolved incomplete targets:
    // record a failed attempt against the primary (newest incomplete) week
    // partition — not the year rollup — so the panel shows the automatic refresh
    // is broken and a later successful run of the same week replaces it through
    // normal attempt ordering. Prior-good data is preserved.
    const primary = targets[0];
    const weekScope = weekPartitionScope(year, primary.week, primary.seasonType);
    const attempt = await beginProviderRefreshAttempt('game-stats', weekScope, {
      startedAt: new Date().toISOString(),
    });
    await recordProviderRefreshFailure('game-stats', weekScope, {
      attempt,
      error: 'CFBD_API_KEY not configured',
      code: 'cfbd-api-key-missing',
      status: 500,
    });
    const primaryResult = resultFor(primary);
    primaryResult.outcome = 'failed';
    primaryResult.detail = 'CFBD_API_KEY not configured';
    return NextResponse.json(
      { ...emptyResult, results, error: 'CFBD_API_KEY not configured' },
      { status: 500 }
    );
  }

  // Recover each incomplete week with ONE bounded provider call (no intra-run
  // retry loops — an unrecovered week is retried on the next scheduled run). The
  // first hard failure aborts the remaining candidates: they stay incomplete and
  // eligible, and a provider-wide outage doesn't burn a call per week.
  let gamesProcessed = 0;
  for (const target of targets) {
    const { week, seasonType } = target;
    const weekScope = weekPartitionScope(year, week, seasonType);
    const weekResult = resultFor(target);
    const attempt = await beginProviderRefreshAttempt('game-stats', weekScope, {
      startedAt: new Date().toISOString(),
    });

    try {
      const cfbdUrl = buildCfbdGameTeamStatsUrl({ year, week, seasonType });
      const rawGames = await fetchUpstreamJson<RawGameTeamStats[]>(cfbdUrl.toString(), {
        headers: { Authorization: `Bearer ${CFBD_API_KEY}` },
        timeoutMs: 15_000,
        retry: RETRY_POLICY,
        pacing: PACING_POLICY,
      });

      // Classify the provider response before committing (5th-review finding #5).
      const classification = classifyGameStatsPayload(rawGames, week, seasonType);
      if (classification.kind === 'noop') {
        // Genuine empty provider array (stats not published yet): a no-op, NOT a
        // durable commit. Prior-good rows (if any) are untouched; the week stays
        // incomplete and is retried on a later scheduled run.
        await recordProviderRefreshNoop('game-stats', weekScope, { attempt, source: 'cfbd' });
        weekResult.outcome = 'noop';
        weekResult.detail = 'provider returned no game stats yet; prior rows retained';
        continue;
      }
      if (classification.kind === 'no-usable-rows') {
        // A NONEMPTY payload that normalized to zero usable rows is schema
        // drift/validation failure — preserve prior-good, record failed, do not
        // advance last-success.
        await recordProviderRefreshFailure('game-stats', weekScope, {
          attempt,
          error: `week ${week} ${seasonType}: provider returned rows but none normalized to a usable game stat`,
          code: 'game-stats-no-usable-rows',
          status: 502,
        });
        weekResult.outcome = 'failed';
        weekResult.detail = 'game-stats-no-usable-rows';
        return NextResponse.json(
          { ...emptyResult, results, gamesProcessed, error: 'game-stats-no-usable-rows' },
          { status: 502 }
        );
      }

      // Merge by canonical game id: prior-good rows the response omits are
      // retained, and identical data is a no-op (no durable rewrite, no
      // downstream invalidation) — see mergeWeeklyGameStats.
      const existing = await getCachedGameStats(year, week, seasonType);
      const merge = mergeWeeklyGameStats(existing, classification.games);
      if (!merge.changed) {
        await recordProviderRefreshNoop('game-stats', weekScope, { attempt, source: 'cfbd' });
        weekResult.outcome = 'no-change';
        weekResult.detail = 'provider data matches the cached rows; nothing rewritten';
        continue;
      }

      const result: WeeklyGameStats = {
        year,
        week,
        seasonType,
        fetchedAt: new Date().toISOString(),
        games: merge.games,
      };

      // Durable write FIRST; only then advance refresh status/last-success
      // (rereview findings #3/#6) so no consumer observes success before the
      // merged record is durably committed.
      await setCachedGameStats(result);
      const committedAt = new Date().toISOString();
      const commitSeq = nextProviderCommitSeq();

      await recordProviderRefreshSuccess('game-stats', weekScope, {
        attempt,
        committedAt,
        commitSeq,
        source: 'cfbd',
        rowsCommitted: merge.rowsCommitted,
      });

      gamesProcessed += merge.rowsCommitted;
      weekResult.outcome = 'committed';
      weekResult.rowsCommitted = merge.rowsCommitted;
      weekResult.detail = `${merge.rowsCommitted} rows added or updated; ${merge.games.length} total cached`;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error';
      await recordProviderRefreshFailure('game-stats', weekScope, {
        attempt,
        error: message,
      });
      weekResult.outcome = 'failed';
      weekResult.detail = message;
      return NextResponse.json(
        { ...emptyResult, results, gamesProcessed, error: message },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ year, results, gamesProcessed });
}

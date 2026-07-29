import { NextResponse } from 'next/server';

import { getLeagues } from '@/lib/leagueRegistry';
import { getAppState } from '@/lib/server/appStateStore';
import { isAutoRefreshAllowed } from '@/lib/server/providerRefreshSettings';
import { refreshFullSeasonSchedule } from '@/lib/schedule/fullSeasonScheduleRefresh';
import {
  classifyWeeklyScheduleRefreshOperation,
  type WeeklyScheduleRefreshOperation,
} from '@/lib/schedule/weeklyRefreshOperation';
import {
  aggregateScheduleCronReason,
  aggregateScheduleCronResult,
  createScheduleRefreshCronExecutionState,
  emitScheduleRefreshCronExecutionEvent,
  type ScheduleRefreshCronYearExecution,
} from '@/lib/schedule/cronExecutionLog';
import type { CacheEntry } from '@/app/api/schedule/cache';
import type { FullSeasonScheduleRefreshResult } from '@/lib/schedule/fullSeasonScheduleRefreshResult';

export const dynamic = 'force-dynamic';

/**
 * PLATFORM-086E1B — the weekly, cache-armed schedule maintenance cron.
 *
 * QStash invokes this weekly (`turfwar-schedule-weekly`, Tuesdays 12:00 UTC once
 * provisioned per runbook §8h). One invocation authenticates CRON_SECRET, selects
 * the distinct active `season` years cache-only from the league registry, loads
 * each year's prior-good canonical schedule, classifies ordinary vs
 * postseason-boundary maintenance with the pure operation policy, applies the
 * operator settings ONLY to ordinary maintenance (postseason-boundary maintenance
 * is lifecycle-critical and exempt — like the season-transition/rollover crons),
 * and delegates each allowed year to the E1A full-season authority
 * (`refreshFullSeasonSchedule`) exactly once, sequentially in ascending year
 * order. The authority owns the lease, fetch, completeness gate, observation-
 * ordered commit, standings invalidation, and provider-refresh status — this
 * route never duplicates them, never calls `/api/schedule` over HTTP, and never
 * mutates league lifecycle state. A single outer `finally` emits exactly one
 * secret-safe `schedule-refresh-cron` runtime event.
 *
 * Controlled operational failures return HTTP 200 with truthful result data
 * (QStash delivered the message and the app processed it; the body/event records
 * whether provider work succeeded). Authentication failures return 401. E1A's
 * durable per-year lease + observation-ordered transaction protect duplicate or
 * overlapping deliveries.
 */

function verifyCronSecret(req: Request): 'ok' | 'not-configured' | 'invalid' {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) return 'not-configured';
  const authHeader = req.headers.get('authorization') ?? '';
  return authHeader === `Bearer ${cronSecret}` ? 'ok' : 'invalid';
}

type YearCandidate = {
  year: number;
  classification:
    | { kind: 'operation'; operation: WeeklyScheduleRefreshOperation }
    | { kind: 'canonical-context-unavailable' };
};

/** Map one E1A result onto the per-year cron execution entry. */
function yearEntryFromRefresh(
  year: number,
  operation: WeeklyScheduleRefreshOperation,
  refresh: FullSeasonScheduleRefreshResult
): ScheduleRefreshCronYearExecution {
  const result: ScheduleRefreshCronYearExecution['result'] =
    refresh.status === 'success'
      ? 'success'
      : refresh.status === 'no-op' || refresh.status === 'in-progress'
        ? 'no-op'
        : 'failure';
  return {
    year,
    operation,
    result,
    reason: refresh.reason,
    providerCallAttempted: refresh.providerCallAttempted,
    rowsReceived: refresh.rowsReceived,
    rowsCommitted: refresh.rowsCommitted,
    dataChanged: refresh.dataChanged,
  };
}

export async function GET(req: Request): Promise<Response> {
  const startedAtMs = Date.now();
  const exec = createScheduleRefreshCronExecutionState();

  try {
    // CRON_SECRET first — fail closed. No registry/schedule/settings/status/
    // provider work happens on an auth failure; the header/secret is never echoed.
    const auth = verifyCronSecret(req);
    if (auth !== 'ok') {
      exec.result = 'failure';
      exec.reason =
        auth === 'not-configured' ? 'cron-secret-not-configured' : 'cron-authorization-invalid';
      return NextResponse.json(
        {
          error:
            auth === 'not-configured'
              ? 'CRON_SECRET is not configured; scheduled schedule maintenance is disabled'
              : 'invalid cron authorization',
        },
        { status: 401 }
      );
    }

    // Target selection — cache-only registry read. Only `season` leagues are
    // targets (preseason belongs to the season-transition cron; offseason has no
    // maintenance target); the year comes from lifecycle status, never the calendar.
    let activeYears: number[];
    try {
      const leagues = await getLeagues();
      const years = new Set<number>();
      for (const league of leagues) {
        if (league.status?.state === 'season') years.add(league.status.year);
      }
      activeYears = [...years].sort((a, b) => a - b);
    } catch {
      exec.result = 'failure';
      exec.reason = 'canonical-context-unavailable';
      return NextResponse.json({ result: exec.result, reason: exec.reason, years: [] });
    }

    if (activeYears.length === 0) {
      exec.result = 'skipped';
      exec.reason = 'no-active-season';
      return NextResponse.json({ result: exec.result, reason: exec.reason, years: [] });
    }

    // Classify EVERY candidate year (cache-only prior-good schedule read + the
    // pure operation policy) BEFORE reading settings, so the settings gate is
    // consulted only when an ordinary year actually exists.
    const nowMs = Date.now();
    const candidates: YearCandidate[] = [];
    for (const year of activeYears) {
      let classification: YearCandidate['classification'];
      try {
        const stored = await getAppState<CacheEntry>('schedule', `${year}-all-all`);
        classification = classifyWeeklyScheduleRefreshOperation({
          entry: stored?.value,
          now: nowMs,
        });
      } catch {
        classification = { kind: 'canonical-context-unavailable' };
      }
      candidates.push({ year, classification });
    }

    // Settings — read ONCE, and only when at least one ordinary year exists.
    // Postseason-boundary years never consult the gate (lifecycle-critical), and a
    // settings-store failure blocks ONLY ordinary years (`settings-unavailable`).
    const hasOrdinary = candidates.some(
      (c) =>
        c.classification.kind === 'operation' &&
        c.classification.operation === 'ordinary-maintenance'
    );
    let ordinaryGate: 'open' | 'closed' | 'unavailable' = 'open';
    if (hasOrdinary) {
      try {
        ordinaryGate = (await isAutoRefreshAllowed('schedule')) ? 'open' : 'closed';
      } catch {
        ordinaryGate = 'unavailable';
      }
    }

    // Execute sequentially in ascending year order. Each allowed year delegates to
    // the E1A authority exactly once; skipped/context-unavailable years create no
    // provider-refresh attempt and no provider work.
    const entries: ScheduleRefreshCronYearExecution[] = [];
    for (const candidate of candidates) {
      if (candidate.classification.kind === 'canonical-context-unavailable') {
        entries.push({
          year: candidate.year,
          operation: null,
          result: 'failure',
          reason: 'canonical-context-unavailable',
          providerCallAttempted: false,
          rowsReceived: 0,
          rowsCommitted: 0,
          dataChanged: false,
        });
        continue;
      }
      const operation = candidate.classification.operation;
      if (operation === 'ordinary-maintenance' && ordinaryGate === 'closed') {
        entries.push({
          year: candidate.year,
          operation,
          result: 'skipped',
          reason: 'automation-paused-or-disabled',
          providerCallAttempted: false,
          rowsReceived: 0,
          rowsCommitted: 0,
          dataChanged: false,
        });
        continue;
      }
      if (operation === 'ordinary-maintenance' && ordinaryGate === 'unavailable') {
        entries.push({
          year: candidate.year,
          operation,
          result: 'failure',
          reason: 'settings-unavailable',
          providerCallAttempted: false,
          rowsReceived: 0,
          rowsCommitted: 0,
          dataChanged: false,
        });
        continue;
      }
      const refresh = await refreshFullSeasonSchedule({ year: candidate.year });
      entries.push(yearEntryFromRefresh(candidate.year, operation, refresh));
    }

    exec.years = entries;
    exec.result = aggregateScheduleCronResult(entries);
    exec.reason = aggregateScheduleCronReason(entries);

    // Controlled outcomes are HTTP 200: QStash delivered and the app processed the
    // run; the body/event carries the truthful result. The body mirrors ONLY the
    // allowlisted aggregate + per-year operational fields — never cache entries,
    // schedule items, or provider error details.
    return NextResponse.json({ result: exec.result, reason: exec.reason, years: exec.years });
  } finally {
    emitScheduleRefreshCronExecutionEvent(exec, startedAtMs);
  }
}

import { NextResponse } from 'next/server';

import { clearAllSuppressionRecords } from '@/lib/insights/suppression';
import { completeSeasonRollover, getLeagues } from '@/lib/leagueRegistry';
import { saveSeasonArchive } from '@/lib/seasonArchive';
import { invalidateStandings } from '@/lib/selectors/leagueStandings';
import { buildSeasonArchive } from '@/lib/seasonRollover';
import { groupRolloverTargets } from '@/lib/rolloverTargeting';
import {
  resolveNationalChampionshipRollover,
  type ChampionshipRolloverSkipReason,
} from '@/lib/schedule/nationalChampionshipRollover';
import {
  aggregateLifecycleCronReason,
  aggregateLifecycleCronResult,
  createSeasonRolloverCronExecutionState,
  emitSeasonRolloverCronExecutionEvent,
  type SeasonRolloverCronYearExecution,
} from '@/lib/lifecycleCronExecutionLog';
import {
  createSchedulerInvocationId,
  scheduleSchedulerExecutionReceipt,
  seasonRolloverYearsTarget,
} from '@/lib/server/schedulerExecutionStatus';

export const dynamic = 'force-dynamic';

type RolloverError = { leagueSlug?: string; year?: number; error: string };

type YearRolloverResult = {
  year: number;
  championshipDate?: string;
  rolloverDate?: string;
  skipped?: boolean;
  reason?: ChampionshipRolloverSkipReason | 'read-failed';
  leaguesRolledOver: string[];
  suppressionClearedFor: string[];
};

type CronResult = {
  skipped?: boolean;
  reason?: string;
  success?: boolean;
  years?: YearRolloverResult[];
  leaguesRolledOver?: string[];
  suppressionClearedFor?: string[];
  errors?: RolloverError[];
};

function verifyCronSecret(req: Request): 'ok' | 'not-configured' | 'invalid' {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) return 'not-configured';
  const authHeader = req.headers.get('authorization') ?? '';
  return authHeader === `Bearer ${cronSecret}` ? 'ok' : 'invalid';
}

export async function GET(req: Request): Promise<NextResponse<CronResult>> {
  // PLATFORM-086F2E2A — one secret-safe `season-rollover-cron` runtime event per
  // invocation (emitted from the single outer `finally`, auth failures included)
  // plus one latest-only durable receipt per AUTHENTICATED invocation. Rollover
  // is cache-only, so `providerCallAttempted` is always false. All existing HTTP
  // responses, lifecycle decisions, archive-first ordering, per-league failure
  // isolation, and suppression behavior are unchanged.
  const startedAtMs = Date.now();
  const exec = createSeasonRolloverCronExecutionState();
  // Alias the per-year entries into the tracker immediately so a defensive throw
  // mid-loop still carries the already-completed years into the event/receipt.
  const entries: SeasonRolloverCronYearExecution[] = [];
  exec.years = entries;
  let receiptInvocationId: string | null = null;

  try {
    const authResult = verifyCronSecret(req);
    if (authResult !== 'ok') {
      exec.reason =
        authResult === 'not-configured'
          ? 'cron-secret-not-configured'
          : 'cron-authorization-invalid';
      const reason =
        authResult === 'not-configured'
          ? 'CRON_SECRET is not configured on the server — set it in Vercel environment variables'
          : 'unauthorized: Bearer token did not match CRON_SECRET';
      return NextResponse.json({ skipped: true, reason }, { status: 401 });
    }
    receiptInvocationId = createSchedulerInvocationId();

    // Target selection is the SHARED per-year grouping policy (PLATFORM-086F2B,
    // `groupRolloverTargets`): non-test leagues in `season`, grouped exclusively
    // by `status.year`, ascending. Each year is evaluated INDEPENDENTLY — never
    // assume all leagues share the first eligible league's year
    // (PLATFORM-086E1A §6). The rollover authority reads each year's canonical
    // schedule cache-only and requires a structured, confirmed-final championship.
    let groups: ReturnType<typeof groupRolloverTargets>;
    try {
      groups = groupRolloverTargets(await getLeagues());
    } catch (err) {
      // A registry read failure is the same 500 as before; the event/receipt
      // record the typed `registry-unavailable` reason.
      exec.reason = 'registry-unavailable';
      return NextResponse.json(
        { skipped: true, reason: err instanceof Error ? err.message : 'unknown error' },
        { status: 500 }
      );
    }

    if (groups.length === 0) {
      exec.result = 'skipped';
      exec.reason = 'no-season-leagues';
      return NextResponse.json({ skipped: true, reason: 'no leagues in season state' });
    }

    const now = Date.now();
    const years: YearRolloverResult[] = [];
    const leaguesRolledOver: string[] = [];
    const suppressionClearedFor: string[] = [];
    const errors: RolloverError[] = [];

    for (const { year, leagues: yearLeagues } of groups) {
      // Every league is either rolled (pushed below) or errored (continue), so a
      // per-year entry's result is derived from rolled-vs-target counts.
      const yearEntry: SeasonRolloverCronYearExecution = {
        year,
        result: 'failure',
        reason: 'rollover-failed',
        providerCallAttempted: false,
        targetLeagues: yearLeagues.length,
        rolledOverLeagues: 0,
        suppressionCleared: 0,
      };
      const decision = await resolveNationalChampionshipRollover(year, now);

      if (decision.kind === 'read-failed') {
        // A genuine durable read failure is a FAILURE, never ordinary absence:
        // surface it and do not roll this year.
        errors.push({ year, error: `rollover read failed: ${decision.detail}` });
        years.push({
          year,
          skipped: true,
          reason: 'read-failed',
          leaguesRolledOver: [],
          suppressionClearedFor: [],
        });
        entries.push({ ...yearEntry, result: 'failure', reason: 'read-failed' });
        continue;
      }

      if (decision.kind === 'skip') {
        years.push({
          year,
          skipped: true,
          reason: decision.reason,
          leaguesRolledOver: [],
          suppressionClearedFor: [],
        });
        entries.push({ ...yearEntry, result: 'skipped', reason: decision.reason });
        continue;
      }

      // Eligible — roll every league in this year group.
      const yearResult: YearRolloverResult = {
        year,
        championshipDate: decision.championshipDate,
        rolloverDate: decision.rolloverDate,
        leaguesRolledOver: [],
        suppressionClearedFor: [],
      };

      for (const league of yearLeagues) {
        try {
          const archive = await buildSeasonArchive(league.slug, year);
          await saveSeasonArchive(archive);
        } catch (err) {
          errors.push({
            leagueSlug: league.slug,
            year,
            error: err instanceof Error ? err.message : 'unknown error',
          });
          continue;
        }

        try {
          // Guarded conditional transition (shared with the manual route): the
          // league must still be in `season` for THIS year at write time, so a
          // racing rollover/preseason advance can never be clobbered back to
          // offseason. Unreachable in an ordinary run (the snapshot is fresh);
          // a refusal is reported like any status-write failure.
          const transition = await completeSeasonRollover(league.slug, year);
          if (transition.outcome !== 'transitioned') {
            errors.push({
              leagueSlug: league.slug,
              year,
              error: `status write failed: league is no longer in the ${year} season group`,
            });
            continue;
          }
          yearResult.leaguesRolledOver.push(league.slug);
          leaguesRolledOver.push(league.slug);
          // Season→offseason changes this league's standings surface (live →
          // prior-season final from the archive just written). Bust its cached
          // snapshots. League-scoped: only leagues that actually rolled over.
          invalidateStandings(league.slug);
        } catch (err) {
          errors.push({
            leagueSlug: league.slug,
            year,
            error: `status write failed: ${err instanceof Error ? err.message : 'unknown error'}`,
          });
          continue;
        }

        // Only clear suppression after both archive and status update succeeded.
        // Non-blocking — a failure here does not fail the rollover.
        try {
          await clearAllSuppressionRecords(league.slug, year);
          yearResult.suppressionClearedFor.push(league.slug);
          suppressionClearedFor.push(league.slug);
        } catch {
          // Suppression clear is best-effort; rollover already succeeded.
        }
      }

      years.push(yearResult);
      // Per-year event classification from confirmed counts: every league rolled
      // → complete; some rolled, some failed → partial; none rolled → failed.
      const rolledInYear = yearResult.leaguesRolledOver.length;
      entries.push({
        year,
        result:
          rolledInYear === yearLeagues.length
            ? 'success'
            : rolledInYear > 0
              ? 'partial'
              : 'failure',
        reason:
          rolledInYear === yearLeagues.length
            ? 'rollover-complete'
            : rolledInYear > 0
              ? 'rollover-partial'
              : 'rollover-failed',
        providerCallAttempted: false,
        targetLeagues: yearLeagues.length,
        rolledOverLeagues: rolledInYear,
        suppressionCleared: yearResult.suppressionClearedFor.length,
      });
    }

    exec.result = aggregateLifecycleCronResult(entries);
    exec.reason = aggregateLifecycleCronReason(entries, 'year-results');

    const rolledAny = leaguesRolledOver.length > 0;
    const hadFailure = errors.length > 0;

    // A pure benign outcome (nothing eligible, nothing failed) reports `skipped`
    // exactly as before, so a not-yet-final / waiting-period run is indistinguishable
    // from the legacy single-year skip. Anything that rolled or failed reports the
    // detailed per-year result.
    if (!rolledAny && !hadFailure) {
      return NextResponse.json({
        skipped: true,
        reason: 'no year eligible for rollover',
        years,
      });
    }

    return NextResponse.json({
      success: !hadFailure,
      leaguesRolledOver,
      suppressionClearedFor,
      years,
      errors,
    });
  } catch (err) {
    // Any otherwise-unclassified fault stays the pessimistic
    // `failure / unexpected-error` tracker default and the same 500 response.
    return NextResponse.json(
      {
        skipped: true,
        reason: err instanceof Error ? err.message : 'unknown error',
      },
      { status: 500 }
    );
  } finally {
    emitSeasonRolloverCronExecutionEvent(exec, startedAtMs);
    if (receiptInvocationId !== null) {
      scheduleSchedulerExecutionReceipt({
        job: 'season-rollover',
        invocationId: receiptInvocationId,
        startedAtMs,
        result: exec.result,
        reason: exec.reason,
        providerCallAttempted: false,
        target: seasonRolloverYearsTarget(exec.years),
      });
    }
  }
}

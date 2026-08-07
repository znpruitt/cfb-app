import { NextResponse } from 'next/server';

import { clearAllSuppressionRecords } from '@/lib/insights/suppression';
import { completeSeasonRollover, readLeagueRegistry } from '@/lib/leagueRegistry';
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
  /**
   * PLATFORM-086F2H1R4 — declared, not merely emitted. `NextResponse<Body>`'s
   * type parameter is phantom, so an excess field on a response literal escapes
   * this contract with no compiler signal; declaring it is what makes the
   * response/event/receipt agreement checkable. Present on every AUTHENTICATED
   * response so a client never has to distinguish "none refused" from "field
   * absent" (the season-transition sibling's stated rationale).
   */
  invalidLifecycleTargets?: number;
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
    // Set inside the try, consumed AFTER the catch. Returning the malformed
    // refusal from inside the try would put it under a catch that relabels
    // everything `registry-unavailable`, collapsing the two operator conditions
    // this slice exists to separate (the R3 review's finding, applied up front).
    let registryMalformed = false;
    try {
      // PLATFORM-086F2H1R4 — read the CONTAINER through the typed reader so a
      // MALFORMED registry is distinguishable from an empty one. `getLeagues()`
      // maps absent, malformed, and empty alike to `[]`, which made a corrupt
      // registry report `no-season-leagues` — asserting no league is in season
      // when the registry holding them is unreadable as a list.
      const registry = await readLeagueRegistry();
      registryMalformed = registry.kind === 'malformed';
      // No grouping pass on a malformed container: it would be a no-op over
      // `[]` whose result is discarded by the refusal below.
      // `missing` preserves the pre-R4 empty-registry behavior exactly.
      // `exec` IS the refusal sink: refusals are published as the grouping loop
      // counts them, so a corrupt RECORD throwing mid-loop cannot discard one
      // already observed (AGENTS.md — the count must survive a mid-loop throw).
      groups = registryMalformed
        ? []
        : groupRolloverTargets(registry.kind === 'ok' ? registry.leagues : [], exec);
    } catch (err) {
      // A genuine store READ failure — `readLeagueRegistry` propagates it rather
      // than laundering it into a classification, so unavailability stays
      // distinct from corruption. This also catches a throw from a corrupt
      // RECORD inside an otherwise `ok` container: the array is typed
      // `League[]` but nothing validates each element, so a non-object member
      // throws on property access. Element-level validation is F2H1R5's.
      exec.reason = 'registry-unavailable';
      return NextResponse.json(
        {
          skipped: true,
          reason: err instanceof Error ? err.message : 'unknown error',
          invalidLifecycleTargets: exec.invalidLifecycleTargets,
        },
        { status: 500 }
      );
    }

    if (registryMalformed) {
      // Refuse BEFORE any championship resolution, archive build/save, lifecycle
      // write, standings invalidation, or suppression cleanup. HTTP 500 follows
      // the settled delivery-boundary rule: this is a Vercel-native lifecycle
      // cron with no at-least-once layer to confuse, so an integrity refusal
      // must not read as "nothing to do".
      exec.result = 'failure';
      exec.reason = 'registry-malformed';
      return NextResponse.json(
        {
          skipped: true,
          reason: 'registry-malformed',
          invalidLifecycleTargets: exec.invalidLifecycleTargets,
        },
        { status: 500 }
      );
    }

    if (groups.length === 0) {
      // A production DATA-INTEGRITY refusal outranks the benign zero-target
      // reason: the single reason must name the condition an operator has to
      // act on, and `no-season-leagues` would be false when records exist but
      // carry unusable years.
      if (exec.invalidLifecycleTargets > 0) {
        exec.result = 'failure';
        exec.reason = 'unusable-lifecycle-year';
        return NextResponse.json({
          skipped: true,
          reason: 'unusable-lifecycle-year',
          invalidLifecycleTargets: exec.invalidLifecycleTargets,
        });
      }
      // PLATFORM-086F2H2B — an ACTIVE demo league that was filtered out is NOT
      // "no league is in season". Saying so was false on the operator's System
      // Health row, and it is the DEFAULT post-reset demo state, so it repeated
      // daily while production sat in preseason or offseason. This is the same
      // distinction F2H1T2/T3/T4 each shipped for their own jobs; rollover was
      // the last of the five demo-exclusion sites without it.
      //
      // Precedence: the production integrity refusal above still outranks this,
      // because a refused production record is a condition an operator must act
      // on, while a demo exclusion is working as designed.
      exec.result = 'skipped';
      exec.reason = exec.excludedDemoCandidate
        ? 'no-automatic-season-leagues'
        : 'no-season-leagues';
      return NextResponse.json({
        skipped: true,
        reason: exec.excludedDemoCandidate
          ? 'the only leagues in season are excluded from automatic rollover'
          : 'no leagues in season state',
        invalidLifecycleTargets: exec.invalidLifecycleTargets,
      });
    }

    // ONE aggregation authority (the season-transition sibling's pattern). The
    // per-year throw path and the post-loop path both finalize through this, so
    // a later change to the degradation table can never apply to only one of
    // them — and a throw can never erase a refusal counted before it.
    const finalizeAggregate = (entries: SeasonRolloverCronYearExecution[]): void => {
      const yearsResult = aggregateLifecycleCronResult(entries);
      exec.reason = aggregateLifecycleCronReason(entries, 'year-results');
      exec.result =
        exec.invalidLifecycleTargets === 0
          ? yearsResult
          : yearsResult === 'success' || yearsResult === 'partial'
            ? 'partial'
            : 'failure';
    };

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
      let decision: Awaited<ReturnType<typeof resolveNationalChampionshipRollover>>;
      try {
        decision = await resolveNationalChampionshipRollover(year, now);
      } catch (err) {
        // A structurally malformed cached schedule can make resolution THROW
        // rather than return `read-failed`. Record the failing year (so the
        // event/receipt never omit it) and finalize the aggregate here, then
        // propagate the SAME 500 the outer catch already produces.
        entries.push({ ...yearEntry, result: 'failure', reason: 'unexpected-error' });
        finalizeAggregate(entries);
        throw err;
      }

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
      // Errors recorded before THIS year's league loop, so the classification can
      // tell whether any league in this year failed.
      //
      // A league still counts as ROLLED even when its standings invalidation
      // then fails, because the lifecycle write is already committed by that
      // point — and since F2H2B that invalidation has its own `try/catch` and
      // its own error text, so the year is classified `partial` for a reason the
      // operator can act on rather than being told the status write failed when
      // it did not.
      const errorsBeforeYear = errors.length;

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
            if (transition.outcome === 'unusable-target-year') {
              // A write-time refusal is a refusal: the field's documented
              // meaning is "production records refused this run for an unusable
              // year", and the selector is not the only place that can decide
              // it. Without this a record corrupted BETWEEN selection and the
              // write reports `invalidLifecycleTargets: 0` on System Health
              // while an unusable-year refusal demonstrably happened. No
              // double-count is possible: a league the selector already refused
              // never reaches this write.
              exec.invalidLifecycleTargets += 1;
            }
            // The two refusals are different operator conditions and must not
            // share one message: `not-in-target-season` means another actor
            // moved the league, while `unusable-target-year` means the target
            // year is unusable and needs repair, not a retry.
            errors.push({
              leagueSlug: league.slug,
              year,
              error:
                transition.outcome === 'unusable-target-year'
                  ? `status write refused: the target year is not a usable season year`
                  : `status write failed: league is no longer in the ${year} season group`,
            });
            continue;
          }
          yearResult.leaguesRolledOver.push(league.slug);
          leaguesRolledOver.push(league.slug);
        } catch (err) {
          errors.push({
            leagueSlug: league.slug,
            year,
            error: `status write failed: ${err instanceof Error ? err.message : 'unknown error'}`,
          });
          continue;
        }

        // PLATFORM-086F2H2B — standings invalidation is reported SEPARATELY from
        // the lifecycle write, and deliberately after it.
        //
        // These shared one `try/catch`, so a `revalidateTag` throw was reported
        // as `status write failed` for a league whose status write had already
        // SUCCEEDED and been counted in `leaguesRolledOver`. That is a false
        // statement about durable lifecycle state on the operator's error list,
        // and it points at the wrong subsystem: the remedy for a stale cache is
        // not the remedy for a failed transition.
        //
        // Season→offseason changes this league's standings surface (live →
        // prior-season final from the archive just written). League-scoped: only
        // leagues that actually rolled over. The rollover itself is already
        // committed at this point, so a failure here degrades freshness, never
        // correctness — the cache refreshes on the next mutation or natural
        // turnover.
        //
        // DELIBERATE CONSEQUENCE of the split: this catch does NOT `continue`,
        // so suppression clearing below now runs even when invalidation throws.
        // Under the shared catch it was skipped, which coupled two unrelated
        // subsystems — a `revalidateTag` fault left the outgoing season's
        // insights suppression records in place, and that survives the cache
        // blip because suppression is DURABLE. The rule the code below already
        // states is "only after archive AND status succeeded"; both did. Pinned
        // by the invalidation-failure receipt test.
        try {
          invalidateStandings(league.slug);
        } catch (err) {
          errors.push({
            leagueSlug: league.slug,
            year,
            error: `standings invalidation failed after a successful rollover: ${
              err instanceof Error ? err.message : 'unknown error'
            }`,
          });
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
      // Per-year event classification from confirmed counts AND per-year errors:
      // every league rolled with NO error this year → complete; any roll with a
      // failure (a not-fully-rolled year, OR a rolled league whose
      // `invalidateStandings` threw) → partial; nothing rolled → failed. Keying
      // `complete` on error-freeness (not just the rolled count) keeps the
      // event/receipt consistent with the response's `success: !hadFailure`.
      const rolledInYear = yearResult.leaguesRolledOver.length;
      const yearHadError = errors.length > errorsBeforeYear;
      const complete = rolledInYear === yearLeagues.length && !yearHadError;
      entries.push({
        year,
        result: complete ? 'success' : rolledInYear > 0 ? 'partial' : 'failure',
        reason: complete
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

    // PLATFORM-086F2H1R4 — the R1-approved policy, fourth and final application,
    // expressed once in `finalizeAggregate` above.
    //
    // The REASON always names what the VALID years did, never the refusal: the
    // receipt's year entries carry counts and no reason field, so overwriting
    // the aggregate reason would erase the only durable record of those years'
    // outcomes. The refusal rides independently on `invalidLifecycleTargets`.
    //
    // The RESULT is degraded, because a refused production target is an anomaly
    // even when every valid year merely skipped. `partial` there does NOT prove
    // a durable write landed — `aggregateLifecycleCronResult` already returns
    // `partial` for mixed failure/no-op outcomes.
    finalizeAggregate(entries);

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
        invalidLifecycleTargets: exec.invalidLifecycleTargets,
      });
    }

    return NextResponse.json({
      success: !hadFailure,
      leaguesRolledOver,
      suppressionClearedFor,
      years,
      errors,
      invalidLifecycleTargets: exec.invalidLifecycleTargets,
    });
  } catch (err) {
    // Any otherwise-unclassified fault stays the pessimistic
    // `failure / unexpected-error` tracker default and the same 500 response.
    return NextResponse.json(
      {
        skipped: true,
        reason: err instanceof Error ? err.message : 'unknown error',
        // Reachable with refusals already counted — e.g. championship
        // resolution throwing on a malformed cached schedule after the selector
        // refused a record. The event and receipt carry the count from `exec`
        // via the `finally`; omitting it here alone would make the response the
        // one surface that disagrees.
        invalidLifecycleTargets: exec.invalidLifecycleTargets,
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
        target: seasonRolloverYearsTarget(exec.years, exec.invalidLifecycleTargets),
      });
    }
  }
}

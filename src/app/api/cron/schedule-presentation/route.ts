import { NextResponse } from 'next/server';

import { CFBD_PEAK_LATENCY_TIMEOUT_MS } from '@/lib/api/cfbdRequestPolicy';
import { selectActiveSeasonTargetYears } from '@/lib/activeSeasonTargets';
import { readLeagueRegistry } from '@/lib/leagueRegistry';
import {
  aggregateSchedulePresentationCron,
  createSchedulePresentationCronExecutionState,
  emitSchedulePresentationCronExecutionEvent,
  type SchedulePresentationCronExecutionReason,
  type SchedulePresentationCronExecutionResult,
  type SchedulePresentationYearExecution,
} from '@/lib/schedule/presentationCronExecutionLog';
import {
  normalizeScheduleMediaCacheEntry,
  normalizeVenueCatalogCacheEntry,
  scheduleMediaStateKey,
  SCHEDULE_MEDIA_STATE_SCOPE,
  VENUE_CATALOG_STATE_KEY,
  VENUE_CATALOG_STATE_SCOPE,
} from '@/lib/schedule/schedulePresentation';
import {
  refreshSchedulePresentation,
  VENUE_CATALOG_TTL_MS,
} from '@/lib/schedule/schedulePresentationRefresh';
import { getAppState } from '@/lib/server/appStateStore';
import {
  getProviderRefreshSettings,
  isAutoRefreshAllowedBySettings,
} from '@/lib/server/providerRefreshSettings';
import {
  createSchedulerInvocationId,
  scheduleSchedulerExecutionReceipt,
  schedulePresentationTarget,
} from '@/lib/server/schedulerExecutionStatus';

export const dynamic = 'force-dynamic';

/**
 * PLATFORM-757a — the STANDALONE schedule-presentation job.
 *
 * ## Why this route exists
 *
 * The media/venue refresh runs INLINE today, after the schedule work, inside
 * `cron/schedule-refresh` and `cron/season-transition`. Both wrap it in a
 * "defensive contract boundary" try/catch, which guarantees a presentation
 * FAULT never escapes — and does nothing about presentation's DURATION. A
 * try/catch proves a call cannot throw, never that it cannot hang. That gap is
 * [#757](https://github.com/znpruitt/cfb-app/issues/757): on Hobby, 300s is a
 * hard maximum, and a killed invocation loses the durable receipt written in the
 * outer `finally`, so System Health cannot tell a killed run from one that never
 * happened.
 *
 * ## This slice is ADDITIVE
 *
 * Every inline call stays exactly where it is. 757b removes them once this job
 * is live in production and at least one standalone receipt has been observed.
 * Removing them first would silently stop broadcast refreshes. `inlineCallers`
 * in this route's tests pins that the three inline call sites are unchanged.
 *
 * ## Why it does not wait for the schedule job
 *
 * The authority checks its OWN precondition: an absent or empty canonical
 * schedule makes no provider call (`schedulePresentationRefresh.ts:18-19`).
 * Gating on the schedule job's receipt would recouple the jobs, and a lost
 * receipt — #757's own failure — would then stop presentation too.
 *
 * ## Cadence
 *
 * Weekly, Tuesday 13:00 UTC, one hour after the 12:00 schedule job. Measured
 * 2026-09-22 across 888 FBS-involved games: by the Tuesday run that Saturday is
 * 100% settled for channels and kickoff times, so a daily run would repeat
 * Tuesday's result. The hour of separation keeps the two jobs off CFBD at the
 * same moment; the schedule job's own worst case is minutes, not an hour.
 */
export const maxDuration = 300;

/**
 * One year's worst case, from the code rather than from a guess: the media part
 * is a 3-attempt site at {@link CFBD_PEAK_LATENCY_TIMEOUT_MS} (40s), plus the
 * bounded retry backoff (250ms base, 2s cap, 20% jitter — under a second in
 * total). The VENUE part is the same shape but global and TTL-gated, so at most
 * ONE run in a job pays for it; after it commits, every later year in the same
 * run reads `fresh-cache` and makes no venue call.
 */
const YEAR_WORST_CASE_MS = 3 * CFBD_PEAK_LATENCY_TIMEOUT_MS + 1_000;

/**
 * The venue leg's own worst case — the same 3-attempt shape as media, charged
 * to whichever year first finds the catalog outside its TTL.
 *
 * It is a SEPARATE constant from {@link YEAR_WORST_CASE_MS} because the two are
 * reserved independently: the venue catalog is global, so once any year settles
 * it no later year pays, and until one does EVERY remaining year might.
 */
const VENUE_LEG_WORST_CASE_MS = 3 * CFBD_PEAK_LATENCY_TIMEOUT_MS + 1_000;

/**
 * The job's own budget. #757 is about an invocation being killed before its
 * receipt lands, so this job must not be able to do that to itself.
 *
 * ## The arithmetic, which the prompt's original version got wrong
 *
 * The prompt costed ONE year. The loop is per-year, and two active years is a
 * normal configuration — a league in `season(2026)` beside one in
 * `preseason(2027)` is exactly what the registry owner map encodes. So:
 *
 * ```text
 * worst case ≈ N × 121s + 121s      (N = selected years; the trailing term is venues)
 * N=1 → 242s      N=2 → 363s      N=3 → 484s
 * ```
 *
 * At N≥2 the invocation is killed past 300s and loses its receipt — #757
 * reproduced inside its own fix. A budget is therefore REQUIRED, not insurance
 * against some future third provider site.
 *
 * ## How the 240s holds, corrected after review
 *
 * The first version of this docblock said year 1 "costs at most 242s (media +
 * the one venue fetch)" and concluded a second year could never start. **That
 * conclusion only held when year 1's venue leg actually ran to a commit**, and
 * both reviewers found the case where it does not. The reservation is now
 * explicit rather than assumed: a year is charged for the venue leg too until
 * some year has settled it (see the loop).
 *
 * The first selected year always runs, and its own worst case — 242s, both legs
 * — fits under the 300s ceiling alone. A later year starts only when
 * `elapsed + reservation ≤ 250s`, and then costs at most that reservation, so
 * the total can never exceed the budget:
 *
 * ```text
 * venue leg not owed → reservation 121s → total ≤ 250s
 * venue leg owed     → reservation 242s → admissible only while elapsed ≤ 8s
 * ```
 *
 * **250s, not 240s, and the 10s matters.** At 240s a 242s reservation could
 * never be admitted at any elapsed time, so a run that genuinely owed the venue
 * leg would skip every year after the first no matter how fast they were —
 * which is how round 1's regression starved a live year behind an uncached one.
 * The budget must be able to admit the largest reservation it can produce.
 *
 * The remaining 50s under the 300s ceiling covers the registry, settings and
 * staleness reads, plus the receipt write.
 *
 * This only ever bites under provider degradation. With CFBD healthy a year
 * costs a second or two and every selected year runs.
 */
const JOB_BUDGET_MS = 250_000;

function verifyCronSecret(req: Request): 'ok' | 'not-configured' | 'invalid' {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) return 'not-configured';
  const authHeader = req.headers.get('authorization') ?? '';
  return authHeader === `Bearer ${cronSecret}` ? 'ok' : 'invalid';
}

/**
 * Order the selected years MOST-STALE MEDIA FIRST, so a budget-truncated run
 * always advances the year that needs it rather than the lowest-numbered one.
 *
 * Without this, a two-year configuration under sustained provider degradation
 * would refresh 2026 every week and never once reach 2027. A year with no media
 * entry sorts first — it has never been refreshed at all.
 *
 * Cache-only and best-effort: this read decides ORDER, never whether a year
 * runs. A store failure yields `null`, which sorts the year first — the same
 * treatment as "never refreshed", because both mean "cannot show it is fresh".
 * Reads `schedule-media`, never the canonical `schedule` scope, so it adds no
 * site to `scheduleReadEnumeration`'s allowlist.
 */
async function mediaObservedAtMs(year: number): Promise<number | null> {
  try {
    const stored = await getAppState<unknown>(
      SCHEDULE_MEDIA_STATE_SCOPE,
      scheduleMediaStateKey(year)
    );
    return normalizeScheduleMediaCacheEntry(stored?.value)?.at ?? null;
  } catch {
    return null;
  }
}

/**
 * Is the global venue catalog outside its 30-day TTL, and therefore owed by this
 * run?
 *
 * The SAME forced durable read `refreshVenuesPart` makes, and deliberately so:
 * the obligation is a property of the catalog, and asking the catalog is the
 * only way to get an answer that a year which never invoked the leg cannot
 * corrupt.
 *
 * A store failure answers `true` — owed. That over-reserves, which costs at most
 * one skipped year; answering `false` would under-reserve, which costs the
 * receipt, and this whole job exists because a lost receipt is the expensive
 * outcome.
 */
async function venueRefreshDue(): Promise<boolean> {
  try {
    const stored = await getAppState<unknown>(VENUE_CATALOG_STATE_SCOPE, VENUE_CATALOG_STATE_KEY);
    const priorEntry = normalizeVenueCatalogCacheEntry(stored?.value);
    return !(priorEntry && Date.now() - priorEntry.at < VENUE_CATALOG_TTL_MS);
  } catch {
    return true;
  }
}

async function orderByStaleness(years: readonly number[]): Promise<number[]> {
  const stamped = await Promise.all(
    years.map(async (year) => ({ year, at: await mediaObservedAtMs(year) }))
  );
  return stamped
    .sort((a, b) => {
      if (a.at === b.at) return a.year - b.year;
      if (a.at === null) return -1;
      if (b.at === null) return 1;
      return a.at - b.at;
    })
    .map((entry) => entry.year);
}

/**
 * The response mirrors ONLY the allowlisted operational primitives — never a
 * cache entry, media row, or provider error detail.
 */
type PresentationCronResponse = {
  result: SchedulePresentationCronExecutionResult;
  reason: SchedulePresentationCronExecutionReason;
  years: SchedulePresentationYearExecution[];
  yearsSkippedForBudget: number;
  invalidLifecycleTargets: number;
};

export async function GET(req: Request): Promise<NextResponse<PresentationCronResponse>> {
  const startedAtMs = Date.now();
  const exec = createSchedulePresentationCronExecutionState();
  let receiptInvocationId: string | null = null;

  const respond = (status = 200): NextResponse<PresentationCronResponse> =>
    NextResponse.json(
      {
        result: exec.result,
        reason: exec.reason,
        years: exec.years,
        yearsSkippedForBudget: exec.yearsSkippedForBudget,
        invalidLifecycleTargets: exec.invalidLifecycleTargets,
      },
      { status }
    );

  try {
    const authResult = verifyCronSecret(req);
    if (authResult !== 'ok') {
      exec.result = 'failure';
      exec.reason =
        authResult === 'not-configured'
          ? 'cron-secret-not-configured'
          : 'cron-authorization-invalid';
      // Authentication is the ONLY non-200 on this route, matching every other
      // cron: a controlled outcome means QStash delivered and the app processed
      // the run, and the body carries the truthful result.
      return respond(401);
    }
    // Identity only after authentication — an unauthenticated request must
    // never create or advance a receipt.
    receiptInvocationId = createSchedulerInvocationId();

    // The refusal counter is published onto the run state AS IT COUNTS, because
    // the registry array is typed `League[]` with no per-element validation, so
    // a non-object member throws on property access and a count returned only on
    // the normal path would be discarded by that throw.
    let selection;
    try {
      // The TYPED reader, so a MALFORMED container is distinguishable from an
      // empty one. `getLeagues()` maps both to `[]`, which would make a corrupt
      // registry report `no-maintenance-target` — asserting no active league
      // exists when the registry holding them is unreadable.
      const registry = await readLeagueRegistry();
      if (registry.kind === 'malformed') {
        exec.result = 'failure';
        exec.reason = 'registry-malformed';
        return respond();
      }
      selection = selectActiveSeasonTargetYears(
        registry.kind === 'ok' ? registry.leagues : [],
        exec
      );
    } catch {
      exec.result = 'failure';
      exec.reason = 'canonical-context-unavailable';
      return respond();
    }

    exec.totalYears = selection.years.length;

    if (selection.years.length === 0) {
      exec.result = 'skipped';
      if (exec.invalidLifecycleTargets > 0) {
        // Active PRODUCTION leagues existed and every one carried an unusable
        // year. Neither reason below is true here — both assert something about
        // eligible leagues, and these were eligible until their year was read.
        exec.result = 'failure';
        exec.reason = 'unusable-lifecycle-year';
      } else {
        exec.reason = selection.excludedDemoCandidate
          ? 'no-automatic-maintenance-target'
          : 'no-maintenance-target';
      }
      return respond();
    }

    // ACCEPTANCE 8 — the operator gate.
    //
    // Presentation is ORDINARY maintenance, and today it is already covered by
    // the operator's pause: the inline call fires only on a canonical success
    // (`schedule-refresh:590`), and the canonical refresh for an ordinary year
    // is itself gated at `:429`. A standalone job that ignored the gate would
    // call CFBD while the operator had paused schedule auto-refresh — removing
    // an operator guarantee in a slice billed as purely additive.
    //
    // The asymmetry is PRESERVED deliberately: lifecycle-critical paths
    // (postseason-boundary weeks, and the season-transition cron) bypass the
    // gate today and continue to. This job is never lifecycle-critical.
    let gateOpen: boolean;
    try {
      gateOpen = isAutoRefreshAllowedBySettings(await getProviderRefreshSettings(), 'schedule');
    } catch {
      // A settings store failure cannot prove the gate is open, and this job is
      // never lifecycle-critical, so it fails CLOSED and says which it was.
      exec.result = 'failure';
      exec.reason = 'settings-unavailable';
      return respond();
    }
    if (!gateOpen) {
      exec.result = 'skipped';
      exec.reason = 'automation-paused-or-disabled';
      return respond();
    }

    // ACCEPTANCE 9 — budget-bounded, most-stale-media first.
    const ordered = await orderByStaleness(selection.years.map((entry) => entry.year));
    // Is the VENUE leg owed by this run at all?
    //
    // ## Why this is a durable READ and not inferred from a year's outcome
    //
    // Round 1 inferred it: a year whose venue reason was not `fresh-cache` or a
    // clean commit left the leg "unsettled". **That was a worse defect than the
    // one it fixed.** `refreshSchedulePresentation` short-circuits BOTH parts
    // when the canonical schedule is absent or empty
    // (`schedulePresentationRefresh.ts:696-704`), so such a year never INVOKES
    // the venue leg and reports `no-eligible-games` for it — which says nothing
    // about whether a later year will pay for `/venues`. Round 1 read it as
    // "still owed", and since the reservation exceeded the whole budget, every
    // later year was then skipped unconditionally.
    //
    // `orderByStaleness` puts a year with NO media entry first, and that is
    // exactly the year with no schedule — so an ordinary preseason year not yet
    // cached, sitting beside a live season year, starved the only year that had
    // anything to refresh, every week, permanently. The precise inversion of
    // what the ordering exists to do.
    //
    // The obligation is a property of the CATALOG, so it is read from the
    // catalog: the same forced durable freshness read `refreshVenuesPart` makes.
    let venueLegOwed = await venueRefreshDue();
    for (const year of ordered) {
      // The FIRST selected year always runs. Its own worst case is 242s, which
      // fits under the 300s ceiling on its own, and a budget that could skip
      // every year would make the job unable to do anything at all.
      const reservationMs = venueLegOwed
        ? YEAR_WORST_CASE_MS + VENUE_LEG_WORST_CASE_MS
        : YEAR_WORST_CASE_MS;
      if (exec.years.length > 0 && Date.now() - startedAtMs + reservationMs > JOB_BUDGET_MS) {
        // Counted, not silently dropped: a skipped year's media is exactly as
        // stale as if nothing had run, and a receipt that reported success here
        // would be a count whose failure and whose real zero look identical.
        exec.yearsSkippedForBudget += 1;
        continue;
      }
      // Called WITHOUT `now` so the observation instant and the leases use a
      // fresh clock captured at the year's turn, never this route's entry time —
      // route latency must not age an observation or shorten a lease.
      const result = await refreshSchedulePresentation({ year, trigger: 'presentation-weekly' });
      // A COMMIT — and only a commit — discharges the obligation mid-run: the
      // catalog is now inside its TTL, so no later year can be charged for it.
      //
      // This only ever clears the flag, never sets it. Everything else leaves it
      // exactly as the durable read found it, which is the point: a year that
      // never invoked the leg (`no-eligible-games`) and a year whose leg failed
      // are both silent about the catalog, and silence must not be read as
      // either answer.
      if (result.venues.reason === 'written-clean' || result.venues.reason === 'unchanged-clean') {
        venueLegOwed = false;
      }
      exec.years.push({
        year,
        result: result.status,
        media: result.media.reason,
        venues: result.venues.reason,
        providerCallAttempted:
          result.media.providerCallAttempted || result.venues.providerCallAttempted,
      });
    }

    const aggregate = aggregateSchedulePresentationCron(
      exec.years,
      exec.yearsSkippedForBudget,
      exec.invalidLifecycleTargets
    );
    exec.result = aggregate.result;
    exec.reason = aggregate.reason;
    return respond();
  } finally {
    emitSchedulePresentationCronExecutionEvent(exec, startedAtMs);
    // One latest-only durable receipt per AUTHENTICATED invocation, scheduled
    // post-response. Best-effort, so it can neither change the response nor mask
    // a propagating throw.
    if (receiptInvocationId !== null) {
      scheduleSchedulerExecutionReceipt({
        job: 'schedule-presentation',
        invocationId: receiptInvocationId,
        startedAtMs,
        result: exec.result,
        reason: exec.reason,
        providerCallAttempted: exec.years.some((entry) => entry.providerCallAttempted),
        target: schedulePresentationTarget(exec),
      });
    }
  }
}

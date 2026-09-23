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
  scheduleMediaStateKey,
  SCHEDULE_MEDIA_STATE_SCOPE,
} from '@/lib/schedule/schedulePresentation';
import { refreshSchedulePresentation } from '@/lib/schedule/schedulePresentationRefresh';
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
 * 240s: year 1 starts at elapsed 0 and costs at most 242s (media + the one venue
 * fetch); a second year cannot start, because 242 + 121 exceeds the budget. The
 * receipt lands around 242s, inside the 300s ceiling, every time.
 *
 * This only ever bites under provider degradation. With CFBD healthy a year
 * costs a second or two and every selected year runs.
 */
const JOB_BUDGET_MS = 240_000;

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
    for (const year of ordered) {
      if (Date.now() - startedAtMs + YEAR_WORST_CASE_MS > JOB_BUDGET_MS) {
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
      exec.years.push({
        year,
        result: result.status,
        media: result.media.reason,
        venues: result.venues.reason,
        providerCallAttempted:
          result.media.providerCallAttempted || result.venues.providerCallAttempted,
      });
    }

    const aggregate = aggregateSchedulePresentationCron(exec.years, exec.yearsSkippedForBudget);
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

import { NextResponse } from 'next/server';

import { readLeagueRegistry } from '@/lib/leagueRegistry';
import { isStructurallyValidSeasonYear, TEST_LEAGUE_SLUG } from '@/lib/league';
import { getAppState, setAppState } from '@/lib/server/appStateStore';
import {
  getProviderRefreshSettings,
  isAutoRefreshAllowedBySettings,
} from '@/lib/server/providerRefreshSettings';
import { refreshFullSeasonSchedule } from '@/lib/schedule/fullSeasonScheduleRefresh';
import { refreshSchedulePresentation } from '@/lib/schedule/schedulePresentationRefresh';
import {
  deriveFirstGameDate,
  getScheduleProbeState,
  saveScheduleProbeState,
} from '@/lib/scheduleProbe';
import {
  classifyPreseasonWeeklyRefreshOperation,
  classifyWeeklyScheduleRefreshOperation,
  SCHEDULE_WEEKLY_CONTROL_SCOPE,
  type ScheduleWeeklyControl,
  type WeeklyScheduleRefreshOperation,
} from '@/lib/schedule/weeklyRefreshOperation';
import {
  aggregateScheduleCronReason,
  aggregateScheduleCronResult,
  createScheduleRefreshCronExecutionState,
  emitScheduleRefreshCronExecutionEvent,
  type ScheduleRefreshCronYearExecution,
} from '@/lib/schedule/cronExecutionLog';
import {
  createSchedulerInvocationId,
  scheduleSchedulerExecutionReceipt,
  scheduleYearsTarget,
} from '@/lib/server/schedulerExecutionStatus';
import type { CacheEntry } from '@/app/api/schedule/cache';
import type { FullSeasonScheduleRefreshResult } from '@/lib/schedule/fullSeasonScheduleRefreshResult';

export const dynamic = 'force-dynamic';

/**
 * PLATFORM-086E1B — the weekly, cache-armed schedule maintenance cron.
 *
 * QStash invokes this weekly (`turfwar-schedule-weekly`, Tuesdays 12:00 UTC once
 * provisioned per runbook §8h). One invocation authenticates CRON_SECRET, selects
 * the distinct `season` AND `preseason` years cache-only from the league registry
 * (any `season` league owns a mixed year — one execution under the active-season
 * policy; `offseason` is excluded). AUTOMATIC ownership is resolved from
 * PRODUCTION leagues only: the demo league is filtered out per league before
 * ownership is resolved and is maintained manually (PLATFORM-086F2H1T3), so a
 * registry whose only active leagues are the demo reports
 * `skipped / no-automatic-maintenance-target`. A surviving production league is
 * then checked for a STRUCTURALLY VALID lifecycle year (PLATFORM-086F2H1R2) and
 * refused if it has none — counted at run level as `invalidLifecycleTargets`,
 * never silently coerced — and the registry CONTAINER is read through the typed
 * reader, so a malformed registry reports `failure / registry-malformed` instead
 * of claiming no active league exists. The route then loads each surviving
 * year's prior-good canonical
 * schedule (plus, for preseason years, the durable schedule probe), classifies
 * the operation with the pure policies — active-season ordinary vs sticky
 * postseason-boundary, and preseason: cache-armed early preseason
 * (`preseason-maintenance`, ordinary) vs deferral to the daily season-transition
 * cron (`season-transition-owner`: probe unarmed, or inside the final seven days
 * before the first kickoff — PLATFORM-086E1B1). It applies the operator settings
 * only to ordinary SCHEDULE operations (postseason-boundary schedule maintenance
 * is lifecycle-critical and exempt, like the season-transition/rollover crons),
 * while the derived final-score backstop independently honors the Scores gate.
 * Each allowed year delegates to the E1A full-season authority
 * (`refreshFullSeasonSchedule`) exactly once, sequentially in ascending year
 * order. The authority owns the lease, fetch, completeness gate, observation-
 * ordered commit, standings invalidation, and provider-refresh status — this
 * route never duplicates them, never calls `/api/schedule` over HTTP, and never
 * mutates league lifecycle state (discovery and the preseason→season transition
 * remain solely the season-transition cron's). A single outer `finally` emits
 * exactly one secret-safe `schedule-refresh-cron` runtime event.
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
  /** The effective lifecycle owner: any `season` league wins over `preseason`. */
  owner: 'season' | 'preseason';
  classification:
    | { kind: 'operation'; operation: WeeklyScheduleRefreshOperation }
    | { kind: 'season-transition-owner' }
    | { kind: 'canonical-context-unavailable' };
};

/** An ORDINARY (operator-gated, noncritical) weekly operation (E1B1). */
function isOrdinaryOperation(operation: WeeklyScheduleRefreshOperation): boolean {
  return operation === 'ordinary-maintenance' || operation === 'preseason-maintenance';
}

/** Map one E1A result onto the per-year cron execution entry. */
function yearEntryFromRefresh(
  year: number,
  operation: WeeklyScheduleRefreshOperation,
  refresh: FullSeasonScheduleRefreshResult
): ScheduleRefreshCronYearExecution {
  const scoreSweepFailed = refresh.scoreSweepFailedPartitions.length > 0;
  const result: ScheduleRefreshCronYearExecution['result'] = scoreSweepFailed
    ? 'failure'
    : refresh.status === 'success'
      ? 'success'
      : refresh.status === 'no-op' || refresh.status === 'in-progress'
        ? 'no-op'
        : 'failure';
  return {
    year,
    operation,
    result,
    reason: scoreSweepFailed ? 'score-sweep-failed' : refresh.reason,
    providerCallAttempted: refresh.providerCallAttempted,
    rowsReceived: refresh.rowsReceived,
    rowsCommitted: refresh.rowsCommitted,
    dataChanged: refresh.dataChanged,
    scoreRepairs: refresh.scoreRepairs,
    scoreDifferenceCount: refresh.scoreDifferenceCount,
    scoreDifferences: refresh.scoreDifferences,
    scoreDifferencesTruncated: refresh.scoreDifferencesTruncated,
    scoreSweepFailedPartitions: refresh.scoreSweepFailedPartitions,
    scoreSweepCannotTellCount: refresh.scoreSweepCannotTellCount,
    kickoffsChanged: refresh.kickoffsChanged,
  };
}

/** Preserve the scheduler's established HTTP body; sweep metrics are log/receipt-only. */
function responseYearEntry(entry: ScheduleRefreshCronYearExecution) {
  return {
    year: entry.year,
    operation: entry.operation,
    result: entry.result,
    reason: entry.reason,
    providerCallAttempted: entry.providerCallAttempted,
    rowsReceived: entry.rowsReceived,
    rowsCommitted: entry.rowsCommitted,
    dataChanged: entry.dataChanged,
  };
}

export async function GET(req: Request): Promise<Response> {
  const startedAtMs = Date.now();
  const exec = createScheduleRefreshCronExecutionState();
  // PLATFORM-086F2E1 — receipt identity, created ONLY after successful cron
  // authentication (never inferred from the final result/reason). Null means
  // no durable receipt is scheduled for this invocation.
  let receiptInvocationId: string | null = null;

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
    receiptInvocationId = createSchedulerInvocationId();

    // Target selection — cache-only registry read. `season` AND `preseason`
    // leagues are targets (E1B1: cache-armed early preseason gets ordinary weekly
    // maintenance; unarmed/final-week preseason defers to the season-transition
    // cron); `offseason` is excluded. Years come from lifecycle status, never the
    // calendar. Each distinct year resolves ONE effective owner — any `season`
    // league wins over `preseason` (a mixed year executes at most once, under the
    // active-season policy) — so E1A is never invoked twice for the same year.
    let targetYears: Array<{ year: number; owner: 'season' | 'preseason' }>;
    // Set when an ACTIVE demo league was filtered out — so a zero-target run can
    // report why truthfully rather than claiming no active league exists.
    let excludedDemoCandidate = false;
    // PLATFORM-086F2H1R2 — active PRODUCTION leagues refused for a structurally
    // invalid `status.year`. Run-level, because a refused candidate has no
    // usable year to file it under.
    // Counted DIRECTLY on `exec` rather than in a local that is published after
    // the loop: a throw on a later league would skip that publication and
    // discard every refusal already counted, so the response, the runtime event,
    // and the receipt would all report 0 unusable targets on a run that found
    // them. There is no "publish before the loop" option here — unlike R1's
    // season-transition sibling, the loop that counts refusals IS the loop that
    // can throw — so the counter itself must be the durable one.
    // Set when the container itself is corrupt — readable, but not a league
    // array. Reported separately from every zero-target reason, each of which
    // asserts something about leagues a corrupt container cannot support.
    let registryMalformed = false;
    try {
      // Read through the typed reader (PLATFORM-086F2H1R1) so a MALFORMED
      // container is distinguishable from an empty one. `getLeagues()` maps both
      // to `[]`, which would make this run report `no-maintenance-target` —
      // asserting no active league exists when the registry holding them is
      // corrupt and unreadable as a list.
      const registry = await readLeagueRegistry();
      registryMalformed = registry.kind === 'malformed';
      // `missing` keeps the pre-R2 empty-registry behavior exactly.
      const leagues = registry.kind === 'ok' ? registry.leagues : [];
      const ownerByYear = new Map<number, 'season' | 'preseason'>();
      for (const league of leagues) {
        const status = league.status;
        const isActive = status?.state === 'season' || status?.state === 'preseason';

        // PLATFORM-086F2H1T3 — the demo league is MANUAL-ONLY for weekly
        // schedule maintenance.
        //
        // Filtered PER-LEAGUE, inside this loop. It cannot be filtered against
        // `targetYears` below: that would drop an entire year a PRODUCTION
        // league also occupies, removing its maintenance — a worse regression
        // than the one this fixes.
        //
        // This is also an OWNER-SELECTOR rule, not merely a target removal.
        // `season` outranks `preseason` for a shared year, so without this a
        // demo league in `season(Y)` would promote Y to the active-season policy
        // over production leagues in `preseason(Y)` — making that year
        // pause-exempt and suppressing its probe re-derive. THAT direction is
        // what this rule changes. The opposite direction is unchanged and was
        // never at risk: the precedence below already prevents a `preseason`
        // league from displacing a `season` owner, so production season
        // precedence is PRESERVED here, not newly created.
        //
        // Gated on `isActive` so only a league that WOULD have produced a
        // maintenance year sets the flag below; an `offseason` demo league was
        // never a candidate and must not change the zero-target reason.
        if (isActive && league.slug === TEST_LEAGUE_SLUG) {
          excludedDemoCandidate = true;
          continue;
        }

        // PLATFORM-086F2H1R2 — structural year validity, applied AFTER the demo
        // exclusion above and BEFORE the year can own anything.
        //
        // The ordering is load-bearing in one direction: an active DEMO record
        // carrying an unusable year must stay a demo exclusion, so the run keeps
        // reporting `no-automatic-maintenance-target`. Validating first would
        // count it as an invalid production target and undo F2H1T3's reason.
        //
        // `status.year` reaches here straight from durable JSON — `getLeagues()`
        // performs no per-record validation — so before this slice an unusable
        // year became a Map key, owned a maintenance year, and drove a
        // `schedule/<raw>-all-all` read, a boundary-latch or probe operation, a
        // settings decision, a billed E1A refresh, and a presentation refresh.
        // A refused candidate now contributes none of those, no owner
        // precedence, and no per-year entry.
        //
        // Offseason and status-less production records are NOT counted: they
        // were never candidates, exactly as they were never targets.
        if (isActive && !isStructurallyValidSeasonYear(status.year)) {
          exec.invalidLifecycleTargets += 1;
          continue;
        }

        if (status?.state === 'season') {
          ownerByYear.set(status.year, 'season');
        } else if (status?.state === 'preseason' && ownerByYear.get(status.year) !== 'season') {
          ownerByYear.set(status.year, 'preseason');
        }
      }
      targetYears = [...ownerByYear.entries()]
        .map(([year, owner]) => ({ year, owner }))
        .sort((a, b) => a.year - b.year);
    } catch {
      // A throw while READING the registry or walking it. Two sources, not one:
      // a genuine store read failure (`readLeagueRegistry` propagates it rather
      // than laundering it into a classification), and a corrupt RECORD inside
      // an otherwise `ok` container — `leagues` is typed `League[]`, but nothing
      // validates each element, so a non-object member throws on property
      // access. Both are distinct from the corrupt CONTAINER handled below.
      exec.result = 'failure';
      exec.reason = 'canonical-context-unavailable';
      return NextResponse.json({
        result: exec.result,
        reason: exec.reason,
        years: [],
        invalidLifecycleTargets: exec.invalidLifecycleTargets,
      });
    }

    if (registryMalformed) {
      // A present-but-corrupt container. Refuse before any schedule, probe,
      // latch, settings, provider, or presentation work, and say so rather than
      // claiming no active league exists. Controlled outcome, so HTTP stays 200
      // exactly as every other operational failure on this route does — only
      // authentication returns 401.
      exec.result = 'failure';
      exec.reason = 'registry-malformed';
      return NextResponse.json({
        result: exec.result,
        reason: exec.reason,
        years: [],
        invalidLifecycleTargets: exec.invalidLifecycleTargets,
      });
    }

    if (targetYears.length === 0) {
      exec.result = 'skipped';
      // An active demo league that was filtered out is NOT "no active league".
      // Saying `no-maintenance-target` would be false on the operator's System
      // Health row, exactly as F2H1T2 refused to reuse `no-preseason-leagues`.
      // Top-level only: no per-year entry, provider attempt, settings read,
      // probe/latch operation, or presentation refresh is produced either way.
      if (exec.invalidLifecycleTargets > 0) {
        // Active PRODUCTION leagues existed; every one carried an unusable year.
        // Neither reason below is true here — both assert something about
        // eligible leagues, and these were eligible until their year was read.
        exec.result = 'failure';
        exec.reason = 'unusable-lifecycle-year';
      } else {
        exec.reason = excludedDemoCandidate
          ? 'no-automatic-maintenance-target'
          : 'no-maintenance-target';
      }
      return NextResponse.json({
        result: exec.result,
        reason: exec.reason,
        years: [],
        invalidLifecycleTargets: exec.invalidLifecycleTargets,
      });
    }

    // Classify EVERY candidate year (cache-only prior-good schedule read + the
    // pure operation policy — plus the durable boundary latch for SEASON years,
    // and the durable schedule probe for PRESEASON years) BEFORE reading
    // settings, so the settings gate is consulted only when an ordinary year
    // actually exists.
    const nowMs = Date.now();
    const candidates: YearCandidate[] = [];
    for (const { year, owner } of targetYears) {
      let classification: YearCandidate['classification'];
      try {
        if (owner === 'preseason') {
          // PRESEASON (E1B1): the pure preseason policy consumes the durable
          // schedule probe + the prior-good canonical schedule. It NEVER reads or
          // writes the postseason-boundary latch (preseason is never
          // lifecycle-critical), and an unarmed / final-seven-day probe defers the
          // year to the daily season-transition cron with no provider work.
          const probe = await getScheduleProbeState(year);
          const stored = await getAppState<CacheEntry>('schedule', `${year}-all-all`);
          classification = classifyPreseasonWeeklyRefreshOperation({
            entry: stored?.value,
            probe,
            now: nowMs,
          });
        } else {
          // ACTIVE SEASON — the existing E1B policy, unchanged. The durable
          // boundary latch: once a year has classified `postseason-boundary`, it
          // stays lifecycle-critical for every later invocation even if a schedule
          // change moved the recomputed boundary later (cycle-1 review finding 1).
          // A latch READ failure degrades to `latched: false` — the recomputed
          // classification still applies, so the only effect of a transient latch
          // outage inside the revert window is one operator-gated run; the next
          // successful read restores the latch.
          let latched = false;
          try {
            const control = await getAppState<ScheduleWeeklyControl>(
              SCHEDULE_WEEKLY_CONTROL_SCOPE,
              String(year)
            );
            latched = typeof control?.value?.postseasonBoundaryReachedAt === 'string';
          } catch {
            latched = false;
          }
          const stored = await getAppState<CacheEntry>('schedule', `${year}-all-all`);
          classification = classifyWeeklyScheduleRefreshOperation({
            entry: stored?.value,
            now: nowMs,
            latched,
          });
          // Persist the latch the FIRST time this year enters the critical window
          // (best-effort — a write failure only defers latching to a later run; the
          // classification this run already stands).
          if (
            !latched &&
            classification.kind === 'operation' &&
            classification.operation === 'postseason-boundary'
          ) {
            try {
              await setAppState(SCHEDULE_WEEKLY_CONTROL_SCOPE, String(year), {
                postseasonBoundaryReachedAt: new Date(nowMs).toISOString(),
              } satisfies ScheduleWeeklyControl);
            } catch {
              // Best-effort — never fail the run over latch bookkeeping.
            }
          }
        }
      } catch {
        classification = { kind: 'canonical-context-unavailable' };
      }
      candidates.push({ year, owner, classification });
    }

    // Settings — read ONCE when at least one year will execute. The SCHEDULE
    // gate still applies only to ordinary work; lifecycle-critical schedule
    // maintenance remains exempt. The derived SCORE sweep is always noncritical,
    // so it independently honors global pause + the Scores toggle even when the
    // containing schedule operation is critical. A settings-store failure blocks
    // ordinary schedule work and merely disables the score sweep on critical work.
    const hasOrdinary = candidates.some(
      (c) =>
        c.classification.kind === 'operation' && isOrdinaryOperation(c.classification.operation)
    );
    const hasExecutableOperation = candidates.some((c) => c.classification.kind === 'operation');
    let ordinaryGate: 'open' | 'closed' | 'unavailable' = 'open';
    let scoreSweepAllowed = false;
    if (hasExecutableOperation) {
      try {
        const settings = await getProviderRefreshSettings();
        if (hasOrdinary) {
          ordinaryGate = isAutoRefreshAllowedBySettings(settings, 'schedule') ? 'open' : 'closed';
        }
        scoreSweepAllowed = isAutoRefreshAllowedBySettings(settings, 'scores');
      } catch {
        if (hasOrdinary) ordinaryGate = 'unavailable';
      }
    }

    // Execute sequentially in ascending year order. Each allowed year delegates to
    // the E1A authority exactly once; skipped/deferred/context-unavailable years
    // create no provider-refresh attempt and no provider work.
    const entries: ScheduleRefreshCronYearExecution[] = [];
    // Alias the per-year entries into the tracker IMMEDIATELY (matching the
    // rankings cron) so an authenticated defensive exception mid-loop still
    // carries the already-completed per-year/provider truth into the runtime
    // event and the F2E1 receipt (with the pessimistic aggregate) instead of
    // losing the record of provider spend (PLATFORM-086F2E1 correction).
    exec.years = entries;
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
          scoreRepairs: 0,
          scoreDifferenceCount: 0,
          scoreDifferences: [],
          scoreDifferencesTruncated: false,
          scoreSweepFailedPartitions: [],
          scoreSweepCannotTellCount: 0,
          kickoffsChanged: 0,
        });
        continue;
      }
      if (candidate.classification.kind === 'season-transition-owner') {
        // The DAILY season-transition cron owns this preseason year (probe
        // unarmed, or inside the final seven days) — an intentional provider-free
        // deferral, never a failure or a no-op.
        entries.push({
          year: candidate.year,
          operation: null,
          result: 'skipped',
          reason: 'season-transition-owner',
          providerCallAttempted: false,
          rowsReceived: 0,
          rowsCommitted: 0,
          dataChanged: false,
          scoreRepairs: 0,
          scoreDifferenceCount: 0,
          scoreDifferences: [],
          scoreDifferencesTruncated: false,
          scoreSweepFailedPartitions: [],
          scoreSweepCannotTellCount: 0,
          kickoffsChanged: 0,
        });
        continue;
      }
      const operation = candidate.classification.operation;
      if (isOrdinaryOperation(operation) && ordinaryGate === 'closed') {
        entries.push({
          year: candidate.year,
          operation,
          result: 'skipped',
          reason: 'automation-paused-or-disabled',
          providerCallAttempted: false,
          rowsReceived: 0,
          rowsCommitted: 0,
          dataChanged: false,
          scoreRepairs: 0,
          scoreDifferenceCount: 0,
          scoreDifferences: [],
          scoreDifferencesTruncated: false,
          scoreSweepFailedPartitions: [],
          scoreSweepCannotTellCount: 0,
          kickoffsChanged: 0,
        });
        continue;
      }
      if (isOrdinaryOperation(operation) && ordinaryGate === 'unavailable') {
        entries.push({
          year: candidate.year,
          operation,
          result: 'failure',
          reason: 'settings-unavailable',
          providerCallAttempted: false,
          rowsReceived: 0,
          rowsCommitted: 0,
          dataChanged: false,
          scoreRepairs: 0,
          scoreDifferenceCount: 0,
          scoreDifferences: [],
          scoreDifferencesTruncated: false,
          scoreSweepFailedPartitions: [],
          scoreSweepCannotTellCount: 0,
          kickoffsChanged: 0,
        });
        continue;
      }
      const refresh = await refreshFullSeasonSchedule({
        year: candidate.year,
        sweepFinalScores: scoreSweepAllowed,
      });
      entries.push(yearEntryFromRefresh(candidate.year, operation, refresh));

      // E1B1 cycle-1 remediation (finding 1): a successful preseason-maintenance
      // refresh RE-DERIVES the probe's firstGameDate from the freshly confirmed
      // schedule (preserving baseCachedAt) — mirroring the manual full-year
      // `/api/schedule` refresh's established probe update. The probe is the
      // exact durable signal the season-transition handoff consumes; without this,
      // a weekly refresh that commits an EARLIER first game would leave the probe
      // stale and the transition cron idle past the true first kickoff. Best-effort
      // (same as the manual route): the schedule commit already succeeded durably,
      // so a probe-write failure never falsifies the refresh result — the next
      // successful weekly run (or a transition fetch) re-derives it.
      if (
        operation === 'preseason-maintenance' &&
        refresh.status === 'success' &&
        refresh.items.length > 0
      ) {
        try {
          const existingProbe = await getScheduleProbeState(candidate.year);
          await saveScheduleProbeState({
            year: candidate.year,
            baseCachedAt: existingProbe?.baseCachedAt ?? new Date(nowMs).toISOString(),
            firstGameDate: deriveFirstGameDate(refresh.items),
          });
        } catch {
          // Best-effort — never fail a committed refresh over probe bookkeeping.
        }
      }

      // PLATFORM-086E1C2: a qualifying POPULATED E1A success (`written-clean` OR
      // `unchanged-clean` — broadcast assignments can change independently of the
      // canonical rows) triggers ONE automatic presentation refresh for the year.
      // Strictly best-effort and AFTER the canonical year entry + probe update:
      // the E1C1 authority owns its own leases, provider calls, status scopes,
      // and `schedule-presentation-refresh` event, resolves every fault into its
      // typed result, and its outcome never alters the canonical per-year entry,
      // aggregate result/reason, HTTP body, probe truth, or the
      // `schedule-refresh-cron` event. Called WITHOUT `now` so the presentation
      // observation/leases use a fresh clock captured after canonical work —
      // route latency never shortens the leases or ages the observation.
      // Skipped/deferred/gated/failed/no-op/in-progress years never reach here.
      if (refresh.status === 'success' && refresh.items.length > 0) {
        try {
          await refreshSchedulePresentation({ year: candidate.year, trigger: 'weekly' });
        } catch {
          // Defensive contract boundary — a presentation fault must never affect
          // canonical weekly maintenance.
        }
      }
    }

    // PLATFORM-086F2H1R2 — the R1-approved policy. The REASON always names the
    // executed years: the refusal already rides on `invalidLifecycleTargets`
    // across the response, event, and receipt, and the receipt's year entries
    // carry no reason field, so overwriting would erase the only durable record
    // of what those years did.
    const yearsResult = aggregateScheduleCronResult(entries);
    exec.reason = aggregateScheduleCronReason(entries);
    exec.result =
      exec.invalidLifecycleTargets === 0
        ? yearsResult
        : // A refusal alongside executed years. Classify `partial` when the
          // valid years' own aggregate is `success` or `partial`, else
          // `failure` — a refusal must not UPGRADE a run whose valid years did
          // nothing. This is NOT a claim that `partial` proves durable work:
          // `aggregateScheduleCronResult` also returns `partial` for
          // `failure` + `no-op`.
          yearsResult === 'success' || yearsResult === 'partial'
          ? 'partial'
          : 'failure';

    // Controlled outcomes are HTTP 200: QStash delivered and the app processed the
    // run; the body/event carries the truthful result. The body mirrors ONLY the
    // allowlisted aggregate + per-year operational fields — never cache entries,
    // schedule items, or provider error details.
    return NextResponse.json({
      result: exec.result,
      reason: exec.reason,
      years: exec.years.map(responseYearEntry),
      invalidLifecycleTargets: exec.invalidLifecycleTargets,
    });
  } finally {
    emitScheduleRefreshCronExecutionEvent(exec, startedAtMs);
    // PLATFORM-086F2E1 — one latest-only durable receipt per AUTHENTICATED
    // invocation, scheduled post-response. Result/reason are the tracker's
    // verbatim; provider truth is true when ANY recorded year attempted a
    // provider-data request; the bounded target summarizes at most the first
    // eight years. Best-effort, so it can neither change the response nor mask
    // a propagating throw.
    if (receiptInvocationId !== null) {
      scheduleSchedulerExecutionReceipt({
        job: 'schedule-refresh',
        invocationId: receiptInvocationId,
        startedAtMs,
        result: exec.result,
        reason: exec.reason,
        providerCallAttempted: exec.years.some((entry) => entry.providerCallAttempted),
        target: scheduleYearsTarget(exec.years, exec.invalidLifecycleTargets),
      });
    }
  }
}

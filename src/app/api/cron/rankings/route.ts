import { NextResponse } from 'next/server';

import { fetchCfbdUsage } from '@/lib/api/cfbdUsage';
import type { CfbdUsageSnapshot } from '@/lib/gameStats/quotaPolicy';
import { getLeagues } from '@/lib/leagueRegistry';
import {
  loadRankingsPublicationContext,
  selectRankingsTargetYears,
  type RankingsTargetSelection,
  type RankingsTargetYear,
} from '@/lib/rankings/automaticContext';
import {
  aggregateRankingsCronReason,
  aggregateRankingsCronResult,
  createRankingsCronExecutionState,
  emitRankingsCronExecutionEvent,
  type RankingsCronYearExecution,
  type RankingsCronYearReason,
} from '@/lib/rankings/cronExecutionLog';
import { evaluateRankingsPublicationWindow } from '@/lib/rankings/publicationPolicy';
import {
  claimRankingsPublicationWindow,
  completeRankingsPublicationWindow,
  releaseRankingsPublicationWindow,
} from '@/lib/rankings/publicationWindowControl';
import { evaluateRankingsAutomationQuota } from '@/lib/rankings/quotaPolicy';
import { refreshSeasonRankings } from '@/lib/rankings/refreshAuthority';
import type { RankingsRefreshResult } from '@/lib/rankings/refreshResult';
import { isAutoRefreshAllowed } from '@/lib/server/providerRefreshSettings';
import {
  createSchedulerInvocationId,
  rankingsYearsTarget,
  scheduleSchedulerExecutionReceipt,
} from '@/lib/server/schedulerExecutionStatus';

export const dynamic = 'force-dynamic';

/**
 * PLATFORM-086E2B — the publication-aware rankings cron.
 *
 * QStash invokes this twice daily (`turfwar-rankings-publication`, 04:00 and
 * 22:00 UTC once provisioned per runbook §8j). The heartbeat is ONLY a trigger:
 * one invocation authenticates CRON_SECRET, applies the Rankings automation
 * gate (all rankings automation is noncritical and pausable), selects the
 * distinct `preseason`/`season` years cache-only from the PRODUCTION leagues in
 * the registry (never the calendar; the demo league is manual-only and is
 * excluded per league before it can contribute a year — PLATFORM-086F2H1T4, and
 * a registry whose only active leagues are the demo reports
 * `skipped / no-automatic-ranking-target`), resolves each year's publication
 * window cache-only through the merged E2A classifier, durably claims each DUE
 * window exactly once (a completed window never spends quota again), gates each
 * claimed year on a FRESH CFBD `/info` probe against the rankings reserve
 * (≥ 1,007), and delegates the refresh to the merged E2A authority
 * (`refreshSeasonRankings({trigger:'automatic'})`) sequentially in ascending
 * year order. The authority owns the lease, provider fetch pair, validation,
 * completeness gate, observation-ordered commit, memo, and provider-refresh
 * status — this route never duplicates them and consumes outcome truth ONLY
 * from the typed result. A single outer `finally` emits exactly one
 * secret-safe `rankings-cron` runtime event.
 *
 * Controlled operational outcomes return HTTP 200 with truthful result data
 * (QStash delivered the message and the app processed it; the body/event
 * records whether provider work succeeded). Authentication failures return
 * 401. Duplicate/overlapping deliveries are made safe by the durable window
 * control (completed windows immutable, claims token-safe) plus E2A's own
 * per-year lease + observation ordering.
 */

function verifyCronSecret(req: Request): 'ok' | 'not-configured' | 'invalid' {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) return 'not-configured';
  const authHeader = req.headers.get('authorization') ?? '';
  return authHeader === `Bearer ${cronSecret}` ? 'ok' : 'invalid';
}

/** A provider-free per-year entry (skips, context/control failures, contention). */
function inertYearEntry(
  target: RankingsTargetYear,
  result: RankingsCronYearExecution['result'],
  reason: RankingsCronYearReason,
  window: { kind: RankingsCronYearExecution['publicationWindow']; key: string | null } = {
    kind: null,
    key: null,
  },
  quota: { checked: boolean; remaining: number | null } = { checked: false, remaining: null }
): RankingsCronYearExecution {
  return {
    year: target.year,
    lifecycle: target.lifecycle,
    publicationWindow: window.kind,
    publicationKey: window.key,
    result,
    reason,
    quotaChecked: quota.checked,
    quotaRemaining: quota.remaining,
    attemptedSeasonTypes: [],
    providerCallAttempted: false,
    rowsReceived: 0,
    rowsCommitted: 0,
    dataChanged: false,
  };
}

/** Map one E2A result onto the per-year entry (fields copied verbatim). */
function yearEntryFromRefresh(
  target: RankingsTargetYear,
  window: { kind: RankingsCronYearExecution['publicationWindow']; key: string },
  quotaRemaining: number | null,
  refresh: RankingsRefreshResult,
  completion: { attempted: boolean; confirmed: boolean }
): RankingsCronYearExecution {
  // A successful or clean-no-op refresh whose window completion could NOT be
  // durably confirmed is a truthful PARTIAL: the refresh outcome stands, but the
  // window may be redelivered (the claim reconciles by expiry — never a blind
  // immediate retry, and never a replacement of the E2A result).
  const unconfirmed = completion.attempted && !completion.confirmed;
  const result: RankingsCronYearExecution['result'] = unconfirmed
    ? 'partial'
    : refresh.status === 'success'
      ? 'success'
      : refresh.status === 'no-op'
        ? 'no-op'
        : refresh.status === 'in-progress'
          ? 'in-progress'
          : 'failure';
  return {
    year: target.year,
    lifecycle: target.lifecycle,
    publicationWindow: window.kind,
    publicationKey: window.key,
    result,
    reason: unconfirmed ? 'publication-completion-unconfirmed' : refresh.reason,
    quotaChecked: true,
    quotaRemaining,
    attemptedSeasonTypes: refresh.attemptedSeasonTypes,
    providerCallAttempted: refresh.providerCallAttempted,
    rowsReceived: refresh.rowsReceived,
    rowsCommitted: refresh.rowsCommitted,
    dataChanged: refresh.dataChanged,
  };
}

export async function GET(req: Request): Promise<Response> {
  const startedAtMs = Date.now();
  const exec = createRankingsCronExecutionState();
  // PLATFORM-086F2E1 — receipt identity, created ONLY after successful cron
  // authentication (never inferred from the final result/reason). Null means
  // no durable receipt is scheduled for this invocation.
  let receiptInvocationId: string | null = null;

  try {
    // CRON_SECRET first — fail closed. No registry/settings/cache/quota/status/
    // provider/control work happens on an auth failure; the header/secret is
    // never echoed.
    const auth = verifyCronSecret(req);
    if (auth !== 'ok') {
      exec.result = 'failure';
      exec.reason =
        auth === 'not-configured' ? 'cron-secret-not-configured' : 'cron-authorization-invalid';
      return NextResponse.json(
        {
          error:
            auth === 'not-configured'
              ? 'CRON_SECRET is not configured; scheduled rankings refresh is disabled'
              : 'invalid cron authorization',
        },
        { status: 401 }
      );
    }
    receiptInvocationId = createSchedulerInvocationId();

    // The Rankings automation gate — read ONCE, before any registry/cache/quota
    // work. ALL rankings automation is noncritical: the global pause or the
    // Rankings toggle pauses the entire run, and a settings-store failure fails
    // closed. The authorized manual refresh is never subject to this gate.
    try {
      if (!(await isAutoRefreshAllowed('rankings'))) {
        exec.result = 'skipped';
        exec.reason = 'automation-paused-or-disabled';
        return NextResponse.json({ result: exec.result, reason: exec.reason, years: [] });
      }
    } catch {
      exec.result = 'failure';
      exec.reason = 'settings-unavailable';
      return NextResponse.json({ result: exec.result, reason: exec.reason, years: [] });
    }

    // Target selection — cache-only registry read; `preseason` + `season` years
    // ascending (`season` owns a mixed year), never calendar-derived. Ownership
    // is PRODUCTION-only: the selector filters the demo league per league before
    // it can contribute a year or a lifecycle (PLATFORM-086F2H1T4), and reports
    // whether it did so.
    //
    // This read stays BEHIND the automation gate above. A paused demo-only
    // invocation therefore keeps reporting `automation-paused-or-disabled` — the
    // pause is the first cause that genuinely decided the run, and the exclusion
    // has no consequence in that state. Ordering it the other way would also let
    // a registry fault turn a deliberately paused run into a scheduler failure.
    let selection: RankingsTargetSelection;
    try {
      selection = selectRankingsTargetYears(await getLeagues());
    } catch {
      exec.result = 'failure';
      exec.reason = 'registry-unavailable';
      return NextResponse.json({ result: exec.result, reason: exec.reason, years: [] });
    }
    const targets = selection.years;
    if (targets.length === 0) {
      exec.result = 'skipped';
      // An active demo league that was filtered out is NOT "no eligible league".
      // Saying `no-ranking-target` would be false on the operator's System Health
      // row, exactly as F2H1T2 and F2H1T3 refused to reuse their own zero-target
      // reasons. Top-level only: no per-year entry, publication context load,
      // window claim, `/info` probe, provider request, or receipt target year is
      // produced either way.
      exec.reason = selection.excludedDemoCandidate
        ? 'no-automatic-ranking-target'
        : 'no-ranking-target';
      return NextResponse.json({ result: exec.result, reason: exec.reason, years: [] });
    }

    // ONE route-entry UTC instant is the scheduled slot for EVERY year's window
    // classification — the heartbeat's identity, not a per-year clock.
    const scheduledAt = new Date(startedAtMs);

    const entries: RankingsCronYearExecution[] = [];
    // Alias the per-year entries into the tracker IMMEDIATELY so a defensive
    // double-fault mid-loop still emits the years already executed (with the
    // pessimistic aggregate) instead of losing the record of provider spend.
    exec.years = entries;
    for (const target of targets) {
      // Cache-only publication context (schedule kickoffs + structured
      // championship + cached poll coverage). Unavailable context refuses ALL
      // provider work for the year.
      const contextResult = await loadRankingsPublicationContext({
        year: target.year,
        lifecycle: target.lifecycle,
        scheduledAt,
      });
      if (contextResult.kind === 'unavailable') {
        entries.push(inertYearEntry(target, 'failure', 'canonical-context-unavailable'));
        continue;
      }

      // The merged E2A publication classifier decides whether provider work is
      // due — the heartbeat itself never does.
      const decision = evaluateRankingsPublicationWindow(contextResult.context);
      if (!decision.due) {
        entries.push(inertYearEntry(target, 'skipped', decision.reason));
        continue;
      }
      const window = { kind: decision.kind, key: decision.key };

      // Durable exact-window claim with a FRESH acquisition instant (never the
      // route-entry time). A completed window is a provider-free skip forever; a
      // live claim defers to its holder; a control-store failure fails closed.
      const claim = await claimRankingsPublicationWindow({
        publicationKey: decision.key,
        now: Date.now(),
      });
      if (claim.kind === 'complete') {
        entries.push(inertYearEntry(target, 'skipped', 'publication-window-complete', window));
        continue;
      }
      if (claim.kind === 'in-progress') {
        entries.push(
          inertYearEntry(target, 'in-progress', 'publication-window-in-progress', window)
        );
        continue;
      }
      if (claim.kind === 'store-unavailable') {
        entries.push(inertYearEntry(target, 'failure', 'publication-control-unavailable', window));
        continue;
      }
      const token = claim.token;

      // FRESH quota gate per due year (sequential execution re-evaluates the
      // reserve before every spend). The `/info` probe is quota bookkeeping, not
      // a rankings provider-data attempt — `providerCallAttempted` stays E2A's.
      let usageSnapshot: CfbdUsageSnapshot;
      try {
        const usage = await fetchCfbdUsage({ fresh: true });
        usageSnapshot = { remainingCalls: usage.remaining, monthlyLimit: usage.limit };
      } catch {
        // A thrown probe is unavailable usage — fails closed, never invokes E2A.
        usageSnapshot = { remainingCalls: null };
      }
      const quota = evaluateRankingsAutomationQuota(usageSnapshot);
      if (quota.kind === 'refused') {
        await releaseRankingsPublicationWindow({ publicationKey: decision.key, token });
        entries.push(
          inertYearEntry(target, 'failure', `quota-${quota.reason}`, window, {
            checked: true,
            remaining: quota.remaining,
          })
        );
        continue;
      }

      // The merged E2A authority owns everything from here. Production omits
      // `now` so the refresh captures fresh lease/observation instants.
      const refresh = await refreshSeasonRankings({ year: target.year, trigger: 'automatic' });

      // Outcome → window disposition: success and clean no-ops FINALIZE the
      // window (the publication was observed — an unchanged/absent poll is a
      // legitimate window outcome); contention and failures RELEASE the claim so
      // a later delivery may retry the same window.
      let completion = { attempted: false, confirmed: false };
      if (refresh.status === 'success' || refresh.status === 'no-op') {
        completion = {
          attempted: true,
          confirmed: (
            await completeRankingsPublicationWindow({
              publicationKey: decision.key,
              token,
              completedAt: new Date().toISOString(),
            })
          ).confirmed,
        };
      } else {
        await releaseRankingsPublicationWindow({ publicationKey: decision.key, token });
      }

      entries.push(yearEntryFromRefresh(target, window, quota.remaining, refresh, completion));
    }

    exec.result = aggregateRankingsCronResult(entries);
    exec.reason = aggregateRankingsCronReason(entries);

    // Controlled outcomes are HTTP 200: QStash delivered and the app processed
    // the run; the body mirrors ONLY the allowlisted aggregate + per-year
    // operational fields — never rankings rows, provider payloads, or errors.
    return NextResponse.json({ result: exec.result, reason: exec.reason, years: exec.years });
  } finally {
    emitRankingsCronExecutionEvent(exec, startedAtMs);
    // PLATFORM-086F2E1 — one latest-only durable receipt per AUTHENTICATED
    // invocation, scheduled post-response. Result/reason are the tracker's
    // verbatim; provider truth is true when ANY recorded year attempted a
    // provider-data request; the bounded target summarizes at most the first
    // eight years. Best-effort, so it can neither change the response nor mask
    // a propagating throw.
    if (receiptInvocationId !== null) {
      scheduleSchedulerExecutionReceipt({
        job: 'rankings',
        invocationId: receiptInvocationId,
        startedAtMs,
        result: exec.result,
        reason: exec.reason,
        providerCallAttempted: exec.years.some((entry) => entry.providerCallAttempted),
        target: rankingsYearsTarget(exec.years),
      });
    }
  }
}

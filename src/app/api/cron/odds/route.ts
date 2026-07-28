import { NextResponse } from 'next/server';

import { getAppState } from '@/lib/server/appStateStore';
import { isAutoRefreshAllowed } from '@/lib/server/providerRefreshSettings';
import {
  beginProviderRefreshAttempt,
  recordProviderRefreshFailure,
  type ProviderRefreshAttempt,
} from '@/lib/server/providerRefreshStatus';
import { setLatestKnownOddsUsage } from '@/lib/server/oddsUsageStore';
import { oddsTargetScope, type ProviderRefreshScope } from '@/lib/providerRefreshScope';
import { createTeamIdentityResolver } from '@/lib/teamIdentity';
import { loadCanonicalOddsContext } from '@/lib/odds/canonicalOddsContext';
import {
  acquireOddsRefreshLease,
  readOddsRefreshControl,
  releaseOddsRefreshLease,
} from '@/lib/odds/refreshLease';
import type { OddsRefreshLeaseResolution } from '@/lib/odds/refreshResult';
import { maintainCanonicalClosingLines } from '@/lib/odds/oddsCommit';
import { collectEligibleOddsGames, selectOddsPollingDecision } from '@/lib/odds/pollingPolicy';
import {
  estimateOddsRequestCost,
  estimatePostOddsUsage,
  evaluateAutomaticOddsQuota,
  probeOddsQuota,
} from '@/lib/odds/quotaPolicy';
import { executeOddsRefresh } from '@/lib/odds/oddsRefreshExecutor';
import {
  createOddsCronExecutionState,
  emitOddsCronExecutionEvent,
  type OddsCronCadence,
  type OddsCronExecutionReason,
  type OddsCronExecutionResult,
  type OddsCronExecutionState,
} from '@/lib/odds/cronExecutionLog';
import {
  effectiveOddsObservationMs,
  ODDS_DEFAULT_BOOKMAKERS,
  ODDS_DEFAULT_MARKETS,
  ODDS_DEFAULT_REGIONS,
  oddsCache,
  resolveDefaultSeason,
  type NormalizedOddsEvent,
  type SharedOddsCacheEntry,
} from '@/app/api/odds/routeInternals';

export const dynamic = 'force-dynamic';

/**
 * PLATFORM-086C2 — the automatic, schedule-armed Odds polling cron.
 *
 * QStash invokes this hourly; the pure cadence decides whether a provider request
 * is actually due. One invocation authenticates CRON_SECRET, honors the global
 * pause + Odds dataset toggle, loads the cache-only canonical context, performs
 * cache-only closing-line maintenance, reads durable refresh control + raw-cache
 * freshness, selects no-target / not-due / backoff / baseline / pregame, and — only
 * when due — acquires the exact-target lease, validates the key, runs ONE
 * quota-free `/sports` probe, enforces the 50-credit reserve, and issues AT MOST
 * ONE `/odds` request through the shared execution authority. Every begun attempt
 * resolves exactly once, the lease releases from a `finally`, and a single
 * `finally` emits exactly one secret-safe runtime event. Public/member traffic
 * remains provider-free.
 */

// ONE provider request per run — no transport retries (recovery is the next run's
// job). Distinct from the manual route's retry/pacing policy.
const NO_RETRY = {
  maxAttempts: 1,
  baseDelayMs: 0,
  maxDelayMs: 0,
  jitterRatio: 0,
  retryOnHttpStatuses: [],
} as const;

const STATUS_401: ReadonlySet<OddsCronExecutionReason> = new Set([
  'cron-secret-not-configured',
  'cron-authorization-invalid',
]);
const STATUS_502: ReadonlySet<OddsCronExecutionReason> = new Set([
  'provider-fetch-failed',
  'odds-invalid-payload',
  'odds-schema-drift',
  'odds-empty-unexpected',
]);
const STATUS_503: ReadonlySet<OddsCronExecutionReason> = new Set([
  'durable-commit-failed',
  'polling-state-unavailable',
  'refresh-control-unavailable',
  'closing-maintenance-failed',
]);
const STATUS_500: ReadonlySet<OddsCronExecutionReason> = new Set([
  'odds-api-key-missing',
  'unexpected-error',
]);

function httpStatusForReason(reason: OddsCronExecutionReason): number {
  if (STATUS_401.has(reason)) return 401;
  if (STATUS_502.has(reason)) return 502;
  if (STATUS_503.has(reason)) return 503;
  if (STATUS_500.has(reason)) return 500;
  return 200;
}

function verifyCronSecret(req: Request): 'ok' | 'not-configured' | 'invalid' {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) return 'not-configured';
  const authHeader = req.headers.get('authorization') ?? '';
  return authHeader === `Bearer ${cronSecret}` ? 'ok' : 'invalid';
}

function jsonResponse(exec: OddsCronExecutionState): Response {
  return NextResponse.json(
    {
      result: exec.result,
      reason: exec.reason,
      year: exec.year,
      cadence: exec.cadence,
      eligibleGames: exec.eligibleGames,
      rowsCommitted: exec.rowsCommitted,
      closingStoreChanged: exec.closingStoreChanged,
    },
    { status: httpStatusForReason(exec.reason) }
  );
}

function finalize(
  exec: OddsCronExecutionState,
  result: OddsCronExecutionResult,
  reason: OddsCronExecutionReason
): Response {
  exec.result = result;
  exec.reason = reason;
  return jsonResponse(exec);
}

/** The observation-freshest raw entry across the process cache and durable store. */
function observationFreshestRaw(
  a: SharedOddsCacheEntry | undefined,
  b: SharedOddsCacheEntry | undefined
): SharedOddsCacheEntry | undefined {
  if (!a) return b;
  if (!b) return a;
  return effectiveOddsObservationMs(b) > effectiveOddsObservationMs(a) ? b : a;
}

export async function GET(req: Request): Promise<Response> {
  const startedAtMs = Date.now();
  const nowMs = Date.now();
  const nowDate = new Date(nowMs);
  const nowIso = nowDate.toISOString();
  const year = resolveDefaultSeason(nowDate);
  const exec = createOddsCronExecutionState(year);

  // The lease is held across provider work and released in `finally`.
  let leaseToken: string | null = null;
  let leaseSeasonScopedKey: string | null = null;
  let leaseResolution: OddsRefreshLeaseResolution = 'release-only';
  // The begun provider-refresh attempt, hoisted so the catch can RESOLVE it once
  // if an unexpected exception escapes after the billed `/odds` request — the
  // executor resolves reachable store/usage faults itself, but this backstop
  // ensures a propagated defect never strands the attempt in-progress or skips
  // the billed automatic backoff (review remediation).
  let providerAttempt: ProviderRefreshAttempt | null = null;
  let attemptScope: ProviderRefreshScope | null = null;
  let providerCallAttempted = false;
  let attemptResolved = false;

  try {
    // CRON_SECRET first — fail closed. No settings/context/status/lease/quota/
    // provider/write work happens on an auth failure.
    const auth = verifyCronSecret(req);
    if (auth !== 'ok') {
      const reason: OddsCronExecutionReason =
        auth === 'not-configured' ? 'cron-secret-not-configured' : 'cron-authorization-invalid';
      exec.result = 'failure';
      exec.reason = reason;
      return NextResponse.json(
        {
          error:
            auth === 'not-configured'
              ? 'CRON_SECRET is not configured; scheduled Odds polling is disabled'
              : 'invalid cron authorization',
        },
        { status: 401 }
      );
    }

    // Operator pause / Odds dataset toggle — before context or maintenance.
    if (!(await isAutoRefreshAllowed('odds'))) {
      return finalize(exec, 'skipped', 'automation-paused-or-disabled');
    }

    // Cache-only canonical context. A read/build failure is unavailable context.
    const contextResult = await loadCanonicalOddsContext({ now: nowDate });
    if (contextResult.status === 'unavailable') {
      return finalize(exec, 'skipped', 'canonical-context-unavailable');
    }
    const context = contextResult.context;
    const seasonScopedKey = context.seasonScopedKey;

    // Read the observation-freshest raw entry across process + durable. TOLERATE a
    // durable read failure here — cache-only closing maintenance must still run
    // (review remediation); the provider cadence below fails closed instead.
    let rawEntry: SharedOddsCacheEntry | undefined;
    let pollingStateOk = true;
    try {
      const durable = await getAppState<SharedOddsCacheEntry>('odds-cache', seasonScopedKey);
      rawEntry = observationFreshestRaw(oddsCache.entries[seasonScopedKey], durable?.value);
    } catch {
      pollingStateOk = false;
    }
    const rawObservationMs = rawEntry ? effectiveOddsObservationMs(rawEntry) : null;
    const rawObservationAt = rawEntry
      ? (rawEntry.observedAt ?? new Date(rawEntry.lastFetch).toISOString())
      : nowIso;

    // Cache-only closing-line maintenance — runs even when the polling state is
    // untrusted or no provider target is due; never spends quota; writes only when
    // changed. A game that has kicked off must still get its closing line frozen.
    const cachedEvents: NormalizedOddsEvent[] = rawEntry?.data ?? [];
    const maintained = await maintainCanonicalClosingLines({
      season: context.year,
      games: context.games,
      oddsEvents: cachedEvents,
      resolver: context.resolver,
      observationAt: rawObservationAt,
      now: nowIso,
    });
    if (maintained.kind === 'store-unavailable') {
      return finalize(exec, 'failure', 'closing-maintenance-failed');
    }
    exec.closingStoreChanged = maintained.wroteStore;

    // The provider cadence requires TRUSTED durable polling state — a raw-cache
    // read failure or an unreadable refresh-control record fails closed AFTER
    // maintenance (never a cold-cache assumption, no provider work follows).
    const control = await readOddsRefreshControl(seasonScopedKey);
    if (!pollingStateOk || control === null) {
      return finalize(exec, 'failure', 'polling-state-unavailable');
    }

    // Pure cadence decision.
    exec.eligibleGames = collectEligibleOddsGames(context.pollingGames, nowMs).length;
    const decision = selectOddsPollingDecision({
      games: context.pollingGames,
      control,
      rawObservationMs,
      now: nowMs,
    });
    if (!decision.due) {
      // A closing-only durable change with no provider refresh due is a success.
      if (exec.closingStoreChanged) {
        return finalize(exec, 'success', 'closing-maintenance');
      }
      return finalize(exec, 'skipped', decision.reason);
    }
    exec.cadence = decision.cadence as OddsCronCadence;
    const requestCost = estimateOddsRequestCost(ODDS_DEFAULT_MARKETS, ODDS_DEFAULT_BOOKMAKERS);
    exec.requestCost = requestCost;

    // Acquire the exact-target lease as owner `automatic`.
    const lease = await acquireOddsRefreshLease({
      seasonScopedKey,
      owner: 'automatic',
      now: nowMs,
    });
    if (!lease.acquired) {
      if (lease.reason === 'refresh-in-progress') {
        return finalize(exec, 'skipped', 'refresh-in-progress');
      }
      return finalize(exec, 'failure', 'refresh-control-unavailable');
    }
    leaseToken = lease.token;
    leaseSeasonScopedKey = seasonScopedKey;

    // Cadence RE-CHECK against the transaction-fresh control the acquire returned
    // and a fresh raw observation. This closes the TOCTOU race where a manual
    // refresh (or another instance) completed AFTER the pre-lease control read but
    // BEFORE this acquisition: its `lastCompletedCheckAt` / newer raw odds would
    // otherwise be invisible and the cron would issue a redundant billed request
    // immediately after the just-completed refresh (review remediation). Not-due
    // now ⇒ release WITHOUT a provider request (release-only; backoff untouched).
    let recheckRawEntry: SharedOddsCacheEntry | undefined;
    try {
      const durableNow = await getAppState<SharedOddsCacheEntry>('odds-cache', seasonScopedKey);
      recheckRawEntry = observationFreshestRaw(
        oddsCache.entries[seasonScopedKey],
        durableNow?.value
      );
    } catch {
      // A fresh raw re-read failure ⇒ never issue a provider request on unverified
      // freshness. release-only (no provider work happened).
      leaseResolution = 'release-only';
      return finalize(exec, 'failure', 'polling-state-unavailable');
    }
    const recheckObservationMs = recheckRawEntry
      ? effectiveOddsObservationMs(recheckRawEntry)
      : null;
    const recheck = selectOddsPollingDecision({
      games: context.pollingGames,
      control: lease.control,
      rawObservationMs: recheckObservationMs,
      now: nowMs,
    });
    if (!recheck.due) {
      leaseResolution = 'release-only';
      return finalize(exec, 'skipped', recheck.reason);
    }
    exec.cadence = recheck.cadence as OddsCronCadence;

    const scope = oddsTargetScope(context.year, 'canonical', seasonScopedKey);

    // Credential validation — missing key is a config FAILURE (a begun attempt
    // resolves once as failed), NOT a billed failure (lease release-only).
    const apiKey = process.env.ODDS_API_KEY?.trim();
    if (!apiKey) {
      const attempt = await beginProviderRefreshAttempt('odds', scope, { startedAt: nowIso });
      await recordProviderRefreshFailure('odds', scope, {
        attempt,
        error: 'ODDS_API_KEY missing',
        code: 'odds-api-key-missing',
        status: 503,
      });
      leaseResolution = 'release-only';
      return finalize(exec, 'failure', 'odds-api-key-missing');
    }

    // Quota-free `/sports` probe (one attempt; NOT a data-provider call).
    exec.quotaChecked = true;
    const probe = await probeOddsQuota({ apiKey });
    if (probe.kind === 'quota-probe-failed') {
      leaseResolution = 'release-only';
      return finalize(exec, 'failure', 'quota-probe-failed');
    }
    if (probe.kind === 'quota-usage-untrustworthy') {
      leaseResolution = 'release-only';
      return finalize(exec, 'failure', 'quota-usage-untrustworthy');
    }
    // Persist the fresh probe snapshot.
    await setLatestKnownOddsUsage({
      used: probe.used,
      remaining: probe.remaining,
      lastCost: probe.lastCost,
      limit: 500,
      capturedAt: nowIso,
      source: 'odds-response-headers',
      sportKey: 'americanfootball_ncaaf',
      markets: ODDS_DEFAULT_MARKETS,
      regions: ODDS_DEFAULT_REGIONS,
      endpointType: 'sports',
      cacheStatus: 'miss',
    });
    exec.quotaRemainingBefore = probe.remaining;

    const quota = evaluateAutomaticOddsQuota({ remaining: probe.remaining, requestCost });
    if (quota.kind === 'refused') {
      // remaining is already trustworthy here, so the only refusal is the reserve.
      leaseResolution = 'release-only';
      return finalize(exec, 'skipped', quota.reason);
    }

    // Begin the exact attempt, then issue AT MOST ONE `/odds` request.
    const attempt = await beginProviderRefreshAttempt('odds', scope, { startedAt: nowIso });
    providerAttempt = attempt;
    attemptScope = scope;
    providerCallAttempted = true;
    exec.providerCallAttempted = true;
    const observationAt = new Date().toISOString();
    const execution = await executeOddsRefresh({
      mode: 'automatic',
      season: context.year,
      seasonScopedKey,
      isCanonical: true,
      scope,
      attempt,
      apiKey,
      query: {
        bookmakers: ODDS_DEFAULT_BOOKMAKERS,
        markets: ODDS_DEFAULT_MARKETS,
        regions: ODDS_DEFAULT_REGIONS,
      },
      observationAt,
      now: new Date().toISOString(),
      retry: NO_RETRY,
      // The context already loaded schedule/catalog/aliases successfully; supply it
      // as empty-classification evidence so the executor never re-reads (a transient
      // re-read failure could misclassify an EXPECTED empty as a benign no-op).
      emptyClassificationEvidence: {
        scheduleItems: context.scheduleItems,
        resolver: context.resolver,
      },
      resolveCanonicalInputs: async (events) => {
        // Rebuild the resolver observing BOTH the canonical participants and the
        // provider event labels — parity with the manual attachment.
        const observedNames = Array.from(
          new Set(
            [
              ...context.games.flatMap((g) => [g.canHome, g.canAway]),
              ...events.flatMap((e) => [e.homeTeam, e.awayTeam]),
            ].filter(Boolean)
          )
        );
        const resolver = createTeamIdentityResolver({
          teams: context.teams,
          aliasMap: context.aliasMap,
          observedNames,
        });
        return { available: true, games: context.games, resolver };
      },
    });
    // The executor resolved the begun attempt exactly once. Record the truthful
    // result NOW, before the best-effort usage bookkeeping below, so a usage-store
    // write failure there can never mask a durably-committed refresh as an
    // unexpected 500 (parity with the executor's store-fault tolerance).
    attemptResolved = true;
    leaseResolution = execution.leaseResolution;
    exec.result = execution.result.status;
    exec.reason = execution.result.reason;
    exec.rowsCommitted =
      execution.result.status === 'success' ? (execution.result.rowsCommitted ?? 0) : 0;

    // Automatic post-call usage accounting — BEST-EFFORT: a usage-store write
    // failure must not fail an already-committed refresh (it self-heals on the next
    // run's `/sports` probe, which overwrites the snapshot with the true balance).
    //   - Trustworthy `/odds` headers (any status) are authoritative.
    //   - A billed FAILURE whose authoritative usage the executor already persisted
    //     (the 402/429 zero fallback) is trusted as-is — NEVER overwritten by an
    //     estimate that would restore an overstated balance (review remediation).
    //   - Otherwise (success/no-op with missing headers, OR a billed failure with
    //     untrusted headers and no fallback) persist a conservative estimate: an
    //     exact-empty response spent ZERO credits (preserve the balance); anything
    //     else deducts the max estimated cost so the reserve gate is never fooled by
    //     an overstated balance (review remediation — a billed schema-drift/invalid
    //     payload without usage headers previously left the balance unchanged). A
    //     later `/sports` probe corrects any over-deduction on the next run.
    const wasEmptyResponse =
      execution.result.reason === 'empty-response' ||
      execution.result.reason === 'odds-empty-unexpected';
    try {
      if (execution.usageFromHeaders) {
        exec.quotaRemainingAfter = execution.usage?.remaining ?? null;
      } else if (execution.result.status === 'failure' && execution.authoritativeUsagePersisted) {
        exec.quotaRemainingAfter = execution.usage?.remaining ?? null;
      } else {
        const estimate = estimatePostOddsUsage({
          preProbe: { used: probe.used, remaining: probe.remaining },
          outcome: wasEmptyResponse ? 'empty-zero-cost' : 'uncertain-billed',
          requestCost,
          context: {
            sportKey: 'americanfootball_ncaaf',
            markets: ODDS_DEFAULT_MARKETS,
            regions: ODDS_DEFAULT_REGIONS,
            endpointType: 'odds',
            cacheStatus: 'miss',
          },
        });
        await setLatestKnownOddsUsage(estimate);
        exec.quotaRemainingAfter = estimate.remaining;
      }
    } catch {
      // Best-effort: leave `quotaRemainingAfter` unset; the committed refresh's true
      // result and event are already recorded above.
    }

    return jsonResponse(exec);
  } catch {
    // An unexpected exception escaped (the executor resolves reachable faults
    // itself). RESOLVE the begun attempt once as a BILLED failure so a propagated
    // defect after the `/odds` request never strands the attempt in-progress or
    // skips the automatic backoff. A generic message only — never the raw error.
    if (providerCallAttempted && !attemptResolved) leaseResolution = 'billed-failure';
    if (providerAttempt && attemptScope && !attemptResolved) {
      attemptResolved = true;
      await recordProviderRefreshFailure('odds', attemptScope, {
        attempt: providerAttempt,
        error: 'odds cron unexpected error',
        code: 'unexpected-error',
        status: 500,
      }).catch(() => undefined);
    }
    return jsonResponse(exec);
  } finally {
    if (leaseToken && leaseSeasonScopedKey) {
      await releaseOddsRefreshLease({
        seasonScopedKey: leaseSeasonScopedKey,
        token: leaseToken,
        resolution: leaseResolution,
        now: Date.now(),
      });
    }
    emitOddsCronExecutionEvent(exec, startedAtMs);
  }
}

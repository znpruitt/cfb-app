import { NextResponse } from 'next/server';

import { getAppState } from '@/lib/server/appStateStore';
import { isAutoRefreshAllowed } from '@/lib/server/providerRefreshSettings';
import {
  beginProviderRefreshAttempt,
  recordProviderRefreshFailure,
} from '@/lib/server/providerRefreshStatus';
import { setLatestKnownOddsUsage } from '@/lib/server/oddsUsageStore';
import { oddsTargetScope } from '@/lib/providerRefreshScope';
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

    // Durable-trusted polling state: the observation-freshest raw entry across
    // process + durable, and the durable refresh-control record. A durable read
    // failure or an unreadable control is polling-state-unavailable — never a cold
    // cache — and no provider work follows.
    let rawEntry: SharedOddsCacheEntry | undefined;
    try {
      const durable = await getAppState<SharedOddsCacheEntry>('odds-cache', seasonScopedKey);
      rawEntry = observationFreshestRaw(oddsCache.entries[seasonScopedKey], durable?.value);
    } catch {
      return finalize(exec, 'failure', 'polling-state-unavailable');
    }
    const control = await readOddsRefreshControl(seasonScopedKey);
    if (control === null) {
      return finalize(exec, 'failure', 'polling-state-unavailable');
    }
    const rawObservationMs = rawEntry ? effectiveOddsObservationMs(rawEntry) : null;
    const rawObservationAt = rawEntry
      ? (rawEntry.observedAt ?? new Date(rawEntry.lastFetch).toISOString())
      : nowIso;

    // Cache-only closing-line maintenance — runs even when no provider target is
    // due; never spends quota; writes only when changed.
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
    leaseResolution = execution.leaseResolution;
    exec.rowsCommitted =
      execution.result.status === 'success' ? (execution.result.rowsCommitted ?? 0) : 0;

    // Automatic post-call usage accounting: when the `/odds` response omitted
    // usage headers, an exact-empty result cost zero (preserve the pre-probe
    // balance) and any uncertain billed outcome conservatively deducts the max.
    if (execution.usageFromHeaders) {
      exec.quotaRemainingAfter = execution.usage?.remaining ?? null;
    } else {
      const estimate = estimatePostOddsUsage({
        preProbe: { used: probe.used, remaining: probe.remaining },
        outcome:
          execution.result.reason === 'empty-response' ? 'empty-zero-cost' : 'uncertain-billed',
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

    return finalize(exec, execution.result.status, execution.result.reason);
  } catch (error) {
    // The executor resolves its own attempt; this handles only an unexpected
    // throw. `exec` still holds `failure / unexpected-error` unless corrected.
    void error;
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

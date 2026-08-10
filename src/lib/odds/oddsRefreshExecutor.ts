/**
 * PLATFORM-086C2 — the ONE shared server-side Odds refresh execution authority.
 *
 * Both the authorized manual `GET /api/odds?refresh=1` route and the automatic
 * `GET /api/cron/odds` route drive provider transport, payload interpretation,
 * durable commit, and provider-refresh status completion THROUGH this module, so
 * the two callers can never diverge on what a provider payload means or on how it
 * commits. The caller owns authentication, settings/cadence, lease acquisition,
 * missing-credential handling, the automatic quota probe/reserve gate, BEGINNING
 * the exact provider-refresh attempt, mapping the returned result to an HTTP
 * response, and token-checked lease finalization. This executor receives the
 * already-begun attempt and RESOLVES it exactly once (success / no-op / failure)
 * — it never throws for a provider/payload/commit fault; only a genuine
 * programming defect propagates.
 *
 * Security: the real credential-bearing `/odds` URL is used only for the actual
 * request. Every diagnostic representation (the returned provider-error detail,
 * anything a caller may surface) is credential-sanitized here, and a raw provider
 * response body is NEVER returned, logged, or placed in status/results.
 */

import {
  fetchUpstreamResponse,
  sanitizeUpstreamUrl,
  UpstreamFetchError,
  type UpstreamPacingPolicy,
  type UpstreamRetryPolicy,
} from '../api/fetchUpstream.ts';
import { parseOddsUsageHeaders, type OddsUsageSnapshot } from '../api/oddsUsage.ts';
import { captureOddsUsageSnapshot, setLatestKnownOddsUsage } from '../server/oddsUsageStore.ts';
import type { DurableOddsRecord } from '../odds.ts';
import type { AppGame } from '../schedule.ts';
import type { TeamIdentityResolver } from '../teamIdentity.ts';
import { withAppStateKeyTransaction } from '../server/appStateStore.ts';
import { classifyEmptyOddsResponse, type OddsScheduleEvidenceItem } from './emptyOddsClassifier.ts';
import { loadCachedScheduleItems } from '../server/canonicalScheduleCache.ts';
import { getScopedAliasMap } from '../server/globalAliasStore.ts';
import { createTeamIdentityResolver, type TeamCatalogItem } from '../teamIdentity.ts';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { commitCanonicalOddsRefresh, commitFilteredOddsRefresh } from './oddsCommit.ts';
import {
  leaseResolutionForResult,
  oddsRefreshResult,
  type OddsRefreshLeaseResolution,
  type OddsRefreshResult,
} from './refreshResult.ts';
import {
  recordProviderRefreshFailure,
  recordProviderRefreshNoop,
  recordProviderRefreshSuccess,
  type ProviderRefreshAttempt,
} from '../server/providerRefreshStatus.ts';
import type { ProviderRefreshScope } from '../providerRefreshScope.ts';
import {
  effectiveOddsObservationMs,
  isStructurallyValidUpstreamOddsEvent,
  normalizeUpstreamOddsEvent,
  oddsCache,
  ODDS_CACHE_SCOPE,
  pickFreshestOddsFallback,
  type NormalizedOddsEvent,
  type SharedOddsCacheEntry,
  type UpstreamOddsEvent,
} from '@/app/api/odds/routeInternals';

export const ODDS_API_URL = 'https://api.the-odds-api.com/v4/sports/americanfootball_ncaaf/odds';

/** The canonical bookmakers/markets/regions target (mirrors routeInternals). */
export type OddsProviderQuery = {
  bookmakers: string[];
  markets: string[];
  regions: string[];
};

/** Build the real, credential-bearing provider URL. NEVER logged/returned. */
export function buildOddsProviderUrl(apiKey: string, query: OddsProviderQuery): string {
  const url = new URL(ODDS_API_URL);
  url.searchParams.set('regions', query.regions.join(','));
  url.searchParams.set('oddsFormat', 'american');
  url.searchParams.set('dateFormat', 'iso');
  url.searchParams.set('bookmakers', query.bookmakers.join(','));
  url.searchParams.set('markets', query.markets.join(','));
  url.searchParams.set('apiKey', apiKey);
  return url.toString();
}

/** Allowlisted, credential-safe provider-fetch failure detail (no body). */
export type SafeUpstreamDetail = {
  kind: string;
  message: string;
  status?: number;
  statusText?: string;
  url: string;
};

export type OddsRefreshExecution = {
  result: OddsRefreshResult;
  /** The usage snapshot captured from this request's provider headers. */
  usage: OddsUsageSnapshot | null;
  /** The entry to serve (freshly committed, or prior-good on a no-op). */
  rawEntry: SharedOddsCacheEntry | undefined;
  /** The committed durable per-game store (canonical only; null otherwise). */
  canonicalStore: Record<string, DurableOddsRecord> | null;
  /** The built canonical games (canonical only) so the caller selects items. */
  canonicalGames: AppGame[] | null;
  committedAt: string | null;
  commitSeq: number | null;
  /** Present only on a provider-fetch failure — safe to surface to the caller. */
  providerErrorDetail?: SafeUpstreamDetail;
  /**
   * True when the `/odds` response carried usable usage headers. When false after
   * a billed request, the automatic caller applies a conservative post-call usage
   * estimate (the manual caller relies on its retry/pacing instead).
   */
  usageFromHeaders: boolean;
  /**
   * True when this execution PERSISTED an authoritative usage snapshot for the
   * billed request — either trustworthy `/odds` headers (`usageFromHeaders`) OR the
   * 402/429 quota-error zero fallback. The automatic caller uses this to decide
   * whether a billed FAILURE with untrusted headers still needs a conservative
   * estimate: when this is false after a failure, no authoritative usage was
   * recorded, so the balance would otherwise stay overstated (review remediation).
   */
  authoritativeUsagePersisted: boolean;
  /** The lease resolution implied by the result (backoff advance/reset/none). */
  leaseResolution: OddsRefreshLeaseResolution;
};

/** Schedule + resolver evidence used to classify an empty Odds payload. */
export type EmptyOddsScheduleEvidence = {
  scheduleItems: readonly OddsScheduleEvidenceItem[] | null;
  resolver: TeamIdentityResolver | null;
};

/** Cache-only schedule evidence for empty classification (both callers). */
async function gatherEmptyOddsScheduleEvidence(season: number): Promise<EmptyOddsScheduleEvidence> {
  let scheduleItems: OddsScheduleEvidenceItem[] | null = null;
  try {
    scheduleItems = await loadCachedScheduleItems(season);
  } catch {
    scheduleItems = null;
  }
  let resolver: TeamIdentityResolver | null = null;
  if (scheduleItems !== null && scheduleItems.length > 0) {
    const [teamsRead, aliasRead] = await Promise.allSettled([
      readBundledTeamsCatalog(),
      getScopedAliasMap('', season),
    ]);
    if (teamsRead.status === 'fulfilled' && aliasRead.status === 'fulfilled') {
      resolver = createTeamIdentityResolver({ aliasMap: aliasRead.value, teams: teamsRead.value });
    }
  }
  return { scheduleItems, resolver };
}

async function readBundledTeamsCatalog(): Promise<TeamCatalogItem[]> {
  const raw = await fs.readFile(path.join(process.cwd(), 'src/data/teams.json'), 'utf8');
  const parsed = JSON.parse(raw) as { items?: TeamCatalogItem[] };
  return Array.isArray(parsed.items) ? parsed.items : [];
}

/**
 * The typed empty-classification result. `unexpected-empty` is a truthful
 * failure (odds are still expected); `written-empty`/`preserved` are valid
 * no-ops that either commit a fresh empty entry or retain prior-good.
 */
type EmptyCommitOutcome =
  | {
      kind: 'unexpected-empty';
      /**
       * The classifier's own two counts, carried through so the caller can tell
       * WHY the empty was unexpected (PLATFORM-089). `nearHorizonGameCount > 0`
       * means a game inside the expectation horizon should have posted lines and
       * did not — a genuine fault. Zero means the only evidence was prior rows
       * for games FURTHER out, where a book withdrawing a line is ordinary.
       */
      nearHorizonGameCount: number;
      priorUpcomingEventCount: number;
      /**
       * Whether the slate evidence was POSITIVELY AVAILABLE — successfully read,
       * nonempty, with identity inputs. `nearHorizonGameCount === 0` is otherwise
       * ambiguous between "we looked and nothing is near" and "we could not
       * look": an unreadable schedule, or an empty one (a real season slate is
       * never empty), both yield zero. Downgrading on that would fail OPEN,
       * turning a transient read failure into a silent no-op.
       */
      expectationEvidenceAvailable: boolean;
      /** Prior-good rows, retained: an unexpected empty never clears them. */
      entry: SharedOddsCacheEntry | undefined;
    }
  | { kind: 'written-empty'; entry: SharedOddsCacheEntry }
  | { kind: 'preserved'; entry: SharedOddsCacheEntry | undefined };

/**
 * Classify + conditionally commit an EMPTY provider payload, transacting on the
 * exact `odds-cache` key (transaction-fresh prior read). Observation ordering
 * short-circuits a stale empty; a store failure throws a typed transaction error.
 */
async function commitEmptyOddsRefresh(params: {
  seasonScopedKey: string;
  season: number;
  isCanonical: boolean;
  usage: OddsUsageSnapshot | null;
  observationAt: string;
  /**
   * Caller-supplied empty-classification evidence. The automatic caller passes the
   * ALREADY-LOADED canonical context here so classification never re-reads
   * schedule/catalog/aliases a second time — a transient failure of that re-read
   * would otherwise misclassify an EXPECTED empty (odds due for an in-window game)
   * as a benign no-op, reset backoff, and delay the next request for hours (review
   * remediation). Absent (manual path) ⇒ gather cache-only evidence as before.
   */
  providedEvidence?: EmptyOddsScheduleEvidence;
}): Promise<EmptyCommitOutcome> {
  const { seasonScopedKey, season, isCanonical, usage, observationAt, providedEvidence } = params;
  const evidence = providedEvidence ?? (await gatherEmptyOddsScheduleEvidence(season));
  const result = await withAppStateKeyTransaction<EmptyCommitOutcome>(
    ODDS_CACHE_SCOPE,
    seasonScopedKey,
    async (txn) => {
      const memoryEntry = oddsCache.entries[seasonScopedKey];
      const priorStored = (await txn.read<SharedOddsCacheEntry>())?.value;
      const priorEntry = pickFreshestOddsFallback(memoryEntry, priorStored);
      // Observation ordering: a prior raw entry captured at/after this refresh's
      // observation (freshest across memo + durable) wins — never overwrite newer
      // raw odds with a stale empty.
      const incomingObservationMs = Date.parse(observationAt);
      const observationNewestPrior = [memoryEntry, priorStored]
        .filter((e): e is SharedOddsCacheEntry => Boolean(e))
        .reduce<
          SharedOddsCacheEntry | undefined
        >((best, e) => (best === undefined || effectiveOddsObservationMs(e) > effectiveOddsObservationMs(best) ? e : best), undefined);
      if (
        observationNewestPrior &&
        Number.isFinite(incomingObservationMs) &&
        effectiveOddsObservationMs(observationNewestPrior) >= incomingObservationMs
      ) {
        return { kind: 'preserved', entry: observationNewestPrior };
      }
      const classification = classifyEmptyOddsResponse({
        priorEvents: priorEntry?.data ?? [],
        scheduleItems: evidence.scheduleItems,
        resolver: evidence.resolver,
        includeScheduleExpectation: isCanonical,
        now: Date.now(),
      });
      if (classification.kind === 'unexpected-empty') {
        return {
          kind: 'unexpected-empty',
          nearHorizonGameCount: classification.nearHorizonGameCount,
          priorUpcomingEventCount: classification.priorUpcomingEventCount,
          // The same condition the classifier calls `reconcilable`.
          expectationEvidenceAvailable:
            isCanonical &&
            evidence.scheduleItems !== null &&
            evidence.scheduleItems.length > 0 &&
            evidence.resolver !== null,
          entry: priorEntry ?? memoryEntry,
        };
      }
      const priorHasData = (priorEntry?.data.length ?? 0) > 0;
      const replaceObsolete = priorHasData && classification.priorRowsProvablyObsolete;
      if (!priorHasData || replaceObsolete) {
        const emptyEntry: SharedOddsCacheEntry = {
          data: [],
          lastFetch: Date.now(),
          usage,
          observedAt: observationAt,
        };
        await txn.write(emptyEntry);
        return { kind: 'written-empty', entry: emptyEntry };
      }
      return { kind: 'preserved', entry: priorEntry ?? memoryEntry };
    }
  );
  // Publish the process cache only after the confirmed commit.
  if (result.kind === 'written-empty') {
    oddsCache.entries[seasonScopedKey] = result.entry;
  }
  return result;
}

/**
 * Whether the response's usage headers are TRUSTWORTHY — present AND every value
 * is a nonnegative safe integer (the same fail-closed bar the `/sports` probe
 * applies). Used for BOTH the success and the non-2xx path so the automatic
 * caller trusts authoritative provider usage (e.g. a 429's `remaining: 0`) instead
 * of overwriting it with a conservative estimate (review remediation).
 */
function usageHeadersTrustworthy(headers: Headers): boolean {
  const parsed = parseOddsUsageHeaders(headers);
  return (
    parsed !== null &&
    [parsed.used, parsed.remaining, parsed.lastCost].every((v) => Number.isSafeInteger(v) && v >= 0)
  );
}

function safeDetailFromUpstream(error: UpstreamFetchError): SafeUpstreamDetail {
  return {
    kind: error.details.kind,
    message: error.details.message,
    ...(typeof error.details.status === 'number' ? { status: error.details.status } : {}),
    ...(error.details.statusText ? { statusText: error.details.statusText } : {}),
    // fetchUpstream already sanitizes details.url; sanitize again defensively.
    url: sanitizeUpstreamUrl(error.details.url),
  };
}

export type OddsRefreshMode = 'manual' | 'automatic';

/** Resolve canonical games + resolver for the atomic commit (caller-specific). */
export type CanonicalInputsResolver = (
  events: NormalizedOddsEvent[]
) => Promise<
  { available: true; games: AppGame[]; resolver: TeamIdentityResolver } | { available: false }
>;

/**
 * Execute one Odds refresh end to end for an already-begun attempt: build the
 * provider URL, fetch (with the caller's retry policy), capture usage before
 * body parsing, classify/normalize the payload, commit atomically (canonical) or
 * raw-only (filtered) or empty, resolve status exactly once, and return the typed
 * result. Never throws for a provider/payload/commit fault.
 */
export async function executeOddsRefresh(params: {
  mode: OddsRefreshMode;
  season: number;
  seasonScopedKey: string;
  isCanonical: boolean;
  scope: ProviderRefreshScope;
  attempt: ProviderRefreshAttempt;
  apiKey: string;
  query: OddsProviderQuery;
  observationAt: string;
  now: string;
  retry: UpstreamRetryPolicy;
  pacing?: UpstreamPacingPolicy;
  resolveCanonicalInputs: CanonicalInputsResolver;
  /**
   * Pre-loaded empty-classification evidence (automatic caller). When supplied, the
   * empty path uses it INSTEAD of re-reading schedule/catalog/aliases, so a
   * transient re-read failure can never misclassify an expected empty (finding 3).
   */
  emptyClassificationEvidence?: EmptyOddsScheduleEvidence;
}): Promise<OddsRefreshExecution> {
  const {
    mode,
    season,
    seasonScopedKey,
    isCanonical,
    scope,
    attempt,
    apiKey,
    query,
    observationAt,
    now,
    retry,
    pacing,
    resolveCanonicalInputs,
    emptyClassificationEvidence,
  } = params;

  const usageContext = {
    sportKey: 'americanfootball_ncaaf',
    markets: query.markets,
    regions: query.regions,
    endpointType: 'odds',
    cacheStatus: 'miss' as const,
  };

  let usage: OddsUsageSnapshot | null = null;
  let usageFromHeaders = false;
  // Set true when the executor writes the authoritative 402/429 zero fallback, so
  // `authoritativeUsagePersisted` reflects it even though headers were untrusted.
  let wroteQuotaErrorFallback = false;
  const base = (
    result: OddsRefreshResult,
    over: Partial<OddsRefreshExecution> = {}
  ): OddsRefreshExecution => ({
    result,
    usage,
    rawEntry: undefined,
    canonicalStore: null,
    canonicalGames: null,
    committedAt: null,
    commitSeq: null,
    usageFromHeaders,
    authoritativeUsagePersisted: usageFromHeaders || wroteQuotaErrorFallback,
    leaseResolution: leaseResolutionForResult(result),
    ...over,
  });

  // ---- Provider request (real credential URL; caller retry policy) ----
  let upstreamRes: Response;
  try {
    upstreamRes = await fetchUpstreamResponse(buildOddsProviderUrl(apiKey, query), {
      cache: 'no-store',
      timeoutMs: 12000,
      retry,
      pacing,
      throwOnHttpError: false,
    });
  } catch (error) {
    // Transport/timeout/network — record failure, return a safe detail.
    const detail =
      error instanceof UpstreamFetchError
        ? safeDetailFromUpstream(error)
        : { kind: 'network', message: 'odds provider request failed', url: '' };
    const result = oddsRefreshResult('failure', 'provider-fetch-failed', 502);
    await recordProviderRefreshFailure('odds', scope, {
      attempt,
      error: detail.message,
      code: 'provider-fetch-failed',
      status: detail.status ?? 502,
    });
    return base(result, { providerErrorDetail: detail });
  }

  if (!upstreamRes.ok) {
    usageFromHeaders = usageHeadersTrustworthy(upstreamRes.headers);
    // Only trust RESPONSE-DERIVED usage when the headers are trustworthy. Otherwise
    // captureOddsUsageSnapshot returns the cached pre-probe balance, which would be
    // reported as this billed request's post-call usage (review remediation).
    usage = usageFromHeaders
      ? await captureOddsUsageSnapshot(upstreamRes.headers, usageContext)
      : null;
    if (upstreamRes.status === 402 || upstreamRes.status === 429) {
      // Quota-exhaustion signal. TRUSTWORTHY headers are authoritative and kept
      // as-is (even an explicit `remaining: 0` — its real `lastCost`/source). Only
      // when the headers are missing/malformed do we author the zero fallback AND
      // adopt it as this request's usage, so the event + committed entry report the
      // true 0 (not a stale pre-probe balance) and quota accounting can never
      // restore an overstated balance from untrustworthy headers (remediation).
      if (!usageFromHeaders) {
        const zero: OddsUsageSnapshot = {
          used: usage?.limit ?? 500,
          remaining: 0,
          lastCost: usage?.lastCost ?? 0,
          limit: usage?.limit ?? 500,
          capturedAt: new Date().toISOString(),
          source: 'quota-error-fallback',
          ...usageContext,
        };
        await setLatestKnownOddsUsage(zero);
        usage = zero;
        wroteQuotaErrorFallback = true;
      }
    }
    // Never read/return the raw response body.
    const detail: SafeUpstreamDetail = {
      kind: 'http',
      message: `Upstream request failed with status ${upstreamRes.status}`,
      status: upstreamRes.status,
      ...(upstreamRes.statusText ? { statusText: upstreamRes.statusText } : {}),
      url: sanitizeUpstreamUrl(buildOddsProviderUrl(apiKey, query)),
    };
    const result = oddsRefreshResult('failure', 'provider-fetch-failed', 502);
    await recordProviderRefreshFailure('odds', scope, {
      attempt,
      error: detail.message,
      code: 'provider-fetch-failed',
      status: upstreamRes.status,
    });
    return base(result, { providerErrorDetail: detail });
  }

  // Capture + persist usage BEFORE parsing (the request spent credits regardless).
  // Only trustworthy headers become this request's usage; otherwise
  // captureOddsUsageSnapshot would return the cached pre-probe balance and commit
  // that PRE-SPEND value into the raw cache (which public `/api/odds` prefers). A
  // null here keeps the committed entry from advertising a stale balance; the
  // automatic caller applies a conservative global estimate instead (remediation).
  usageFromHeaders = usageHeadersTrustworthy(upstreamRes.headers);
  usage = usageFromHeaders
    ? await captureOddsUsageSnapshot(upstreamRes.headers, usageContext)
    : null;

  let upstreamData: unknown;
  try {
    upstreamData = await upstreamRes.json();
  } catch {
    return await rejectPayload('odds-invalid-payload');
  }
  if (!Array.isArray(upstreamData)) {
    return await rejectPayload('odds-invalid-payload');
  }
  if (upstreamData.some((row) => !isStructurallyValidUpstreamOddsEvent(row))) {
    return await rejectPayload('odds-schema-drift');
  }
  const normalizedEvents = (upstreamData as UpstreamOddsEvent[])
    .map(normalizeUpstreamOddsEvent)
    .filter((event): event is NormalizedOddsEvent => Boolean(event));
  if (upstreamData.length > 0 && normalizedEvents.length === 0) {
    return await rejectPayload('odds-schema-drift');
  }

  async function rejectPayload(
    reason: 'odds-invalid-payload' | 'odds-schema-drift'
  ): Promise<OddsRefreshExecution> {
    const result = oddsRefreshResult('failure', reason, 502);
    await recordProviderRefreshFailure('odds', scope, {
      attempt,
      error: `odds ${season}: ${reason}`,
      code: reason,
      status: 502,
    });
    return base(result);
  }

  // ---- Empty payload ----
  if (normalizedEvents.length === 0) {
    let empty: EmptyCommitOutcome;
    try {
      empty = await commitEmptyOddsRefresh({
        seasonScopedKey,
        season,
        isCanonical,
        usage,
        observationAt,
        providedEvidence: emptyClassificationEvidence,
      });
    } catch {
      const result = oddsRefreshResult('failure', 'durable-commit-failed', 503);
      await recordProviderRefreshFailure('odds', scope, {
        attempt,
        error: `odds ${season}: durable commit failed`,
        code: 'durable-commit-failed',
        status: 503,
      });
      return base(result);
    }
    if (empty.kind === 'unexpected-empty') {
      // PLATFORM-089 — the VERDICT is unchanged; only the CONSEQUENCE is split.
      //
      // The classifier is right that prior rows vanishing is worth noticing, and
      // it deliberately applies no distance limit so a provider dropping
      // early-posted lines is still caught. That was written when automation
      // stopped at 7 days, so it could only fire out here on a manual refresh.
      // Automation now polls to 45 days, where books routinely WITHDRAW a line
      // and re-post it closer to kickoff — ordinary business, not a regression.
      //
      // The classifier already returns the exact discriminator, so nothing about
      // it changes and its tests stand: `nearHorizonGameCount` counts games
      // inside the expectation horizon that SHOULD have lines. Zero means the
      // only evidence was prior rows for games further out.
      //
      //   near-horizon games expected  → billed FAILURE (unchanged): a game this
      //                                  week has no lines and once did.
      //   only far-out prior rows      → truthful NO-OP: recorded, visible in the
      //                                  event and receipt, but no 502, no
      //                                  backoff, no provider fault. Escalating a
      //                                  daily false alarm through preseason is
      //                                  the failure this campaign removes.
      //
      // Narrowed to the AUTOMATIC path on purpose. The consequences being
      // softened — durable backoff and a System Health provider fault — exist
      // only there. A manual refresh has neither: a person asked and will read
      // the answer, which is the context the original rule was written for and
      // the only one it could previously reach. Its behaviour is unchanged, and
      // so are its tests.
      //
      // Prior rows are RETAINED either way — absence out here never proves them
      // obsolete, so nothing licenses clearing them.
      if (
        mode === 'automatic' &&
        empty.expectationEvidenceAvailable &&
        empty.nearHorizonGameCount === 0
      ) {
        const result = oddsRefreshResult('no-op', 'early-lines-withdrawn', 200);
        await recordProviderRefreshNoop('odds', scope, { attempt, source: 'odds-api' });
        return base(result, { rawEntry: empty.entry });
      }
      const result = oddsRefreshResult('failure', 'odds-empty-unexpected', 502);
      await recordProviderRefreshFailure('odds', scope, {
        attempt,
        error: `odds ${season}: provider returned 0 events but odds are expected`,
        code: 'odds-empty-unexpected',
        status: 502,
      });
      return base(result);
    }
    const result = oddsRefreshResult('no-op', 'empty-response', 200);
    await recordProviderRefreshNoop('odds', scope, { attempt, source: 'odds-api' });
    return base(result, { rawEntry: empty.entry });
  }

  // ---- Nonempty payload ----
  const rawEntry: SharedOddsCacheEntry = {
    data: normalizedEvents,
    lastFetch: Date.now(),
    usage,
    observedAt: observationAt,
  };

  if (isCanonical) {
    const inputs = await resolveCanonicalInputs(normalizedEvents);
    if (!inputs.available) {
      const result = oddsRefreshResult('failure', 'canonical-context-unavailable', 503);
      await recordProviderRefreshFailure('odds', scope, {
        attempt,
        error: `odds ${season}: canonical context unavailable`,
        code: 'canonical-context-unavailable',
        status: 503,
      });
      return base(result);
    }
    let commit;
    try {
      commit = await commitCanonicalOddsRefresh({
        season,
        seasonScopedKey,
        rawEntry,
        games: inputs.games,
        oddsEvents: normalizedEvents,
        resolver: inputs.resolver,
        observationAt,
        now,
      });
    } catch {
      commit = { kind: 'store-unavailable' as const };
    }
    if (commit.kind === 'store-unavailable') {
      const result = oddsRefreshResult('failure', 'durable-commit-failed', 503);
      await recordProviderRefreshFailure('odds', scope, {
        attempt,
        error: `odds ${season}: durable commit failed`,
        code: 'durable-commit-failed',
        status: 503,
      });
      return base(result);
    }
    if (commit.kind === 'stale-observation') {
      const result = oddsRefreshResult('no-op', 'stale-observation', 200);
      await recordProviderRefreshNoop('odds', scope, { attempt, source: 'odds-api' });
      return base(result, {
        rawEntry: commit.rawEntry ?? oddsCache.entries[seasonScopedKey],
        canonicalStore: commit.store,
        canonicalGames: inputs.games,
      });
    }
    const result = oddsRefreshResult('success', 'written-clean', 200, {
      rowsCommitted: commit.rowsCommitted,
    });
    await recordProviderRefreshSuccess('odds', scope, {
      attempt,
      committedAt: commit.committedAt,
      commitSeq: commit.commitSeq,
      source: 'odds-api',
      rowsCommitted: commit.rowsCommitted,
      usage: usage
        ? {
            used: usage.used,
            remaining: usage.remaining,
            limit: usage.limit,
            lastCost: usage.lastCost,
          }
        : undefined,
    });
    return base(result, {
      rawEntry,
      canonicalStore: commit.store,
      canonicalGames: inputs.games,
      committedAt: commit.committedAt,
      commitSeq: commit.commitSeq,
    });
  }

  // ---- Filtered (manual only): raw-cache key ONLY ----
  let filtered;
  try {
    filtered = await commitFilteredOddsRefresh({ seasonScopedKey, rawEntry });
  } catch {
    filtered = { kind: 'store-unavailable' as const };
  }
  if (filtered.kind === 'store-unavailable') {
    const result = oddsRefreshResult('failure', 'durable-commit-failed', 503);
    await recordProviderRefreshFailure('odds', scope, {
      attempt,
      error: `odds ${season}: durable commit failed`,
      code: 'durable-commit-failed',
      status: 503,
    });
    return base(result);
  }
  if (filtered.kind === 'stale-observation') {
    const result = oddsRefreshResult('no-op', 'stale-observation', 200);
    await recordProviderRefreshNoop('odds', scope, { attempt, source: 'odds-api' });
    return base(result, { rawEntry: filtered.rawEntry ?? oddsCache.entries[seasonScopedKey] });
  }
  const result = oddsRefreshResult('success', 'written-clean', 200, {
    rowsCommitted: rawEntry.data.length,
  });
  await recordProviderRefreshSuccess('odds', scope, {
    attempt,
    committedAt: filtered.committedAt,
    commitSeq: filtered.commitSeq,
    source: 'odds-api',
    rowsCommitted: rawEntry.data.length,
    usage: usage
      ? {
          used: usage.used,
          remaining: usage.remaining,
          limit: usage.limit,
          lastCost: usage.lastCost,
        }
      : undefined,
  });
  return base(result, {
    rawEntry,
    committedAt: filtered.committedAt,
    commitSeq: filtered.commitSeq,
  });
}

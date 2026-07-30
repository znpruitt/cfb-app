/**
 * PLATFORM-086E1C1 — the ONE shared schedule-presentation refresh authority.
 *
 * Refreshes the two optional presentation caches — the year-wide game-media
 * cache (`schedule-media/<year>-all`) and the global venue catalog
 * (`venue-catalog/current`) — as independent parts behind independent durable
 * leases, and returns one typed {@link SchedulePresentationRefreshResult}.
 *
 * In E1C1 the ONLY caller is the authorized full-year manual schedule refresh
 * (`trigger: 'manual'`), invoked after a successful E1A canonical commit. The
 * `weekly` / `season-transition` triggers exist for the future E1C2 wiring and
 * are NOT wired to any route or cron in this slice — the authority is manually
 * seedable but automatically dormant.
 *
 * Invariants:
 *   - the canonical schedule is read CACHE-ONLY and is the sole eligibility
 *     source: media attaches only through exact numeric CFBD game ids collected
 *     from `schedule/<year>-all-all`; unusable context never triggers provider
 *     work, and an absent/empty canonical schedule makes NO provider call;
 *   - each part issues AT MOST ONE provider request per invocation, begins its
 *     provider-refresh attempt after its lease and BEFORE credential
 *     validation, and records status against its OWN exact presentation scope
 *     (`schedule:media:<year>` / `schedule:venues`) — never the canonical
 *     schedule year scope;
 *   - commits are observation-ordered inside `withAppStateKeyTransaction`; a
 *     prior entry observed at/after this refresh wins; empty replacements of
 *     populated prior-good are rejected; durable write precedes process-memo
 *     publication and provider-success status; a durable failure preserves
 *     prior-good and publishes no memo;
 *   - presentation-only changes NEVER invalidate standings or any canonical
 *     schedule selector, and never mutate canonical `schedule/*` records;
 *   - exactly one allowlisted `schedule-presentation-refresh` event is emitted
 *     per invocation from one outer `finally`.
 */

import type { CacheEntry } from '@/app/api/schedule/cache';

import { fetchUpstreamJson } from '../api/fetchUpstream.ts';
import { buildCfbdGamesMediaUrl, buildCfbdVenuesUrl } from '../cfbd.ts';
import { scheduleMediaScope, venueCatalogScope } from '../providerRefreshScope.ts';
import { getAppState, withAppStateKeyTransaction } from '../server/appStateStore.ts';
import {
  beginProviderRefreshAttempt,
  nextProviderCommitSeq,
  recordProviderRefreshFailure,
  recordProviderRefreshNoop,
  recordProviderRefreshSuccess,
  type ProviderRefreshAttempt,
} from '../server/providerRefreshStatus.ts';
import {
  normalizeScheduleMediaCacheEntry,
  normalizeScheduleMediaPayload,
  normalizeVenueCatalogCacheEntry,
  normalizeVenueCatalogPayload,
  scheduleMediaStateKey,
  SCHEDULE_MEDIA_STATE_SCOPE,
  VENUE_CATALOG_STATE_KEY,
  VENUE_CATALOG_STATE_SCOPE,
  type ScheduleMediaItem,
  type VenueCatalogCacheEntry,
  type VenueCatalogItem,
} from './schedulePresentation.ts';
import { publishScheduleMediaMemo, publishVenueCatalogMemo } from './schedulePresentationJoin.ts';
import {
  acquireSchedulePresentationLease,
  releaseSchedulePresentationLease,
  SCHEDULE_MEDIA_REFRESH_CONTROL_SCOPE,
  VENUE_CATALOG_REFRESH_CONTROL_KEY,
  VENUE_CATALOG_REFRESH_CONTROL_SCOPE,
} from './schedulePresentationLease.ts';
import { emitSchedulePresentationRefreshEvent } from './schedulePresentationLog.ts';
import {
  schedulePresentationPartResult,
  schedulePresentationRefreshResult,
  type SchedulePresentationPartResult,
  type SchedulePresentationRefreshResult,
  type SchedulePresentationRefreshTrigger,
} from './schedulePresentationResult.ts';

/** Bounded provider retry — mirrors every other CFBD caller's policy verbatim. */
const CFBD_RETRY_POLICY = {
  maxAttempts: 3,
  baseDelayMs: 250,
  maxDelayMs: 2_000,
  jitterRatio: 0.2,
  retryOnHttpStatuses: [408, 425, 429, 500, 502, 503, 504],
} as const;
/** Shared CFBD pacing key — serializes with every other CFBD caller. */
const CFBD_PACING_POLICY = {
  key: 'cfbd',
  minIntervalMs: 150,
} as const;

/** The venue catalog refetches only when the durable entry is at least this old. */
export const VENUE_CATALOG_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function canonicalScheduleKey(year: number): string {
  return `${year}-all-all`;
}

/**
 * Strict provider-game-id grammar shared with the media normalizer's canonical
 * form: a positive safe integer in EXACT canonical decimal representation (no
 * leading zeros), so a schedule id and a media gameId can only ever match on
 * the identical canonical string.
 */
function isCanonicalProviderGameId(id: unknown): id is string {
  if (typeof id !== 'string' || !/^[1-9]\d*$/.test(id)) return false;
  const parsed = Number(id);
  return Number.isSafeInteger(parsed) && parsed > 0;
}

type CanonicalContextOutcome =
  | { kind: 'ok'; eligibleGameIds: ReadonlySet<string> }
  | { kind: 'read-failed' }
  | { kind: 'no-games' }
  | { kind: 'no-usable-ids' };

/**
 * Resolve the invocation's canonical context CACHE-ONLY:
 *   - a genuine schedule-store read failure → `read-failed` (context unavailable);
 *   - an absent or genuinely empty canonical schedule → `no-games` (a valid state
 *     with nothing to attach — never a provider call);
 *   - a POPULATED canonical schedule whose rows provide no usable numeric
 *     provider ids → `no-usable-ids` (unavailable context, NOT permission to
 *     fetch an unattachable payload);
 *   - otherwise the exact eligible media target: the set of valid numeric
 *     provider game ids.
 */
async function resolveCanonicalContext(year: number): Promise<CanonicalContextOutcome> {
  let items: CacheEntry['items'];
  try {
    const stored = await getAppState<CacheEntry>('schedule', canonicalScheduleKey(year));
    items = Array.isArray(stored?.value?.items) ? stored.value.items : [];
    if (stored?.value && !Array.isArray(stored.value.items)) {
      // A present-but-malformed canonical entry is unusable context, not absence.
      return { kind: 'no-usable-ids' };
    }
  } catch {
    return { kind: 'read-failed' };
  }
  if (items.length === 0) return { kind: 'no-games' };
  const eligibleGameIds = new Set<string>();
  for (const item of items) {
    if (isCanonicalProviderGameId(item.id)) eligibleGameIds.add(item.id);
  }
  if (eligibleGameIds.size === 0) return { kind: 'no-usable-ids' };
  return { kind: 'ok', eligibleGameIds };
}

type PresentationCommitOutcome<TEntry> =
  | { kind: 'written-clean'; entry: TEntry; committedAt: string; commitSeq: number }
  | { kind: 'unchanged-clean'; entry: TEntry; committedAt: string; commitSeq: number }
  | { kind: 'empty-response' }
  | { kind: 'empty-replacement-rejected' }
  | { kind: 'stale-observation'; entry: TEntry | null }
  | { kind: 'store-unavailable' };

/**
 * Commit one presentation cache entry observation-ordered inside an advisory
 * transaction on its own key. Mirrors the E1A canonical commit policy: a prior
 * entry observed at/after `observedAtMs` wins (nothing written); an empty
 * target over populated prior-good is rejected; unchanged content commits only
 * newer observation metadata; changed content replaces the entry. Never touches
 * standings or any canonical `schedule/*` key.
 */
async function commitPresentationEntry<TItem>(params: {
  stateScope: string;
  stateKey: string;
  observedAtMs: number;
  items: TItem[];
  normalizePrior: (value: unknown) => { at: number; items: TItem[] } | null;
}): Promise<PresentationCommitOutcome<{ at: number; items: TItem[] }>> {
  const { stateScope, stateKey, observedAtMs, items, normalizePrior } = params;
  type Entry = { at: number; items: TItem[] };
  let outcome:
    | { kind: 'written-clean'; entry: Entry }
    | { kind: 'unchanged-clean'; entry: Entry }
    | { kind: 'empty-response' }
    | { kind: 'empty-replacement-rejected' }
    | { kind: 'stale-observation'; entry: Entry | null };
  try {
    outcome = await withAppStateKeyTransaction(
      stateScope,
      stateKey,
      async (txn): Promise<typeof outcome> => {
        const prior = normalizePrior((await txn.read<unknown>())?.value);
        if (prior && prior.at >= observedAtMs) {
          return { kind: 'stale-observation', entry: prior };
        }
        if (items.length === 0) {
          return prior && prior.items.length > 0
            ? { kind: 'empty-replacement-rejected' }
            : { kind: 'empty-response' };
        }
        const nextEntry: Entry = { at: observedAtMs, items };
        if (prior && JSON.stringify(prior.items) === JSON.stringify(items)) {
          const metadataOnly: Entry = { at: observedAtMs, items: prior.items };
          await txn.write(metadataOnly);
          return { kind: 'unchanged-clean', entry: metadataOnly };
        }
        await txn.write(nextEntry);
        return { kind: 'written-clean', entry: nextEntry };
      }
    );
  } catch {
    // The callback's only fallible operations are the store read/write (the
    // classification is pure), so ANY fault is a truthful durable-commit failure.
    return { kind: 'store-unavailable' };
  }
  if (outcome.kind === 'written-clean' || outcome.kind === 'unchanged-clean') {
    return {
      ...outcome,
      committedAt: new Date().toISOString(),
      commitSeq: nextProviderCommitSeq(),
    };
  }
  return outcome;
}

/**
 * Refresh the year-wide game-media cache. At most one `/games/media` request;
 * the eligibility filter is the caller-resolved canonical game-id set.
 */
async function refreshMediaPart(params: {
  year: number;
  eligibleGameIds: ReadonlySet<string>;
  now: number;
}): Promise<SchedulePresentationPartResult> {
  const { year, eligibleGameIds, now } = params;
  const scope = scheduleMediaScope(year);

  const lease = await acquireSchedulePresentationLease({
    controlScope: SCHEDULE_MEDIA_REFRESH_CONTROL_SCOPE,
    controlKey: String(year),
    now,
  });
  if (!lease.acquired) {
    return schedulePresentationPartResult({
      reason:
        lease.reason === 'refresh-in-progress' ? 'refresh-in-progress' : 'durable-commit-failed',
    });
  }

  let attempt: ProviderRefreshAttempt | null = null;
  let attemptResolved = false;
  let providerCallAttempted = false;
  let observedAt: string | null = null;
  try {
    attempt = await beginProviderRefreshAttempt('schedule', scope, {
      startedAt: new Date(now).toISOString(),
    });

    const apiKey = process.env.CFBD_API_KEY?.trim() ?? '';
    if (!apiKey) {
      await recordProviderRefreshFailure('schedule', scope, {
        attempt,
        error: 'CFBD_API_KEY missing',
        code: 'schedule-media-cfbd-api-key-missing',
        status: 503,
        durationMs: Date.now() - now,
      });
      attemptResolved = true;
      return schedulePresentationPartResult({ reason: 'cfbd-api-key-missing' });
    }

    const observedAtMs = now;
    observedAt = new Date(observedAtMs).toISOString();

    providerCallAttempted = true;
    let payload: unknown;
    try {
      payload = await fetchUpstreamJson<unknown>(buildCfbdGamesMediaUrl({ year }).toString(), {
        cache: 'no-store',
        timeoutMs: 12_000,
        headers: { Authorization: `Bearer ${apiKey}` },
        retry: CFBD_RETRY_POLICY,
        pacing: CFBD_PACING_POLICY,
      });
    } catch {
      await recordProviderRefreshFailure('schedule', scope, {
        attempt,
        error: `schedule media ${year}: provider fetch failed`,
        code: 'schedule-media-fetch-failed',
        status: 502,
        durationMs: Date.now() - now,
      });
      attemptResolved = true;
      return schedulePresentationPartResult({
        reason: 'provider-fetch-failed',
        providerCallAttempted,
        observedAt,
      });
    }

    const normalized = normalizeScheduleMediaPayload(payload, eligibleGameIds);
    if (normalized.kind !== 'rows') {
      const reason = normalized.kind === 'invalid-payload' ? 'invalid-payload' : 'schema-drift';
      await recordProviderRefreshFailure('schedule', scope, {
        attempt,
        error:
          reason === 'invalid-payload'
            ? `schedule media ${year}: provider returned a non-array payload`
            : `schedule media ${year}: nonempty payload normalized to zero usable media rows`,
        code: `schedule-media-${reason}`,
        status: 502,
        durationMs: Date.now() - now,
      });
      attemptResolved = true;
      return schedulePresentationPartResult({ reason, providerCallAttempted, observedAt });
    }

    const commit = await commitPresentationEntry<ScheduleMediaItem>({
      stateScope: SCHEDULE_MEDIA_STATE_SCOPE,
      stateKey: scheduleMediaStateKey(year),
      observedAtMs,
      items: normalized.items,
      normalizePrior: normalizeScheduleMediaCacheEntry,
    });

    switch (commit.kind) {
      case 'stale-observation': {
        // The transaction-fresh durable entry is NEWER than our observation —
        // forward it into the bounded memo (guarded to never regress) so this
        // instance serves the fresher rows without waiting out the memo TTL.
        if (commit.entry) publishScheduleMediaMemo(year, commit.entry);
        await recordProviderRefreshNoop('schedule', scope, {
          attempt,
          source: 'cfbd',
          durationMs: Date.now() - now,
        });
        attemptResolved = true;
        return schedulePresentationPartResult({
          reason: 'stale-observation',
          providerCallAttempted,
          rowsReceived: normalized.usableRows,
          observedAt,
        });
      }
      case 'empty-response': {
        await recordProviderRefreshNoop('schedule', scope, {
          attempt,
          source: 'cfbd',
          durationMs: Date.now() - now,
        });
        attemptResolved = true;
        return schedulePresentationPartResult({
          reason: 'empty-response',
          providerCallAttempted,
          rowsReceived: normalized.usableRows,
          observedAt,
        });
      }
      case 'empty-replacement-rejected': {
        await recordProviderRefreshFailure('schedule', scope, {
          attempt,
          error: `schedule media ${year}: provider returned zero eligible media rows while a populated media cache exists — rejected as an unexpected empty replacement`,
          code: 'schedule-media-empty-replacement-rejected',
          status: 502,
          durationMs: Date.now() - now,
        });
        attemptResolved = true;
        return schedulePresentationPartResult({
          reason: 'empty-replacement-rejected',
          providerCallAttempted,
          rowsReceived: normalized.usableRows,
          observedAt,
        });
      }
      case 'store-unavailable': {
        await recordProviderRefreshFailure('schedule', scope, {
          attempt,
          error: `schedule media ${year}: durable commit failed`,
          code: 'schedule-media-durable-commit-failed',
          status: 500,
          durationMs: Date.now() - now,
        });
        attemptResolved = true;
        return schedulePresentationPartResult({
          reason: 'durable-commit-failed',
          providerCallAttempted,
          rowsReceived: normalized.usableRows,
          observedAt,
        });
      }
      case 'unchanged-clean':
      case 'written-clean': {
        // Durable write confirmed → publish the bounded memo → record success.
        publishScheduleMediaMemo(year, commit.entry);
        const dataChanged = commit.kind === 'written-clean';
        await recordProviderRefreshSuccess('schedule', scope, {
          attempt,
          committedAt: commit.committedAt,
          commitSeq: commit.commitSeq,
          source: 'cfbd',
          rowsCommitted: dataChanged ? commit.entry.items.length : 0,
          durationMs: Date.now() - now,
        });
        attemptResolved = true;
        return schedulePresentationPartResult({
          reason: dataChanged ? 'written-clean' : 'unchanged-clean',
          providerCallAttempted,
          rowsReceived: normalized.usableRows,
          rowsCommitted: dataChanged ? commit.entry.items.length : 0,
          dataChanged,
          observedAt,
          committedAt: commit.committedAt,
        });
      }
    }
    return schedulePresentationPartResult({ reason: 'unexpected-error', providerCallAttempted });
  } catch {
    if (attempt && !attemptResolved) {
      await recordProviderRefreshFailure('schedule', scope, {
        attempt,
        error: `schedule media ${year}: unexpected refresh error`,
        code: 'schedule-media-unexpected-error',
        status: 500,
        durationMs: Date.now() - now,
      });
    }
    return schedulePresentationPartResult({
      reason: 'unexpected-error',
      providerCallAttempted,
      observedAt,
    });
  } finally {
    await releaseSchedulePresentationLease({
      controlScope: SCHEDULE_MEDIA_REFRESH_CONTROL_SCOPE,
      controlKey: String(year),
      token: lease.token,
    });
  }
}

/**
 * Refresh the global venue catalog. A FORCED durable freshness read decides
 * whether a fetch is due (absent or ≥ 30 days old); a fresh catalog returns
 * `fresh-cache` with no attempt and no provider call.
 */
async function refreshVenuesPart(params: { now: number }): Promise<SchedulePresentationPartResult> {
  const { now } = params;
  const scope = venueCatalogScope();

  // Forced durable freshness read — never the bounded memo.
  let priorEntry: VenueCatalogCacheEntry | null;
  try {
    const stored = await getAppState<unknown>(VENUE_CATALOG_STATE_SCOPE, VENUE_CATALOG_STATE_KEY);
    priorEntry = normalizeVenueCatalogCacheEntry(stored?.value);
  } catch {
    return schedulePresentationPartResult({ reason: 'canonical-context-unavailable' });
  }
  if (priorEntry && now - priorEntry.at < VENUE_CATALOG_TTL_MS) {
    return schedulePresentationPartResult({ reason: 'fresh-cache' });
  }

  const lease = await acquireSchedulePresentationLease({
    controlScope: VENUE_CATALOG_REFRESH_CONTROL_SCOPE,
    controlKey: VENUE_CATALOG_REFRESH_CONTROL_KEY,
    now,
  });
  if (!lease.acquired) {
    return schedulePresentationPartResult({
      reason:
        lease.reason === 'refresh-in-progress' ? 'refresh-in-progress' : 'durable-commit-failed',
    });
  }

  let attempt: ProviderRefreshAttempt | null = null;
  let attemptResolved = false;
  let providerCallAttempted = false;
  let observedAt: string | null = null;
  try {
    // Post-acquisition freshness RE-CHECK (Codex round-1 P3, mirroring the Odds
    // cron's post-acquisition cadence re-check): a competing invocation may have
    // refreshed and released between our first freshness read and this lease
    // grant — never spend a second `/venues` request on a catalog that just
    // became fresh. A re-read failure is context unavailability, exactly like
    // the first read; the lease is released by the enclosing `finally`.
    try {
      const recheck = normalizeVenueCatalogCacheEntry(
        (await getAppState<unknown>(VENUE_CATALOG_STATE_SCOPE, VENUE_CATALOG_STATE_KEY))?.value
      );
      if (recheck && now - recheck.at < VENUE_CATALOG_TTL_MS) {
        return schedulePresentationPartResult({ reason: 'fresh-cache' });
      }
    } catch {
      return schedulePresentationPartResult({ reason: 'canonical-context-unavailable' });
    }

    attempt = await beginProviderRefreshAttempt('schedule', scope, {
      startedAt: new Date(now).toISOString(),
    });

    const apiKey = process.env.CFBD_API_KEY?.trim() ?? '';
    if (!apiKey) {
      await recordProviderRefreshFailure('schedule', scope, {
        attempt,
        error: 'CFBD_API_KEY missing',
        code: 'venue-catalog-cfbd-api-key-missing',
        status: 503,
        durationMs: Date.now() - now,
      });
      attemptResolved = true;
      return schedulePresentationPartResult({ reason: 'cfbd-api-key-missing' });
    }

    const observedAtMs = now;
    observedAt = new Date(observedAtMs).toISOString();

    providerCallAttempted = true;
    let payload: unknown;
    try {
      payload = await fetchUpstreamJson<unknown>(buildCfbdVenuesUrl().toString(), {
        cache: 'no-store',
        timeoutMs: 12_000,
        headers: { Authorization: `Bearer ${apiKey}` },
        retry: CFBD_RETRY_POLICY,
        pacing: CFBD_PACING_POLICY,
      });
    } catch {
      await recordProviderRefreshFailure('schedule', scope, {
        attempt,
        error: 'venue catalog: provider fetch failed',
        code: 'venue-catalog-fetch-failed',
        status: 502,
        durationMs: Date.now() - now,
      });
      attemptResolved = true;
      return schedulePresentationPartResult({
        reason: 'provider-fetch-failed',
        providerCallAttempted,
        observedAt,
      });
    }

    const normalized = normalizeVenueCatalogPayload(payload);
    if (normalized.kind !== 'rows') {
      const reason = normalized.kind === 'invalid-payload' ? 'invalid-payload' : 'schema-drift';
      await recordProviderRefreshFailure('schedule', scope, {
        attempt,
        error:
          reason === 'invalid-payload'
            ? 'venue catalog: provider payload was non-array or carried conflicting rows for one venue id'
            : 'venue catalog: nonempty payload normalized to zero usable venue rows',
        code: `venue-catalog-${reason}`,
        status: 502,
        durationMs: Date.now() - now,
      });
      attemptResolved = true;
      return schedulePresentationPartResult({ reason, providerCallAttempted, observedAt });
    }

    const commit = await commitPresentationEntry<VenueCatalogItem>({
      stateScope: VENUE_CATALOG_STATE_SCOPE,
      stateKey: VENUE_CATALOG_STATE_KEY,
      observedAtMs,
      items: normalized.items,
      normalizePrior: normalizeVenueCatalogCacheEntry,
    });

    switch (commit.kind) {
      case 'stale-observation': {
        if (commit.entry) publishVenueCatalogMemo(commit.entry);
        await recordProviderRefreshNoop('schedule', scope, {
          attempt,
          source: 'cfbd',
          durationMs: Date.now() - now,
        });
        attemptResolved = true;
        return schedulePresentationPartResult({
          reason: 'stale-observation',
          providerCallAttempted,
          rowsReceived: normalized.usableRows,
          observedAt,
        });
      }
      case 'empty-response': {
        await recordProviderRefreshNoop('schedule', scope, {
          attempt,
          source: 'cfbd',
          durationMs: Date.now() - now,
        });
        attemptResolved = true;
        return schedulePresentationPartResult({
          reason: 'empty-response',
          providerCallAttempted,
          rowsReceived: normalized.usableRows,
          observedAt,
        });
      }
      case 'empty-replacement-rejected': {
        await recordProviderRefreshFailure('schedule', scope, {
          attempt,
          error:
            'venue catalog: provider returned zero venues while a populated catalog exists — rejected as an unexpected empty replacement',
          code: 'venue-catalog-empty-replacement-rejected',
          status: 502,
          durationMs: Date.now() - now,
        });
        attemptResolved = true;
        return schedulePresentationPartResult({
          reason: 'empty-replacement-rejected',
          providerCallAttempted,
          rowsReceived: normalized.usableRows,
          observedAt,
        });
      }
      case 'store-unavailable': {
        await recordProviderRefreshFailure('schedule', scope, {
          attempt,
          error: 'venue catalog: durable commit failed',
          code: 'venue-catalog-durable-commit-failed',
          status: 500,
          durationMs: Date.now() - now,
        });
        attemptResolved = true;
        return schedulePresentationPartResult({
          reason: 'durable-commit-failed',
          providerCallAttempted,
          rowsReceived: normalized.usableRows,
          observedAt,
        });
      }
      case 'unchanged-clean':
      case 'written-clean': {
        publishVenueCatalogMemo(commit.entry);
        const dataChanged = commit.kind === 'written-clean';
        await recordProviderRefreshSuccess('schedule', scope, {
          attempt,
          committedAt: commit.committedAt,
          commitSeq: commit.commitSeq,
          source: 'cfbd',
          rowsCommitted: dataChanged ? commit.entry.items.length : 0,
          durationMs: Date.now() - now,
        });
        attemptResolved = true;
        return schedulePresentationPartResult({
          reason: dataChanged ? 'written-clean' : 'unchanged-clean',
          providerCallAttempted,
          rowsReceived: normalized.usableRows,
          rowsCommitted: dataChanged ? commit.entry.items.length : 0,
          dataChanged,
          observedAt,
          committedAt: commit.committedAt,
        });
      }
    }
    return schedulePresentationPartResult({ reason: 'unexpected-error', providerCallAttempted });
  } catch {
    if (attempt && !attemptResolved) {
      await recordProviderRefreshFailure('schedule', scope, {
        attempt,
        error: 'venue catalog: unexpected refresh error',
        code: 'venue-catalog-unexpected-error',
        status: 500,
        durationMs: Date.now() - now,
      });
    }
    return schedulePresentationPartResult({
      reason: 'unexpected-error',
      providerCallAttempted,
      observedAt,
    });
  } finally {
    await releaseSchedulePresentationLease({
      controlScope: VENUE_CATALOG_REFRESH_CONTROL_SCOPE,
      controlKey: VENUE_CATALOG_REFRESH_CONTROL_KEY,
      token: lease.token,
    });
  }
}

/**
 * Refresh the schedule-presentation caches for ONE year. Optional `now` (epoch
 * ms) fixes the observation instant for deterministic tests; production omits
 * it. Never throws — every fault resolves into the typed result, and exactly
 * one runtime event is emitted from the outer `finally`.
 */
export async function refreshSchedulePresentation(params: {
  year: number;
  trigger: SchedulePresentationRefreshTrigger;
  now?: number;
}): Promise<SchedulePresentationRefreshResult> {
  const { year, trigger } = params;
  const now = params.now ?? Date.now();
  let media: SchedulePresentationPartResult = schedulePresentationPartResult({
    reason: 'unexpected-error',
  });
  let venues: SchedulePresentationPartResult = schedulePresentationPartResult({
    reason: 'unexpected-error',
  });
  try {
    const context = await resolveCanonicalContext(year);
    if (context.kind === 'read-failed' || context.kind === 'no-usable-ids') {
      // Unusable canonical context governs the WHOLE invocation: neither part
      // may treat it as permission to fetch.
      media = schedulePresentationPartResult({ reason: 'canonical-context-unavailable' });
      venues = schedulePresentationPartResult({ reason: 'canonical-context-unavailable' });
    } else if (context.kind === 'no-games') {
      // Nothing to attach presentation data to — a valid state, no provider call.
      media = schedulePresentationPartResult({ reason: 'no-eligible-games' });
      venues = schedulePresentationPartResult({ reason: 'no-eligible-games' });
    } else {
      // Sequential on purpose: the shared CFBD pacing key serializes the two
      // requests anyway, and each part remains independent — one part's lease
      // contention, freshness, or failure never blocks the other.
      media = await refreshMediaPart({ year, eligibleGameIds: context.eligibleGameIds, now });
      venues = await refreshVenuesPart({ now });
    }
  } catch {
    // Defensive: parts already default to `unexpected-error`; the authority
    // must never throw into its caller.
  } finally {
    emitSchedulePresentationRefreshEvent({
      trigger,
      year,
      result: schedulePresentationRefreshResult({ trigger, year, media, venues }).status,
      media,
      venues,
      startedAtMs: now,
    });
  }
  return schedulePresentationRefreshResult({ trigger, year, media, venues });
}

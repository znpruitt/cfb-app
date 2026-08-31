/**
 * PLATFORM-117/118 — one year-scoped CFBD team-record cache and refresh authority.
 *
 * The live-scores cron supplies an observed-finalisation signal; the independent
 * hourly team-records job supplies no such signal. A durable six-hour floor
 * bounds event-driven calls, while a separate twelve-hour cache-age ceiling
 * guarantees clock-driven recovery between slates and after a cold deployment.
 *
 * Invariants:
 *   - one unfiltered `GET /records?year=` request at most per invocation;
 *   - `records` owns its own year-scoped refresh status and operator toggle;
 *   - only an allowlisted normalized W-L model is durable (never raw CFBD rows);
 *   - a populated cache is never overwritten by a zero-row response;
 *   - commit ordering is decided transaction-fresh by observation timestamp;
 *   - the durable commit precedes provider-success status.
 */

import { randomUUID } from 'node:crypto';

import { CFBD_PEAK_LATENCY_TIMEOUT_MS } from '../api/cfbdRequestPolicy.ts';
import { fetchUpstreamJson, UpstreamFetchError } from '../api/fetchUpstream.ts';
import { buildCfbdRecordsUrl } from '../cfbd.ts';
import type { QuotaRefusalReason } from '../gameStats/quotaPolicy.ts';
import { yearScope } from '../providerRefreshScope.ts';
import { withAppStateKeyTransaction } from '../server/appStateStore.ts';
import {
  beginProviderRefreshAttempt,
  nextProviderCommitSeq,
  recordProviderRefreshFailure,
  recordProviderRefreshNoop,
  recordProviderRefreshSuccess,
  type ProviderRefreshAttempt,
} from '../server/providerRefreshStatus.ts';
import { isAutoRefreshAllowed } from '../server/providerRefreshSettings.ts';
import {
  normalizeTeamRecordsCacheEntry,
  normalizeTeamRecordsPayload,
  readTeamRecordsCache,
  TEAM_RECORDS_STATE_SCOPE,
  type TeamRecordItem,
  type TeamRecordsCacheEntry,
} from './teamRecordsCache.ts';

export const TEAM_RECORDS_REFRESH_CONTROL_SCOPE = 'team-records-refresh-control';
export const TEAM_RECORDS_MIN_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const TEAM_RECORDS_MAX_REFRESH_INTERVAL_MS = 12 * 60 * 60 * 1000;
const TEAM_RECORDS_LEASE_DURATION_MS = 2 * 60 * 1000;

const RETRY_POLICY = {
  maxAttempts: 1,
  baseDelayMs: 0,
  maxDelayMs: 0,
  jitterRatio: 0,
  retryOnHttpStatuses: [],
} as const;
const PACING_POLICY = { key: 'cfbd', minIntervalMs: 150 } as const;

export type TeamRecordsRefreshReason =
  | 'automation-paused-or-disabled'
  | 'settings-unavailable'
  | 'cache-read-failed'
  | 'fresh-cache'
  | 'refresh-in-progress'
  | `quota-${QuotaRefusalReason}`
  | 'cfbd-api-key-missing'
  | 'provider-fetch-failed'
  | 'invalid-payload'
  | 'schema-drift'
  | 'empty-response'
  | 'empty-replacement-rejected'
  | 'stale-observation'
  | 'unchanged-clean'
  | 'written-clean'
  | 'durable-commit-failed'
  | 'unexpected-error';

export type TeamRecordsRefreshResult = {
  reason: TeamRecordsRefreshReason;
  providerCallAttempted: boolean;
  rowsReceived: number;
  rowsCommitted: number;
  quotaRemaining?: number | null;
};

export type TeamRecordsProviderGateResult =
  | { kind: 'allowed' }
  | {
      kind: 'refused';
      reason: `quota-${QuotaRefusalReason}`;
      remaining: number | null;
    };

function isRefreshDue(params: {
  prior: TeamRecordsCacheEntry | null;
  now: number;
  finalizationObserved: boolean;
}): boolean {
  const { prior, now, finalizationObserved } = params;
  if (!prior) return true;
  const ageMs = now - prior.at;
  return (
    ageMs >= TEAM_RECORDS_MAX_REFRESH_INTERVAL_MS ||
    (finalizationObserved && ageMs >= TEAM_RECORDS_MIN_REFRESH_INTERVAL_MS)
  );
}

function result(
  reason: TeamRecordsRefreshReason,
  extras: Partial<Omit<TeamRecordsRefreshResult, 'reason'>> = {}
): TeamRecordsRefreshResult {
  return {
    reason,
    providerCallAttempted: false,
    rowsReceived: 0,
    rowsCommitted: 0,
    ...extras,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

type RecordsLease = { token: string; expiresAt: string };
type RecordsControl = {
  lease: RecordsLease | null;
  lastProviderCallAt: number | null;
};

function normalizeLease(value: unknown): RecordsLease | null {
  if (!isPlainObject(value)) return null;
  if (typeof value.token !== 'string' || value.token.length === 0) return null;
  if (typeof value.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.expiresAt))) {
    return null;
  }
  return { token: value.token, expiresAt: value.expiresAt };
}

function normalizeControl(value: unknown): RecordsControl {
  if (!isPlainObject(value)) return { lease: null, lastProviderCallAt: null };
  const lastProviderCallAt =
    typeof value.lastProviderCallAt === 'number' &&
    Number.isFinite(value.lastProviderCallAt) &&
    value.lastProviderCallAt >= 0
      ? value.lastProviderCallAt
      : null;
  return { lease: normalizeLease(value.lease), lastProviderCallAt };
}

async function acquireLease(
  year: number,
  now: number
): Promise<
  | { acquired: true; token: string }
  | { acquired: false; reason: 'fresh-cache' | 'refresh-in-progress' | 'store-unavailable' }
> {
  const token = randomUUID();
  try {
    return await withAppStateKeyTransaction(
      TEAM_RECORDS_REFRESH_CONTROL_SCOPE,
      String(year),
      async (txn) => {
        const value = (await txn.read<unknown>())?.value;
        const control = normalizeControl(value);
        if (control.lease && now < Date.parse(control.lease.expiresAt)) {
          return { acquired: false as const, reason: 'refresh-in-progress' as const };
        }
        if (
          control.lastProviderCallAt !== null &&
          now - control.lastProviderCallAt < TEAM_RECORDS_MIN_REFRESH_INTERVAL_MS
        ) {
          return { acquired: false as const, reason: 'fresh-cache' as const };
        }
        await txn.write<RecordsControl>({
          lease: { token, expiresAt: new Date(now + TEAM_RECORDS_LEASE_DURATION_MS).toISOString() },
          lastProviderCallAt: control.lastProviderCallAt,
        });
        return { acquired: true as const, token };
      }
    );
  } catch {
    return { acquired: false, reason: 'store-unavailable' };
  }
}

/**
 * Persist the cadence observation immediately before provider I/O. The lease
 * makes this token-safe; a failed write refuses the call, so no billed request
 * can escape the durable six-hour floor.
 */
async function markProviderCallStarted(
  year: number,
  token: string,
  clock: () => number
): Promise<number | null> {
  try {
    return await withAppStateKeyTransaction(
      TEAM_RECORDS_REFRESH_CONTROL_SCOPE,
      String(year),
      async (txn) => {
        const control = normalizeControl((await txn.read<unknown>())?.value);
        if (!control.lease || control.lease.token !== token) return null;
        const now = clock();
        if (now >= Date.parse(control.lease.expiresAt)) return null;
        await txn.write<RecordsControl>({
          lease: {
            token,
            expiresAt: new Date(now + TEAM_RECORDS_LEASE_DURATION_MS).toISOString(),
          },
          lastProviderCallAt: now,
        });
        return now;
      }
    );
  } catch {
    return null;
  }
}

async function releaseLease(year: number, token: string): Promise<void> {
  try {
    await withAppStateKeyTransaction(
      TEAM_RECORDS_REFRESH_CONTROL_SCOPE,
      String(year),
      async (txn) => {
        const control = normalizeControl((await txn.read<unknown>())?.value);
        if (!control.lease || control.lease.token !== token) return;
        await txn.write<RecordsControl>({
          lease: null,
          lastProviderCallAt: control.lastProviderCallAt,
        });
      }
    );
  } catch {
    // Best effort; expiry prevents a crashed or unacknowledged release from wedging refreshes.
  }
}

type CommitOutcome =
  | {
      kind: 'written-clean';
      entry: TeamRecordsCacheEntry;
      committedAt: string;
      commitSeq: number;
    }
  | {
      kind: 'unchanged-clean';
      entry: TeamRecordsCacheEntry;
      committedAt: string;
      commitSeq: number;
    }
  | { kind: 'empty-response' }
  | { kind: 'empty-replacement-rejected' }
  | { kind: 'stale-observation' }
  | { kind: 'store-unavailable' };

async function commitTeamRecords(params: {
  year: number;
  observedAt: number;
  items: TeamRecordItem[];
}): Promise<CommitOutcome> {
  const { year, observedAt, items } = params;
  try {
    const outcome = await withAppStateKeyTransaction(
      TEAM_RECORDS_STATE_SCOPE,
      String(year),
      async (txn) => {
        const prior = normalizeTeamRecordsCacheEntry((await txn.read<unknown>())?.value, year);
        if (prior && prior.at >= observedAt) return { kind: 'stale-observation' as const };
        if (items.length === 0) {
          return prior && prior.items.length > 0
            ? { kind: 'empty-replacement-rejected' as const }
            : { kind: 'empty-response' as const };
        }
        if (prior && JSON.stringify(prior.items) === JSON.stringify(items)) {
          const entry = { at: observedAt, year, items: prior.items };
          await txn.write<TeamRecordsCacheEntry>(entry);
          return { kind: 'unchanged-clean' as const, entry };
        }
        const entry = { at: observedAt, year, items };
        await txn.write<TeamRecordsCacheEntry>(entry);
        return { kind: 'written-clean' as const, entry };
      }
    );
    if (outcome.kind === 'written-clean' || outcome.kind === 'unchanged-clean') {
      return {
        ...outcome,
        committedAt: new Date().toISOString(),
        commitSeq: nextProviderCommitSeq(),
      };
    }
    return outcome;
  } catch {
    return { kind: 'store-unavailable' };
  }
}

/**
 * Refresh one explicitly requested year. The production caller owns the
 * finalisation trigger; this authority deliberately has no canonical-schedule,
 * active-season, or season-registry dependency, so a completed prior season can
 * be repaired directly. Records failure remains isolated in its own provider-
 * refresh status row.
 */
export async function refreshTeamRecords(params: {
  year: number;
  /**
   * The existing live-scores call is itself the finalisation observation and
   * intentionally omits this field. Clock-driven callers must pass `false`.
   */
  finalizationObserved?: boolean;
  /**
   * Optional caller-owned quota gate, invoked only after this authority proves a
   * refresh is due, acquires the lease, opens the scoped attempt, and validates
   * the provider credential. The live-scores caller already paid its quota gate;
   * the hourly job supplies this hook so provider-free skips never probe quota.
   */
  beforeProviderCall?: () => Promise<TeamRecordsProviderGateResult>;
  /** Test-only clock seam; production always reads wall time at each decision point. */
  clock?: () => number;
}): Promise<TeamRecordsRefreshResult> {
  const { year, finalizationObserved = true, beforeProviderCall, clock = Date.now } = params;
  const now = clock();

  try {
    if (!(await isAutoRefreshAllowed('records'))) {
      return result('automation-paused-or-disabled');
    }
  } catch {
    return result('settings-unavailable');
  }

  let prior: TeamRecordsCacheEntry | null;
  try {
    prior = await readTeamRecordsCache(year);
  } catch {
    return result('cache-read-failed');
  }
  if (!isRefreshDue({ prior, now, finalizationObserved })) {
    return result('fresh-cache');
  }

  const lease = await acquireLease(year, now);
  if (!lease.acquired) {
    return result(lease.reason === 'store-unavailable' ? 'durable-commit-failed' : lease.reason);
  }

  const scope = yearScope(year);
  let attempt: ProviderRefreshAttempt | null = null;
  let attemptResolved = false;
  let providerCallAttempted = false;
  const startedAt = Date.now();
  try {
    // Close the freshness-read → lease-acquisition race before spending a call.
    try {
      prior = await readTeamRecordsCache(year);
    } catch {
      return result('cache-read-failed');
    }
    if (!isRefreshDue({ prior, now, finalizationObserved })) {
      return result('fresh-cache');
    }

    attempt = await beginProviderRefreshAttempt('records', scope, {
      startedAt: new Date(now).toISOString(),
    });

    const apiKey = process.env.CFBD_API_KEY?.trim() ?? '';
    if (!apiKey) {
      await recordProviderRefreshFailure('records', scope, {
        attempt,
        error: 'CFBD_API_KEY missing',
        code: 'records-cfbd-api-key-missing',
        status: 503,
        durationMs: Date.now() - startedAt,
      });
      attemptResolved = true;
      return result('cfbd-api-key-missing');
    }

    if (beforeProviderCall) {
      let gate: TeamRecordsProviderGateResult;
      try {
        gate = await beforeProviderCall();
      } catch {
        gate = { kind: 'refused', reason: 'quota-usage-unavailable', remaining: null };
      }
      if (gate.kind === 'refused') {
        await recordProviderRefreshFailure('records', scope, {
          attempt,
          error: `records ${year}: ${gate.reason}`,
          code: `records-${gate.reason}`,
          status: 429,
          durationMs: Date.now() - startedAt,
        });
        attemptResolved = true;
        return result(gate.reason, { quotaRemaining: gate.remaining });
      }
    }

    // Read the wall clock HERE, after settings/cache/status work and immediately
    // before the durable cadence claim that precedes provider I/O. Anchoring the
    // six-hour floor to the cron's route-entry time would shorten it by however
    // long the score request and merge took.
    const providerCallAt = await markProviderCallStarted(year, lease.token, clock);
    if (providerCallAt === null) {
      await recordProviderRefreshFailure('records', scope, {
        attempt,
        error: `records ${year}: cadence-control write failed`,
        code: 'records-durable-commit-failed',
        status: 500,
        durationMs: Date.now() - startedAt,
      });
      attemptResolved = true;
      return result('durable-commit-failed');
    }

    providerCallAttempted = true;
    let payload: unknown;
    try {
      payload = await fetchUpstreamJson<unknown>(buildCfbdRecordsUrl({ year }).toString(), {
        cache: 'no-store',
        timeoutMs: CFBD_PEAK_LATENCY_TIMEOUT_MS,
        headers: { Authorization: `Bearer ${apiKey}` },
        retry: RETRY_POLICY,
        pacing: PACING_POLICY,
      });
    } catch (error) {
      await recordProviderRefreshFailure('records', scope, {
        attempt,
        error: error instanceof UpstreamFetchError ? error.details.message : 'records fetch failed',
        code: 'records-provider-fetch-failed',
        status: error instanceof UpstreamFetchError ? (error.details.status ?? 502) : 502,
        durationMs: Date.now() - startedAt,
      });
      attemptResolved = true;
      return result('provider-fetch-failed', { providerCallAttempted });
    }

    const normalized = normalizeTeamRecordsPayload(payload, year);
    if (normalized.kind !== 'rows') {
      const reason = normalized.kind;
      await recordProviderRefreshFailure('records', scope, {
        attempt,
        error:
          reason === 'invalid-payload'
            ? `records ${year}: provider returned a non-array payload`
            : `records ${year}: nonempty payload normalized to zero usable rows`,
        code: `records-${reason}`,
        status: 502,
        durationMs: Date.now() - startedAt,
      });
      attemptResolved = true;
      return result(reason, { providerCallAttempted });
    }

    const rowsReceived = normalized.items.length;
    const commit = await commitTeamRecords({
      year,
      observedAt: providerCallAt,
      items: normalized.items,
    });
    if (commit.kind === 'stale-observation' || commit.kind === 'empty-response') {
      await recordProviderRefreshNoop('records', scope, {
        attempt,
        source: 'cfbd',
        durationMs: Date.now() - startedAt,
      });
      attemptResolved = true;
      return result(commit.kind, { providerCallAttempted, rowsReceived });
    }
    if (commit.kind === 'empty-replacement-rejected' || commit.kind === 'store-unavailable') {
      const reason =
        commit.kind === 'store-unavailable'
          ? 'durable-commit-failed'
          : 'empty-replacement-rejected';
      await recordProviderRefreshFailure('records', scope, {
        attempt,
        error:
          reason === 'durable-commit-failed'
            ? `records ${year}: durable commit failed`
            : `records ${year}: zero-row response rejected over populated prior-good cache`,
        code: `records-${reason}`,
        status: reason === 'durable-commit-failed' ? 500 : 502,
        durationMs: Date.now() - startedAt,
      });
      attemptResolved = true;
      return result(reason, { providerCallAttempted, rowsReceived });
    }

    const rowsCommitted = commit.kind === 'written-clean' ? commit.entry.items.length : 0;
    await recordProviderRefreshSuccess('records', scope, {
      attempt,
      committedAt: commit.committedAt,
      commitSeq: commit.commitSeq,
      source: 'cfbd',
      rowsCommitted,
      durationMs: Date.now() - startedAt,
    });
    attemptResolved = true;
    return result(commit.kind, { providerCallAttempted, rowsReceived, rowsCommitted });
  } catch {
    if (attempt && !attemptResolved) {
      await recordProviderRefreshFailure('records', scope, {
        attempt,
        error: `records ${year}: unexpected refresh error`,
        code: 'records-unexpected-error',
        status: 500,
        durationMs: Date.now() - startedAt,
      });
    }
    return result('unexpected-error', { providerCallAttempted });
  } finally {
    await releaseLease(year, lease.token);
  }
}

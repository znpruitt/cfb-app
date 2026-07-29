/**
 * PLATFORM-086E1A — the ONE shared full-season schedule refresh authority.
 *
 * Every production full-season schedule writer drives THIS module: the authorized
 * full-year `/api/schedule?bypassCache=1` refresh, the season-transition cron, and
 * the historical schedule repair (and, later, the PLATFORM-086E1B weekly caller).
 * It owns the complete lifecycle for one year — durable prior-state health check,
 * the year-scoped refresh lease, the provider-refresh attempt, credential
 * validation, the regular+postseason fetch, the complete-before-commit gate, the
 * observation-ordered durable commit, process-cache publication, standings
 * invalidation, provider-status resolution, and token-checked lease release — and
 * returns a typed {@link FullSeasonScheduleRefreshResult}. Callers read outcome
 * truth from that value; none of them refetches the provider or re-derives the
 * commit.
 *
 * It NEVER publishes a partial aggregate: any uncertain required partition rejects
 * the whole year and retains prior-good durable schedule. It NEVER contacts the
 * provider on the lease-losing path. It records provider-refresh success ONLY after
 * a confirmed durable commit.
 *
 * This slice stays dormant: it adds no scheduled traffic and is invoked only by the
 * three already-authorized callers migrated onto it in E1A.
 */

import { CacheEntry, SCHEDULE_ROUTE_CACHE } from '@/app/api/schedule/cache';

import { fetchUpstreamJson } from '../api/fetchUpstream.ts';
import { buildCfbdGamesUrl } from '../cfbd.ts';
import { getLeagues } from '../leagueRegistry.ts';
import { yearScope } from '../providerRefreshScope.ts';
import { invalidateStandings } from '../selectors/leagueStandings.ts';
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
  mapCfbdScheduleGame,
  type CfbdScheduleGame,
  type ScheduleItem,
  type SeasonType,
} from './cfbdSchedule.ts';
import {
  fullSeasonScheduleRefreshResult,
  type FullSeasonScheduleRefreshResult,
} from './fullSeasonScheduleRefreshResult.ts';
import {
  acquireScheduleRefreshLease,
  releaseScheduleRefreshLease,
} from './scheduleRefreshLease.ts';

/** Bounded provider retry — mirrors the `/api/schedule` route policy verbatim. */
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

/** A full-season refresh always covers BOTH partitions; both are required. */
const FULL_SEASON_SEASON_TYPES: readonly SeasonType[] = ['regular', 'postseason'];

function scheduleKey(year: number): string {
  return `${year}-all-all`;
}

function sortScheduleItems(items: ScheduleItem[]): ScheduleItem[] {
  return [...items].sort(
    (a, b) => a.week - b.week || (a.startDate ?? '').localeCompare(b.startDate ?? '')
  );
}

/** A stored value is a usable prior entry only when it carries a real items array. */
function normalizePriorEntry(value: unknown): CacheEntry | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<CacheEntry>;
  if (!Array.isArray(candidate.items)) return null;
  if (typeof candidate.at !== 'number' || !Number.isFinite(candidate.at)) return null;
  return {
    at: candidate.at,
    items: candidate.items,
    partialFailure: Boolean(candidate.partialFailure),
    failedSeasonTypes: Array.isArray(candidate.failedSeasonTypes)
      ? candidate.failedSeasonTypes
      : [],
  };
}

type PartitionFetchOutcome =
  | { kind: 'rows'; seasonType: SeasonType; items: ScheduleItem[] }
  | { kind: 'fetch-failed'; seasonType: SeasonType }
  | { kind: 'invalid-payload'; seasonType: SeasonType }
  | { kind: 'schema-drift'; seasonType: SeasonType };

/**
 * Fetch and normalize ONE full-year partition, applying the shared
 * complete-before-commit classification: a thrown request is `fetch-failed`, a
 * non-array payload is `invalid-payload`, a nonempty payload normalizing to zero
 * usable rows is `schema-drift`, and an EXACT empty array is valid absence (`rows`
 * with `items: []`). Reuses the route's URL construction, retry, pacing, and
 * `mapCfbdScheduleGame` normalization verbatim.
 */
async function fetchPartition(params: {
  year: number;
  seasonType: SeasonType;
  apiKey: string;
}): Promise<PartitionFetchOutcome> {
  const { year, seasonType, apiKey } = params;
  const url = buildCfbdGamesUrl({ year, seasonType, week: null });

  let upstream: CfbdScheduleGame[];
  try {
    upstream = await fetchUpstreamJson<CfbdScheduleGame[]>(url.toString(), {
      cache: 'no-store',
      timeoutMs: 12_000,
      headers: { Authorization: `Bearer ${apiKey}` },
      retry: CFBD_RETRY_POLICY,
      pacing: CFBD_PACING_POLICY,
    });
  } catch {
    return { kind: 'fetch-failed', seasonType };
  }

  // A non-array payload is uncertainty (schema drift / shape change), NOT valid
  // absence — reject so prior-good is never overwritten with an unusable payload.
  if (!Array.isArray(upstream)) {
    return { kind: 'invalid-payload', seasonType };
  }

  const items: ScheduleItem[] = [];
  for (const game of upstream) {
    const mapped = mapCfbdScheduleGame(game, seasonType);
    if (mapped.ok) items.push(mapped.item);
  }

  // A NONEMPTY provider payload that normalizes to ZERO rows is schema drift
  // (field renames / shape change), not valid absence.
  if (upstream.length > 0 && items.length === 0) {
    return { kind: 'schema-drift', seasonType };
  }

  // `items: []` from an exact empty upstream array is legitimate absence for this
  // partition (postseason before bowls, a future season not yet published).
  return { kind: 'rows', seasonType, items };
}

type CommitOutcome =
  | { kind: 'written-clean'; entry: CacheEntry; committedAt: string; commitSeq: number }
  | { kind: 'unchanged-clean'; entry: CacheEntry; committedAt: string; commitSeq: number }
  | { kind: 'empty-response' }
  | { kind: 'empty-replacement-rejected' }
  | { kind: 'stale-observation'; entry: CacheEntry | null }
  | { kind: 'store-unavailable' };

/**
 * Commit a complete full-season result on `schedule/<year>-all-all` inside one
 * advisory-locked transaction. Re-reads the prior entry transaction-fresh and:
 *   - preserves prior-good when its observation is newer than or equal to
 *     `observedAtMs` (`stale-observation`, nothing written);
 *   - for an all-empty result, rejects an empty replacement of populated prior-good
 *     (`empty-replacement-rejected`) or records a genuine absence (`empty-response`)
 *     — neither writes;
 *   - for a newer nonempty result, writes exactly once: `unchanged-clean` bumps
 *     only the observation metadata when item CONTENT is unchanged; `written-clean`
 *     replaces the season's items when content changed.
 * The process cache publishes ONLY after a confirmed write. A transaction failure
 * leaves the durable key at prior-good and returns `store-unavailable`.
 */
async function commitFullSeasonSchedule(params: {
  year: number;
  observedAtMs: number;
  items: ScheduleItem[];
}): Promise<CommitOutcome> {
  const { year, observedAtMs, items } = params;
  const key = scheduleKey(year);

  let outcome:
    | { kind: 'written-clean'; entry: CacheEntry }
    | { kind: 'unchanged-clean'; entry: CacheEntry }
    | { kind: 'empty-response' }
    | { kind: 'empty-replacement-rejected' }
    | { kind: 'stale-observation'; entry: CacheEntry | null };
  try {
    outcome = await withAppStateKeyTransaction(
      'schedule',
      key,
      async (txn): Promise<typeof outcome> => {
        const prior = normalizePriorEntry((await txn.read<CacheEntry>())?.value);

        // Observation ordering: a prior entry observed at/after this refresh wins —
        // never overwrite newer durable state with a stale observation.
        if (prior && prior.at >= observedAtMs) {
          return { kind: 'stale-observation', entry: prior };
        }

        if (items.length === 0) {
          // All-empty. Reject an empty replacement of populated prior-good; a
          // genuinely unpublished/inapplicable absence is a no-op. Neither writes.
          return prior && prior.items.length > 0
            ? { kind: 'empty-replacement-rejected' }
            : { kind: 'empty-response' };
        }

        const nextEntry: CacheEntry = {
          at: observedAtMs,
          items,
          partialFailure: false,
          failedSeasonTypes: [],
        };

        // Unchanged content → commit ONLY the newer observation metadata (bump
        // `at`, same items), so standings are not needlessly invalidated.
        if (prior && JSON.stringify(prior.items) === JSON.stringify(items)) {
          const metadataOnly: CacheEntry = { ...nextEntry, items: prior.items };
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

  // No write happened for these — nothing to publish.
  if (outcome.kind === 'empty-response' || outcome.kind === 'empty-replacement-rejected') {
    return outcome;
  }

  if (outcome.kind === 'stale-observation') {
    // A stale refresh committed nothing, but the transaction-fresh durable entry it
    // read is NEWER than our observation. Forward it into the process cache ONLY when
    // it is newer than the local entry, so a subsequent ordinary request on this
    // instance cannot keep serving an OLDER process-cached schedule until TTL — while
    // never regressing below a possibly-fresher local entry, recording a success, or
    // invalidating standings (PLATFORM-086E1A finding 3).
    const local = SCHEDULE_ROUTE_CACHE[scheduleKey(year)];
    if (outcome.entry && (!local || outcome.entry.at > local.at)) {
      SCHEDULE_ROUTE_CACHE[scheduleKey(year)] = outcome.entry;
    }
    return outcome;
  }

  // Capture commit ordering immediately after the confirmed transaction, then
  // publish the process cache — never before durable success.
  const committedAt = new Date().toISOString();
  const commitSeq = nextProviderCommitSeq();
  SCHEDULE_ROUTE_CACHE[scheduleKey(year)] = outcome.entry;
  return { ...outcome, committedAt, commitSeq };
}

/** Invalidate canonical standings for every league at `year` (non-fatal). */
async function invalidateStandingsForYear(year: number): Promise<void> {
  try {
    const leagues = await getLeagues();
    for (const league of leagues) {
      invalidateStandings(league.slug, year);
    }
  } catch {
    // Non-fatal — the schedule commit already succeeded; canonical standings
    // refresh on the next mutation or natural cache turnover.
  }
}

/**
 * Refresh the full-season schedule for ONE year through the shared authority.
 * Optional `now` (epoch ms) fixes the observation instant for deterministic tests;
 * production omits it. Never throws for a provider/payload/commit fault — only a
 * genuine programming defect surfaces as `unexpected-error`.
 */
export async function refreshFullSeasonSchedule(params: {
  year: number;
  now?: number;
}): Promise<FullSeasonScheduleRefreshResult> {
  const { year } = params;
  const now = params.now ?? Date.now();
  const attemptedSeasonTypes = [...FULL_SEASON_SEASON_TYPES];

  // Step 1 — fail fast if the prior durable schedule state cannot be read. A read
  // outage means we cannot safely classify empty responses or order observations,
  // so we refuse BEFORE taking the lease or contacting the provider.
  try {
    await getAppState<CacheEntry>('schedule', scheduleKey(year));
  } catch {
    return fullSeasonScheduleRefreshResult({
      reason: 'canonical-context-unavailable',
      requestedYear: year,
    });
  }

  // Step 2 — acquire the year-scoped lease. A nonexpired lease → `in-progress` with
  // no provider request and no attempt; a lease-store outage is a truthful failure.
  const lease = await acquireScheduleRefreshLease({ year, now });
  if (!lease.acquired) {
    return lease.reason === 'refresh-in-progress'
      ? fullSeasonScheduleRefreshResult({ reason: 'refresh-in-progress', requestedYear: year })
      : fullSeasonScheduleRefreshResult({
          reason: 'durable-commit-failed',
          requestedYear: year,
          httpStatusOverride: 503,
        });
  }
  const token = lease.token;
  const scope = yearScope(year);

  let attempt: ProviderRefreshAttempt | null = null;
  let attemptResolved = false;
  // Instrumentation (PLATFORM-086E1B): flips true immediately before the
  // regular/postseason provider-fetch pair starts, and stays true through every
  // later transport/payload/completeness/commit outcome. Pre-provider exits
  // (context read failure, lease refusal, missing credentials) leave it false.
  let providerCallAttempted = false;
  try {
    // Step 3 — begin the year-scoped attempt BEFORE credential validation, so a
    // missing key still begins and resolves the exact year attempt.
    attempt = await beginProviderRefreshAttempt('schedule', scope, {
      startedAt: new Date(now).toISOString(),
    });

    // Step 4 — credential validation.
    const apiKey = process.env.CFBD_API_KEY?.trim() ?? '';
    if (!apiKey) {
      await recordProviderRefreshFailure('schedule', scope, {
        attempt,
        error: 'CFBD_API_KEY missing',
        code: 'schedule-cfbd-api-key-missing',
        status: 503,
        durationMs: Date.now() - now,
      });
      attemptResolved = true;
      return fullSeasonScheduleRefreshResult({
        reason: 'cfbd-api-key-missing',
        requestedYear: year,
        attemptedSeasonTypes,
      });
    }

    // Step 4/5 — one observation instant captured immediately before provider work.
    const observedAtMs = now;
    const observedAt = new Date(observedAtMs).toISOString();

    // Step 5-7 — fetch both partitions with bounded concurrency (the shared CFBD
    // pacing key still serializes the two requests) and apply the completeness gate.
    providerCallAttempted = true;
    const outcomes = await Promise.all(
      FULL_SEASON_SEASON_TYPES.map((seasonType) => fetchPartition({ year, seasonType, apiKey }))
    );
    // Usable rows received across the FULFILLED partitions — counted before the
    // completeness gate so a partition failure still reports the true received
    // count (a regular partition that fetched 100 games alongside a failed
    // postseason must not report `rowsReceived: 0` — cycle-1 review finding 3).
    // Nothing is COMMITTED from a rejected aggregate regardless.
    const rowsReceived = outcomes.reduce(
      (total, o) => total + (o.kind === 'rows' ? o.items.length : 0),
      0
    );
    const uncertainOutcomes = outcomes.filter(
      (o): o is Exclude<PartitionFetchOutcome, { kind: 'rows' }> => o.kind !== 'rows'
    );
    if (uncertainOutcomes.length > 0) {
      // Reason is taken from the FIRST uncertain partition (regular before
      // postseason); `failedSeasonTypes` reports EVERY uncertain partition so the
      // caller sees the full failure set. Any uncertain required partition rejects
      // the aggregate — a partial is never published.
      const first = uncertainOutcomes[0]!;
      const reason =
        first.kind === 'fetch-failed'
          ? ('partition-fetch-failed' as const)
          : first.kind === 'invalid-payload'
            ? ('partition-invalid-payload' as const)
            : ('partition-schema-drift' as const);
      const failedSeasonTypes = uncertainOutcomes.map((o) => o.seasonType);
      await recordProviderRefreshFailure('schedule', scope, {
        attempt,
        error: `schedule ${year}: ${failedSeasonTypes.join(', ')} partition ${reason}`,
        code: `schedule-${reason}`,
        status: 502,
        partialFailure: true,
        failedPartitions: failedSeasonTypes,
        durationMs: Date.now() - now,
      });
      attemptResolved = true;
      return fullSeasonScheduleRefreshResult({
        reason,
        requestedYear: year,
        attemptedSeasonTypes,
        failedSeasonTypes,
        rowsReceived,
        providerCallAttempted,
        observedAt,
      });
    }

    const items = sortScheduleItems(outcomes.flatMap((o) => (o.kind === 'rows' ? o.items : [])));

    const commit = await commitFullSeasonSchedule({ year, observedAtMs, items });

    switch (commit.kind) {
      case 'stale-observation': {
        await recordProviderRefreshNoop('schedule', scope, {
          attempt,
          source: 'cfbd',
          durationMs: Date.now() - now,
        });
        attemptResolved = true;
        return fullSeasonScheduleRefreshResult({
          reason: 'stale-observation',
          requestedYear: year,
          attemptedSeasonTypes,
          rowsReceived,
          providerCallAttempted,
          observedAt,
          items: commit.entry?.items ?? [],
          entry: commit.entry,
        });
      }
      case 'empty-response': {
        await recordProviderRefreshNoop('schedule', scope, {
          attempt,
          source: 'cfbd',
          durationMs: Date.now() - now,
        });
        attemptResolved = true;
        return fullSeasonScheduleRefreshResult({
          reason: 'empty-response',
          requestedYear: year,
          attemptedSeasonTypes,
          rowsReceived,
          providerCallAttempted,
          observedAt,
        });
      }
      case 'empty-replacement-rejected': {
        await recordProviderRefreshFailure('schedule', scope, {
          attempt,
          error: `schedule ${year}: provider returned zero games while a populated schedule is cached — rejected as an unexpected empty replacement`,
          code: 'schedule-empty-replacement-rejected',
          status: 502,
          durationMs: Date.now() - now,
        });
        attemptResolved = true;
        return fullSeasonScheduleRefreshResult({
          reason: 'empty-replacement-rejected',
          requestedYear: year,
          attemptedSeasonTypes,
          rowsReceived,
          providerCallAttempted,
          observedAt,
        });
      }
      case 'store-unavailable': {
        await recordProviderRefreshFailure('schedule', scope, {
          attempt,
          error: `schedule ${year}: durable commit failed`,
          code: 'schedule-durable-commit-failed',
          status: 500,
          durationMs: Date.now() - now,
        });
        attemptResolved = true;
        return fullSeasonScheduleRefreshResult({
          reason: 'durable-commit-failed',
          requestedYear: year,
          attemptedSeasonTypes,
          rowsReceived,
          providerCallAttempted,
          observedAt,
        });
      }
      case 'unchanged-clean': {
        // Post-commit order: durable commit → process-cache publication (done in
        // commit) → NO standings invalidation (content unchanged) → status.
        await recordProviderRefreshSuccess('schedule', scope, {
          attempt,
          committedAt: commit.committedAt,
          commitSeq: commit.commitSeq,
          source: 'cfbd',
          rowsCommitted: 0,
          durationMs: Date.now() - now,
        });
        attemptResolved = true;
        return fullSeasonScheduleRefreshResult({
          reason: 'unchanged-clean',
          requestedYear: year,
          attemptedSeasonTypes,
          rowsReceived,
          providerCallAttempted,
          rowsCommitted: 0,
          dataChanged: false,
          observedAt,
          committedAt: commit.committedAt,
          items: commit.entry.items,
          entry: commit.entry,
        });
      }
      case 'written-clean': {
        // Post-commit order: durable commit → process-cache publication (done in
        // commit) → standings invalidation (content changed) → status.
        await invalidateStandingsForYear(year);
        await recordProviderRefreshSuccess('schedule', scope, {
          attempt,
          committedAt: commit.committedAt,
          commitSeq: commit.commitSeq,
          source: 'cfbd',
          rowsCommitted: commit.entry.items.length,
          durationMs: Date.now() - now,
        });
        attemptResolved = true;
        return fullSeasonScheduleRefreshResult({
          reason: 'written-clean',
          requestedYear: year,
          attemptedSeasonTypes,
          rowsReceived,
          providerCallAttempted,
          rowsCommitted: commit.entry.items.length,
          dataChanged: true,
          observedAt,
          committedAt: commit.committedAt,
          items: commit.entry.items,
          entry: commit.entry,
        });
      }
    }
    // Exhaustive switch above; this is unreachable.
    return fullSeasonScheduleRefreshResult({ reason: 'unexpected-error', requestedYear: year });
  } catch {
    // Defensive: a genuine programming defect. Resolve any open attempt so it never
    // dangles `in-progress`, then surface the failure.
    if (attempt && !attemptResolved) {
      await recordProviderRefreshFailure('schedule', scope, {
        attempt,
        error: `schedule ${year}: unexpected refresh error`,
        code: 'schedule-unexpected-error',
        status: 500,
        durationMs: Date.now() - now,
      });
    }
    return fullSeasonScheduleRefreshResult({
      reason: 'unexpected-error',
      requestedYear: year,
      attemptedSeasonTypes,
      providerCallAttempted,
    });
  } finally {
    // Released on EVERY outcome; token-checked so a reclaimed lease is untouched.
    await releaseScheduleRefreshLease({ year, token });
  }
}

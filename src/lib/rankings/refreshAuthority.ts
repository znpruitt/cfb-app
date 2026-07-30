/**
 * PLATFORM-086E2A — the ONE shared season rankings refresh authority.
 *
 * Every rankings writer drives THIS module: the authorized manual
 * `/api/rankings?bypassCache=1` refresh today, and the PLATFORM-086E2B
 * publication-aware automatic caller later. It owns the complete lifecycle for
 * one season — the year-scoped refresh lease, the provider-refresh attempt, the
 * forced durable prior-state read, credential validation, the regular+postseason
 * fetch pair, independent partition validation, the prior-relative completeness
 * gate, the observation-ordered durable commit, post-commit process-memo
 * publication, provider-status resolution, and token-checked lease release — and
 * returns a typed {@link RankingsRefreshResult}. Callers read outcome truth from
 * that value; none of them refetches the provider or re-derives the commit.
 *
 * It NEVER publishes a partial regular/postseason aggregate: any uncertain or
 * prior-coverage-losing partition rejects the whole year and retains prior-good
 * durable rankings. It NEVER contacts the provider on the lease-losing path. It
 * records provider-refresh success ONLY after a confirmed durable commit.
 *
 * E2A stays operationally dormant: no scheduled caller exists; the only
 * production invoker is the already-authorized manual route.
 */

import teamsCatalog from '../../data/teams.json';
import { fetchUpstreamJson } from '../api/fetchUpstream.ts';
import { buildCfbdRankingsUrl } from '../cfbd.ts';
import { yearScope } from '../providerRefreshScope.ts';
import type { RankingsResponse, RankingsWeek } from '../rankings.ts';
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
  classifyRankingsPartition,
  compareRankingsWeeks,
  normalizeCfbdRankingsWeeks,
  normalizeStoredRankingsEntry,
  peekRankingsProcessMemo,
  publishRankingsProcessMemo,
  remapPostseasonWeeks,
  serveRankingsEntry,
  type CfbdPollWeek,
  type RankingsCacheEntry,
} from '../server/rankings.ts';
import { createTeamIdentityResolver, type TeamCatalogItem } from '../teamIdentity.ts';
import { SEED_ALIASES } from '../teamNames.ts';
import { acquireRankingsRefreshLease, releaseRankingsRefreshLease } from './refreshLease.ts';
import {
  rankingsRefreshResult,
  type RankingsRefreshResult,
  type RankingsRefreshTrigger,
  type RankingsSeasonType,
} from './refreshResult.ts';

/** Bounded provider retry — the pre-E2A rankings route policy, verbatim. */
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

/** A season rankings refresh always covers BOTH partitions; both are required. */
const RANKINGS_SEASON_TYPES: readonly RankingsSeasonType[] = ['regular', 'postseason'];

type PartitionFetchOutcome =
  | { kind: 'rows'; seasonType: RankingsSeasonType; weeks: RankingsWeek[] }
  | { kind: 'fetch-failed'; seasonType: RankingsSeasonType }
  | { kind: 'invalid-payload'; seasonType: RankingsSeasonType }
  | { kind: 'schema-drift'; seasonType: RankingsSeasonType };

/**
 * Fetch and normalize ONE rankings partition, validated independently of its
 * sibling: a thrown request is `fetch-failed`, a non-array top-level payload is
 * `invalid-payload`, a nonempty payload normalizing to zero usable weeks is
 * `schema-drift`, and an EXACT empty array is candidate absence (`rows` with
 * `weeks: []`) — whether that absence is acceptable is decided later against
 * transaction-fresh prior state. Reuses the established URL construction, retry,
 * pacing, and centralized team-identity normalization verbatim.
 */
async function fetchPartition(params: {
  year: number;
  seasonType: RankingsSeasonType;
  apiKey: string;
  resolver: ReturnType<typeof createTeamIdentityResolver>;
}): Promise<PartitionFetchOutcome> {
  const { year, seasonType, apiKey, resolver } = params;
  const url = buildCfbdRankingsUrl({ year, seasonType }).toString();

  let upstream: CfbdPollWeek[];
  try {
    upstream = await fetchUpstreamJson<CfbdPollWeek[]>(url, {
      cache: 'no-store',
      timeoutMs: 12_000,
      headers: { Authorization: `Bearer ${apiKey}` },
      retry: CFBD_RETRY_POLICY,
      pacing: CFBD_PACING_POLICY,
    });
  } catch {
    return { kind: 'fetch-failed', seasonType };
  }

  // A non-array top-level payload is uncertainty (shape change), NOT absence —
  // reject so prior-good is never replaced from an unusable payload.
  if (!Array.isArray(upstream)) {
    return { kind: 'invalid-payload', seasonType };
  }

  const weeks = normalizeCfbdRankingsWeeks(upstream, resolver);
  // Cross-year contamination guard (Codex round-1 P2): a week labeled with a
  // DIFFERENT season can never enter this year's aggregate — `usable` means
  // usable FOR THE REQUESTED YEAR. An entirely-mislabeled nonempty payload
  // therefore classifies as schema drift below, and a partially-mislabeled one
  // loses its foreign weeks here and then fails the prior-relative completeness
  // gate if that loss regresses coverage. Never committed as this year's truth.
  const seasonWeeks = weeks.filter((week) => week.season === year);
  const classified = classifyRankingsPartition(seasonType, upstream, seasonWeeks);
  if (classified.kind === 'schema-drift') {
    return { kind: 'schema-drift', seasonType };
  }
  return { kind: 'rows', seasonType, weeks: seasonWeeks };
}

/** Map one canonical week to the partition that produced it. */
function partitionOfWeek(week: RankingsWeek): RankingsSeasonType {
  return week.seasonType === 'postseason' ? 'postseason' : 'regular';
}

const POLL_SOURCES = ['ap', 'coaches', 'cfp'] as const;

/**
 * Prior-relative completeness: the partitions whose prior-good coverage the
 * candidate aggregate would LOSE. A violation is a previously cached week
 * (matched by seasonType+week on the canonical post-remap representation)
 * missing from the candidate, or a previously populated ap/coaches/cfp poll
 * source empty in the matching candidate week. New weeks, new sources, corrected
 * ranks, and changed team membership are allowed — content may change, coverage
 * may only grow.
 */
export function findRankingsCoverageLoss(
  priorWeeks: RankingsWeek[],
  candidateWeeks: RankingsWeek[]
): RankingsSeasonType[] {
  const candidateByKey = new Map<string, RankingsWeek>();
  for (const week of candidateWeeks) {
    candidateByKey.set(`${partitionOfWeek(week)}:${week.week}`, week);
  }

  const violated = new Set<RankingsSeasonType>();
  for (const prior of priorWeeks) {
    const partition = partitionOfWeek(prior);
    const candidate = candidateByKey.get(`${partition}:${prior.week}`);
    if (!candidate) {
      violated.add(partition);
      continue;
    }
    for (const source of POLL_SOURCES) {
      if (
        (prior.polls?.[source] ?? []).length > 0 &&
        (candidate.polls?.[source] ?? []).length === 0
      ) {
        violated.add(partition);
        break;
      }
    }
  }

  return RANKINGS_SEASON_TYPES.filter((partition) => violated.has(partition));
}

/** Prior-good served in place of a rejected refresh — today's stale-marked shape. */
function priorGoodStaleResponse(prior: RankingsCacheEntry): RankingsResponse {
  return {
    ...prior.response,
    meta: { ...prior.response.meta, cache: 'hit', stale: true, rebuildRequired: true },
  };
}

type CommitOutcome =
  | { kind: 'written-clean'; entry: RankingsCacheEntry }
  | { kind: 'unchanged-clean'; entry: RankingsCacheEntry }
  | { kind: 'empty-response' }
  | { kind: 'empty-replacement-rejected'; prior: RankingsCacheEntry }
  | { kind: 'incomplete'; prior: RankingsCacheEntry; failedSeasonTypes: RankingsSeasonType[] }
  | { kind: 'stale-observation'; entry: RankingsCacheEntry }
  | { kind: 'store-unavailable' };

/**
 * Commit a complete season aggregate on `rankings/<year>` inside one
 * advisory-locked transaction. Re-reads the prior entry transaction-fresh and,
 * in order:
 *   1. observation ordering — a prior entry observed at/after `observedAtMs`
 *      wins (`stale-observation`, nothing written);
 *   2. all-empty handling — an empty aggregate over populated prior-good is
 *      rejected (`empty-replacement-rejected`); with no prior-good it is a
 *      genuine absence (`empty-response`) — neither writes;
 *   3. prior-relative completeness — a candidate losing prior weeks or
 *      previously populated poll sources is rejected (`incomplete`), nothing
 *      written;
 *   4. content comparison — identical canonical content commits a metadata-only
 *      freshness bump (`unchanged-clean`); changed content commits the complete
 *      replacement (`written-clean`).
 * A transaction failure leaves the durable key at prior-good and returns
 * `store-unavailable`; the process memo is published only by the caller after a
 * confirmed write.
 */
async function commitSeasonRankings(params: {
  year: number;
  observedAtMs: number;
  weeks: RankingsWeek[];
}): Promise<CommitOutcome> {
  const { year, observedAtMs, weeks } = params;
  const observedAtIso = new Date(observedAtMs).toISOString();

  try {
    return await withAppStateKeyTransaction<CommitOutcome>(
      'rankings',
      String(year),
      async (txn) => {
        const prior = normalizeStoredRankingsEntry((await txn.read<unknown>())?.value);

        // Observation ordering: a prior entry observed at/after this refresh wins —
        // never overwrite newer durable rankings with a stale observation.
        if (prior && prior.at >= observedAtMs) {
          return { kind: 'stale-observation', entry: prior };
        }

        if (weeks.length === 0) {
          return prior && prior.response.weeks.length > 0
            ? { kind: 'empty-replacement-rejected', prior }
            : { kind: 'empty-response' };
        }

        if (prior && prior.response.weeks.length > 0) {
          const failedSeasonTypes = findRankingsCoverageLoss(prior.response.weeks, weeks);
          if (failedSeasonTypes.length > 0) {
            return { kind: 'incomplete', prior, failedSeasonTypes };
          }
        }

        // Canonical content comparison — weeks (and thus derived latestWeek)
        // only; generated/cache metadata never participates.
        if (prior && JSON.stringify(prior.response.weeks) === JSON.stringify(weeks)) {
          const entry: RankingsCacheEntry = {
            at: observedAtMs,
            response: {
              weeks: prior.response.weeks,
              latestWeek: prior.response.latestWeek,
              meta: { source: 'cfbd', cache: 'miss', generatedAt: observedAtIso },
            },
          };
          await txn.write<RankingsCacheEntry>(entry);
          return { kind: 'unchanged-clean', entry };
        }

        const entry: RankingsCacheEntry = {
          at: observedAtMs,
          response: {
            weeks,
            latestWeek: weeks.at(-1) ?? null,
            meta: { source: 'cfbd', cache: 'miss', generatedAt: observedAtIso },
          },
        };
        await txn.write<RankingsCacheEntry>(entry);
        return { kind: 'written-clean', entry };
      }
    );
  } catch {
    // The callback's only fallible operations are the store read/write (the
    // gates are pure), so ANY fault is a truthful durable-commit failure.
    return { kind: 'store-unavailable' };
  }
}

/**
 * Refresh season rankings for ONE year through the shared authority. Optional
 * `now` (epoch ms) fixes the observation instant for deterministic tests;
 * production omits it so acquisition/observation instants are captured fresh at
 * their pipeline stages. Never throws for a provider/payload/commit fault — only
 * a genuine programming defect surfaces as `unexpected-error`.
 */
export async function refreshSeasonRankings(params: {
  year: number;
  trigger: RankingsRefreshTrigger;
  now?: number;
}): Promise<RankingsRefreshResult> {
  const { year, trigger } = params;
  // Populated ONLY when the provider-fetch stage actually begins (alongside
  // `providerCallAttempted`), so a pre-fetch exit — lease refusal, prior-state
  // read failure, missing credentials — never fabricates attempted partitions
  // (external review finding #3).
  let attemptedSeasonTypes: RankingsSeasonType[] = [];

  // Fresh acquisition instant captured immediately before lease acquisition —
  // never at route entry.
  const acquiredAtMs = params.now ?? Date.now();
  const acquiredAtIso = new Date(acquiredAtMs).toISOString();

  // Step 1 — acquire the year-scoped lease. A nonexpired lease → in-progress with
  // no provider request and NO fabricated attempt; a lease-store outage fails
  // closed the same way (no attempt, no provider work).
  const lease = await acquireRankingsRefreshLease({ year, now: acquiredAtMs });
  if (!lease.acquired) {
    return rankingsRefreshResult({
      reason: lease.reason === 'refresh-in-progress' ? 'refresh-in-progress' : 'store-unavailable',
      year,
      trigger,
      observedAt: acquiredAtIso,
    });
  }
  const token = lease.token;
  const scope = yearScope(year);

  let attempt: ProviderRefreshAttempt | null = null;
  let attemptResolved = false;
  let providerCallAttempted = false;
  let observedAtIso = acquiredAtIso;
  try {
    // Step 2 — begin the ONE year-scoped rankings attempt, BEFORE credential
    // validation, so a missing key still resolves the exact year attempt.
    attempt = await beginProviderRefreshAttempt('rankings', scope, {
      startedAt: acquiredAtIso,
    });

    // Step 3 — forced durable prior-state read (never the process memo). A read
    // outage means empty responses and prior coverage cannot be classified
    // safely, so the refresh fails closed before any provider work.
    let priorEntry: RankingsCacheEntry | null = null;
    try {
      priorEntry = normalizeStoredRankingsEntry(
        (await getAppState<unknown>('rankings', String(year)))?.value
      );
    } catch {
      await recordProviderRefreshFailure('rankings', scope, {
        attempt,
        error: `rankings ${year}: prior durable state could not be read`,
        code: 'rankings-store-unavailable',
        durationMs: Date.now() - acquiredAtMs,
      });
      attemptResolved = true;
      return rankingsRefreshResult({
        reason: 'store-unavailable',
        year,
        trigger,
        observedAt: acquiredAtIso,
      });
    }

    // Step 4 — credential validation.
    const cfbdApiKey = process.env.CFBD_API_KEY?.trim() ?? '';
    if (!cfbdApiKey) {
      await recordProviderRefreshFailure('rankings', scope, {
        attempt,
        error: 'CFBD_API_KEY missing',
        code: 'cfbd-api-key-missing',
        durationMs: Date.now() - acquiredAtMs,
      });
      attemptResolved = true;
      return rankingsRefreshResult({
        reason: 'cfbd-api-key-missing',
        year,
        trigger,
        observedAt: acquiredAtIso,
      });
    }

    const resolver = createTeamIdentityResolver({
      aliasMap: SEED_ALIASES,
      teams: (teamsCatalog.items ?? []) as TeamCatalogItem[],
    });

    // Step 5 — one observation instant captured immediately before the request
    // pair; it is also the commit's observation-ordering timestamp.
    const observedAtMs = params.now ?? Date.now();
    observedAtIso = new Date(observedAtMs).toISOString();
    providerCallAttempted = true;
    attemptedSeasonTypes = [...RANKINGS_SEASON_TYPES];
    const outcomes = await Promise.all(
      RANKINGS_SEASON_TYPES.map((seasonType) =>
        fetchPartition({ year, seasonType, apiKey: cfbdApiKey, resolver })
      )
    );

    // Usable weeks received across the array-returning partitions — counted
    // before the aggregate gate so a sibling failure still reports the true
    // received count. Nothing is committed from a rejected aggregate regardless.
    const rowsReceived = outcomes.reduce(
      (total, o) => total + (o.kind === 'rows' ? o.weeks.length : 0),
      0
    );

    // Step 6 — independent partition validation: ANY uncertain partition rejects
    // the whole aggregate (a partial regular/postseason mix is never published).
    const uncertain = outcomes.filter(
      (o): o is Exclude<PartitionFetchOutcome, { kind: 'rows' }> => o.kind !== 'rows'
    );
    if (uncertain.length > 0) {
      // Reason from the FIRST uncertain partition (regular before postseason);
      // `failedSeasonTypes` reports every uncertain partition.
      const first = uncertain[0]!;
      const reason =
        first.kind === 'fetch-failed'
          ? ('provider-fetch-failed' as const)
          : first.kind === 'invalid-payload'
            ? ('invalid-provider-payload' as const)
            : ('rankings-partition-schema-drift' as const);
      const failedSeasonTypes = uncertain.map((o) => o.seasonType);
      await recordProviderRefreshFailure('rankings', scope, {
        attempt,
        error: `rankings ${year}: ${failedSeasonTypes.join(', ')} partition ${reason}`,
        code:
          reason === 'rankings-partition-schema-drift'
            ? 'rankings-partition-schema-drift'
            : `rankings-${reason}`,
        partialFailure: outcomes.some((o) => o.kind === 'rows'),
        failedPartitions: failedSeasonTypes,
        durationMs: Date.now() - acquiredAtMs,
      });
      attemptResolved = true;
      // Schema drift serves retained prior-good (today's behavior); transport
      // and payload failures surface as plain failures with no response.
      const retained =
        reason === 'rankings-partition-schema-drift' && priorEntry ? priorEntry : null;
      return rankingsRefreshResult({
        reason,
        year,
        trigger,
        observedAt: observedAtIso,
        attemptedSeasonTypes,
        failedSeasonTypes,
        providerCallAttempted,
        rowsReceived,
        response: retained ? priorGoodStaleResponse(retained) : null,
        httpStatusOverride:
          reason === 'rankings-partition-schema-drift' && !retained ? 500 : undefined,
      });
    }

    // Step 7 — combine the validated partitions into the canonical aggregate.
    const weeks = remapPostseasonWeeks(
      outcomes.flatMap((o) => (o.kind === 'rows' ? o.weeks : [])).sort(compareRankingsWeeks)
    );

    const commit = await commitSeasonRankings({ year, observedAtMs, weeks });

    switch (commit.kind) {
      case 'stale-observation': {
        await recordProviderRefreshNoop('rankings', scope, {
          attempt,
          source: 'cfbd',
          durationMs: Date.now() - acquiredAtMs,
        });
        attemptResolved = true;
        // Forward the FRESHER committed entry into this instance's memo (never
        // regressing below a possibly-newer local entry), so a subsequent read
        // on this instance cannot keep serving an older memo until TTL.
        const local = peekRankingsProcessMemo(year);
        if (!local || commit.entry.at > local.at) {
          publishRankingsProcessMemo(year, commit.entry);
        }
        return rankingsRefreshResult({
          reason: 'stale-observation',
          year,
          trigger,
          observedAt: observedAtIso,
          attemptedSeasonTypes,
          providerCallAttempted,
          rowsReceived,
          response: serveRankingsEntry(commit.entry, Date.now()),
        });
      }
      case 'empty-response': {
        await recordProviderRefreshNoop('rankings', scope, {
          attempt,
          source: 'cfbd',
          durationMs: Date.now() - acquiredAtMs,
        });
        attemptResolved = true;
        // A CLEAN empty response (no stale markers) so the manual panel reads it
        // as a successful pre-poll no-op, not a fallback.
        return rankingsRefreshResult({
          reason: 'empty-response',
          year,
          trigger,
          observedAt: observedAtIso,
          attemptedSeasonTypes,
          providerCallAttempted,
          rowsReceived,
          response: {
            weeks: [],
            latestWeek: null,
            meta: { source: 'cfbd', cache: 'miss', generatedAt: observedAtIso },
          },
        });
      }
      case 'empty-replacement-rejected': {
        await recordProviderRefreshFailure('rankings', scope, {
          attempt,
          error:
            `rankings ${year}: provider returned zero usable weeks while populated rankings are cached — ` +
            'rejected as an unexpected empty replacement',
          code: 'rankings-empty-replacement-rejected',
          durationMs: Date.now() - acquiredAtMs,
        });
        attemptResolved = true;
        return rankingsRefreshResult({
          reason: 'rankings-empty-replacement-rejected',
          year,
          trigger,
          observedAt: observedAtIso,
          attemptedSeasonTypes,
          providerCallAttempted,
          rowsReceived,
          response: priorGoodStaleResponse(commit.prior),
        });
      }
      case 'incomplete': {
        await recordProviderRefreshFailure('rankings', scope, {
          attempt,
          error:
            `rankings ${year}: ${commit.failedSeasonTypes.join(', ')} partition would lose ` +
            'previously cached weeks or populated poll sources — rejected as incomplete',
          code: 'rankings-partition-incomplete',
          partialFailure: true,
          failedPartitions: commit.failedSeasonTypes,
          durationMs: Date.now() - acquiredAtMs,
        });
        attemptResolved = true;
        return rankingsRefreshResult({
          reason: 'rankings-partition-incomplete',
          year,
          trigger,
          observedAt: observedAtIso,
          attemptedSeasonTypes,
          failedSeasonTypes: commit.failedSeasonTypes,
          providerCallAttempted,
          rowsReceived,
          response: priorGoodStaleResponse(commit.prior),
        });
      }
      case 'store-unavailable': {
        await recordProviderRefreshFailure('rankings', scope, {
          attempt,
          error: `rankings ${year}: durable commit failed`,
          code: 'rankings-durable-commit-failed',
          durationMs: Date.now() - acquiredAtMs,
        });
        attemptResolved = true;
        return rankingsRefreshResult({
          reason: 'durable-commit-failed',
          year,
          trigger,
          observedAt: observedAtIso,
          attemptedSeasonTypes,
          providerCallAttempted,
          rowsReceived,
        });
      }
      case 'unchanged-clean':
      case 'written-clean': {
        // Post-commit order: confirmed durable commit → commit instant/sequence →
        // process-memo publication → provider-status success. Never before.
        const committedAt = new Date().toISOString();
        const commitSeq = nextProviderCommitSeq();
        publishRankingsProcessMemo(year, commit.entry);
        const written = commit.kind === 'written-clean';
        await recordProviderRefreshSuccess('rankings', scope, {
          attempt,
          committedAt,
          commitSeq,
          source: 'cfbd',
          rowsCommitted: written ? commit.entry.response.weeks.length : 0,
          durationMs: Date.now() - acquiredAtMs,
        });
        attemptResolved = true;
        return rankingsRefreshResult({
          reason: written ? 'written-clean' : 'unchanged-clean',
          year,
          trigger,
          observedAt: observedAtIso,
          attemptedSeasonTypes,
          providerCallAttempted,
          rowsReceived,
          rowsCommitted: written ? commit.entry.response.weeks.length : 0,
          dataChanged: written,
          committedAt,
          response: commit.entry.response,
        });
      }
    }
    // Exhaustive switch above; this is unreachable.
    return rankingsRefreshResult({
      reason: 'unexpected-error',
      year,
      trigger,
      observedAt: observedAtIso,
    });
  } catch {
    // Defensive: a genuine programming defect. Resolve any open attempt so it
    // never dangles in-progress, then surface the failure.
    if (attempt && !attemptResolved) {
      await recordProviderRefreshFailure('rankings', scope, {
        attempt,
        error: `rankings ${year}: unexpected refresh error`,
        code: 'rankings-unexpected-error',
        durationMs: Date.now() - acquiredAtMs,
      });
    }
    return rankingsRefreshResult({
      reason: 'unexpected-error',
      year,
      trigger,
      observedAt: observedAtIso,
      attemptedSeasonTypes,
      providerCallAttempted,
    });
  } finally {
    // Released on EVERY outcome; token-checked so a reclaimed lease is untouched,
    // and a release failure never rewrites the confirmed result (it expires).
    await releaseRankingsRefreshLease({ year, token });
  }
}

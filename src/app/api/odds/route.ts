import { promises as fs } from 'node:fs';
import path from 'node:path';

import { getOddsQuotaGuardState, type OddsUsageSnapshot } from '../../../lib/api/oddsUsage.ts';
import {
  selectOddsForGame,
  type CanonicalOddsItem,
  type DurableOddsRecord,
} from '../../../lib/odds.ts';
import {
  buildScheduleFromApi,
  type AppGame,
  type ScheduleWireItem,
} from '../../../lib/schedule.ts';
import type { CfbdConferenceRecord } from '../../../lib/conferenceSubdivision.ts';
import { getDurableOddsStore } from '../../../lib/server/durableOddsStore.ts';
import { getLatestKnownOddsUsage } from '../../../lib/server/oddsUsageStore.ts';
import {
  recordRouteCacheHit,
  recordRouteCacheMiss,
  recordRouteRequest,
} from '../../../lib/server/apiUsageBudget.ts';
import {
  createTeamIdentityResolver,
  type TeamCatalogItem,
  type TeamIdentityResolver,
} from '../../../lib/teamIdentity.ts';
import type { AliasMap } from '../../../lib/teamNames.ts';
import { getAppState } from '../../../lib/server/appStateStore.ts';
import {
  beginProviderRefreshAttempt,
  recordProviderRefreshFailure,
  type ProviderRefreshAttempt,
} from '../../../lib/server/providerRefreshStatus.ts';
import { oddsTargetScope, type ProviderRefreshScope } from '../../../lib/providerRefreshScope.ts';
import { getScopedAliasMap } from '../../../lib/server/globalAliasStore.ts';
import { requireAdminRequest } from '../../../lib/server/adminAuth.ts';
import {
  acquireOddsRefreshLease,
  releaseOddsRefreshLease,
} from '../../../lib/odds/refreshLease.ts';
import type { OddsRefreshLeaseResolution } from '../../../lib/odds/refreshResult.ts';
import { buildNextOddsStore, maintainCanonicalClosingLines } from '../../../lib/odds/oddsCommit.ts';
import { executeOddsRefresh } from '../../../lib/odds/oddsRefreshExecutor.ts';
import {
  createOddsCacheKey,
  oddsCache,
  ODDS_DEFAULT_BOOKMAKERS,
  ODDS_DEFAULT_MARKETS,
  ODDS_DEFAULT_REGIONS,
  pickFreshestOddsFallback,
  resolveDefaultSeason,
  type NormalizedOddsEvent,
  type SharedOddsCacheEntry,
} from './routeInternals.ts';

export const revalidate = 120;
const ODDS_CACHE_TTL_MS = revalidate * 1000;

type OddsMeta = {
  source: 'odds-api';
  cache: 'hit' | 'miss';
  fallbackUsed: boolean;
  generatedAt: string;
  usage: OddsUsageSnapshot | null;
  season: number;
  /**
   * Capture time of the odds cache entry actually SERVED for this season (its
   * `lastFetch`), or null when nothing is cached. This — not the global odds
   * quota-usage snapshot — is the honest freshness timestamp for the served odds:
   * it is tied to the served cache entry for THIS season, so a historical/cold
   * season cannot inherit another season's recency.
   */
  snapshotCapturedAt: string | null;
};

type OddsResponse = {
  items: CanonicalOddsItem[];
  meta: OddsMeta;
};

// The canonical/default filter sets and cache-key builder live in routeInternals so
// diagnostics can derive the exact same DEFAULT cache key without duplicating them.
const BOOKMAKERS = ODDS_DEFAULT_BOOKMAKERS;
const MARKETS = ODDS_DEFAULT_MARKETS;
const REGIONS = ODDS_DEFAULT_REGIONS;

// The MANUAL provider-request retry/pacing policy (unchanged). The automatic cron
// uses a one-attempt no-retry policy of its own.
const ODDS_RETRY_POLICY = {
  maxAttempts: 3,
  baseDelayMs: 300,
  maxDelayMs: 2500,
  jitterRatio: 0.2,
  retryOnHttpStatuses: [408, 425, 429, 500, 502, 503, 504],
} as const;
const ODDS_PACING_POLICY = {
  key: 'odds-api',
  minIntervalMs: 200,
} as const;

type ParsedOddsQuery = {
  bookmakers: string[];
  markets: string[];
  regions: string[];
  season: number;
};

type QueryValidationError = {
  ok: false;
  field: 'bookmakers' | 'markets' | 'regions' | 'year';
  value: string | null;
  error: string;
};

type QueryValidationResult = { ok: true; query: ParsedOddsQuery } | QueryValidationError;
type ParsedCsvParamResult = { ok: true; values: string[] } | QueryValidationError;
type ParsedSeasonResult = { ok: true; season: number } | QueryValidationError;

function isFreshOddsCacheEntry(entry: SharedOddsCacheEntry | undefined, now: number): boolean {
  return Boolean(entry && now - entry.lastFetch < ODDS_CACHE_TTL_MS);
}

function responseFrom(items: CanonicalOddsItem[], meta: OddsMeta, status = 200): Response {
  return new Response(JSON.stringify({ items, meta } satisfies OddsResponse), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function parseCsvList(raw: string | null): string[] | null {
  if (!raw) return null;
  const values = raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return values.length > 0 ? values : null;
}

function parseValidatedCsvParam(
  field: 'bookmakers' | 'markets' | 'regions',
  raw: string | null,
  allowed: readonly string[],
  fallback: string[]
): ParsedCsvParamResult {
  if (raw === null) {
    return { ok: true, values: fallback };
  }

  const values = parseCsvList(raw);
  if (!values) {
    return { ok: false, field, value: raw, error: `${field} must be a comma-separated list` };
  }

  const invalid = values.find((value) => !allowed.includes(value));
  if (invalid) {
    return {
      ok: false,
      field,
      value: raw,
      error: `${field} contains unsupported value "${invalid}"`,
    };
  }

  return { ok: true, values };
}

function parseRequestedSeason(raw: string | null): ParsedSeasonResult {
  if (raw === null) {
    return { ok: true, season: resolveDefaultSeason() };
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 2000 || parsed > 3000) {
    return { ok: false, field: 'year', value: raw, error: 'year must be a valid YYYY season' };
  }

  return { ok: true, season: parsed };
}

function parseOddsQuery(url: URL): QueryValidationResult {
  const seasonResult = parseRequestedSeason(url.searchParams.get('year'));
  if (!seasonResult.ok) return seasonResult;

  const bookmakersResult = parseValidatedCsvParam(
    'bookmakers',
    url.searchParams.get('bookmakers'),
    BOOKMAKERS,
    BOOKMAKERS
  );
  if (!bookmakersResult.ok) return bookmakersResult;

  const marketsResult = parseValidatedCsvParam(
    'markets',
    url.searchParams.get('markets'),
    MARKETS,
    MARKETS
  );
  if (!marketsResult.ok) return marketsResult;

  const regionsResult = parseValidatedCsvParam(
    'regions',
    url.searchParams.get('regions'),
    REGIONS,
    REGIONS
  );
  if (!regionsResult.ok) return regionsResult;

  return {
    ok: true,
    query: {
      season: seasonResult.season,
      bookmakers: bookmakersResult.values,
      markets: marketsResult.values,
      regions: regionsResult.values,
    },
  };
}

async function readConferenceRecords(req: Request): Promise<CfbdConferenceRecord[]> {
  const reqUrl = new URL(req.url);
  const conferencesUrl = new URL('/api/conferences', reqUrl.origin);
  const response = await fetch(conferencesUrl.toString(), { cache: 'no-store' });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`conferences ${response.status} ${detail}`);
  }

  const payload = (await response.json()) as { items?: CfbdConferenceRecord[] };
  return Array.isArray(payload.items) ? payload.items : [];
}

async function readTeamsCatalog(): Promise<TeamCatalogItem[]> {
  const raw = await fs.readFile(path.join(process.cwd(), 'src/data/teams.json'), 'utf8');
  const parsed = JSON.parse(raw) as { items?: TeamCatalogItem[] };
  return Array.isArray(parsed.items) ? parsed.items : [];
}

async function fetchCanonicalSchedule(req: Request, season: number): Promise<ScheduleWireItem[]> {
  const reqUrl = new URL(req.url);
  const scheduleUrl = new URL(`/api/schedule?year=${season}`, reqUrl.origin);
  const response = await fetch(scheduleUrl.toString(), { cache: 'no-store' });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`schedule ${response.status} ${detail}`);
  }

  const payload = (await response.json()) as { items?: ScheduleWireItem[] };
  return Array.isArray(payload.items) ? payload.items : [];
}

function isCanonicalDurableQuery(query: ParsedOddsQuery): boolean {
  return (
    query.bookmakers.length === BOOKMAKERS.length &&
    BOOKMAKERS.every((value) => query.bookmakers.includes(value)) &&
    query.markets.length === MARKETS.length &&
    MARKETS.every((value) => query.markets.includes(value)) &&
    query.regions.length === REGIONS.length &&
    REGIONS.every((value) => query.regions.includes(value))
  );
}

/**
 * Build the canonical games + shared identity resolver for a season. The
 * authorized MANUAL path is allowed to read the internal schedule/conferences
 * endpoints; the DORMANT automatic C2 cron uses the cache-only canonical context.
 * The resolver seeds observed names from the built canonical participants AND the
 * odds-event labels so attachment resolves every label it encounters.
 */
/**
 * Load the canonical schedule inputs — games + the identity inputs — WITHOUT the
 * event-dependent resolver. This is the fallible I/O (schedule/conferences fetch +
 * `buildScheduleFromApi`); a manual canonical refresh runs it BEFORE the billed
 * `/odds` request so a context failure is classified before any credit is spent
 * (review remediation), and the pure `buildOddsResolver` finishes the attachment
 * inputs afterward with no further I/O.
 */
async function loadCanonicalScheduleInputs(
  req: Request,
  season: number
): Promise<{ games: AppGame[]; teams: TeamCatalogItem[]; aliasMap: AliasMap }> {
  const [scheduleItems, teams, aliasMap, conferenceRecords] = await Promise.all([
    fetchCanonicalSchedule(req, season),
    readTeamsCatalog(),
    getScopedAliasMap('', season),
    readConferenceRecords(req),
  ]);
  const games = buildScheduleFromApi({
    scheduleItems,
    teams,
    aliasMap,
    season,
    conferenceRecords,
  }).games;
  return { games, teams, aliasMap };
}

/** Build the odds attachment resolver (pure — no I/O). */
function buildOddsResolver(
  teams: TeamCatalogItem[],
  aliasMap: AliasMap,
  games: AppGame[],
  oddsEvents: NormalizedOddsEvent[]
): TeamIdentityResolver {
  const observedNames = Array.from(
    new Set(
      [
        ...games.flatMap((game) => [game.canHome, game.canAway]),
        ...oddsEvents.flatMap((event) => [event.homeTeam, event.awayTeam]),
      ].filter(Boolean)
    )
  );
  return createTeamIdentityResolver({ aliasMap, teams, observedNames });
}

async function loadCanonicalBuildInputs(
  req: Request,
  season: number,
  oddsEvents: NormalizedOddsEvent[]
): Promise<{ games: AppGame[]; resolver: TeamIdentityResolver }> {
  const inputs = await loadCanonicalScheduleInputs(req, season);
  return {
    games: inputs.games,
    resolver: buildOddsResolver(inputs.teams, inputs.aliasMap, inputs.games, oddsEvents),
  };
}

function selectCanonicalOddsItems(
  games: AppGame[],
  store: Record<string, DurableOddsRecord>,
  now: string
): CanonicalOddsItem[] {
  const items: CanonicalOddsItem[] = [];
  for (const game of games) {
    const odds = selectOddsForGame({ game, record: store[game.key] ?? null, now });
    if (!odds) continue;
    items.push({ canonicalGameId: game.key, odds });
  }
  return items;
}

export async function GET(req: Request): Promise<Response> {
  recordRouteRequest('odds');
  // Provider-refresh observability. The shared executor RESOLVES the begun
  // attempt exactly once; the catch below only attributes a failure for a truly
  // unexpected throw that left the attempt unresolved.
  let oddsAttempt: ProviderRefreshAttempt | null = null;
  let oddsScope: ProviderRefreshScope | null = null;
  let oddsAttemptResolved = false;
  // Shared refresh lease (PLATFORM-086C1). Held for the whole refresh and released
  // in `finally` with the truthful resolution — never masking the primary result.
  let leaseToken: string | null = null;
  let leaseSeasonScopedKey: string | null = null;
  let leaseResolution: OddsRefreshLeaseResolution = 'release-only';
  // Whether the billed `/odds` request was issued — drives the billed vs
  // non-billed lease resolution on an unexpected throw.
  let providerCallAttempted = false;
  try {
    const parsedQuery = parseOddsQuery(new URL(req.url));
    if (!parsedQuery.ok) {
      return new Response(
        JSON.stringify({
          error: parsedQuery.error,
          field: parsedQuery.field,
          value: parsedQuery.value,
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const query = parsedQuery.query;

    // Only an authorized admin refresh may spend upstream Odds API quota
    // (PLATFORM-075). Public/anonymous traffic is a pure cache reader below.
    const refreshRequested = new URL(req.url).searchParams.get('refresh') === '1';
    if (refreshRequested) {
      const authFailure = await requireAdminRequest(req);
      if (authFailure) return authFailure;
    }

    const cacheKey = createOddsCacheKey(query);
    const seasonScopedKey = `${query.season}:${cacheKey}`;
    const isCanonicalQuery = isCanonicalDurableQuery(query);
    oddsScope = oddsTargetScope(
      query.season,
      isCanonicalQuery ? 'canonical' : 'filtered',
      seasonScopedKey
    );
    const now = Date.now();
    const cachedEntry = oddsCache.entries[seasonScopedKey];
    let responseEntry: SharedOddsCacheEntry | undefined = cachedEntry;
    let fetchedFromUpstream = false;
    let quotaSuppressed = false;
    let suppressedUsage: OddsUsageSnapshot | null = null;
    let servedStaleFallback = false;
    // Usage captured from THIS request's provider headers (refresh path only).
    let refreshCapturedUsage: OddsUsageSnapshot | null = null;
    // A canonical refresh returns the built games + committed store so the final
    // selection does not rebuild the schedule.
    let canonicalRefreshGames: AppGame[] | null = null;
    let committedCanonicalStore: Record<string, DurableOddsRecord> | null = null;

    if (!refreshRequested) {
      // ---- Public/anonymous path: never spends upstream quota, never writes ----
      if (isFreshOddsCacheEntry(cachedEntry, now)) {
        recordRouteCacheHit('odds');
      } else {
        const stored = await getAppState<SharedOddsCacheEntry>('odds-cache', seasonScopedKey);
        const storedValue = stored?.value;
        if (storedValue && isFreshOddsCacheEntry(storedValue, now)) {
          oddsCache.entries[seasonScopedKey] = storedValue;
          responseEntry = storedValue;
          recordRouteCacheHit('odds');
        } else {
          recordRouteCacheMiss('odds');
          responseEntry = pickFreshestOddsFallback(cachedEntry, storedValue);
          servedStaleFallback = true;
          const latestKnownUsage = await getLatestKnownOddsUsage({ forceRefresh: true });
          if (getOddsQuotaGuardState(latestKnownUsage?.remaining).disableAutoRefresh) {
            quotaSuppressed = true;
            suppressedUsage = latestKnownUsage;
          }
        }
      }
    } else {
      // ---- Authorized admin refresh: the only path allowed to spend quota ----
      recordRouteCacheMiss('odds');

      // Acquire the shared durable lease BEFORE any provider/status work. A
      // nonexpired lease → truthful 409 with NO provider call and NO fabricated
      // attempt. Manual refresh IGNORES the automatic backoff (still needs the lease).
      const lease = await acquireOddsRefreshLease({ seasonScopedKey, owner: 'manual', now });
      if (!lease.acquired) {
        if (lease.reason === 'refresh-in-progress') {
          return new Response(
            JSON.stringify({
              error: 'odds refresh already in progress for this target',
              code: 'odds-refresh-in-progress',
            }),
            { status: 409, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response(
          JSON.stringify({
            error: 'odds refresh lease store unavailable',
            code: 'odds-refresh-store-unavailable',
          }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        );
      }
      leaseToken = lease.token;
      leaseSeasonScopedKey = seasonScopedKey;

      oddsAttempt = await beginProviderRefreshAttempt('odds', oddsScope, {
        startedAt: new Date().toISOString(),
      });

      const oddsApiKey = process.env.ODDS_API_KEY?.trim();
      if (!oddsApiKey) {
        // Attempt already recorded; record the matching failure here. Missing
        // credentials are NOT a billed failure → lease resolves `release-only`.
        await recordProviderRefreshFailure('odds', oddsScope, {
          attempt: oddsAttempt,
          error: 'ODDS_API_KEY missing',
          code: 'odds-api-key-missing',
          status: 503,
        });
        oddsAttemptResolved = true;
        return new Response(JSON.stringify({ error: 'ODDS_API_KEY missing' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Preload the canonical schedule inputs BEFORE the billed request (canonical
      // target only), so a schedule/conference build failure is a truthful
      // pre-billing `canonical-context-unavailable` (release-only) rather than a
      // billed request whose post-fetch context failure the shared mapping would
      // mis-bill (review remediation). The resolver is then finished purely below.
      let preloadedInputs: {
        games: AppGame[];
        teams: TeamCatalogItem[];
        aliasMap: AliasMap;
      } | null = null;
      if (isCanonicalQuery) {
        try {
          preloadedInputs = await loadCanonicalScheduleInputs(req, query.season);
        } catch {
          await recordProviderRefreshFailure('odds', oddsScope, {
            attempt: oddsAttempt,
            error: `odds ${query.season}: canonical context unavailable`,
            code: 'canonical-context-unavailable',
            status: 503,
          });
          oddsAttemptResolved = true; // no `/odds` spent → lease stays release-only
          return new Response(
            JSON.stringify({
              error: `odds ${query.season}: canonical-context-unavailable`,
              code: 'canonical-context-unavailable',
            }),
            { status: 503, headers: { 'Content-Type': 'application/json' } }
          );
        }
      }

      // Observation captured IMMEDIATELY before the request (orders the raw cache
      // + stamps every generated snapshot). The shared executor owns the rest.
      const observationAt = new Date().toISOString();
      providerCallAttempted = true;
      const execution = await executeOddsRefresh({
        mode: 'manual',
        season: query.season,
        seasonScopedKey,
        isCanonical: isCanonicalQuery,
        scope: oddsScope,
        attempt: oddsAttempt,
        apiKey: oddsApiKey,
        query: { bookmakers: query.bookmakers, markets: query.markets, regions: query.regions },
        observationAt,
        now: new Date().toISOString(),
        retry: ODDS_RETRY_POLICY,
        pacing: ODDS_PACING_POLICY,
        // Pure now — the fallible schedule I/O already ran above.
        resolveCanonicalInputs: async (events) => {
          if (!preloadedInputs) return { available: false };
          return {
            available: true,
            games: preloadedInputs.games,
            resolver: buildOddsResolver(
              preloadedInputs.teams,
              preloadedInputs.aliasMap,
              preloadedInputs.games,
              events
            ),
          };
        },
      });
      // The executor resolved the attempt exactly once and recorded status.
      oddsAttemptResolved = true;
      fetchedFromUpstream = true;
      refreshCapturedUsage = execution.usage;
      leaseResolution = execution.leaseResolution;
      if (execution.rawEntry !== undefined) responseEntry = execution.rawEntry;
      committedCanonicalStore = execution.canonicalStore;
      canonicalRefreshGames = execution.canonicalGames;

      if (execution.result.status === 'failure') {
        if (execution.result.reason === 'provider-fetch-failed') {
          // Allowlisted, credential-safe upstream detail (no raw body/URL). The
          // manual response surfaces the ORIGINAL upstream HTTP status (e.g.
          // 402/429) when present, else 502 for a transport/timeout failure.
          return new Response(
            JSON.stringify({ error: 'upstream error', detail: execution.providerErrorDetail }),
            {
              status: execution.providerErrorDetail?.status ?? execution.result.httpStatus,
              headers: { 'Content-Type': 'application/json' },
            }
          );
        }
        return new Response(
          JSON.stringify({
            error: `odds ${query.season}: ${execution.result.reason}`,
            code: execution.result.reason,
          }),
          { status: execution.result.httpStatus, headers: { 'Content-Type': 'application/json' } }
        );
      }
      // success / no-op → fall through to item building + 200 response.
    }

    const requestTime = new Date().toISOString();
    const servedSnapshotAt =
      responseEntry?.lastFetch != null ? new Date(responseEntry.lastFetch).toISOString() : null;

    let items: CanonicalOddsItem[];
    if (isCanonicalQuery) {
      if (committedCanonicalStore !== null && canonicalRefreshGames !== null) {
        // A canonical refresh already built the games and committed the store.
        items = selectCanonicalOddsItems(
          canonicalRefreshGames,
          committedCanonicalStore,
          requestTime
        );
      } else {
        const inputs = await loadCanonicalBuildInputs(req, query.season, responseEntry?.data ?? []);
        const observationAt =
          responseEntry?.observedAt ??
          (responseEntry?.lastFetch != null
            ? new Date(responseEntry.lastFetch).toISOString()
            : requestTime);
        if (refreshRequested && !servedStaleFallback) {
          // Authorized manual EMPTY canonical refresh → closing maintenance through
          // the durable-store transaction (preserves current behavior; the cron
          // owns automatic maintenance).
          const maintained = await maintainCanonicalClosingLines({
            season: query.season,
            games: inputs.games,
            oddsEvents: responseEntry?.data ?? [],
            resolver: inputs.resolver,
            observationAt,
            now: requestTime,
          });
          const store =
            maintained.kind === 'maintained'
              ? maintained.store
              : await getDurableOddsStore(query.season);
          items = selectCanonicalOddsItems(inputs.games, store, requestTime);
        } else {
          // PUBLIC read (fresh, stale, or cold) → READ-ONLY (PLATFORM-086C2 §10):
          // derive freeze/reopen in-memory for display but NEVER write the durable
          // store. Cross-instance cron commits become visible via the bounded memo.
          const prior = await getDurableOddsStore(query.season);
          const { store } = buildNextOddsStore(prior, {
            games: inputs.games,
            oddsEvents: responseEntry?.data ?? [],
            resolver: inputs.resolver,
            observationAt,
            now: requestTime,
          });
          items = selectCanonicalOddsItems(inputs.games, store, requestTime);
        }
      }
    } else {
      // Filtered response: built purely from its own fetched/cached events (no
      // durable per-game store), so it can never leak spreads/totals or games
      // absent from the filtered payload.
      const inputs = await loadCanonicalBuildInputs(req, query.season, responseEntry?.data ?? []);
      const observationAt =
        responseEntry?.observedAt ??
        (responseEntry?.lastFetch != null
          ? new Date(responseEntry.lastFetch).toISOString()
          : requestTime);
      const { store } = buildNextOddsStore(
        {},
        {
          games: inputs.games,
          oddsEvents: responseEntry?.data ?? [],
          resolver: inputs.resolver,
          observationAt,
          now: requestTime,
        }
      );
      items = selectCanonicalOddsItems(inputs.games, store, requestTime);
    }

    return responseFrom(items, {
      source: 'odds-api',
      cache: fetchedFromUpstream ? 'miss' : 'hit',
      fallbackUsed: false,
      generatedAt: requestTime,
      usage: quotaSuppressed
        ? suppressedUsage
        : (refreshCapturedUsage ?? responseEntry?.usage ?? (await getLatestKnownOddsUsage())),
      season: query.season,
      snapshotCapturedAt: servedSnapshotAt,
    });
  } catch (e) {
    // The shared executor resolves the attempt itself, so this handles only a
    // truly unexpected throw (e.g. the response-building tail). A billed provider
    // request that had NOT resolved advances the automatic backoff.
    if (providerCallAttempted && !oddsAttemptResolved) leaseResolution = 'billed-failure';
    if (oddsAttempt && oddsScope && !oddsAttemptResolved) {
      const latestUsage = await getLatestKnownOddsUsage().catch(() => null);
      await recordProviderRefreshFailure('odds', oddsScope, {
        attempt: oddsAttempt,
        error: e instanceof Error ? e.message : 'internal error',
        status: 500,
        usage: latestUsage
          ? {
              used: latestUsage.used,
              remaining: latestUsage.remaining,
              limit: latestUsage.limit,
              lastCost: latestUsage.lastCost,
            }
          : undefined,
      });
    }

    const msg = e instanceof Error ? e.message : 'internal error';
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  } finally {
    if (leaseToken && leaseSeasonScopedKey) {
      await releaseOddsRefreshLease({
        seasonScopedKey: leaseSeasonScopedKey,
        token: leaseToken,
        resolution: leaseResolution,
        now: Date.now(),
      });
    }
  }
}

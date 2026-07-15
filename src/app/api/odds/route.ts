import { promises as fs } from 'node:fs';
import path from 'node:path';

import { fetchUpstreamResponse, UpstreamFetchError } from '../../../lib/api/fetchUpstream.ts';
import { getOddsQuotaGuardState, type OddsUsageSnapshot } from '../../../lib/api/oddsUsage.ts';
import {
  applyPregameOddsSnapshot,
  buildDurableOddsSnapshot,
  freezeClosingSnapshotIfNeeded,
  reopenClosingSnapshotForDelayedKickoffIfNeeded,
  pickPreferredBook,
  selectOddsForGame,
  type CanonicalOddsItem,
  type DurableOddsRecord,
  type OddsBookmaker,
} from '../../../lib/odds.ts';
import { attachOddsEventsToSchedule } from '../../../lib/oddsAttachment.ts';
import { buildScheduleFromApi, type ScheduleWireItem } from '../../../lib/schedule.ts';
import type { CfbdConferenceRecord } from '../../../lib/conferenceSubdivision.ts';
import {
  getDurableOddsStore,
  updateDurableOddsStore,
} from '../../../lib/server/durableOddsStore.ts';
import {
  captureOddsUsageSnapshot,
  getLatestKnownOddsUsage,
  setLatestKnownOddsUsage,
} from '../../../lib/server/oddsUsageStore.ts';
import {
  recordRouteCacheHit,
  recordRouteCacheMiss,
  recordRouteRequest,
} from '../../../lib/server/apiUsageBudget.ts';
import { createTeamIdentityResolver, type TeamCatalogItem } from '../../../lib/teamIdentity.ts';
import { getAppState, setAppState } from '../../../lib/server/appStateStore.ts';
import {
  beginProviderRefreshAttempt,
  nextProviderCommitSeq,
  recordProviderRefreshFailure,
  recordProviderRefreshNoop,
  recordProviderRefreshSuccess,
  type ProviderRefreshAttempt,
} from '../../../lib/server/providerRefreshStatus.ts';
import {
  classifyEmptyOddsResponse,
  type OddsScheduleEvidenceItem,
} from '../../../lib/odds/emptyOddsClassifier.ts';
import { loadCachedScheduleItems } from '../../../lib/server/canonicalScheduleCache.ts';
import { oddsTargetScope, type ProviderRefreshScope } from '../../../lib/providerRefreshScope.ts';
import { getScopedAliasMap } from '../../../lib/server/globalAliasStore.ts';
import { requireAdminRequest } from '../../../lib/server/adminAuth.ts';
import type { AliasMap } from '../../../lib/teamNames.ts';
import {
  createOddsCacheKey,
  isStructurallyValidUpstreamOddsEvent,
  normalizeUpstreamOddsEvent,
  oddsCache,
  ODDS_DEFAULT_BOOKMAKERS,
  ODDS_DEFAULT_MARKETS,
  ODDS_DEFAULT_REGIONS,
  pickFreshestOddsFallback,
  resolveDefaultSeason,
  withOddsTargetLock,
  type NormalizedOddsEvent,
  type SharedOddsCacheEntry,
  type UpstreamOddsEvent,
} from './routeInternals.ts';

export const revalidate = 120;
const ODDS_CACHE_TTL_MS = revalidate * 1000;

type PreparedOddsEvent = {
  homeTeam: string;
  awayTeam: string;
  commenceTime: string | null;
  book: OddsBookmaker | undefined;
};

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
   * quota-usage snapshot — is the honest freshness timestamp for the served odds
   * (rereview finding #2): it is tied to the served cache entry for THIS season,
   * so a historical/cold-cache season cannot inherit another season's recency.
   */
  snapshotCapturedAt: string | null;
};

type OddsResponse = {
  items: CanonicalOddsItem[];
  meta: OddsMeta;
};

const ODDS_API = 'https://api.the-odds-api.com/v4/sports/americanfootball_ncaaf/odds';
// The canonical/default filter sets and cache-key builder live in routeInternals so
// diagnostics can derive the exact same DEFAULT cache key without duplicating them.
const BOOKMAKERS = ODDS_DEFAULT_BOOKMAKERS;
const MARKETS = ODDS_DEFAULT_MARKETS;
const REGIONS = ODDS_DEFAULT_REGIONS;

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

/**
 * A provider payload that must be REJECTED before any durable commit
 * (PLATFORM-086G2 finding #4): non-array, schema drift, or an unexpectedly
 * empty response over target-scoped evidence. Carries the stable diagnostic
 * code the provider-refresh failure record and the HTTP error body both report.
 * Thrown from the refresh branch only — the shared catch records exactly one
 * truthful failure for the exact odds scope, and because it is thrown before
 * `setAppState`/process-cache publication, prior-good data is untouched and no
 * downstream invalidation fires.
 */
class OddsPayloadError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 502) {
    super(message);
    this.name = 'OddsPayloadError';
    this.code = code;
    this.status = status;
  }
}

/**
 * Best-effort, cache-only evidence for classifying an EMPTY Odds payload
 * (PLATFORM-086G2 finding #4): the prior-good entry for the EXACT season-scoped
 * target (freshest of process + durable, mirroring the public fallback read)
 * plus the canonical schedule for the season. The two sources resolve
 * INDEPENDENTLY — a failed read makes only THAT source unavailable
 * (contributing no evidence — unavailability is never evidence of absence) and
 * never discards what the other source returned. Schedule evidence is gathered
 * ONLY for the canonical target (`includeScheduleEvidence`): a filtered
 * bookmaker/market subset may legitimately be empty, so its only evidence is
 * its own prior-good data. `priorDurableReadOk` lets the caller avoid writing
 * over a durable entry it could not read.
 */
async function gatherEmptyOddsEvidence(params: {
  seasonScopedKey: string;
  season: number;
  memoryEntry: SharedOddsCacheEntry | undefined;
  includeScheduleEvidence: boolean;
}): Promise<{
  priorEntry: SharedOddsCacheEntry | undefined;
  priorDurableReadOk: boolean;
  scheduleItems: OddsScheduleEvidenceItem[] | null;
}> {
  const [priorRead, scheduleRead] = await Promise.allSettled([
    getAppState<SharedOddsCacheEntry>('odds-cache', params.seasonScopedKey),
    params.includeScheduleEvidence ? loadCachedScheduleItems(params.season) : Promise.resolve(null),
  ]);
  const priorStored = priorRead.status === 'fulfilled' ? priorRead.value?.value : undefined;
  return {
    priorEntry: pickFreshestOddsFallback(params.memoryEntry, priorStored),
    priorDurableReadOk: priorRead.status === 'fulfilled',
    scheduleItems: scheduleRead.status === 'fulfilled' ? scheduleRead.value : null,
  };
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
    return {
      ok: false,
      field,
      value: raw,
      error: `${field} must be a comma-separated list`,
    };
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
    return {
      ok: false,
      field: 'year',
      value: raw,
      error: 'year must be a valid YYYY season',
    };
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

function emptyRecord(canonicalGameId: string): DurableOddsRecord {
  return {
    canonicalGameId,
    latestSnapshot: null,
    closingSnapshot: null,
    closingFrozenAt: null,
  };
}

function hasStoredOddsData(record: DurableOddsRecord): boolean {
  return Boolean(record.latestSnapshot || record.closingSnapshot || record.closingFrozenAt);
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

async function buildCanonicalOddsItems(params: {
  season: number;
  scheduleItems: ScheduleWireItem[];
  oddsEvents: NormalizedOddsEvent[];
  teams: TeamCatalogItem[];
  aliasMap: AliasMap;
  conferenceRecords: CfbdConferenceRecord[];
  requestTime: string;
  snapshotCapturedAt: string;
  persistDurableStore: boolean;
  seedDurableStore: boolean;
}): Promise<CanonicalOddsItem[]> {
  const {
    season,
    scheduleItems,
    oddsEvents,
    teams,
    aliasMap,
    conferenceRecords,
    requestTime,
    snapshotCapturedAt,
    persistDurableStore,
    seedDurableStore,
  } = params;
  const builtSchedule = buildScheduleFromApi({
    scheduleItems,
    teams,
    aliasMap,
    season,
    conferenceRecords,
  });
  const games = builtSchedule.games;

  const observedNames = Array.from(
    new Set(
      [
        ...games.flatMap((game) => [game.canHome, game.canAway]),
        ...oddsEvents.flatMap((event) => [event.homeTeam, event.awayTeam]),
      ].filter(Boolean)
    )
  );
  const resolver = createTeamIdentityResolver({ aliasMap, teams, observedNames });

  const preparedEvents: PreparedOddsEvent[] = oddsEvents.map((event) => ({
    homeTeam: event.homeTeam,
    awayTeam: event.awayTeam,
    commenceTime: event.commenceTime,
    book: pickPreferredBook(event),
  }));

  const attached = attachOddsEventsToSchedule({
    games,
    events: preparedEvents,
    resolver,
  });

  const gameByKey = new Map(games.map((game) => [game.key, game]));

  const applyOddsStoreUpdates = (currentStore: Record<string, DurableOddsRecord>) => {
    const nextStore: Record<string, DurableOddsRecord> = { ...currentStore };

    const assignRecord = (gameKey: string, nextRecord: DurableOddsRecord): void => {
      const prevSerialized = JSON.stringify(nextStore[gameKey] ?? null);
      const hasData = hasStoredOddsData(nextRecord);
      const nextSerialized = JSON.stringify(hasData ? nextRecord : null);
      if (prevSerialized === nextSerialized) return;

      if (hasData) {
        nextStore[gameKey] = nextRecord;
      } else {
        delete nextStore[gameKey];
      }
    };

    for (const game of games) {
      const currentRecord = nextStore[game.key] ?? emptyRecord(game.key);
      assignRecord(
        game.key,
        freezeClosingSnapshotIfNeeded({
          record: reopenClosingSnapshotForDelayedKickoffIfNeeded({
            record: currentRecord,
            kickoff: game.date,
            now: requestTime,
          }),
          kickoff: game.date,
          now: requestTime,
        })
      );
    }

    for (const match of attached) {
      const game = gameByKey.get(match.gameKey);
      if (!game) continue;

      const snapshot = buildDurableOddsSnapshot({
        game,
        event: match.event,
        resolver,
        capturedAt: snapshotCapturedAt,
      });
      if (!snapshot) continue;

      const currentRecord = nextStore[game.key] ?? emptyRecord(game.key);
      const updated = applyPregameOddsSnapshot({
        record: currentRecord,
        snapshot,
        kickoff: game.date,
        now: requestTime,
      });

      assignRecord(
        game.key,
        freezeClosingSnapshotIfNeeded({
          record: updated,
          kickoff: game.date,
          now: requestTime,
        })
      );
    }

    return nextStore;
  };

  // Filtered (non-canonical) queries must NOT seed from the shared durable
  // store: it holds a full-market, preferred-book snapshot per game that cannot
  // be projected to arbitrary market/bookmaker/region filters, so seeding would
  // leak spreads/totals and games absent from the filtered payload. Such
  // responses are built purely from the fetched/cached filtered events; games
  // without a matching event simply carry no odds. Canonical queries still seed
  // (and, when authorized, persist) the durable store. persistDurableStore is
  // never set for filtered queries, so the persist branch always seeds durable.
  const nextStore = persistDurableStore
    ? await updateDurableOddsStore(season, applyOddsStoreUpdates)
    : applyOddsStoreUpdates(seedDurableStore ? await getDurableOddsStore(season) : {});

  const items: CanonicalOddsItem[] = [];
  for (const game of games) {
    const odds = selectOddsForGame({
      game,
      record: nextStore[game.key] ?? null,
      now: requestTime,
    });
    if (!odds) continue;
    items.push({ canonicalGameId: game.key, odds });
  }

  return items;
}

export async function GET(req: Request): Promise<Response> {
  recordRouteRequest('odds');
  // Provider-refresh observability (PLATFORM-086A). Hoisted above the try so the
  // shared catch can attribute a failure to the odds refresh ONLY when a refresh
  // was actually attempted (never for a public cache-only read that happens to
  // throw). `oddsAttemptResolved` prevents a post-resolution throw from
  // double-writing a failure over an already-recorded success or no-op.
  let oddsAttempt: ProviderRefreshAttempt | null = null;
  let oddsScope: ProviderRefreshScope | null = null;
  let oddsAttemptResolved = false;
  try {
    const parsedQuery = parseOddsQuery(new URL(req.url));
    if (!parsedQuery.ok) {
      return new Response(
        JSON.stringify({
          error: parsedQuery.error,
          field: parsedQuery.field,
          value: parsedQuery.value,
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
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
    // In-memory and durable entries share the same season-scoped key so odds
    // for different seasons can never collide in the process cache. Previously
    // the in-memory key omitted the season (only the durable key carried it),
    // so a 2025 and 2026 request with identical bookmakers/markets/regions
    // aliased the same in-memory entry (PLATFORM-075 item 3).
    const seasonScopedKey = `${query.season}:${cacheKey}`;
    // Odds status uses the SAME canonical target identity as the durable Odds
    // cache (the season-scoped cache key), distinguishing the canonical/default
    // query from any filtered variant. A filtered refresh records against its own
    // target and can never advance canonical Odds freshness/success/metadata.
    oddsScope = oddsTargetScope(
      query.season,
      isCanonicalDurableQuery(query) ? 'canonical' : 'filtered',
      seasonScopedKey
    );
    const now = Date.now();
    const cachedEntry = oddsCache.entries[seasonScopedKey];
    let responseEntry: SharedOddsCacheEntry | undefined = cachedEntry;
    let fetchedFromUpstream = false;
    let quotaSuppressed = false;
    let suppressedUsage: OddsUsageSnapshot | null = null;
    let servedStaleFallback = false;
    // The usage snapshot captured from THIS request's provider headers (refresh
    // path only). A retained-data no-op serves the PRIOR cache entry, whose
    // embedded `usage` predates this refresh — the response must still report
    // the current quota (nested-schema/usage remediation #2). Null on genuine
    // cache-only reads, which keep using cached/durable usage.
    let refreshCapturedUsage: OddsUsageSnapshot | null = null;

    if (!refreshRequested) {
      // ---- Public/anonymous path: never spends upstream quota (PLATFORM-075) ----
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
          // No fresh cache. Serve the freshest STALE fallback (in-memory or
          // durable) without any upstream call; if nothing is cached, serve
          // empty odds. Anonymous callers never trigger a cold-cache fetch.
          recordRouteCacheMiss('odds');
          responseEntry = pickFreshestOddsFallback(cachedEntry, storedValue);
          servedStaleFallback = true;
          // Surface the current (low) usage snapshot when the saved quota guard
          // is tripped so the client can self-throttle its own manual refresh
          // (preserves PLATFORM-020 usage reporting). Read through durable
          // storage so the decision is not made from a stale process memo.
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

      oddsAttempt = await beginProviderRefreshAttempt('odds', oddsScope, {
        startedAt: new Date().toISOString(),
      });

      const oddsApiKey = process.env.ODDS_API_KEY?.trim();
      if (!oddsApiKey) {
        // The attempt was already recorded; this early return bypasses the catch,
        // so record the matching failure here (PLATFORM-086A) — prior-good odds +
        // last-success are preserved by the failure helper.
        await recordProviderRefreshFailure('odds', oddsScope, {
          attempt: oddsAttempt,
          error: 'ODDS_API_KEY missing',
          code: 'odds-api-key-missing',
          status: 503,
        });
        // `return` (not throw) exits without reaching the catch, so this failure
        // is recorded exactly once.
        return new Response(JSON.stringify({ error: 'ODDS_API_KEY missing' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const url = new URL(ODDS_API);
      url.searchParams.set('regions', query.regions.join(','));
      url.searchParams.set('oddsFormat', 'american');
      url.searchParams.set('dateFormat', 'iso');
      url.searchParams.set('bookmakers', query.bookmakers.join(','));
      url.searchParams.set('markets', query.markets.join(','));
      url.searchParams.set('apiKey', oddsApiKey);

      const upstreamRes = await fetchUpstreamResponse(url.toString(), {
        cache: 'no-store',
        timeoutMs: 12000,
        retry: ODDS_RETRY_POLICY,
        pacing: ODDS_PACING_POLICY,
        throwOnHttpError: false,
      });

      if (!upstreamRes.ok) {
        const usage = await captureOddsUsageSnapshot(upstreamRes.headers, {
          sportKey: 'americanfootball_ncaaf',
          markets: query.markets,
          regions: query.regions,
          endpointType: 'odds',
          cacheStatus: 'miss',
        });

        if (
          (upstreamRes.status === 402 || upstreamRes.status === 429) &&
          (!usage || usage.remaining > 0)
        ) {
          await setLatestKnownOddsUsage({
            used: usage?.limit ?? 500,
            remaining: 0,
            lastCost: usage?.lastCost ?? 0,
            limit: usage?.limit ?? 500,
            capturedAt: new Date().toISOString(),
            source: 'quota-error-fallback',
            sportKey: 'americanfootball_ncaaf',
            markets: query.markets,
            regions: query.regions,
            endpointType: 'odds',
            cacheStatus: 'miss',
          });
        }

        const responseBody = await upstreamRes.text().catch(() => '');
        throw new UpstreamFetchError({
          kind: 'http',
          message: `Upstream request failed with status ${upstreamRes.status}${upstreamRes.statusText ? ` (${upstreamRes.statusText})` : ''}`,
          status: upstreamRes.status,
          statusText: upstreamRes.statusText,
          url: url.toString(),
          responseBody,
        });
      }

      // Capture and persist quota headers BEFORE parsing the body (invalid-JSON
      // remediation): the request consumed provider credits regardless of body
      // validity, so the usage snapshot must survive a malformed payload — both
      // for the durable quota accounting and for the failure record below.
      const usage = await captureOddsUsageSnapshot(upstreamRes.headers, {
        sportKey: 'americanfootball_ncaaf',
        markets: query.markets,
        regions: query.regions,
        endpointType: 'odds',
        cacheStatus: 'miss',
      });
      refreshCapturedUsage = usage;

      // Parse INSIDE the payload-error boundary: a 200 with an invalid,
      // truncated, or empty body is a malformed provider payload — a stable
      // `odds-invalid-payload` 502 with prior-good retention, never an uncoded
      // internal 500 (invalid-JSON remediation).
      let upstreamData: unknown;
      try {
        upstreamData = await upstreamRes.json();
      } catch {
        throw new OddsPayloadError(
          'odds-invalid-payload',
          `odds ${query.season}: provider returned a 200 response with an invalid or empty JSON body — nothing committed; prior-good odds retained`
        );
      }

      // ---- Payload classification BEFORE any durable commit (086G2 #4) ----
      // A successful HTTP response is not a valid Odds payload merely because it
      // can be coerced to an empty array. Non-array payloads, payloads carrying
      // structurally malformed rows, and nonempty payloads with zero
      // normalizable events are provider failures; a genuine empty array is
      // classified contextually below.
      if (!Array.isArray(upstreamData)) {
        throw new OddsPayloadError(
          'odds-invalid-payload',
          `odds ${query.season}: provider returned a non-array payload — nothing committed; prior-good odds retained`
        );
      }
      // Structural row validation BEFORE normalization (086G2 P2 remediation
      // #2): a row normalization would throw on (`[null]`, `{ bookmakers: {} }`,
      // non-string team fields) is schema drift for the WHOLE payload — a stable
      // 502 with prior-good retention, never a mid-normalization TypeError that
      // surfaces as a generic 500.
      const malformedRowCount = upstreamData.filter(
        (row) => !isStructurallyValidUpstreamOddsEvent(row)
      ).length;
      if (malformedRowCount > 0) {
        throw new OddsPayloadError(
          'odds-schema-drift',
          `odds ${query.season}: ${malformedRowCount} of ${upstreamData.length} provider event(s) are structurally malformed (schema drift) — nothing committed; prior-good odds retained`
        );
      }
      const normalizedEvents = (upstreamData as UpstreamOddsEvent[])
        .map(normalizeUpstreamOddsEvent)
        .filter((event): event is NormalizedOddsEvent => Boolean(event));
      if (upstreamData.length > 0 && normalizedEvents.length === 0) {
        throw new OddsPayloadError(
          'odds-schema-drift',
          `odds ${query.season}: provider returned ${upstreamData.length} event(s) but none normalized to a usable odds event (schema drift) — nothing committed; prior-good odds retained`
        );
      }

      if (normalizedEvents.length === 0) {
        // Genuinely empty provider array — classify against target-scoped
        // evidence (086G2 #4): still-upcoming prior-good events for this exact
        // target, or (canonical target only) non-disrupted schedule games
        // kicking off within the expected-odds horizon, mean rows should exist.
        // The evidence read and the conditional cold-target write below are
        // SERIALIZED per season-scoped target (086G2 P2 remediation #1) so an
        // overlapping nonempty refresh cannot commit populated data between
        // this branch's "no prior entry" observation and its empty write —
        // inside the lock the evidence re-reads both caches and sees any commit
        // that won the lock first.
        responseEntry = await withOddsTargetLock(seasonScopedKey, async () => {
          const evidence = await gatherEmptyOddsEvidence({
            seasonScopedKey,
            season: query.season,
            memoryEntry: oddsCache.entries[seasonScopedKey],
            includeScheduleEvidence: isCanonicalDurableQuery(query),
          });
          const classification = classifyEmptyOddsResponse({
            priorEvents: evidence.priorEntry?.data ?? [],
            scheduleItems: evidence.scheduleItems,
            now: Date.now(),
          });
          if (classification.kind === 'unexpected-empty') {
            throw new OddsPayloadError(
              'odds-empty-unexpected',
              `odds ${query.season}: provider returned 0 events but odds are expected for this target ` +
                `(prior upcoming events: ${classification.priorUpcomingEventCount}, ` +
                `schedule games within 7 days: ${classification.nearHorizonGameCount}); ` +
                `prior-good data retained`
            );
          }

          // Valid absence → truthful NO-OP, never a successful empty commit.
          const priorHasData = (evidence.priorEntry?.data.length ?? 0) > 0;
          if (!priorHasData && evidence.priorDurableReadOk) {
            // Cold/empty target: the empty entry replaces no prior-good data, so
            // committing it (durable-first) preserves the existing cache contract
            // — TTL freshness, honest snapshotCapturedAt, and no repeat upstream
            // pressure from follow-up reads.
            const emptyEntry: SharedOddsCacheEntry = { data: [], lastFetch: Date.now(), usage };
            await setAppState('odds-cache', seasonScopedKey, emptyEntry);
            oddsCache.entries[seasonScopedKey] = emptyEntry;
            return emptyEntry;
          }
          // Prior-good data exists (or the durable entry was unreadable): an
          // unexplained empty payload never replaces it, durably or in-process.
          // Serve what subsequent cache reads will serve.
          return evidence.priorEntry ?? oddsCache.entries[seasonScopedKey];
        });
        fetchedFromUpstream = true;
        await recordProviderRefreshNoop('odds', oddsScope, {
          attempt: oddsAttempt ?? undefined,
          source: 'odds-api',
        });
        oddsAttemptResolved = true;
      } else {
        const nextEntry: SharedOddsCacheEntry = {
          data: normalizedEvents,
          lastFetch: Date.now(),
          usage,
        };
        responseEntry = nextEntry;
        // Durable-first commit order (PLATFORM-085A): persist the raw odds cache
        // entry BEFORE publishing it to the process cache, so a failed durable
        // write can never leave this instance serving "fresh" odds that no other
        // instance can durably reproduce. A setAppState throw propagates to the
        // route's catch (500), leaving the process cache untouched. The commit
        // runs under the same per-target lock as the empty-payload branch
        // (086G2 P2 remediation #1) so it can never interleave with a
        // concurrent empty classification's read-then-write.
        const { committedAt, commitSeq } = await withOddsTargetLock(seasonScopedKey, async () => {
          await setAppState('odds-cache', seasonScopedKey, nextEntry);
          // Capture the durable COMMIT time + sequence for success ordering
          // (rereview findings #3/#6): last-success is ordered by commit time,
          // not by when the status call runs after the canonical item build
          // below; the sequence breaks a same-millisecond tie by true commit
          // order.
          const committed = {
            committedAt: new Date().toISOString(),
            commitSeq: nextProviderCommitSeq(),
          };
          oddsCache.entries[seasonScopedKey] = nextEntry;
          return committed;
        });
        fetchedFromUpstream = true;

        // Durable odds committed — record success (PLATFORM-086A). Tied to the
        // durable commit per the truthfulness invariant; the guard prevents a later
        // throw (e.g. in canonical item building) from overwriting it with a failure.
        await recordProviderRefreshSuccess('odds', oddsScope, {
          attempt: oddsAttempt ?? undefined,
          committedAt,
          commitSeq,
          source: 'odds-api',
          rowsCommitted: nextEntry.data.length,
          usage: usage
            ? {
                used: usage.used,
                remaining: usage.remaining,
                limit: usage.limit,
                lastCost: usage.lastCost,
              }
            : undefined,
        });
        oddsAttemptResolved = true;
      }
    }
    const requestTime = new Date().toISOString();
    const snapshotCapturedAt = new Date(responseEntry?.lastFetch ?? Date.now()).toISOString();
    // Honest served-snapshot time for the user-facing freshness label (finding
    // #2): null when NOTHING is cached for this season, so a cold-cache season
    // shows no timestamp rather than a spurious "just now". Distinct from
    // `snapshotCapturedAt` above, which keeps its now-fallback only for per-item
    // odds age classification in buildCanonicalOddsItems.
    const servedSnapshotAt =
      responseEntry?.lastFetch != null ? new Date(responseEntry.lastFetch).toISOString() : null;

    // Only the canonical/default query reads the shared durable odds store; it
    // holds a full-market, preferred-book snapshot per game that cannot be
    // projected to arbitrary market/bookmaker/region filters. A filtered
    // (non-canonical) response is therefore built purely from its own fetched/
    // cached events (seedDurableStore=false), so it can never leak spreads/totals
    // or games absent from the filtered payload — whether the filtered cache is
    // cold (empty result) or a partial subset.
    const isCanonicalQuery = isCanonicalDurableQuery(query);
    const [scheduleItems, teams, aliasMap, conferenceRecords] = await Promise.all([
      fetchCanonicalSchedule(req, query.season),
      readTeamsCatalog(),
      // Canonical effective resolution (stored global > year > SEED_ALIASES).
      // Odds are league-agnostic (the /api/odds request carries no league), so
      // the empty slug yields global > year > seed — matching schedule/standings
      // identity instead of the old year-only + hand-merged seeds.
      getScopedAliasMap('', query.season),
      readConferenceRecords(req),
    ]);

    const items = await buildCanonicalOddsItems({
      season: query.season,
      scheduleItems,
      oddsEvents: responseEntry?.data ?? [],
      teams,
      aliasMap,
      conferenceRecords,
      requestTime,
      snapshotCapturedAt,
      // Never persist the durable store from a stale served fallback (quota
      // suppressed or not) — it must not downgrade newer durable snapshots.
      // Only fresh cache hits and authorized upstream refreshes persist.
      persistDurableStore: !servedStaleFallback && isCanonicalQuery,
      seedDurableStore: isCanonicalQuery,
    });

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
    // Attribute the failure to the odds refresh only when a refresh was actually
    // attempted and no success was recorded (PLATFORM-086A). Public cache-only
    // reads that throw are not refresh attempts.
    if (oddsAttempt && oddsScope && !oddsAttemptResolved) {
      const latestUsage = await getLatestKnownOddsUsage().catch(() => null);
      await recordProviderRefreshFailure('odds', oddsScope, {
        attempt: oddsAttempt,
        error: e instanceof Error ? e.message : 'internal error',
        // Payload rejections carry their stable diagnostic code into the status
        // record (086G2 #4) so operators can distinguish a malformed payload,
        // schema drift, or unexpected empty from a transport failure.
        code: e instanceof OddsPayloadError ? e.code : undefined,
        status:
          e instanceof OddsPayloadError
            ? e.status
            : e instanceof UpstreamFetchError
              ? (e.details.status ?? 502)
              : 500,
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
    if (e instanceof OddsPayloadError) {
      return new Response(JSON.stringify({ error: e.message, code: e.code }), {
        status: e.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (e instanceof UpstreamFetchError) {
      return new Response(JSON.stringify({ error: 'upstream error', detail: e.details }), {
        status: e.details.status ?? 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const msg = e instanceof Error ? e.message : 'internal error';
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

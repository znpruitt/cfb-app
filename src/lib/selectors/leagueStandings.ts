import { revalidateTag, unstable_cache } from 'next/cache';
import { cache } from 'react';

import { deriveLifecycleState, deriveTotalRegularSeasonWeeks } from '../insights/lifecycle.ts';
import type { LifecycleState } from '../insights/types.ts';
import type { League, LeagueStatus } from '../league.ts';
import { getLeague } from '../leagueRegistry.ts';
import { parseOwnersCsv } from '../parseOwnersCsv.ts';
import { getPreseasonOwners } from '../preseasonOwnerStore.ts';
import type { AppGame, ScheduleWireItem } from '../schedule.ts';
import { buildScheduleFromApi } from '../schedule.ts';
import {
  attachScoresToSchedule,
  buildScheduleIndex,
  type NormalizedScoreRow,
} from '../scoreAttachment.ts';
import type { ScorePack } from '../scores.ts';
import { getSeasonArchive, listSeasonArchives } from '../seasonArchive.ts';
import { getScheduleProbeState } from '../scheduleProbe.ts';
import { selectSeasonContext } from './seasonContext.ts';
import { getAppState } from '../server/appStateStore.ts';
import { getScopedAliasMap, SEED_ALIASES_HASH } from '../server/globalAliasStore.ts';
import { getTeamDatabaseItems } from '../server/teamDatabaseStore.ts';
import {
  NO_CLAIM_OWNER,
  deriveStandings,
  deriveStandingsCoverage,
  splitOutNoClaim,
  type OwnerStandingsRow,
  type StandingsCoverage,
} from '../standings.ts';
import { deriveStandingsHistory, type StandingsHistory } from '../standingsHistory.ts';
import { createTeamIdentityResolver } from '../teamIdentity.ts';
import { isLikelyInvalidTeamLabel } from '../teamNormalization.ts';
import { chooseDefaultWeek, deriveRegularWeeks } from '../weekSelection.ts';

const EMPTY_STANDINGS_HISTORY: StandingsHistory = { weeks: [], byWeek: {}, byOwner: {} };
const EMPTY_COVERAGE: StandingsCoverage = { state: 'complete', message: null };

/**
 * Where the snapshot's rows and owner list came from.
 * - `archive`: read from a persisted SeasonArchive
 * - `live`: derived from the current CSV + schedule + scores caches
 * - `preseason-names`: synthesized from `preseason-owners:{slug}:{year}` (no CSV yet)
 * - `preseason-awaiting-kickoff`: no data and kickoff is in the future (or league is in preseason
 *   with no owner data set yet); StandingsPanel renders a structured "Season starts {date}" placeholder
 * - `empty`: nothing available and kickoff has already passed (or season is unknown); diagnostic copy
 */
export type CanonicalStandingsSource =
  | 'archive'
  | 'live'
  | 'preseason-names'
  | 'preseason-awaiting-kickoff'
  | 'empty';

export type CanonicalStandingsRosterSource = 'archive' | 'csv' | 'preseason-owners' | 'none';

/**
 * Canonical standings snapshot for a league+year.
 *
 * Every surface that renders owner-derived records (Standings, Overview, Members,
 * Trends, Insights, History live-year) should consume this selector rather than
 * constructing rosterByTeam and calling deriveStandings independently. Ensures
 * consistent NoClaim handling, consistent lifecycle rendering, and single-pass
 * data loading per request via React.cache.
 *
 * Rows exclude NoClaim. Consumers that need NoClaim (admin preview, matchup
 * opponent labels) read `noClaimRow`.
 *
 * @see STANDINGS-CANONICAL-SELECTOR-DISCOVERY for design rationale.
 */
export type CanonicalStandings = {
  slug: string;
  year: number;
  source: CanonicalStandingsSource;
  lifecycle: LifecycleState;
  /** Primary rows, sorted canonically; NoClaim is never present. */
  rows: OwnerStandingsRow[];
  /** NoClaim's own standings row, when the underlying roster contained one. */
  noClaimRow: OwnerStandingsRow | null;
  /** Alphabetical owner list (NoClaim excluded), stable across renders. */
  ownerColorOrder: string[];
  /** Non-null in archive and live sources; null in preseason-names and empty. */
  standingsHistory: StandingsHistory | null;
  coverage: StandingsCoverage;
  ownersRosterSource: CanonicalStandingsRosterSource;
  archiveYearResolved: number | null;
  /**
   * ISO date string of the inferred season kickoff. Populated only when
   * `source === 'preseason-awaiting-kickoff'` and the schedule probe has been
   * cached; null otherwise. Consumers use this to render "Season starts {date}".
   */
  inferredSeasonStart: string | null;
  generatedAt: string;
};

export type GetCanonicalStandingsInput = {
  slug: string;
  /** Overrides the year normally derived from league.status or league.year. */
  year?: number;
  /** Test-only override; bypasses React.cache. */
  leagueStatusOverride?: LeagueStatus;
  /**
   * Wall-clock used for lifecycle classification and fallback-year resolution.
   * Defaults to `new Date()` at call time. Callers (page handlers, cron jobs,
   * tests) should pass an explicit value when reproducibility matters; tests
   * in particular benefit from a fixed Date so `deriveLifecycleState` is
   * deterministic.
   *
   * Note: this value flows through the cached compute path, so the snapshot
   * stored in `unstable_cache` reflects whichever request first warmed the
   * cache. Tag invalidation (`invalidateStandings`) is the only mechanism
   * that refreshes a stale lifecycle classification in the cache.
   */
  currentDate?: Date;
};

/**
 * Cross-request data cache layer. `unstable_cache` is keyed by the resolved
 * year so default-year requests don't collapse onto a single `'null'` key
 * across season transitions. The compute call still receives the original
 * `yearOverride` (which may be null), preserving the internal resolution —
 * notably `resolveOffseason`'s fallback to `mostRecentArchivedYear`. Each
 * call to this factory returns a fresh tagged-cache function whose
 * invocation hits the data cache.
 *
 * The `unstable_` prefix denotes Next.js API surface stability, not runtime
 * stability — the data cache itself is production-ready in Next 15.x. This
 * call site is intentionally the only adoption point so a future migration to
 * a stable equivalent stays one-file.
 */
/**
 * Cache-key parts for the canonical standings data cache. Includes the
 * SEED_ALIASES hash so that a change to the code-defined static aliases (which
 * are merged in-memory and never fire a runtime invalidation) naturally busts
 * every canonical snapshot — resolver output depends on the seed set, so the
 * seed set is part of the cache identity.
 */
export function canonicalStandingsCacheKeyParts(
  slug: string,
  resolvedYear: number | null
): string[] {
  return ['canonical-standings', slug, String(resolvedYear), `seeds:${SEED_ALIASES_HASH}`];
}

/**
 * Shared tag carried by EVERY canonical-standings snapshot, regardless of league
 * or year. Global mutations bust this single tag instead of enumerating the
 * registry, so a league registered at any time — including one created while a
 * global mutation is in flight — is covered without a pre/post snapshot race.
 */
export const ALL_STANDINGS_TAG = 'standings:all';

const dataCachedCanonicalStandings = (
  slug: string,
  yearOverride: number | null,
  resolvedYear: number | null,
  currentDate: Date
) =>
  unstable_cache(
    async () => computeCanonicalStandings(slug, yearOverride, undefined, currentDate),
    canonicalStandingsCacheKeyParts(slug, resolvedYear),
    {
      tags: [
        ALL_STANDINGS_TAG,
        `standings:${slug}`,
        ...(resolvedYear != null ? [`standings:${slug}:${resolvedYear}`] : []),
      ],
      // Tag-only invalidation; no time-based expiry. Year/league-scoped
      // mutations call `invalidateStandings(slug, year)`; global mutations
      // (global aliases, team-database syncs) call
      // `invalidateAllLeaguesStandings()`, which busts the shared
      // `ALL_STANDINGS_TAG` carried by every snapshot.
      //
      // `currentDate` is intentionally NOT part of the cache key — it would
      // bust the cache on every request. The closure captures the first
      // caller's `currentDate`; subsequent cache hits return the same
      // snapshot. Lifecycle staleness is recovered via tag invalidation.
      revalidate: false,
    }
  )();

/**
 * Resolve the year that the cache key should be scoped to BEFORE entering the
 * data cache. Without this, default-year requests (where the caller passes no
 * `year`) all collapse onto a single `'null'` cache key, so a season
 * transition can hand back a stale prior-year snapshot until something else
 * invalidates it.
 *
 * Mirrors the year-resolution logic inside `computeCanonicalStandings`:
 *   - explicit override wins
 *   - else: status year for season/preseason
 *   - else (offseason status): most recent archived year (matches what
 *     `resolveOffseason` will pick when `yearOverride === null`); this
 *     prevents a cache-key collision between a default-year request (which
 *     uses the archive fallback) and an explicit `year: league.year` request
 *     (which does not), since the two flows produce different snapshots
 *   - else (offseason with no archives, OR status undefined — leagues
 *     created via /api/admin/leagues default to no status): league.year.
 *     `computeCanonicalStandings` synthesizes `{ state: 'season', year:
 *     league.year }` when status is missing, so the cache key must agree.
 *   - else: null (unknown slug → empty snapshot path)
 *
 * `getLeague` and `listSeasonArchives` are both `React.cache`-wrapped, so
 * this adds no per-request cost.
 */
export async function resolveStandingsYear(
  slug: string,
  yearOverride: number | null
): Promise<number | null> {
  if (yearOverride != null) return yearOverride;
  const league = await getLeague(slug);
  if (!league) return null;

  const status = league.status;
  if (status && 'year' in status) return status.year;

  // Only consult archives when status is explicitly offseason. Missing
  // status falls through to league.year so the cache key matches the
  // synthesized `{ state: 'season', year: league.year }` that
  // `computeCanonicalStandings` will use.
  if (status?.state === 'offseason') {
    const archives = await listSeasonArchives(slug);
    if (archives.length > 0) return Math.max(...archives);
  }

  return league.year;
}

/**
 * Cached entry point. The outer `React.cache` dedupes within a single request
 * (multiple surfaces that call `getCanonicalStandings` resolve to one compute
 * pass). The inner `unstable_cache` dedupes across requests until a
 * `revalidateTag` invalidates the entry.
 *
 * Outside Next.js's RSC runtime (e.g. `node:test`), `unstable_cache` throws
 * `Invariant: incrementalCache missing` because no incremental cache is
 * installed on the request context. Fall back to direct compute so the
 * selector remains testable; the data-cache path is only active in
 * production / dev requests, which is the only place it matters.
 */
const cachedCanonicalStandings = cache(
  async (
    slug: string,
    yearOverride: number | null,
    currentDate?: Date
  ): Promise<CanonicalStandings> => {
    // Resolve currentDate inside the body rather than as a default parameter
    // expression so React.cache keys on (slug, yearOverride, undefined) for
    // all production callers — a default expression would produce a unique Date
    // object each call and bust per-request dedup.
    const resolvedCurrentDate = currentDate ?? new Date();
    const resolvedYear = await resolveStandingsYear(slug, yearOverride);
    try {
      return await dataCachedCanonicalStandings(
        slug,
        yearOverride,
        resolvedYear,
        resolvedCurrentDate
      );
    } catch (err) {
      if (err instanceof Error && err.message.includes('incrementalCache missing')) {
        return computeCanonicalStandings(slug, yearOverride, undefined, resolvedCurrentDate);
      }
      throw err;
    }
  }
);

export async function getCanonicalStandings(
  input: GetCanonicalStandingsInput
): Promise<CanonicalStandings> {
  // Test-only override: bypass both cache layers so each test sees its own state.
  if (input.leagueStatusOverride !== undefined) {
    return computeCanonicalStandings(
      input.slug,
      input.year ?? null,
      input.leagueStatusOverride,
      input.currentDate ?? new Date()
    );
  }
  return cachedCanonicalStandings(input.slug, input.year ?? null, input.currentDate);
}

/**
 * Invalidate cached canonical standings for a league. Call from mutation
 * paths that affect standings inputs (roster CSV, alias map, postseason
 * override, draft confirmation, schedule/scores cache, archive writes,
 * rollover). After invalidation, the next request that calls
 * `getCanonicalStandings` for this slug recomputes fresh data.
 *
 * - Pass `year` to invalidate only that year's snapshot (preferred — most
 *   mutations are year-scoped).
 * - Omit `year` to invalidate every year-keyed snapshot for the league via
 *   the per-slug umbrella tag.
 *
 * Wired into:
 * - PUT /api/owners (league-scoped roster CSV)
 * - PUT /api/aliases (year-scoped: `aliases:${year}` feeds every league, so it
 *   invalidates that year for every registered league; global-scoped:
 *   invalidates every registered league's umbrella tag). The league-scoped PUT
 *   was removed (PLATFORM-064) and league aliases no longer resolve at runtime
 *   (PLATFORM-067).
 * - PUT /api/postseason-overrides
 * - POST + DELETE /api/draft/[slug]/[year]/confirm
 * - GET /api/schedule (admin refresh, walks registry)
 * - GET /api/scores (cache miss + fallback paths, walks registry)
 * - POST /api/admin/backfill (single league/year)
 * - POST /api/admin/rollover (per league, stage-1 archive loop)
 * - `confirmPreseasonOwners` + `beginPreseason` server actions (PLATFORM-071,
 *   league-scoped: preseason owners / offseason→preseason lifecycle change)
 * - GET /api/cron/season-rollover (per rolled-over league) and
 *   GET /api/cron/season-transition (per transitioned league) — PLATFORM-071
 *
 * Global mutations (team-database sync, `PUT /api/aliases?scope=global`, and the
 * lazy legacy promotion in `GET /api/aliases?scope=global`) call
 * `invalidateAllLeaguesStandings()`, which busts the shared `ALL_STANDINGS_TAG`
 * carried by every snapshot — no registry enumeration (PLATFORM-070).
 *
 * Remaining un-wired lifecycle mutators (intentional): `completeSetup` (flips a
 * setupComplete flag; no standings-content change) and the `slug='test'` dev-
 * tooling actions in `admin/[slug]/actions.ts`. If a genuinely un-wired mutating
 * path is hit, the cache may serve stale canonical data until a subsequent
 * invalidation fires from another path.
 */
export function invalidateStandings(slug: string, year?: number): void {
  revalidateTag(`standings:${slug}`);
  if (year != null) {
    revalidateTag(`standings:${slug}:${year}`);
  }
}

/**
 * Invalidate cached canonical standings for EVERY league, across all cached
 * years, by busting the shared `ALL_STANDINGS_TAG` that every snapshot carries.
 *
 * Use for GLOBAL mutations whose effect is not league- or year-scoped — the
 * inputs they change feed the resolver / canonical derivation shared by every
 * league and every year:
 * - Global alias writes (`PUT /api/aliases?scope=global`, and the lazy legacy
 *   promotion in `GET /api/aliases?scope=global`).
 * - Team-database syncs (`POST /api/admin/team-database`) — a resynced catalog
 *   can change team identity, canonical IDs, derived alts/aliases, and FBS/FCS
 *   classification, all of which `computeCanonicalStandings` consumes via
 *   `getTeamDatabaseItems()`.
 *
 * A single shared tag (rather than enumerating the registry) means there is no
 * `getLeagues()` call to fail after a commit, and no pre/post-snapshot race: a
 * league registered at any moment — including concurrently with the mutation —
 * still carries `ALL_STANDINGS_TAG`, so this bust reaches it. Must be called
 * from a context where `revalidateTag` is valid (a request handler).
 */
export function invalidateAllLeaguesStandings(): void {
  revalidateTag(ALL_STANDINGS_TAG);
}

async function computeCanonicalStandings(
  slug: string,
  yearOverride: number | null,
  statusOverride: LeagueStatus | undefined,
  currentDate: Date
): Promise<CanonicalStandings> {
  const league = await getLeague(slug);
  if (!league) {
    return emptySnapshot(
      slug,
      resolveFallbackYear(yearOverride, currentDate),
      'offseason',
      currentDate
    );
  }

  const status: LeagueStatus = statusOverride ??
    league.status ?? { state: 'season', year: league.year };

  if (status.state === 'offseason') {
    return resolveOffseason(slug, league, yearOverride, currentDate);
  }

  const resolvedYear = yearOverride ?? status.year;

  if (status.state === 'preseason') {
    return resolvePreseason(slug, league, status, resolvedYear, currentDate);
  }

  return resolveSeason(slug, league, status, resolvedYear, currentDate);
}

async function resolveOffseason(
  slug: string,
  league: League,
  yearOverride: number | null,
  currentDate: Date
): Promise<CanonicalStandings> {
  const archiveYears = await listSeasonArchives(slug);
  const mostRecentArchivedYear =
    archiveYears.length > 0 ? [...archiveYears].sort((a, b) => b - a)[0]! : null;

  // Target year for both archive lookup and live fallback: caller override wins,
  // otherwise the most recent archive, otherwise the league's active year.
  const targetYear = yearOverride ?? mostRecentArchivedYear ?? league.year;

  if (mostRecentArchivedYear != null) {
    const archive = await getSeasonArchive(slug, targetYear);
    if (archive) {
      return snapshotFromArchive({
        slug,
        league,
        status: { state: 'offseason' },
        archiveYear: targetYear,
        finalStandings: archive.finalStandings,
        standingsHistory: archive.standingsHistory,
        games: archive.games,
        currentDate,
      });
    }
  }

  const live = await liveDeriveStandings(slug, targetYear);
  if (live && live.roster.size > 0) {
    return snapshotFromLive({
      slug,
      league,
      status: { state: 'offseason' },
      year: targetYear,
      live,
      currentDate,
    });
  }

  return emptySnapshot(slug, targetYear, 'offseason', currentDate);
}

async function resolveSeason(
  slug: string,
  league: League,
  status: Extract<LeagueStatus, { state: 'season' }>,
  year: number,
  currentDate: Date
): Promise<CanonicalStandings> {
  // If the season has already been archived (e.g. backfill wrote it while the
  // league is still tagged 'season'), prefer the archive — it's the locked,
  // authoritative view that matches the final-week state.
  const archiveYears = await listSeasonArchives(slug);
  if (archiveYears.includes(year)) {
    const archive = await getSeasonArchive(slug, year);
    if (archive) {
      return snapshotFromArchive({
        slug,
        league,
        status,
        archiveYear: year,
        finalStandings: archive.finalStandings,
        standingsHistory: archive.standingsHistory,
        games: archive.games,
        currentDate,
      });
    }
  }

  const live = await liveDeriveStandings(slug, year);
  if (live && live.roster.size > 0) {
    return snapshotFromLive({ slug, league, status, year, live, currentDate });
  }

  // No data: surface the inferred kickoff date when the schedule probe is cached.
  // The selector is wrapped by `unstable_cache` with tag-only invalidation, so
  // any time-dependent classification baked in here would stick until something
  // mutates the standings tag. Consumers do the `now > inferredSeasonStart`
  // check at render time and collapse the post-kickoff stale-cache case onto
  // the same diagnostic copy as `source: 'empty'`.
  const probe = await getScheduleProbeState(year);
  if (probe?.firstGameDate) {
    return preseasonAwaitingKickoffSnapshot(slug, status, year, probe.firstGameDate, currentDate);
  }

  return emptySnapshot(slug, year, 'early_season', currentDate);
}

async function resolvePreseason(
  slug: string,
  league: League,
  status: Extract<LeagueStatus, { state: 'preseason' }>,
  year: number,
  currentDate: Date
): Promise<CanonicalStandings> {
  // Prefer CSV (draft complete) — produces real roster + NoClaim segregation.
  const live = await liveDeriveStandings(slug, year);
  if (live && live.roster.size > 0) {
    return snapshotFromLive({ slug, league, status, year, live, currentDate });
  }

  // Otherwise synthesize owner rows from `preseason-owners:{slug}:{year}`.
  const preseasonOwners = await getPreseasonOwners(slug, year);
  if (preseasonOwners && preseasonOwners.length > 0) {
    return snapshotFromPreseasonNames({
      slug,
      status,
      year,
      ownerNames: preseasonOwners,
      currentDate,
    });
  }

  // No owner data — preseason by definition means kickoff is in the future.
  // Include the inferred kickoff date from the schedule probe when available.
  const probe = await getScheduleProbeState(year);
  return preseasonAwaitingKickoffSnapshot(
    slug,
    status,
    year,
    probe?.firstGameDate ?? null,
    currentDate
  );
}

// ---------------------------------------------------------------------------
// Snapshot constructors
// ---------------------------------------------------------------------------

function snapshotFromArchive(params: {
  slug: string;
  league: League;
  status: LeagueStatus;
  archiveYear: number;
  finalStandings: OwnerStandingsRow[];
  standingsHistory: StandingsHistory;
  games: AppGame[];
  currentDate: Date;
}): CanonicalStandings {
  const {
    slug,
    league,
    status,
    archiveYear,
    finalStandings,
    standingsHistory,
    games,
    currentDate,
  } = params;
  void league;
  const { rows, noClaimRow } = splitOutNoClaim(finalStandings);
  const ownerColorOrder = buildOwnerColorOrder(rows);
  const lifecycle = computeLifecycle(status, standingsHistory, games, currentDate);

  return {
    slug,
    year: archiveYear,
    source: 'archive',
    lifecycle,
    rows,
    noClaimRow,
    ownerColorOrder,
    standingsHistory,
    coverage: EMPTY_COVERAGE,
    ownersRosterSource: 'archive',
    archiveYearResolved: archiveYear,
    inferredSeasonStart: null,
    generatedAt: currentDate.toISOString(),
  };
}

function snapshotFromLive(params: {
  slug: string;
  league: League;
  status: LeagueStatus;
  year: number;
  live: LiveDerivation;
  currentDate: Date;
}): CanonicalStandings {
  const { slug, league, status, year, live, currentDate } = params;
  void league;
  const { rows, noClaimRow } = live;
  const ownerColorOrder = buildOwnerColorOrder(rows);
  const lifecycle = computeLifecycle(status, live.standingsHistory, live.games, currentDate);

  return {
    slug,
    year,
    source: 'live',
    lifecycle,
    rows,
    noClaimRow,
    ownerColorOrder,
    standingsHistory: live.standingsHistory,
    coverage: live.coverage,
    ownersRosterSource: 'csv',
    archiveYearResolved: null,
    inferredSeasonStart: null,
    generatedAt: currentDate.toISOString(),
  };
}

function snapshotFromPreseasonNames(params: {
  slug: string;
  status: LeagueStatus;
  year: number;
  ownerNames: string[];
  currentDate: Date;
}): CanonicalStandings {
  const { slug, status, year, ownerNames, currentDate } = params;
  const uniqueNames = Array.from(new Set(ownerNames)).filter((name) => name !== NO_CLAIM_OWNER);
  const sorted = [...uniqueNames].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' })
  );
  const rows: OwnerStandingsRow[] = sorted.map((owner) => ({
    owner,
    wins: 0,
    losses: 0,
    winPct: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    pointDifferential: 0,
    gamesBack: 0,
    finalGames: 0,
  }));

  return {
    slug,
    year,
    source: 'preseason-names',
    lifecycle: computeLifecycle(status, null, [], currentDate),
    rows,
    noClaimRow: null,
    ownerColorOrder: sorted,
    standingsHistory: null,
    coverage: EMPTY_COVERAGE,
    ownersRosterSource: 'preseason-owners',
    archiveYearResolved: null,
    inferredSeasonStart: null,
    generatedAt: currentDate.toISOString(),
  };
}

function emptySnapshot(
  slug: string,
  year: number,
  lifecycleWhenUnknown: LifecycleState,
  currentDate: Date
): CanonicalStandings {
  return {
    slug,
    year,
    source: 'empty',
    lifecycle: lifecycleWhenUnknown,
    rows: [],
    noClaimRow: null,
    ownerColorOrder: [],
    standingsHistory: null,
    coverage: EMPTY_COVERAGE,
    ownersRosterSource: 'none',
    archiveYearResolved: null,
    inferredSeasonStart: null,
    generatedAt: currentDate.toISOString(),
  };
}

function preseasonAwaitingKickoffSnapshot(
  slug: string,
  status: LeagueStatus,
  year: number,
  inferredSeasonStart: string | null,
  currentDate: Date
): CanonicalStandings {
  return {
    slug,
    year,
    source: 'preseason-awaiting-kickoff',
    lifecycle: computeLifecycle(status, null, [], currentDate),
    rows: [],
    noClaimRow: null,
    ownerColorOrder: [],
    standingsHistory: null,
    coverage: EMPTY_COVERAGE,
    ownersRosterSource: 'none',
    archiveYearResolved: null,
    inferredSeasonStart,
    generatedAt: currentDate.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildOwnerColorOrder(rows: OwnerStandingsRow[]): string[] {
  return rows
    .map((row) => row.owner)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

/**
 * Lifecycle classification reachable from inside the cached compute path. The
 * `currentDate` argument is required (not implicit `new Date()`) so the cached
 * snapshot's lifecycle is pinned to the request that warmed the cache, not to
 * whatever wall-clock the helper happened to read at module-load time. Tests
 * pass a fixed Date for deterministic lifecycle assertions.
 */
function computeLifecycle(
  status: LeagueStatus,
  standingsHistory: StandingsHistory | null,
  games: AppGame[],
  currentDate: Date
): LifecycleState {
  const seasonContext = selectSeasonContext({ standingsHistory: standingsHistory ?? null });
  const regularWeeks = deriveRegularWeeks(games);
  const currentWeek = games.length > 0 ? chooseDefaultWeek({ games, regularWeeks }) : null;
  const totalRegularSeasonWeeks = deriveTotalRegularSeasonWeeks(games);
  return deriveLifecycleState(
    status,
    seasonContext,
    currentWeek,
    totalRegularSeasonWeeks,
    currentDate
  );
}

function resolveFallbackYear(yearOverride: number | null, currentDate: Date): number {
  if (yearOverride != null) return yearOverride;
  return currentDate.getUTCFullYear();
}

// ---------------------------------------------------------------------------
// Live derivation (CSV + schedule cache + scores cache → rows)
// ---------------------------------------------------------------------------

type LiveDerivation = {
  rows: OwnerStandingsRow[];
  noClaimRow: OwnerStandingsRow | null;
  standingsHistory: StandingsHistory;
  coverage: StandingsCoverage;
  roster: Map<string, string>;
  games: AppGame[];
};

type ScheduleCacheEntry = { items?: ScheduleWireItem[] };
type ScoresCacheItem = {
  id?: string | null;
  seasonType?: string | null;
  startDate?: string | null;
  week: number | null;
  status: string;
  home: { team: string; score: number | null };
  away: { team: string; score: number | null };
  time: string | null;
};

/**
 * Soft-failing live derivation. Never throws; returns null when no roster can
 * be resolved. When the CSV exists but schedule/scores caches are cold,
 * returns 0-0 rows derived from the roster alone — the caller (selector)
 * decides whether to tag that as `source: 'live'` or fall through.
 */
async function liveDeriveStandings(slug: string, year: number): Promise<LiveDerivation | null> {
  const ownersRecord = await getAppState<string>(`owners:${slug}:${year}`, 'csv');
  const ownersCsvText = typeof ownersRecord?.value === 'string' ? ownersRecord.value : '';
  const ownerRows = parseOwnersCsv(ownersCsvText);
  if (ownerRows.length === 0) return null;
  const roster = new Map<string, string>(ownerRows.map((row) => [row.team, row.owner]));

  const scheduleItems = await loadScheduleItems(year);
  if (scheduleItems.length === 0) {
    const { rows, noClaimRow } = deriveStandings([], roster, {});
    return {
      rows,
      noClaimRow,
      standingsHistory: EMPTY_STANDINGS_HISTORY,
      coverage: deriveStandingsCoverage([], roster, {}),
      roster,
      games: [],
    };
  }

  const [teams, aliasMap, manualOverrides] = await Promise.all([
    getTeamDatabaseItems().catch(() => [] as Awaited<ReturnType<typeof getTeamDatabaseItems>>),
    getScopedAliasMap(slug, year),
    loadManualOverrides(slug, year),
  ]);

  let games: AppGame[];
  try {
    const built = buildScheduleFromApi({
      scheduleItems,
      teams,
      aliasMap,
      season: year,
      manualOverrides,
    });
    games = built.games;
  } catch {
    // If schedule-building itself throws we still produce a roster-only snapshot.
    const { rows, noClaimRow } = deriveStandings([], roster, {});
    return {
      rows,
      noClaimRow,
      standingsHistory: EMPTY_STANDINGS_HISTORY,
      coverage: deriveStandingsCoverage([], roster, {}),
      roster,
      games: [],
    };
  }

  const providerNames = Array.from(
    new Set(
      scheduleItems
        .flatMap((item) => [item.homeTeam, item.awayTeam])
        .filter(
          (name): name is string => typeof name === 'string' && !isLikelyInvalidTeamLabel(name)
        )
    )
  );
  const resolver = createTeamIdentityResolver({ teams, aliasMap, observedNames: providerNames });

  const normalizedRows = await loadNormalizedScoreRows(year);
  const scheduleIndex = buildScheduleIndex(games, resolver);
  const { scoresByKey } = attachScoresToSchedule({
    rows: normalizedRows,
    scheduleIndex,
    resolver,
  });
  const scoresForDerivation = scoresByKey as Record<string, ScorePack>;

  const { rows, noClaimRow } = deriveStandings(games, roster, scoresForDerivation);
  const standingsHistory = deriveStandingsHistory({
    games,
    rosterByTeam: roster,
    scoresByKey: scoresForDerivation as Parameters<typeof deriveStandingsHistory>[0]['scoresByKey'],
  });
  const coverage = deriveStandingsCoverage(games, roster, scoresForDerivation);

  return { rows, noClaimRow, standingsHistory, coverage, roster, games };
}

async function loadScheduleItems(year: number): Promise<ScheduleWireItem[]> {
  const combined = await getAppState<ScheduleCacheEntry>('schedule', `${year}-all-all`);
  if (combined?.value?.items && combined.value.items.length > 0) {
    return combined.value.items;
  }
  const [regular, postseason] = await Promise.all([
    getAppState<ScheduleCacheEntry>('schedule', `${year}-all-regular`),
    getAppState<ScheduleCacheEntry>('schedule', `${year}-all-postseason`),
  ]);
  return [...(regular?.value?.items ?? []), ...(postseason?.value?.items ?? [])];
}

async function loadNormalizedScoreRows(year: number): Promise<NormalizedScoreRow[]> {
  const [regular, postseason] = await Promise.all([
    getAppState<{ items?: ScoresCacheItem[] }>('scores', `${year}-all-regular`),
    getAppState<{ items?: ScoresCacheItem[] }>('scores', `${year}-all-postseason`),
  ]);
  const rows: NormalizedScoreRow[] = [];
  for (const item of regular?.value?.items ?? []) {
    rows.push(toNormalizedScoreRow(item, 'regular'));
  }
  for (const item of postseason?.value?.items ?? []) {
    rows.push(toNormalizedScoreRow(item, 'postseason'));
  }
  return rows;
}

function toNormalizedScoreRow(
  item: ScoresCacheItem,
  defaultSeasonType: 'regular' | 'postseason'
): NormalizedScoreRow {
  const seasonType =
    item.seasonType === 'regular' || item.seasonType === 'postseason'
      ? item.seasonType
      : defaultSeasonType;
  return {
    week: item.week,
    seasonType,
    providerEventId: item.id ?? null,
    status: item.status,
    time: item.time,
    date: item.startDate ?? null,
    home: item.home,
    away: item.away,
  };
}

async function loadManualOverrides(
  slug: string,
  year: number
): Promise<Record<string, Partial<AppGame>>> {
  const record = await getAppState<Record<string, Partial<AppGame>>>(
    `postseason-overrides:${slug}:${year}`,
    'map'
  );
  const value = record?.value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
}

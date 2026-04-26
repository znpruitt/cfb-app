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
import { selectSeasonContext } from './seasonContext.ts';
import { getAppState } from '../server/appStateStore.ts';
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
import type { AliasMap } from '../teamNames.ts';
import { isLikelyInvalidTeamLabel } from '../teamNormalization.ts';
import { chooseDefaultWeek, deriveRegularWeeks } from '../weekSelection.ts';

const EMPTY_STANDINGS_HISTORY: StandingsHistory = { weeks: [], byWeek: {}, byOwner: {} };
const EMPTY_COVERAGE: StandingsCoverage = { state: 'complete', message: null };

/**
 * Where the snapshot's rows and owner list came from.
 * - `archive`: read from a persisted SeasonArchive
 * - `live`: derived from the current CSV + schedule + scores caches
 * - `preseason-names`: synthesized from `preseason-owners:{slug}:{year}` (no CSV yet)
 * - `empty`: nothing available for this league/year combination
 */
export type CanonicalStandingsSource = 'archive' | 'live' | 'preseason-names' | 'empty';

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
  generatedAt: string;
};

export type GetCanonicalStandingsInput = {
  slug: string;
  /** Overrides the year normally derived from league.status or league.year. */
  year?: number;
  /** Test-only override; bypasses React.cache. */
  leagueStatusOverride?: LeagueStatus;
};

/**
 * Cross-request data cache layer. `unstable_cache` is keyed by `(slug,
 * yearOverride)` and tagged so mutations can invalidate only the affected
 * league/year via `invalidateStandings`. Each call to this factory returns a
 * fresh tagged-cache function whose invocation hits the data cache.
 *
 * The `unstable_` prefix denotes Next.js API surface stability, not runtime
 * stability — the data cache itself is production-ready in Next 15.x. This
 * call site is intentionally the only adoption point so a future migration to
 * a stable equivalent stays one-file.
 */
const dataCachedCanonicalStandings = (slug: string, yearOverride: number | null) =>
  unstable_cache(
    async () => computeCanonicalStandings(slug, yearOverride, undefined),
    ['canonical-standings', slug, String(yearOverride)],
    {
      tags: [
        `standings:${slug}`,
        ...(yearOverride != null ? [`standings:${slug}:${yearOverride}`] : []),
      ],
      // Tag-only invalidation; no time-based expiry. Mutations call
      // `invalidateStandings(slug, year)` to bust this entry.
      revalidate: false,
    }
  )();

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
  async (slug: string, yearOverride: number | null): Promise<CanonicalStandings> => {
    try {
      return await dataCachedCanonicalStandings(slug, yearOverride);
    } catch (err) {
      if (err instanceof Error && err.message.includes('incrementalCache missing')) {
        return computeCanonicalStandings(slug, yearOverride, undefined);
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
    return computeCanonicalStandings(input.slug, input.year ?? null, input.leagueStatusOverride);
  }
  return cachedCanonicalStandings(input.slug, input.year ?? null);
}

/**
 * Invalidate cached canonical standings for a league. Call from mutation
 * paths that affect standings inputs (roster CSV, alias map, postseason
 * override, draft confirmation). After invalidation, the next request that
 * calls `getCanonicalStandings` for this slug recomputes fresh data.
 *
 * - Pass `year` to invalidate only that year's snapshot (preferred — most
 *   mutations are year-scoped).
 * - Omit `year` to invalidate every year-keyed snapshot for the league via
 *   the per-slug umbrella tag.
 *
 * NOTE: Global alias writes (`PUT /api/aliases?scope=global`) affect every
 * league that reads global aliases. This helper does not enumerate the league
 * registry; that's flagged as future work (see Phase 0 prompt). Global writes
 * therefore do not trigger per-league invalidation today.
 */
export function invalidateStandings(slug: string, year?: number): void {
  revalidateTag(`standings:${slug}`);
  if (year != null) {
    revalidateTag(`standings:${slug}:${year}`);
  }
}

async function computeCanonicalStandings(
  slug: string,
  yearOverride: number | null,
  statusOverride: LeagueStatus | undefined
): Promise<CanonicalStandings> {
  const league = await getLeague(slug);
  if (!league) {
    return emptySnapshot(slug, resolveFallbackYear(yearOverride), 'offseason');
  }

  const status: LeagueStatus = statusOverride ??
    league.status ?? { state: 'season', year: league.year };

  if (status.state === 'offseason') {
    return resolveOffseason(slug, league, yearOverride);
  }

  const resolvedYear = yearOverride ?? status.year;

  if (status.state === 'preseason') {
    return resolvePreseason(slug, league, status, resolvedYear);
  }

  return resolveSeason(slug, league, status, resolvedYear);
}

async function resolveOffseason(
  slug: string,
  league: League,
  yearOverride: number | null
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
    });
  }

  return emptySnapshot(slug, targetYear, 'offseason');
}

async function resolveSeason(
  slug: string,
  league: League,
  status: Extract<LeagueStatus, { state: 'season' }>,
  year: number
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
      });
    }
  }

  const live = await liveDeriveStandings(slug, year);
  if (live && live.roster.size > 0) {
    return snapshotFromLive({ slug, league, status, year, live });
  }

  return emptySnapshot(slug, year, 'early_season');
}

async function resolvePreseason(
  slug: string,
  league: League,
  status: Extract<LeagueStatus, { state: 'preseason' }>,
  year: number
): Promise<CanonicalStandings> {
  // Prefer CSV (draft complete) — produces real roster + NoClaim segregation.
  const live = await liveDeriveStandings(slug, year);
  if (live && live.roster.size > 0) {
    return snapshotFromLive({ slug, league, status, year, live });
  }

  // Otherwise synthesize owner rows from `preseason-owners:{slug}:{year}`.
  const preseasonOwners = await getPreseasonOwners(slug, year);
  if (preseasonOwners && preseasonOwners.length > 0) {
    return snapshotFromPreseasonNames({ slug, status, year, ownerNames: preseasonOwners });
  }

  return emptySnapshot(slug, year, 'preseason');
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
}): CanonicalStandings {
  const { slug, league, status, archiveYear, finalStandings, standingsHistory, games } = params;
  void league;
  const { rows, noClaimRow } = splitOutNoClaim(finalStandings);
  const ownerColorOrder = buildOwnerColorOrder(rows);
  const lifecycle = computeLifecycle(status, standingsHistory, games);

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
    generatedAt: new Date().toISOString(),
  };
}

function snapshotFromLive(params: {
  slug: string;
  league: League;
  status: LeagueStatus;
  year: number;
  live: LiveDerivation;
}): CanonicalStandings {
  const { slug, league, status, year, live } = params;
  void league;
  const { rows, noClaimRow } = live;
  const ownerColorOrder = buildOwnerColorOrder(rows);
  const lifecycle = computeLifecycle(status, live.standingsHistory, live.games);

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
    generatedAt: new Date().toISOString(),
  };
}

function snapshotFromPreseasonNames(params: {
  slug: string;
  status: LeagueStatus;
  year: number;
  ownerNames: string[];
}): CanonicalStandings {
  const { slug, status, year, ownerNames } = params;
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
    lifecycle: computeLifecycle(status, null, []),
    rows,
    noClaimRow: null,
    ownerColorOrder: sorted,
    standingsHistory: null,
    coverage: EMPTY_COVERAGE,
    ownersRosterSource: 'preseason-owners',
    archiveYearResolved: null,
    generatedAt: new Date().toISOString(),
  };
}

function emptySnapshot(
  slug: string,
  year: number,
  lifecycleWhenUnknown: LifecycleState
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
    generatedAt: new Date().toISOString(),
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

function computeLifecycle(
  status: LeagueStatus,
  standingsHistory: StandingsHistory | null,
  games: AppGame[]
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
    new Date()
  );
}

function resolveFallbackYear(yearOverride: number | null): number {
  if (yearOverride != null) return yearOverride;
  return new Date().getUTCFullYear();
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
    loadAliasMap(slug, year),
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

async function loadAliasMap(slug: string, year: number): Promise<AliasMap> {
  const record = await getAppState<AliasMap>(`aliases:${slug}:${year}`, 'map');
  const value = record?.value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
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

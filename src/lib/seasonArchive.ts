import { revalidateTag, unstable_cache } from 'next/cache';
import { cache } from 'react';

import { getAppState, setAppState, listAppStateKeys } from './server/appStateStore.ts';
import type { StandingsHistory, StandingsHistoryStandingRow } from './standingsHistory.ts';
import type { AppGame } from './schedule.ts';
import type { ScorePack } from './scores.ts';
import type { GameStatSlateSnapshot } from './gameStats/slateSnapshot.ts';

export type { AppGame } from './schedule.ts';

export type SeasonArchive = {
  leagueSlug: string;
  year: number;
  archivedAt: string;
  ownerRosterSnapshot: string;
  standingsHistory: StandingsHistory;
  finalStandings: StandingsHistoryStandingRow[];
  /** Full game list at archive time — both regular season and postseason. */
  games: AppGame[];
  /**
   * Scores keyed by game.key, as attached at archive time.
   * Used for superlative derivation and head-to-head matchup details.
   */
  scoresByKey: Record<string, ScorePack>;
  /**
   * Archive-owned canonical game-stat slate snapshot (PLATFORM-086H3E1) —
   * derived from the EXACT build that produced `games` and paired ONLY with
   * this archive's own `scoresByKey`. OPTIONAL: archives written before E1
   * legitimately lack it; analytics consumers (E3) fail closed on absence or
   * malformation rather than rebuilding a live slate. Re-archiving the year is
   * the only repair; PLATFORM-086F2H2A retired the admin backfill surface that
   * provided it, so that repair is now a deliberate one-off against the archive
   * builders (still live, still exercised by both rollover paths).
   */
  gameStatSlate?: GameStatSlateSnapshot;
};

function archiveScope(leagueSlug: string): string {
  return `standings-archive:${leagueSlug}`;
}

// ---------------------------------------------------------------------------
// Archive read cache (PLATFORM-082A)
//
// Season archives are persisted, effectively-immutable snapshots — written once
// at rollover and only ever overwritten by a deliberate re-archive of the same
// year (PLATFORM-086F2H2A retired the admin backfill surface). That makes them a
// safe cross-request caching target: the read output depends only on
// (slug, year), never on the current alias/roster/owner-label state (those are
// baked into the snapshot at write time). We mirror the canonical-standings
// cache pattern: `React.cache` for per-request dedup layered over
// `unstable_cache` for cross-request caching, with tag-only invalidation (no
// time expiry) fired from `saveSeasonArchive`.
// ---------------------------------------------------------------------------

/** Tag carried by every cached read for a league — busts the year list and all per-year entries. */
export function seasonArchiveSlugTag(leagueSlug: string): string {
  return `archive:${leagueSlug}`;
}

/** Tag carried by a single league+year archive read. */
export function seasonArchiveYearTag(leagueSlug: string, year: number): string {
  return `archive:${leagueSlug}:${year}`;
}

/** Cache-key parts for a single league+year archive read. */
export function seasonArchiveCacheKeyParts(leagueSlug: string, year: number): string[] {
  return ['season-archive', leagueSlug, String(year)];
}

/** Cache-key parts for the archived-years list of a league. */
export function seasonArchiveYearsCacheKeyParts(leagueSlug: string): string[] {
  return ['season-archive-years', leagueSlug];
}

function isIncrementalCacheMissing(err: unknown): boolean {
  return err instanceof Error && err.message.includes('incrementalCache missing');
}

/**
 * True for the single benign `revalidateTag` failure: it was called outside a
 * request/action context (a script or `node:test`), where there is no cache to
 * invalidate. Next throws this as `Invariant: static generation store missing`
 * (NEXT error code `E263`). Every OTHER `revalidateTag` throw only occurs INSIDE
 * a request — misuse during render / inside `use cache` / inside `unstable_cache`,
 * or a genuine cache failure — and must NOT be swallowed, because the archive
 * cache has no TTL: a silently-dropped invalidation would serve stale history
 * indefinitely while the write reports success.
 */
export function isMissingRequestStore(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    (err as { __NEXT_ERROR_CODE?: unknown }).__NEXT_ERROR_CODE === 'E263' ||
    err.message.includes('static generation store missing')
  );
}

// These run as the `unstable_cache` callbacks, so they must distinguish
// "genuinely absent" from "read failed": `getAppState`/`listAppStateKeys`
// return `null`/`[]` ONLY when the row/scope is truly empty and THROW on a
// real store/database failure. We deliberately do NOT catch here — a transient
// failure must reject so `unstable_cache` never persists a bogus `null`/`[]`
// under `revalidate: false`. Only genuine emptiness is cacheable.
//
// The CONSEQUENCE of a bogus cached `null` is worth stating precisely, because
// this passage has now been wrong twice: it originally claimed such a value
// would let a writer "overwrite without confirmation", and the F2H2A rewrite
// that corrected the noun still described a write-side reader that
// PLATFORM-086F2H3A has since removed.
//
// As of F2H3A there is NO write-side reader of `getSeasonArchive` at all. The
// admin route reads it for the PREVIEW only and writes nothing; the
// season-rollover cron writes without consulting it. So a bogus `null` cannot
// bypass any gate — there is no gate to bypass.
//
// The hazard is narrower and sharper than a bypassed confirmation: the preview
// is the ONLY surface that shows an overwrite warning and a diff, and the cron
// performs the irreversible overwrite later with no operator in the loop. A
// cached `null` would show the operator "new" for a year that already has an
// archive, so the one chance to notice an unintended overwrite is lost silently
// and nothing downstream can recover it. The conclusion (do not catch) is
// unchanged and now rests on a stronger reason, not a weaker one.
async function readSeasonArchiveFromStore(
  leagueSlug: string,
  year: number
): Promise<SeasonArchive | null> {
  const record = await getAppState<SeasonArchive>(archiveScope(leagueSlug), String(year));
  return record?.value ?? null;
}

async function readArchiveYearsFromStore(leagueSlug: string): Promise<number[]> {
  const keys = await listAppStateKeys(archiveScope(leagueSlug));
  return keys
    .map((k) => Number(k))
    .filter((n) => Number.isFinite(n) && n >= 2000)
    .sort((a, b) => a - b);
}

const dataCachedSeasonArchive = (leagueSlug: string, year: number) =>
  unstable_cache(
    () => readSeasonArchiveFromStore(leagueSlug, year),
    seasonArchiveCacheKeyParts(leagueSlug, year),
    {
      tags: [seasonArchiveSlugTag(leagueSlug), seasonArchiveYearTag(leagueSlug, year)],
      revalidate: false,
    }
  )();

const dataCachedArchiveYears = (leagueSlug: string) =>
  unstable_cache(
    () => readArchiveYearsFromStore(leagueSlug),
    seasonArchiveYearsCacheKeyParts(leagueSlug),
    { tags: [seasonArchiveSlugTag(leagueSlug)], revalidate: false }
  )();

/**
 * Read a persisted season archive. `React.cache` dedupes within a request (many
 * history/insights surfaces read the same archive per render); `unstable_cache`
 * caches across requests until a `saveSeasonArchive` write busts the tag.
 *
 * Outside Next's RSC runtime (`node:test`) `unstable_cache` throws
 * `Invariant: incrementalCache missing`; fall back to a direct store read so the
 * function stays testable — that fallback read also throws on a real store
 * failure. A genuine store/database error propagates (it is never cached and
 * never masquerades as "no archive"); `null` is returned ONLY when the archive
 * does not exist.
 */
export const getSeasonArchive = cache(
  async (leagueSlug: string, year: number): Promise<SeasonArchive | null> => {
    try {
      return await dataCachedSeasonArchive(leagueSlug, year);
    } catch (err) {
      if (isIncrementalCacheMissing(err)) {
        return readSeasonArchiveFromStore(leagueSlug, year);
      }
      throw err;
    }
  }
);

export const listSeasonArchives = cache(async (leagueSlug: string): Promise<number[]> => {
  try {
    return await dataCachedArchiveYears(leagueSlug);
  } catch (err) {
    if (isIncrementalCacheMissing(err)) {
      return readArchiveYearsFromStore(leagueSlug);
    }
    throw err;
  }
});

/**
 * Bust the cross-request archive cache for a league+year. Called from
 * `saveSeasonArchive` so the sole production writer (cron season-rollover)
 * invalidates without per-call-site wiring. Any future writer must use this
 * authority too. The slug tag alone covers the year list and every per-year
 * read; the year tag is added for explicitness. Must run in a request context —
 * `saveSeasonArchive` swallows the out-of-context throw so scripts/tests still
 * write successfully.
 */
export function invalidateSeasonArchive(leagueSlug: string, year: number): void {
  revalidateTag(seasonArchiveSlugTag(leagueSlug));
  revalidateTag(seasonArchiveYearTag(leagueSlug, year));
}

export async function saveSeasonArchive(archive: SeasonArchive): Promise<void> {
  await setAppState<SeasonArchive>(archiveScope(archive.leagueSlug), String(archive.year), archive);
  try {
    invalidateSeasonArchive(archive.leagueSlug, archive.year);
  } catch (err) {
    // Only the out-of-request-context Invariant is safe to ignore: scripts and
    // tests have no cache to bust, and the write already succeeded. A genuine
    // invalidation failure inside a request MUST propagate — the archive cache
    // has no TTL, so swallowing it would serve the previous archive/year list
    // indefinitely while reporting success. Propagating lets the admin/cron
    // rollover surface the failure and be retried.
    if (!isMissingRequestStore(err)) throw err;
  }
}

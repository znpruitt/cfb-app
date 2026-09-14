import { revalidateTag, unstable_cache } from 'next/cache';
import { cache } from 'react';

import { getAppState, setAppState, listAppStateKeys } from './server/appStateStore.ts';
import { MIN_SEASON_YEAR, type LeagueStatus } from './league.ts';
import { resolveLeagueOperatingYear } from './selectors/leagueLifecycle.ts';
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

export type ArchiveYearResolution = { ok: true; year: number } | { ok: false; error: string };

/**
 * Digits only, deliberately — `Number()` reads `2026.5`, `2e10` and `0x7E0` as
 * numbers, and `Number.parseInt` accepts trailing junk. Mirrors #770's
 * `parseYearParam`, whose shape and error contract this bound reuses.
 */
function parseArchiveYearSegment(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * Names BOTH admitting conditions. Stating only the range would misdescribe the
 * bound to the one caller the disjunct exists for.
 */
function refusal(operatingYear: number): ArchiveYearResolution {
  return {
    ok: false,
    error: `year must be an integer between ${MIN_SEASON_YEAR} and ${operatingYear}, or a season this league has archived`,
  };
}

/**
 * Bound a CALLER-SUPPLIED archive year — #774.
 *
 * THE UNCLOSED HALF OF A DOCUMENTED HAZARD, which is the most useful thing to
 * know about this function. `rolloverTargeting.ts` already refuses an unusable
 * year on the WRITE side, and its own comment names `2026.5` by name: an
 * unvalidated year there would "mint a permanent, TTL-less archive" under such a
 * key. PLATFORM-086F2H1R4 hardened the writer against exactly this value. The
 * READ side was never given the same guard, so `getSeasonArchive` would mint the
 * cache entry the writer had been forbidden to mint. This is not a new class of
 * defect; it is the other half of one the codebase had already diagnosed, and
 * the precedent for the fix was already here.
 *
 * WHY THE CALLERS APPLY THIS AND `getSeasonArchive` DOES NOT. Only a caller can
 * tell a year a CLIENT sent from one the SERVER derived, and only the former may
 * ever be rejected — #770's rule, and the reason its bound lives at its route.
 * `getSeasonArchive` stays unbounded so every server-derived read still works.
 * This lives here rather than in each caller because there are TWO of them (the
 * API route and the RSC page) and they had already drifted into two independent
 * copies of the same broken parser — which is how the page came to share the
 * defect without sharing a line of code.
 *
 * INTEGERS ARE THE LARGER HALF OF THE FIX. A range alone still admits infinitely
 * many values between any two years, so the accepted set stays dense and no
 * enumeration bounds it. `parseArchiveYearSegment` is what collapses it to a
 * countable one.
 *
 * THE CEILING IS THE OPERATING YEAR, NOT `currentYear + 1`. #770 accepts next
 * season because a league legitimately OPERATES in one during rollover. An
 * ARCHIVE of a future season cannot exist — an archive is the record of a season
 * that finished — so #770's ceiling would admit at least one year no league can
 * ever hold.
 *
 * THE DISJUNCT IS LOAD-BEARING, and it is not belt-and-braces. Measured against
 * production on 2026-09-13, every league's newest archive is at or below its
 * operating year, so the range alone rejects nothing genuine TODAY. That is a
 * fact about the current registry, not a property of the code: a legacy record
 * whose top-level year sits below its own newest archive would have that archive
 * refused. Consulting the archive list makes rejecting a year the league
 * genuinely holds STRUCTURALLY impossible instead of merely unlikely.
 *
 * IT ALSO COSTS NO NEW CACHE IDENTITY, which is what makes it safe to consult
 * from a bound whose whole purpose is to stop cache growth.
 * `listSeasonArchives` is keyed `['season-archive-years', slug]` — slug alone,
 * no caller-supplied value reaches it — is `React.cache`-wrapped per request,
 * and is already read by seven league pages plus `/api/history/[slug]`. It runs
 * ONLY when the range has already rejected, so probing absurd years costs one
 * slug-keyed cached read and mints nothing.
 *
 * BOUNDING ON THE ARCHIVE LIST ALONE WOULD BE WRONG, and this is why it is a
 * disjunct rather than the whole rule. It would refuse the league its own
 * operating year (no archive exists for a season still under way), and it would
 * turn every GAP year into a refusal — `tsc` genuinely has holes at 2019 and
 * 2020 — converting the history page's designed "no archived data" empty state
 * into a `notFound()`, and answering "no archive" with "bad year". Those are
 * different questions and they deserve different answers.
 *
 * A STORE FAILURE MUST PROPAGATE, never be read as "no archives". Treating a
 * failed read as an empty list would reject a year the league genuinely holds
 * because the database blinked — the exact property this disjunct exists to
 * guarantee — and it is the same rule `readArchiveYearsFromStore`'s own header
 * states for the cache callbacks.
 */
export async function resolveArchiveYearParam(
  leagueSlug: string,
  raw: string,
  league: { status?: LeagueStatus | null; year: number }
): Promise<ArchiveYearResolution> {
  const operatingYear = resolveLeagueOperatingYear(league);

  // TRIMMED ONCE, and the single decision below reads the trimmed value. A
  // padded-but-legitimate segment (`/history/tsc/%202026%20`) is served today
  // and collapses onto the same cache entry as the bare year, so it is not part
  // of the defect and refusing it would be an unreviewed second behaviour
  // change. #770 shipped that inconsistency and had it caught at review.
  const parsed = parseArchiveYearSegment(raw.trim());

  if (parsed !== null) {
    if (parsed >= MIN_SEASON_YEAR && parsed <= operatingYear) return { ok: true, year: parsed };
    // THE FLOOR GUARDS THE DISJUNCT TOO, and this is not redundancy — review
    // finding. `readArchiveYearsFromStore` filters `n >= 2000`, so the list can
    // never contain a sub-floor value and consulting it for one is a store
    // round-trip whose result cannot change the answer. That matters because the
    // read below deliberately PROPAGATES failure: without this guard a store
    // outage turned a certain 400 on `/history/tsc/1999` into a 500, and the
    // page's `notFound()` into an error boundary. One comparison makes the dead
    // path unreachable and the floor structural rather than incidental.
    if (parsed < MIN_SEASON_YEAR) return refusal(operatingYear);
    if ((await listSeasonArchives(leagueSlug)).includes(parsed)) return { ok: true, year: parsed };
  }

  return refusal(operatingYear);
}

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

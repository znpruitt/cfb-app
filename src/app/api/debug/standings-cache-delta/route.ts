import { workAsyncStorage } from 'next/dist/server/app-render/work-async-storage.external';
import { NextResponse } from 'next/server';

import { MIN_SEASON_YEAR, maxCreatableSeasonYear, type LeagueStatus } from '@/lib/league';
import { getLeague } from '@/lib/leagueRegistry';
import { resolveLeagueOperatingYear } from '@/lib/selectors/leagueLifecycle';
import {
  computeCanonicalStandingsUncached,
  getCanonicalStandings,
  resolveStandingsYear,
  type CanonicalStandings,
} from '@/lib/selectors/leagueStandings';
import { requireAdminAuth } from '@/lib/server/adminAuth';
import { NO_CLAIM_OWNER, type OwnerStandingsRow } from '@/lib/standings';

export const dynamic = 'force-dynamic';

// `fetchCache` is deliberately NOT exported. `unstable_cache` skips its read
// entirely when `workStore.fetchCache === 'force-no-store'`
// (next/dist/server/web/spec-extension/unstable-cache.js, the guard above
// `incrementalCache.get`), and `app-route/module.js` sets `workStore.fetchCache`
// from this module's own export and from nothing else — `dynamic` does not feed
// it. Exporting it here would make every request a forced recompute, so the
// route would report `miss` forever and publish a snapshot every time.
// Asserted by `reportsHitAgainstAWarmSnapshot` in the route suite, which would
// fail if the read were bypassed.

/**
 * The comparison's unit. Named `owner` and not `team` on purpose: canonical
 * standings rows are keyed by OWNER (`OwnerStandingsRow`), and
 * `CanonicalStandings` carries no team -> owner map at all — `roster` lives
 * inside `liveDeriveStandings`'s `LiveDerivation` and never reaches the
 * snapshot. A per-team delta is not obtainable from the two values this route
 * compares.
 */
const COMPARED_FIELDS = [
  'wins',
  'losses',
  'pointsFor',
  'pointsAgainst',
  'pointDifferential',
  'winPct',
  'gamesBack',
  'finalGames',
] as const satisfies ReadonlyArray<keyof OwnerStandingsRow>;

type ComparedField = (typeof COMPARED_FIELDS)[number];

/**
 * There is no `ties` field and there cannot be one. `deriveStandings` in
 * `src/lib/standings.ts` `console.warn`s a final tie and `continue`s, so a tie
 * is counted for neither side and reaches no row. A `ties` column here would be
 * a fabricated `0` on every row, which is worse than its absence. Asserted by
 * `comparedFieldsExcludeTies` in the route suite.
 */
const EXCLUDED_FIELD_NOTE =
  'no ties column: deriveStandings drops final ties (console.warn + continue) and no row carries a tie count';

type OwnerSide = {
  /** Canonical order position, 1-based. DERIVED here, not a stored field. */
  rank: number;
  isNoClaim: boolean;
  row: OwnerStandingsRow;
};

type FieldDifference = {
  field: ComparedField | 'rank';
  cached: number | null;
  fresh: number | null;
};

type OwnerDifference = {
  owner: string;
  isNoClaim: boolean;
  presence: 'both' | 'cached-only' | 'fresh-only';
  fields: FieldDifference[];
};

type SnapshotFieldDifference = {
  field: string;
  cached: string | number | null;
  fresh: string | number | null;
};

type CacheReadVerdict = 'hit' | 'miss' | 'unavailable';

/**
 * Digits only, deliberately — `Number.parseInt` accepts trailing junk and
 * `Number` reads `2026.5`, `2e10` and `0x7E0`. Mirrors `parseYearParam` in
 * `/api/insights/[slug]` (#770) and `parseArchiveYearSegment` in
 * `seasonArchive.ts` (#774), whose bound and error shape this route reuses.
 */
function parseYearParam(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isSafeInteger(n) ? n : null;
}

type YearResolution = { ok: true; year: number | null } | { ok: false; error: string };

/**
 * Bound a CALLER-SUPPLIED year before anything expensive runs — #770 and #774.
 *
 * This route's cost per distinct year is a FULL-SEASON REBUILD, and on a cache
 * miss the read side also mints a permanent `unstable_cache` entry:
 * `canonicalStandingsCacheKeyParts` takes the resolved year verbatim, and the
 * entry carries `revalidate: false`, so a year no mutation will ever invalidate
 * is an entry that never expires within the data cache's one-year ceiling. An
 * unvalidated `?year=` is therefore both a build-cost amplifier and a cache
 * poisoner, which is exactly the pair #770 closed on `/api/insights`.
 *
 * Trimmed ONCE, with both the emptiness and the validity decision reading the
 * trimmed value — `?year=%202026` must not be a 400 when `?year=2026` is fine
 * (the asymmetry #770's review caught).
 *
 * The disjunct is load-bearing for the same reason it is on `/api/insights`: a
 * range alone makes rejecting a league's OWN operating year merely unlikely,
 * while matching `resolveLeagueOperatingYear` makes it structurally impossible
 * whatever the registry holds.
 */
function resolveRequestedYear(
  raw: string | null,
  league: { status?: LeagueStatus | null; year: number } | null,
  now: Date
): YearResolution {
  const trimmed = raw?.trim() ?? '';
  // Absent means "use the server-derived year", which is never subjected to the
  // bound. `null` flows on as `yearOverride`, reproducing a default-year request.
  if (trimmed === '') return { ok: true, year: null };

  const operatingYear = league ? resolveLeagueOperatingYear(league) : undefined;
  const maxYear = maxCreatableSeasonYear(now.getTime());
  const parsed = parseYearParam(trimmed);
  if (parsed !== null) {
    if (parsed >= MIN_SEASON_YEAR && parsed <= maxYear) return { ok: true, year: parsed };
    if (operatingYear !== undefined && parsed === operatingYear) return { ok: true, year: parsed };
  }

  return { ok: false, error: `year must be an integer between ${MIN_SEASON_YEAR} and ${maxYear}` };
}

type CacheContext = {
  incrementalCachePresent: boolean;
  /** How many data-cache publications this request has queued so far. */
  pendingPublications: number;
  /** Read, not assumed — each of these bypasses the cache READ in `unstable_cache`. */
  flags: {
    fetchCache: string | null;
    isOnDemandRevalidate: boolean | null;
    incrementalCacheIsOnDemandRevalidate: boolean | null;
    isDraftMode: boolean | null;
    workStorePresent: boolean;
  };
};

/**
 * Read the request's Next work store rather than assuming what is in it.
 *
 * `getCanonicalStandings` CATCHES `Invariant: incrementalCache missing` and
 * falls back to a direct compute. That fallback returns a snapshot stamped with
 * the `currentDate` this request supplied — byte-identical, at `generatedAt`, to
 * a genuine cache miss. So without this probe the route would report `miss` and
 * claim "this request created the snapshot" when NO snapshot was created and
 * none can be: a false statement about durable state, which is the exact defect
 * class this route exists to expose.
 *
 * The flags are REPORTED, not asserted. Each one independently makes
 * `unstable_cache` skip its read and recompute, which would present as a
 * perpetual `miss`; printing them lets a reader tell that apart from a genuinely
 * cold cache without redeploying.
 *
 * `standingsCacheWarmer.ts` already reads `workAsyncStorage.getStore()` from
 * `src/`, so this is an established seam here rather than a new coupling.
 */
function readCacheContext(): CacheContext {
  const store = workAsyncStorage.getStore() as
    | {
        incrementalCache?: { isOnDemandRevalidate?: boolean };
        pendingRevalidates?: Record<string, unknown>;
        fetchCache?: string;
        isOnDemandRevalidate?: boolean;
        isDraftMode?: boolean;
      }
    | undefined;
  return {
    incrementalCachePresent: Boolean(store?.incrementalCache),
    pendingPublications: Object.keys(store?.pendingRevalidates ?? {}).length,
    flags: {
      workStorePresent: Boolean(store),
      fetchCache: store?.fetchCache ?? null,
      isOnDemandRevalidate: store ? Boolean(store.isOnDemandRevalidate) : null,
      incrementalCacheIsOnDemandRevalidate: store?.incrementalCache
        ? Boolean(store.incrementalCache.isOnDemandRevalidate)
        : null,
      isDraftMode: store ? Boolean(store.isDraftMode) : null,
    },
  };
}

/**
 * Tell a cache HIT from a cache MISS without instrumenting the selector.
 *
 * THE PRIMARY SIGNAL IS THE CACHE'S OWN WRITE RECORD, not the clock. On a miss
 * inside an App Route, `unstable_cache` assigns its publication to
 * `workStore.pendingRevalidates[invocationKey]` (Next drains the map through
 * `pendingWaitUntil` after the response). So a cached read that grew that map
 * PUBLISHED an entry, and one that did not returned something already there.
 * This is a direct observation of the thing the verdict is about, it is
 * per-request so it is concurrency-safe, and it does not care which instance
 * warmed the entry.
 *
 * `generatedAt` CORROBORATES it and separates one case the write record alone
 * cannot. Every snapshot constructor stamps `generatedAt: currentDate.toISOString()`,
 * and `currentDate` is deliberately not part of the cache key — the closure
 * captures whichever request warmed the entry — so a stamp equal to the one THIS
 * request supplied means this request computed the value. A publication WITHOUT
 * that stamp is a background revalidation of a stale entry: `unstable_cache`
 * returns the stale value and queues a recompute, which is a hit, not a miss.
 * (`revalidate: false` maps to a one-year ceiling rather than true immortality,
 * so this is reachable, just not soon.)
 *
 * WHAT NEITHER SIGNAL CATCHES, stated because an earlier version of this comment
 * claimed a test covered it and the mutation survived: the route passes
 * `currentDate: probe` so the stamp is deterministic. Dropping that would leave
 * the selector to call `new Date()` itself, microseconds later — usually the
 * same millisecond, so usually the same answer, and intermittently not. No test
 * here reddens on that, because the defect IS the intermittency. Making the
 * publication count primary is what removes the dependence; the stamp is no
 * longer load-bearing for the hit/miss split.
 *
 * WHY NOT COUNT COMPUTE EXECUTIONS, which was the first mechanism proposed: a
 * counter has to live inside `leagueStandings.ts` (the compute call is inside
 * the cache closure, so a counter here would see only this route's own fresh
 * call), and it is PER-INSTANCE. On Fluid the data cache is shared across
 * instances and an in-process counter is not, so a hit on an entry another
 * instance wrote would read as a miss.
 *
 * Asserted by `reportsMissAgainstAnEmptyCache` and
 * `reportsHitAgainstAWarmSnapshot`; `reportsUnavailableWithoutAnIncrementalCache`
 * covers the third verdict.
 */
function classifyCacheRead(
  snapshot: CanonicalStandings,
  probeStamp: string,
  before: CacheContext,
  after: CacheContext
): { verdict: CacheReadVerdict; publishedEntry: boolean; backgroundRevalidation: boolean } {
  if (!before.incrementalCachePresent) {
    return { verdict: 'unavailable', publishedEntry: false, backgroundRevalidation: false };
  }
  const publishedEntry = after.pendingPublications > before.pendingPublications;
  const computedHere = snapshot.generatedAt === probeStamp;
  if (publishedEntry && computedHere) {
    return { verdict: 'miss', publishedEntry, backgroundRevalidation: false };
  }
  // Published but returned someone else's value: a stale entry served while its
  // replacement recomputes. The caller read the cache, so it is a hit.
  return { verdict: 'hit', publishedEntry, backgroundRevalidation: publishedEntry };
}

function cacheReadRestsOn(
  verdict: CacheReadVerdict,
  probeStamp: string,
  backgroundRevalidation: boolean
): string {
  switch (verdict) {
    case 'unavailable':
      return 'no incrementalCache on the request work store, so getCanonicalStandings fell back to a direct compute (leagueStandings.ts catches "incrementalCache missing"); nothing was read from or written to the data cache and no snapshot exists';
    case 'miss':
      return `the cached read queued a data-cache publication on workStore.pendingRevalidates AND returned generatedAt === ${probeStamp}, the currentDate this request supplied — so THIS REQUEST computed the snapshot; the cached and fresh sides are two computations of the same inputs seconds apart and their agreement means nothing`;
    case 'hit':
      return backgroundRevalidation
        ? `the cached read returned an EXISTING snapshot (generatedAt is not ${probeStamp}) while queueing a recompute — a stale entry served with a background revalidation behind it; the value compared below is the stale one`
        : 'the cached read queued no data-cache publication, so an existing snapshot was returned; its generatedAt is when that snapshot was warmed';
  }
}

function orderedSides(snapshot: CanonicalStandings): Map<string, OwnerSide> {
  const sides = new Map<string, OwnerSide>();
  // `rows` is already in canonical order (`compareStandingsRows`) and excludes
  // NoClaim; rank is that position, derived here and labelled as derived.
  snapshot.rows.forEach((row, index) => {
    sides.set(row.owner, { rank: index + 1, isNoClaim: false, row });
  });
  // NoClaim is folded into the SAME comparison rather than left out. Omitting it
  // would put a real divergence — the unclaimed pool changing shape — in the one
  // place the report does not look, which is the blind spot this route exists to
  // remove. It carries no rank because it sits outside the canonical order.
  if (snapshot.noClaimRow) {
    sides.set(NO_CLAIM_OWNER, { rank: 0, isNoClaim: true, row: snapshot.noClaimRow });
  }
  return sides;
}

function compareOwners(
  cached: CanonicalStandings,
  fresh: CanonicalStandings
): { comparedOwners: number; differences: OwnerDifference[] } {
  const cachedSides = orderedSides(cached);
  const freshSides = orderedSides(fresh);
  const owners = [...new Set([...cachedSides.keys(), ...freshSides.keys()])].sort((a, b) =>
    a.localeCompare(b)
  );

  const differences: OwnerDifference[] = [];
  for (const owner of owners) {
    const left = cachedSides.get(owner);
    const right = freshSides.get(owner);
    const isNoClaim = (left ?? right)!.isNoClaim;

    if (!left || !right) {
      const present = (left ?? right)!;
      differences.push({
        owner,
        isNoClaim,
        presence: left ? 'cached-only' : 'fresh-only',
        fields: COMPARED_FIELDS.map((field) => ({
          field,
          cached: left ? present.row[field] : null,
          fresh: left ? null : present.row[field],
        })),
      });
      continue;
    }

    const fields: FieldDifference[] = [];
    for (const field of COMPARED_FIELDS) {
      if (left.row[field] !== right.row[field]) {
        fields.push({ field, cached: left.row[field], fresh: right.row[field] });
      }
    }
    if (!isNoClaim && left.rank !== right.rank) {
      fields.push({ field: 'rank', cached: left.rank, fresh: right.rank });
    }
    if (fields.length > 0) {
      differences.push({ owner, isNoClaim, presence: 'both', fields });
    }
  }

  return { comparedOwners: owners.length, differences };
}

function compareSnapshotFields(
  cached: CanonicalStandings,
  fresh: CanonicalStandings
): SnapshotFieldDifference[] {
  // `generatedAt` is deliberately absent: on a HIT it differs between the two
  // sides by construction — the cached side carries the warming request's stamp
  // and the fresh side carries this request's — so including it would put a
  // guaranteed entry in a list whose EMPTINESS is the signal. It is reported
  // under `cacheRead`/`freshness` instead, where its difference is the point.
  // Every field below can differ ONLY because the inputs moved.
  const fields: Array<[string, string | number | null, string | number | null]> = [
    ['year', cached.year, fresh.year],
    ['source', cached.source, fresh.source],
    ['lifecycle', cached.lifecycle, fresh.lifecycle],
    ['ownersRosterSource', cached.ownersRosterSource, fresh.ownersRosterSource],
    ['archiveYearResolved', cached.archiveYearResolved, fresh.archiveYearResolved],
    ['coverage.state', cached.coverage.state, fresh.coverage.state],
    ['inferredSeasonStart', cached.inferredSeasonStart, fresh.inferredSeasonStart],
    [
      'standingsHistory.weeks',
      cached.standingsHistory?.weeks.length ?? null,
      fresh.standingsHistory?.weeks.length ?? null,
    ],
  ];
  return fields
    .filter(([, left, right]) => left !== right)
    .map(([field, cachedValue, freshValue]) => ({
      field,
      cached: cachedValue,
      fresh: freshValue,
    }));
}

export async function GET(req: Request): Promise<Response> {
  const authFailure = await requireAdminAuth(req);
  if (authFailure) return authFailure;

  const url = new URL(req.url);
  const leagueSlug = url.searchParams.get('leagueSlug')?.trim() ?? '';
  if (!leagueSlug) {
    return NextResponse.json({ error: 'leagueSlug is required' }, { status: 400 });
  }

  const now = new Date();
  // `resolveStandingsYear` reads the registry again below. `getLeague` is
  // `React.cache`-wrapped, and React.cache does NOT dedupe inside a Route
  // Handler — measured on this repo under #778 (RSC page 1 registry read, route
  // handler 3). So this is two reads, not one, and it is named rather than
  // assumed away. Both are needed: the bound needs the league before the year is
  // resolved, and the resolution needs the year before the cache is keyed.
  const league = await getLeague(leagueSlug);
  const yearResolution = resolveRequestedYear(url.searchParams.get('year'), league, now);
  if (!yearResolution.ok) {
    // Refused BEFORE any build and before any cached read, so a rejected year
    // mints no `unstable_cache` entry. Asserted by
    // `rejectsAnOutOfRangeYearBeforeAnyBuild`.
    return NextResponse.json({ error: yearResolution.error }, { status: 400 });
  }
  const yearOverride = yearResolution.year;

  const resolvedYear = await resolveStandingsYear(leagueSlug, yearOverride);

  // ONE Date for both sides. The cached read needs it as the detector's probe
  // stamp; the fresh rebuild takes the same value so the only difference between
  // the two snapshots is the DATA. Giving the fresh side its own `new Date()`
  // would manufacture a `lifecycle` difference the cache had nothing to do with.
  const probe = now;
  const probeStamp = probe.toISOString();

  // Bracket the cached read. `resolveStandingsYear` above has already run, so
  // any publication it made (the archive-years cache, on an offseason league)
  // is on the BEFORE side and cannot be mistaken for the standings entry.
  const cacheContextBefore = readCacheContext();
  const cached = await getCanonicalStandings({
    slug: leagueSlug,
    ...(yearOverride != null ? { year: yearOverride } : {}),
    currentDate: probe,
  });
  const cacheContextAfter = readCacheContext();
  const { verdict, publishedEntry, backgroundRevalidation } = classifyCacheRead(
    cached,
    probeStamp,
    cacheContextBefore,
    cacheContextAfter
  );

  const fresh = await computeCanonicalStandingsUncached({
    slug: leagueSlug,
    year: yearOverride,
    currentDate: probe,
  });

  const { comparedOwners, differences } = compareOwners(cached, fresh);
  const snapshotDifferences = compareSnapshotFields(cached, fresh);

  return NextResponse.json({
    leagueSlug,
    leagueRegistered: league !== null,
    year: {
      resolved: resolvedYear,
      source: yearOverride != null ? 'parameter' : 'resolveStandingsYear',
      parameter: yearOverride,
    },
    cacheRead: {
      verdict,
      restsOn: cacheReadRestsOn(verdict, probeStamp, backgroundRevalidation),
      // The primary signal, printed so the verdict can be checked rather than
      // taken on trust.
      publishedEntry,
      backgroundRevalidation,
      probeStamp,
      cachedGeneratedAt: cached.generatedAt,
      // On a MISS the cached read WROTE a data-cache entry: `unstable_cache`
      // stores the computed value through `workStore.pendingRevalidates`, which
      // the App Route drains after the response. That entry is the snapshot every
      // member surface then reads, so this route is read-only with respect to
      // `app_state` and NOT with respect to the Next data cache. The word for it
      // is published, not written, and it is the same publication a member page
      // visit performs — but it is a durable effect and it gets named.
      dataCacheWritten: publishedEntry,
      ...cacheContextBefore,
    },
    freshness: {
      // WHAT "FRESH" MEANS HERE, stated in the payload because a clean result is
      // otherwise read as more than it proves.
      //
      // `computeCanonicalStandingsUncached` skips the canonical-standings cache
      // and nothing else. `getSeasonArchive` and `listSeasonArchives` carry
      // their OWN tag-only `unstable_cache` (`seasonArchive.ts`,
      // `revalidate: false`), and BOTH sides read through it — so on an
      // `archive`-sourced league a stale archive entry is invisible to this
      // route: the rebuild reads the same cached archive the warm snapshot was
      // built from, and the two agree. Pinned by
      // `nestedSeasonArchiveCacheIsSharedByBothSides` in the route suite.
      //
      // Every other canonical input is a direct `getAppState` — owners CSV,
      // schedule cache, scores cache, team catalog, alias scopes, postseason
      // overrides, preseason owners — so a `live` or `preseason-names` snapshot
      // IS compared against genuinely re-read inputs.
      freshSideBypasses: 'the canonical-standings unstable_cache only',
      // ONE CLOCK, BOTH SIDES, and this is how you check it. Every snapshot
      // constructor stamps `generatedAt: currentDate.toISOString()`, so a fresh
      // rebuild given the same `probe` stamps the same value. If these two ever
      // differ, the two sides were computed at different wall-clocks and any
      // `lifecycle` difference below is an artefact of that, not of the cache.
      // Asserted by `theFreshRebuildSharesTheProbeClock`.
      freshGeneratedAt: fresh.generatedAt,
      clockIsShared: fresh.generatedAt === probeStamp,
      caveat:
        'the season archive has its own tag-only unstable_cache that BOTH sides read through, so a stale archive entry cannot be detected here; sources other than "archive" re-read every input from the store',
      cachedSource: cached.source,
      freshSource: fresh.source,
      comparisonIsMeaningfulForSource: fresh.source !== 'archive',
    },
    comparison: {
      // Printed so a zero-length comparison cannot read as agreement. `matches`
      // is gated on it below, and on the cache verdict.
      comparedOwners,
      cachedOwners: cached.rows.length + (cached.noClaimRow ? 1 : 0),
      freshOwners: fresh.rows.length + (fresh.noClaimRow ? 1 : 0),
      unit: 'owner',
      comparedFields: COMPARED_FIELDS,
      derivedFields: ['rank'],
      excluded: EXCLUDED_FIELD_NOTE,
      // NULL, not `true`, when the cached side was not a pre-existing snapshot.
      //
      // On a MISS the cached read COMPUTED the value it returned, so the two
      // sides are the same computation over the same inputs seconds apart and
      // they agree by construction. Reporting `matches: true` there would be a
      // clean report from a review of nothing wearing a clean report's shape —
      // byte-identical, at this field, to a genuine agreement, and only one of
      // them means anything. `unavailable` is the same: there is no cached side
      // at all. A zero-owner comparison is `false` for the matching reason —
      // agreement over an empty population is not agreement.
      //
      // Asserted by `reportsMissAgainstAnEmptyCache` (null on a miss) and
      // `reportsHitAgainstAWarmSnapshot` (true only on a hit).
      matches:
        verdict !== 'hit'
          ? null
          : comparedOwners > 0 && differences.length === 0 && snapshotDifferences.length === 0,
      notComparableBecause:
        verdict === 'hit'
          ? null
          : `cacheRead is "${verdict}", so the cached side is not a pre-existing snapshot and the two sides agreeing carries no information`,
      differences,
      snapshotDifferences,
    },
  });
}

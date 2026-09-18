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
import type { StandingsHistory } from '@/lib/standingsHistory';

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
 *
 * `ties` is absent and cannot be added honestly: `deriveStandings` drops a final
 * tie (`console.warn` + `continue`), so no game contributes one, and the only
 * tie count in the system is the hardcoded `ties: 0` that `toHistoryStandingsRows`
 * writes onto archive rows. An archive-sourced row therefore carries an
 * undeclared, fabricated `ties` and a selector-built row carries no such key —
 * pinned by `archiveRowsCarryAFabricatedTieCountAndLiveRowsCarryNone`. The
 * payload ships this list, not a sentence about it: an earlier `excluded` string
 * asserted "no row carries a tie count", which that same test refutes.
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
 * Caches BOTH sides read through, so a divergence behind one of them is
 * invisible to this route.
 *
 * `computeCanonicalStandingsUncached` skips the canonical-standings cache and
 * nothing below it. These two are the whole set: every other canonical input —
 * owners CSV, schedule cache, scores cache, team catalog, alias scopes,
 * postseason overrides, preseason owners — is a direct `getAppState`.
 *
 * The archive-YEARS read is the one that surprised review: `resolveSeason` calls
 * `listSeasonArchives` on every season compute, not only on archive-sourced
 * leagues, so this exposure is not limited to `source === 'archive'`.
 * `sharedNestedCachesAreEnumeratedCompletely` fails if `seasonArchive.ts` gains
 * another `unstable_cache` site, which is what keeps this list honest.
 */
const SHARED_NESTED_CACHES = [
  'seasonArchive: archive years per league (read on every season/offseason compute)',
  'seasonArchive: archive by league and year (read when that year is listed)',
] as const;

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

/**
 * FOUR values, not the three this slice's receipt named. `bypassed` was added at
 * review: `unstable_cache` skips its read AND its publication when
 * `workStore.isDraftMode` (`unstable-cache.js:143` and `:204` — the flag gates
 * both), so a draft-mode request recomputes and publishes nothing. That is
 * neither a hit (no existing snapshot was returned) nor a miss (no snapshot was
 * created), and reporting it as either is the confident-falsehood-about-durable-
 * state class this route exists to prevent. An earlier comment here listed
 * `isDraftMode` alongside the flags that present as a perpetual MISS; that was
 * backwards, because those other flags still publish.
 */
type CacheReadVerdict = 'hit' | 'miss' | 'bypassed' | 'unavailable';

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
  /** Narrower than the above: the work store's own cache, absent the global. */
  workStoreCachePresent: boolean;
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
 * The flags are REPORTED, not asserted — and they do NOT all behave alike, which
 * an earlier version of this comment got backwards. `fetchCache ===
 * 'force-no-store'` and either `isOnDemandRevalidate` make `unstable_cache` skip
 * its READ and recompute, but it still PUBLISHES, so they present as a perpetual
 * `miss`. `isDraftMode` gates the read AND the publication
 * (`unstable-cache.js:143` and `:204`), so it presents as neither — it is why
 * the `bypassed` verdict exists. Printing all of them lets a reader tell any of
 * these apart from a genuinely cold cache without redeploying.
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
    // `unstable_cache` resolves its cache as
    // `workStore?.incrementalCache || globalThis.__incrementalCache`
    // (`unstable-cache.js:60`), and a Next server sets that global process-wide
    // (`base-server.js:852`). Checking only the work store would report
    // `unavailable` — and "nothing was read from or written to the data cache" —
    // for a request whose read went through the global and whose `set` was
    // AWAITED INLINE on the no-workStore branch. Reported as a false negative on
    // durable state, which is the one thing this field must not produce.
    incrementalCachePresent:
      Boolean(store?.incrementalCache) ||
      Boolean((globalThis as { __incrementalCache?: unknown }).__incrementalCache),
    workStoreCachePresent: Boolean(store?.incrementalCache),
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
/**
 * Which verdicts still rest on millisecond-precision timestamps, and which do
 * not — reported so a reader can tell without knowing this file.
 *
 * Gating `bypassed` on the observed `isDraftMode` flag removed the stamp from
 * the no-publication case on the work-store path. Two residuals remain and are
 * NOT fixed:
 *
 *  - the INLINE branch (no work store) has no publication record at all, so the
 *    stamp is its only signal: a hit warmed in this request's millisecond reads
 *    as `miss`;
 *  - on the work-store path, a STALE entry served with a background
 *    revalidation queues a publication, so `miss` and `hit`-with-revalidation
 *    are separated by the stamp alone: a stale hit warmed in this millisecond
 *    reads as `miss`.
 *
 * Both need a same-millisecond coincidence with the warming request. Neither is
 * removable without a per-execution identity `unstable_cache` does not expose.
 */
function provenanceRestsOnTimestamp(before: CacheContext, queuedPublication: boolean): boolean {
  if (!before.incrementalCachePresent) return false;
  if (!before.workStoreCachePresent) return true;
  if (before.flags.isDraftMode === true) return false;
  return queuedPublication;
}

function classifyCacheRead(
  snapshot: CanonicalStandings,
  probeStamp: string,
  before: CacheContext,
  after: CacheContext
): {
  verdict: CacheReadVerdict;
  queuedPublication: boolean;
  publicationConfirmed: boolean;
  backgroundRevalidation: boolean;
} {
  const computedHere = snapshot.generatedAt === probeStamp;
  if (!before.incrementalCachePresent) {
    return {
      verdict: 'unavailable',
      queuedPublication: false,
      publicationConfirmed: false,
      backgroundRevalidation: false,
    };
  }

  // THE PUBLICATION SIGNAL ONLY EXISTS ON THE WORK-STORE BRANCH, and round 1
  // shipped a HIGH by forgetting it. `unstable_cache` publishes one of two ways
  // (`unstable-cache.js`): with a work store it DEFERS into
  // `pendingRevalidates[invocationKey]` (`:211`); without one it `await`s
  // `cacheNewResult` INLINE (`:249`) and never touches that map. Round 1 widened
  // `incrementalCachePresent` to cover the global cache but left the signal
  // reading `store?.pendingRevalidates` — so on the inline branch the delta is
  // structurally zero, a cold read fell through to `bypassed`, and the route
  // reported "nothing was stored, no snapshot exists" for a request that had
  // just durably written two entries.
  //
  // On the inline branch `computedHere` alone is the correct and complete
  // signal, and it is STRONGER than the deferred one: the set was awaited before
  // the value came back, so a returned value means the write landed. That is the
  // one place this route can say CONFIRMED rather than queued.
  if (!before.workStoreCachePresent) {
    // RESIDUAL, NAMED RATHER THAN IMPLIED: this branch has no publication record
    // at all (`unstable-cache.js:249` awaits `cacheNewResult` inline and never
    // touches `pendingRevalidates`), so the stamp is the ONLY available signal
    // and the same-millisecond collision is not removable here. A hit warmed in
    // this request's millisecond still reads as `miss`. Reported as
    // `provenanceRestsOnTimestamp: true` so a reader can see which verdicts are
    // exposed to it instead of having to know this file.
    return {
      verdict: computedHere ? 'miss' : 'hit',
      queuedPublication: false,
      publicationConfirmed: computedHere,
      backgroundRevalidation: false,
    };
  }

  const queuedPublication = after.pendingPublications > before.pendingPublications;
  if (queuedPublication && computedHere) {
    return {
      verdict: 'miss',
      queuedPublication,
      publicationConfirmed: false,
      backgroundRevalidation: false,
    };
  }
  if (queuedPublication) {
    // Queued a publication but returned someone else's value: a stale entry
    // served while its replacement recomputes. The caller read the cache.
    return {
      verdict: 'hit',
      queuedPublication,
      publicationConfirmed: false,
      backgroundRevalidation: true,
    };
  }
  if (before.flags.isDraftMode === true) {
    // BYPASSED IS GATED ON THE OBSERVED FLAG, NOT ON THE STAMP.
    //
    // `isDraftMode` gates the read AND the publication alike
    // (`unstable-cache.js:143` and `:204`), so it is the only way a request can
    // recompute with a cache present and store nothing — and it is directly
    // observable on the work store. Deriving this verdict by ELIMINATION
    // instead, as "no publication and the stamp matches", made a genuine hit
    // read as `bypassed` whenever the warming request happened to land in the
    // same millisecond as this one. That was reported by both reviewers three
    // times, and reproduced in this repo's own suite before the tests were
    // pinned to a fixed clock.
    return {
      verdict: 'bypassed',
      queuedPublication,
      publicationConfirmed: false,
      backgroundRevalidation: false,
    };
  }
  return {
    verdict: 'hit',
    queuedPublication,
    publicationConfirmed: false,
    backgroundRevalidation: false,
  };
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

/**
 * One side's values for one owner, or `null` when that side has no such owner.
 *
 * `rank` rides inside the side rather than beside it because the prompt asks for
 * final position FOR BOTH SIDES, and the two sides can order the same owner
 * differently — which is the whole point of printing it. NoClaim carries `null`:
 * it sits outside the canonical order, so it has no position to report.
 */
type OwnerProjection = ({ rank: number | null } & Pick<OwnerStandingsRow, ComparedField>) | null;

type OwnerComparison = {
  owner: string;
  isNoClaim: boolean;
  cached: OwnerProjection;
  fresh: OwnerProjection;
};

function projectSide(side: OwnerSide | undefined): OwnerProjection {
  if (!side) return null;
  const projection = { rank: side.isNoClaim ? null : side.rank } as {
    rank: number | null;
  } & Record<ComparedField, number>;
  for (const field of COMPARED_FIELDS) projection[field] = side.row[field];
  return projection;
}

function compareOwners(
  cached: CanonicalStandings,
  fresh: CanonicalStandings
): { comparedOwners: number; differences: OwnerDifference[]; owners: OwnerComparison[] } {
  const cachedSides = orderedSides(cached);
  const freshSides = orderedSides(fresh);
  const owners = [...new Set([...cachedSides.keys(), ...freshSides.keys()])].sort((a, b) =>
    a.localeCompare(b)
  );

  // BOTH SIDES FOR EVERY COMPARED OWNER, not only the ones that differ.
  //
  // The prompt asks for this outright and I shipped only `differences`, which
  // meant the PRIMARY SUCCESS CASE — cached and fresh agree — returned a count
  // and a list of field names and no values at all. An operator could not see
  // what had actually been compared, which is the same "a clean report must be
  // readable as evidence" argument the rest of this route is built on. Two full
  // review rounds missed it because both sides reported against the receipt's
  // rulings rather than against the prompt's acceptance list; the rulings
  // amended the UNIT and the FIELD SET and never removed this.
  const projections: OwnerComparison[] = owners.map((owner) => ({
    owner,
    isNoClaim: (cachedSides.get(owner) ?? freshSides.get(owner))!.isNoClaim,
    cached: projectSide(cachedSides.get(owner)),
    fresh: projectSide(freshSides.get(owner)),
  }));

  const differences: OwnerDifference[] = [];
  for (const owner of owners) {
    const left = cachedSides.get(owner);
    const right = freshSides.get(owner);
    const isNoClaim = (left ?? right)!.isNoClaim;

    if (!left || !right) {
      const present = (left ?? right)!;
      const fields: FieldDifference[] = COMPARED_FIELDS.map((field) => ({
        field,
        cached: left ? present.row[field] : null,
        fresh: left ? null : present.row[field],
      }));
      // Rank travels with the one-sided rows too. The response advertises it as
      // a derived field, and omitting it here made the payload inconsistent
      // between the two difference shapes for no reason. NoClaim has no rank
      // because it sits outside the canonical order.
      if (!isNoClaim) {
        fields.push({
          field: 'rank',
          cached: left ? present.rank : null,
          fresh: left ? null : present.rank,
        });
      }
      differences.push({
        owner,
        isNoClaim,
        presence: left ? 'cached-only' : 'fresh-only',
        fields,
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

  return { comparedOwners: owners.length, differences, owners: projections };
}

/**
 * A per-week digest of a standings history, stable across key order.
 *
 * Deliberately NOT a whole-object hash: two opaque digests tell a reader that
 * something differs and nothing about what, and this route's job is to name the
 * divergence. Each week contributes its `played` flag, its coverage state and a
 * canonical projection of its standing rows, so the first differing week is
 * reported by name.
 */
function digestHistoryWeek(history: StandingsHistory, week: number): string {
  const snapshot = history.byWeek[week];
  if (!snapshot) return 'absent';
  const rows = [...snapshot.standings]
    .map((row) => `${row.owner}:${row.wins}-${row.losses}:${row.pointsFor}/${row.pointsAgainst}`)
    .sort()
    .join('|');
  // `pending` belongs here for the same reason `played` does, and leaving it out
  // was a review finding. `standingsHistory.ts` says it outright one line above
  // `played`: the elapsed-time allowance is deliberately NOT folded into
  // `played` because that would cache a clock-dependent classification, so
  // "`pending` carries what a consumer needs to apply the clock itself" — and
  // `selectSeasonContext` applies the eight-hour abandonment rule to it at
  // request time. A kickoff corrected on an unresolved game moves `pending` and
  // moves nothing else: same rows, same `played`, same coverage. Without this
  // the route reports a clean match over a history that decides finality
  // differently.
  const pending = [...(snapshot.pending ?? [])]
    .map((game) => `${game.key}@${game.kickoff ?? 'unplanned'}`)
    .sort()
    .join('|');
  return `played=${String(snapshot.played)};coverage=${snapshot.coverage.state};pending=${pending};rows=${rows}`;
}

function compareHistories(
  cached: StandingsHistory | null,
  fresh: StandingsHistory | null
): Array<[string, string | number | null, string | number | null]> {
  if (!cached || !fresh) {
    return cached === fresh
      ? []
      : [['standingsHistory', cached ? 'present' : null, fresh ? 'present' : null]];
  }
  const out: Array<[string, string | number | null, string | number | null]> = [];
  const cachedWeeks = cached.weeks.join(',');
  const freshWeeks = fresh.weeks.join(',');
  if (cachedWeeks !== freshWeeks) {
    out.push(['standingsHistory.weeks', cachedWeeks, freshWeeks]);
  }
  for (const week of [...new Set([...cached.weeks, ...fresh.weeks])].sort((a, b) => a - b)) {
    const left = digestHistoryWeek(cached, week);
    const right = digestHistoryWeek(fresh, week);
    if (left !== right) out.push([`standingsHistory.week${week}`, left, right]);
  }
  // `byOwner` is a projection of the same weeks, so its size is a cheap check
  // that the two projections agree on the owner set even when every week does.
  const cachedOwners = Object.keys(cached.byOwner).length;
  const freshOwners = Object.keys(fresh.byOwner).length;
  if (cachedOwners !== freshOwners) {
    out.push(['standingsHistory.byOwner', cachedOwners, freshOwners]);
  }
  return out;
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
  ];

  // THE HISTORY IS COMPARED BY CONTENT, NOT BY LENGTH.
  //
  // Comparing `weeks.length` alone was a detection gap both reviewers found, and
  // the case is not hypothetical: `STANDINGS_HISTORY_SHAPE_VERSION` exists
  // precisely because a week's `played` flag can flip meaning across a deploy,
  // and `selectSeasonContext` reads it to decide whether a season is FINAL. A
  // flip there changes no week count and no owner row — `deriveStandings` even
  // drops final ties outright — so the old comparison reported a clean match
  // over a snapshot that would tell Overview and Trends the wrong thing.
  fields.push(...compareHistories(cached.standingsHistory, fresh.standingsHistory));
  return fields
    .filter(([, left, right]) => left !== right)
    .map(([field, cachedValue, freshValue]) => ({
      field,
      cached: cachedValue,
      fresh: freshValue,
    }));
}

/**
 * Why a comparison that found NOTHING cannot be read as agreement.
 *
 * An enum, not a sentence. The prose version of this field was wrong in review
 * twice — it asserted "nothing could have differed" over a payload that listed
 * differences, and it asserted that non-archive sources re-read every input when
 * they do not. A code carries the same information, is checked by the tests that
 * name it, and cannot drift from the predicate that produced it.
 */
type ComparisonBlocker =
  /** The cached side was not a pre-existing snapshot, so both sides are one computation. */
  | 'cached-side-not-a-snapshot'
  /** Both sides derive from the season archive, read through one shared nested cache. */
  | 'shared-archive-cache'
  /** No owners on either side; there was no population in which to differ. */
  | 'empty-population';

/**
 * The single place that decides whether an EMPTY result can be read as
 * agreement. Returns `null` when it can.
 *
 * IT GATES ABSENCE ONLY. A blocker says "finding nothing proves nothing here";
 * it never invalidates something the comparison actually found. Round 1 applied
 * these to `matches` unconditionally, so an ownerless snapshot whose `source`
 * had moved reported `matches: null` and "nothing could have differed" while
 * `snapshotDifferences` listed the difference in the same payload. A positive
 * finding is evidence under every blocker in this list.
 */
function resolveComparisonBlocker(input: {
  verdict: CacheReadVerdict;
  freshSource: CanonicalStandings['source'];
  comparedOwners: number;
}): ComparisonBlocker | null {
  if (input.verdict !== 'hit') return 'cached-side-not-a-snapshot';
  if (input.freshSource === 'archive') return 'shared-archive-cache';
  if (input.comparedOwners === 0) return 'empty-population';
  return null;
}

/**
 * What a `matches: true` does NOT cover — the shared inputs that can make both
 * sides agree for a reason other than the cache being correct.
 *
 * A BLIND SPOT IS NOT A BLOCKER, and collapsing the two would have been the
 * wrong fix. `resolveSeason` and `resolveOffseason` both read
 * `listSeasonArchives`, which carries its own tag-only `unstable_cache`, so a
 * stale years list makes `archiveYears.includes(year)` false on BOTH sides and
 * both take the live branch — the route then reports agreement over exactly the
 * fault it exists to find. But the rows on that path are still independently
 * re-derived from the owners CSV, schedule, scores, catalog, aliases and
 * overrides, every one of them a direct `getAppState`. Blocking `matches`
 * outright for every season league would make the route answer `null` for
 * essentially every real request and detect nothing at all.
 *
 * So the total block stays scoped to `source === 'archive'`, where the ROWS
 * THEMSELVES come through the shared cache and the rebuild cannot diverge at
 * all; and this names the narrower exposure so a reader can tell "the two sides
 * agree" from "the two sides read the same possibly-stale input". That
 * distinction is the whole point — a clean verdict that cannot make it is the
 * failure shape this route was built to stop producing.
 *
 * `preseason` is absent on purpose: `resolvePreseason` never calls
 * `listSeasonArchives`. Pinned by `namesTheArchiveYearsBlindSpotPerLifecycle`.
 */
function resolveBlindSpots(statusState: LeagueStatus['state'] | undefined): string[] {
  // `computeCanonicalStandings` synthesises `{ state: 'season' }` when the
  // registry holds no status, so an absent status reads the archive-years cache
  // exactly as a season league does.
  const state = statusState ?? 'season';
  if (state !== 'season' && state !== 'offseason') return [];
  return [
    'stale-archive-years-list: resolveSeason/resolveOffseason read listSeasonArchives through its own tag-only unstable_cache, so a stale years list sends BOTH sides down the live branch and they agree for that reason rather than because the snapshot is current',
  ];
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

  // UNKNOWN SLUG IS REFUSED, and the argument is the one twenty lines up in
  // `resolveRequestedYear` — which I made for `year` and failed to apply to the
  // sibling parameter until review pointed at it. `getCanonicalStandings` on an
  // unregistered slug does not decline: it computes an empty snapshot and
  // PUBLISHES it under `canonicalStandingsCacheKeyParts(slug, null)` with
  // `revalidate: false`, i.e. a year-long entry keyed on an arbitrary
  // caller-supplied string. Nothing can ever reclaim it — the only things that
  // fire `standings:<slug>` are mutations that walk the registry, and this slug
  // is in no registry. #778 settled the identical hazard for the season-archive
  // readers (`seasonArchive.ts`, "THE UNKNOWN-SLUG GUARD"); this is the same
  // guard for the same reason.
  //
  // 404 rather than 400: the parameter is well-formed, the league is absent.
  // Asserted by `refusesAnUnregisteredLeagueBeforeTouchingTheCache`.
  if (!league) {
    return NextResponse.json(
      {
        error: 'league-not-registered',
        detail: `no league is registered under slug "${leagueSlug}"`,
      },
      { status: 404 }
    );
  }

  // ENTRY READING, TAKEN BEFORE YEAR RESOLUTION.
  //
  // `resolveStandingsYear` consults `listSeasonArchives` on an offseason league,
  // and that read carries its own `unstable_cache` — so on a cold archive-years
  // cache it queues a publication BEFORE the verdict's bracket opens. The
  // bracket deliberately starts after this call so a year-resolution write
  // cannot be mistaken for the standings entry, and I recorded that as
  // protection against a false POSITIVE without noticing it left a false
  // NEGATIVE in the summary: a request that queued a publication could report
  // `dataCachePublicationQueued: false`. The verdict still reads the narrow
  // bracket; the SUMMARY reads from here.
  const cacheContextAtEntry = readCacheContext();
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
  const { verdict, queuedPublication, publicationConfirmed, backgroundRevalidation } =
    classifyCacheRead(cached, probeStamp, cacheContextBefore, cacheContextAfter);

  const fresh = await computeCanonicalStandingsUncached({
    slug: leagueSlug,
    year: yearOverride,
    currentDate: probe,
  });
  // A THIRD reading, because the fresh rebuild has durable effects of its own.
  // It runs UN-NESTED, so `getSeasonArchive` / `listSeasonArchives` inside it go
  // through their own `unstable_cache` and publish on a cold archive cache.
  // Bracketing only the cached read meant a `hit` could report no data-cache
  // effect for a request that had queued one — in the field whose entire job is
  // naming this route's durable effects.
  const cacheContextAfterFresh = readCacheContext();

  const { comparedOwners, differences, owners: ownerProjections } = compareOwners(cached, fresh);
  const snapshotDifferences = compareSnapshotFields(cached, fresh);
  const differencesAreEmpty = differences.length === 0 && snapshotDifferences.length === 0;
  const blindSpots = resolveBlindSpots(league.status?.state);
  const comparisonBlocker = resolveComparisonBlocker({
    verdict,
    freshSource: fresh.source,
    comparedOwners,
  });

  return NextResponse.json({
    leagueSlug,
    year: {
      resolved: resolvedYear,
      source: yearOverride != null ? 'parameter' : 'resolveStandingsYear',
      parameter: yearOverride,
    },
    cacheRead: {
      verdict,
      // The primary signal, printed so the verdict can be checked rather than
      // taken on trust — BOTH sides of the bracket, since the verdict rests on
      // the delta and reporting one side leaves it unreconstructable.
      queuedPublication,
      // TRUE when this particular verdict could still be flipped by a
      // same-millisecond coincidence with the warming request; see
      // `provenanceRestsOnTimestamp`. Printed rather than left to the reader to
      // infer, because "the stamp problem is fixed" would be the wrong takeaway
      // from the `bypassed` gate alone.
      provenanceRestsOnTimestamp: provenanceRestsOnTimestamp(cacheContextBefore, queuedPublication),
      pendingPublicationsBefore: cacheContextBefore.pendingPublications,
      pendingPublicationsAfterCachedRead: cacheContextAfter.pendingPublications,
      pendingPublicationsAfterFreshRebuild: cacheContextAfterFresh.pendingPublications,
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
      // QUEUED, not written, and the distinction is this route's own subject.
      // `unstable_cache` inserts the `cacheNewResult` PROMISE into
      // `pendingRevalidates` and returns the computed value immediately; Next
      // awaits it only after the handler returns. If that `set` rejects, nothing
      // durable exists and this request can never know. Claiming "written" would
      // be a statement about durable state made before the state is durable.
      // EVERY publication this request queued, from entry to the end of the
      // fresh rebuild — year resolution, the cached read, and the rebuild's own
      // un-nested archive reads alike.
      dataCachePublicationQueued:
        cacheContextAfterFresh.pendingPublications > cacheContextAtEntry.pendingPublications,
      pendingPublicationsAtEntry: cacheContextAtEntry.pendingPublications,
      // CONFIRMED is only sayable on the inline-publication branch, where the set
      // was awaited before the value returned. On the work-store branch Next
      // drains `pendingRevalidates` after the handler, so this request cannot
      // know the write landed and must not say it did.
      dataCachePublicationConfirmed: publicationConfirmed,
      ...cacheContextBefore,
    },
    freshness: {
      // WHAT "FRESH" MEANS, as values rather than a paragraph. The prose that
      // stood here asserted that non-archive sources "re-read every input from
      // the store", and review showed that is false: `resolveSeason` calls
      // `listSeasonArchives` on EVERY season compute and it is `unstable_cache`-
      // wrapped, so both sides read through it whatever the source turns out to
      // be. `SHARED_NESTED_CACHES` states the exposure as an enumerated fact and
      // `sharedNestedCachesAreEnumeratedCompletely` fails if `seasonArchive.ts`
      // grows another cache site, so the list cannot quietly go stale the way
      // the sentence did.
      freshSideBypasses: 'canonical-standings' as const,
      sharedNestedCaches: SHARED_NESTED_CACHES,
      // One clock, both sides: every snapshot constructor stamps `generatedAt`
      // from the date it was handed, so these two are equal iff the rebuild ran
      // on the probe clock. Asserted by `theFreshRebuildSharesTheProbeClock`.
      freshGeneratedAt: fresh.generatedAt,
      clockIsShared: fresh.generatedAt === probeStamp,
      cachedSource: cached.source,
      freshSource: fresh.source,
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
      // NULL, NOT A BOOLEAN, WHENEVER THE COMPARISON CANNOT DETECT A DIVERGENCE.
      //
      // The first cut gated this on the cache verdict alone and both reviewers
      // found the same shape three more times. The gate is not "was the cached
      // side real" — it is "could this comparison have SEEN a difference if one
      // existed", and that fails in four distinct ways:
      //
      //  1. verdict !== 'hit' — on a miss the cached read COMPUTED the value it
      //     returned, so the two sides are one computation of one input set
      //     seconds apart and agree by construction. `bypassed` and
      //     `unavailable` have no cached side at all.
      //  2. source === 'archive' — both sides read the same nested, tag-only
      //     `getSeasonArchive` cache, so the rebuild cannot diverge from the
      //     snapshot however stale the archive is. The route already computed
      //     this as `freshness.comparisonIsMeaningfulForSource` and then failed
      //     to consult it; `nestedSeasonArchiveCacheIsSharedByBothSides` was
      //     ASSERTING the misleading `matches: true` it produced.
      //  3. comparedOwners === 0 — agreement over an empty population is not
      //     agreement. This previously reported `matches: false`, which is worse
      //     than either: an assertion of divergence with nothing to point at.
      //  4. anything the field set does not reach — named in `excluded` and
      //     `freshness.caveat` rather than silently folded in.
      //
      // Each of these is a "cannot tell", and a boolean has nowhere to put one.
      // Asserted by `reportsMissAgainstAnEmptyCache`,
      // `nestedSeasonArchiveCacheIsSharedByBothSides` and
      // `reportsNullRatherThanDisagreementOverAnEmptyPopulation`.
      // A blocker gates ABSENCE only: `false` whenever a difference was actually
      // found, whatever the blocker says, because a positive finding is evidence
      // under all of them.
      matches: differencesAreEmpty ? (comparisonBlocker === null ? true : null) : false,
      blockedBy: comparisonBlocker,
      // What a `true` here does NOT cover. Empty when nothing shared could have
      // manufactured the agreement.
      blindSpots,
      // Every compared owner with both sides' values — the success case has to be
      // readable, not just assertable.
      owners: ownerProjections,
      differences,
      snapshotDifferences,
    },
  });
}

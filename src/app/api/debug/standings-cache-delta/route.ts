import { workAsyncStorage } from 'next/dist/server/app-render/work-async-storage.external';
import { NextResponse } from 'next/server';

import { MIN_SEASON_YEAR, maxCreatableSeasonYear, type LeagueStatus } from '@/lib/league';
import { getLeague } from '@/lib/leagueRegistry';
import { listSeasonArchives } from '@/lib/seasonArchive';
import { resolveLeagueOperatingYear } from '@/lib/selectors/leagueLifecycle';
import {
  canonicalStandingsCacheKeyParts,
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
// Asserted by `reportsHitWhenNothingIsPublishedAndTheSnapshotPredatesTheRequest`,
// which would fail if the read were bypassed.

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
async function resolveRequestedYear(
  raw: string | null,
  leagueSlug: string,
  league: { status?: LeagueStatus | null; year: number } | null,
  now: Date
): Promise<YearResolution> {
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
    // #818 — THE ARCHIVED-SEASON DISJUNCT, on parity grounds.
    //
    // `resolveArchiveYearParam` in `seasonArchive.ts` admits a year the league
    // has actually archived, and this route cited that precedent while
    // implementing it more narrowly. Nothing in production needs it today —
    // measured on the read-only replica 2026-09-18, the archives are
    // `tsc/2018` and `tsc/2021-2025`, all inside `2000…2027`, so no archived
    // season is currently refused and #818's stated consequence does not hold.
    // It is taken because a route that names a precedent should implement it.
    //
    // THE COST, stated because it is the reason a bound exists at all: this
    // reads `listSeasonArchives`, which sits behind the same tag-only
    // `unstable_cache` both comparison sides read through. A STALE years list
    // therefore refuses a year that really is archived — the blind spot named in
    // `sharedNestedCaches`, reappearing in the guard. The refusal stays the safe
    // direction: a wrongly refused year costs a 400, a wrongly admitted one
    // mints a full-season rebuild and a year-long cache entry per distinct
    // value.
    // THE FLOOR GUARDS THE DISJUNCT TOO, and it is not redundancy — this is the
    // precedent's own review finding, which I cited and then failed to copy.
    // `readArchiveYearsFromStore` filters `n >= 2000`, so the list can never
    // contain a sub-floor value and consulting it for one is a store round-trip
    // whose result cannot change the answer. It matters because the read below
    // deliberately PROPAGATES failure: without this guard a store outage turns a
    // certain 400 into a 500. `seasonArchive.ts` carries the identical guard for
    // the identical reason after `/history/tsc/1999` did exactly that.
    if (parsed < MIN_SEASON_YEAR) {
      return {
        ok: false,
        error: `year must be an integer between ${MIN_SEASON_YEAR} and ${maxYear}, or a season this league has archived`,
      };
    }
    const archivedYears = await listSeasonArchives(leagueSlug);
    if (archivedYears.includes(parsed)) return { ok: true, year: parsed };
  }

  return {
    ok: false,
    error: `year must be an integer between ${MIN_SEASON_YEAR} and ${maxYear}, or a season this league has archived`,
  };
}

// ---------------------------------------------------------------------------
// THE DETECTOR — rebuilt for v2, and the rule it exists to obey is:
// DO NOT CLASSIFY BY ELIMINATION.
//
// v1's detector derived verdicts from what did NOT happen — nothing was queued,
// so it must be a hit; not draft mode, so it must be X — and every derivation
// was only as sound as an enumeration that kept turning out incomplete. Four
// review passes each added about three instances of that one class, including
// the round whose entire purpose was to remove it.
//
// So this version PUBLISHES WHAT IT OBSERVED and derives one thing, from values
// that are themselves printed. Where the observations do not determine an
// answer, the answer is that they do not — `cannot-tell`, never the nearest
// confident verdict.
// ---------------------------------------------------------------------------

/**
 * `cannot-tell` is a FIRST-CLASS OUTCOME, not an error path. Each of its three
 * rules names an observation that is missing rather than guessing past it.
 */
type CacheReadVerdict = 'hit' | 'miss' | 'cannot-tell';

type VerdictRule =
  /** A new publication key appeared AND the returned snapshot carries this request's stamp. */
  | 'published-and-stamped-here'
  /** A new key appeared but the value predates us: a stale entry served while its replacement recomputes. */
  | 'published-and-value-predates-request'
  /** No new key, and the value predates us. */
  | 'no-publication-and-value-predates-request'
  /** No new key and the stamp matches. Draft mode and a same-millisecond warm are BOTH consistent with this; see below. */
  | 'no-publication-and-stamp-matches'
  /** No work store, so `unstable_cache` publishes inline and leaves no record to read. */
  | 'publication-unobservable-inline-path'
  /** Neither the work store nor the global carried a cache; the value was direct-computed. */
  | 'no-data-cache-consulted';

/**
 * Everything the request can actually see about the data cache, at one instant.
 *
 * KEYS, NOT A COUNT. `patch-fetch.js:182` and `:723` DELETE entries from
 * `pendingRevalidates` as fetch cache-sets settle, while `unstable_cache` never
 * deletes — which is exactly where v1's monotonicity assumption came from and
 * why its count-delta could report "nothing was queued" for a request that
 * queued something. A SET DIFFERENCE cannot be fooled that way: a key that
 * appears is positive evidence, whatever else left the map.
 */
type CacheObservation = {
  workStorePresent: boolean;
  incrementalCachePresent: boolean;
  pendingRevalidateKeys: string[];
  flags: {
    isDraftMode: boolean | null;
    isOnDemandRevalidate: boolean | null;
    incrementalCacheIsOnDemandRevalidate: boolean | null;
    fetchCache: string | null;
  };
};

/**
 * Read the request's Next work store. Reports; decides nothing.
 *
 * `incrementalCachePresent` deliberately covers BOTH sources `unstable_cache`
 * consults — `workStore?.incrementalCache || globalThis.__incrementalCache`
 * (`unstable-cache.js:60`), the global being set process-wide by
 * `base-server.js:852`. `workStorePresent` is reported SEPARATELY rather than
 * conflated with it: v1 branched on a single derived predicate that duplicated
 * Next's own `if (workStore)` (`unstable-cache.js:94`) without being the same
 * thing. Nothing here branches on a predicate Next owns; both facts are printed
 * and the verdict rule below consumes them explicitly.
 *
 * `standingsCacheWarmer.ts` already reads `workAsyncStorage.getStore()` from
 * `src/`, so this is an established seam rather than a new coupling.
 */
function readCacheObservation(): CacheObservation {
  const store = workAsyncStorage.getStore() as
    | {
        incrementalCache?: { isOnDemandRevalidate?: boolean };
        pendingRevalidates?: Record<string, unknown>;
        fetchCache?: string;
        isOnDemandRevalidate?: boolean;
        isDraftMode?: boolean;
      }
    | undefined;
  const globalCache = (globalThis as { __incrementalCache?: unknown }).__incrementalCache;
  return {
    workStorePresent: Boolean(store),
    incrementalCachePresent: Boolean(store?.incrementalCache) || Boolean(globalCache),
    pendingRevalidateKeys: Object.keys(store?.pendingRevalidates ?? {}).sort(),
    flags: {
      isDraftMode: store ? Boolean(store.isDraftMode) : null,
      isOnDemandRevalidate: store ? Boolean(store.isOnDemandRevalidate) : null,
      incrementalCacheIsOnDemandRevalidate: store?.incrementalCache
        ? Boolean(store.incrementalCache.isOnDemandRevalidate)
        : null,
      fetchCache: store?.fetchCache ?? null,
    },
  };
}

type CacheReadFacts = {
  verdict: CacheReadVerdict;
  verdictRule: VerdictRule;
  /** Every key added in the window — the observation, including other cache families. */
  publicationKeysAdded: string[];
  publicationKeysRemoved: string[];
  /** The subset attributable to the canonical-standings entry; the verdict uses ONLY this. */
  standingsPublicationKeysAdded: string[];
  stampedByThisRequest: boolean;
  backgroundRevalidation: boolean;
};

/**
 * THE ONE DERIVATION, and every input to it is printed in the response.
 *
 * A reader can re-run this table by hand from `pendingRevalidateKeysAtEntry`,
 * `...AtExit`, `snapshotGeneratedAt` and `probeStamp` without trusting the
 * route — which is the point, and what `verdictRule` is for.
 *
 *   keys added + stamped here      -> miss
 *   keys added + value predates us -> hit, with a background revalidation behind it
 *   no keys    + value predates us -> hit
 *   no keys    + stamped here      -> CANNOT TELL
 *   no work store                  -> CANNOT TELL (publication leaves no record)
 *   no incremental cache           -> CANNOT TELL (nothing was consulted)
 *
 * WHY THE FOURTH LINE STAYS UNRESOLVED, which is the whole difference between
 * this and v1. Draft mode recomputes and publishes nothing
 * (`unstable-cache.js:143` and `:204` gate the read and the write alike), and a
 * genuine hit whose warming request landed in this request's millisecond also
 * shows no new key and a matching stamp. v1 resolved that state by elimination —
 * first to `bypassed`, then to `hit` — and BOTH were review findings. It is left
 * unresolved here, with `isDraftMode` printed beside it so a reader can judge.
 *
 * NO BETTER DISCRIMINATOR EXISTS, and this is not for want of looking:
 * `unstable_cache` surfaces its invocation key only WHEN IT PUBLISHES, which is
 * precisely the case the first two lines already resolve. There is no
 * per-execution identity to read in the case that needs one.
 */
function deriveCacheReadFacts(
  entry: CacheObservation,
  exit: CacheObservation,
  snapshotGeneratedAt: string,
  probeStamp: string,
  standingsKeySignature: string
): CacheReadFacts {
  const entryKeys = new Set(entry.pendingRevalidateKeys);
  const exitKeys = new Set(exit.pendingRevalidateKeys);
  const publicationKeysAdded = exit.pendingRevalidateKeys.filter((key) => !entryKeys.has(key));
  const publicationKeysRemoved = entry.pendingRevalidateKeys.filter((key) => !exitKeys.has(key));
  // THE VERDICT BRANCHES ON THE STANDINGS ENTRY ALONE, not on any added key.
  //
  // `resolveStandingsYear` runs inside this window and, on an offseason league,
  // reads `listSeasonArchives` — a DIFFERENT cache family, tagged `archive:<slug>`.
  // Treating its key as evidence about the canonical read reported a plain hit as
  // `published-and-value-predates-request` with `backgroundRevalidation: true`,
  // and under a stamp collision as a `miss`. Both reviewers found it; the payload
  // comment already claimed the keys let a reader tell the two apart while the
  // derivation did not.
  //
  // The signature is DERIVED from `canonicalStandingsCacheKeyParts`, the same
  // function that builds the key, rather than matched on a hand-written
  // substring. `unstable_cache` composes its invocation key as
  // `${cb.toString()}-${keyParts.join(',')}-${JSON.stringify(args)}`, so the
  // joined parts appear verbatim inside it. If that composition ever changes, the
  // match finds nothing and the verdict degrades to `cannot-tell` — declining
  // rather than claiming, which is the safe direction for this route.
  const standingsPublicationKeysAdded = publicationKeysAdded.filter((key) =>
    key.includes(standingsKeySignature)
  );
  const stampedByThisRequest = snapshotGeneratedAt === probeStamp;

  const base = {
    publicationKeysAdded,
    publicationKeysRemoved,
    standingsPublicationKeysAdded,
    stampedByThisRequest,
    backgroundRevalidation: false,
  };

  if (!entry.incrementalCachePresent) {
    return { ...base, verdict: 'cannot-tell', verdictRule: 'no-data-cache-consulted' };
  }
  if (!entry.workStorePresent) {
    return {
      ...base,
      verdict: 'cannot-tell',
      verdictRule: 'publication-unobservable-inline-path',
    };
  }
  if (standingsPublicationKeysAdded.length > 0) {
    return stampedByThisRequest
      ? { ...base, verdict: 'miss', verdictRule: 'published-and-stamped-here' }
      : {
          ...base,
          verdict: 'hit',
          verdictRule: 'published-and-value-predates-request',
          backgroundRevalidation: true,
        };
  }
  return stampedByThisRequest
    ? { ...base, verdict: 'cannot-tell', verdictRule: 'no-publication-and-stamp-matches' }
    : { ...base, verdict: 'hit', verdictRule: 'no-publication-and-value-predates-request' };
}

function orderedSides(snapshot: CanonicalStandings): Map<string, OwnerSide> {
  const sides = new Map<string, OwnerSide>();
  // `rows` is already in canonical order (`compareStandingsRows`) and excludes
  // NoClaim; rank is that position, derived here and labelled as derived.
  (snapshot.rows ?? []).forEach((row, index) => {
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
type OwnerProjection = ({ rank: number | null } & Record<ComparedField, number | null>) | null;

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
  } & Record<ComparedField, number | null>;
  // NULL, NOT `undefined`, and the difference is whether the field survives
  // serialization. `finalGames` is typed required but durable archives predate
  // it (`trends.ts:124` documents exactly this, and `undefined > 0` is false
  // rather than an error, which is why nothing else caught it). Assigning
  // `undefined` here makes `JSON.stringify` DROP the key, so a legacy archive
  // silently ships an owner projection missing a field `comparedFields`
  // advertises — the payload promising both sides and delivering one.
  for (const field of COMPARED_FIELDS) projection[field] = side.row[field] ?? null;
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
      // `?? null` ON BOTH SIDES, for the reason `projectSide` needs it: a durable
      // archive predating `finalGames` yields `undefined`, `JSON.stringify` DROPS
      // the key, and the difference entry ships reporting neither side's value
      // while its own shape implies the missing side was absent. Round 1 fixed
      // this in `projectSide` and NOT here, and its commit message said the
      // defect was closed — one of the two sites it occurs in.
      const fields: FieldDifference[] = COMPARED_FIELDS.map((field) => ({
        field,
        cached: left ? (present.row[field] ?? null) : null,
        fresh: left ? null : (present.row[field] ?? null),
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
        fields.push({
          field,
          cached: left.row[field] ?? null,
          fresh: right.row[field] ?? null,
        });
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
  const snapshot = history.byWeek?.[week];
  if (!snapshot) return 'absent';
  // POSITIONAL, NOT SORTED, AND THE POSITION IS THE POINT.
  //
  // v1 sorted these rows, which normalised away the one thing the array carries
  // that the row fields do not: ORDER. `selectRankTrend` (`trends.ts:306-320`)
  // derives every historical rank as `byWeek[week].standings.findIndex(...)`, so
  // two histories differing ONLY in order render different rank trends while a
  // sorted digest reports them identical. Prefixing the index makes a reordering
  // a difference, which is what it is.
  const rows = (snapshot.standings ?? [])
    .map(
      (row, index) =>
        `${index}:${row.owner}:${row.wins}-${row.losses}:${row.pointsFor}/${row.pointsAgainst}`
    )
    .join('|');
  // `pending` STAYS SORTED, deliberately, and the asymmetry is not an oversight.
  // It is a set the abandonment rule in `selectSeasonContext` scans; no consumer
  // reads it by index, so its order carries no meaning and sorting makes the
  // digest stable against an ordering that is already arbitrary. `standings` is
  // the opposite: there the index IS the rank.
  const pending = [...(snapshot.pending ?? [])]
    .map((game) => `${game.key}@${game.kickoff ?? 'unplanned'}`)
    .sort()
    .join('|');
  return `played=${String(snapshot.played)};coverage=${snapshot.coverage?.state};pending=${pending};rows=${rows}`;
}

/**
 * Per-owner digest of the history's `byOwner` projection.
 *
 * v1 compared `byOwner` by KEY COUNT, so two histories with the same owners and
 * different series values were reported identical. This names WHICH owners
 * differ rather than dumping both series — the difference list stays readable
 * and a reader who needs the values has the owner to look them up by.
 */
function digestOwnerSeries(history: StandingsHistory, owner: string): string {
  const series = (history.byOwner as Record<string, unknown> | undefined)?.[owner];
  if (series === undefined) return 'absent';
  return JSON.stringify(series);
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
  const cachedWeeks = (cached.weeks ?? []).join(',');
  const freshWeeks = (fresh.weeks ?? []).join(',');
  if (cachedWeeks !== freshWeeks) {
    out.push(['standingsHistory.weeks', cachedWeeks, freshWeeks]);
  }
  for (const week of [...new Set([...(cached.weeks ?? []), ...(fresh.weeks ?? [])])].sort(
    (a, b) => a - b
  )) {
    const left = digestHistoryWeek(cached, week);
    const right = digestHistoryWeek(fresh, week);
    if (left !== right) out.push([`standingsHistory.week${week}`, left, right]);
  }
  // `byOwner` PER OWNER, not by key count. The count check this replaced agreed
  // whenever the owner SET matched, so two projections with the same owners and
  // different series read as identical.
  for (const owner of [
    ...new Set([...Object.keys(cached.byOwner ?? {}), ...Object.keys(fresh.byOwner ?? {})]),
  ].sort((a, b) => a.localeCompare(b))) {
    const left = digestOwnerSeries(cached, owner);
    const right = digestOwnerSeries(fresh, owner);
    if (left !== right) out.push([`standingsHistory.byOwner.${owner}`, left, right]);
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
    ['coverage.state', cached.coverage?.state, fresh.coverage?.state],
    // THESE TWO ARE CROSS-CHECKS, NOT GAP-CLOSERS, and saying otherwise would be
    // the exact habit this reconstruction exists to break. I reported both to
    // planning as live blind spots; reading the derivations afterwards showed
    // neither can diverge today:
    //
    //   - `ownerColorOrder` is `buildOwnerColorOrder(rows)` — owners mapped off
    //     the same `rows` and sorted — so it is a PURE FUNCTION of the row set
    //     the owner comparison already covers. It cannot differ unless `rows`
    //     differ, and then `differences` reports it first.
    //   - `coverage.message` is determined by `coverage.state` inside a
    //     canonical snapshot: the only shapes reachable are
    //     `{complete, null}` and `{partial, COVERAGE_INCOMPLETE}`
    //     (`deriveStandingsCoverage`) or `EMPTY_COVERAGE`.
    //     `STANDINGS_COVERAGE_UNAVAILABLE` is a CLIENT-side fallback in
    //     `standingsCanonicalInputs.ts` and never enters a selector snapshot.
    //
    // They are compared anyway because they are free and because a later change
    // to either derivation would make them live — `ownerColorOrderIsPureInRows`
    // and `coverageMessageIsDeterminedByState` pin exactly that, and redden if
    // the purity they rest on stops holding.
    ['coverage.message', cached.coverage?.message, fresh.coverage?.message],
    [
      'ownerColorOrder',
      (cached.ownerColorOrder ?? []).join(','),
      (fresh.ownerColorOrder ?? []).join(','),
    ],
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
  // ONE NORMALIZATION, AT THE BOUNDARY EVERY ENTRY FUNNELS THROUGH.
  //
  // This defect has been declared closed twice and was closed neither time —
  // once at one of three sites, once at two — because each fix enumerated the
  // sites I was looking at. A value typed required but absent at runtime is
  // `undefined`, `JSON.stringify` drops the key, and the entry ships reporting
  // neither side. `compareSnapshotFields` passed seven of eight entries raw while
  // `coverage.message` alone carried `?? null`; that asymmetry was the tell, and
  // I had written the one defended line myself.
  //
  // Normalizing here covers a field whose VALUE is absent. It does NOT cover an
  // entry that DEREFERENCES the value while building its tuple — review found
  // that `cached.coverage.state` and `cached.ownerColorOrder.join(',')` threw on
  // a snapshot predating those fields, 500ing the diagnostic on exactly the
  // input it exists to diagnose, and the response-wide assertion could not see it
  // because a throw leaves no body to assert on. Those entries are now
  // absence-tolerant at construction; `survivesASnapshotMissingAnyOneField`
  // derives the field list from a real snapshot rather than from this comment.
  //
  // BEFORE the filter, deliberately: a cached snapshot predating a field yields
  // `undefined` where the rebuild yields `null`, and those mean the same thing.
  // Comparing raw would report a difference that is a shape artefact rather than
  // a divergence — noise in the list whose emptiness is the signal. A cached
  // `undefined` against a real fresh value is still reported, with both keys.
  return fields
    .map(([field, left, right]) => [field, left ?? null, right ?? null] as const)
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
  // UNKNOWN SLUG IS REFUSED, and the argument is the one
  // `resolveRequestedYear` below makes for `year`. I failed to apply it to the
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
  // IT RUNS BEFORE THE YEAR BOUND, which now reads `listSeasonArchives` for
  // #818's archived-season disjunct. That reader carries its own #778 guard and
  // would return `[]` rather than mint anything, but depending on a guard in
  // another module when an earlier `return` removes the question is the weaker
  // arrangement.
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

  const yearResolution = await resolveRequestedYear(
    url.searchParams.get('year'),
    leagueSlug,
    league,
    now
  );
  if (!yearResolution.ok) {
    // Refused BEFORE any build and before any cached read, so a rejected year
    // mints no `unstable_cache` entry. Asserted by
    // `rejectsAnOutOfRangeYearBeforeAnyBuild`.
    return NextResponse.json({ error: yearResolution.error }, { status: 400 });
  }
  const yearOverride = yearResolution.year;

  // ENTRY OBSERVATION, taken before year resolution.
  //
  // `resolveStandingsYear` consults `listSeasonArchives` on an offseason league,
  // and that read carries its own `unstable_cache`, so on a cold archive-years
  // cache it queues a publication before the standings read happens at all.
  // Taking the entry reading here means a key it adds is inside the observed
  // window and shows up in `publicationKeysAdded` by NAME — so a reader can see
  // that it was the archive-years entry rather than the standings one, which a
  // count never permitted.
  const cacheEntry = readCacheObservation();
  const resolvedYear = await resolveStandingsYear(leagueSlug, yearOverride);

  // ONE Date for both sides. The cached read needs it as the probe stamp; the
  // fresh rebuild takes the same value so the only difference between the two
  // snapshots is the DATA. Giving the fresh side its own `new Date()` would
  // manufacture a `lifecycle` difference the cache had nothing to do with.
  const probe = now;
  const probeStamp = probe.toISOString();

  // ONE RESOLUTION, REUSED — the cached read, the fresh rebuild and the key
  // signature all take `resolvedYear` rather than each resolving again.
  //
  // The route previously resolved the year three times: once for reporting
  // (`resolveStandingsYear` above), once inside `getCanonicalStandings` because
  // no `year` was passed, and once inside `computeCanonicalStandings` for the
  // fresh side. A lifecycle transition, rollover or archive write overlapping the
  // request could make them disagree, so `year.resolved` and
  // `standingsKeySignature` could describe a year the comparison did not use.
  //
  // PASSING THE RESOLVED YEAR IS EQUIVALENT IN EVERY BRANCH, and the selector's
  // own comment is why that needs saying: it warns that the compute deliberately
  // receives the ORIGINAL override to preserve `resolveOffseason`'s fallback, and
  // that a default-year and an explicit-year request can otherwise produce
  // different snapshots. Checked branch by branch —
  //   season / preseason: `resolveStandingsYear` returns `status.year`, which is
  //     what `resolveSeason`/`resolvePreseason` use anyway;
  //   offseason WITH archives: it returns `Math.max(...archives)`, exactly the
  //     `mostRecentArchivedYear` the fallback would pick;
  //   offseason WITHOUT archives: it returns `league.year`, and the fallback
  //     resolves `null ?? null ?? league.year` to the same;
  //   status absent: it returns `league.year`, matching the synthesized
  //     `{ state: 'season', year: league.year }`.
  // The cache key is built from the resolved year either way, so identity is
  // unchanged. `aDefaultYearRequestAndAnExplicitResolvedYearRequestShareOneKey`
  // pins that equivalence rather than leaving it as an argument.
  const cached = await getCanonicalStandings({
    slug: leagueSlug,
    ...(resolvedYear != null ? { year: resolvedYear } : {}),
    currentDate: probe,
  });
  const cacheAfterCachedRead = readCacheObservation();

  const fresh = await computeCanonicalStandingsUncached({
    slug: leagueSlug,
    year: resolvedYear,
    currentDate: probe,
  });
  // The fresh rebuild runs UN-NESTED, so `getSeasonArchive` / `listSeasonArchives`
  // inside it go through their own `unstable_cache` and publish on a cold archive
  // cache. Its keys are observed too, and named, so the response accounts for
  // every publication the request queued rather than only the standings one.
  const cacheExit = readCacheObservation();

  // The VERDICT is derived from the cached read alone — a key the rebuild adds
  // afterwards says nothing about whether the cached read was a hit. The exit
  // observation is still published, for the durable-effect account.
  // Derived from the same function that builds the cache key, so the match
  // cannot drift from the key it is matching.
  const standingsKeySignature = canonicalStandingsCacheKeyParts(leagueSlug, resolvedYear).join(',');
  const cacheReadFacts = deriveCacheReadFacts(
    cacheEntry,
    cacheAfterCachedRead,
    cached.generatedAt,
    probeStamp,
    standingsKeySignature
  );
  const requestKeysAdded = cacheExit.pendingRevalidateKeys.filter(
    (key) => !new Set(cacheEntry.pendingRevalidateKeys).has(key)
  );

  const { comparedOwners, differences, owners: ownerProjections } = compareOwners(cached, fresh);
  const snapshotDifferences = compareSnapshotFields(cached, fresh);
  const differencesAreEmpty = differences.length === 0 && snapshotDifferences.length === 0;
  const blindSpots = resolveBlindSpots(league.status?.state);
  const comparisonBlocker = resolveComparisonBlocker({
    verdict: cacheReadFacts.verdict,
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
    // EVERY FIELD HERE IS AN OBSERVATION OR A PURE FUNCTION OF ONE, and the
    // inputs to the derivation are printed beside it so a reader can re-run the
    // table in `deriveCacheReadFacts` by hand.
    cacheRead: {
      verdict: cacheReadFacts.verdict,
      verdictRule: cacheReadFacts.verdictRule,

      // --- observations ---
      probeStamp,
      snapshotGeneratedAt: cached.generatedAt,
      workStorePresent: cacheEntry.workStorePresent,
      incrementalCachePresent: cacheEntry.incrementalCachePresent,
      flags: cacheEntry.flags,
      // KEYS, not a count. `patch-fetch.js:182`/`:723` delete entries from this
      // map as fetch cache-sets settle, so a count can fall while a real
      // publication is added and a difference of zero is not evidence of no
      // write. Naming the keys also lets a reader see WHICH entry was published
      // — the archive-years one from year resolution, or the standings one.
      pendingRevalidateKeysAtEntry: cacheEntry.pendingRevalidateKeys,
      pendingRevalidateKeysAfterCachedRead: cacheAfterCachedRead.pendingRevalidateKeys,
      pendingRevalidateKeysAtExit: cacheExit.pendingRevalidateKeys,

      // --- derived, each a set difference or an equality over the above ---
      publicationKeysAdded: cacheReadFacts.publicationKeysAdded,
      // The subset the VERDICT rests on. Printed separately from the full added
      // set so a reader can see that an archive-years publication was observed
      // and correctly excluded, rather than having to trust that it was.
      standingsPublicationKeysAdded: cacheReadFacts.standingsPublicationKeysAdded,
      standingsKeySignature,
      publicationKeysRemoved: cacheReadFacts.publicationKeysRemoved,
      stampedByThisRequest: cacheReadFacts.stampedByThisRequest,
      backgroundRevalidation: cacheReadFacts.backgroundRevalidation,
      // The whole request's durable effect, entry to exit — year resolution, the
      // cached read, and the rebuild's own un-nested archive reads alike. A miss
      // PUBLISHES the snapshot every member surface then reads, so this route is
      // read-only with respect to `app_state` and NOT with respect to the Next
      // data cache.
      requestPublicationKeysAdded: requestKeysAdded,

      // THERE IS NO `dataCachePublicationConfirmed`, AND NOTHING REPLACES IT.
      // Next drains `pendingRevalidates` through `pendingWaitUntil` AFTER the
      // handler returns, so no request can observe whether its own write landed;
      // if the `set` rejects, nothing durable exists and this request cannot
      // know. v1 kept the field alive through four rounds of increasingly
      // careful wording and the wording was the thing that was wrong each time.
      // A field that cannot be observed does not exist here.
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
      cachedOwners: (cached.rows ?? []).length + (cached.noClaimRow ? 1 : 0),
      freshOwners: (fresh.rows ?? []).length + (fresh.noClaimRow ? 1 : 0),
      unit: 'owner',
      comparedFields: COMPARED_FIELDS,
      derivedFields: ['rank'],
      // NULL, NOT A BOOLEAN, WHENEVER AN EMPTY RESULT CANNOT BE READ AS AGREEMENT.
      //
      // The gate is not "was the cached side real" but "could this comparison
      // have SEEN a difference if one existed", and it fails three ways —
      // `resolveComparisonBlocker` is the single place that decides, so
      // `blockedBy` and `matches` cannot disagree:
      //
      //   1. verdict !== 'hit' — the cached side is not established as a
      //      pre-existing snapshot, so agreement carries no information.
      //   2. freshSource === 'archive' — both sides read the same nested,
      //      tag-only `getSeasonArchive` cache, so the rebuild cannot diverge
      //      from the snapshot however stale the archive is.
      //   3. comparedOwners === 0 — agreement over an empty population is not
      //      agreement.
      //
      // A BLOCKER GATES ABSENCE ONLY: a difference that WAS found is evidence
      // under all three, so `matches` is `false` whenever the lists are
      // non-empty. Asserted by `reportsMissWhenAKeyIsPublishedAndTheSnapshotCarriesThisRequestStamp`,
      // `nestedSeasonArchiveCacheIsSharedByBothSides` and
      // `reportsNullRatherThanDisagreementOverAnEmptyPopulation`.
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

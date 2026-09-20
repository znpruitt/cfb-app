import type { AppGame, ScheduleWireItem } from '../schedule.ts';
import { getAppState } from './appStateStore.ts';

/**
 * The durable `schedule` record as stored. Every field but `items` is optional
 * here on purpose: this type describes what the store may HOLD (including rows
 * written by older shapes), not what a writer produces.
 */
type StoredScheduleEntry<T> = {
  at?: number;
  items?: T[];
  partialFailure?: boolean;
  failedSeasonTypes?: string[];
};

/** Which key precedence actually served a canonical schedule read. */
export type CanonicalScheduleEntrySource = 'aggregate' | 'partition-pair';

/** A canonical schedule read, normalized, with the metadata the HTTP route needs. */
export type CanonicalScheduleEntry<T = ScheduleWireItem> = {
  at: number;
  items: T[];
  partialFailure: boolean;
  failedSeasonTypes: string[];
  source: CanonicalScheduleEntrySource;
};

/** The durable app-state scope every canonical schedule key lives in. */
export const CANONICAL_SCHEDULE_SCOPE = 'schedule';

/**
 * The ONE key a season's canonical schedule is written to (PLATFORM-663).
 *
 * `refreshFullSeasonSchedule` is the only writer, and this is the only key it
 * writes. Before #663 the `/api/schedule` route could also commit
 * `${year}-${week}-${seasonType}` and `${year}-all-<seasonType>` partitions that
 * no whole-season reader consulted; that path is gone, so there is no longer a
 * second key for a repair to hide in.
 */
export function canonicalScheduleAggregateKey(year: number): string {
  return `${year}-all-all`;
}

/**
 * The pre-#663 season-partition pair, retained as a READ-ONLY compatibility
 * fallback and nothing more.
 *
 * Nothing can write these keys any more (#663 removed the only writer) and
 * production holds none of them — measured 2026-09-19 and re-measured
 * 2026-09-20: seven `schedule` keys, every one a `-all-all` aggregate. They are
 * still read so a store that predates the aggregate — a preview branch database,
 * a local file store — is not silently served an empty season. Owning the two
 * key strings HERE is the point: they were previously spelled out in three
 * independent places, which is what let the canonical precedence drift.
 */
export function canonicalSchedulePartitionKeys(year: number): readonly [string, string] {
  return [`${year}-all-regular`, `${year}-all-postseason`];
}

/**
 * Whether a raw stored `schedule` value carries rows, i.e. whether the aggregate
 * SERVES and the partition pair is therefore not consulted.
 *
 * This predicate IS the canonical precedence's hinge, so it is exported rather
 * than re-implemented: a reader that spells it differently (`!= null`, or a
 * truthy `items`) silently disagrees about whether an empty aggregate shadows a
 * populated pair. Deliberately tolerant of `unknown` so a caller holding a
 * transaction-fresh value can ask without re-reading the store.
 */
export function canonicalScheduleAggregateServes(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const items = (value as { items?: unknown }).items;
  return Array.isArray(items) && items.length > 0;
}

/**
 * In-process, cache-only read of the canonical schedule wire items for a season —
 * the SINGLE implementation of that precedence (PLATFORM-663).
 *
 * Reads the durable `schedule` app-state cache that `refreshFullSeasonSchedule`
 * writes under `${year}-all-all`, falling back to the legacy `regular` +
 * `postseason` pair when the aggregate carries no rows. This NEVER triggers an
 * upstream CFBD fetch, so it is quota-safe on public/anonymous paths
 * (PLATFORM-075) — server-side callers use it instead of self-fetching
 * `/api/schedule`. It is the single source the canonical standings selector and
 * Insights share, so both build the same canonical games from the same inputs.
 *
 * #663 made this the only copy **among the paths it converged**:
 * `assembleSeasonScoredBuild` re-implemented the precedence inline and
 * `loadScheduleDisappearanceFallback` spelled out the same two partition keys
 * again, and both now come through here.
 *
 * **IT IS NOT YET THE ONLY COPY IN THE REPO, AND SAYING SO WOULD BE FALSE.** The
 * first version of this comment claimed exactly that and was corrected at review.
 * Still carrying their own precedence, all outside #663's scope and tracked by
 * [#833](https://github.com/znpruitt/cfb-app/issues/833):
 *   - `providerDataDiagnostics.ts:374-401` — inlines the aggregate-serves predicate
 *     and hardcodes `${year}-all-regular`; its own comment says it "MUST mirror
 *     `loadCachedScheduleItems`' key precedence", which is the drift this module
 *     exists to prevent, asserted rather than enforced.
 *   - `seasonRollover.ts:17-25` — a third shape: aggregate, else `-all-postseason`
 *     only.
 * Those are why the key builders and the predicate are EXPORTED rather than private:
 * the convergence is available to them, and until they consume it this module is the
 * canonical copy, not the only one.
 *
 * **`LeagueStatusPanel` WAS ON THIS LIST AND IS NOT ANY MORE (PLATFORM-833).** It
 * held the one entry that was actively WRONG rather than merely duplicated —
 * `r ?? getAppState(...)` tested RECORD presence, so an empty aggregate record
 * shadowed a populated partition and `hasSchedule` read true with zero rows. It now
 * calls {@link loadCanonicalScheduleEntry} directly, so it inherits the precedence
 * rather than imitating it.
 *
 * The entry is removed rather than left as history because PLATFORM-833's own diff
 * is what made it false: a comment that was true when written became a false claim
 * the moment that commit fixed the thing it described. A diff that falsifies a
 * comment owns that comment — which is the same rule this module's header applies to
 * `scheduleSeasonFetch.ts`, and it would be absurd to cite it there and dodge it
 * here.
 */
export async function loadCachedScheduleItems(year: number): Promise<ScheduleWireItem[]> {
  const entry = await loadCanonicalScheduleEntry<ScheduleWireItem>(year);
  return entry?.items ?? [];
}

/**
 * The canonical schedule entry for a season, WITH its observation metadata —
 * the same precedence {@link loadCachedScheduleItems} applies, for the one caller
 * that needs more than the rows.
 *
 * `/api/schedule` has to decide freshness and report `partialFailure` /
 * `failedSeasonTypes`, so it cannot use the item-only reader. Before #663 it
 * therefore implemented its OWN key resolution, which is how the route and the
 * server-side readers came to disagree about what "the season" is. This function
 * exists so there is exactly one precedence with two projections, rather than two
 * precedences.
 *
 * Returns `null` only when neither the aggregate NOR either partition record
 * exists. A record that EXISTS but carries no rows yields an entry with
 * `items: []` — "cached and empty" and "never cached" are different states and the
 * route serves them differently (a stale-empty rebuild prompt vs a hard miss).
 *
 * `at` for a partition-pair read is the OLDEST contributing partition's stamp, so
 * a freshly-written partition cannot make a stale sibling look current. A record
 * contributing no rows contributes no stamp.
 */
export async function loadCanonicalScheduleEntry<T = ScheduleWireItem>(
  year: number
): Promise<CanonicalScheduleEntry<T> | null> {
  const aggregate = await getAppState<StoredScheduleEntry<T>>(
    CANONICAL_SCHEDULE_SCOPE,
    canonicalScheduleAggregateKey(year)
  );
  if (canonicalScheduleAggregateServes(aggregate?.value)) {
    return normalizeEntry<T>(aggregate!.value!, 'aggregate');
  }

  const [regularKey, postseasonKey] = canonicalSchedulePartitionKeys(year);
  const [regular, postseason] = await Promise.all([
    getAppState<StoredScheduleEntry<T>>(CANONICAL_SCHEDULE_SCOPE, regularKey),
    getAppState<StoredScheduleEntry<T>>(CANONICAL_SCHEDULE_SCOPE, postseasonKey),
  ]);

  const contributing = [regular?.value, postseason?.value].filter(
    (value): value is StoredScheduleEntry<T> => canonicalScheduleAggregateServes(value)
  );
  if (contributing.length > 0) {
    // An UNKNOWN age is not a missing contribution. A contributing partition whose
    // `at` is absent or non-finite normalizes to 0 (stale) rather than dropping out
    // of the comparison: `StoredScheduleEntry.at` is optional precisely because the
    // store may hold older records, and skipping those stamps let a fresh sibling
    // report the combined view fresh while half of it had unknown age. `0` is
    // stale-but-comparable, which is the honest answer and matches what
    // `normalizeEntry` already does for the single-record paths.
    const stamps = contributing.map((value) =>
      typeof value.at === 'number' && Number.isFinite(value.at) ? value.at : 0
    );
    return {
      // Oldest contributing partition wins, so the pair can never read fresher
      // than its stalest half.
      at: Math.min(...stamps),
      items: contributing.flatMap((value) => value.items ?? []),
      partialFailure: contributing.some((value) => value.partialFailure === true),
      failedSeasonTypes: contributing.flatMap((value) =>
        Array.isArray(value.failedSeasonTypes) ? value.failedSeasonTypes : []
      ),
      source: 'partition-pair',
    };
  }

  // Nothing contributes rows. Distinguish "a record exists and is empty" from
  // "no record at all" — the route's stale-empty and hard-miss paths differ.
  //
  // ONLY THE AGGREGATE establishes "cached and empty". An empty partition record
  // must NOT, and this is a correctness point rather than a tidiness one: the route
  // turns an entry into HTTP 200, and `fetchSeasonSchedule` only throws on a
  // non-OK status, so a 200 carrying zero rows is accepted by the client and
  // rendered as an empty season. Before #663 a public whole-season request read
  // only `${year}-all-all`, missed, and returned 503 — a visible failure. Widening
  // this to the legacy pair would have converted that failure into a silent empty
  // season for any store holding an empty `-all-regular` and no aggregate. The pair
  // is a fallback for SERVING ROWS; with no rows it has nothing to say, so it stays
  // a miss.
  if (aggregate?.value) {
    return normalizeEntry<T>(aggregate.value, 'aggregate');
  }
  return null;
}

function normalizeEntry<T>(
  value: StoredScheduleEntry<T>,
  source: CanonicalScheduleEntrySource
): CanonicalScheduleEntry<T> {
  return {
    at: typeof value.at === 'number' && Number.isFinite(value.at) ? value.at : 0,
    items: value.items ?? [],
    partialFailure: value.partialFailure === true,
    failedSeasonTypes: Array.isArray(value.failedSeasonTypes) ? value.failedSeasonTypes : [],
    source,
  };
}

/**
 * Postseason/manual game overrides (`postseason-overrides:${slug}:${year}`) fed
 * into `buildScheduleFromApi` so canonical games match production standings.
 */
export async function loadPostseasonOverrides(
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

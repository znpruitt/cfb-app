/**
 * Canonical target scope for provider-refresh status (PLATFORM-086A-SCOPED).
 *
 * The core invariant: a provider-refresh status record belongs to the EXACT
 * canonical data target that was refreshed, and may inform only that target. A
 * targeted refresh (one year, one season partition, one week, one Odds query
 * variant) must never establish broader success or freshness for a different
 * year or a wider target it did not actually refresh.
 *
 * This module is the single source of truth for that scope identity. It is
 * intentionally free of server-only imports so it can be shared by the
 * refresh-status store, the route writers, the admin API, and the admin panel
 * (the panel imports only the TYPE + describe helper). It deliberately does NOT
 * construct any team, game, or Odds identity of its own — Odds targets carry the
 * caller-computed durable Odds cache key verbatim, and season types are
 * normalized through one local canonicalizer so aliases and casing cannot split
 * a single target across two keys.
 */

import type { ProviderDataset } from './providerDatasets.ts';
import type { SeasonType } from './scores/types.ts';

/** The canonical season-type partition dimension (reuses the score/schedule type). */
export type CanonicalSeasonType = SeasonType;

/** Whether an Odds refresh targeted the canonical/default query or a filtered variant. */
export type OddsTargetVariant = 'canonical' | 'filtered';

/**
 * The canonical target a provider-refresh attempt/outcome belongs to.
 *
 *   - `global`            — dataset-wide reference data with no year/partition
 *                           dimension (conferences).
 *   - `year`             — a whole-year target (schedule) or an explicit year-wide
 *                           ROLLUP recorded only by an operation that covered the
 *                           complete intended year target (aggregate scores/rankings).
 *   - `season-partition` — a single (year, seasonType) partition (targeted scores).
 *   - `week-partition`   — a single (year, week, seasonType) partition (game-stats).
 *   - `odds-target`      — a single Odds cache target, distinguished by canonical
 *                           vs filtered variant and the durable Odds cache key.
 *   - `legacy-unscoped`  — a pre-scoped record keyed only by dataset. Read for
 *                           deep diagnostics; never treated as selected-year truth.
 */
export type ProviderRefreshScope =
  | { kind: 'global' }
  | { kind: 'year'; year: number }
  | { kind: 'season-partition'; year: number; seasonType: CanonicalSeasonType }
  | { kind: 'week-partition'; year: number; week: number; seasonType: CanonicalSeasonType }
  | { kind: 'odds-target'; year: number; variant: OddsTargetVariant; cacheKey: string }
  | { kind: 'legacy-unscoped' };

/**
 * Canonicalize a season-type string so aliases/casing cannot split a single
 * partition across two scope keys. Anything that is not explicitly `postseason`
 * collapses to `regular` — matching the route-layer season-type handling.
 */
export function normalizeCanonicalSeasonType(seasonType: string): CanonicalSeasonType {
  return seasonType.trim().toLowerCase() === 'postseason' ? 'postseason' : 'regular';
}

// --- Scope constructors (the only supported way to build a scope) ---------------

export function globalScope(): ProviderRefreshScope {
  return { kind: 'global' };
}

export function yearScope(year: number): ProviderRefreshScope {
  return { kind: 'year', year };
}

export function seasonPartitionScope(year: number, seasonType: string): ProviderRefreshScope {
  return { kind: 'season-partition', year, seasonType: normalizeCanonicalSeasonType(seasonType) };
}

export function weekPartitionScope(
  year: number,
  week: number,
  seasonType: string
): ProviderRefreshScope {
  return {
    kind: 'week-partition',
    year,
    week,
    seasonType: normalizeCanonicalSeasonType(seasonType),
  };
}

export function oddsTargetScope(
  year: number,
  variant: OddsTargetVariant,
  cacheKey: string
): ProviderRefreshScope {
  return { kind: 'odds-target', year, variant, cacheKey };
}

export function legacyUnscopedScope(): ProviderRefreshScope {
  return { kind: 'legacy-unscoped' };
}

/**
 * Deterministic durable status key for `dataset` + canonical `scope`.
 *
 * Guarantees:
 *   - stable across processes (pure function of dataset + normalized scope);
 *   - independent of query-parameter ordering (Odds keys are pre-sorted by the
 *     caller's cache-key builder; season types are normalized here);
 *   - collision-resistant across supported targets (distinct `kind` prefixes);
 *   - legacy-unscoped maps to the BARE dataset key, so pre-scoped records remain
 *     addressable without a migration.
 *
 * This is the ONLY place a durable status key is constructed.
 */
export function providerRefreshScopeKey(
  dataset: ProviderDataset,
  scope: ProviderRefreshScope
): string {
  switch (scope.kind) {
    case 'global':
      return `${dataset}:global`;
    case 'year':
      return `${dataset}:year:${scope.year}`;
    case 'season-partition':
      return `${dataset}:season:${scope.year}:${normalizeCanonicalSeasonType(scope.seasonType)}`;
    case 'week-partition':
      return `${dataset}:week:${scope.year}:${scope.week}:${normalizeCanonicalSeasonType(
        scope.seasonType
      )}`;
    case 'odds-target':
      return `${dataset}:target:${scope.year}:${scope.variant}:${scope.cacheKey}`;
    case 'legacy-unscoped':
      return dataset;
  }
}

/** Whether `scope` produces exactly `key` for `dataset` (self-describing check). */
export function scopeMatchesKey(
  dataset: ProviderDataset,
  scope: ProviderRefreshScope,
  key: string
): boolean {
  return providerRefreshScopeKey(dataset, scope) === key;
}

/** Season-type as accepted by the schedule route (a whole-year `all` is allowed). */
export type ScheduleSeasonTypeParam = CanonicalSeasonType | 'all';

/**
 * Canonical status scope for a SCHEDULE refresh operation, selected from the
 * normalized request target (review remediation finding 1). The year rollup is
 * reserved for the ONE operation that genuinely covers the whole year
 * (`week === null && seasonType === 'all'`); a season- or week-targeted repair
 * records against its own partition and can never clear/advance the full-year
 * status.
 *
 * A specific week with `seasonType === 'all'` spans two week partitions; it is a
 * targeted (non-year) op and is resolved to the regular week partition by the
 * codebase's default-to-regular convention. The admin UI only ever issues the
 * full-year form, so this degenerate combination is API-only.
 */
export function scheduleRefreshScope(
  year: number,
  week: number | null,
  seasonType: ScheduleSeasonTypeParam
): ProviderRefreshScope {
  if (seasonType === 'all') {
    return week == null ? yearScope(year) : weekPartitionScope(year, week, 'regular');
  }
  return week == null
    ? seasonPartitionScope(year, seasonType)
    : weekPartitionScope(year, week, seasonType);
}

/**
 * Canonical status scope for a DIRECT single-partition score refresh (review
 * remediation finding 3): a whole-partition refresh (`week === null`) uses the
 * season partition; a week-specific refresh uses the week partition, so a Week 3
 * repair never overwrites the whole regular/postseason partition's status.
 */
export function scoresPartitionScope(
  year: number,
  week: number | null,
  seasonType: string
): ProviderRefreshScope {
  return week == null
    ? seasonPartitionScope(year, seasonType)
    : weekPartitionScope(year, week, seasonType);
}

/**
 * Canonical status scope for an AGGREGATE score refresh (review remediation
 * finding 2). The explicit year rollup is used ONLY when the attempted partitions
 * cover every applicable partition for the year (a complete year target). A
 * caller-selected subset that omits an applicable sibling records against its own
 * single attempted partition instead, so a targeted repair can never advance the
 * canonical year outcome/rows/source. Applicability is decided server-side by the
 * caller (`getApplicableScoreSeasonTypes`); skipped INAPPLICABLE partitions do not
 * block the year rollup, but caller-omitted APPLICABLE partitions do.
 */
export function scoresAggregateScope(
  year: number,
  attemptedSeasonTypes: readonly string[],
  applicableSeasonTypes: readonly string[]
): ProviderRefreshScope {
  const attempted = attemptedSeasonTypes.map(normalizeCanonicalSeasonType);
  const coversApplicable =
    applicableSeasonTypes.length > 0 &&
    applicableSeasonTypes.every((s) => attempted.includes(normalizeCanonicalSeasonType(s)));
  // A complete-applicable operation (or a no-applicable-partition year, which the
  // aggregate resolves as a year-level no-op) owns the year rollup; anything else
  // is a single-partition targeted repair.
  if (coversApplicable || attempted.length === 0) return yearScope(year);
  return seasonPartitionScope(year, attempted[0]!);
}

/** Human-readable label for panels and diagnostics (never used as identity). */
export function describeProviderRefreshScope(scope: ProviderRefreshScope): string {
  switch (scope.kind) {
    case 'global':
      return 'global';
    case 'year':
      return `year ${scope.year}`;
    case 'season-partition':
      return `${scope.year} ${scope.seasonType}`;
    case 'week-partition':
      return `${scope.year} week ${scope.week} ${scope.seasonType}`;
    case 'odds-target':
      return `${scope.year} odds (${scope.variant})`;
    case 'legacy-unscoped':
      return 'legacy (unscoped)';
  }
}

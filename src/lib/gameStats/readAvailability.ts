import type { CfbdSeasonType } from '../cfbd.ts';
import type { SeasonRelation } from './contract.ts';
import { getCachedGameStats, listCachedGameStats } from './cache.ts';
import { loadGameStatsIdentityResolver } from './identityContext.ts';
import { deriveSlateExpectation, type GameStatsSlateExpectation } from './ingestion.ts';
import {
  evaluateGameStatsPartitionCoverage,
  type GameStatsPartitionCoverage,
} from './partitionCoverage.ts';
import { buildPublicWeeklyGameStats, type PublicWeeklyGameStatsView } from './publicProjection.ts';
import { planGameStatsRecovery } from './recovery.ts';
import type { WeeklyGameStats } from './types.ts';
import { loadCachedScheduleItems } from '../server/canonicalScheduleCache.ts';

/**
 * PLATFORM-086H3 — the ordinary public read boundary (ACTIVE).
 *
 * The ONE provider-free read path the public route serves from. Before a
 * durable partition is served, its COMPLETE weekly envelope is validated —
 * record shape, partition identity agreement with the requested
 * (year, week, seasonType), a valid `fetchedAt`, and a `games` array — and
 * its rows pass through the schema-safe public projection (H1 row
 * classification; unsupported schema withheld, never laundered). Coverage
 * comes from the shared committed-state model, so `meta.availability`, the
 * served `games`, and diagnostics/cache-state always agree. A malformed
 * envelope, corrupt store, or failed durable read is a typed failure —
 * never an ordinary 200 and never absence.
 */

export type WeeklyEnvelopeFailure =
  | 'not-an-object'
  | 'year-mismatch'
  | 'week-mismatch'
  | 'season-type-mismatch'
  | 'invalid-fetched-at'
  | 'games-not-array';

/**
 * Validate the durable weekly envelope against the requested partition.
 * Returns the typed failure list (empty → valid).
 */
export function validateWeeklyGameStatsEnvelope(
  record: unknown,
  target: { year: number; week: number; seasonType: CfbdSeasonType }
): WeeklyEnvelopeFailure[] {
  if (typeof record !== 'object' || record === null || Array.isArray(record)) {
    return ['not-an-object'];
  }
  const failures: WeeklyEnvelopeFailure[] = [];
  const value = record as Partial<WeeklyGameStats>;
  if (value.year !== target.year) failures.push('year-mismatch');
  if (value.week !== target.week) failures.push('week-mismatch');
  if (value.seasonType !== target.seasonType) failures.push('season-type-mismatch');
  if (typeof value.fetchedAt !== 'string' || !Number.isFinite(Date.parse(value.fetchedAt))) {
    failures.push('invalid-fetched-at');
  }
  if (!Array.isArray(value.games)) failures.push('games-not-array');
  return failures;
}

/** Public availability summary derived from committed-state coverage. */
export type GameStatsAvailabilitySummary = {
  state: GameStatsPartitionCoverage['state'] | 'coverage-unavailable';
  satisfied?: number;
  expected?: number;
  recoverable?: number;
  manualOnly?: number;
  blocked?: number;
  absent?: number;
  pending?: number;
  deferredPlaceholders?: number;
};

export function toAvailabilitySummary(
  coverage: GameStatsPartitionCoverage | null
): GameStatsAvailabilitySummary {
  if (!coverage) return { state: 'coverage-unavailable' };
  return {
    state: coverage.state,
    satisfied: coverage.satisfied.length,
    expected: coverage.expected.length,
    recoverable: coverage.recoverable.length,
    manualOnly: coverage.manualOnly.length,
    blocked: coverage.blocked.length,
    absent: coverage.absent.length,
    pending: coverage.pending.length,
    deferredPlaceholders: coverage.deferredPlaceholders,
  };
}

export type PublicGameStatsReadResult =
  | {
      kind: 'served';
      view: PublicWeeklyGameStatsView;
      availability: GameStatsAvailabilitySummary;
      stale: boolean;
    }
  | { kind: 'miss'; availability: GameStatsAvailabilitySummary }
  | { kind: 'invalid-envelope'; failures: WeeklyEnvelopeFailure[] }
  | { kind: 'read-failed'; detail: string };

/** Cache TTL for the freshness marker on served partitions. */
export const GAME_STATS_READ_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Load the schedule-relative context (expectation + resolver) for one
 * partition. Cache-only; a read failure surfaces as `null` context and the
 * caller reports it truthfully rather than treating it as an empty registry.
 */
export async function loadSlateExpectationContext(params: {
  year: number;
  week: number;
  seasonType: CfbdSeasonType;
  now: number;
}): Promise<
  | {
      ok: true;
      expectation: GameStatsSlateExpectation;
      resolver: Awaited<ReturnType<typeof loadGameStatsIdentityResolver>>;
    }
  | { ok: false; detail: string }
> {
  try {
    const [scheduleItems, resolver] = await Promise.all([
      loadCachedScheduleItems(params.year),
      loadGameStatsIdentityResolver(),
    ]);
    return {
      ok: true,
      expectation: deriveSlateExpectation({
        scheduleItems,
        resolver,
        year: params.year,
        week: params.week,
        seasonType: params.seasonType,
        now: params.now,
      }),
      resolver,
    };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : 'unknown error' };
  }
}

/**
 * Year-level schedule-relative availability for the admin cache-state probe.
 * The SAME committed-state coverage authority public reads, recovery,
 * diagnostics, and refresh publication use — never "one analytics-eligible
 * row exists":
 *
 *   - `available` — at least one canonical-schedule slate has a SATISFIED
 *     expected game in committed durable state;
 *   - `absent`    — schedule-relative evaluation found no satisfied expected
 *     game (empty partitions, blocked-only evidence, placeholder-only slates,
 *     and schedule-unrelated stored rows are all NOT availability);
 *   - `unknown`   — no canonical schedule is cached but game-stats partitions
 *     exist: schedule-relative availability cannot be proven safely, and
 *     unknown never asserts absence.
 *
 * Read failures propagate to the caller's probe wrapper (→ `unknown`).
 */
export async function evaluateYearGameStatsAvailability(
  year: number,
  now: number
): Promise<'available' | 'absent' | 'unknown'> {
  const [scheduleItems, records] = await Promise.all([
    loadCachedScheduleItems(year),
    listCachedGameStats(year),
  ]);
  if (scheduleItems.length === 0) {
    return records.some((record) => (record.games?.length ?? 0) > 0) ? 'unknown' : 'absent';
  }
  const resolver = await loadGameStatsIdentityResolver();
  const plan = planGameStatsRecovery({
    year,
    scheduleItems,
    resolver,
    records,
    now,
    seasonRelation: 'current',
  });
  const slates = [...plan.candidates, ...plan.satisfied, ...plan.deferred];
  return slates.some((slate) => slate.coverage.satisfied.length > 0) ? 'available' : 'absent';
}

/**
 * The ordinary provider-free read. Envelope validation precedes coverage
 * evaluation and serving; availability derives from the shared committed-
 * state coverage of the VALIDATED record (schedule context permitting).
 */
export async function readPublicGameStats(params: {
  year: number;
  week: number;
  seasonType: CfbdSeasonType;
  seasonRelation: SeasonRelation;
  now: number;
}): Promise<PublicGameStatsReadResult> {
  const { year, week, seasonType, seasonRelation, now } = params;

  let cached: WeeklyGameStats | null;
  try {
    cached = await getCachedGameStats(year, week, seasonType);
  } catch (error) {
    return {
      kind: 'read-failed',
      detail: error instanceof Error ? error.message : 'unknown error',
    };
  }

  if (cached !== null) {
    const failures = validateWeeklyGameStatsEnvelope(cached, { year, week, seasonType });
    if (failures.length > 0) return { kind: 'invalid-envelope', failures };
  }

  const context = await loadSlateExpectationContext({ year, week, seasonType, now });
  const coverage = context.ok
    ? evaluateGameStatsPartitionCoverage(context.expectation, cached, { seasonRelation })
    : null;
  const availability = toAvailabilitySummary(coverage);

  if (!cached) return { kind: 'miss', availability };

  const age = now - Date.parse(cached.fetchedAt);
  return {
    kind: 'served',
    view: buildPublicWeeklyGameStats(cached),
    availability,
    stale: !(age < GAME_STATS_READ_TTL_MS),
  };
}

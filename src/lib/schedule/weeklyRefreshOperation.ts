/**
 * PLATFORM-086E1B (+E1B1) — the pure weekly schedule-refresh operation classifiers.
 *
 * The weekly cron refreshes each targeted year through the E1A authority, with
 * OPERATOR gating that is operation-aware: ordinary maintenance (active-season
 * `ordinary-maintenance` AND cache-armed early-preseason `preseason-maintenance`)
 * honors the global pause and the Schedule dataset toggle, while the
 * postseason-boundary maintenance that establishes a trustworthy season-rollover
 * boundary is lifecycle-critical and EXEMPT (exactly like the season-transition
 * and rollover crons themselves). The preseason ownership model (E1B1):
 *
 *   preseason, schedule/probe not armed        → daily season-transition owns discovery
 *   preseason, first game known and > 7d away  → weekly E1B ordinary maintenance
 *   preseason, within 7 days of first kickoff  → daily season-transition owns freshness + transition
 *   active season                              → weekly E1B (ordinary / sticky postseason-boundary)
 *
 * This module is the single decision authority for those classifications. It is
 * PURE and deterministic: it consumes only the invocation time, the prior-good
 * canonical `schedule/<year>-all-all` entry, the durable `schedule-probe/<year>`
 * state (preseason only, caller-supplied), and normalized schedule primitives —
 * never provider status, diagnostics freshness, manual query parameters, or
 * freshly fetched provider data.
 *
 * The lifecycle-critical boundary is `latest regular-season kickoff − 7 days`.
 * It deliberately does NOT depend on postseason games already existing: the exempt
 * window must begin early enough to DISCOVER the first postseason/championship
 * slate (an operator pause must never be able to starve the rollover boundary of
 * the data it needs). Because the latest regular-season kickoff is fixed once the
 * schedule is published and `now` only advances, a year that crosses the boundary
 * stays lifecycle-critical for every later invocation while its leagues remain in
 * `season` — no durable state is needed to make the classification sticky.
 *
 * Unavailable context (missing/empty/unreadable/malformed canonical schedule
 * state) is a typed refusal — it NEVER classifies, and the caller must do no
 * provider work for that year.
 */

import type { CacheEntry } from '@/app/api/schedule/cache';

export type WeeklyScheduleRefreshOperation =
  | 'preseason-maintenance'
  | 'ordinary-maintenance'
  | 'postseason-boundary';

export type WeeklyScheduleRefreshClassification =
  | { kind: 'operation'; operation: WeeklyScheduleRefreshOperation }
  | { kind: 'canonical-context-unavailable' };

/**
 * Classification of a PRESEASON year (PLATFORM-086E1B1): either cache-armed early
 * preseason gets ordinary weekly maintenance (`preseason-maintenance`), the year
 * defers to the daily season-transition cron (`season-transition-owner` — an
 * intentional provider-free skip, never a failure), or the context is unusable.
 */
export type PreseasonWeeklyRefreshClassification =
  | { kind: 'operation'; operation: 'preseason-maintenance' }
  | { kind: 'season-transition-owner' }
  | { kind: 'canonical-context-unavailable' };

/** The lifecycle-critical window opens 7 days before the latest regular kickoff. */
export const POSTSEASON_BOUNDARY_LEAD_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The preseason → season-transition freshness handoff opens 7 days before the
 * FIRST kickoff (PLATFORM-086E1B1). This mirrors the season-transition cron's
 * `shouldFetch` policy EXACTLY (`now >= firstGameDate − 7d`, missing probe
 * fields included), so the daily transition cron and the weekly route neither
 * leave a freshness gap nor compete over the same window: E1B owns ordinary
 * weekly maintenance ONLY in cache-armed early preseason (first game known and
 * MORE than 7 days away); discovery and the final-seven-day freshness stay with
 * season-transition.
 */
export const SEASON_TRANSITION_HANDOFF_LEAD_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Durable per-year boundary latch (cycle-1 review finding 1). The weekly route
 * writes `{ postseasonBoundaryReachedAt: <ISO> }` under
 * `schedule-weekly-control/<year>` the first time a year classifies
 * `postseason-boundary`, and passes `latched: true` into the classifier on every
 * later invocation — so a schedule change that moves the latest regular kickoff
 * LATER can never revert an already-critical year to operator-gated ordinary
 * maintenance. Read/written by the route (this module stays pure); a stale latch
 * for a year whose leagues left `season` is inert (the year is never targeted).
 */
export const SCHEDULE_WEEKLY_CONTROL_SCOPE = 'schedule-weekly-control';

export type ScheduleWeeklyControl = { postseasonBoundaryReachedAt: string };

/**
 * Season-type partition of a normalized schedule row, judged STRICTLY for the
 * lifecycle boundary (cycle-1 review finding 2): the canonical `seasonType`
 * decides; a row that OMITS it entirely (a hypothetical legacy row) falls back to
 * `gamePhase` — the same fallback the schedule route uses — but a row carrying a
 * PRESENT-yet-unrecognized `seasonType` (e.g. `"post-season"`) is MALFORMED, not
 * a regular-season row. Counting a malformed later row as regular would extend
 * the lifecycle boundary and let operator settings gate a genuinely critical
 * window, so a malformed row poisons the whole entry (`malformed`) and the
 * caller refuses with `canonical-context-unavailable` rather than guessing.
 */
function classifyRowPartition(
  item: CacheEntry['items'][number]
): 'regular' | 'postseason' | 'malformed' {
  const { seasonType } = item;
  if (seasonType === 'regular' || seasonType === 'postseason') return seasonType;
  if (seasonType === undefined || seasonType === null) {
    return item.gamePhase === 'postseason' ? 'postseason' : 'regular';
  }
  return 'malformed';
}

/** A usable kickoff → epoch ms, or null. */
function kickoffMs(startDate: string | null | undefined): number | null {
  if (typeof startDate !== 'string' || startDate.length === 0) return null;
  const ms = Date.parse(startDate);
  return Number.isFinite(ms) ? ms : null;
}

/** A stored value is a usable prior entry only when it carries a real items array. */
function normalizeEntry(value: unknown): CacheEntry | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<CacheEntry>;
  if (!Array.isArray(candidate.items)) return null;
  return candidate as CacheEntry;
}

/**
 * Classify one active `season` year's weekly refresh operation at `now` (epoch
 * ms) from its prior-good canonical schedule entry (the raw stored value —
 * malformed shapes degrade to `canonical-context-unavailable`, never a guess)
 * plus the caller-supplied durable boundary latch.
 *
 *   - No usable entry, no items, a row with a PRESENT-but-unrecognized
 *     `seasonType`, or no regular-season game with a valid kickoff
 *     → `canonical-context-unavailable` (the caller must not do provider work);
 *   - `latched === true` (this year already entered the lifecycle-critical
 *     window on an earlier invocation) → `postseason-boundary`, regardless of
 *     the recomputed boundary — see the latch note below;
 *   - `now < latestRegularKickoff − 7d` → `ordinary-maintenance` (operator-gated);
 *   - `now >= latestRegularKickoff − 7d` → `postseason-boundary`
 *     (lifecycle-critical, exempt from operator settings).
 *
 * The latch (cycle-1 review finding 1): the boundary is recomputed from the
 * LATEST cached schedule every invocation, so a refresh that adds/reschedules a
 * regular-season game to a LATER kickoff would otherwise move the boundary
 * forward and revert an already-critical year to ordinary — violating the rule
 * that once reached, the operation remains lifecycle-critical while the year's
 * leagues remain in `season`. The route persists a per-year durable latch the
 * first time a year classifies `postseason-boundary` and passes it back here on
 * every later invocation, keeping the classifier itself pure (the latch is an
 * explicit input, not hidden state). Context-unavailability still takes
 * precedence over the latch — unusable context never triggers provider work.
 */
/**
 * THE shared canonical-schedule context evaluation (PLATFORM-086E1B1 extraction —
 * behavior identical to the inline E1B logic): a usable entry must be a populated
 * items array whose rows all pass the strict partition vocabulary, with at least
 * one regular-season game carrying a valid kickoff. Returns the latest regular
 * kickoff on success. Both the active-season and preseason classifiers apply this
 * SAME check so "the existing E1B context checks" can never fork.
 */
function resolveLatestRegularKickoff(
  value: unknown
): { kind: 'ok'; latestRegularKickoffMs: number } | { kind: 'unavailable' } {
  const entry = normalizeEntry(value);
  if (!entry || entry.items.length === 0) {
    return { kind: 'unavailable' };
  }

  let latestRegularKickoffMs: number | null = null;
  for (const item of entry.items) {
    if (!item || typeof item !== 'object') continue;
    const partition = classifyRowPartition(item);
    // A malformed season type poisons the entry — refuse rather than guess a
    // boundary off a row we cannot attribute to a partition.
    if (partition === 'malformed') {
      return { kind: 'unavailable' };
    }
    if (partition !== 'regular') continue;
    const ms = kickoffMs(item.startDate);
    if (ms === null) continue;
    if (latestRegularKickoffMs === null || ms > latestRegularKickoffMs) {
      latestRegularKickoffMs = ms;
    }
  }
  // At least one regular-season game with a valid kickoff is required — without
  // it the boundary cannot be computed, so the context is unusable.
  if (latestRegularKickoffMs === null) {
    return { kind: 'unavailable' };
  }
  return { kind: 'ok', latestRegularKickoffMs };
}

export function classifyWeeklyScheduleRefreshOperation(params: {
  entry: unknown;
  now: number;
  /** True when this year already entered the critical window on a prior run. */
  latched?: boolean;
}): WeeklyScheduleRefreshClassification {
  const context = resolveLatestRegularKickoff(params.entry);
  if (context.kind !== 'ok') {
    return { kind: 'canonical-context-unavailable' };
  }

  // An already-latched year stays lifecycle-critical even if a schedule change
  // moved the recomputed boundary later.
  if (params.latched === true) {
    return { kind: 'operation', operation: 'postseason-boundary' };
  }

  const boundaryMs = context.latestRegularKickoffMs - POSTSEASON_BOUNDARY_LEAD_MS;
  return {
    kind: 'operation',
    operation: params.now >= boundaryMs ? 'postseason-boundary' : 'ordinary-maintenance',
  };
}

/**
 * The durable schedule-probe state as the preseason classifier consumes it
 * (`schedule-probe/<year>`, written by the season-transition cron). Normalized
 * defensively: a missing/non-object record, a falsy `baseCachedAt`, or an
 * absent/unparseable `firstGameDate` all mirror the season-transition
 * `shouldFetch` predicate's "fetch" side — the transition cron owns those years.
 */
function normalizeProbe(value: unknown): { armed: boolean; firstGameMs: number | null } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { armed: false, firstGameMs: null };
  }
  const candidate = value as { baseCachedAt?: unknown; firstGameDate?: unknown };
  const baseCachedAtValid =
    typeof candidate.baseCachedAt === 'string' && candidate.baseCachedAt.length > 0;
  const firstGameMs =
    typeof candidate.firstGameDate === 'string' && candidate.firstGameDate.length > 0
      ? Date.parse(candidate.firstGameDate)
      : Number.NaN;
  return {
    armed: baseCachedAtValid,
    firstGameMs: Number.isFinite(firstGameMs) ? firstGameMs : null,
  };
}

/**
 * Classify one PRESEASON year's weekly refresh operation at `now` (epoch ms)
 * from its prior-good canonical schedule entry AND its durable schedule-probe
 * state (PLATFORM-086E1B1). PURE — no reads or writes; the route supplies both
 * stored values.
 *
 * Ownership rules (mirroring the season-transition cron's `shouldFetch`
 * predicate EXACTLY, so the two jobs neither leave a gap nor compete):
 *
 *   - no probe record, missing/invalid `baseCachedAt`, missing/invalid
 *     `firstGameDate`, or `now >= firstGameDate − 7d` (the exact boundary
 *     included) → `season-transition-owner` — the DAILY transition cron owns
 *     discovery and the final-seven-day freshness; the weekly route makes no
 *     provider work for the year (an intentional skip, never a failure);
 *   - otherwise (cache-armed EARLY preseason: first game known and more than 7
 *     days away) the canonical schedule entry must pass the SAME context checks
 *     as the active-season classifier (populated, well-formed vocabulary, ≥1
 *     regular game with a valid kickoff) → `preseason-maintenance` — an
 *     ORDINARY/noncritical operation (honors the global pause + Schedule toggle;
 *     a settings failure blocks it; it never reads or writes the
 *     postseason-boundary latch);
 *   - an armed early-preseason probe whose canonical entry is missing, empty, or
 *     malformed → `canonical-context-unavailable` (a genuine context failure is
 *     NEVER converted into a transition deferral).
 */
export function classifyPreseasonWeeklyRefreshOperation(params: {
  entry: unknown;
  probe: unknown;
  now: number;
}): PreseasonWeeklyRefreshClassification {
  const probe = normalizeProbe(params.probe);
  if (
    !probe.armed ||
    probe.firstGameMs === null ||
    params.now >= probe.firstGameMs - SEASON_TRANSITION_HANDOFF_LEAD_MS
  ) {
    return { kind: 'season-transition-owner' };
  }

  // Cache-armed early preseason — the canonical schedule must be usable (the
  // probe claims a cached schedule; a missing/empty/malformed entry contradicts
  // it and is a context failure, not a deferral).
  const context = resolveLatestRegularKickoff(params.entry);
  if (context.kind !== 'ok') {
    return { kind: 'canonical-context-unavailable' };
  }
  return { kind: 'operation', operation: 'preseason-maintenance' };
}

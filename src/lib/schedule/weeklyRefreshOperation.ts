/**
 * PLATFORM-086E1B — the pure weekly schedule-refresh operation classifier.
 *
 * The weekly cron refreshes each active `season` year through the E1A authority,
 * but its OPERATOR gating is operation-aware: ordinary weekly maintenance honors
 * the global pause and the Schedule dataset toggle, while the postseason-boundary
 * maintenance that establishes a trustworthy season-rollover boundary is
 * lifecycle-critical and EXEMPT (exactly like the season-transition and rollover
 * crons themselves). This module is the single decision authority for that
 * classification. It is PURE and deterministic: it consumes only the invocation
 * time, the prior-good canonical `schedule/<year>-all-all` entry, and normalized
 * schedule primitives — never provider status, diagnostics freshness, manual query
 * parameters, or freshly fetched provider data.
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

export type WeeklyScheduleRefreshOperation = 'ordinary-maintenance' | 'postseason-boundary';

export type WeeklyScheduleRefreshClassification =
  | { kind: 'operation'; operation: WeeklyScheduleRefreshOperation }
  | { kind: 'canonical-context-unavailable' };

/** The lifecycle-critical window opens 7 days before the latest regular kickoff. */
export const POSTSEASON_BOUNDARY_LEAD_MS = 7 * 24 * 60 * 60 * 1000;

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
export function classifyWeeklyScheduleRefreshOperation(params: {
  entry: unknown;
  now: number;
  /** True when this year already entered the critical window on a prior run. */
  latched?: boolean;
}): WeeklyScheduleRefreshClassification {
  const entry = normalizeEntry(params.entry);
  if (!entry || entry.items.length === 0) {
    return { kind: 'canonical-context-unavailable' };
  }

  let latestRegularKickoffMs: number | null = null;
  for (const item of entry.items) {
    if (!item || typeof item !== 'object') continue;
    const partition = classifyRowPartition(item);
    // A malformed season type poisons the entry — refuse rather than guess a
    // boundary off a row we cannot attribute to a partition.
    if (partition === 'malformed') {
      return { kind: 'canonical-context-unavailable' };
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
    return { kind: 'canonical-context-unavailable' };
  }

  // An already-latched year stays lifecycle-critical even if a schedule change
  // moved the recomputed boundary later.
  if (params.latched === true) {
    return { kind: 'operation', operation: 'postseason-boundary' };
  }

  const boundaryMs = latestRegularKickoffMs - POSTSEASON_BOUNDARY_LEAD_MS;
  return {
    kind: 'operation',
    operation: params.now >= boundaryMs ? 'postseason-boundary' : 'ordinary-maintenance',
  };
}

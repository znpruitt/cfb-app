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
 * Canonical season-type partition for a normalized schedule row — the same
 * defensive fallback the schedule route uses: read the canonical `seasonType`
 * field; only a hypothetical legacy row without it falls back to `gamePhase`.
 */
function isRegularSeasonRow(item: CacheEntry['items'][number]): boolean {
  if (item.seasonType === 'regular' || item.seasonType === 'postseason') {
    return item.seasonType === 'regular';
  }
  return item.gamePhase !== 'postseason';
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
 * malformed shapes degrade to `canonical-context-unavailable`, never a guess).
 *
 *   - No usable entry, no items, or no regular-season game with a valid kickoff
 *     → `canonical-context-unavailable` (the caller must not do provider work);
 *   - `now < latestRegularKickoff − 7d` → `ordinary-maintenance` (operator-gated);
 *   - `now >= latestRegularKickoff − 7d` → `postseason-boundary`
 *     (lifecycle-critical, exempt from operator settings).
 */
export function classifyWeeklyScheduleRefreshOperation(params: {
  entry: unknown;
  now: number;
}): WeeklyScheduleRefreshClassification {
  const entry = normalizeEntry(params.entry);
  if (!entry || entry.items.length === 0) {
    return { kind: 'canonical-context-unavailable' };
  }

  let latestRegularKickoffMs: number | null = null;
  for (const item of entry.items) {
    if (!item || typeof item !== 'object') continue;
    if (!isRegularSeasonRow(item)) continue;
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

  const boundaryMs = latestRegularKickoffMs - POSTSEASON_BOUNDARY_LEAD_MS;
  return {
    kind: 'operation',
    operation: params.now >= boundaryMs ? 'postseason-boundary' : 'ordinary-maintenance',
  };
}

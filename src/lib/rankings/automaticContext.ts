/**
 * PLATFORM-086E2B — registry target selection + CACHE-ONLY publication context
 * for the automatic rankings cron.
 *
 * Target years come ONLY from the durable league registry (`preseason` and
 * `season` lifecycle states, grouped by `status.year`, ascending; any `season`
 * league owns a mixed year) — never from the calendar and never from
 * `league.year`. For each target year this module loads the cache-only context
 * the merged E2A publication-window classifier consumes: the earliest valid
 * canonical schedule kickoff, the structured CFP national-championship kickoff
 * (through the existing E1A resolver — no text inference is reproduced here),
 * and which poll sources already have usable cached rankings data.
 *
 * Strictly read-only and provider-free: no CFBD request, no application-route
 * fetch, no state mutation. Failure vs absence is explicit:
 *   - a genuine store READ failure is UNAVAILABLE context (the caller refuses
 *     provider work for the year);
 *   - an ABSENT schedule is known absence — null kickoff/championship fields
 *     (the calendar-defined CFP window still works);
 *   - a PRESENT but malformed schedule or rankings record is UNAVAILABLE
 *     context (corruption is never coerced into "no data");
 *   - ABSENT rankings are valid absence — all three poll flags false.
 */

import type { League } from '../league.ts';
import type { ScheduleWireItem } from '../schedule.ts';
import { resolveStructuredChampionshipItem } from '../schedule/nationalChampionshipRollover.ts';
import { getAppState } from '../server/appStateStore.ts';
import { normalizeStoredRankingsEntry } from '../server/rankings.ts';
import type { RankingsPublicationContext } from './publicationPolicy.ts';

export type RankingsTargetLifecycle = 'preseason' | 'season';

export type RankingsTargetYear = {
  year: number;
  lifecycle: RankingsTargetLifecycle;
};

/**
 * Select the distinct target years from the league registry: `preseason` and
 * `season` states only (`offseason` excluded), keyed by `status.year`,
 * ascending. A year with both lifecycle states resolves to `season`. Pure —
 * the caller owns the registry read (and its failure handling).
 */
export function selectRankingsTargetYears(leagues: readonly League[]): RankingsTargetYear[] {
  const lifecycleByYear = new Map<number, RankingsTargetLifecycle>();
  for (const league of leagues) {
    const status = league.status;
    if (status?.state === 'season') {
      lifecycleByYear.set(status.year, 'season');
    } else if (status?.state === 'preseason' && lifecycleByYear.get(status.year) !== 'season') {
      lifecycleByYear.set(status.year, 'preseason');
    }
  }
  return [...lifecycleByYear.entries()]
    .map(([year, lifecycle]) => ({ year, lifecycle }))
    .sort((a, b) => a.year - b.year);
}

export type RankingsPublicationContextResult =
  | { kind: 'ok'; context: RankingsPublicationContext }
  | { kind: 'unavailable' };

/** A usable kickoff instant (epoch ms), or null. */
function kickoffMs(startDate: string | null | undefined): number | null {
  if (typeof startDate !== 'string') return null;
  const ms = Date.parse(startDate);
  return Number.isFinite(ms) ? ms : null;
}

type StoredScheduleShape = { items?: unknown };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Read the canonical `schedule/<year>-all-all` entry cache-only and classify it:
 *   - absent record → known absence (`{ items: null }`);
 *   - present record whose `items` is an array of plain objects → usable items
 *     (individual FIELDS may be legitimately absent/null on older records —
 *     that is known shape variation, not corruption);
 *   - present record with any other shape — a non-array `items`, or ANY
 *     non-object element — → malformed (unavailable): element-level corruption
 *     must never manufacture kickoff- or championship-derived windows
 *     (Codex round-1 finding #1).
 * A store read failure propagates to the caller (unavailable context).
 */
async function readScheduleItems(
  year: number
): Promise<
  { kind: 'absent' } | { kind: 'items'; items: ScheduleWireItem[] } | { kind: 'malformed' }
> {
  const record = await getAppState<StoredScheduleShape>('schedule', `${year}-all-all`);
  if (record === null || record.value === null || record.value === undefined) {
    return { kind: 'absent' };
  }
  const items = (record.value as StoredScheduleShape).items;
  if (!Array.isArray(items) || !items.every(isPlainObject)) return { kind: 'malformed' };
  return { kind: 'items', items: items as unknown as ScheduleWireItem[] };
}

/**
 * Load the cache-only publication context for ONE target year. `scheduledAt` is
 * the single route-entry UTC instant (the classifier's heartbeat slot) — this
 * loader never invents its own clock.
 */
export async function loadRankingsPublicationContext(params: {
  year: number;
  lifecycle: RankingsTargetLifecycle;
  scheduledAt: Date;
}): Promise<RankingsPublicationContextResult> {
  const { year, lifecycle, scheduledAt } = params;

  let firstKickoffAt: string | null = null;
  let structuredChampionshipKickoffAt: string | null = null;
  try {
    const schedule = await readScheduleItems(year);
    if (schedule.kind === 'malformed') return { kind: 'unavailable' };
    if (schedule.kind === 'items') {
      // Earliest valid canonical kickoff across the season's items.
      let earliest: { ms: number; iso: string } | null = null;
      for (const item of schedule.items) {
        const ms = kickoffMs(item?.startDate);
        if (ms !== null && (earliest === null || ms < earliest.ms)) {
          earliest = { ms, iso: item.startDate as string };
        }
      }
      firstKickoffAt = earliest?.iso ?? null;
      // Structured CFP national championship through the E1A resolver only.
      const championship = resolveStructuredChampionshipItem(schedule.items);
      structuredChampionshipKickoffAt = championship?.startDate ?? null;
    }
  } catch {
    return { kind: 'unavailable' };
  }

  let hasAp = false;
  let hasCoaches = false;
  let hasCfp = false;
  try {
    const record = await getAppState<unknown>('rankings', String(year));
    if (record !== null && record.value !== null && record.value !== undefined) {
      const entry = normalizeStoredRankingsEntry(record.value);
      // A PRESENT rankings record that does not normalize is malformed state —
      // unavailable, never coerced into "no polls yet".
      if (entry === null) return { kind: 'unavailable' };
      // Coverage counts ONLY well-formed poll ARRAYS on weeks labeled with THIS
      // season (Codex round-1 finding #2): a foreign-season week (possible in
      // pre-E2A snapshots) or a malformed poll value (a string's `.length` is
      // truthy) must never mark a source "already published" and suppress its
      // discovery window. Not counting them is deliberately self-healing — at
      // worst one due window refreshes and rewrites the record clean — where
      // failing the year unavailable would wedge automation until manual repair.
      const populated = (value: unknown): boolean => Array.isArray(value) && value.length > 0;
      for (const week of entry.response.weeks) {
        if (week?.season !== year) continue;
        if (populated(week.polls?.ap)) hasAp = true;
        if (populated(week.polls?.coaches)) hasCoaches = true;
        if (populated(week.polls?.cfp)) hasCfp = true;
      }
    }
  } catch {
    return { kind: 'unavailable' };
  }

  return {
    kind: 'ok',
    context: {
      scheduledAt,
      year,
      lifecycle,
      firstKickoffAt,
      structuredChampionshipKickoffAt,
      hasAp,
      hasCoaches,
      hasCfp,
    },
  };
}

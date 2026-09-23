/**
 * PLATFORM-086E2B — registry target selection + CACHE-ONLY publication context
 * for the automatic rankings cron.
 *
 * Target years come ONLY from the durable league registry (`preseason` and
 * `season` lifecycle states, grouped by `status.year`, ascending; any `season`
 * PRODUCTION league owns a mixed year) — never from the calendar and never from
 * `league.year`. PLATFORM-086F2H1T4 made ownership production-only: the demo
 * league is manual-only for automatic rankings publication and is excluded
 * before it can contribute a target year.
 *
 * For each target year this module loads the cache-only context the merged E2A
 * publication-window classifier consumes: the earliest valid
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

import {
  selectActiveSeasonTargetYears,
  type ActiveSeasonLifecycle,
  type ActiveSeasonRefusalSink,
  type ActiveSeasonTargetSelection,
  type ActiveSeasonTargetYear,
} from '../activeSeasonTargets.ts';
import type { ScheduleWireItem } from '../schedule.ts';
import { resolveStructuredChampionshipItem } from '../schedule/nationalChampionshipRollover.ts';
import { getAppState } from '../server/appStateStore.ts';
import { normalizeStoredRankingsEntry } from '../server/rankings.ts';
import type { RankingsPublicationContext } from './publicationPolicy.ts';

/**
 * Registry target selection MOVED to `lib/activeSeasonTargets.ts` (#757a) and
 * re-exported here under its established rankings names, so this module's
 * consumers and tests are unchanged.
 *
 * The selection itself is not rankings policy — it is the league registry's
 * definition of an active season year, and the standalone schedule-presentation
 * job needs the identical answer. What stays HERE is the part that is genuinely
 * about rankings: what this module's callers do with the result.
 *
 * ## The demo exclusion's rankings-specific consequences
 *
 * The per-league demo exclusion is NOT an owner-selector correction with
 * behavioral weight for rankings. `season` still outranks `preseason` for a
 * shared year, so a demo league in `season(Y)` did previously determine the
 * reported lifecycle of a year whose only production leagues are in
 * `preseason(Y)` — but {@link RankingsPublicationContext.lifecycle} is inert
 * (see `publicationPolicy.ts`: no window branches on it, and the publication key
 * omits it), so that direction is a REPORTING-truth fix only: no window
 * decision, publication key, quota gate, provider request, or durable write
 * changes. The per-league placement is required by target survival, not by
 * lifecycle resolution.
 *
 * That "changes nothing" holds for a SHARED year only. A year the demo occupies
 * ALONE loses automatic publication outright: `rankings/<year>` is never
 * refreshed, so every rankings read for that year sees a permanent cache miss.
 * The consequence is NOT uniform across readers, and the difference matters:
 *   - the draft board's AP annotation and Insights swallow the miss (a `catch`
 *     and a `.catch(() => null)`), degrading to no annotation;
 *   - the league app does NOT. `loadSeasonRankings` THROWS on a total cache
 *     miss, `/api/rankings` maps that to 503, and `CFBScheduleApp` records
 *     `CFBD rankings load failed: …`. POLISH-005 removed that string's
 *     member-facing render AND the preseason-only suppression that used to
 *     filter it, so a demo league in `season(Y)` on a demo-only year now
 *     surfaces NOTHING to a member; the exposure is operator-side only, through
 *     System Health's `rankings-cache-missing`/`-stale` codes.
 * The authorized manual refresh (`/api/rankings?year=<Y>&bypassCache=1`) is the
 * upkeep path, and it is ungated by the automation settings — but it is NOT
 * unconditionally reachable: that route rejects any year above
 * `currentUTCYear + 1` with a 400 before authorizing, while the demo lifecycle
 * authority deliberately imposes no such ceiling. A demo parked far enough
 * ahead therefore has no upkeep path at all until the calendar catches up
 * (recorded against F2H1R/T5 — not repaired here).
 *
 * No league-scoped duty transfers to the demo controls, because this path
 * writes none.
 *
 * ## Why the structural year guard matters HERE specifically
 *
 * The shared selector refuses a structurally invalid `status.year`. The rankings
 * hazard it removes is NOT fractional-only: `Date.UTC('2026', …)` coerces rather
 * than returning NaN, so a STRING year makes the context-free CFP publication
 * window become due and produces a provider URL that looks legitimate. Before
 * F2H1R3 such a year became a target key and could claim a publication window,
 * spend quota, call CFBD, and commit rankings under an unusable key.
 */
export { selectActiveSeasonTargetYears as selectRankingsTargetYears };
export type {
  ActiveSeasonLifecycle as RankingsTargetLifecycle,
  ActiveSeasonRefusalSink as RankingsRefusalSink,
  ActiveSeasonTargetSelection as RankingsTargetSelection,
  ActiveSeasonTargetYear as RankingsTargetYear,
};

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
  lifecycle: ActiveSeasonLifecycle;
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

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

import { isStructurallyValidSeasonYear, TEST_LEAGUE_SLUG, type League } from '../league.ts';
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
 * The closed result of target selection: the production-owned target years plus
 * the one fact the caller cannot re-derive from them — whether an otherwise
 * eligible demo target was excluded. Both are produced by the SAME loop, so a
 * caller can never observe years without the exclusion truth that shaped them.
 */
export type RankingsTargetSelection = {
  years: RankingsTargetYear[];
  /** True when an ACTIVE demo league was excluded from selection. */
  excludedDemoCandidate: boolean;
};

/**
 * PLATFORM-086F2H1R3 — the run-scoped surface the selector publishes refusals
 * into AS IT COUNTS THEM, rather than returning them after the loop.
 *
 * This is not a style choice. AGENTS.md requires the refusal count to survive a
 * mid-loop throw, and the ownership loop is exactly a loop that can throw: the
 * registry array is typed `League[]` but nothing validates each element, so a
 * non-object member throws on property access. A count returned only on the
 * normal path is discarded whenever a later record throws, and the caller then
 * reports zero refusals on a run that found them — on the response, the runtime
 * event, AND the receipt.
 *
 * Deliberately NOT also on the return value: two channels for one fact can
 * drift, and a caller that read both would double-count. The sink is the single
 * source of truth. Counted per LEAGUE RECORD, not per distinct raw year — three
 * records sharing one unusable year count three, because there is no usable
 * year to deduplicate them by in the first place.
 */
export type RankingsRefusalSink = { invalidLifecycleTargets: number };

/**
 * Select the distinct target years from the league registry: `preseason` and
 * `season` states only (`offseason` excluded), keyed by `status.year`,
 * ascending. A year with both lifecycle states resolves to `season`. Pure —
 * the caller owns the registry read (and its failure handling).
 *
 * PLATFORM-086F2H1T4 — the demo league is MANUAL-ONLY for automatic rankings
 * publication, so ownership resolves from PRODUCTION leagues alone.
 *
 * `TEST_LEAGUE_SLUG` is filtered PER LEAGUE, inside this loop, before the league
 * can contribute year membership or lifecycle precedence. It cannot be filtered
 * against the returned `years`: that would drop an entire year a PRODUCTION
 * league also occupies, removing its automatic publication — a worse regression
 * than the one this fixes.
 *
 * Unlike PLATFORM-086F2H1T3 this is NOT an owner-selector correction with
 * behavioral weight. `season` still outranks `preseason` for a shared year, so a
 * demo league in `season(Y)` did previously determine the reported lifecycle of a
 * year whose only production leagues are in `preseason(Y)` — but
 * `RankingsPublicationContext.lifecycle` is inert (see `publicationPolicy.ts`:
 * no window branches on it, and the publication key omits it), so that direction
 * is a REPORTING-truth fix only: no window decision, publication key, quota
 * gate, provider request, or durable write changes. The per-league placement is
 * required by target survival, not by lifecycle resolution.
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
 * The DEMO EXCLUSION FLAG is derived from `slug` and `status.state` ONLY —
 * never from `status.year`. That narrow property is what makes the F2H1R3
 * ordering below safe. It is NOT the broader claim that an unvalidated year
 * cannot affect the caller's zero-target reason: as of R3 it plainly can, by
 * producing `unusable-lifecycle-year`. What survives is that a bad year cannot
 * masquerade as, or suppress, the DEMO reason.
 *
 * PLATFORM-086F2H1R3 — an active PRODUCTION candidate's `status.year` is then
 * validated structurally, AFTER the demo exclusion. The order is load-bearing in
 * one direction: an active DEMO record carrying an unusable year must stay a
 * demo exclusion, so the caller keeps reporting
 * `no-automatic-ranking-target`. Validating first would count it as an invalid
 * production target and undo F2H1T4's reason.
 *
 * `status.year` arrives here straight from durable JSON — `getLeagues()` performs
 * no per-record validation — and the rankings hazard is NOT fractional-only:
 * `Date.UTC('2026', …)` coerces rather than returning NaN, so a STRING year
 * makes the context-free CFP publication window become due and produces a
 * provider URL that looks legitimate. Before this slice such a year became a
 * `lifecycleByYear` key and could claim a publication window, spend quota, call
 * CFBD, and commit rankings under an unusable key.
 */
export function selectRankingsTargetYears(
  leagues: readonly League[],
  // REQUIRED: a defaulted or optional sink would let a caller silently record
  // zero refusals with no compiler signal — the same reasoning that makes
  // `rankingsYearsTarget`'s count parameter required.
  refusals: RankingsRefusalSink
): RankingsTargetSelection {
  const lifecycleByYear = new Map<number, RankingsTargetLifecycle>();
  let excludedDemoCandidate = false;
  for (const league of leagues) {
    const status = league.status;
    const isActive = status?.state === 'season' || status?.state === 'preseason';

    // An `offseason` (or status-less) demo record is not an excluded CANDIDATE —
    // it was never eligible. Setting the flag on the slug alone would make every
    // empty-target run report the demo reason and leave `no-ranking-target`
    // unreachable, which is exactly the falsehood this slice exists to avoid.
    if (isActive && league.slug === TEST_LEAGUE_SLUG) {
      excludedDemoCandidate = true;
      continue;
    }

    // PLATFORM-086F2H1R3 — structural year validity, AFTER the demo exclusion
    // above and BEFORE the year can own a lifecycle. A refused candidate
    // contributes no map key and no lifecycle precedence, so it can neither
    // become a target nor promote a shared year from `preseason` to `season`.
    //
    // Offseason and status-less PRODUCTION records are NOT counted: they were
    // never candidates, exactly as they were never targets.
    if (isActive && !isStructurallyValidSeasonYear(status.year)) {
      // Published on the RUN STATE immediately, not accumulated locally: a later
      // record that throws must not discard a refusal already observed.
      refusals.invalidLifecycleTargets += 1;
      continue;
    }

    if (status?.state === 'season') {
      lifecycleByYear.set(status.year, 'season');
    } else if (status?.state === 'preseason' && lifecycleByYear.get(status.year) !== 'season') {
      lifecycleByYear.set(status.year, 'preseason');
    }
  }
  return {
    years: [...lifecycleByYear.entries()]
      .map(([year, lifecycle]) => ({ year, lifecycle }))
      .sort((a, b) => a.year - b.year),
    excludedDemoCandidate,
  };
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

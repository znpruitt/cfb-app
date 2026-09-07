import type { ScheduleWireItem } from '../schedule';
import {
  derivePollingWindows,
  RECONCILIATION_GUARANTEE_MS,
  type PlannedKickoff,
  type PollingWindow,
} from './pollingWindows';

/**
 * PLATFORM-102 slice 4 — the planner's PURE half: which UTC day is being planned,
 * which kickoffs the canonical schedule offers it, and which windows those become.
 *
 * No clock of its own, no I/O, no durable state. `pollingPlannerApply.ts` sends
 * the result to QStash and `api/cron/polling-planner` is the thing that runs.
 *
 * WHY THIS IS A SEPARATE MODULE FROM slices 1 and 2. `derivePollingWindows` turns
 * kickoffs into windows and `synthesizePollingCrons` turns windows into crons;
 * both are merged and neither may be edited. What neither answers — and both
 * explicitly hand to their caller — is which day to plan and what to do with a
 * kickoff whose time is not yet published. Those two answers live here, so that
 * "the caller decided" is a line of code rather than an omission.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * How far ahead of `now` the planned day is chosen — one hour.
 *
 * THE PLANNER PLANS THE DAY BEFORE IT STARTS, and that is a correctness
 * requirement, not a convenience. `utcHoursCovered` projects onto ONE day and a
 * cron has no date field, so yesterday's expression fires yesterday's hour set
 * again today until it is rewritten. A Saturday-night cluster's dense phase runs
 * into Sunday hours 0-8; those hours are not in Saturday's expression, so a
 * planner that ran at 00:05 Sunday would leave the first minutes of a live game's
 * coverage to a cron that does not cover it. `pollingCron.ts` names this exactly:
 * "A window crossing midnight is covered on each day it touches by THAT day's
 * plan — a requirement on slice 4's daily rewrite."
 *
 * So the scheduled run sits at 23:50 UTC and this lead carries it over the
 * boundary into the day about to begin. It is a LEAD rather than a hardcoded
 * "tomorrow" because an ad-hoc or recovery run at 09:00 must plan the day it is
 * actually in, not the next one — which "always tomorrow" would get wrong in the
 * one situation an operator runs it by hand.
 */
export const PLANNING_LEAD_MS = HOUR_MS;

/**
 * Midnight UTC of the day being planned: the day containing `now + 1h`.
 *
 * Returns `synthesizePollingCrons`' own `dayStartMs` contract — an exact UTC
 * midnight — which that function validates rather than trusts, for the reason its
 * `validDayStart` records: an offset day start rotates the whole hour field and
 * arms the wrong hours silently.
 */
export function resolvePlanningDayStartMs(nowMs: number): number {
  if (!Number.isFinite(nowMs)) {
    throw new Error(`nowMs must be finite, received ${nowMs}`);
  }
  return Math.floor((nowMs + PLANNING_LEAD_MS) / DAY_MS) * DAY_MS;
}

/**
 * The subset of a canonical schedule row the planner reads. Nothing else is
 * touched.
 *
 * TYPED FROM `ScheduleWireItem` RATHER THAN HAND-WRITTEN, and the difference is
 * not cosmetic. The first version of this type declared `date`, which is the
 * field name on the CANONICAL `AppGame` (`schedule.ts` builds it as
 * `date: item.startDate`) and does not exist on the durable cache row this
 * planner actually reads. Every test fixture was written from the same wrong
 * name, so the whole suite passed while the planner derived ZERO kickoffs from
 * production and would have paused both jobs every day of the season. Measuring
 * against the real record found it; a `Pick` makes the compiler find it next
 * time.
 */
export type PlannerScheduleRow = Pick<ScheduleWireItem, 'startDate' | 'startTimeTBD'>;

/**
 * Canonical schedule rows → the kickoffs slice 1 consumes.
 *
 * THE TBD MAPPING IS PINNED HERE, and `PlannedKickoff` names this slice as the
 * one that owed it: "the natural mapping `timeConfirmed: !row.startTimeTBD` FAILS
 * OPEN. `startTimeTBD` is optional on the wire and is hydrated only when the
 * provider sends a boolean, so a row where CFBD omits the flag maps to `true` —
 * confirmed — reintroducing exactly the placeholder clustering this field exists
 * to prevent."
 *
 * So confirmation requires an EXPLICIT `false`. A row with no flag is treated as
 * unconfirmed and gets the whole-day arming below: over-covering, which is this
 * item's stated safety direction, rather than clustering on a placeholder instant
 * that is 12 to 19 hours off the real kickoff.
 *
 * A row whose `startDate` does not parse contributes nothing. It cannot: there is no
 * instant to plan around, and inventing one is how a window lands on the wrong
 * day. Measured on the shipped 2026 record, 0 of 3,679 `startDate` values fail
 * to parse, so this is a guard rather than a live path.
 */
export function plannedKickoffsFromRows(rows: readonly PlannerScheduleRow[]): PlannedKickoff[] {
  const kickoffs: PlannedKickoff[] = [];
  for (const row of rows) {
    if (typeof row.startDate !== 'string') continue;
    const kickoffMs = Date.parse(row.startDate);
    if (!Number.isFinite(kickoffMs)) continue;
    kickoffs.push({ kickoffMs, timeConfirmed: row.startTimeTBD === false });
  }
  return kickoffs;
}

/**
 * The window a kickoff with no published time earns: its published UTC DAY, armed
 * end to end, plus the standard reconciliation tail measured from the latest
 * instant that day could still hold a kickoff.
 *
 * WHY A WHOLE DAY RATHER THAN A CLUSTER. CFBD publishes a TBD row with a
 * PLACEHOLDER instant at UTC hour 4 or 5 — midnight or 1am Eastern on the game
 * date — and the real kickoff lands 12 to 19 hours later, which is UTC hour 16 to
 * 24 of that same date. Clustering on the placeholder arms hours 4-12 and goes
 * dark over every one of those. Widening the cluster margin instead would arm
 * roughly two days per TBD game. The published DATE is the one fact the row
 * states truthfully, so the day it names is the tightest honest window.
 *
 * WHAT IT COSTS, AND WHY IT IS SMALL. TBD rows are overwhelmingly Saturdays,
 * which confirmed kickoffs already arm densely, so the marginal hours are mostly
 * hours the plan holds anyway. The measured figure is reported with the branch
 * rather than asserted here.
 *
 * This is deliberately a shape `derivePollingWindows` never emits, and it is
 * legal because `synthesizePollingCrons` accepts any window satisfying
 * `startMs <= denseEndMs <= slowEndMs` — its CONTRACT, not its callers' habits.
 */
export function wholeDayWindowFor(kickoffMs: number): PollingWindow {
  const dayStartMs = Math.floor(kickoffMs / DAY_MS) * DAY_MS;
  const dayEndMs = dayStartMs + DAY_MS;
  return {
    startMs: dayStartMs,
    denseEndMs: dayEndMs,
    // The guarantee is measured from the LATEST kickoff the day could hold, so a
    // game that turns out to start at 23:30 still gets its full reconciliation.
    slowEndMs: dayEndMs + RECONCILIATION_GUARANTEE_MS,
    kickoffCount: 1,
  };
}

export type PlannerWindows = {
  /** Confirmed clusters plus one whole-day window per unconfirmed kickoff. */
  windows: PollingWindow[];
  /** Reporting only — how many rows had no published time. Never a gate. */
  unconfirmedKickoffs: number;
  /** Reporting only — how many rows carried a usable instant at all. */
  plannedKickoffs: number;
};

/**
 * Every window the planner wants covered, from every kickoff the schedule offers.
 *
 * THE WHOLE SEASON GOES IN, not a pre-filtered slice of it. Filtering kickoffs to
 * "near the planning day" would be cheaper and would also change cluster
 * BOUNDARIES: dropping an early member moves a cluster's `startMs`, so the
 * surviving window is a different window. `utcHoursCovered` already projects onto
 * the one day being planned, and it is the only thing entitled to narrow this.
 */
export function plannerWindows(rows: readonly PlannerScheduleRow[]): PlannerWindows {
  const kickoffs = plannedKickoffsFromRows(rows);
  const { windows, unconfirmed } = derivePollingWindows(kickoffs);
  return {
    windows: [...windows, ...unconfirmed.map((kickoff) => wholeDayWindowFor(kickoff.kickoffMs))],
    unconfirmedKickoffs: unconfirmed.length,
    plannedKickoffs: kickoffs.length,
  };
}

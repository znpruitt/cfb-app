import { POLLING_WINDOW_BEFORE_KICKOFF_MS } from '@/lib/liveScores/pollingTarget';

/**
 * PLATFORM-102 slice 1 — derive polling windows from kickoff times alone.
 *
 * Pure, deterministic, no clock and no I/O. This is the input a daily planner
 * needs to narrow the QStash cron, and Item 131 needs the same clusters for
 * game-stats collection, which is why it lives here rather than under
 * `liveScores/`.
 *
 * WHY CLUSTERS. Today the cron fires every three minutes forever, and the
 * eligibility window (`kickoff + 24h`) keeps it armed almost continuously in
 * season: one Saturday game arms all of Sunday. Measured against the real 2026
 * schedule, hours armed run 74% in October and 17% for the year. Grouping games
 * into contiguous CLUSTERS and closing each one a margin after its last kickoff
 * takes October to 36% — the 2026-09-03 weekend is five clusters (Thu, Fri, Sat,
 * Sun, Mon), not one four-day window.
 *
 * VERIFIED against the shipped `schedule / 2026-all-all` record (3,679 kickoffs):
 * 59 clusters, 779 dense hours. Note the cost of `utcHoursCovered`: projecting
 * onto whole hours arms **39%** of October rather than the windows' own 36%,
 * because cron cannot fire for part of an hour. So the deliverable saving is
 * **61%** of October wakeups, not the 64% the raw windows suggest — the three
 * points are the price of cron's granularity, and they are real.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. It never decides whether a game is
 * pollable — that is `pollingTarget.ts`, which reads durable resolution state
 * this module cannot see. A planner over-approximates on purpose: the handler
 * guards remain the only thing that blocks a provider call, and they must stay
 * that way. Narrowing the cron reduces wakeups; it must never become the
 * correctness or quota protection.
 */

/**
 * How long after a cluster's LAST kickoff the dense window stays open.
 *
 * Eight hours, not the ~5h that reconciliation typically takes. Item 108 measured
 * five games reconciling to final at `kickoff + 3.40h..4.75h` and a sixth still
 * live at **6.4h** behind a weather delay. A tighter margin would have slowed
 * polling on that game while it was still on the clock. The cost of the extra
 * headroom is measured: 8h removes 64% of October wakeups where 4.75h removes
 * 73%, and a game that overruns even this is not lost — the reconciliation pass
 * still collects its final, late rather than never.
 */
export const CLUSTER_MARGIN_MS = 8 * 60 * 60 * 1000;

/**
 * Dense polling opens this far before kickoff.
 *
 * Taken from `pollingTarget`, which is the constant that actually governs CRON
 * eligibility. An earlier version imported the numerically-equal twin in
 * `browserPolling` to keep the module client-safe, and claimed that kept "one
 * rule" for the browser and the cron. That was false: they are two independent
 * `15 * 60 * 1000` literals, and the copy it took was the one that does NOT
 * decide server eligibility — so widening the server window would have left the
 * planner arming late. Server-only is the correct trade for a planner; the
 * browser keeps its own dependency-light copy, as it already does.
 */
export const CLUSTER_LEAD_MS = POLLING_WINDOW_BEFORE_KICKOFF_MS;

export type PollingWindow = {
  /** First kickoff in the cluster, minus the lead. */
  startMs: number;
  /** Last kickoff in the cluster, plus the margin. */
  endMs: number;
  /** How many kickoffs the cluster contains — reporting only, never a gate. */
  kickoffCount: number;
};

export type DeriveOptions = {
  marginMs?: number;
  leadMs?: number;
};

/**
 * One scheduled kickoff, with the caller's answer to the only question this
 * module cannot answer for itself.
 *
 * `timeConfirmed: false` means the row is `startTimeTBD` — CFBD publishes those
 * with a PLACEHOLDER instant, not a missing one. Measured on the shipped 2026
 * record: 0 of 3,679 `startDate` values fail to parse, while all 421 TBD rows
 * parse cleanly at UTC hour 4 or 5 — midnight or 1am Eastern on the game date,
 * 12 to 19 hours before the real kickoff. Clustering on those placeholders arms
 * the wrong hours and leaves the actual kickoff uncovered, which is the exact
 * failure a narrowed cron cannot survive.
 *
 * This is a REQUIRED field rather than an option because the previous signature
 * took bare numbers and "protected" itself with a finiteness check that, on real
 * data, filters nothing at all.
 */
export type PlannedKickoff = {
  kickoffMs: number;
  timeConfirmed: boolean;
};

export type PollingWindowPlan = {
  /** Windows derived from CONFIRMED kickoffs only, ascending and disjoint. */
  windows: PollingWindow[];
  /**
   * Kickoffs whose time is not yet confirmed. Returned rather than dropped: a
   * TBD game still has to be covered somehow, and only the caller can decide
   * whether to arm its whole day or wait for CFBD to publish a time. Silently
   * discarding them would trade a wrong window for no window.
   */
  unconfirmed: PlannedKickoff[];
};

/**
 * Group kickoffs into contiguous clusters and return one window per cluster,
 * ascending and non-overlapping.
 *
 * A kickoff joins the current cluster when `kickoff − lead` falls at or before
 * that cluster's current end, so the effective split threshold is `margin + lead`
 * (8h15m by default), NOT `margin` — an earlier docstring said `margin` and was
 * wrong. Two kickoffs 8h05m apart merge.
 */
export function derivePollingWindows(
  kickoffs: readonly PlannedKickoff[],
  options: DeriveOptions = {}
): PollingWindowPlan {
  const marginMs = options.marginMs ?? CLUSTER_MARGIN_MS;
  const leadMs = options.leadMs ?? CLUSTER_LEAD_MS;

  const unconfirmed = kickoffs.filter(
    (entry) => !entry.timeConfirmed && Number.isFinite(entry.kickoffMs)
  );
  const sorted = kickoffs
    .filter((entry) => entry.timeConfirmed && Number.isFinite(entry.kickoffMs))
    .map((entry) => entry.kickoffMs)
    .sort((a, b) => a - b);
  if (sorted.length === 0) return { windows: [], unconfirmed };

  const windows: PollingWindow[] = [];
  let startMs = sorted[0]! - leadMs;
  let endMs = sorted[0]! + marginMs;
  let kickoffCount = 1;

  for (const kickoffMs of sorted.slice(1)) {
    if (kickoffMs - leadMs <= endMs) {
      // Extend rather than assign: a cluster's end is driven by its LATEST
      // kickoff, and the list is sorted, so this is monotonic.
      endMs = Math.max(endMs, kickoffMs + marginMs);
      kickoffCount += 1;
      continue;
    }
    windows.push({ startMs, endMs, kickoffCount });
    startMs = kickoffMs - leadMs;
    endMs = kickoffMs + marginMs;
    kickoffCount = 1;
  }
  windows.push({ startMs, endMs, kickoffCount });
  return { windows, unconfirmed };
}

/**
 * The UTC hours of one day that any window covers — the form a cron expression
 * consumes — the hour list of a cron whose minute field stays as it is today.
 *
 * An hour counts as covered when a window overlaps ANY part of it, because cron
 * cannot fire for part of an hour. That over-approximation is the same one the
 * planner makes everywhere and is safe for the same reason: the handler guards,
 * not the cron, decide whether a provider call happens.
 */
export function utcHoursCovered(windows: readonly PollingWindow[], dayStartMs: number): number[] {
  const hours: number[] = [];
  for (let hour = 0; hour < 24; hour += 1) {
    const hourStart = dayStartMs + hour * 3_600_000;
    const hourEnd = hourStart + 3_600_000;
    if (windows.some((window) => window.startMs < hourEnd && window.endMs > hourStart)) {
      hours.push(hour);
    }
  }
  return hours;
}

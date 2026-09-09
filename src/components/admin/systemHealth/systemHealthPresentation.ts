/**
 * PLATFORM-086F2G — pure presentation helpers for the System Health UI.
 *
 * These format labels, timestamps, durations, targets, and state tones ONLY.
 * They MUST NOT derive health, severity, freshness, or issue logic — that is the
 * F2F model's job. Kept React-free so the mapping is unit-testable.
 *
 * Color follows DESIGN.md: amber/gold is reserved for champion/podium and is
 * NEVER an operational warning; blue is interactivity/active state only. Critical
 * uses restrained red; warning/info lean on text weight, a glyph, and hierarchy
 * so the state stays unambiguous even without color.
 */

import { formatRelativeTimestamp } from '@/lib/freshness';
import { formatYearFailureEvidence } from '@/lib/server/schedulerYearEvidence';
import type {
  ExternalSchedulerJob,
  SchedulerExecutionReceipt,
  SchedulerSource,
} from '@/lib/server/schedulerExecutionStatus';
import type { SchedulerDeliveryHealthRow } from '@/lib/server/schedulerDeliveryHealth';
import type { ProviderCacheAvailability } from '@/lib/server/providerCacheState';
import type { SystemHealthOverallState } from '@/lib/server/systemHealthIssues';
import type { PanelStatus } from '@/lib/server/systemHealthPanels';

export type StateTone = 'critical' | 'warn' | 'ok' | 'info' | 'muted';

/**
 * Stoplight indicator colors for the section panels. Small yellow/amber traffic-
 * light dots are explicitly approved for this admin-only operational surface
 * (DESIGN.md's amber-for-champion reservation is waived for semantic status here);
 * color is never the only signal — every panel also carries a text state label.
 */
export const PANEL_DOT_CLASS: Record<PanelStatus, string> = {
  green: 'text-green-600 dark:text-green-400',
  yellow: 'text-yellow-600 dark:text-yellow-500',
  red: 'text-red-600 dark:text-red-400',
  gray: 'text-gray-400 dark:text-zinc-500',
};

export const PANEL_STATE_LABEL_CLASS: Record<PanelStatus, string> = {
  green: 'text-green-700 dark:text-green-400',
  yellow: 'text-yellow-700 dark:text-yellow-500',
  red: 'text-red-700 dark:text-red-400',
  gray: 'text-gray-500 dark:text-zinc-400',
};

/** Tailwind text classes per tone (light + dark). Amber is never used here. */
export const TONE_TEXT_CLASS: Record<StateTone, string> = {
  critical: 'text-red-700 dark:text-red-400',
  warn: 'font-medium text-gray-900 dark:text-zinc-100',
  ok: 'text-green-700 dark:text-green-400',
  info: 'text-gray-600 dark:text-zinc-300',
  muted: 'text-gray-500 dark:text-zinc-400',
};

/** A small leading glyph so state is legible without relying on color alone. */
export const TONE_GLYPH: Record<StateTone, string> = {
  critical: '▲',
  warn: '△',
  ok: '●',
  info: '•',
  muted: '·',
};

export function overallStateDisplay(state: SystemHealthOverallState): {
  label: string;
  tone: StateTone;
} {
  switch (state) {
    case 'critical':
      return { label: 'Critical', tone: 'critical' };
    case 'degraded':
      return { label: 'Degraded', tone: 'warn' };
    case 'healthy':
      return { label: 'Healthy', tone: 'ok' };
  }
}

export function severityDisplay(severity: 'critical' | 'warning' | 'info'): {
  label: string;
  tone: StateTone;
} {
  if (severity === 'critical') return { label: 'Critical', tone: 'critical' };
  if (severity === 'warning') return { label: 'Warning', tone: 'warn' };
  return { label: 'Info', tone: 'info' };
}

/** Diagnostic severity (`error`/`warning`/`info`) → display tone + label. */
export function diagnosticSeverityDisplay(severity: 'error' | 'warning' | 'info'): {
  label: string;
  tone: StateTone;
} {
  if (severity === 'error') return { label: 'Error', tone: 'critical' };
  if (severity === 'warning') return { label: 'Warning', tone: 'warn' };
  return { label: 'Info', tone: 'info' };
}

export function schedulerSourceLabel(source: SchedulerSource): string {
  return source === 'qstash' ? 'QStash' : 'Vercel Cron';
}

/** Human-readable scheduler job names for the primary row line. */
const SCHEDULER_JOB_LABELS: Record<ExternalSchedulerJob, string> = {
  'live-scores': 'Live scores',
  'team-records': 'Team records',
  'game-stats': 'Game stats',
  odds: 'Odds polling',
  'schedule-refresh': 'Weekly schedule',
  rankings: 'Rankings publication',
  'season-transition': 'Season transition',
  'usage-sample': 'CFBD usage sample',
  'season-rollover': 'Season rollover',
  'polling-planner': 'Polling planner',
};

export function schedulerJobLabel(job: ExternalSchedulerJob): string {
  return SCHEDULER_JOB_LABELS[job];
}

/**
 * The facts a delivery row's colour and word are decided from — PLATFORM-102
 * slice 4, and the reason both signatures widened.
 *
 * The STATE alone is not enough, and this is the second time this campaign that a
 * guard on what something MEANS missed what it IS. `unavailable` is reached by
 * FOUR branches of `buildDeliveryRow`, and the tempting discriminator
 * (`planUnavailableReason === null`) does not separate them:
 *
 *   | branch                              | reason   | receipt | a fault? |
 *   | receipt-scope read failed           | may be null | null | YES      |
 *   | no receipt for this job, plan faulted | non-null | null | yes      |
 *   | plan faulted beside a receipt        | non-null | present | yes    |
 *   | NOTHING DUE                          | null     | present | no     |
 *
 * `unavailable` with a null reason is true of the FIRST row and the LAST, so a
 * mapping keyed on the reason alone paints a receipt-store OUTAGE as healthy.
 * The receipt separates those two: nothing-due is reached through
 * `entriesByJob.has(job)`, so it always carries a parsed receipt, and the scope
 * failure never does.
 *
 * AND THE RECEIPT IS STILL NOT ENOUGH — a FIFTH path, found by review and
 * confirmed by running it. `planUnavailableReason` is a ROW-level field derived
 * from `governingSchedule`, which picks the entry with a cron when no slot is due;
 * so a job whose DENSE schedule is faulted (`plan-indeterminate`) and whose SLOW
 * schedule is known and not yet due produces `reason: null` with a receipt
 * present, and rendered gray "Nothing due" while half the job could not be checked
 * at all. That is this campaign's recurring failure a third time — a guard on what
 * the row MEANS while the per-schedule facts go unchecked — so the predicate reads
 * the entries too. Nothing is due only when EVERY schedule is accounted for.
 */
export type DeliveryRowFacts = Pick<
  SchedulerDeliveryHealthRow,
  'deliveryState' | 'planUnavailableReason' | 'receipt' | 'schedules'
>;

/**
 * The healthy idle state: every schedule is known, none has a slot whose grace
 * has expired, and the job's last receipt is right there.
 *
 * NOT a sixth `SchedulerDeliveryState` — Item 102 has declined to widen that
 * union three times and this is presentation, not a new fact. It is derived from
 * the row rather than stored on it for the same reason.
 */
export function deliveryNothingDue(row: DeliveryRowFacts): boolean {
  return (
    row.deliveryState === 'unavailable' &&
    row.planUnavailableReason === null &&
    row.receipt !== null &&
    row.schedules.every((schedule) => schedule.unavailableReason === null)
  );
}

/**
 * Row-level delivery stoplight.
 *
 * GRAY FOR NOTHING DUE, and the owner's word was "green". The ruling was that a
 * healthy idle job must not read as a FAULT, which both colours satisfy; gray is
 * the one that does not overshoot. Green is this dashboard's word for a MEASURED
 * on-time delivery, and nothing-due measured nothing — the state layer was
 * careful not to call it `on-time` for exactly that reason
 * (`schedulerDeliveryHealth.ts`: "`on-time` asserts delivery is timely, and
 * nothing here measured that"), and painting it green re-asserts one layer down
 * the claim the layer above declined to make. On a quiet offseason day both
 * planner-owned rows are idle by design; two green dots would say their deliveries
 * were timely, when what is true is that none was owed. Gray says that.
 *
 * Everything else keeps its colour, and the FAULTS keep yellow — including the
 * receipt-scope outage, which is `unavailable` with a null reason and would have
 * gone gray under the discriminator this slice was handed.
 */
export function deliveryRowStatus(row: DeliveryRowFacts): PanelStatus {
  if (row.deliveryState === 'on-time') return 'green';
  return deliveryNothingDue(row) ? 'gray' : 'yellow';
}

export function deliveryStateDisplay(row: DeliveryRowFacts): {
  label: string;
  tone: StateTone;
} {
  switch (row.deliveryState) {
    case 'on-time':
      return { label: 'On time', tone: 'ok' };
    case 'late':
      return { label: 'Late', tone: 'warn' };
    case 'missing':
      // UNTOUCHED. "No receipt at all" is a different fact from "nothing is due",
      // and it must keep warning: a job that has never delivered is not idle.
      return { label: 'No recent delivery', tone: 'warn' };
    case 'invalid':
      return { label: 'Receipt invalid', tone: 'warn' };
    case 'unavailable':
      // The tone was ALREADY `muted` here, so only the word changes: "Unavailable"
      // reads as broken, and a job doing exactly what it was told is not.
      return deliveryNothingDue(row)
        ? { label: 'Nothing due', tone: 'muted' }
        : { label: 'Unavailable', tone: 'muted' };
  }
}

/** Execution result → label + tone. Neutral for benign results; warn for faults. */
export function executionResultDisplay(result: SchedulerExecutionReceipt['result']): {
  label: string;
  tone: StateTone;
} {
  switch (result) {
    case 'success':
      return { label: 'Success', tone: 'ok' };
    case 'no-op':
      return { label: 'No-op', tone: 'muted' };
    case 'skipped':
      return { label: 'Skipped', tone: 'muted' };
    case 'in-progress':
      return { label: 'In progress', tone: 'info' };
    case 'partial':
      return { label: 'Partial', tone: 'warn' };
    case 'failure':
      // A failed execution reads as red per the approved stoplight rules ("failed"
      // → red), even though the derived scheduler-execution issue is a warning.
      return { label: 'Failed', tone: 'critical' };
  }
}

export function cacheAvailabilityDisplay(availability: ProviderCacheAvailability): {
  label: string;
  tone: StateTone;
} {
  switch (availability) {
    case 'available':
      return { label: 'Cached data present', tone: 'ok' };
    case 'absent':
      return { label: 'No cached data', tone: 'warn' };
    case 'unknown':
      return { label: 'Availability unknown', tone: 'muted' };
  }
}

/** Attempt outcome → short label + tone. Faults are warn; benign are muted/ok. */
export function attemptOutcomeDisplay(
  outcome: 'in-progress' | 'succeeded' | 'partial' | 'failed' | 'no-op' | null
): { label: string; tone: StateTone } {
  switch (outcome) {
    case 'succeeded':
      return { label: 'Succeeded', tone: 'ok' };
    case 'no-op':
      return { label: 'No-op', tone: 'muted' };
    case 'in-progress':
      return { label: 'In progress', tone: 'info' };
    case 'partial':
      return { label: 'Partial', tone: 'warn' };
    case 'failed':
      return { label: 'Failed', tone: 'warn' };
    case null:
      return { label: 'No recorded outcome', tone: 'muted' };
  }
}

/** A human, bounded receipt-target summary — NEVER a raw JSON dump. */
export function summarizeReceiptTarget(target: SchedulerExecutionReceipt['target']): string {
  switch (target.kind) {
    case 'live-scores':
      return `${target.year} · ${target.targetGames} game(s), ${target.targetPartitions} partition(s)${target.mode ? ` · ${target.mode}` : ''}`;
    case 'team-records':
      return String(target.year);
    case 'usage-sample':
      return `${target.day ?? 'no day'} · ${
        target.recorded === null
          ? 'durability unknown'
          : target.recorded
            ? 'recorded'
            : 'not recorded'
      }`;
    case 'polling-planner':
      // Counts, never expressions. An operator reading this needs to know how
      // many schedules moved and how many did not; WHICH cron each one holds is
      // the durable planner record's, under its allowlist.
      return `${target.day ?? 'no day'} · ${target.schedulesApplied} applied, ${
        target.schedulesUnchanged
      } unchanged, ${target.schedulesFailed} failed${
        target.recordsNotWritten > 0 ? ` · ${target.recordsNotWritten} record(s) not written` : ''
      }`;
    case 'game-stats':
      // PLATFORM-110B — the mode is what tells a bounded CORRECTION pass over a
      // long-settled partition from a polling run that regressed to a stale one.
      // Without it both render as `2026 · week 1 · regular` in week 10.
      return `${target.year}${target.week != null ? ` · week ${target.week}` : ''}${target.seasonType ? ` · ${target.seasonType}` : ''}${target.mode ? ` · ${target.mode}` : ''}`;
    case 'odds':
      return `${target.year} · ${target.eligibleGames} eligible game(s)${target.cadence ? ` · ${target.cadence}` : ''}`;
    case 'schedule-years': {
      // PLATFORM-086F2H1R2 — refused CANDIDATES (leagues, not distinct years:
      // three records sharing one bad year count three) have no year to file
      // them under, so they are appended at RUN level, and only when non-zero,
      // so a clean run — and a legacy receipt, which normalizes to 0 — renders
      // exactly as before. A count only: never a slug or the invalid value.
      //
      // The empty-`years` guard also closes the `schedule-years` half of the
      // recorded dangling-colon deferral: an all-refused receipt would otherwise
      // render `0 year(s): ` with nothing after the separator. The rankings and
      // rollover branches still carry it and are deliberately untouched here.
      // PLATFORM-126B — a FAILED or PARTIAL year now names its stable reason and
      // the partitions that caused it, each with its retained transport class.
      // A successful year, and every legacy entry, renders exactly as before.
      const yearDetail =
        target.years.length > 0
          ? `: ${target.years
              .map((y) => {
                const evidence = formatYearFailureEvidence(y);
                // BRACKETED, not dash-prefixed: the run-level suffixes appended
                // after `yearDetail` (`unusable`, `sweepDetail`) use the same
                // ` · ` atom separator the evidence does, so an open-ended tail
                // ran the last year's partitions straight into the run counters.
                // A self-closing delimiter ends the separator arms race — round 1
                // fixed a ', ' collision with the YEAR separator and merely moved
                // the ambiguity one level out. (Round 2 review finding.)
                return `${y.year}${y.operation ? ` (${y.operation})` : ''}${
                  evidence ? ` [${evidence}]` : ''
                }`;
              })
              .join(', ')}`
          : '';
      const unusable =
        target.invalidLifecycleTargets > 0
          ? ` · ${target.invalidLifecycleTargets} unusable lifecycle target(s)`
          : '';
      const sweep = [
        target.scoreRepairs > 0 ? `${target.scoreRepairs} score repair(s)` : '',
        target.scoreDifferences > 0 ? `${target.scoreDifferences} score difference(s)` : '',
        target.scoreSweepFailures > 0 ? `${target.scoreSweepFailures} score sweep failure(s)` : '',
        target.kickoffsChanged > 0 ? `${target.kickoffsChanged} kickoff change(s)` : '',
      ].filter(Boolean);
      const sweepDetail = sweep.length > 0 ? ` · ${sweep.join(' · ')}` : '';
      return `${target.totalYears} year(s)${target.truncated ? ' (truncated)' : ''}${yearDetail}${unusable}${sweepDetail}`;
    }
    case 'rankings-years': {
      // PLATFORM-086F2H1R3 — refused CANDIDATES (leagues, not distinct years:
      // three records sharing one bad year count three) have no year to file
      // them under, so they are appended at RUN level, and only when non-zero,
      // so a clean run — and a legacy receipt, which normalizes to 0 — renders
      // exactly as before. A count only: never a slug or the invalid value.
      //
      // The empty-`years` guard also closes the `rankings-years` half of the
      // recorded dangling-colon deferral: an all-refused receipt would otherwise
      // render `0 year(s): ` with nothing after the separator. The rollover
      // branch still carries it and is deliberately untouched here (F2H1R4's).
      // PLATFORM-126B — same treatment as the schedule branch above, from the
      // same shared formatter: one vocabulary across both multi-year jobs.
      const yearDetail =
        target.years.length > 0
          ? `: ${target.years
              .map((y) => {
                const evidence = formatYearFailureEvidence(y);
                // Bracketed for the same reason as the schedule branch above.
                return `${y.year}${y.publicationWindow ? ` (${y.publicationWindow})` : ''}${
                  evidence ? ` [${evidence}]` : ''
                }`;
              })
              .join(', ')}`
          : '';
      const unusable =
        target.invalidLifecycleTargets > 0
          ? ` · ${target.invalidLifecycleTargets} unusable lifecycle target(s)`
          : '';
      return `${target.totalYears} year(s)${target.truncated ? ' (truncated)' : ''}${yearDetail}${unusable}`;
    }
    case 'season-transition-years': {
      // PLATFORM-086F2H1B — surface the dispositions, not just a ratio. Without
      // them `1/4 leagues` reads identically whether the other three were benign
      // deletions or genuinely stale targets, which is the exact discrimination
      // the counters exist to provide. Only non-zero dispositions are appended,
      // so an ordinary clean run keeps its previous compact form (and a legacy
      // receipt, whose counters normalize to 0, renders unchanged).
      const yearDetail =
        target.years.length > 0
          ? `: ${target.years
              .map((y) => {
                const notes = [
                  y.refusedLeagues > 0 ? `${y.refusedLeagues} stale` : null,
                  y.alreadyInTargetSeasonLeagues > 0
                    ? `${y.alreadyInTargetSeasonLeagues} already`
                    : null,
                  y.removedLeagues > 0 ? `${y.removedLeagues} removed` : null,
                ].filter((n): n is string => n !== null);
                const detail = notes.length > 0 ? `, ${notes.join(', ')}` : '';
                return `${y.year} (${y.transitionedLeagues}/${y.targetLeagues} leagues${detail})`;
              })
              .join(', ')}`
          : '';
      // PLATFORM-086F2H1R1 — refused CANDIDATES (leagues, not distinct years:
      // three records sharing one bad year count three) have no year to file them under,
      // so they are appended at RUN level. Appended only when non-zero, so a
      // clean run (and a legacy receipt, which normalizes to 0) renders exactly
      // as before. A count only: never a slug or the unusable value itself.
      const unusable =
        target.invalidLifecycleTargets > 0
          ? ` · ${target.invalidLifecycleTargets} unusable lifecycle target(s)`
          : '';
      return `${target.totalYears} year(s)${target.truncated ? ' (truncated)' : ''}${yearDetail}${unusable}`;
    }
    case 'season-rollover-years': {
      // PLATFORM-086F2H1R4 — refused CANDIDATES (leagues, not distinct years)
      // have no year to file them under, so they are appended at RUN level, and
      // only when non-zero, so a clean run — and a legacy receipt, which
      // normalizes to 0 — renders exactly as before. A count only: never a slug
      // or the invalid value.
      //
      // The empty-`years` guard closes the LAST branch of the recorded
      // dangling-colon deferral (R1 fixed season-transition, R2 schedule, R3
      // rankings): an all-refused receipt would otherwise render `0 year(s): `
      // with nothing after the separator.
      const yearDetail =
        target.years.length > 0
          ? `: ${target.years
              .map((y) => `${y.year} (${y.rolledOverLeagues}/${y.targetLeagues} leagues)`)
              .join(', ')}`
          : '';
      const unusable =
        target.invalidLifecycleTargets > 0
          ? ` · ${target.invalidLifecycleTargets} unusable lifecycle target(s)`
          : '';
      return `${target.totalYears} year(s)${target.truncated ? ' (truncated)' : ''}${yearDetail}${unusable}`;
    }
  }
}

/** Relative timestamp, or a fallback dash when null/unparseable. */
export function formatMoment(iso: string | null | undefined, nowMs: number): string {
  if (!iso) return '—';
  return formatRelativeTimestamp(iso, nowMs) ?? '—';
}

export function formatDuration(durationMs: number | null | undefined): string {
  if (durationMs == null || !Number.isFinite(durationMs)) return '—';
  if (durationMs < 1000) return `${Math.round(durationMs)} ms`;
  return `${(durationMs / 1000).toFixed(1)} s`;
}

/** A quota count for display, or an explicit dash when not trustworthy. */
export function formatCount(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('en-US') : '—';
}

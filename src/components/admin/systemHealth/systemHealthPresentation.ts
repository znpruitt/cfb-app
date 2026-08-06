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
import type {
  ExternalSchedulerJob,
  SchedulerExecutionReceipt,
  SchedulerSource,
} from '@/lib/server/schedulerExecutionStatus';
import type { SchedulerDeliveryState } from '@/lib/server/schedulerDeliveryHealth';
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
  'game-stats': 'Game stats',
  odds: 'Odds polling',
  'schedule-refresh': 'Weekly schedule',
  rankings: 'Rankings publication',
  'season-transition': 'Season transition',
  'season-rollover': 'Season rollover',
};

export function schedulerJobLabel(job: ExternalSchedulerJob): string {
  return SCHEDULER_JOB_LABELS[job];
}

/** Row-level delivery stoplight: a 1:1 map of the delivery FACT to a color. */
export function deliveryRowStatus(state: SchedulerDeliveryState): PanelStatus {
  return state === 'on-time' ? 'green' : 'yellow';
}

export function deliveryStateDisplay(state: SchedulerDeliveryState): {
  label: string;
  tone: StateTone;
} {
  switch (state) {
    case 'on-time':
      return { label: 'On time', tone: 'ok' };
    case 'late':
      return { label: 'Late', tone: 'warn' };
    case 'missing':
      return { label: 'No recent delivery', tone: 'warn' };
    case 'invalid':
      return { label: 'Receipt invalid', tone: 'warn' };
    case 'unavailable':
      return { label: 'Unavailable', tone: 'muted' };
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
    case 'game-stats':
      return `${target.year}${target.week != null ? ` · week ${target.week}` : ''}${target.seasonType ? ` · ${target.seasonType}` : ''}`;
    case 'odds':
      return `${target.year} · ${target.eligibleGames} eligible game(s)${target.cadence ? ` · ${target.cadence}` : ''}`;
    case 'schedule-years':
      return `${target.totalYears} year(s)${target.truncated ? ' (truncated)' : ''}: ${target.years
        .map((y) => `${y.year}${y.operation ? ` (${y.operation})` : ''}`)
        .join(', ')}`;
    case 'rankings-years':
      return `${target.totalYears} year(s)${target.truncated ? ' (truncated)' : ''}: ${target.years
        .map((y) => `${y.year}${y.publicationWindow ? ` (${y.publicationWindow})` : ''}`)
        .join(', ')}`;
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
    case 'season-rollover-years':
      return `${target.totalYears} year(s)${target.truncated ? ' (truncated)' : ''}: ${target.years
        .map((y) => `${y.year} (${y.rolledOverLeagues}/${y.targetLeagues} leagues)`)
        .join(', ')}`;
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

import type { ScorePack } from './scores.ts';

export type GameStatusBucket = 'scheduled' | 'inprogress' | 'final' | 'disrupted';

const DISRUPTED_RE = /\b(postponed|canceled|cancelled|suspended|delayed)\b/;
const CANCELED_RE = /\b(canceled|cancelled)\b/;
const LIVE_OT_RE = /\b(?:\d+ot|ot)\b/;

// Status semantics invariant: this module is the single classifier for UI-facing
// schedule/score state buckets so surfaces do not drift on status interpretation.

function normalizeStatus(status: string | null | undefined): string {
  return (status ?? '').trim();
}

/**
 * Canonicalize a raw provider/cache status label into lowercase, space-delimited
 * tokens BEFORE classification. Provider and cache enums arrive in several
 * separator styles — `STATUS_CANCELED`, `status-canceled`, `Status Canceled` —
 * and because `_` is a regex WORD character, a bare `\b...\b` matcher silently
 * FAILS to fire on the underscore forms (`\bcanceled\b` never matches inside
 * `status_canceled`, the boundary the reviewer flagged in 6th-review finding #3).
 * Replacing every non-alphanumeric run with a single space makes all separator
 * styles (`_`, `-`, `/`, punctuation, whitespace) classify identically, so the
 * score diagnostics and game-stats applicability logic that both consume these
 * predicates agree on canceled/postponed/suspended/delayed enum labels.
 */
export function normalizeStatusTokens(status: string | null | undefined): string {
  return normalizeStatus(status)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function isDisruptedStatusLabel(status: string | null | undefined): boolean {
  return DISRUPTED_RE.test(normalizeStatusTokens(status));
}

/**
 * A canceled/cancelled game is TERMINAL: it will never produce a final score, so
 * for coverage purposes (provider-data diagnostics) it is "resolved" and must not
 * raise an impossible missing-final warning. This is deliberately NARROWER than
 * {@link isDisruptedStatusLabel}: postponed / suspended / delayed are also
 * disrupted but are NOT terminal — they are unresolved and should still be
 * treated as missing a final result.
 */
export function isCanceledStatusLabel(status: string | null | undefined): boolean {
  return CANCELED_RE.test(normalizeStatusTokens(status));
}

export function classifyStatusLabel(status: string | null | undefined): GameStatusBucket {
  // Classify off the separator-normalized token string so enum forms
  // (`STATUS_FINAL`, `STATUS_IN_PROGRESS`) bucket the same as spaced labels.
  const tokens = normalizeStatusTokens(status);

  if (!tokens) return 'scheduled';
  if (DISRUPTED_RE.test(tokens)) return 'disrupted';
  if (tokens.includes('final')) return 'final';
  if (
    tokens.includes('progress') ||
    tokens.includes('quarter') ||
    tokens.includes('half') ||
    LIVE_OT_RE.test(tokens) ||
    tokens.includes('live') ||
    /\bq\d\b/.test(tokens)
  ) {
    return 'inprogress';
  }

  return 'scheduled';
}

export function classifyScorePackStatus(score?: ScorePack): GameStatusBucket {
  if (!score) return 'scheduled';
  return classifyStatusLabel(score.status);
}

export function formatScheduleStatusLabel(
  status: string | null | undefined,
  options?: { isPlaceholder?: boolean }
): string | null {
  const trimmed = normalizeStatus(status);
  const isPlaceholder = options?.isPlaceholder ?? false;

  if (!trimmed) return isPlaceholder ? 'Placeholder' : null;
  if (trimmed === 'scheduled') return isPlaceholder ? 'Placeholder' : 'Scheduled';
  if (trimmed === 'final') return 'FINAL';
  if (trimmed === 'in_progress') return 'IN PROGRESS';
  if (trimmed === 'matchup_set') return 'Scheduled';
  return trimmed.replace(/_/g, ' ');
}

export function formatScoreSummaryLabel(score?: ScorePack): string | null {
  if (!score) return null;
  const trimmed = normalizeStatus(score.status);
  if (!trimmed) return null;

  const bucket = classifyStatusLabel(trimmed);
  if (bucket === 'final') return 'FINAL';
  if (bucket === 'inprogress') return trimmed.toUpperCase();
  return trimmed;
}

export function formatCompactGameStatus(score?: ScorePack): string {
  const bucket = classifyScorePackStatus(score);
  if (bucket === 'final') return 'Final';
  if (bucket === 'inprogress') return score?.status ?? 'In Progress';
  if (bucket === 'disrupted') return score?.status ?? 'Scheduled';
  if (bucket === 'scheduled') return score?.status ?? 'Scheduled';
  return 'Scheduled';
}

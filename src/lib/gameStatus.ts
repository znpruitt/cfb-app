import type { ScorePack } from './scores.ts';

export type GameStatusBucket = 'scheduled' | 'inprogress' | 'final' | 'disrupted';

const DISRUPTED_RE = /\b(postponed|canceled|cancelled|suspended|delayed)\b/i;
const LIVE_OT_RE = /\b(?:\d+ot|ot)\b/i;

function normalizeStatus(status: string | null | undefined): string {
  return (status ?? '').trim();
}

export function isDisruptedStatusLabel(status: string | null | undefined): boolean {
  return DISRUPTED_RE.test(normalizeStatus(status));
}

export function classifyStatusLabel(status: string | null | undefined): GameStatusBucket {
  const trimmed = normalizeStatus(status);
  const lower = trimmed.toLowerCase();

  if (!trimmed) return 'scheduled';
  if (isDisruptedStatusLabel(trimmed)) return 'disrupted';
  if (lower.includes('final')) return 'final';
  if (
    lower.includes('progress') ||
    lower.includes('quarter') ||
    lower.includes('half') ||
    LIVE_OT_RE.test(trimmed) ||
    lower.includes('live') ||
    /\bq\d\b/.test(lower)
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

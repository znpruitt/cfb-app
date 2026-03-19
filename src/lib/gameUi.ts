import type { ScorePack } from './scores.ts';

export function gameStateFromScore(
  score?: ScorePack
): 'final' | 'inprogress' | 'scheduled' | 'unknown' {
  if (!score) return 'unknown';
  const s = (score.status || '').toLowerCase();
  if (s.includes('final') || s.includes('post')) return 'final';
  if (s.includes('in ') || s.includes(' q') || s.includes('quarter') || s.includes('half'))
    return 'inprogress';
  if (s.includes('sched') || s.includes('pregame')) return 'scheduled';
  return 'unknown';
}

export function statusClasses(
  state: 'final' | 'inprogress' | 'scheduled' | 'unknown',
  hasInfo: boolean
): string {
  if (!hasInfo) {
    return 'border rounded border-l-4 border-l-red-600 bg-red-50 text-gray-900 dark:border-l-red-400 dark:bg-red-900/25 dark:text-zinc-100';
  }
  switch (state) {
    case 'final':
      return 'border rounded border-l-4 border-l-emerald-600 bg-emerald-50 text-gray-900 dark:border-l-emerald-400 dark:bg-emerald-900/25 dark:text-zinc-100';
    case 'inprogress':
      return 'border rounded border-l-4 border-l-amber-600 bg-amber-50 text-gray-900 dark:border-l-amber-400 dark:bg-amber-900/25 dark:text-zinc-100';
    case 'scheduled':
      return 'border rounded border-l-4 border-l-blue-600 bg-blue-50 text-gray-900 dark:border-l-blue-400 dark:bg-blue-900/25 dark:text-zinc-100';
    default:
      return 'border rounded text-gray-900 dark:text-zinc-100';
  }
}

export function chipClass(): string {
  return 'text-[10px] uppercase tracking-wide border rounded px-1 py-0.5 bg-white text-gray-700 border-gray-300 dark:bg-zinc-800 dark:text-zinc-100 dark:border-zinc-600';
}

export function pillClass(): string {
  return 'text-xs border rounded px-1 py-0.5 bg-white text-gray-700 border-gray-300 dark:bg-zinc-800 dark:text-zinc-100 dark:border-zinc-600';
}

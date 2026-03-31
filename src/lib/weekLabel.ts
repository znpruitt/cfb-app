import type { AppGame } from './schedule';

type StagePriority = { label: string; priority: number };

/**
 * Builds a map from canonical week number → human-readable label.
 *
 * Regular season weeks are NOT stored in the map — callers fall back to "W{n}".
 * Postseason weeks are derived from the game stage on record, so label mapping
 * is driven by actual schedule data rather than hardcoded week numbers.
 *
 * Priority (highest wins when a week contains mixed stages):
 *   playoff (CFP) > bowl > conference_championship
 */
export function buildWeekLabelMap(games: AppGame[]): Map<number, string> {
  const byWeek = new Map<number, StagePriority>();

  for (const game of games) {
    const priority =
      game.stage === 'playoff'
        ? 3
        : game.stage === 'bowl'
          ? 2
          : game.stage === 'conference_championship'
            ? 1
            : 0;

    if (priority === 0) continue; // regular season weeks use default "W{n}"

    const existing = byWeek.get(game.week);
    if (!existing || priority > existing.priority) {
      const label = priority === 3 ? 'CFP' : priority === 2 ? 'Bowl' : 'CCG';
      byWeek.set(game.week, { label, priority });
    }
  }

  return new Map([...byWeek.entries()].map(([week, v]) => [week, v.label]));
}

/**
 * Returns a human-readable label for a canonical week number.
 * Falls back to "W{n}" for regular season weeks not present in the map.
 */
export function formatWeekLabel(week: number, labelMap: Map<number, string>): string {
  return labelMap.get(week) ?? `W${week}`;
}

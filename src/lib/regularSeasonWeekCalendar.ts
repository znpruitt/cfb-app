import type { ScheduleWireItem } from './schedule.ts';

export function deriveCanonicalRegularSeasonWeek(game: ScheduleWireItem): {
  providerWeek: number;
  canonicalWeek: number;
} {
  const providerWeek = game.week;
  return { providerWeek, canonicalWeek: providerWeek };
}

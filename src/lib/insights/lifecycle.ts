import type { LeagueStatus } from '../league';
import type { AppGame } from '../schedule';
import type { SeasonContext } from '../selectors/seasonContext';
import type { LifecycleState } from './types';

const EARLY_SEASON_CUTOFF = 0.25;
const MID_SEASON_CUTOFF = 0.75;

export function deriveLifecycleState(
  leagueStatus: LeagueStatus,
  seasonContext: SeasonContext,
  currentWeek: number | null,
  totalRegularSeasonWeeks: number | null,
  currentDate: Date
): LifecycleState {
  if (leagueStatus.state === 'preseason') return 'preseason';

  if (leagueStatus.state === 'offseason') {
    const freshCutoff = new Date(Date.UTC(currentDate.getUTCFullYear(), 2, 1));
    return currentDate < freshCutoff ? 'fresh_offseason' : 'offseason';
  }

  if (seasonContext === 'postseason' || seasonContext === 'final') return 'postseason';
  if (currentWeek === null) return 'early_season';
  if (totalRegularSeasonWeeks === null) return 'mid_season';

  if (currentWeek <= Math.floor(totalRegularSeasonWeeks * EARLY_SEASON_CUTOFF)) {
    return 'early_season';
  }
  if (currentWeek <= Math.floor(totalRegularSeasonWeeks * MID_SEASON_CUTOFF)) {
    return 'mid_season';
  }
  return 'late_season';
}

export function deriveTotalRegularSeasonWeeks(games: AppGame[]): number | null {
  let max: number | null = null;
  for (const game of games) {
    if (game.stage !== 'regular') continue;
    if (!Number.isFinite(game.week)) continue;
    if (max === null || game.week > max) max = game.week;
  }
  return max;
}

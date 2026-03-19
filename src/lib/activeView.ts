import type { AppGame } from './schedule.ts';
import { isTruePostseasonGame } from './postseason-display.ts';
import { deriveRegularWeeks, filterGamesForWeek } from './weekSelection.ts';

export type ActiveScheduleTab = number | 'postseason' | null;

export type PrimaryViewMode = 'overview' | 'schedule' | 'matchups' | 'standings';

export function shouldRenderPrimaryViewSection(params: {
  selectedTab: ActiveScheduleTab;
  selectedWeek: number | null;
  viewMode: PrimaryViewMode;
}): boolean {
  const { selectedTab, selectedWeek, viewMode } = params;
  return (
    viewMode === 'overview' ||
    viewMode === 'standings' ||
    selectedTab === 'postseason' ||
    selectedWeek != null
  );
}

export function deriveRegularWeekTabs(games: AppGame[]): number[] {
  return deriveRegularWeeks(games);
}

export function deriveCanonicalActiveViewGames(params: {
  games: AppGame[];
  selectedTab: ActiveScheduleTab;
  selectedWeek: number | null;
}): AppGame[] {
  const { games, selectedTab, selectedWeek } = params;

  if (selectedTab === 'postseason') {
    return games.filter(isTruePostseasonGame);
  }

  return filterGamesForWeek(games, selectedWeek);
}

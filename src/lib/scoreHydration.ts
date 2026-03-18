import type { AppGame } from './schedule';
import { isTruePostseasonGame } from './postseason-display';
import type { ActiveScheduleTab } from './activeView';

export type ScoreHydrationState = {
  regular: boolean;
  postseason: boolean;
};

export const EMPTY_SCORE_HYDRATION_STATE: ScoreHydrationState = {
  regular: false,
  postseason: false,
};

export function getCanonicalRegularGames(games: AppGame[]): AppGame[] {
  return games.filter(
    (game) => game.stage === 'regular' || game.postseasonRole === 'conference_championship'
  );
}

export function getCanonicalPostseasonGames(games: AppGame[]): AppGame[] {
  return games.filter(isTruePostseasonGame);
}

export function getHydrationSeasonTypes(games: AppGame[]): Array<'regular' | 'postseason'> {
  return Array.from(
    new Set(
      games.map((game) =>
        game.stage === 'regular' || game.postseasonRole === 'conference_championship'
          ? 'regular'
          : 'postseason'
      )
    )
  );
}

export function markScoreHydrationLoaded(
  state: ScoreHydrationState,
  seasonTypes: Array<'regular' | 'postseason'>
): ScoreHydrationState {
  if (seasonTypes.length === 0) return state;

  return {
    regular: state.regular || seasonTypes.includes('regular'),
    postseason: state.postseason || seasonTypes.includes('postseason'),
  };
}

export function getBootstrapScoreHydrationGames(params: {
  games: AppGame[];
  selectedTab: ActiveScheduleTab;
}): AppGame[] {
  const { games, selectedTab } = params;
  if (selectedTab === 'postseason') {
    return getCanonicalPostseasonGames(games);
  }
  return getCanonicalRegularGames(games);
}

export function getLazyScoreHydrationGames(params: {
  games: AppGame[];
  selectedTab: ActiveScheduleTab;
  hydrationState: ScoreHydrationState;
  hasAttemptedPostseasonHydration?: boolean;
}): AppGame[] {
  const { games, selectedTab, hydrationState, hasAttemptedPostseasonHydration = false } = params;

  if (selectedTab === 'postseason') {
    if (hydrationState.postseason || hasAttemptedPostseasonHydration) return [];
    return getCanonicalPostseasonGames(games);
  }

  if (selectedTab == null || hydrationState.regular) {
    return [];
  }

  return getCanonicalRegularGames(games);
}

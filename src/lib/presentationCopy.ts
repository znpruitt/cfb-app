import type { WeekViewMode } from '../components/WeekViewTabs';

type ActiveSurfaceCopy = {
  eyebrow: string;
  title: string;
  subtitle: string | null;
};

export function deriveActiveSurfaceCopy(viewMode: WeekViewMode): ActiveSurfaceCopy {
  if (viewMode === 'overview') {
    return {
      eyebrow: 'League overview',
      title: 'Overview',
      subtitle: null,
    };
  }

  if (viewMode === 'standings') {
    return {
      eyebrow: 'Season view',
      title: 'Standings',
      subtitle: null,
    };
  }

  if (viewMode === 'owner') {
    return {
      eyebrow: 'Team view',
      title: 'Teams',
      subtitle: null,
    };
  }

  if (viewMode === 'matchups') {
    return {
      eyebrow: 'Week view',
      title: 'Matchups',
      subtitle: null,
    };
  }

  if (viewMode === 'matrix') {
    return {
      eyebrow: 'Week view',
      title: 'Matrix',
      subtitle: null,
    };
  }

  return {
    eyebrow: 'Week view',
    title: 'Schedule',
    subtitle: null,
  };
}

export function deriveOddsSummaryCopy(params: {
  gamesCount: number;
  oddsAvailableCount: number;
}): string | null {
  const { gamesCount, oddsAvailableCount } = params;
  if (gamesCount === 0 || oddsAvailableCount === gamesCount) return null;
  if (oddsAvailableCount === 0) return null;
  return `Odds available for ${oddsAvailableCount}/${gamesCount} games.`;
}

import { cache } from 'react';

import { parseOwnersCsv } from '../parseOwnersCsv.ts';
import type { ScorePack } from '../scores.ts';
import type { AppGame } from '../schedule.ts';
import { assembleSeasonScoredBuild, SeasonScheduleCacheUnavailableError } from '../seasonBuild.ts';
import { readConfirmedRosterInputs } from '../server/confirmedRosterStore.ts';
import { deriveStandingsHistory, type StandingsHistory } from '../standingsHistory.ts';

export type WeeklyRecapContext = {
  games: AppGame[];
  rosterByTeam: Map<string, string>;
  scoresByKey: Record<string, ScorePack>;
  standingsHistory: StandingsHistory;
};

export type WeeklyRecapContextResult =
  | { status: 'available'; context: WeeklyRecapContext }
  | { status: 'absent'; reason: 'schedule' | 'roster' }
  | { status: 'unavailable' };

async function loadRecapContextUncached(
  leagueSlug: string,
  year: number
): Promise<WeeklyRecapContextResult> {
  try {
    const build = await assembleSeasonScoredBuild(leagueSlug, year);
    const { ownersCsv } = await readConfirmedRosterInputs(leagueSlug, year);
    if (!ownersCsv) return { status: 'absent', reason: 'roster' };

    const rosterByTeam = new Map(
      parseOwnersCsv(ownersCsv).map(({ team, owner }) => [team, owner] as const)
    );
    if (rosterByTeam.size === 0) return { status: 'absent', reason: 'roster' };

    return {
      status: 'available',
      context: {
        games: build.games,
        rosterByTeam,
        scoresByKey: build.scoresByKey,
        standingsHistory: deriveStandingsHistory({
          games: build.games,
          rosterByTeam,
          scoresByKey: build.scoresByKey,
        }),
      },
    };
  } catch (error) {
    if (error instanceof SeasonScheduleCacheUnavailableError) {
      return { status: 'absent', reason: 'schedule' };
    }

    return { status: 'unavailable' };
  }
}

/** Request-local memoization only; other Insights loaders keep their own build. */
export const loadRecapContext = cache(loadRecapContextUncached);

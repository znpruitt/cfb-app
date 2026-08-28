import { cache } from 'react';

import type { LeagueStatus } from '../league.ts';
import { parseOwnersCsv } from '../parseOwnersCsv.ts';
import type { ScorePack } from '../scores.ts';
import type { AppGame } from '../schedule.ts';
import { assembleSeasonScoredBuild, SeasonScheduleCacheUnavailableError } from '../seasonBuild.ts';
import { isWeeklyRecapActiveSeason } from '../selectors/weeklyRecapFacts.ts';
import { readConfirmedRosterInputs } from '../server/confirmedRosterStore.ts';

export type WeeklyRecapContext = {
  seasonYear: number;
  games: AppGame[];
  rosterByTeam: Map<string, string>;
  scoresByKey: Record<string, ScorePack>;
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
        seasonYear: year,
        games: build.games,
        rosterByTeam,
        scoresByKey: build.scoresByKey,
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

type RecapContextLoader = typeof loadRecapContext;

/** Skip every recap-context read outside the league's exact active season. */
export async function loadRecapContextForSeasonScope(
  args: {
    leagueSlug: string;
    seasonYear: number;
    leagueStatus: LeagueStatus | undefined;
  },
  loadContext: RecapContextLoader = loadRecapContext
): Promise<WeeklyRecapContextResult | null> {
  if (!isWeeklyRecapActiveSeason(args)) return null;
  return loadContext(args.leagueSlug, args.seasonYear);
}

import { cache } from 'react';

import type { LeagueStatus } from '../league.ts';
import { parseOwnersCsv } from '../parseOwnersCsv.ts';
import type { ScorePack } from '../scores.ts';
import type { AppGame } from '../schedule.ts';
import { getSeasonArchive, listSeasonArchives, type SeasonArchive } from '../seasonArchive.ts';
import { assembleSeasonScoredBuild, SeasonScheduleCacheUnavailableError } from '../seasonBuild.ts';
import { isWeeklyRecapActiveSeason } from '../selectors/weeklyRecapFacts.ts';
import { readConfirmedRosterInputs } from '../server/confirmedRosterStore.ts';

export type WeeklyRecapContext = {
  seasonYear: number;
  games: AppGame[];
  rosterByTeam: Map<string, string>;
  scoresByKey: Record<string, ScorePack>;
  archives: SeasonArchive[];
  historicalRosters: Record<number, Map<string, string>>;
};

export type WeeklyRecapContextResult =
  | { status: 'available'; context: WeeklyRecapContext }
  | { status: 'absent'; reason: 'schedule' | 'roster' }
  | { status: 'unavailable' };

async function loadHistoricalRecordContext(
  leagueSlug: string,
  seasonYear: number
): Promise<{
  archives: SeasonArchive[];
  historicalRosters: Record<number, Map<string, string>>;
}> {
  const years = (await listSeasonArchives(leagueSlug)).filter((year) => year < seasonYear);
  const loaded = await Promise.all(years.map((year) => getSeasonArchive(leagueSlug, year)));
  if (loaded.some((archive) => archive === null)) {
    throw new Error('A listed season archive became unavailable during weekly recap assembly.');
  }

  const archives = loaded as SeasonArchive[];
  const historicalRosters: Record<number, Map<string, string>> = {};
  for (const archive of archives) {
    historicalRosters[archive.year] = new Map(
      parseOwnersCsv(archive.ownerRosterSnapshot).map(({ team, owner }) => [team, owner] as const)
    );
  }
  return { archives, historicalRosters };
}

async function loadRecapContextUncached(
  leagueSlug: string,
  year: number
): Promise<WeeklyRecapContextResult> {
  try {
    const [build, { ownersCsv }, history] = await Promise.all([
      assembleSeasonScoredBuild(leagueSlug, year),
      readConfirmedRosterInputs(leagueSlug, year),
      loadHistoricalRecordContext(leagueSlug, year),
    ]);
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
        archives: history.archives,
        historicalRosters: history.historicalRosters,
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

/** Skip every recap-context read outside the league's exact active season. */
export async function loadRecapContextForSeasonScope(args: {
  leagueSlug: string;
  seasonYear: number;
  leagueStatus: LeagueStatus | undefined;
}): Promise<WeeklyRecapContextResult | null> {
  if (!isWeeklyRecapActiveSeason(args)) return null;
  return loadRecapContext(args.leagueSlug, args.seasonYear);
}

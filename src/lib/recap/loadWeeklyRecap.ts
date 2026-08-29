import type { LeagueStatus } from '../league.ts';
import { composeWeeklyRecap, type WeeklyRecapViewModel } from './composeWeeklyRecap.ts';
import { loadRecapContextForSeasonScope } from './loadRecapContext.ts';

/**
 * Load and compose one request-time recap without coupling its failure to the
 * standing Insights feed. `now` is supplied by the request boundary so every
 * calendar decision in the result uses one clock sample.
 */
export async function loadWeeklyRecap(args: {
  leagueSlug: string;
  seasonYear: number;
  leagueStatus: LeagueStatus | undefined;
  now: Date;
}): Promise<WeeklyRecapViewModel> {
  try {
    const recapContext = await loadRecapContextForSeasonScope(args);
    return recapContext
      ? composeWeeklyRecap(recapContext, args.now, {
          leagueStatus: args.leagueStatus,
          seasonYear: args.seasonYear,
        })
      : { status: 'inactive' };
  } catch {
    // The standing Insights feed remains usable when recap-only assembly fails.
    return { status: 'unavailable' };
  }
}

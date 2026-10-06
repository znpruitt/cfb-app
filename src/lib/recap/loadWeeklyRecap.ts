import type { LeagueStatus } from '../league.ts';
import { composeWeeklyRecap, type WeeklyRecapViewModel } from './composeWeeklyRecap.ts';
import { loadRecapContextForSeasonScope } from './loadRecapContext.ts';
import { composeForwardLook } from './composeForwardLook.ts';
import type { ForwardLook } from '../selectors/forwardLook.ts';

/**
 * Load and compose one request-time recap without coupling its failure to the
 * standing Insights feed. `now` is supplied by the request boundary so every
 * calendar decision in the result uses one clock sample.
 */
export async function loadTimelyContent(args: {
  leagueSlug: string;
  seasonYear: number;
  leagueStatus: LeagueStatus | undefined;
  now: Date;
}): Promise<{ weeklyRecap: WeeklyRecapViewModel; forwardLook: ForwardLook | null }> {
  try {
    const recapContext = await loadRecapContextForSeasonScope(args);
    if (!recapContext) return { weeklyRecap: { status: 'inactive' }, forwardLook: null };
    return {
      weeklyRecap: composeWeeklyRecap(recapContext, args.now, args),
      forwardLook: composeForwardLook(recapContext, args.now, args),
    };
  } catch {
    // The standing Insights feed remains usable when recap-only assembly fails.
    return { weeklyRecap: { status: 'unavailable' }, forwardLook: null };
  }
}

export async function loadWeeklyRecap(
  args: Parameters<typeof loadTimelyContent>[0]
): Promise<WeeklyRecapViewModel> {
  return (await loadTimelyContent(args)).weeklyRecap;
}

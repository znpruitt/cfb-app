import type { LeagueStatus } from '../league.ts';
import { composeWeeklyRecap, type WeeklyRecapViewModel } from './composeWeeklyRecap.ts';
import {
  loadRecapContextForSeasonScope,
  type WeeklyRecapContextResult,
} from './loadRecapContext.ts';
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
    let forwardLook: ForwardLook | null = null;
    try {
      forwardLook = composeForwardLook(recapContext, args.now, args);
    } catch {
      // The recap remains available if the preview cannot be assembled.
    }
    return { weeklyRecap: safeRecap(recapContext, args), forwardLook };
  } catch {
    // The standing Insights feed remains usable when the shared gather fails.
    return { weeklyRecap: { status: 'unavailable' }, forwardLook: null };
  }
}

export async function loadWeeklyRecap(
  args: Parameters<typeof loadTimelyContent>[0]
): Promise<WeeklyRecapViewModel> {
  try {
    const context = await loadRecapContextForSeasonScope(args);
    return context ? safeRecap(context, args) : { status: 'inactive' };
  } catch {
    return { status: 'unavailable' };
  }
}

function safeRecap(
  context: WeeklyRecapContextResult,
  args: Parameters<typeof loadTimelyContent>[0]
): WeeklyRecapViewModel {
  try {
    return composeWeeklyRecap(context, args.now, args);
  } catch {
    return { status: 'unavailable' };
  }
}

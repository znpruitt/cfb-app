import { NextResponse } from 'next/server';

import { fetchScoresByGame } from '@/lib/scores';
import { buildScheduleFromApi } from '@/lib/schedule';
import { requireAdminAuth } from '@/lib/server/adminAuth';
import {
  forwardAdminAuthHeaders,
  loadDebugSeasonContext,
  parseDebugYear,
} from '../_lib/loadDebugSeasonContext';

export const dynamic = 'force-dynamic';

// A large regular season can exceed this window; the cap keeps the diagnostic
// bounded. Reported as `gamesTruncated` so a partial view is never mistaken for
// full coverage.
const MAX_DEBUG_GAMES = 80;

export async function GET(req: Request) {
  const authFailure = await requireAdminAuth(req);
  if (authFailure) return authFailure;

  const url = new URL(req.url);
  const year = parseDebugYear(url);
  const origin = `${url.protocol}//${url.host}`;

  // Use the shared canonical loader: it fetches the EFFECTIVE alias map
  // (global > year > SEED) and the CFBD conference records. Passing
  // conferenceRecords into buildScheduleFromApi is required for parity — without
  // them the canonical schedule build resets its conference index and classifies
  // subdivision by present-day policy only, changing which games are eligible/
  // tracked and thus which scores appear attached (PLATFORM-076).
  const context = await loadDebugSeasonContext({ year, origin, req });

  const built = buildScheduleFromApi({
    scheduleItems: context.scheduleItems,
    teams: context.teamItems as never[],
    aliasMap: context.aliasMap,
    season: year,
    conferenceRecords: context.conferenceItems,
  });

  const games = built.games.slice(0, MAX_DEBUG_GAMES);
  const scores = await fetchScoresByGame({
    games,
    aliasMap: context.aliasMap,
    season: year,
    teams: context.teamItems as never[],
    apiBaseUrl: origin,
    // Authenticated diagnostic: refresh upstream (forwarding the admin's own
    // credentials) so a cold/stale cache does not report misleading zero rows.
    refresh: true,
    authHeaders: forwardAdminAuthHeaders(req),
  });

  return NextResponse.json({
    scoreCount: Object.keys(scores.scoresByKey).length,
    canonicalGamesTotal: built.games.length,
    gamesAnalyzed: games.length,
    gamesTruncated: built.games.length > games.length,
    issues: scores.issues,
    diag: scores.diag.slice(0, 50),
  });
}

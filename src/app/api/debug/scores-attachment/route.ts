import { NextResponse } from 'next/server';

import { loadDebugSeasonContext, parseDebugYear } from '../_lib/loadDebugSeasonContext';
import { buildScheduleFromApi } from '@/lib/schedule';
import {
  isActionableScoreAttachmentIssue,
  isIgnoredOutOfScopeProviderRow,
  summarizeAttachmentReasons,
} from '@/lib/scoreAttachmentDiagnostics';
import type { ScoreAttachmentDebugResponse } from '@/lib/scoreAttachmentDebug';
import { fetchScoresByGame } from '@/lib/scores';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const year = parseDebugYear(url);
  const weekParam = url.searchParams.get('week');
  const seasonType = url.searchParams.get('seasonType');
  const source = url.searchParams.get('source') ?? 'cfbd_scores';
  const week = weekParam && /^\d+$/.test(weekParam) ? Number.parseInt(weekParam, 10) : null;
  const origin = `${url.protocol}//${url.host}`;
  const context = await loadDebugSeasonContext({ year, origin });

  const built = buildScheduleFromApi({
    scheduleItems: context.scheduleItems,
    teams: context.teamItems as never[],
    aliasMap: context.aliasMap,
    season: year,
    conferenceRecords: context.conferenceItems,
  });

  const scopedGames = built.games.filter((game) => {
    if (week != null && game.week !== week) return false;
    if (seasonType === 'regular' && game.stage !== 'regular') return false;
    if (seasonType === 'postseason' && (game.stage === 'regular' || game.stage == null)) {
      return false;
    }
    return true;
  });

  const scores = await fetchScoresByGame({
    games: scopedGames,
    aliasMap: context.aliasMap,
    season: year,
    teams: context.teamItems as never[],
    debugTrace: true,
    apiBaseUrl: origin,
  });

  const diagnostics = scores.debugDiagnostics ?? [];
  const actionableDiagnostics = diagnostics.filter(isActionableScoreAttachmentIssue);
  const ignoredDiagnostics = diagnostics.filter(isIgnoredOutOfScopeProviderRow);
  const response: ScoreAttachmentDebugResponse = {
    year,
    week,
    seasonType,
    source,
    summary: {
      providerRowCount: scores.debugSnapshot?.providerRowCount ?? 0,
      attachedCount: scores.debugSnapshot?.attachedCount ?? 0,
      actionableCount: actionableDiagnostics.length,
      ignoredCount: ignoredDiagnostics.length,
      actionableReasons: summarizeAttachmentReasons(actionableDiagnostics),
      ignoredReasons: summarizeAttachmentReasons(ignoredDiagnostics),
    },
    schedule: {
      indexedGameCount: scopedGames.length,
      games: scopedGames.slice(0, 250).map((game) => ({
        gameKey: game.key,
        homeTeam: game.canHome ?? null,
        awayTeam: game.canAway ?? null,
        week: game.week ?? null,
        seasonType: game.stage === 'regular' ? 'regular' : 'postseason',
        status: null,
      })),
    },
    diagnostics: {
      actionable: actionableDiagnostics,
      ignored: ignoredDiagnostics,
    },
  };

  return NextResponse.json(response);
}
